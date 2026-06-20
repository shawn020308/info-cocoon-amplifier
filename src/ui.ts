// ============================================================
// ui.ts - 配置面板UI: 注入到B站页面
// ============================================================
import type { FilterConfig, AccumulatedStats } from "./types";
import { DEFAULT_CONFIG } from "./types";
import { testAPIConnection, forceRefineProfile } from "./api";
import {
  getAllBlacklist,
  removeFromBlacklist,
  clearBlacklist,
  clearCache,
} from "./db";
import { buildBlacklistPanelHTML } from "./logger";
import { resetStats, refreshConfig } from "./interceptor";
import {
  clearLearning,
  getLearningStats,
  getLearningRecords,
  removeLearning,
  getLearnedProfile,
  getPendingCount,
} from "./learning";

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
      // 迁移：将旧的 filterDimensions 合并到 prompt
      if (parsed.filterDimensions) {
        parsed.prompt =
          (parsed.prompt || "") +
          "\n\n违规判定维度：\n" +
          parsed.filterDimensions;
        delete parsed.filterDimensions;
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
    <button class="ruozhi-tab" data-tab="learning" style="flex:1;padding:10px;border:none;background:none;cursor:pointer;font-size:13px;color:#999">🧠 学习</button>
    <button class="ruozhi-tab" data-tab="knowledge" style="flex:1;padding:10px;border:none;background:none;cursor:pointer;font-size:13px;color:#999">📚 知识库</button>
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
      <label style="font-size:12px;color:#666;display:block;margin-bottom:4px">📝 过滤规则 Prompt（含违规判定维度）</label>
      <textarea id="ruozhi-prompt" rows="8"
        style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px;resize:vertical;box-sizing:border-box">${escapeHtml(config.prompt)}</textarea>
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
        <option value="dim" ${config.foldMode === "dim" ? "selected" : ""}>· 隐形弱化 — 几乎不可见</option>
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
    <div style="margin-bottom:8px;font-size:12px;color:#999;font-weight:600">🧠 AI自我学习</div>
    <div style="margin-bottom:8px">
      <label style="font-size:12px;color:#666;display:flex;align-items:center;gap:8px;cursor:pointer">
        <input id="ruozhi-learning" type="checkbox" ${config.learningEnabled ? "checked" : ""}>
        启用自我学习（根据纠正行为自动调整判定）
      </label>
    </div>
    <div id="ruozhi-learning-info" style="margin-bottom:12px;margin-left:24px;font-size:11px;color:#999">
      记录「取消拉黑」「误判展开」「手动拉黑」行为，自动优化AI判定策略
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
      <button id="ruozhi-clear-stats" style="flex:1;padding:6px;border:1px solid #e6a23c;border-radius:6px;background:#fff;color:#e6a23c;font-size:12px;cursor:pointer">📊 重置统计</button>
      <button id="ruozhi-clear-bl" style="flex:1;padding:6px;border:1px solid #f56c6c;border-radius:6px;background:#fff;color:#f56c6c;font-size:12px;cursor:pointer">⚠️ 清空黑名单</button>
    </div>
    <div style="display:flex;gap:8px;margin-top:4px">
      <button id="ruozhi-clear-learning" style="flex:1;padding:6px;border:1px solid #e6a23c;border-radius:6px;background:#fff;color:#e6a23c;font-size:12px;cursor:pointer">🧠 清除学习记录</button>
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

  <div id="ruozhi-tab-learning" style="display:none;overflow-y:auto;flex:1;max-height:400px">
    <div id="ruozhi-learning-content" style="padding:8px 0">加载中...</div>
  </div>

  <div id="ruozhi-tab-knowledge" style="display:none;overflow-y:auto;flex:1;padding:12px 16px">
    <div style="font-size:12px;color:#666;margin-bottom:8px">添加语境知识，辅助AI判断反讽/引用/特定称呼，避免误伤友军</div>
    <div style="margin-bottom:8px;display:flex;gap:6px">
      <input id="ruozhi-kb-input" type="text" placeholder="例如：XX是对XX的歧视性称呼"
        style="flex:1;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;box-sizing:border-box">
      <button id="ruozhi-kb-add" style="padding:6px 12px;border:none;border-radius:6px;background:#667eea;color:#fff;font-size:12px;cursor:pointer;white-space:nowrap">添加</button>
    </div>
    <div id="ruozhi-kb-list" style="font-size:11px;color:#666">
      ${(config.knowledgeBase ?? []).map((e, i) => `<div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid #f5f5f5"><span style="flex:1;word-break:break-word">📌 ${escapeHtml(e)}</span><button class="ruozhi-kb-del" data-index="${i}" style="padding:1px 6px;font-size:10px;background:none;border:1px solid #ddd;border-radius:3px;color:#999;cursor:pointer">✕</button></div>`).join("")}
    </div>
    <div id="ruozhi-kb-status" style="margin-top:8px;font-size:12px;color:#666;min-height:18px"></div>
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
      const learningEl = root.querySelector(
        "#ruozhi-tab-learning",
      ) as HTMLElement;
      const knowledgeEl = root.querySelector(
        "#ruozhi-tab-knowledge",
      ) as HTMLElement;

      // 隐藏所有
      settingsEl.style.display = "none";
      statsEl.style.display = "none";
      blEl.style.display = "none";
      learningEl.style.display = "none";
      knowledgeEl.style.display = "none";

      if (tabName === "settings") {
        settingsEl.style.display = "block";
      } else if (tabName === "stats") {
        statsEl.style.display = "block";
        updateStatsPanel();
      } else if (tabName === "blacklist") {
        blEl.style.display = "block";
        const contentEl = root.querySelector("#ruozhi-blacklist-content");
        if (contentEl) {
          contentEl.innerHTML = await buildBlacklistPanelHTML();
          bindBlacklistEvents(contentEl);
        }
      } else if (tabName === "learning") {
        learningEl.style.display = "block";
        const contentEl = root.querySelector("#ruozhi-learning-content");
        if (contentEl) {
          contentEl.innerHTML = buildLearningPanelHTML();
          bindLearningEvents(contentEl);
        }
      } else if (tabName === "knowledge") {
        knowledgeEl.style.display = "block";
        bindKnowledgeEvents(root);
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
      learningEnabled:
        (root.querySelector("#ruozhi-learning") as HTMLInputElement)?.checked ??
        true,
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

  root
    .querySelector("#ruozhi-clear-learning")
    ?.addEventListener("click", () => {
      if (!confirm("确定要清除所有AI自我学习记录吗？此操作不可撤销。")) return;
      clearLearning();
      showStatus(root, "✅ AI学习记录已清除", "#28a745");
    });

  root.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest("#ruozhi-clear-stats")) return;
    if (!confirm("确定要重置所有统计数据吗？此操作不可撤销。")) return;
    resetStats();
    updateStatsPanel();
    showStatus(root, "✅ 统计数据已重置", "#28a745");
  });
}

