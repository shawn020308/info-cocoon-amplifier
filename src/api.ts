// ============================================================
// api.ts - 多 AI 提供商通信层
// 支持: DeepSeek / OpenAI / OpenRouter / Groq / Ollama / vLLM / 自定义
// ============================================================
import type {
  FilterConfig,
  BiliReply,
  AIVerdict,
  AIBatchResult,
  ReplyContext,
} from "./types";
import { PROVIDER_PRESETS } from "./types";
import { getConfig } from "./config";
import { log, warn } from "./debug";
import {
  buildLearningPrompt,
  buildRefinementInstruction,
  shouldRefineProfile,
  applyRefinedProfile,
} from "./learning";

const TAG = "[ruozhi-filter]";

/** 根据配置判断是否为本地提供商（不需要 auth + 可能不支持 json_object） */
function getPreset(config: FilterConfig) {
  return PROVIDER_PRESETS[config.provider] ?? PROVIDER_PRESETS.custom;
}

/** 是否跳过 Authorization header */
function skipAuth(config: FilterConfig): boolean {
  const preset = getPreset(config);
  if (!preset.needsAuth) return true;
  // 本地地址且 apiKey 为空也跳过
  if (
    !config.apiKey &&
    (config.apiEndpoint.startsWith("http://localhost") ||
      config.apiEndpoint.startsWith("http://127.0.0.1"))
  ) {
    return true;
  }
  return false;
}

/** 构建请求头（根据提供商自动决定是否加 Authorization） */
function buildHeaders(config: FilterConfig): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (!skipAuth(config)) {
    h.Authorization = `Bearer ${config.apiKey}`;
  }
  return h;
}

/** 构建画像更新的请求体 */
function buildRefineBody(
  config: FilterConfig,
  instruction: string,
): Record<string, unknown> {
  const preset = getPreset(config);
  const body: Record<string, unknown> = {
    model: config.model,
    messages: [
      {
        role: "system",
        content: `你是用户心理画像分析助手。你的任务是透过用户每一次拉黑/放过操作，推断其背后的心理动机、价值判断与认知需求，而非简单归纳行为表象。

纠正记录说明：
- "放过" = 用户将AI误判的内容恢复了（用户认为这些不该被过滤）
- "拉黑" = 用户手动拉黑了AI漏判的内容（用户认为这些应该被过滤）

用户拉黑的真实心理动机通常不是"话题类型"，而是对内容背后的认知质量和人格特质的判断。例如：
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

分析时要穿透表层看深层：用户说"这人弱智"可能是表面，底下是"低质量思考浪费我的注意力，我上评论区不是来当认知垃圾回收站的"。始终追问：用户通过筛选在保护什么？追求什么体验？
- 注意矛盾中的线索：放过A却拉黑了类似的B，那个AB之间的细微差异就是用户真正的判断标准
- 注意反应强度：越强烈的拉黑冲动，说明被触碰的价值越核心

画像用自然段落写（2000字以内），不要列维度标签、不要填表感。就讲清三件事：
1. 用户在保护什么——他的核心价值、心理资源、想获得什么体验
2. 用户受不了什么——什么认知模式/人格特质会触发他，为什么
3. 用户对什么网开一面——哪些"灰色地带"内容他会放过，这说明了什么

请严格输出以下JSON格式，refinedProfile 字段包含上述分析内容：
{"refinedProfile":"...(2000字以内)"}`,
      },
      { role: "user", content: instruction },
    ],
    temperature: 0,
    max_tokens: 16384,
  };
  if (preset.supportsJsonFormat) {
    body.response_format = { type: "json_object" };
  }
  return body;
}

function buildSystemPrompt(config: FilterConfig, ctx: ReplyContext): string {
  const ctxParts: string[] = [`视频：${ctx.videoTitle}`];
  if (config.sendVideoDesc) {
    ctxParts.push(`简介：${ctx.videoDesc.slice(0, 200)}`);
  }

  const learningSection = buildLearningPrompt();
  const refinementSection = buildRefinementInstruction();

  // ★ 知识库注入
  const kb = config.knowledgeBase;
  const kbSection =
    Array.isArray(kb) && kb.length > 0
      ? `\n\n[知识库] 以下为已知的语境信息，辅助判断反讽/引用/特定称呼：\n${kb.map((e, i) => `${i + 1}. ${e}`).join("\n")}`
      : "";

  // ★ 用户画像存在时，提升到最高优先级
  const hasProfile =
    config.learnedProfile && typeof config.learnedProfile === "string";

  return `判断评论是否违规。

${
  hasProfile
    ? `[最高优先级] 用户过滤画像（与下方规则冲突时，以画像为准）：
${config.learnedProfile}\n\n`
    : ""
}规则：${config.prompt}
上下文：${ctxParts.join("；")}${kbSection}${hasProfile ? "" : learningSection}${refinementSection}

${hasProfile ? "重要：以上用户画像优先级高于基础规则。当规则与画像冲突时，以用户画像为准判定。" : ""}
仅输出JSON（无markdown标记）：
{"verdicts":[{"i":索引,"violation":true,"reason":"理由","severity":"low|medium|high|block"}]}
只输出违规评论，无违规返回{"verdicts":[]}`;
}

