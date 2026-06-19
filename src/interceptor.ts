// ============================================================
// interceptor.ts - 纯 DOM 扫描器
// ============================================================
import type {
  FilterConfig,
  BiliReply,
  ReplyContext,
  AIVerdict,
  AccumulatedStats,
  BlacklistRecord,
} from "./types";
import { filterReplies } from "./filter";
import { addToBlacklist, blacklistKey } from "./db";

const TAG = "[ruozhi-filter]";

// 全局统计
const ruozhiStats: AccumulatedStats = {
  totalFiltered: 0,
  totalScanned: 0,
  apiCalls: 0,
  totalTokens: 0,
  promptTokens: 0,
  completionTokens: 0,
  severityCounts: {},
  lastUpdate: 0,
};
// 暴露到全局
if (typeof window !== "undefined") {
  (window as any).__ruozhi_stats = ruozhiStats;
}

// 延迟导入ui模块的updateStats避免循环依赖
let updateStats: (s: AccumulatedStats) => void = () => {};
export function setUpdateStats(fn: (s: AccumulatedStats) => void): void {
  updateStats = fn;
}

let currentContext: ReplyContext = { oid: 0, videoTitle: "", videoDesc: "" };
let getConfig = (): FilterConfig => {
  try {
    const raw = GM_getValue("ruozhi-config", "");
    if (raw) return JSON.parse(raw);
  } catch {
    /* */
  }
  return {
    apiKey: "",
    apiEndpoint: "https://api.deepseek.com/chat/completions",
    model: "deepseek-chat",
    prompt: "",
    foldMode: true,
    enableAI: true,
    enableBlacklist: true,
    blacklistStrictness: 1,
    pricePerMToken: 1.1,
  };
};
export function refreshConfig(cfg: FilterConfig): void {
  getConfig = () => cfg;
}
export function updateContext(ctx: Partial<ReplyContext>): void {
  if (ctx.oid) currentContext.oid = ctx.oid;
  if (ctx.videoTitle) currentContext.videoTitle = ctx.videoTitle;
  if (ctx.videoDesc) currentContext.videoDesc = ctx.videoDesc;
}

export function extractVideoInfo(): void {
  // 获取视频标题 - B站现在的页面结构
  const titleEl =
    document.querySelector("h1.video-title") ??
    document.querySelector(".video-info-title .tit") ??
    document.querySelector("[data-title]");
  if (titleEl) {
    currentContext.videoTitle =
      (titleEl as HTMLElement).dataset?.title ??
      titleEl.getAttribute("data-title") ??
      titleEl.getAttribute("title") ??
      titleEl.textContent?.trim() ??
      "";
  }

  // 获取视频简介
  const descEl =
    document.querySelector("#v_desc .desc-info-text") ??
    document.querySelector(".desc-info-text") ??
    document.querySelector(".basic-desc-info");
  if (descEl) {
    const t = descEl.textContent?.trim() ?? "";
    currentContext.videoDesc = t === "-" ? "" : t;
  }

  // 从 bili-comments 组件获取 oid
  const bc = document.querySelector("bili-comments");
  if (bc) {
    const p = bc.getAttribute("data-params");
    if (p) {
      const pts = p.split(",");
      if (pts.length >= 2) currentContext.oid = parseInt(pts[1]) || 0;
    }
  }

  // 从 __INITIAL_STATE__ 获取 aid
  if (!currentContext.oid) {
    try {
      for (const s of document.querySelectorAll("script")) {
        const m = (s.textContent ?? "").match(
          /window\.__INITIAL_STATE__\s*=\s*(\{.+?\});/,
        );
        if (m) {
          const data = JSON.parse(m[1]);
          const aid = data?.videoData?.aid ?? data?.aid;
          if (aid) {
            currentContext.oid = aid;
            break;
          }
        }
      }
    } catch {
      /* */
    }
  }

  // 从URL提取BV号 -> 可以后续用于API查询
  if (!currentContext.oid) {
    const bvMatch = location.pathname.match(/\/video\/(BV\w+)/);
  }
}