function showStatus(root: HTMLElement, msg: string, color: string): void {
  const el = root.querySelector("#ruozhi-status");
  if (el) {
    el.textContent = msg;
    (el as HTMLElement).style.color = color;
  }
}

/** 刷新知识库列表HTML */
function refreshKBList(root: HTMLElement): void {
  const list = root.querySelector("#ruozhi-kb-list");
  if (!list) return;
  try {
    const raw = GM_getValue("ruozhi-config", "{}");
    const config = JSON.parse(raw);
    const kb: string[] = Array.isArray(config.knowledgeBase)
      ? config.knowledgeBase
      : [];
    list.innerHTML = kb
      .map(
        (e, i) =>
          `<div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid #f5f5f5"><span style="flex:1;word-break:break-word">📌 ${escapeHtml(e)}</span><button class="ruozhi-kb-del" data-index="${i}" style="padding:1px 6px;font-size:10px;background:none;border:1px solid #ddd;border-radius:3px;color:#999;cursor:pointer">✕</button></div>`,
      )
      .join("");
    if (kb.length === 0) {
      list.innerHTML =
        '<div style="text-align:center;color:#ccc;padding:16px">暂无知识条目</div>';
    }
  } catch {
    /* */
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
    ${(() => {
      const ls = getLearningStats();
      if (ls.total === 0) return "";
      return `<div style="margin-top:12px"><div style="font-weight:600;margin-bottom:8px;color:#333">🧠 AI学习记录</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
          <div style="background:#e8f5e9;padding:6px;border-radius:6px;text-align:center"><div style="font-size:18px;font-weight:700;color:#66bb6a">${ls.unblockCount + ls.misjudgeCount}</div><div style="font-size:10px;color:#999">纠正误判</div></div>
          <div style="background:#fff3e0;padding:6px;border-radius:6px;text-align:center"><div style="font-size:18px;font-weight:700;color:#ff9800">${ls.manualCount}</div><div style="font-size:10px;color:#999">补充漏判</div></div>
          <div style="background:#f3e5f5;padding:6px;border-radius:6px;text-align:center"><div style="font-size:18px;font-weight:700;color:#ab47bc">${ls.total}</div><div style="font-size:10px;color:#999">总计</div></div>
        </div>
      </div>`;
    })()}
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

/** 构建学习记录面板HTML */
function buildLearningPanelHTML(): string {
  const records = getLearningRecords();
  const profile = getLearnedProfile();
  const pendingCount = getPendingCount();

  // ── AI 学习画像区（最上方，最醒目，可手动编辑）──
  const profileSection = profile
    ? `<div style="margin:0 8px 12px 8px;padding:10px 12px;background:linear-gradient(135deg,#f0f4ff,#f8f0ff);border:1px solid #d4c5f0;border-radius:8px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <span style="font-size:12px;font-weight:700;color:#764ba2">🧠 AI学习画像（可编辑）</span>
      <span style="font-size:10px;color:#999">每次API调用自动注入System Prompt</span>
    </div>
    <textarea id="ruozhi-profile-edit" rows="4" style="width:100%;padding:8px;border:1px solid #d4c5f0;border-radius:6px;font-size:12px;color:#555;resize:vertical;box-sizing:border-box;line-height:1.6;font-family:system-ui,sans-serif">${escapeHtml(profile)}</textarea>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
      <div style="display:flex;gap:6px">
        <button id="ruozhi-profile-save" style="padding:3px 12px;font-size:11px;border:none;border-radius:4px;background:#764ba2;color:#fff;cursor:pointer">💾 保存画像</button>
        <button id="ruozhi-profile-regen" style="padding:3px 12px;font-size:11px;border:1px solid #e6a23c;border-radius:4px;background:#fff;color:#e6a23c;cursor:pointer" title="忽略阈值，立即用全部学习记录重新生成画像">🔄 重新生成</button>
      </div>
      ${pendingCount > 0 ? `<span style="font-size:10px;color:#e6a23c">⏳ 待处理纠正: ${pendingCount} 条（攒够20条后AI自动更新）</span>` : `<span style="font-size:10px;color:#67c23a">✅ 已同步（${records.length}条记录）</span>`}
    </div>
  </div>`
    : `<div style="margin:0 8px 12px 8px;padding:10px 12px;background:#f8f9fc;border:1px solid #e0e3e8;border-radius:8px;text-align:center">
    <div style="font-size:12px;color:#999;margin-bottom:4px">🧠 尚无AI学习画像</div>
    ${
      records.length > 0
        ? `<div style="font-size:11px;color:#e6a23c">已收集 ${records.length} 条纠正，攒够20条后AI将自动生成画像</div>`
        : `<div style="font-size:11px;color:#ccc">执行「取消拉黑」「误判展开」「手动拉黑」后，AI将自动学习并生成画像</div>`
    }
  </div>`;

  if (records.length === 0) {
    return profileSection;
  }

  const typeLabel: Record<string, string> = {
    unblock: "↩️ 取消拉黑",
    misjudge: "✅ 误判纠正",
    manual_blacklist: "🚫 补充拉黑",
  };
  const typeColor: Record<string, string> = {
    unblock: "#28a745",
    misjudge: "#17a2b8",
    manual_blacklist: "#d9534f",
  };

  const rows = records
    .map((r, i) => {
      const date = new Date(r.timestamp).toLocaleString("zh-CN");
      const label = typeLabel[r.type] ?? r.type;
      const color = typeColor[r.type] ?? "#999";
      const aiReasonHTML = r.aiReason
        ? `<div style="font-size:11px;color:#e6a23c;margin-top:2px">⚡ AI曾判定: ${escapeHtml(r.aiReason)}${r.aiSeverity ? ` (${r.aiSeverity})` : ""}</div>`
        : "";
      return `
      <div style="padding:10px 12px;border-bottom:1px solid #f0f0f0;font-size:13px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span style="color:${color};font-weight:600;font-size:12px">${label}</span>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:11px;color:#ccc">${date}</span>
            <button class="ruozhi-remove-learning" data-index="${i}"
              style="padding:1px 6px;font-size:11px;background:none;border:1px solid #ddd;border-radius:3px;color:#999;cursor:pointer">
              删除
            </button>
          </div>
        </div>
        <div style="color:#666;line-height:1.5;word-break:break-word">💬 ${escapeHtml(r.message)}</div>
        ${aiReasonHTML}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px">
          <span style="font-size:11px;color:#aaa">👤 ${escapeHtml(r.uname)}</span>
          ${r.videoTitle ? `<span style="font-size:11px;color:#ccc">📺 ${escapeHtml(r.videoTitle.slice(0, 20))}${r.videoTitle.length > 20 ? "..." : ""}</span>` : ""}
        </div>
      </div>`;
    })
    .join("");

  const clearBtn = `<div style="padding:8px;text-align:center">
    <button id="ruozhi-clear-learning-inline"
      style="padding:4px 16px;font-size:12px;border:1px solid #f56c6c;border-radius:4px;background:#fff;color:#f56c6c;cursor:pointer">
      ⚠️ 清空全部学习记录
    </button>
  </div>`;

  return profileSection + rows + clearBtn;
}

/** 绑定学习面板事件 */
function bindLearningEvents(container: Element): void {
  // ── 删除单条学习记录 ──
  container.querySelectorAll(".ruozhi-remove-learning").forEach((btn) => {
    btn.addEventListener("click", () => {
      const index = parseInt((btn as HTMLElement).dataset.index ?? "-1");
      if (index >= 0) {
        removeLearning(index);
        refreshLearningPanel(container);
      }
    });
  });

  // ── 清空全部学习记录 ──
  const clearBtn = container.querySelector("#ruozhi-clear-learning-inline");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (!confirm("确定要清空所有AI学习记录吗？")) return;
      clearLearning();
      refreshLearningPanel(container);
    });
  }

  // ── 保存画像（手动编辑）──
  const profileSaveBtn = container.querySelector("#ruozhi-profile-save");
  const profileEdit = container.querySelector(
    "#ruozhi-profile-edit",
  ) as HTMLTextAreaElement | null;
  const profileRegenBtn = container.querySelector("#ruozhi-profile-regen");

  if (profileSaveBtn && profileEdit) {
    profileSaveBtn.addEventListener("click", () => {
      const val = profileEdit.value.trim();
      if (!val) return;
      try {
        const config = JSON.parse(GM_getValue("ruozhi-config", "{}"));
        config.learnedProfile = val.slice(0, 300);
        GM_setValue("ruozhi-config", JSON.stringify(config));
        refreshConfig(config);
        profileEdit.value = val.slice(0, 300);
        const toast = document.createElement("div");
        toast.textContent = "✅ 画像已保存";
        Object.assign(toast.style, {
          position: "fixed",
          bottom: "80px",
          left: "50%",
          transform: "translateX(-50%)",
          background: "#28a745",
          color: "#fff",
          padding: "6px 16px",
          borderRadius: "6px",
          fontSize: "13px",
          zIndex: "999999",
        });
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
      } catch {
        /* */
      }
    });
  }

  // ── 强制重新生成画像 ──
  if (profileRegenBtn) {
    profileRegenBtn.addEventListener("click", async () => {
      (profileRegenBtn as HTMLElement).textContent = "⏳ 生成中...";
      (profileRegenBtn as HTMLElement).style.pointerEvents = "none";
      try {
        await forceRefineProfile();
        refreshLearningPanel(container);
      } catch {
        /* */
      } finally {
        (profileRegenBtn as HTMLElement).textContent = "🔄 重新生成";
        (profileRegenBtn as HTMLElement).style.pointerEvents = "";
      }
    });
  }
}

