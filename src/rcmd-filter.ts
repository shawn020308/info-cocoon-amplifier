// ============================================================
// rcmd-filter.ts - 右侧推荐视频过滤（测试版）
//
// 策略：绝不插入任何 DOM 元素到 B站页面中（避免破坏 Vue 渲染）。
//       违规视频仅设置 el.style.display = "none"。
//       过滤效果通过统计面板查看。
// ============================================================
import type { FilterConfig, CacheEntry } from "./types";
import { PROVIDER_PRESETS } from "./types";
import { getConfig } from "./config";
import { log, warn } from "./debug";
import { getCache, setCache } from "./db";
import { ruozhiStats, saveStats, notifyStatsUpdate } from "./stats";

const TAG = "[ruozhi-filter/rcmd]";

// ── 已处理过的视频 URL 集合（页面级去重）──
const seenUrls = new Set<string>();

// ── 推荐卡片 ──

interface RcmdCard {
  el: HTMLElement;
  title: string;
  upname: string;
  url: string;
}

/** 去掉 URL 中的 query 参数，保证缓存键跨页面稳定 */
function normalizeRcmdUrl(url: string): string {
  const q = url.indexOf("?");
  const f = url.indexOf("#");
  let end = url.length;
  if (q >= 0) end = Math.min(end, q);
  if (f >= 0) end = Math.min(end, f);
  return url.slice(0, end);
}

/** 生成推荐视频缓存 hash（基于去参后的 URL） */
function rcmdHash(url: string): string {
  const normalized = normalizeRcmdUrl(url);
  let h = 5381;
  for (let i = 0; i < normalized.length; i++) {
    h = ((h << 5) + h + normalized.charCodeAt(i)) & 0x7fffffff;
  }
  return "rcmd:" + h.toString(16);
}

/** 从 .video-page-card-small 中提取信息 */
function extractCard(el: HTMLElement): RcmdCard | null {
  const link = el.querySelector("a.video-awesome-img") as HTMLAnchorElement;
  const titleEl = el.querySelector("p.title") as HTMLElement;
  const upnameEl = el.querySelector(".upname span.name") as HTMLElement;
  if (!link || !titleEl) return null;

  const url = link.getAttribute("href") || "";
  const title = (
    titleEl.getAttribute("title") ||
    titleEl.textContent ||
    ""
  ).trim();
  const upname = upnameEl?.textContent?.trim() || "";

  if (!title || !url) return null;

  return { el, title, upname, url };
}

// ── AI 判定 ──

