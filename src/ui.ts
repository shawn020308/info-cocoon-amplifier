// ============================================================
// ui.ts - 配置面板UI: 注入到B站页面
// ============================================================
import type { FilterConfig, AccumulatedStats } from "./types";
import { DEFAULT_CONFIG } from "./types";
import { testAPIConnection } from "./api";
import {
  getAllBlacklist,
  removeFromBlacklist,
  clearBlacklist,
  clearCache,
} from "./db";
import { buildBlacklistPanelHTML } from "./logger";
import { resetStats } from "./interceptor";

// ---------- 全局UI状态 ----------
let panelVisible = false;
let panelRoot: HTMLDivElement | null = null;
let fabBadge: HTMLElement | null = null;
let currentStats: AccumulatedStats | null = null;

/** 从 GM storage 加载配置 */
export function loadConfig(): FilterConfig {
  try {
    const raw = GM_getValue("ruozhi-config", "");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.foldMode === "boolean") {
        parsed.foldMode = parsed.foldMode ? "classic" : "none";
      }
      return { ...DEFAULT_CONFIG, ...parsed };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_CONFIG };
}

export function saveConfig(config: FilterConfig): void {
  GM_setValue("ruozhi-config", JSON.stringify(config));
}

export function setStatsRef(stats: AccumulatedStats): void {
  currentStats = stats;
  updateFabBadge();
  updateStatsPanel();
}

function updateFabBadge(): void {
  if (fabBadge && currentStats) {
    const count = currentStats.totalFiltered;
    fabBadge.textContent = String(count);
    fabBadge.style.display = count > 0 ? "flex" : "none";
  }
}

export function injectUI(
  config: FilterConfig,
  onConfigChange: (cfg: FilterConfig) => void,
): void {
  injectFloatingButton(config, onConfigChange);
}

function injectFloatingButton(
  config: FilterConfig,
  onConfigChange: (cfg: FilterConfig) => void,
): void {
  const container = document.createElement("div");
  container.id = "ruozhi-fab-container";
  Object.assign(container.style, {
    position: "fixed",
    bottom: "120px",
    right: "20px",
    zIndex: "99999",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "4px",
  });

  const badge = document.createElement("div");
  badge.id = "ruozhi-fab-badge";
  badge.textContent = "0";
  Object.assign(badge.style, {
    fontSize: "11px",
    fontWeight: "700",
    color: "#fff",
    background: "#d9534f",
    borderRadius: "10px",
    padding: "2px 6px",
    minWidth: "18px",
    textAlign: "center",
    display: "none",
    lineHeight: "16px",
    boxShadow: "0 2px 6px rgba(217,83,79,0.3)",
  });
  fabBadge = badge;

  const btn = document.createElement("div");
  btn.id = "ruozhi-fab";
  btn.innerHTML = "🧠";
  btn.title = "信息茧房放大器 - 设置";
  Object.assign(btn.style, {
    width: "44px",
    height: "44px",
    borderRadius: "50%",
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "20px",
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(102,126,234,0.4)",
    transition: "transform 0.2s",
    userSelect: "none",
  });
  btn.addEventListener("mouseenter", () => {
    btn.style.transform = "scale(1.1)";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.transform = "scale(1)";
  });
  btn.addEventListener("click", () =>
    toggleSettingsPanel(config, onConfigChange),
  );

  container.appendChild(badge);
  container.appendChild(btn);
  document.body.appendChild(container);
}

function toggleSettingsPanel(
  config: FilterConfig,
  onConfigChange: (cfg: FilterConfig) => void,
): void {
  if (panelRoot && panelVisible) {
    panelRoot.style.display = "none";
    panelVisible = false;
    return;
  }
  if (!panelRoot) {
    panelRoot = buildSettingsPanel(config, onConfigChange);
    document.body.appendChild(panelRoot);
  }
  panelRoot.style.display = "block";
  panelVisible = true;
}

function buildSettingsPanel(
  config: FilterConfig,
  onConfigChange: (cfg: FilterConfig) => void,
): HTMLDivElement {
  const root = document.createElement("div");
  root.id = "ruozhi-panel";
  Object.assign(root.style, {
    position: "fixed",
    bottom: "170px",
    right: "20px",
    width: "400px",
    maxHeight: "600px",
    background: "#fff",
    borderRadius: "12px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
    zIndex: "99998",
    display: "none",
    overflow: "hidden",
    fontFamily: "system-ui, -apple-system, sans-serif",
  });
  root.innerHTML = buildPanelHTML(config);
  document.body.appendChild(root);
  bindPanelEvents(root, config, onConfigChange);
  return root;
}