/** 刷新学习面板 */
function refreshLearningPanel(container: Element): void {
  const contentEl =
    container.querySelector("#ruozhi-learning-content") ?? container;
  contentEl.innerHTML = buildLearningPanelHTML();
  bindLearningEvents(contentEl);
}

// ── 知识库标签页 ──

/** 绑定知识库标签页事件 */
function bindKnowledgeEvents(root: HTMLElement): void {
  // ── 添加 ──
  root.querySelector("#ruozhi-kb-add")?.addEventListener("click", () => {
    const input = root.querySelector("#ruozhi-kb-input") as HTMLInputElement;
    const val = input?.value?.trim();
    if (!val) return;
    try {
      const config = JSON.parse(GM_getValue("ruozhi-config", "{}"));
      if (!Array.isArray(config.knowledgeBase)) config.knowledgeBase = [];
      if (config.knowledgeBase.includes(val)) {
        kbStatus(root, "⚠️ 该条目已存在", "#ffc107");
        return;
      }
      config.knowledgeBase.push(val);
      GM_setValue("ruozhi-config", JSON.stringify(config));
      refreshConfig(config);
      input.value = "";
      refreshKBList(root);
      kbStatus(root, "✅ 已添加", "#28a745");
    } catch {
      /* */
    }
  });

  // ── 回车添加 ──
  root.querySelector("#ruozhi-kb-input")?.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") {
      (root.querySelector("#ruozhi-kb-add") as HTMLElement)?.click();
    }
  });

  // ── 删除（事件委托）──
  root.querySelector("#ruozhi-kb-list")?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(".ruozhi-kb-del");
    if (!btn) return;
    const idx = parseInt((btn as HTMLElement).dataset.index ?? "-1");
    if (idx < 0) return;
    try {
      const config = JSON.parse(GM_getValue("ruozhi-config", "{}"));
      if (Array.isArray(config.knowledgeBase)) {
        config.knowledgeBase.splice(idx, 1);
        GM_setValue("ruozhi-config", JSON.stringify(config));
        refreshConfig(config);
        refreshKBList(root);
      }
    } catch {
      /* */
    }
  });
}

function kbStatus(root: HTMLElement, msg: string, color: string): void {
  const el = root.querySelector("#ruozhi-kb-status");
  if (el) {
    el.textContent = msg;
    (el as HTMLElement).style.color = color;
  }
}
