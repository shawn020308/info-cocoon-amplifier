// ============================================================
// learning.ts - AI自我学习：由AI持续维护用户过滤画像
//
// ★ 触发链路：
//   用户操作 → recordLearning() 写入 learningCorrections[]
//                          ↓
//        新记录累积 ≥20 条（自上次画像更新后）
//                          ↓
//   下次 API 调用 → 全量记录发给 AI → AI 生成 300 字画像
//                          ↓
//        画像注入后续所有 System Prompt
//
//   学习频率随画像精准度提高而自然降低。
//   画像最长 300 字，记录上限 500 条。
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
const MAX_PROFILE_LENGTH = 300;

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
      `🧠 学习记录: ${entry.type} | 总${config.learningCorrections.length}条 | 新${newSinceLast}条 | 画像${config.learnedProfile ? "✓" : "✗"}`,
    );

    // ★ 达到阈值后独立触发画像更新（不再依赖评论扫描）
    if (newSinceLast >= REFINE_THRESHOLD && refineCallback && !refining) {
      refining = true;
      refineCallback().finally(() => {
        refining = false;
      });
    }
  } catch (err) {
    console.warn(TAG, "⚠️ 学习记录失败:", err);
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

请根据以上记录，输出 refinedProfile：
- 应过滤：基于[拉黑]案例，归纳用户明确不想看的内容类型
- 应放过：基于[放过]案例，归纳用户想保留的内容类型
- 立场：一句话概括用户整体倾向

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
      `✅ 画像已更新 (${trimmed.length}字) | 已处理${config.lastRefinedCount}条 | 新画像: ${trimmed.slice(0, 80)}…`,
    );
  } catch (err) {
    console.warn(TAG, "⚠️ 画像保存失败:", err);
  }
}

// ── 持久化 ──

function persist(config: FilterConfig): void {
  try {
    const json = JSON.stringify(config);
    GM_setValue("ruozhi-config", json);
    const verify = GM_getValue("ruozhi-config", "");
    if (!verify || verify.length < 10) {
      console.error(TAG, "❌ 持久化验证失败: 写入后读取为空");
    }
  } catch (e) {
    console.error(TAG, "❌ 持久化失败:", e);
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