interface JudgeResult {
  violations: number[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** 构建推荐视频过滤的 System Prompt */
function buildSystemPrompt(config: FilterConfig): string {
  const title =
    document.title.replace(/[ _-]哔哩哔哩.*$/, "").trim() || "当前视频";
  const prompt = config.rcmdPrompt || config.prompt;
  return `你是内容过滤助手。用户正在B站观看「${title}」，右侧是算法推荐视频列表。

请根据以下规则，判断哪些推荐视频的标题需要过滤：

${prompt}

仅输出 JSON（无 markdown 标记）：
{"verdicts":[{"i":索引,"violation":true}]}
只输出违规标题对应的索引。无违规返回 {"verdicts":[]}`;
}

/** 构建用户消息：标题列表 */
function buildUserMessage(cards: RcmdCard[]): string {
  return JSON.stringify(
    cards.map((c, i) => ({
      i,
      t: c.title.slice(0, 200),
      u: c.upname.slice(0, 50),
    })),
  );
}

/** 调用 AI 判定推荐视频标题 */
async function judgeCards(
  cards: RcmdCard[],
  config: FilterConfig,
): Promise<JudgeResult> {
  const systemPrompt = buildSystemPrompt(config);
  const userMessage = buildUserMessage(cards);

  log(TAG, `判定 ${cards.length} 个推荐视频标题`);

  const fetcher: typeof fetch = (
    typeof unsafeWindow !== "undefined" ? unsafeWindow.fetch : window.fetch
  ) as typeof fetch;

  const hdrs: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey) {
    hdrs.Authorization = `Bearer ${config.apiKey}`;
  }

  const preset = PROVIDER_PRESETS[config.provider] ?? PROVIDER_PRESETS.custom;
  const body: Record<string, unknown> = {
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature: 0,
    max_tokens: 4096,
  };
  if (preset.supportsJsonFormat) {
    body.response_format = { type: "json_object" };
  }

  log(TAG, "请求体:", JSON.stringify(body));

  try {
    const resp = await fetcher(config.apiEndpoint, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      warn(TAG, `API 返回 ${resp.status}: ${errText.slice(0, 300)}`);
      return { violations: [] };
    }

    // 先读原始文本，再尝试 JSON 解析（避免截断导致 parse 失败无日志）
    const rawText = await resp.text().catch(() => "");
    if (!rawText) {
      warn(TAG, "API 返回空响应体");
      return { violations: [] };
    }

    let data: any;
    try {
      data = JSON.parse(rawText);
    } catch {
      warn(TAG, `API 返回非 JSON，原始响应(前500): ${rawText.slice(0, 500)}`);
      return { violations: [] };
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      warn(
        TAG,
        "API 返回无 content，完整响应:",
        JSON.stringify(data).slice(0, 500),
      );
      return { violations: [] };
    }

    let jsonStr = content.trim();
    if (jsonStr.startsWith("```json")) jsonStr = jsonStr.slice(7);
    if (jsonStr.startsWith("```")) jsonStr = jsonStr.slice(3);
    if (jsonStr.endsWith("```")) jsonStr = jsonStr.slice(0, -3);
    jsonStr = jsonStr.trim();

    const parsed = JSON.parse(jsonStr);
    const violations: number[] = (parsed.verdicts ?? [])
      .filter((v: any) => v.violation)
      .map((v: any) => v.i as number);

    log(
      TAG,
      `${violations.length}/${cards.length} 个推荐视频违规: ${violations.map((i) => cards[i]?.title).join(" | ")}`,
    );

    return {
      violations,
      usage: data.usage ?? undefined,
    };
  } catch (err) {
    warn(TAG, "API 调用异常:", err);
    return { violations: [] };
  }
}

// ── 扫描调度 ──

let pendingCards: RcmdCard[] = [];
let rcmdTimer: ReturnType<typeof setTimeout> | null = null;
let maxCollectTimer: ReturnType<typeof setTimeout> | null = null;
let isJudging = false;

/** 阶段：collecting=收集卡片 | judging=AI判定中 | done=已完成，后续仅走缓存 */
let rcmdPhase: "collecting" | "judging" | "done" = "collecting";

// ── 高斯模糊 ──

function getRcmdContainer(): HTMLElement | null {
  return document.querySelector(".recommend-list-v1") as HTMLElement | null;
}

function blurRcmd(): void {
  const container = getRcmdContainer();
  if (container) {
    container.style.filter = "blur(4px) brightness(0.85)";
    container.style.transition = "filter 0.5s ease";
    log(TAG, "推荐区已模糊");
  }
}

function unblurRcmd(): void {
  const container = getRcmdContainer();
  if (container) {
    container.style.filter = "";
    container.style.transition = "filter 0.5s ease";
    log(TAG, "推荐区已恢复");
  }
}

function clearFlushTimers(): void {
  if (rcmdTimer) {
    clearTimeout(rcmdTimer);
    rcmdTimer = null;
  }
  if (maxCollectTimer) {
    clearTimeout(maxCollectTimer);
    maxCollectTimer = null;
  }
}

async function flushRcmd(): Promise<void> {
  clearFlushTimers();

  // 仅 collecting 阶段且未在判定中才发送（每页仅一次 API）
  if (isJudging || rcmdPhase !== "collecting") return;

  // 无待判定卡片：全部命中缓存，无需 API，直接结束
  if (pendingCards.length === 0) {
    rcmdPhase = "done";
    log(TAG, "全部推荐视频已命中缓存，无需 API 调用");
    return;
  }

  // 有待判定卡片：先模糊，再发 API
  blurRcmd();
  rcmdPhase = "judging";
  isJudging = true;

  const batch = pendingCards.splice(0);
  const config = getConfig();

  if (batch.length === 0) {
    isJudging = false;
    rcmdPhase = "done";
    unblurRcmd();
    return;
  }

  log(
    TAG,
    `发送 ${batch.length} 个推荐视频到 AI 判定（本页唯一一次 API 调用）`,
  );

  if (!config.enableAI || !config.apiKey) {
    warn(
      TAG,
      `${batch.length} 个推荐视频未判定: enableAI=${config.enableAI}, hasApiKey=${!!config.apiKey}`,
    );
    isJudging = false;
    rcmdPhase = "done";
    unblurRcmd();
    return;
  }

  const result = await judgeCards(batch, config);

  // 更新统计
  ruozhiStats.apiCalls++;
  ruozhiStats.totalScanned += batch.length;
  if (result.usage) {
    ruozhiStats.totalTokens += result.usage.total_tokens;
    ruozhiStats.promptTokens += result.usage.prompt_tokens;
    ruozhiStats.completionTokens += result.usage.completion_tokens;
  }
  saveStats(ruozhiStats);
  notifyStatsUpdate();

  // 写缓存 + 处理违规
  const violationSet = new Set(result.violations);
  for (let i = 0; i < batch.length; i++) {
    const card = batch[i];
    const isViolation = violationSet.has(i);

    const entry: CacheEntry = {
      hash: rcmdHash(card.url),
      violation: isViolation,
      reason: isViolation ? "AI 判定违规" : "AI 判定通过",
      severity: isViolation ? "low" : "none",
      timestamp: Date.now(),
    };
    setCache(entry).catch(() => {});

    if (isViolation) {
      ruozhiStats.totalFiltered++;
      ruozhiStats.severityCounts["low"] =
        (ruozhiStats.severityCounts["low"] ?? 0) + 1;
      (card.el as HTMLElement).style.display = "none";
    }
  }

  saveStats(ruozhiStats);
  notifyStatsUpdate();

  // 完成：解除模糊，后续仅走缓存
  isJudging = false;
  rcmdPhase = "done";
  unblurRcmd();
}

function scheduleFlush(): void {
  if (!rcmdTimer) {
    // 有卡片入队后 2 秒发送（给页面渲染留时间，尽量一批收集完整）
    rcmdTimer = setTimeout(flushRcmd, 2000);
  }
  if (!maxCollectTimer) {
    // 兜底：最多收集 5 秒，超时强制发送
    maxCollectTimer = setTimeout(() => {
      log(TAG, "最大收集时间到，强制发送");
      flushRcmd();
    }, 5000);
  }
}

/** 扫描新卡片：缓存命中的立即隐藏，未命中的排队等 AI */
async function doScan(): Promise<void> {
  // 始终扫描（不因 isJudging 阻塞），缓存命中立即隐藏，不等待 AI
  const newCards = scanCards();
  if (newCards.length === 0) return;

  let cachedHidden = 0;
  let cachedPass = 0;
  for (const card of newCards) {
    const hash = rcmdHash(card.url);
    try {
      const cached = await getCache(hash);
      if (cached) {
        if (cached.violation) {
          (card.el as HTMLElement).style.display = "none";
          ruozhiStats.totalFiltered++;
          ruozhiStats.severityCounts["low"] =
            (ruozhiStats.severityCounts["low"] ?? 0) + 1;
          cachedHidden++;
        } else {
          cachedPass++;
        }
        // 缓存命中（无论违规与否）不再排队
        continue;
      }
    } catch {
      // 查缓存失败，降级送 AI
    }
    // 仅在 collecting 阶段排队，judging/done 阶段不再收集（每页仅一次 API）
    if (rcmdPhase === "collecting") {
      pendingCards.push(card);
    }
  }

  if (cachedHidden > 0) {
    saveStats(ruozhiStats);
    notifyStatsUpdate();
  }

  log(
    TAG,
    `扫描到 ${newCards.length} 个推荐视频，缓存违规=${cachedHidden}，缓存放行=${cachedPass}，排队=${pendingCards.length}，阶段=${rcmdPhase}`,
  );

  if (rcmdPhase === "collecting" && pendingCards.length > 0) {
    scheduleFlush();
  }
}

/** 扫描新卡片（排除已隐藏 + 已处理） */
function scanCards(): RcmdCard[] {
  const list = document.querySelector(".recommend-list-v1");
  if (!list) return [];

  const cards = list.querySelectorAll<HTMLElement>(".video-page-card-small");
  const result: RcmdCard[] = [];

  for (const card of cards) {
    if (card.style.display === "none") continue;
    const info = extractCard(card);
    if (!info) continue;
    if (seenUrls.has(info.url)) continue;
    seenUrls.add(info.url);
    result.push(info);
  }

  return result;
}

// ── Observer ──

let rcmdObserver: MutationObserver | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function tryBindObserver(): void {
  if (rcmdObserver) return;
  const rcmdTab = document.querySelector(".rcmd-tab");
  if (!rcmdTab) return;

  rcmdObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node instanceof HTMLElement) {
          if (
            node.classList.contains("video-page-card-small") ||
            node.querySelector(".video-page-card-small")
          ) {
            doScan();
            return;
          }
        }
      }
    }
  });
  rcmdObserver.observe(rcmdTab, { childList: true, subtree: true });
  log(TAG, "Observer attached");
}