// ==================== 全页面诊断 ====================

function fullPageDiagnostic(): void {
  console.log(TAG, "══════ 诊断 ══════");

  // 1. 寻找 bili-comments web component
  const bc = document.querySelector("bili-comments");
  console.log(
    TAG,
    `📦 bili-comments: ${bc ? "✅ shadowRoot=" + !!bc.shadowRoot + " children=" + bc.children.length : "❌ 未找到"}`,
  );

  // 2. 寻找各种可能的评论区容器选择器
  const containerSelectors = [
    "#comment",
    "#commentapp",
    ".comment-container",
    ".reply-list",
    ".bb-comment",
    "[class*='comment']",
    "[class*='reply']",
    "[id*='comment']",
    "[id*='reply']",
  ];
  for (const sel of containerSelectors) {
    const els = document.querySelectorAll(sel);
    if (els.length > 0 && els.length < 200) {
      const first = els[0];
      const id = first.id ? `#${first.id}` : "(无id)";
      const cls = (first as Element).className
        ? "." + (first as Element).className.split(" ").slice(0, 3).join(".")
        : "(无class)";
      console.log(
        TAG,
        `  📌 "${sel}" → ${els.length}个 ${(first as Element).tagName.toLowerCase()}${id}${cls}`,
      );
    }
  }

  // 3. 🔍 ShadowRoot 深度探查
  if (bc && bc.shadowRoot) {
    const sr = bc.shadowRoot;
    const allNodes = sr.querySelectorAll("*");
    console.log(TAG, `🔬 ShadowRoot 总节点: ${allNodes.length}`);

    // 统计标签类型
    const tagCounts = new Map<string, number>();
    allNodes.forEach((n) => {
      const t = n.tagName.toLowerCase();
      tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    });
    console.log(
      TAG,
      `  标签分布: ${[...tagCounts.entries()].map(([k, v]) => `${k}x${v}`).join(", ")}`,
    );

    // 查找评论项
    const itemChecks = [
      "[data-rpid]",
      ".reply-item",
      ".comment-item",
      ".reply-wrap",
      ".con",
      "bb-comment",
    ];
    for (const sel of itemChecks) {
      const count = sr.querySelectorAll(sel).length;
      console.log(TAG, `  🎯 "${sel}" → ${count}个`);
    }

    // 打印 ShadowRoot 第一层子元素结构
    console.log(TAG, "📋 ShadowRoot 直接子元素:");
    for (const child of sr.children) {
      const tag = child.tagName.toLowerCase();
      const id = child.id ? `#${child.id}` : "";
      const cls = child.className
        ? "." + child.className.split(" ").slice(0, 3).join(".")
        : "";
      const text = (child as HTMLElement).innerText?.slice(0, 60) ?? "";
      const childCount = child.querySelectorAll("*").length;
      console.log(
        TAG,
        `  <${tag}${id}${cls}> 子元素:${childCount} text:"${text}"`,
      );

      // 如果子元素少，继续展开一层
      if (childCount > 0 && childCount <= 30) {
        for (const c2 of child.children) {
          const t2 = c2.tagName.toLowerCase();
          const id2 = c2.id ? `#${c2.id}` : "";
          const cls2 = c2.className
            ? "." + c2.className.split(" ").slice(0, 2).join(".")
            : "";
          const txt2 = (c2 as HTMLElement).innerText?.slice(0, 50) ?? "";
          // 检查 data-* 属性
          const dataAttrs =
            c2 instanceof HTMLElement
              ? c2
                  .getAttributeNames()
                  .filter((a) => a.startsWith("data-"))
                  .join(", ")
              : "";
          console.log(
            TAG,
            `    <${t2}${id2}${cls2}>${dataAttrs ? " [" + dataAttrs + "]" : ""} "${txt2}"`,
          );
        }
      }
    }
  }

  // 4. 页面主要结构
  const mainSections = [
    "#reply",
    "#danmakuBox",
    ".player-auxiliary",
    ".video-info-container",
    ".video-data",
    "section",
  ];
  console.log(TAG, "📐 页面结构:");
  for (const sel of mainSections) {
    const els = document.querySelectorAll(sel);
    if (els.length > 0) console.log(TAG, `  ${sel}: ${els.length}个`);
  }

  console.log(TAG, "══════ 完成 ══════");
}