function buildUserMessage(config: FilterConfig, replies: BiliReply[]): string {
  // 紧凑格式：用数字索引代替 rpid字段名，减少 JSON key 开销
  const comments = replies.map((r, i) => {
    const item: Record<string, unknown> = {
      i, // 索引，AI 返回时用 i 对应，我们再映射回 rpid
      c: r.content.message,
    };
    if (config.sendMid) item.m = r.mid;
    if (config.sendUname) item.u = r.member.uname;
    return item;
  });
  return JSON.stringify(comments);
}

/** 构建请求体：根据提供商差异调整参数 */
function buildRequestBody(
  config: FilterConfig,
  systemPrompt: string,
  userMessage: string,
  isRefining: boolean,
): Record<string, unknown> {
  const preset = getPreset(config);
  const body: Record<string, unknown> = {
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature: 0,
    max_tokens: isRefining ? 16384 : 16384,
  };
  // 本地模型 (Ollama/vLLM) 可能不支持 json_object 格式约束
  // 但 System Prompt 已明确要求输出 JSON，去掉此参数不影响效果
  if (preset.supportsJsonFormat) {
    body.response_format = { type: "json_object" };
  }
  return body;
}

/** 调用 AI API 批量判定 */
export async function batchJudge(
  config: FilterConfig,
  replies: BiliReply[],
  ctx: ReplyContext,
): Promise<AIBatchResult> {
  if ((!config.apiKey && getPreset(config).needsAuth) || replies.length === 0)
    return { verdicts: [] };

  const systemPrompt = buildSystemPrompt(config, ctx);
  const userMessage = buildUserMessage(config, replies);
  const isRefining = shouldRefineProfile();

  if (isRefining) {
    log(TAG, `触发画像更新 (评论判定附带)`);
  }

  const reqBody = buildRequestBody(
    config,
    systemPrompt,
    userMessage,
    isRefining,
  );
  log(TAG, "请求体:", JSON.stringify(reqBody));
  log(
    TAG,
    "System Prompt (前500字):",
    systemPrompt.slice(0, 500) + (systemPrompt.length > 500 ? "..." : ""),
  );
  log(TAG, "User Message:", JSON.parse(userMessage));

  // 构建索引→rpid 映射表
  const rpidByIndex = new Map(replies.map((r, i) => [i, r.rpid]));

  const fetchStart = Date.now();

  const fetcher: typeof fetch = (
    typeof unsafeWindow !== "undefined" ? unsafeWindow.fetch : window.fetch
  ) as typeof fetch;

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (!skipAuth(config)) {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }

    const response = await fetcher(config.apiEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(reqBody),
    });

    log(TAG, `API HTTP ${response.status}, ${Date.now() - fetchStart}ms`);

    if (!response.ok) {
      const errText = await response.text();
      console.error(
        TAG,
        `API error ${response.status}:`,
        errText.slice(0, 200),
      );
      throw new Error(`DeepSeek API error ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    const usage = data.usage;

    log(TAG, "DeepSeek 返回内容:", content);
    log(TAG, "DeepSeek 用量:", usage);

    if (!content) {
      warn(TAG, " AI 返回空内容");
      return { verdicts: [], usage };
    }

    try {
      let jsonStr = content.trim();
      if (jsonStr.startsWith("```json")) jsonStr = jsonStr.slice(7);
      if (jsonStr.startsWith("```")) jsonStr = jsonStr.slice(3);
      if (jsonStr.endsWith("```")) jsonStr = jsonStr.slice(0, -3);
      jsonStr = jsonStr.trim();
      const parsed = JSON.parse(jsonStr);
      // 将紧凑格式的 i 映射回 rpid
      const verdicts: AIVerdict[] = (parsed.verdicts ?? []).map((v: any) => ({
        rpid: rpidByIndex.get(v.i) ?? v.rpid ?? 0,
        mid: v.mid ?? 0,
        violation: v.violation,
        reason: v.reason ?? "",
        severity: v.severity ?? "medium",
      }));

      // ★ 提取 AI 精炼的学习画像
      if (parsed.refinedProfile && typeof parsed.refinedProfile === "string") {
        applyRefinedProfile(parsed.refinedProfile);
      }

      return { verdicts, usage };
    } catch (e) {
      console.error(TAG, "AI response parse failed:", e);
      return { verdicts: [], usage };
    }
  } catch (err) {
    console.error(TAG, "Network request failed:", err);
    throw err;
  }
}

