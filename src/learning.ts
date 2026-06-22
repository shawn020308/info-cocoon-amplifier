// ============================================================
// learning.ts - AI自我学习：由AI持续维护用户过滤画像
//
// ★ 触发链路：
//  用户操作 → recordLearning() 写入 learningCorrections[]
//     ↓
//  新记录累积 ≥20 条（自上次画像更新后）
//     ↓
//  下次 API 调用 → 全量记录发给 AI → AI 生成 300 字画像
//     ↓
//  画像注入后续所有 System Prompt
//
//  学习频率随画像精准度提高而自然降低。
//  画像最长 300 字，记录上限 500 条。
// ============================================================
import type { FilterConfig, LearningCorrection } from "./types";
import { getConfig } from "./config";
import { log } from "./debug";

const TAG = "[ruozhi-filter]";

/** 学习记录上限（取最新） */
const MAX_CORRECTIONS = 500;

/** 累积多少条新纠正后触发画像更新 */
const REFINE_THRESHOLD = 20;

/** 画像最大长度（字） */
const MAX_PROFILE_LENGTH = 2000;

/** 画像更新回调（由 main.ts 注入，避免循环依赖） */
let refineCallback: (() => Promise<void>) | null = null;

/** 注册画像更新回调 */
export function setRefineCallback(cb: () => Promise<void>): void {
  refineCallback = cb;
}

/** 防止并发更新 */
let refining = false;

// ── 记录 ──

/** 记录一条用户纠正 */
export function recordLearning(
  correction: Omit<LearningCorrection, "timestamp">,
): void {
  try {
    const config = getConfig();
    if (!config.learningEnabled) return;

    if (!Array.isArray(config.learningCorrections)) {
      config.learningCorrections = [];
    }

    const entry: LearningCorrection = {
      ...correction,
      message: correction.message.slice(0, 200),
      timestamp: Date.now(),
    };

    // 去重：前50字相同 + 同类型 → 替换旧记录
    const dupIdx = config.learningCorrections.findIndex(
      (c) =>
        c.type === entry.type &&
        c.message.slice(0, 50) === entry.message.slice(0, 50),
    );
    if (dupIdx >= 0) {
      config.learningCorrections.splice(dupIdx, 1);
    }

    config.learningCorrections.unshift(entry);

    // 保持上限
    if (config.learningCorrections.length > MAX_CORRECTIONS) {
      config.learningCorrections.length = MAX_CORRECTIONS;
    }

    const newSinceLast =
      config.learningCorrections.length - (config.lastRefinedCount ?? 0);

    persist(config);
    log(
      TAG,
      `学习记录: ${entry.type} | 总${config.learningCorrections.length}条 | 新${newSinceLast}条 | 画像${config.learnedProfile ? "✓" : "✗"}`,
    );

    // ★ 达到阈值后独立触发画像更新（不再依赖评论扫描）
    if (newSinceLast >= REFINE_THRESHOLD && refineCallback && !refining) {
      refining = true;
      refineCallback().finally(() => {
        refining = false;
      });
    }
  } catch (err) {
    console.warn(TAG, " 学习记录失败:", err);
  }
}

// ── Prompt 构建 ──

/**
 * 构建注入 System Prompt 的学习片段。
 * 有画像用画像，无画像提示待生成。
 */
export function buildLearningPrompt(): string {
  try {
    const config = getConfig();
    if (!config.learningEnabled) return "";

    if (config.learnedProfile && typeof config.learnedProfile === "string") {
      return `\n\n[用户过滤画像] ${config.learnedProfile}`;
    }

    const records = config.learningCorrections;
    if (!Array.isArray(records) || records.length === 0) return "";

    const unblockCount = records.filter(
      (c) => c.type === "unblock" || c.type === "misjudge",
    ).length;
    const manualCount = records.filter(
      (c) => c.type === "manual_blacklist",
    ).length;

    return `\n\n[用户学习反馈] 已收集${records.length}条纠正（误判${unblockCount}/漏判${manualCount}），攒够${REFINE_THRESHOLD}条后将自动生成学习画像。请暂时参考这些纠正调整判定。`;
  } catch {
    return "";
  }
}

// ── 画像更新（AI驱动） ──

/** 是否需要更新画像（新记录 ≥ 阈值） */
export function shouldRefineProfile(): boolean {
  try {
    const config = getConfig();
    if (!config.learningEnabled) return false;
    const records = config.learningCorrections;
    if (!Array.isArray(records)) return false;
    const newCount = records.length - (config.lastRefinedCount ?? 0);
    return newCount >= REFINE_THRESHOLD;
  } catch {
    return false;
  }
}

/**
 * 构建画像更新指令。
 * 将全部学习记录（按时间倒序）发给 AI，请其提炼 300 字画像。
 */