/** 手动探查函数：调用后滚动到评论区加载评论，再执行此函数 */
function inspectShadowRoot(): void {
  const bc = document.querySelector("bili-comments");
  if (!bc || !bc.shadowRoot) {
    console.log(TAG, "❌ bili-comments 或其 shadowRoot 未找到");
    return;
  }
  const sr = bc.shadowRoot;
  console.log(TAG, "══════ ShadowRoot 完整探查 ══════");
  console.log(TAG, `总节点数: ${sr.querySelectorAll("*").length}`);
  console.log(TAG, `直接子元素数: ${sr.children.length}`);

  // 递归打印结构
  function dump(el: Element, depth: number = 0): void {
    if (depth > 4) return;
    const indent = "  ".repeat(depth);
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    const cls = el.className
      ? "." + el.className.split(" ").slice(0, 3).join(".")
      : "";
    const attrs =
      el instanceof HTMLElement
        ? el
            .getAttributeNames()
            .filter((a) => a !== "class" && a !== "id")
            .map((a) => `${a}="${el.getAttribute(a)}"`.slice(0, 60))
            .join(" ")
        : "";
    const text =
      (el as HTMLElement).innerText?.slice(0, 80)?.replace(/\n/g, " ") ?? "";
    console.log(TAG, `${indent}<${tag}${id}${cls}> ${attrs} "${text}"`);
    if (el.children.length <= 4) {
      for (const c of el.children) dump(c, depth + 1);
    } else if (depth < 3) {
      console.log(TAG, `${indent}  ... ${el.children.length}个子元素，取前4个`);
      for (let i = 0; i < Math.min(4, el.children.length); i++) {
        dump(el.children[i], depth + 1);
      }
    }
  }

  for (const child of sr.children) {
    dump(child, 0);
  }
  console.log(TAG, "══════ 探查完成 ══════");
}

// ==================== 评论扫描 & AI判定 ====================