/** 测试API连通性 */
export async function testAPIConnection(
  config: FilterConfig,
): Promise<boolean> {
  try {
    const fetcher: typeof fetch = (
      typeof unsafeWindow !== "undefined" ? unsafeWindow.fetch : window.fetch
    ) as typeof fetch;
    const hdrs: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (!skipAuth(config)) {
      hdrs.Authorization = `Bearer ${config.apiKey}`;
    }
    const resp = await fetcher(config.apiEndpoint, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 5,
      }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * 独立画像更新：不依赖评论扫描，直接调用 AI 精炼学习画像。
 * 由 recordLearning() 达到阈值时自动触发。
 */
export async function refineProfileNow(): Promise<void> {
  return _refineProfile(false);
}

/** 强制重新生成画像（忽略阈值，有记录就发） */
export async function forceRefineProfile(): Promise<void> {
  return _refineProfile(true);
}

async function _refineProfile(force: boolean): Promise<void> {
  if (!force && !shouldRefineProfile()) {
    log(TAG, "refineProfile: 未达阈值，跳过");
    return;
  }

  const config = getConfig();
  if (!config.apiKey && getPreset(config).needsAuth) {
    warn(TAG, " 画像更新跳过: 未配置API Key");
    return;
  }

  const records = config.learningCorrections;
  if (!Array.isArray(records) || records.length === 0) {
    warn(TAG, " 画像更新跳过: 无学习记录");
    return;
  }

  // 强制模式下临时将 lastRefinedCount 置 0 以生成完整指令
  const savedCount = config.lastRefinedCount;
  if (force) {
    config.lastRefinedCount = 0;
  }

  const instruction = buildRefinementInstruction();

  if (force) {
    config.lastRefinedCount = savedCount;
  }

  if (!instruction) {
    warn(TAG, " 画像更新跳过: 无更新指令");
    return;
  }

  log(
    TAG,
    `${force ? "强制" : "自动"}画像更新中... (指令${instruction.length}字)`,
  );

  const fetcher: typeof fetch = (
    typeof unsafeWindow !== "undefined" ? unsafeWindow.fetch : window.fetch
  ) as typeof fetch;

  const reqBody = buildRefineBody(config, instruction);
  log(
    TAG,
    "画像更新 请求体 model:",
    reqBody.model,
    "max_tokens:",
    reqBody.max_tokens,
  );

  try {
    const fetchStart = Date.now();
    const response = await fetcher(config.apiEndpoint, {
      method: "POST",
      headers: buildHeaders(config),
      body: JSON.stringify(reqBody),
    });

    log(
      TAG,
      `画像更新 API HTTP ${response.status}, ${Date.now() - fetchStart}ms`,
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error(
        TAG,
        `Profile update API error ${response.status}:`,
        errText.slice(0, 300),
      );
      return;
    }

    const data = await response.json();
    log(TAG, "画像更新 原始响应:", JSON.stringify(data).slice(0, 500));
    const content = data.choices?.[0]?.message?.content;
    console.log(TAG, "画像更新 DeepSeek 返回内容:", content);
    if (!content) {
      warn(
        TAG,
        " 画像更新: AI 返回空内容, raw choices:",
        JSON.stringify(data.choices).slice(0, 300),
      );
      return;
    }

    let jsonStr = content.trim();
    if (jsonStr.startsWith("```json")) jsonStr = jsonStr.slice(7);
    if (jsonStr.startsWith("```")) jsonStr = jsonStr.slice(3);
    if (jsonStr.endsWith("```")) jsonStr = jsonStr.slice(0, -3);
    jsonStr = jsonStr.trim();

    const parsed = JSON.parse(jsonStr);
    if (parsed.refinedProfile && typeof parsed.refinedProfile === "string") {
      applyRefinedProfile(parsed.refinedProfile);
    } else {
      warn(TAG, " 画像更新: 未收到 refinedProfile 字段");
    }
  } catch (err) {
    console.error(TAG, "Profile update failed:", err);
  }
}
