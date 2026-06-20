// ============================================================
// manual-blacklist.ts - 手动拉黑按钮注入
// ============================================================
import type { PendingComment } from "./comment-extractor";
import { getConfig, currentContext } from "./config";
import { addToBlacklist } from "./db";
import { hideEl, foldEl } from "./fold-ui";
import { log } from "./debug";

const TAG = "[ruozhi-filter]";

/** 已注入拉黑按钮的元素集合（避免重复注入） */
const blacklistButtonInjected = new WeakSet<Element>();

/** 按钮样式（inline-block兄弟节点，始终可见） */
const BL_BTN_STYLE: Record<string, string> = {
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
  whiteSpace: "nowrap",
  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
  transition:
    "color 0.15s, border-color 0.15s, background 0.15s, box-shadow 0.15s",
};

const BL_BTN_HOVER: Record<string, string> = {
  color: "#d9534f",
  borderColor: "#d9534f",
  background: "#fff5f5",
};

const BL_BTN_DONE: Record<string, string> = {
  color: "#d9534f",
  borderColor: "#f5c6cb",
  background: "#fff0f0",
  boxShadow: "none",
  cursor: "default",
  pointerEvents: "none",
};

function applyStyles(el: HTMLElement, styles: Record<string, string>): void {
  Object.assign(el.style, styles);
}

/**
 * 注入手动拉黑按钮：作为 el 的兄弟节点（span inline-block）。
 * 不能作为子节点——bili-comment-thread-renderer 的 Shadow DOM 无 slot，
 * light DOM 子节点不会渲染。
 */
export function injectManualBlacklistButton(
  el: Element,
  info: PendingComment,
): void {
  if (blacklistButtonInjected.has(el)) return;
  blacklistButtonInjected.add(el);

  const parent = el.parentNode;
  if (!parent) return;

  // ── 拉黑按钮（span 小药丸，始终可见） ──
  const btn = document.createElement("span");
  btn.textContent = "🚫 拉黑";
  btn.title = `将 ${info.uname} 加入黑名单`;
  applyStyles(btn, BL_BTN_STYLE);

  // 插入为 el 的前一个兄弟节点（float:right 会显示在头像另一侧）
  parent.insertBefore(btn, el);

  // 用 dataset.done 追踪状态
  btn.addEventListener("mouseenter", () => {
    if (btn.dataset.done !== "1") applyStyles(btn, BL_BTN_HOVER);
  });
  btn.addEventListener("mouseleave", () => {
    if (btn.dataset.done !== "1") applyStyles(btn, BL_BTN_STYLE);
  });

  // ── 点击拉黑 ──
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    e.preventDefault();

    const config = getConfig();

    // 除非用户显式关闭确认，否则弹出确认框
    if (
      config.blacklistConfirm !== false &&
      !confirm(
        `确定要将用户 "${info.uname}" 加入黑名单吗？\n该用户的所有评论将被隐藏。`,
      )
    ) {
      return;
    }

    try {
      await addToBlacklist({
        mid: info.mid,
        uname: info.uname,
        rpid: info.rpid,
        message: info.message,
        reason: "[手动拉黑]",
        videoTitle: currentContext.videoTitle,
        videoUrl: window.location.href,
        timestamp: Date.now(),
        severity: "block",
        source: "manual",
      });

      log(TAG, `🚫 手动拉黑: ${info.uname}`);

      if (config.foldMode === "none") {
        hideEl(el);
      } else {
        foldEl(
          el,
          info,
          { reason: "[手动拉黑]", severity: "block" },
          config.foldMode,
        );
      }

      btn.dataset.done = "1";
      btn.textContent = "✅ 已拉黑";
      applyStyles(btn, BL_BTN_DONE);
    } catch (err) {
      console.error(TAG, "❌ 手动拉黑失败:", err);
    }
  });
}
