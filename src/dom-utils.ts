// ============================================================
// dom-utils.ts - DOM 工具函数
// ============================================================

const TAG = "[ruozhi-filter]";

/** 简单字符串hash (djb2) - 返回正整数 */
export function strHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) & 0x7fffffff;
  }
  return h;
}

/** 根据元素内容生成 hash */
export function hashEl(el: Element): number {
  const t = (el as HTMLElement).innerText?.slice(0, 200) ?? el.tagName;
  return strHash(t);
}

/** HTML 转义 */
export function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

/**
 * 获取评论根节点
 * 优先 bili-comments Shadow DOM → bili-comments → 常用选择器 → null
 * 绝不 fallback 到 document，防止误伤页面其他元素
 */
export function getCommentRoot(): ParentNode | null {
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
export function findCommentElements(
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