export function buildRefinementInstruction(): string {
  try {
    const config = getConfig();
    const records = config.learningCorrections;
    if (!Array.isArray(records) || records.length === 0) return "";

    const currentProfile = config.learnedProfile || "（尚无画像）";
    const newCount = records.length - (config.lastRefinedCount ?? 0);

    if (newCount < REFINE_THRESHOLD) return "";

    // 构建全量纠正列表（紧凑格式，标签与 system prompt 一致）
    const correctionLines = records.map((c) => {
      const typeLabel = c.type === "manual_blacklist" ? "拉黑" : "放过";
      const aiInfo = c.aiReason ? ` #曾判定:${c.aiReason.slice(0, 20)}` : "";
      return `[${typeLabel}]「${c.message.slice(0, 60)}」${aiInfo}`;
    });

    const totalTokens = correctionLines.join("\n").length;
    const truncated =
      totalTokens > 6000
        ? correctionLines.slice(
            0,
            Math.floor(6000 / (totalTokens / correctionLines.length)),
          )
        : correctionLines;
    return `

--- 学习画像更新请求 ---
当前画像：${currentProfile}

全部纠正记录（${records.length}条，按时间倒序）：
[放过] = 用户恢复了AI误判的内容（这些不应被过滤）
[拉黑] = 用户手动拉黑了AI漏判的内容（这些应被过滤）
${truncated.join("\n")}

请根据以上记录，深入分析用户每次操作背后的心理动机，输出 refinedProfile：

用户的拉黑行为通常不是按"话题类型"分类，而是对内容背后的认知质量和人格特质的判断。例如：
- "说话弱智" → 用户排斥低质量思考：以偏概全、逻辑混乱、反智简化、非黑即白的二极管思维
- "自我中心" → 用户排斥自恋型表达：缺乏共情、把自己的感受当普世真理、无法换位思考、好为人师
- "杠精" → 用户排斥对抗型沟通：为反驳而反驳、恶意挑刺、偷换概念、抓住无关细节否定整体、拒绝理解对方本意
- "居高临下" → 用户排斥说教型沟通：强行输出观点、忽略对方语境、把个人看法包装成绝对真理、居高临下指导
- "秀优越" → 用户排斥阶层感表达：凡尔赛式炫耀、打压式发言、"这都不懂"式轻视、用鄙视链建立虚假权威
- "道德绑架" → 用户排斥审判型表达：站在道德制高点攻击、非我即敌不容讨论、用正确立场压制理性辩论
- "情绪垃圾桶" → 用户排斥纯粹发泄：没有信息量的情绪倾倒、纯骂街、把评论区当个人情绪出口
- "饭圈思维" → 用户排斥身份绑定立场：党同伐异、站队大于说理、用身份标签替代逻辑论证、不能就事论事
- "阴谋论" → 用户排斥认知扭曲：捕风捉影、过度解读、凡事往最坏处想、预设恶意前提、不信任一切
- "故意挑事" → 用户排斥破坏型参与：明知引战还要说、钓鱼、反串黑、以制造冲突为乐
- "复读机" → 用户排斥思维懒惰：人云亦云、用流行梗代替独立表达、没有个人观点、机械复读
- "悲观消极" → 用户排斥传播无力感：一切都很糟的末日叙事、做什么都没用的幻灭论调、在评论区散播焦虑
- "阴阳怪气" → 用户排斥暗讽型表达：不直接说但句句带刺、反话正说、含沙射影、让人不适但不留把柄
- "不懂装懂" → 用户排斥伪专业型：明明不懂却硬要科普、百度查完就装专家、用术语包装胡说、缺乏敬畏心
- "过度简化" → 用户排斥简化主义："不就是XX吗"式粗暴归纳、把复杂议题压缩成口号、拒绝承认灰度与复杂性
- "查成分" → 用户排斥人身溯源：不辩论点只翻发言者历史、用身份而非逻辑否定对方、"你是XX所以你说的不对"
- "转移话题" → 用户排斥回避型沟通：被反驳后立刻换话题、顾左右而言他、拒绝正面回应核心问题、用新话题掩盖旧漏洞
- "受害者表演" → 用户排斥苦情操控：夸大受害博同情、用苦难换取道德豁免、以弱者身份压制不同意见
- "岁月静好" → 用户排斥伪中立和稀泥："两边都有问题"式各打五十大板、用伪理性压制正当批评、回避真正矛盾
- "滑坡谬误" → 用户排斥极端化推导："今天允许XX明天就会YY"、用极端后果恐吓、放大风险到荒谬程度
- "稻草人" → 用户排斥曲解反驳：故意歪曲对方观点后攻击、把复杂论证简化为荒谬版本再打倒
- "装外宾" → 用户排斥假装无知："我不太懂但是我感觉"式明知故问、用假装天真包装恶意、以无辜姿态挑衅
- "诉诸权威" → 用户排斥伪背书：用不相关领域专家站台、"科学表明"但不给出处、伪造数据支持观点
- "万物皆蹭" → 用户排斥硬蹭热度：不管什么话题都往自己熟悉的领域带、把别人的讨论变成自己的秀场

分析要点（不要罗列行为，要揭示动机。穿透表层看深层——用户说"这人弱智"可能是表面，底下是"低质量思考浪费我的注意力"）：
- 每条拉黑背后，用户在拒绝什么认知模式或人格特质？这种拒绝在保护他的什么心理资源？
- 每条放过背后，用户放过时遵循了什么"宁可错放不可错杀"的价值排序？
- 注意矛盾：放过了A却拉黑了类似的B——那个AB之间的细微差异就是用户真正的判断标准
- 注意强度：越强烈的拉黑，说明被触碰的价值越核心

画像用自然段落写（2000字以内），不要列维度标签、不要填表感。就讲清三件事：
1. 用户在保护什么——核心价值、心理资源、想获得什么体验
2. 用户受不了什么——什么认知模式/人格特质会触发他，为什么
3. 用户对什么网开一面——哪些"灰色地带"他会放过，这说明了什么

在JSON响应中增加 "refinedProfile" 字段。`;
  } catch {
    return "";
  }
}

