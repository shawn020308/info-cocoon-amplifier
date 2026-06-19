// ============================================================
// logger.ts - 黑名单记录 & 折叠日志
// ============================================================
import type { BlacklistRecord, AIVerdict, BiliReply } from "./types";
import { getAllBlacklist, removeFromBlacklist } from "./db";

/** 生成折叠HTML */
export function createFoldHTML(
  reply: BiliReply,
  verdict: { reason: string; severity: AIVerdict["severity"] },
): string {
  const severityLabel: Record<string, string> = {
    low: "⚠️ 轻微不适",
    medium: "🚫 违规言论",
    high: "⛔ 严重违规",
    block: "🛑 永久拉黑",
  };

  const label = severityLabel[verdict.severity] ?? "🚫 已过滤";
  const user = reply.member.uname;

  return `
<div class="ruozhi-folded" style="
  background: #fff3cd;
  border: 1px solid #ffc107;
  border-radius: 6px;
  padding: 8px 12px;
  margin: 4px 0;
  font-size: 13px;
  color: #856404;
  cursor: pointer;
  user-select: none;
">
  <span style="margin-right:8px">${label}</span>
  <span style="font-weight:600">${user}</span>
  <span style="margin:0 8px">|</span>
  <span style="font-size:12px;color:#aaa">${verdict.reason}</span>
  <span style="float:right;font-size:11px;color:#999">▼ 展开查看</span>
</div>
<div class="ruozhi-original" style="display:none;padding:8px 12px;background:#f8f9fa;border-left:3px solid #ffc107;margin:4px 0;border-radius:0 6px 6px 0;">
  <div style="margin-bottom:6px;font-size:12px;color:#999">
    该评论被AI判定为: <strong>${verdict.reason}</strong>
  </div>
  <div style="color:#333">${escapeHtml(reply.content.message)}</div>
</div>`;
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

/** 生成黑名单管理面板HTML */
export async function buildBlacklistPanelHTML(): Promise<string> {
  const records = await getAllBlacklist();

  if (records.length === 0) {
    return `<div style="padding:16px;text-align:center;color:#999">暂无黑名单记录，一片祥和 🎉</div>`;
  }

  const rows = records
    .sort((a, b) => b.timestamp - a.timestamp)
    .map((r) => {
      const date = new Date(r.timestamp).toLocaleString("zh-CN");
      const uid = r.uid ?? 0;
      const sourceBadge =
        r.source === "manual"
          ? '<span style="background:#d9534f;color:#fff;font-size:10px;padding:1px 5px;border-radius:3px;margin-left:4px">手动</span>'
          : '<span style="background:#667eea;color:#fff;font-size:10px;padding:1px 5px;border-radius:3px;margin-left:4px">AI</span>';
      return `
      <div style="padding:10px 12px;border-bottom:1px solid #eee;font-size:13px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span><strong>${escapeHtml(r.uname)}</strong>${sourceBadge}</span>
          <span style="font-size:12px;color:#999">${date}</span>
        </div>
        <div style="color:#666;margin:4px 0">💬 ${escapeHtml(r.message.slice(0, 100))}${r.message.length > 100 ? "..." : ""}</div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="color:#d9534f">📋 ${escapeHtml(r.reason)}</span>
          <button class="ruozhi-remove-bl" data-uid="${uid}"
            style="padding:2px 8px;font-size:12px;background:#fff;border:1px solid #ddd;border-radius:4px;cursor:pointer">
            移除
          </button>
        </div>
        <div style="font-size:11px;color:#bbb;margin-top:2px">📺 ${escapeHtml(r.videoTitle)}</div>
      </div>`;
    })
    .join("");

  return rows;
}