interface PendingComment {
  el: Element;
  rpid: number;
  mid: number;
  uname: string;
  message: string;
}
let pendingBatch: PendingComment[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;
const scannedRpids = new Set<number>();

/** 已发现的评论区容器选择器(运行时学习) */
let learnedCommentContainer: string | null = null;

/**
 * 获取评论根节点
 * 优先 bili-comments Shadow DOM → bili-comments → 常用选择器 → null
 * 绝不 fallback 到 document，防止误伤页面其他元素
 */
function getCommentRoot(): ParentNode | null {
  // 1. bili-comments web component (含 Shadow DOM)
  const bc = document.querySelector("bili-comments");
  if (bc && bc.shadowRoot) return bc.shadowRoot;
  if (bc) return bc;

  // 2. 常见评论区容器选择器
  const containerSelectors = [
    "#comment",
    "#commentapp",
    ".comment-container",
    ".reply-list",
    ".bb-comment",
  ];
  for (const sel of containerSelectors) {
    const el = document.querySelector(sel);
    if (el && el.querySelectorAll("*").length > 5) return el;
  }

  // 3. 返回null = 找不到评论区，不扫描
  return null;
}

/**
 * 在指定的根节点内查找评论元素
 * 使用多种策略，从精确到启发式
 */
function findCommentElements(
  root: ParentNode,
): NodeListOf<Element> | Element[] {
  // 策略1: bili-comment-thread-renderer (B站新版评论区自定义元素)
  let items = root.querySelectorAll("bili-comment-thread-renderer");
  if (items.length > 0) return items;

  // 策略2: data-rpid
  items = root.querySelectorAll("[data-rpid]");
  if (items.length > 0) return items;

  // 策略3: 常见评论项CSS类
  items = root.querySelectorAll(
    ".reply-item, .comment-item, .comment-list > div, .reply-wrap, bb-comment",
  );
  if (items.length > 0) return items;

  // 策略4: 启发式
  const divs = root.querySelectorAll("div");
  if (divs.length > 500) return [];

  const candidates: Element[] = [];
  for (const d of divs) {
    if (candidates.length >= 100) break;
    const childCount = d.querySelectorAll("*").length;
    if (childCount < 3 || childCount > 80) continue;
    const t = (d as HTMLElement).innerText?.trim() ?? "";
    if (t.length < 30 || t.length > 5000) continue;
    if (!t.includes("回复") || !t.includes("举报")) continue;
    candidates.push(d);
  }
  return candidates;
}

function scanPage(): void {
  const root = getCommentRoot();
  if (!root) return;

  const items = findCommentElements(root);
  if (items.length === 0) return;

  let found = 0;
  items.forEach((el) => {
    const info = extractComment(el);
    if (!info) return;
    if (scannedRpids.has(info.rpid)) return;
    scannedRpids.add(info.rpid);
    found++;
    const config = getConfig();
    if (!config.enableAI && !config.enableBlacklist) return;
    pendingBatch.push(info);

    // 注入手动拉黑按钮
    injectManualBlacklistButton(el, info);
  });

  if (found > 0) {
    if (pendingBatch.length >= 20) flushBatch();
    else if (!batchTimer) batchTimer = setTimeout(flushBatch, 800);
  }
}

// ────────── 手动拉黑功能 ──────────

const blacklistButtonInjected = new WeakSet<Element>();

// 仿照 foldEl：兄弟节点插在 el 前面，float:right 贴右
function injectManualBlacklistButton(el: Element, info: PendingComment): void {
  if (blacklistButtonInjected.has(el)) return;
  blacklistButtonInjected.add(el);

  const parent = el.parentNode;
  if (!parent) return;

  const btn = document.createElement("span");
  btn.textContent = "🚫 拉黑";
  btn.title = "将 " + info.uname + " 加入黑名单";

  Object.assign(btn.style, {
    position: "relative",
    zIndex: "1",
    float: "right",
    marginTop: "4px",
    marginRight: "4px",
    padding: "1px 8px",
    fontSize: "11px",
    color: "#aaa",
    background: "rgba(255,255,255,0.88)",
    border: "1px solid #e0e0e0",
    borderRadius: "10px",
    cursor: "pointer",
    userSelect: "none",
    fontFamily: "system-ui, -apple-system, sans-serif",
    lineHeight: "18px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    transition: "color 0.15s, border-color 0.15s, background 0.15s, box-shadow 0.15s",
  });

  btn.addEventListener("mouseenter", () => {
    if (btn.dataset.done === "1") return;
    Object.assign(btn.style, {
      color: "#d9534f",
      borderColor: "#d9534f",
      background: "#fff5f5",
      boxShadow: "0 1px 4px rgba(217,83,79,0.15)",
    });
  });
  btn.addEventListener("mouseleave", () => {
    if (btn.dataset.done === "1") return;
    Object.assign(btn.style, {
      color: "#aaa",
      borderColor: "#e0e0e0",
      background: "rgba(255,255,255,0.88)",
      boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    });
  });

  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (!confirm("确定要将用户 \"" + info.uname + "\" 加入黑名单吗？\n该用户的所有评论将被隐藏。")) return;

    try {
      const config = getConfig();
      await addToBlacklist({
        mid: info.mid, uname: info.uname, rpid: info.rpid, message: info.message,
        reason: "[手动拉黑]", videoTitle: currentContext.videoTitle,
        videoUrl: window.location.href, timestamp: Date.now(),
        severity: "block", source: "manual",
      });
      console.log(TAG, "🚫 手动拉黑: " + info.uname);

      if (config.foldMode) {
        foldEl(el, info, { reason: "[手动拉黑]", severity: "block" });
      } else {
        hideEl(el);
      }

      btn.dataset.done = "1";
      btn.textContent = "✅ 已拉黑";
      Object.assign(btn.style, {
        color: "#d9534f",
        borderColor: "#f5c6cb",
        background: "#fff0f0",
        boxShadow: "none",
        cursor: "default",
      });
    } catch (err) {
      console.error(TAG, "❌ 手动拉黑失败:", err);
    }
  });

  parent.insertBefore(btn, el);
}