function disconnectObserver(): void {
  if (rcmdObserver) {
    rcmdObserver.disconnect();
    rcmdObserver = null;
  }
}

/** 完全重置推荐过滤状态（SPA 导航时调用） */
function resetRcmdState(): void {
  clearFlushTimers();
  disconnectObserver();
  pendingCards = [];
  seenUrls.clear();
  isJudging = false;
  rcmdPhase = "collecting";
  unblurRcmd();
  log(TAG, "状态已重置（视频切换）");
}

export function startRcmdFilter(): void {
  const config = getConfig();
  if (!config.enableRcmdFilter) return;
  log(TAG, "started");

  resetRcmdState();

  doScan();
  tryBindObserver();

  pollTimer = setInterval(() => {
    tryBindObserver();
    doScan();
  }, 2000);
}

export function stopRcmdFilter(): void {
  if (rcmdObserver) {
    rcmdObserver.disconnect();
    rcmdObserver = null;
  }
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  clearFlushTimers();
  pendingCards = [];
  seenUrls.clear();
  rcmdPhase = "collecting";
  unblurRcmd();
}

/**
 * SPA 导航到新视频时调用。
 * 重置所有状态 + 重新绑定 Observer + 重新扫描。
 * 仅在 rcmd-filter 已启动（pollTimer 活跃）时生效。
 */
export function onVideoNavigate(): void {
  if (!pollTimer) return; // 未启动
  const config = getConfig();
  if (!config.enableRcmdFilter) return;

  log(TAG, "检测到视频切换，重置推荐过滤");
  resetRcmdState();

  // 新页面的 DOM 尚未渲染完成，延迟扫描
  setTimeout(() => {
    doScan();
    tryBindObserver();
  }, 1500);
}