function buildPanelHTML(config: FilterConfig): string {
  return `
<div style="display:flex;flex-direction:column;max-height:600px">
  <div style="padding:16px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border-radius:12px 12px 0 0">
    <div style="font-size:16px;font-weight:700">🧠 信息茧房放大器</div>
    <div style="font-size:12px;opacity:0.8;margin-top:4px">AI驱动的降智言论过滤器</div>
  </div>

  <div id="ruozhi-tabs" style="display:flex;border-bottom:1px solid #eee">
    <button class="ruozhi-tab active" data-tab="settings" style="flex:1;padding:10px;border:none;background:none;cursor:pointer;font-size:13px;color:#667eea;border-bottom:2px solid #667eea">⚙️ 设置</button>
    <button class="ruozhi-tab" data-tab="stats" style="flex:1;padding:10px;border:none;background:none;cursor:pointer;font-size:13px;color:#999">📊 统计</button>
    <button class="ruozhi-tab" data-tab="blacklist" style="flex:1;padding:10px;border:none;background:none;cursor:pointer;font-size:13px;color:#999">📋 黑名单</button>
  </div>

  <div id="ruozhi-tab-settings" style="overflow-y:auto;flex:1;padding:12px 16px">
    <div style="margin-bottom:12px">
      <label style="font-size:12px;color:#666;display:block;margin-bottom:4px">🔑 DeepSeek API Key</label>
      <input id="ruozhi-apikey" type="password" value="${escapeAttr(config.apiKey)}" placeholder="sk-xxxxxxxx"
        style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px;box-sizing:border-box">
    </div>
    <div style="margin-bottom:12px">
      <label style="font-size:12px;color:#666;display:block;margin-bottom:4px">🌐 API 地址</label>
      <input id="ruozhi-endpoint" type="text" value="${escapeAttr(config.apiEndpoint)}"
        style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px;box-sizing:border-box">
    </div>
    <div style="margin-bottom:12px">
      <label style="font-size:12px;color:#666;display:block;margin-bottom:4px">📝 过滤规则 Prompt</label>
      <textarea id="ruozhi-prompt" rows="3"
        style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px;resize:vertical;box-sizing:border-box">${escapeHtml(config.prompt)}</textarea>
    </div>
    <div style="margin-bottom:12px">
      <label style="font-size:12px;color:#666;display:block;margin-bottom:4px">🎯 违规判定维度</label>
      <textarea id="ruozhi-dimensions" rows="5"
        style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px;resize:vertical;box-sizing:border-box;font-family:monospace">${escapeHtml(config.filterDimensions)}</textarea>
    </div>
    <div style="margin-bottom:12px">
      <label style="font-size:12px;color:#666;display:flex;align-items:center;gap:8px;cursor:pointer">
        <input id="ruozhi-enable-ai" type="checkbox" ${config.enableAI ? "checked" : ""}>
        启用 AI 过滤
      </label>
    </div>
    <div style="margin-bottom:12px">
      <label style="font-size:12px;color:#666;display:block;margin-bottom:4px">👁️ 折叠样式</label>
      <select id="ruozhi-fold-mode"
        style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px;box-sizing:border-box;background:#fff">
        <option value="classic" ${config.foldMode === "classic" ? "selected" : ""}>⚠️ 经典警告 — 黄底醒目提示</option>
        <option value="light" ${config.foldMode === "light" ? "selected" : ""}>▎极简标记 — 灰线弱提示</option>
        <option value="none" ${config.foldMode === "none" ? "selected" : ""}>🚫 完全隐藏 — 直接移除评论</option>
      </select>
    </div>
    <div style="margin-bottom:12px">
      <label style="font-size:12px;color:#666;display:flex;align-items:center;gap:8px;cursor:pointer">
        <input id="ruozhi-enable-bl" type="checkbox" ${config.enableBlacklist ? "checked" : ""}>
        启用本地黑名单
      </label>
    </div>
    <div id="ruozhi-bl-confirm-row" style="margin-bottom:12px;margin-left:24px">
      <label style="font-size:12px;color:#666;display:flex;align-items:center;gap:8px;cursor:pointer">
        <input id="ruozhi-bl-confirm" type="checkbox" ${config.blacklistConfirm ? "checked" : ""}>
        拉黑时弹出确认框（关闭可直接拉黑）
      </label>
    </div>
    <div style="margin-bottom:12px">
      <label style="font-size:12px;color:#666;display:block;margin-bottom:4px">💰 Token单价 (元/百万)</label>
      <input id="ruozhi-price" type="number" value="${config.pricePerMToken}" step="0.1" min="0"
        style="width:100px;padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px;box-sizing:border-box">
    </div>
    <div style="margin-bottom:8px;font-size:12px;color:#999;font-weight:600">📦 请求内容控制（关闭可节省Token）</div>
    <div style="margin-bottom:8px">
      <label style="font-size:12px;color:#666;display:flex;align-items:center;gap:8px;cursor:pointer">
        <input id="ruozhi-send-uname" type="checkbox" ${config.sendUname ? "checked" : ""}>
        附带用户名 (uname)
      </label>
    </div>
    <div style="margin-bottom:8px">
      <label style="font-size:12px;color:#666;display:flex;align-items:center;gap:8px;cursor:pointer">
        <input id="ruozhi-send-mid" type="checkbox" ${config.sendMid ? "checked" : ""}>
        附带用户ID (mid)
      </label>
    </div>
    <div style="margin-bottom:12px">
      <label style="font-size:12px;color:#666;display:flex;align-items:center;gap:8px;cursor:pointer">
        <input id="ruozhi-send-videodesc" type="checkbox" ${config.sendVideoDesc ? "checked" : ""}>
        附带视频简介
      </label>
    </div>
    <div style="margin-bottom:8px;font-size:12px;color:#999;font-weight:600">🛠️ 开发者</div>
    <div style="margin-bottom:12px">
      <label style="font-size:12px;color:#666;display:flex;align-items:center;gap:8px;cursor:pointer">
        <input id="ruozhi-dev-mode" type="checkbox" ${config.devMode ? "checked" : ""}>
        开发者模式（显示调试日志）
      </label>
    </div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button id="ruozhi-save" style="flex:1;padding:10px;border:none;border-radius:8px;background:#667eea;color:#fff;font-size:14px;cursor:pointer;font-weight:600">💾 保存设置</button>
      <button id="ruozhi-test" style="padding:10px 16px;border:1px solid #667eea;border-radius:8px;background:#fff;color:#667eea;font-size:13px;cursor:pointer">🔌 测试连接</button>
    </div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button id="ruozhi-clear-cache" style="flex:1;padding:6px;border:1px solid #ddd;border-radius:6px;background:#fff;color:#999;font-size:12px;cursor:pointer">🗑️ 清除缓存</button>
      <button id="ruozhi-clear-bl" style="flex:1;padding:6px;border:1px solid #f56c6c;border-radius:6px;background:#fff;color:#f56c6c;font-size:12px;cursor:pointer">⚠️ 清空黑名单</button>
    </div>
    <div id="ruozhi-status" style="margin-top:8px;font-size:12px;color:#666;min-height:18px"></div>
  </div>

  <div id="ruozhi-tab-stats" style="display:none;overflow-y:auto;flex:1;padding:12px 16px">
    <div id="ruozhi-stats-content" style="font-size:13px">
      <div style="text-align:center;color:#999;padding:20px">暂无统计数据，等待首次 API 调用...</div>
    </div>
  </div>

  <div id="ruozhi-tab-blacklist" style="display:none;overflow-y:auto;flex:1;max-height:400px">
    <div id="ruozhi-blacklist-content" style="padding:8px 0">加载中...</div>
  </div>
</div>`;
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function bindPanelEvents(
  root: HTMLElement,
  config: FilterConfig,
  onConfigChange: (cfg: FilterConfig) => void,
): void {
  const tabs = root.querySelectorAll(".ruozhi-tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", async () => {
      tabs.forEach((t) => {
        (t as HTMLElement).style.color = "#999";
        (t as HTMLElement).style.borderBottomColor = "transparent";
      });
      const t = tab as HTMLElement;
      t.style.color = "#667eea";
      t.style.borderBottomColor = "#667eea";

      const tabName = t.dataset.tab;
      const settingsEl = root.querySelector(
        "#ruozhi-tab-settings",
      ) as HTMLElement;
      const statsEl = root.querySelector("#ruozhi-tab-stats") as HTMLElement;
      const blEl = root.querySelector("#ruozhi-tab-blacklist") as HTMLElement;

      if (tabName === "settings") {
        settingsEl.style.display = "block";
        statsEl.style.display = "none";
        blEl.style.display = "none";
      } else if (tabName === "stats") {
        settingsEl.style.display = "none";
        statsEl.style.display = "block";
        blEl.style.display = "none";
        updateStatsPanel();
      } else {
        settingsEl.style.display = "none";
        statsEl.style.display = "none";
        blEl.style.display = "block";
        const contentEl = root.querySelector("#ruozhi-blacklist-content");
        if (contentEl) {
          contentEl.innerHTML = await buildBlacklistPanelHTML();
          bindBlacklistEvents(contentEl);
        }
      }
    });
  });

  root.querySelector("#ruozhi-save")?.addEventListener("click", () => {
    const newConfig: FilterConfig = {
      ...config,
      apiKey:
        (root.querySelector("#ruozhi-apikey") as HTMLInputElement)?.value ?? "",
      apiEndpoint:
        (root.querySelector("#ruozhi-endpoint") as HTMLInputElement)?.value ??
        config.apiEndpoint,
      prompt:
        (root.querySelector("#ruozhi-prompt") as HTMLTextAreaElement)?.value ??
        config.prompt,
      enableAI:
        (root.querySelector("#ruozhi-enable-ai") as HTMLInputElement)
          ?.checked ?? true,
      foldMode:
        ((root.querySelector("#ruozhi-fold-mode") as HTMLSelectElement)
          ?.value as FilterConfig["foldMode"]) ?? "classic",
      enableBlacklist:
        (root.querySelector("#ruozhi-enable-bl") as HTMLInputElement)
          ?.checked ?? true,
      blacklistConfirm:
        (root.querySelector("#ruozhi-bl-confirm") as HTMLInputElement)
          ?.checked ?? true,
      devMode:
        (root.querySelector("#ruozhi-dev-mode") as HTMLInputElement)?.checked ??
        false,
      pricePerMToken:
        parseFloat(
          (root.querySelector("#ruozhi-price") as HTMLInputElement)?.value ||
            "1.1",
        ) || 1.1,
      sendUname:
        (root.querySelector("#ruozhi-send-uname") as HTMLInputElement)
          ?.checked ?? false,
      sendMid:
        (root.querySelector("#ruozhi-send-mid") as HTMLInputElement)?.checked ??
        false,
      sendVideoDesc:
        (root.querySelector("#ruozhi-send-videodesc") as HTMLInputElement)
          ?.checked ?? false,
      filterDimensions:
        (root.querySelector("#ruozhi-dimensions") as HTMLTextAreaElement)
          ?.value ?? config.filterDimensions,
    };
    saveConfig(newConfig);
    onConfigChange(newConfig);
    showStatus(root, "✅ 设置已保存", "#28a745");
  });

  root.querySelector("#ruozhi-enable-bl")?.addEventListener("change", () => {
    const checked = (
      root.querySelector("#ruozhi-enable-bl") as HTMLInputElement
    )?.checked;
    const confirmRow = root.querySelector(
      "#ruozhi-bl-confirm-row",
    ) as HTMLElement;
    if (confirmRow) confirmRow.style.display = checked ? "" : "none";
  });

  root.querySelector("#ruozhi-test")?.addEventListener("click", async () => {
    const apiKey = (root.querySelector("#ruozhi-apikey") as HTMLInputElement)
      ?.value;
    if (!apiKey) {
      showStatus(root, "⚠️ 请先填写 API Key", "#ffc107");
      return;
    }
    showStatus(root, "⏳ 正在测试...", "#666");
    const ok = await testAPIConnection({ ...config, apiKey });
    showStatus(
      root,
      ok ? "✅ 连接成功" : "❌ 连接失败，请检查API Key和地址",
      ok ? "#28a745" : "#d9534f",
    );
  });

  root
    .querySelector("#ruozhi-clear-cache")
    ?.addEventListener("click", async () => {
      await clearCache();
      showStatus(root, "✅ 缓存已清除", "#28a745");
    });

  root
    .querySelector("#ruozhi-clear-bl")
    ?.addEventListener("click", async () => {
      if (!confirm("确定要清空所有黑名单记录吗？此操作不可撤销。")) return;
      await clearBlacklist();
      showStatus(root, "✅ 黑名单已清空", "#28a745");
      const blContent = root.querySelector("#ruozhi-blacklist-content");
      if (blContent)
        blContent.innerHTML =
          '<div style="padding:16px;text-align:center;color:#999">暂无黑名单记录，一片祥和 🎉</div>';
    });

  root.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest("#ruozhi-clear-stats")) return;
    if (!confirm("确定要重置所有统计数据吗？")) return;
    resetStats();
    updateStatsPanel();
  });
}