/** 从 DOM 节点提取评论信息 */
function extractComment(el: Element): PendingComment | null {
  try {
    const tag = el.tagName.toLowerCase();

    // 递归获取所有嵌套 shadowRoot 的 innerText（跳过style标签）
    function deepInnerText(root: ParentNode): string {
      let text = "";
      for (const child of root.children) {
        const el = child as Element;
        const tag = el.tagName.toLowerCase();
        // 跳过 style 标签
        if (tag === "style") continue;
        // 如果子元素有 shadowRoot，递归进入
        if (el.shadowRoot) {
          text += deepInnerText(el.shadowRoot) + "\n";
        } else if (el.children.length > 0) {
          text += deepInnerText(el) + "\n";
        } else {
          const t = (el as HTMLElement).innerText?.trim();
          if (t) text += t + "\n";
        }
      }
      return text;
    }

    // 从元素本身或 shadowRoot 读取文本
    let fullText = "";
    if (el.shadowRoot) {
      fullText = deepInnerText(el.shadowRoot).trim();
    }
    if (!fullText) {
      fullText = (el as HTMLElement).innerText?.trim() ?? "";
    }

    if (fullText.length < 3) return null;

    // 1. 提取 rpid - 递归搜索所有nested shadowRoot
    let rpid = 0;
    function findRpid(root: ParentNode): string | null {
      const el = root.querySelector("[data-rpid]");
      if (el) return el.getAttribute("data-rpid");
      for (const child of root.children) {
        const c = child as Element;
        if (c.shadowRoot) {
          const r = findRpid(c.shadowRoot);
          if (r) return r;
        }
      }
      return null;
    }
    const rpidStr =
      el.getAttribute("data-rpid") ??
      (el.shadowRoot ? findRpid(el.shadowRoot) : null);
    if (rpidStr) rpid = parseInt(rpidStr);
    // fallback: 用评论内容+用户名生成稳定hash（因为新版B站Shadow DOM不暴露data-rpid）
    if (!rpid) {
      const hashInput = `${tag}:${fullText.slice(0, 300)}`;
      rpid = strHash(hashInput);
    }

    // 2. 提取 mid
    let mid = 0;
    function findMid(root: ParentNode): string | null {
      const el = root.querySelector("[data-mid], [data-uid]");
      if (el) return el.getAttribute("data-mid") ?? el.getAttribute("data-uid");
      for (const child of root.children) {
        const c = child as Element;
        if (c.shadowRoot) {
          const r = findMid(c.shadowRoot);
          if (r) return r;
        }
      }
      return null;
    }
    const midStr =
      el.getAttribute("data-mid") ??
      el.getAttribute("data-uid") ??
      (el.shadowRoot ? findMid(el.shadowRoot) : null);
    if (midStr) mid = parseInt(midStr) || 0;

    // 3. 解析用户名和内容
    const lines = fullText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const contentLines = lines.filter((l) => {
      if (IGNORE_TEXTS.has(l)) return false;
      if (isUIText(l)) return false;
      return true;
    });

    if (contentLines.length === 0) return null;

    const uname =
      contentLines.find(
        (l) =>
          l.length >= 2 &&
          l.length <= 20 &&
          !/^\d/.test(l) &&
          !l.includes("·") &&
          !l.includes("分钟") &&
          !l.includes("小时") &&
          !l.includes("刚刚") &&
          !l.includes("昨天"),
      ) ?? "未知用户";

    const msgParts = contentLines.filter(
      (l) => l !== uname || contentLines.filter((x) => x === l).length > 1,
    );
    let message = msgParts.join(" ");

    if (uname !== "未知用户" && message.startsWith(uname)) {
      message = message.slice(uname.length).trim();
    }

    if (!message || message.length < 2) return null;

    return { el, rpid, mid, uname, message };
  } catch (e) {
    console.warn(TAG, "  ❌ extractComment 异常:", e);
    return null;
  }
}