/** 应用 AI 返回的精炼画像 */
export function applyRefinedProfile(profile: string): void {
  if (!profile || typeof profile !== "string" || profile.trim().length < 10)
    return;
  try {
    const config = getConfig();
    const trimmed = profile.trim().slice(0, MAX_PROFILE_LENGTH);
    config.learnedProfile = trimmed;
    config.lastRefinedCount = config.learningCorrections?.length ?? 0;
    persist(config);
    log(
      TAG,
      ` 画像已更新 (${trimmed.length}字) | 已处理${config.lastRefinedCount}条 | 新画像: ${trimmed.slice(0, 80)}…`,
    );
  } catch (err) {
    console.warn(TAG, " 画像保存失败:", err);
  }
}

// ── 持久化 ──

function persist(config: FilterConfig): void {
  try {
    const json = JSON.stringify(config);
    GM_setValue("ruozhi-config", json);
    const verify = GM_getValue("ruozhi-config", "");
    if (!verify || verify.length < 10) {
      console.error(TAG, "Persistence verification failed: 写入后读取为空");
    }
  } catch (e) {
    console.error(TAG, "Persistence failed:", e);
  }
}

// ── UI 查询 ──

export function getLearnedProfile(): string {
  try {
    const profile = getConfig().learnedProfile;
    return typeof profile === "string" ? profile : "";
  } catch {
    return "";
  }
}

export function getPendingCount(): number {
  try {
    const config = getConfig();
    const records = config.learningCorrections;
    if (!Array.isArray(records)) return 0;
    return Math.max(0, records.length - (config.lastRefinedCount ?? 0));
  } catch {
    return 0;
  }
}

export function getLearningRecords(): LearningCorrection[] {
  try {
    const records = getConfig().learningCorrections;
    return Array.isArray(records) ? [...records] : [];
  } catch {
    return [];
  }
}

export function getLearningStats(): {
  total: number;
  unblockCount: number;
  misjudgeCount: number;
  manualCount: number;
} {
  try {
    const records = getConfig().learningCorrections;
    if (!Array.isArray(records)) {
      return { total: 0, unblockCount: 0, misjudgeCount: 0, manualCount: 0 };
    }
    return {
      total: records.length,
      unblockCount: records.filter((c) => c.type === "unblock").length,
      misjudgeCount: records.filter((c) => c.type === "misjudge").length,
      manualCount: records.filter((c) => c.type === "manual_blacklist").length,
    };
  } catch {
    return { total: 0, unblockCount: 0, misjudgeCount: 0, manualCount: 0 };
  }
}

export function removeLearning(index: number): void {
  try {
    const config = getConfig();
    if (!Array.isArray(config.learningCorrections)) return;
    if (index >= 0 && index < config.learningCorrections.length) {
      config.learningCorrections.splice(index, 1);
      // 调整 lastRefinedCount 防止越界
      if (
        typeof config.lastRefinedCount === "number" &&
        config.lastRefinedCount > config.learningCorrections.length
      ) {
        config.lastRefinedCount = config.learningCorrections.length;
      }
      persist(config);
    }
  } catch {
    /* */
  }
}

export function clearLearning(): void {
  try {
    const config = getConfig();
    config.learnedProfile = "";
    config.learningCorrections = [];
    config.lastRefinedCount = 0;
    persist(config);
  } catch {
    /* */
  }
}