function showStatus(root: HTMLElement, msg: string, color: string): void {
  const el = root.querySelector("#ruozhi-status");
  if (el) {
    el.textContent = msg;
    (el as HTMLElement).style.color = color;
  }
}

function updateStatsPanel(): void {
  const contentEl = document.querySelector("#ruozhi-stats-content");
  if (!contentEl || !currentStats) return;
  const s = currentStats;
  const tokensPerK = (s.totalTokens / 1000).toFixed(1);
  let price = 1.1;
  try {
    const cfg = JSON.parse(GM_getValue("ruozhi-config", "{}"));
    price = cfg.pricePerMToken ?? 1.1;
  } catch {
    /* */
  }
  const costEst = ((s.totalTokens / 1000000) * price).toFixed(4);
  let sevHTML = "";
  const labels: Record<string, string> = {
    low: "⚠️ 轻微",
    medium: "🚫 违规",
    high: "⛔ 严重",
    block: "🛑 拉黑",
  };
  for (const [sev, count] of Object.entries(s.severityCounts).sort()) {
    const label = labels[sev] ?? sev;
    sevHTML += `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f0f0f0"><span>${label}</span><strong>${count}</strong></div>`;
  }
  contentEl.innerHTML = `
    <div style="margin-bottom:12px">
      <div style="font-weight:600;margin-bottom:8px;color:#333">📈 累计统计</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <div style="background:#f5f7fa;padding:8px;border-radius:6px;text-align:center"><div style="font-size:20px;font-weight:700;color:#909399">${s.totalScanned}</div><div style="font-size:11px;color:#999">已扫描</div></div>
        <div style="background:#f5f7fa;padding:8px;border-radius:6px;text-align:center"><div style="font-size:20px;font-weight:700;color:#667eea">${s.totalFiltered}</div><div style="font-size:11px;color:#999">已过滤</div></div>
        <div style="background:#f5f7fa;padding:8px;border-radius:6px;text-align:center"><div style="font-size:20px;font-weight:700;color:#764ba2">${s.apiCalls}</div><div style="font-size:11px;color:#999">API 调用</div></div>
        <div style="background:#f5f7fa;padding:8px;border-radius:6px;text-align:center"><div style="font-size:20px;font-weight:700;color:#e6a23c">${tokensPerK}K</div><div style="font-size:11px;color:#999">Token</div></div>
        <div style="background:#f5f7fa;padding:8px;border-radius:6px;text-align:center"><div style="font-size:20px;font-weight:700;color:#67c23a">¥${costEst}</div><div style="font-size:11px;color:#999">预估费用</div></div>
        <div style="background:#fef0f0;padding:8px;border-radius:6px;text-align:center;cursor:pointer" id="ruozhi-clear-stats"><div style="font-size:16px;color:#f56c6c">🗑️</div><div style="font-size:11px;color:#f56c6c">重置统计</div></div>
      </div>
    </div>
    <div style="margin-top:12px"><div style="font-weight:600;margin-bottom:8px;color:#333">🏷️ 违规分布</div>${sevHTML || '<div style="color:#999;text-align:center;padding:8px">暂无</div>'}</div>
    <div style="margin-top:12px;font-size:11px;color:#aaa;text-align:center">DeepSeek-chat ¥${price}/1M tokens · prompt: ${(s.promptTokens / 1000).toFixed(1)}K · completion: ${(s.completionTokens / 1000).toFixed(1)}K</div>`;
}

function bindBlacklistEvents(container: Element): void {
  container.querySelectorAll(".ruozhi-remove-bl").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const mid = parseInt((btn as HTMLElement).dataset.mid ?? "0");
      if (mid) {
        await removeFromBlacklist(mid);
        const contentEl =
          container.querySelector("#ruozhi-blacklist-content") ?? container;
        contentEl.innerHTML = await buildBlacklistPanelHTML();
        bindBlacklistEvents(contentEl);
      }
    });
  });
}