/** 需要从评论文本中过滤掉的B站UI文本 */
const IGNORE_TEXTS = new Set([
  "回复",
  "举报",
  "点赞",
  "踩",
  "收起",
  "展开",
  "·",
  ">>",
  "查看全文",
  "热评",
  "置顶",
  "UP主",
  "笔记",
  "UP主觉得很赞",
  "UP主赞过",
  "发起会话",
  "关注",
  "已关注",
  "复制评论链接",
  "加入黑名单",
  "记笔记",
]);

/** 需要过滤的时间/数字模式 */
function isUIText(s: string): boolean {
  // 纯数字/楼层/点赞数
  if (/^(\d+|[\d.]+[万亿]?|\d+:\d+|\d+楼|#\d+)$/.test(s)) return true;
  // 日期时间 "2026-02-12 15:26"
  if (/^\d{4}-\d{2}-\d{2}\s*\d{2}:\d{2}$/.test(s)) return true;
  // "刚刚" "X分钟前" "X小时前" "昨天" "X天前"
  if (/^(刚刚|\d+分钟前|\d+小时前|昨天|\d+天前)$/.test(s)) return true;
  // 纯标签/徽章 (如 "CD" "001313" 这种短数字字母组合，通常是UP主的标签)
  // 太短的忽略
  return false;
}

function hashEl(el: Element): number {
  const t = (el as HTMLElement).innerText?.slice(0, 200) ?? el.tagName;
  return strHash(t);
}

/** 简单字符串hash (djb2) - 返回正整数 */
function strHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) & 0x7fffffff;
  }
  return h;
}

let isFlushing = false;

async function flushBatch(): Promise<void> {
  if (batchTimer) {
    clearTimeout(batchTimer);
    batchTimer = null;
  }
  if (pendingBatch.length === 0 || isFlushing) return;
  isFlushing = true;

  const batch = pendingBatch.splice(0);

  console.log(TAG, `🚀 AI判定: ${batch.length} 条评论`);

  const config = getConfig();
  if (!currentContext.videoTitle) extractVideoInfo();

  const replies: BiliReply[] = batch.map((p) => ({
    rpid: p.rpid,
    oid: currentContext.oid,
    mid: p.mid,
    root: 0,
    parent: 0,
    count: 0,
    rcount: 0,
    like: 0,
    ctime: 0,
    content: { message: p.message },
    member: { mid: String(p.mid), uname: p.uname, avatar: "" },
  }));

  try {
    const result = await filterReplies(
      config,
      replies,
      currentContext,
      ruozhiStats,
    );
    if (result.violations.size > 0) {
      console.log(TAG, `🛡️ ${result.violations.size}/${batch.length} 条违规`);
      let cleaned = 0;
      for (const [rpid, v] of result.violations) {
        const p = batch.find((x) => x.rpid === rpid);
        if (!p) continue;
        if (config.foldMode ? foldEl(p.el, p, v) : hideEl(p.el)) cleaned++;
      }

      // 更新UI
      try {
        updateStats(ruozhiStats);
      } catch {
        /* */
      }
    } else {
      try {
        updateStats(ruozhiStats);
      } catch {
        /* */
      }
    }
  } catch (err) {
    console.error(TAG, "❌ AI失败:", err);
  } finally {
    isFlushing = false;
  }
}

