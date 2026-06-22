// ============================================================
// comment-extractor.ts - 从 DOM 节点提取评论信息
// ============================================================
import { strHash } from "./dom-utils";
import { warn } from "./debug";

/** 等待批处理的评论 */
export interface PendingComment {
  el: Element;
  rpid: number;
  mid: number;
  uname: string;
  message: string;
}

/** 需要从评论文本中过滤掉的B站UI文本 */
const IGNORE_TEXTS = new Set([
  "回复",
  "举报",
  "硬核会员举报",
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
  // "共X条回复" "展开X条回复" 等
  if (/^(共\s*\d+\s*条回复|展开\s*\d+\s*条回复|查看全部\s*\d+\s*条)$/.test(s))
    return true;
  // 纯标签/徽章
  return false;
}

/** 从 DOM 节点提取评论信息 */
export function extractComment(el: Element): PendingComment | null {
  try {
    const tag = el.tagName.toLowerCase();

    // 递归获取所有嵌套 shadowRoot 的 innerText（跳过style标签和子回复容器）
    function deepInnerText(root: ParentNode): string {
      let text = "";
      for (const child of root.children) {
        const el = child as Element;
        const tag = el.tagName.toLowerCase();
        // 跳过 style 标签
        if (tag === "style") continue;
        // 跳过子回复嵌套 (b站嵌套回复通常有这些特征)
        // - "-reply" 匹配 bili-comment-reply-renderer
        // - "-replies" 匹配 bili-comment-replies-renderer（"replies" ≠ "reply" 子串）
        const cls = String(
          (el as HTMLElement).className || el.getAttribute("class") || "",
        ).toLowerCase();
        if (
          cls.includes("sub-reply") ||
          cls.includes("reply-item") ||
          cls.includes("fan") ||
          cls.includes("medal") ||
          tag.includes("-reply") ||
          tag.includes("-replies")
        )
          continue;
        // 跳过 B 站评论区操作按钮/UI 元素（举报、回复、点赞等按钮文本不应混入评论内容）
        if (
          cls.includes("report") ||
          cls.includes("operation") ||
          cls.includes("btn") ||
          cls.includes("action") ||
          tag === "button"
        )
          continue;
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
      const el = root.querySelector(
        "[data-mid], [data-uid], [data-user-profile-id]",
      );
      if (el)
        return (
          el.getAttribute("data-mid") ??
          el.getAttribute("data-uid") ??
          el.getAttribute("data-user-profile-id")
        );
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
      el.getAttribute("data-user-profile-id") ??
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

    // 去掉尾部 "共X条回复" (不是独立行，拼在评论后面的)
    message = message.replace(/\s*共\s*\d+\s*条回复[，,.]?\s*$/g, "").trim();

    if (uname !== "未知用户" && message.startsWith(uname)) {
      message = message.slice(uname.length).trim();
    }
    // ★ 只拒绝完全空的消息，单字评论（如"区"）应能被提取并交给AI判定
    if (!message || message.length < 1) return null;

    return { el, rpid, mid, uname, message };
  } catch (e) {
    warn("[ruozhi-filter]", "  extractComment 异常:", e);
    return null;
  }
}
