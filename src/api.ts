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
        content: `你是用户过滤画像维护助手。根据用户对AI判定的纠正记录，输出精炼的过滤画像。

纠正记录说明：
- "放过" = 用户将AI误判的内容恢复了（用户认为这些不该被过滤）
- "拉黑" = 用户手动拉黑了AI漏判的内容（用户认为这些应该被过滤）

请严格按以下格式输出画像（300字以内）：
应过滤：[用户明确不想看的内容，基于拉黑案例归纳]
应放过：[用户想保留的内容，基于放过案例归纳]
立场：[一句话概括用户倾向]

仅输出JSON：{"refinedProfile":"..."}`,
      },
      { role: "user", content: instruction },
    ],
    temperature: 0,
    max_tokens: 512,
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
    max_tokens: isRefining ? 8192 : 8192,
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

    console.log(TAG, "DeepSeek 返回内容:", content);
    console.log(TAG, "DeepSeek 用量:", usage);

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

  try {
    const response = await fetcher(config.apiEndpoint, {
      method: "POST",
      headers: buildHeaders(config),
      body: JSON.stringify(buildRefineBody(config, instruction)),
    });

    if (!response.ok) {
      console.error(TAG, `Profile update API error ${response.status}`);
      return;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    console.log(TAG, "画像更新 DeepSeek 返回内容:", content);
    if (!content) {
      warn(TAG, " 画像更新: AI 返回空内容");
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