function foldEl(
  el: Element,
  info: PendingComment,
  verdict: { reason: string; severity: string },
): boolean {
  try {
    const labelMap: Record<string, string> = {
      low: "⚠️ 轻微不适",
      medium: "🚫 违规言论",
      high: "⛔ 严重违规",
      block: "🛑 永久拉黑",
    };
    const label = labelMap[verdict.severity] ?? "🚫 已过滤";
    const html = `<div class="ruozhi-folded" style="background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:8px 12px;margin:4px 0;font-size:13px;color:#856404;cursor:pointer;user-select:none;font-family:system-ui,sans-serif">
<span style="margin-right:8px">${label}</span><span style="font-weight:600">${esc(info.uname)}</span><span style="margin:0 8px;color:#ccc">|</span><span style="font-size:12px;color:#aaa">${esc(verdict.reason)}</span><span style="float:right;font-size:11px;color:#999">▼ 展开</span>
</div><div class="ruozhi-original" style="display:none;padding:8px 12px;background:#f8f9fa;border-left:3px solid #ffc107;margin:4px 0;border-radius:0 6px 6px 0;font-size:13px">
<div style="margin-bottom:6px;font-size:12px;color:#999">🧠 AI判定: <strong>${esc(verdict.reason)}</strong></div>
<div style="color:#333;white-space:pre-wrap;word-break:break-word">${esc(info.message)}</div></div>`;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    const foldElDiv = wrapper.firstElementChild as HTMLElement;
    const origElDiv = foldElDiv.nextElementSibling as HTMLElement;
    el.parentNode?.insertBefore(foldElDiv, el);
    el.parentNode?.insertBefore(origElDiv, el);
    (el as HTMLElement).style.display = "none";
    foldElDiv.addEventListener("click", () => {
      const hidden = origElDiv.style.display === "none";
      origElDiv.style.display = hidden ? "block" : "none";
      const spanEl = foldElDiv.querySelector("span:last-child");
      if (spanEl) spanEl.textContent = hidden ? "▲ 收起" : "▼ 展开";
    });
    return true;
  } catch {
    return false;
  }
}

function hideEl(el: Element): boolean {
  try {
    (el as HTMLElement).style.display = "none";
    return true;
  } catch {
    return false;
  }
}

function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// ==================== MutationObserver: 监听新评论加载 ====================

function watchNewComments(): void {
  const root = getCommentRoot();
  if (!root) {
    setTimeout(() => watchNewComments(), 3000);
    return;
  }

  const observer = new MutationObserver(() => {
    if (!batchTimer) {
      batchTimer = setTimeout(() => {
        scanPage();
        batchTimer = null;
      }, 500);
    }
  });

  observer.observe(root as unknown as Node, {
    childList: true,
    subtree: true,
  });
  console.log(TAG, "👁️ MutationObserver 已绑定到评论根节点");
}

// ==================== 滚动加载检测 ====================

function watchScrollLoading(): void {
  // B站评论区滚动到底部时会加载更多评论
  // 监听滚动事件，在滚动停止后触发扫描
  let scrollTimer: ReturnType<typeof setTimeout> | null = null;

  window.addEventListener(
    "scroll",
    () => {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        scanPage();
        // 如果还有待处理，立即刷
        if (pendingBatch.length >= 10) flushBatch();
      }, 600);
    },
    { passive: true },
  );
}

// ==================== 启动 ====================

export function startDOMScanner(): void {
  // 初始扫描
  setTimeout(() => scanPage(), 4000);
  setTimeout(() => scanPage(), 8000);

  // 周期性扫描 (每5秒)
  setInterval(() => {
    scanPage();
    if (pendingBatch.length >= 10) flushBatch();
  }, 5000);

  // 监听DOM变化
  setTimeout(() => watchNewComments(), 2000);

  // 监听滚动加载
  watchScrollLoading();

  // 暴露调试接口
  const uw =
    typeof unsafeWindow !== "undefined" ? unsafeWindow : (window as any);
  uw.__ruozhi_diag = () => {
    fullPageDiagnostic();
    scanPage();
  };
  uw.__ruozhi_scan = () => scanPage();
  uw.__ruozhi_flush = () => flushBatch();
  uw.__ruozhi_inspect = () => inspectShadowRoot();
}
