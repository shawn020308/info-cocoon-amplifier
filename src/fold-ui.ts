// ============================================================
// fold-ui.ts - 评论折叠/隐藏 UI 操作
// ============================================================
import { esc } from "./dom-utils";
import type { PendingComment } from "./comment-extractor";
import { triggerReport, copyReason } from "./report";
import {
  removeFromBlacklist,
  isBlacklistedSync,
  deleteCommentFromCache,
  commentHash,
} from "./db";

const TAG = "[ruozhi-filter]";

/** 折叠评论元素，显示折叠提示条 */
export function foldEl(
  el: Element,
  info: PendingComment,
  verdict: { reason: string; severity: string },
  style: "classic" | "light" | "dim" = "classic",
): boolean {
  try {
    // 防止重复折叠（元素已被隐藏说明已处理过）
    if ((el as HTMLElement).style.display === "none") return false;

    const labelMap: Record<string, string> = {
      low: "⚠️ 轻微不适",
      medium: "🚫 违规言论",
      high: "⛔ 严重违规",
      block: "🛑 永久拉黑",
    };
    const label = labelMap[verdict.severity] ?? "🚫 已过滤";

    const severityAccent: Record<string, string> = {
      low: "#c8c8c8",
      medium: "#d4a574",
      high: "#d47574",
      block: "#b87070",
    };
    const accent = severityAccent[verdict.severity] ?? "#ccc";

    // medium 及以上显示举报按钮
    const showReportBtn =
      verdict.severity === "medium" ||
      verdict.severity === "high" ||
      verdict.severity === "block";
    const reportBtnsHTML = showReportBtn
      ? `<div style="margin-top:8px;display:flex;gap:8px">
  <button class="ruozhi-copy-reason" style="padding:3px 10px;font-size:12px;border:1px solid #d4a574;border-radius:4px;background:#fff;color:#d4a574;cursor:pointer">📋 复制理由</button>
  <button class="ruozhi-report-btn" style="padding:3px 10px;font-size:12px;border:1px solid #d47574;border-radius:4px;background:#fff;color:#d47574;cursor:pointer">🚨 举报此评论</button>
</div>`
      : "";

    const html = (() => {
      switch (style) {
        case "classic":
          return `<div class="ruozhi-folded" style="background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:8px 12px;margin:4px 0;font-size:13px;color:#856404;cursor:pointer;user-select:none;font-family:system-ui,sans-serif">
<span style="margin-right:8px">${label}</span><span style="font-weight:600">${esc(info.uname)}</span><span style="margin:0 8px;color:#ccc">|</span><span style="font-size:12px;color:#aaa">${esc(verdict.reason)}</span><span class="ruozhi-fold-arrow" data-collapsed="▼ 展开" data-expanded="▲ 收起" style="float:right;font-size:11px;color:#999">▼ 展开</span>
</div><div class="ruozhi-original" style="display:none;padding:8px 12px;background:#f8f9fa;border-left:3px solid #ffc107;margin:4px 0;border-radius:0 6px 6px 0;font-size:13px">
<div style="margin-bottom:6px;font-size:12px;color:#999">🧠 AI判定: <strong>${esc(verdict.reason)}</strong></div>
<div style="color:#333;white-space:pre-wrap;word-break:break-word">${esc(info.message)}</div>${reportBtnsHTML}</div>`;
        case "dim":
          return `<div class="ruozhi-folded" style="padding:1px 8px;margin:1px 0;font-size:9px;color:#ddd;cursor:pointer;user-select:none;font-family:system-ui,sans-serif;line-height:1.2;transition:color .15s,background .15s;border-radius:4px"
  onmouseenter="this.style.color='#bbb';this.style.background='#fafafa'" onmouseleave="this.style.color='#ddd';this.style.background='transparent'">
<span style="opacity:0.6">···</span>
</div><div class="ruozhi-original" style="display:none;padding:4px 8px;margin:0 0 2px 0;font-size:11px;color:#bbb;background:#fafafa;border-left:2px solid #eee;border-radius:0 4px 4px 0">
<div style="margin-bottom:2px;font-size:10px;color:#ccc">${esc(verdict.reason)}</div>
<div style="color:#bbb;white-space:pre-wrap;word-break:break-word">${esc(info.message)}</div>${reportBtnsHTML}</div>`;
        default: // light
          return `<div class="ruozhi-folded" style="background:#fafafa;border-left:3px solid ${accent};padding:6px 12px;margin:4px 0;font-size:12px;color:#aaa;cursor:pointer;user-select:none;font-family:system-ui,sans-serif">
<span style="margin-right:6px">${label}</span><span style="color:#999">${esc(info.uname)}</span><span class="ruozhi-fold-arrow" data-collapsed="▾" data-expanded="▴" style="float:right;font-size:10px;color:#ccc">▾</span>
</div><div class="ruozhi-original" style="display:none;padding:6px 12px;background:#fafafa;border-left:3px solid #ddd;margin:0 0 4px 0;font-size:12px;color:#999">
<div style="margin-bottom:4px;font-size:11px;color:#bbb">AI判定: ${esc(verdict.reason)}</div>
<div style="color:#bbb;white-space:pre-wrap;word-break:break-word">${esc(info.message)}</div>${reportBtnsHTML}</div>`;
      }
    })();

    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    const foldElDiv = wrapper.firstElementChild as HTMLElement;
    const origElDiv = foldElDiv.nextElementSibling as HTMLElement;
    el.parentNode?.insertBefore(foldElDiv, el);
    el.parentNode?.insertBefore(origElDiv, el);
    (el as HTMLElement).style.display = "none";

    // ── 折叠条点击：展开/收起 ──
    foldElDiv.addEventListener("click", () => {
      const collapsed = origElDiv.style.display === "none";
      origElDiv.style.display = collapsed ? "block" : "none";
      const arrow = foldElDiv.querySelector(
        ".ruozhi-fold-arrow",
      ) as HTMLElement | null;
      if (arrow) {
        arrow.textContent = collapsed
          ? (arrow.dataset.expanded ?? arrow.textContent)
          : (arrow.dataset.collapsed ?? arrow.textContent);
      }
    });

    // ── 恢复按钮：黑名单→取消拉黑；AI误判→误判展开（互斥）──
    const blRecord = isBlacklistedSync(info.mid, info.uname);
    if (blRecord) {
      origElDiv.insertAdjacentHTML(
        "beforeend",
        `<div style="margin-top:8px;display:flex;gap:8px">
  <button class="ruozhi-unblock-btn" style="padding:3px 10px;font-size:12px;border:1px solid #28a745;border-radius:4px;background:#fff;color:#28a745;cursor:pointer">↩️ 取消拉黑</button>
</div>`,
      );
      origElDiv
        .querySelector(".ruozhi-unblock-btn")
        ?.addEventListener("click", async (e) => {
          e.stopPropagation();
          try {
            const hash = commentHash(info.message, info.mid);
            await removeFromBlacklist(blRecord.mid);
            // ★ 同时清除该评论的缓存，防止快速路径再次折叠
            await deleteCommentFromCache(hash);
            (el as HTMLElement).style.display = "";
            foldElDiv.remove();
            origElDiv.remove();
          } catch (err) {
            console.error(TAG, "❌ 取消拉黑失败:", err);
          }
        });
    } else {
      origElDiv.insertAdjacentHTML(
        "beforeend",
        `<div style="margin-top:8px;display:flex;gap:8px">
  <button class="ruozhi-misjudge-btn" style="padding:3px 10px;font-size:12px;border:1px solid #17a2b8;border-radius:4px;background:#fff;color:#17a2b8;cursor:pointer">✅ 误判，展开</button>
</div>`,
      );
      origElDiv
        .querySelector(".ruozhi-misjudge-btn")
        ?.addEventListener("click", async (e) => {
          e.stopPropagation();
          const hash = commentHash(info.message, info.mid);
          // ★ 删除缓存中的违规记录，防止快速路径再次折叠
          await deleteCommentFromCache(hash);
          (el as HTMLElement).style.display = "";
          foldElDiv.remove();
          origElDiv.remove();
        });
    }

    // ── 举报按钮绑定（展开区）──
    if (showReportBtn) {
      origElDiv
        .querySelector(".ruozhi-copy-reason")
        ?.addEventListener("click", (e) => {
          e.stopPropagation();
          copyReason(verdict.reason);
        });

      origElDiv
        .querySelector(".ruozhi-report-btn")
        ?.addEventListener("click", (e) => {
          e.stopPropagation();
          triggerReport(el, verdict.reason);
        });
    }

    return true;
  } catch {
    return false;
  }
}

/** 直接隐藏评论元素 */
export function hideEl(el: Element): boolean {
  try {
    (el as HTMLElement).style.display = "none";
    return true;
  } catch {
    return false;
  }
}
