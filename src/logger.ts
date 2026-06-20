// ============================================================
// logger.ts - 黑名单面板HTML生成
// ============================================================
import type { BlacklistRecord } from "./types";
import { getAllBlacklist, removeFromBlacklist } from "./db";

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
      const mid = r.mid;
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
          <button class="ruozhi-remove-bl" data-mid="${mid}"
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
