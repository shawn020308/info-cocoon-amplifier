// ============================================================
// fold-ui.ts - 评论折叠/隐藏 UI 操作
// ============================================================
import { esc } from "./dom-utils";
import type { PendingComment } from "./comment-extractor";
import { triggerReport, copyReason } from "./report";
import { removeFromBlacklist, isBlacklistedSync } from "./db";

const TAG = "[ruozhi-filter]";

/** 折叠评论元素，显示折叠提示条 */
export function foldEl(
  el: Element,
  info: PendingComment,
  verdict: { reason: string; severity: string },
  style: "classic" | "light" | "dim" = "classic",
): boolean {
  try {
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
    // 折叠条上的一键举报按钮（无需展开）
    const foldedReportBtnHTML = showReportBtn
      ? `<span class="ruozhi-report-btn" style="display:inline-flex;align-items:center;gap:2px;margin:0 6px;padding:1px 6px;font-size:11px;border:1px solid #d47574;border-radius:3px;background:#fff;color:#d47574;cursor:pointer;user-select:none">🚨举报</span>`
      : "";
    const reportBtnsHTML = showReportBtn
      ? `<div style="margin-top:8px;display:flex;gap:8px">
  <button class="ruozhi-copy-reason" style="padding:3px 10px;font-size:12px;border:1px solid #d4a574;border-radius:4px;background:#fff;color:#d4a574;cursor:pointer">📋 复制理由</button>
  <button class="ruozhi-report-btn" style="padding:3px 10px;font-size:12px;border:1px solid #d47574;border-radius:4px;background:#fff;color:#d47574;cursor:pointer">🚨 举报此评论</button>
</div>`
      : "";

    // 误判按钮：所有被折叠的评论都显示，让用户一键撤销
    const foldedMisjudgeBtnHTML =
      '<span class="ruozhi-misjudge-btn" style="display:inline-flex;align-items:center;gap:2px;margin:0 6px;padding:1px 6px;font-size:11px;border:1px solid #17a2b8;border-radius:3px;background:#fff;color:#17a2b8;cursor:pointer;user-select:none">✅误判</span>';
    const misjudgeBtnHTML =
      '<button class="ruozhi-misjudge-btn" style="padding:3px 10px;font-size:12px;border:1px solid #17a2b8;border-radius:4px;background:#fff;color:#17a2b8;cursor:pointer">✅ 误判，展开</button>';

    const html = (() => {
      switch (style) {
        case "classic":
          return `<div class="ruozhi-folded" style="background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:8px 12px;margin:4px 0;font-size:13px;color:#856404;cursor:pointer;user-select:none;font-family:system-ui,sans-serif">
<span style="margin-right:8px">${label}</span><span style="font-weight:600">${esc(info.uname)}</span><span style="margin:0 8px;color:#ccc">|</span><span style="font-size:12px;color:#aaa">${esc(verdict.reason)}</span>${foldedMisjudgeBtnHTML}${foldedReportBtnHTML}<span class="ruozhi-fold-arrow" data-collapsed="▼ 展开" data-expanded="▲ 收起" style="float:right;font-size:11px;color:#999">▼ 展开</span>
</div><div class="ruozhi-original" style="display:none;padding:8px 12px;background:#f8f9fa;border-left:3px solid #ffc107;margin:4px 0;border-radius:0 6px 6px 0;font-size:13px">
<div style="margin-bottom:6px;font-size:12px;color:#999">🧠 AI判定: <strong>${esc(verdict.reason)}</strong></div>
<div style="color:#333;white-space:pre-wrap;word-break:break-word">${esc(info.message)}</div>${reportBtnsHTML}<div style="margin-top:8px">${misjudgeBtnHTML}</div></div>`;
        case "dim":
          return `<div class="ruozhi-folded" style="padding:1px 8px;margin:1px 0;font-size:9px;color:#ddd;cursor:pointer;user-select:none;font-family:system-ui,sans-serif;line-height:1.2;transition:color .15s,background .15s;border-radius:4px"
  onmouseenter="this.style.color='#bbb';this.style.background='#fafafa'" onmouseleave="this.style.color='#ddd';this.style.background='transparent'">
<span style="opacity:0.6">···</span>${foldedMisjudgeBtnHTML}${foldedReportBtnHTML}
</div><div class="ruozhi-original" style="display:none;padding:4px 8px;margin:0 0 2px 0;font-size:11px;color:#bbb;background:#fafafa;border-left:2px solid #eee;border-radius:0 4px 4px 0">
<div style="margin-bottom:2px;font-size:10px;color:#ccc">${esc(verdict.reason)}</div>
<div style="color:#bbb;white-space:pre-wrap;word-break:break-word">${esc(info.message)}</div>${reportBtnsHTML}<div style="margin-top:4px">${misjudgeBtnHTML}</div></div>`;
        default: // light
          return `<div class="ruozhi-folded" style="background:#fafafa;border-left:3px solid ${accent};padding:6px 12px;margin:4px 0;font-size:12px;color:#aaa;cursor:pointer;user-select:none;font-family:system-ui,sans-serif">
<span style="margin-right:6px">${label}</span><span style="color:#999">${esc(info.uname)}</span>${foldedMisjudgeBtnHTML}${foldedReportBtnHTML}<span class="ruozhi-fold-arrow" data-collapsed="▾" data-expanded="▴" style="float:right;font-size:10px;color:#ccc">▾</span>
</div><div class="ruozhi-original" style="display:none;padding:6px 12px;background:#fafafa;border-left:3px solid #ddd;margin:0 0 4px 0;font-size:12px;color:#999">
<div style="margin-bottom:4px;font-size:11px;color:#bbb">AI判定: ${esc(verdict.reason)}</div>
<div style="color:#bbb;white-space:pre-wrap;word-break:break-word">${esc(info.message)}</div>${reportBtnsHTML}<div style="margin-top:6px">${misjudgeBtnHTML}</div></div>`;
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

    // ── 误判按钮绑定（所有被折叠评论）──
    const doMisjudge = (e: Event) => {
      e.stopPropagation();
      if (!confirm("确定认为这是误判吗？评论将恢复显示。")) return;
      (el as HTMLElement).style.display = "";
      foldElDiv.remove();
      origElDiv.remove();
    };

    const foldedMisjudgeBtn = foldElDiv.querySelector(".ruozhi-misjudge-btn");
    foldedMisjudgeBtn?.addEventListener("click", doMisjudge);

    const expandedMisjudgeBtn = origElDiv.querySelector(".ruozhi-misjudge-btn");
    expandedMisjudgeBtn?.addEventListener("click", doMisjudge);

    // ── 举报按钮绑定 ──
    if (showReportBtn) {
      // 折叠条上的一键举报按钮
      const foldedReportBtn = foldElDiv.querySelector(".ruozhi-report-btn");
      foldedReportBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        triggerReport(el, verdict.reason);
      });

      // 展开后的详细操作按钮
      const copyBtn = origElDiv.querySelector(".ruozhi-copy-reason");
      const reportBtn = origElDiv.querySelector(".ruozhi-report-btn");

      copyBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        copyReason(verdict.reason);
      });

      reportBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        triggerReport(el, verdict.reason);
      });
    }

    // ── 取消拉黑按钮（仅黑名单中的评论显示）──
    const blRecord = isBlacklistedSync(info.mid, info.uname);
    if (blRecord) {
      const unblockBtnHTML =
        '<button class="ruozhi-unblock-btn" style="padding:3px 10px;font-size:12px;border:1px solid #28a745;border-radius:4px;background:#fff;color:#28a745;cursor:pointer">↩️ 取消拉黑</button>';

      // 折叠条上：在展开箭头前插入
      const foldedUnblock = document.createElement("span");
      foldedUnblock.innerHTML =
        '<span class="ruozhi-unblock-btn" style="display:inline-flex;align-items:center;gap:2px;margin:0 6px;padding:1px 6px;font-size:11px;border:1px solid #28a745;border-radius:3px;background:#fff;color:#28a745;cursor:pointer;user-select:none">↩️取消拉黑</span>';
      foldElDiv.appendChild(foldedUnblock.firstElementChild!);

      // 展开区：在按钮区追加
      const btnRow = origElDiv.querySelector(
        ".ruozhi-copy-reason",
      )?.parentElement;
      if (btnRow) {
        btnRow.insertAdjacentHTML("beforeend", unblockBtnHTML);
      } else {
        origElDiv.insertAdjacentHTML(
          "beforeend",
          `<div style="margin-top:8px;display:flex;gap:8px">${unblockBtnHTML}</div>`,
        );
      }

      // 绑定取消拉黑事件
      const doUnblock = async (e: Event) => {
        e.stopPropagation();
        if (!confirm("确定要取消拉黑吗？该用户的评论将恢复显示。")) return;
        try {
          await removeFromBlacklist(blRecord.mid);
          // 恢复原始评论
          (el as HTMLElement).style.display = "";
          foldElDiv.remove();
          origElDiv.remove();
        } catch (err) {
          console.error(TAG, "❌ 取消拉黑失败:", err);
        }
      };

      foldElDiv
        .querySelector(".ruozhi-unblock-btn")
        ?.addEventListener("click", doUnblock);
      origElDiv
        .querySelector(".ruozhi-unblock-btn")
        ?.addEventListener("click", doUnblock);
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
