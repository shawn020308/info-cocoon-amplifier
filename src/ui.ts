// ============================================================
// ui.ts — 所有 UI 层代码（Notion 风格 · 无 Emoji · 系统字体）
//
// Tab 结构：设置 | 统计（含黑名单） | 学习（含知识库）
// 包含：FAB · 面板 · Toast · 评论折叠 · 拉黑按钮
// ============================================================

import type {
  FilterConfig,
  AccumulatedStats,
  BlacklistRecord,
  ProviderName,
} from "./types";
import type { PendingComment } from "./comment-extractor";
import { DEFAULT_CONFIG, PROVIDER_PRESETS } from "./types";
import { testAPIConnection, forceRefineProfile } from "./api";
import {
  getAllBlacklist,
  removeFromBlacklist,
  clearBlacklist,
  clearCache,
  isBlacklistedSync,
  deleteCommentFromCache,
  commentHash,
  addToBlacklist,
} from "./db";
import { triggerReport, triggerQuickReport, copyReason } from "./report";
import { resetStats, refreshConfig, currentContext } from "./interceptor";
import { recordLearning } from "./learning";
import {
  clearLearning,
  getLearningStats,
  getLearningRecords,
  removeLearning,
  getLearnedProfile,
  getPendingCount,
} from "./learning";
import { getConfig } from "./config";
import { log } from "./debug";

// ──────────────────────────────────────────────
// 设计令牌 —— Notion 风格
// ──────────────────────────────────────────────

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Hiragino Sans GB', Helvetica, Arial, sans-serif";

// ── 主题系统 ──
import type { ThemeName } from "./types";

interface ThemeColors {
  bg: string;
  surface: string;
  border: string;
  text: string;
  secondary: string;
  muted: string;
  accent: string;
  accentHover: string;
  textOnAccent: string;
  blue: string;
  blueBg: string;
  red: string;
  redBg: string;
  amber: string;
  amberBg: string;
  green: string;
  greenBg: string;
  purple: string;
  purpleBg: string;
  /** 面板阴影 */
  shadow: string;
  /** classic 折叠模式：折叠条背景 */
  foldBg: string;
  /** classic 折叠模式：折叠条边框 */
  foldBorder: string;
  /** classic 折叠模式：折叠条文字 */
  foldText: string;
  /** classic 折叠模式：折叠条辅助文字 */
  foldMuted: string;
  /** 输入框 placeholder 颜色 */
  inputPlaceholder: string;
}

const THEMES: Record<ThemeName, ThemeColors> = {
  // ── Claude 风格：温润橙调 / Anthropic 品牌 ──
  claude: {
    bg: "#faf8f5",
    surface: "#f5f1eb",
    border: "#e8e3dc",
    text: "#2d2a26",
    secondary: "#8b8680",
    muted: "#bfbab3",
    accent: "#d97757",
    accentHover: "#c56544",
    textOnAccent: "#ffffff",
    blue: "#5b8db8",
    blueBg: "#eef3f8",
    red: "#cc5a4a",
    redBg: "#faf0ed",
    amber: "#c08a45",
    amberBg: "#faf3e9",
    green: "#6a9b71",
    greenBg: "#eef4ef",
    purple: "#8b7bab",
    purpleBg: "#f3eff7",
    shadow: "0 0 0 1px rgba(0,0,0,0.06), 0 8px 32px rgba(0,0,0,0.12)",
    foldBg: "#fef9e7",
    foldBorder: "#f0d060",
    foldText: "#6b5a10",
    foldMuted: "#a09870",
    inputPlaceholder: "#bfbab3",
  },
  // ── GitHub Light 风格：高对比 / 清晰锐利 ──
  github: {
    bg: "#ffffff",
    surface: "#f6f8fa",
    border: "#d0d7de",
    text: "#1f2328",
    secondary: "#656d76",
    muted: "#8b949e",
    accent: "#24292f",
    accentHover: "#1b1f24",
    textOnAccent: "#ffffff",
    blue: "#0969da",
    blueBg: "#ddf4ff",
    red: "#cf222e",
    redBg: "#ffebe9",
    amber: "#9a6700",
    amberBg: "#fff8c5",
    green: "#1a7f37",
    greenBg: "#dafbe1",
    purple: "#8250df",
    purpleBg: "#fbefff",
    shadow: "0 0 0 1px rgba(0,0,0,0.06), 0 8px 32px rgba(0,0,0,0.12)",
    foldBg: "#fef9e7",
    foldBorder: "#f0d060",
    foldText: "#6b5a10",
    foldMuted: "#a09870",
    inputPlaceholder: "#8b949e",
  },
  // ── Dark Modern：现代暗色 / VS Code 风格 ──
  dark: {
    bg: "#1e1e1e",
    surface: "#252526",
    border: "#3e3e42",
    text: "#cccccc",
    secondary: "#9d9d9d",
    muted: "#6e6e6e",
    accent: "#0078d4",
    accentHover: "#1a8cff",
    textOnAccent: "#ffffff",
    blue: "#4fc1ff",
    blueBg: "#1a3a4a",
    red: "#f44747",
    redBg: "#3d1f1f",
    amber: "#cca700",
    amberBg: "#3d3520",
    green: "#4ec9b0",
    greenBg: "#1d3d38",
    purple: "#c586c0",
    purpleBg: "#35253a",
    shadow: "0 0 0 1px rgba(255,255,255,0.06), 0 8px 32px rgba(0,0,0,0.5)",
    foldBg: "#332b00",
    foldBorder: "#665500",
    foldText: "#cca700",
    foldMuted: "#8a7a40",
    inputPlaceholder: "#5a5a5a",
  },
};

/** 当前主题配色（动态切换） */
let COLOR: ThemeColors = THEMES.github;

/** 动态样式表（placeholder / focus / autofill） */
function ensureStyleElement(): HTMLStyleElement {
  let el = document.getElementById(
    "ruozhi-dynamic-styles",
  ) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = "ruozhi-dynamic-styles";
    document.head.appendChild(el);
  }
  return el;
}

function updateDynamicStyles(): void {
  const el = ensureStyleElement();
  el.textContent = `
/* ── placeholder ── */
#ruozhi-panel input::placeholder,
#ruozhi-panel textarea::placeholder {
  color: ${COLOR.inputPlaceholder};
  opacity: 1;
}

/* ── focus ring ── */
#ruozhi-panel input:focus,
#ruozhi-panel textarea:focus,
#ruozhi-panel select:focus {
  border-color: ${COLOR.accent};
  box-shadow: 0 0 0 2px ${COLOR.accent}22;
  outline: none;
}

/* ── autofill override ── */
#ruozhi-panel input:-webkit-autofill,
#ruozhi-panel textarea:-webkit-autofill {
  -webkit-box-shadow: 0 0 0 1000px ${COLOR.surface} inset !important;
  -webkit-text-fill-color: ${COLOR.text} !important;
  caret-color: ${COLOR.text};
}

/* ── select: custom arrow + color-scheme ── */
#ruozhi-panel select {
  color-scheme: ${COLOR === THEMES.dark ? "dark" : "light"};
  -webkit-appearance: none;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='${COLOR.secondary.replace("#", "%23")}' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 32px;
  cursor: pointer;
}

/* ── 自定义滚动条 ── */
#ruozhi-panel ::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
#ruozhi-panel ::-webkit-scrollbar-track {
  background: transparent;
}
#ruozhi-panel ::-webkit-scrollbar-thumb {
  background: ${COLOR.border};
  border-radius: 3px;
}
#ruozhi-panel ::-webkit-scrollbar-thumb:hover {
  background: ${COLOR.muted};
}

/* ── Tab 导航 ── */
.ruozhi-tab {
  transition: all 0.2s ease !important;
  border-radius: 6px 6px 0 0 !important;
  margin: 0 2px;
  position: relative;
}
.ruozhi-tab:hover {
  background: ${COLOR.surface} !important;
  color: ${COLOR.text} !important;
}
.ruozhi-tab.active {
  background: ${COLOR.accent} !important;
  color: ${COLOR.textOnAccent} !important;
  border-bottom-color: ${COLOR.accent} !important;
  font-weight: 600 !important;
}

/* ── 按钮 hover 过渡 ── */
#ruozhi-panel button {
  transition: all 0.15s ease;
}
#ruozhi-panel button:hover {
  filter: brightness(0.96);
}
#ruozhi-panel button:active {
  transform: scale(0.97);
}

/* ── 复选框标签 hover ── */
#ruozhi-panel label {
  transition: opacity 0.15s;
  border-radius: 4px;
  padding: 2px 4px;
  margin: 0 -4px;
}
#ruozhi-panel label:hover {
  opacity: 0.8;
}

/* ── 统计卡片 hover ── */
.ruozhi-stat-card {
  transition: transform 0.15s, box-shadow 0.15s;
}
.ruozhi-stat-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0,0,0,0.08) !important;
}

/* ── 知识库条目 hover ── */
.ruozhi-kb-item:hover {
  background: ${COLOR.surface};
}

/* ── 面板关闭按钮 ── */
#ruozhi-panel-close {
  transition: all 0.15s ease;
}
#ruozhi-panel-close:hover {
  background: ${COLOR.redBg} !important;
  color: ${COLOR.red} !important;
}

/* ── 状态消息动画 ── */
#ruozhi-status {
  transition: opacity 0.2s ease;
}
`;
}

/** 更新 FAB 按钮和角标的主题 */
function updateFabTheme(): void {
  const btn = document.getElementById("ruozhi-fab");
  const badge = document.getElementById("ruozhi-fab-badge");
  if (btn) {
    (btn as HTMLElement).style.background = COLOR.accent;
    (btn as HTMLElement).style.color = COLOR.textOnAccent;
  }
  if (badge) {
    (badge as HTMLElement).style.background = COLOR.red;
    (badge as HTMLElement).style.color = COLOR.textOnAccent;
  }
}

/** 应用主题 */
export function applyTheme(name: ThemeName): void {
  if (THEMES[name]) {
    COLOR = THEMES[name];
    updateDynamicStyles();
    updateFabTheme();
  }
}

/** 获取当前主题名 */
export function getCurrentTheme(): ThemeName {
  for (const [k, v] of Object.entries(THEMES)) {
    if (v === COLOR) return k as ThemeName;
  }
  return "github";
}

// 输入框/选择框公共样式（每次调用时读取当前 COLOR）
function inputStyle(): string {
  return `width:100%;padding:8px 10px;border:1px solid ${COLOR.border};border-radius:4px;font-size:14px;box-sizing:border-box;font-family:${FONT};outline:none;background:${COLOR.surface};color:${COLOR.text};color-scheme:${COLOR === THEMES.dark ? "dark" : "light"}`;
}

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────

export function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ──────────────────────────────────────────────
// Toast 通知
// ──────────────────────────────────────────────

export function showToast(msg: string, duration = 2500): void {
  const t = document.createElement("div");
  t.textContent = msg;
  Object.assign(t.style, {
    position: "fixed",
    bottom: "60px",
    left: "50%",
    transform: "translateX(-50%) translateY(10px)",
    background: COLOR.accent,
    color: COLOR.textOnAccent,
    padding: "10px 20px",
    borderRadius: "6px",
    fontSize: "14px",
    zIndex: "999999",
    fontFamily: FONT,
    pointerEvents: "none",
    opacity: "0",
    transition: "opacity 0.25s, transform 0.25s",
    boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
  });
  document.body.appendChild(t);
  // 触发动画
  requestAnimationFrame(() => {
    t.style.opacity = "1";
    t.style.transform = "translateX(-50%) translateY(0)";
  });
  setTimeout(() => {
    t.style.opacity = "0";
    t.style.transform = "translateX(-50%) translateY(-10px)";
    setTimeout(() => t.remove(), 300);
  }, duration);
}

// ──────────────────────────────────────────────
// 全局 UI 状态
// ──────────────────────────────────────────────

let panelVisible = false;
let panelRoot: HTMLDivElement | null = null;
let fabBadge: HTMLElement | null = null;
let currentStats: AccumulatedStats | null = null;

// ──────────────────────────────────────────────
// Config 存取
// ──────────────────────────────────────────────

export function loadConfig(): FilterConfig {
  try {
    const raw = GM_getValue("ruozhi-config", "");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.foldMode === "boolean") {
        parsed.foldMode = parsed.foldMode ? "classic" : "none";
      }
      if (parsed.blacklistConfirm === undefined) {
        parsed.blacklistConfirm = true;
      }
      if (parsed.devMode === undefined) {
        parsed.devMode = false;
      }
      if (parsed.filterDimensions) {
        parsed.prompt =
          (parsed.prompt || "") +
          "\n\n违规判定维度：\n" +
          parsed.filterDimensions;
        delete parsed.filterDimensions;
      }
      if (!parsed.theme) {
        parsed.theme = "claude";
      }
      if (parsed.fontScale === undefined) {
        parsed.fontScale = 1.0;
      }
      // 迁移：旧版无 apiKeys，将旧 apiKey 存入当前 provider 的槽位
      if (!parsed.apiKeys || Object.keys(parsed.apiKeys).length === 0) {
        parsed.apiKeys = {};
        if (parsed.apiKey) {
          parsed.apiKeys[parsed.provider || "deepseek"] = parsed.apiKey;
        }
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

// ──────────────────────────────────────────────
// 入口：注入 FAB
// ──────────────────────────────────────────────

export function injectUI(
  config: FilterConfig,
  onConfigChange: (cfg: FilterConfig) => void,
): void {
  applyTheme(config.theme ?? "github");
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
    zoom: String(config.fontScale ?? 1.0),
  });

  const badge = document.createElement("div");
  badge.id = "ruozhi-fab-badge";
  badge.textContent = "0";
  Object.assign(badge.style, {
    fontSize: "10px",
    fontWeight: "600",
    color: COLOR.textOnAccent,
    background: COLOR.red,
    borderRadius: "9px",
    padding: "1px 5px",
    minWidth: "16px",
    textAlign: "center",
    display: "none",
    lineHeight: "15px",
    fontFamily: FONT,
  });
  fabBadge = badge;

  const btn = document.createElement("div");
  btn.id = "ruozhi-fab";
  btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
  btn.title = "评论过滤器 — 设置";
  Object.assign(btn.style, {
    width: "40px",
    height: "40px",
    borderRadius: "10px",
    background: COLOR.accent,
    color: COLOR.textOnAccent,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    boxShadow: "0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.06)",
    transition: "background 0.15s, transform 0.2s, box-shadow 0.2s",
    userSelect: "none",
  });
  btn.addEventListener("mouseenter", () => {
    btn.style.background = COLOR.accentHover;
    btn.style.transform = "scale(1.08)";
    btn.style.boxShadow = "0 4px 12px rgba(0,0,0,0.18)";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.background = COLOR.accent;
    btn.style.transform = "scale(1)";
    btn.style.boxShadow =
      "0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.06)";
  });
  btn.addEventListener("click", () =>
    toggleSettingsPanel(config, onConfigChange),
  );

  container.appendChild(badge);
  container.appendChild(btn);
  document.body.appendChild(container);
}

// ──────────────────────────────────────────────
// 设置面板
// ──────────────────────────────────────────────

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
    width: "420px",
    maxHeight: "620px",
    background: COLOR.bg,
    borderRadius: "8px",
    boxShadow: COLOR.shadow,
    zIndex: "99998",
    display: "none",
    overflow: "hidden",
    fontFamily: FONT,
    color: COLOR.text,
    colorScheme: COLOR === THEMES.dark ? "dark" : "light",
    zoom: String(config.fontScale ?? 1.0),
  });
  root.innerHTML = buildPanelHTML(config);
  document.body.appendChild(root);
  bindPanelEvents(root, config, onConfigChange);
  return root;
}

function buildPanelHTML(config: FilterConfig): string {
  function cb(b: boolean) {
    return b ? "checked" : "";
  }
  function sel(v: string, t: string) {
    return v === t ? "selected" : "";
  }
  const is = inputStyle();
  const opt = `background:${COLOR.bg};color:${COLOR.text}`;
  const kbItems = (config.knowledgeBase ?? [])
    .map(
      (e, i) =>
        `<div class="ruozhi-kb-item" style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid ${COLOR.border}"><span style="flex:1;word-break:break-word;font-size:13px">${esc(e)}</span><button class="ruozhi-kb-del" data-index="${i}" style="padding:1px 6px;font-size:11px;background:none;border:1px solid ${COLOR.border};border-radius:3px;color:${COLOR.secondary};cursor:pointer;font-family:${FONT}">&times;</button></div>`,
    )
    .join("");

  // 区段标题样式
  const secLabel = `font-size:11px;font-weight:600;color:${COLOR.secondary};margin-bottom:8px;text-transform:uppercase;letter-spacing:0.05em`;
  // 行内复选框样式
  const chkRow = `font-size:13px;color:${COLOR.text};display:flex;align-items:center;gap:8px;cursor:pointer;font-family:${FONT}`;
  const subChkRow = `font-size:12px;color:${COLOR.secondary};display:flex;align-items:center;gap:8px;cursor:pointer;font-family:${FONT}`;
  // 设置分区样式（弱化卡片感，仅底部细线分隔）
  const cardStyle = `padding:0 0 14px 0;margin-bottom:14px;border-bottom:1px solid ${COLOR.border}`;

  return `
<div style="display:flex;flex-direction:column;max-height:620px">
  <!-- 头部 -->
  <div style="padding:16px 20px;border-bottom:1px solid ${COLOR.border};display:flex;justify-content:space-between;align-items:center">
    <div>
      <div style="font-size:16px;font-weight:700;color:${COLOR.text};letter-spacing:-0.01em">评论过滤器</div>
      <div style="font-size:12px;color:${COLOR.muted};margin-top:1px">AI 驱动的低质评论过滤</div>
    </div>
    <button id="ruozhi-panel-close" style="width:28px;height:28px;border:1px solid ${COLOR.border};border-radius:6px;background:${COLOR.bg};color:${COLOR.secondary};font-size:14px;cursor:pointer;font-family:${FONT};display:flex;align-items:center;justify-content:center;line-height:1">&times;</button>
  </div>

  <!-- Tab 导航 -->
  <div id="ruozhi-tabs" style="display:flex;border-bottom:1px solid ${COLOR.border};gap:4px">
    ${["设置", "统计", "学习"]
      .map(
        (name, idx) =>
          `<button class="ruozhi-tab${idx === 0 ? " active" : ""}" data-tab="${name}" style="flex:1;padding:8px 12px;border:none;background:${idx === 0 ? COLOR.accent : "transparent"};cursor:pointer;font-size:13px;font-family:${FONT};color:${idx === 0 ? COLOR.textOnAccent : COLOR.secondary};border-bottom:2px solid ${idx === 0 ? COLOR.accent : "transparent"};font-weight:${idx === 0 ? "600" : "400"};border-radius:6px 6px 0 0">${name}</button>`,
      )
      .join("")}
  </div>

  <!-- ========== 设置 Tab ========== -->
  <div id="ruozhi-tab-settings" style="overflow-y:auto;flex:1;padding:14px 20px 20px">

    <!-- API 设置卡片 -->
    <div style="${cardStyle}">
      <div style="${secLabel}">API 配置</div>
      <div style="margin-bottom:10px">
        <div style="font-size:12px;color:${COLOR.secondary};margin-bottom:4px">AI 提供商</div>
        <select id="ruozhi-provider" style="${is}">
          ${(Object.keys(PROVIDER_PRESETS) as ProviderName[]).map((k) => `<option value="${k}" ${sel(k, config.provider)} style="${opt}">${PROVIDER_PRESETS[k].label}</option>`).join("")}
        </select>
      </div>
      <div style="margin-bottom:10px" id="ruozhi-model-row">
        <div style="font-size:12px;color:${COLOR.secondary};margin-bottom:4px">模型</div>
        <input id="ruozhi-model" type="text" value="${escapeAttr(config.model)}" placeholder="如 deepseek-v4-flash" style="${is}">
      </div>
      <div style="margin-bottom:10px" id="ruozhi-apikey-row">
        <div style="font-size:12px;color:${COLOR.secondary};margin-bottom:4px">API Key</div>
        <input id="ruozhi-apikey" type="password" value="${escapeAttr(config.apiKey)}" placeholder="sk-xxxxxxxx" style="${is}">
      </div>
      <div style="margin-bottom:10px">
        <div style="font-size:12px;color:${COLOR.secondary};margin-bottom:4px">接口地址</div>
        <input id="ruozhi-endpoint" type="text" value="${escapeAttr(config.apiEndpoint)}" style="${is}">
      </div>
      <div style="margin-bottom:8px">
        <div style="font-size:12px;color:${COLOR.secondary};margin-bottom:4px">Token 单价 (¥ / 百万)</div>
        <input id="ruozhi-price" type="number" value="${config.pricePerMToken}" step="0.1" min="0" style="width:100px;${is}">
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <button id="ruozhi-test" style="padding:7px 16px;border:1px solid ${COLOR.border};border-radius:4px;background:${COLOR.bg};color:${COLOR.text};font-size:13px;cursor:pointer;font-family:${FONT}">测试连接</button>
        <span id="ruozhi-test-status" style="font-size:12px;min-width:80px"></span>
      </div>
    </div>

    <!-- 过滤规则 -->
    <div style="${cardStyle}">
      <div style="${secLabel}">过滤规则</div>
      <div style="margin-bottom:8px">
        <div style="font-size:12px;color:${COLOR.secondary};margin-bottom:4px">Prompt 指令</div>
        <textarea id="ruozhi-prompt" rows="5" style="${is};resize:vertical;line-height:1.5">${esc(config.prompt)}</textarea>
      </div>
      <div>
        <div style="font-size:12px;color:${COLOR.secondary};margin-bottom:4px">折叠样式</div>
        <select id="ruozhi-fold-mode" style="${is}">
          <option value="classic" ${sel(config.foldMode, "classic")} style="${opt}">经典 — 黄底醒目标记</option>
          <option value="light" ${sel(config.foldMode, "light")} style="${opt}">极简 — 细灰线标记</option>
          <option value="dim" ${sel(config.foldMode, "dim")} style="${opt}">弱化 — 几乎不可见</option>
          <option value="none" ${sel(config.foldMode, "none")} style="${opt}">隐藏 — 直接移除评论</option>
          <option value="clean" ${sel(config.foldMode, "clean")} style="${opt}">护眼 — 高斯模糊内容</option>
        </select>
      </div>
    </div>

    <!-- 外观卡片 -->
    <div style="${cardStyle}">
      <div style="${secLabel}">外观</div>
      <div style="margin-bottom:10px">
        <div style="font-size:12px;color:${COLOR.secondary};margin-bottom:4px">UI 主题</div>
        <select id="ruozhi-theme" style="${is}">
          <option value="github" ${sel(config.theme, "github")} style="${opt}">GitHub — 清晰锐利</option>
          <option value="claude" ${sel(config.theme, "claude")} style="${opt}">Claude — 温润橙调</option>
          <option value="dark" ${sel(config.theme, "dark")} style="${opt}">Dark Modern — 现代暗色</option>
        </select>
      </div>
      <div>
        <div style="font-size:12px;color:${COLOR.secondary};margin-bottom:4px">字体大小</div>
        <div style="display:flex;align-items:center;gap:8px">
          <button id="ruozhi-font-down" style="width:32px;height:32px;border:1px solid ${COLOR.border};border-radius:4px;background:${COLOR.surface};color:${COLOR.text};font-size:16px;cursor:pointer;font-family:${FONT};line-height:1;display:flex;align-items:center;justify-content:center">−</button>
          <span id="ruozhi-font-scale-label" style="font-size:14px;color:${COLOR.text};min-width:48px;text-align:center;font-family:${FONT};font-weight:600">${(config.fontScale ?? 1.0).toFixed(1)}x</span>
          <button id="ruozhi-font-up" style="width:32px;height:32px;border:1px solid ${COLOR.border};border-radius:4px;background:${COLOR.surface};color:${COLOR.text};font-size:16px;cursor:pointer;font-family:${FONT};line-height:1;display:flex;align-items:center;justify-content:center">+</button>
          <button id="ruozhi-font-reset" style="padding:5px 10px;border:1px solid ${COLOR.border};border-radius:4px;background:${COLOR.bg};color:${COLOR.secondary};font-size:12px;cursor:pointer;font-family:${FONT}">重置</button>
        </div>
      </div>
    </div>

    <!-- 过滤选项卡片 -->
    <div style="${cardStyle}">
      <div style="${secLabel}">过滤选项</div>
      <div style="margin-bottom:8px">
        <label style="${chkRow}">
          <input id="ruozhi-enable-ai" type="checkbox" ${cb(config.enableAI)} style="accent-color:${COLOR.accent}">
          启用 AI 过滤
        </label>
      </div>
      <div style="margin-bottom:6px">
        <label style="${chkRow}">
          <input id="ruozhi-enable-bl" type="checkbox" ${cb(config.enableBlacklist)} style="accent-color:${COLOR.accent}">
          启用本地黑名单
        </label>
        <div id="ruozhi-bl-confirm-row" style="margin-top:6px;margin-left:24px">
          <label style="${subChkRow}">
            <input id="ruozhi-bl-confirm" type="checkbox" ${cb(config.blacklistConfirm)} style="accent-color:${COLOR.accent}">
            拉黑前弹出确认
          </label>
        </div>
      </div>
      <div style="margin-bottom:6px">
        <label style="${chkRow}">
          <input id="ruozhi-learning" type="checkbox" ${cb(config.learningEnabled)} style="accent-color:${COLOR.accent}">
          启用自我学习
        </label>
        <div style="margin-top:3px;margin-left:24px;font-size:11px;color:${COLOR.muted}">基于你的纠正行为自动优化判定策略</div>
      </div>
    </div>

    <!-- 请求内容卡片 -->
    <div style="${cardStyle}">
      <div style="${secLabel}">请求内容控制</div>
      <div style="margin-bottom:4px"><label style="${subChkRow}"><input id="ruozhi-send-uname" type="checkbox" ${cb(config.sendUname)} style="accent-color:${COLOR.accent}">附带用户名</label></div>
      <div style="margin-bottom:4px"><label style="${subChkRow}"><input id="ruozhi-send-mid" type="checkbox" ${cb(config.sendMid)} style="accent-color:${COLOR.accent}">附带用户 ID</label></div>
      <div style="margin-bottom:4px"><label style="${subChkRow}"><input id="ruozhi-send-videodesc" type="checkbox" ${cb(config.sendVideoDesc)} style="accent-color:${COLOR.accent}">附带视频简介</label></div>
      <div>
        <label style="${chkRow}">
          <input id="ruozhi-dev-mode" type="checkbox" ${cb(config.devMode)} style="accent-color:${COLOR.accent}">
          开发者模式
        </label>
      </div>
    </div>

    <!-- 预过滤卡片 -->
    <div style="${cardStyle}">
      <div style="${secLabel}">预过滤 (节省Token)</div>
      <div style="font-size:12px;color:${COLOR.muted};margin-bottom:10px">开启后，匹配的评论不再发送给 AI 判定。全部关闭则不预过滤。</div>
      <div style="margin-bottom:4px"><label style="${subChkRow}"><input id="ruozhi-prefilter-short" type="checkbox" ${cb(config.prefilterShort)} style="accent-color:${COLOR.accent}">跳过极短评论（如 "哈""嗯"，&lt;3字符）</label></div>
      <div style="margin-bottom:4px"><label style="${subChkRow}"><input id="ruozhi-prefilter-symbols" type="checkbox" ${cb(config.prefilterSymbols)} style="accent-color:${COLOR.accent}">跳过纯符号/表情（如 "666""😂"）</label></div>
      <div style="margin-bottom:4px"><label style="${subChkRow}"><input id="ruozhi-prefilter-english" type="checkbox" ${cb(config.prefilterEnglish)} style="accent-color:${COLOR.accent}">跳过纯英文短评（如 "good""nb"）</label></div>
    </div>

    <!-- 推荐视频过滤 [测试版] -->
    <div style="${cardStyle}">
      <div style="${secLabel}">推荐视频过滤 <span style="font-weight:400;color:${COLOR.purple};font-size:10px;margin-left:4px">测试版</span></div>
      <div style="font-size:12px;color:${COLOR.muted};margin-bottom:10px">AI 判定右侧推荐视频列表中的标题，自动隐藏违规推荐。</div>
      <div style="margin-bottom:8px">
        <label style="${chkRow}">
          <input id="ruozhi-rcmd-enable" type="checkbox" ${cb(config.enableRcmdFilter)} style="accent-color:${COLOR.purple}">
          启用推荐视频过滤
        </label>
      </div>
      <div id="ruozhi-rcmd-prompt-row" style="display:${config.enableRcmdFilter ? "" : "none"}">
        <div style="font-size:12px;color:${COLOR.secondary};margin-bottom:4px">Prompt（留空则复用上方的过滤规则）</div>
        <textarea id="ruozhi-rcmd-prompt" rows="4" style="${is};resize:vertical;line-height:1.5">${esc(config.rcmdPrompt)}</textarea>
      </div>
    </div>

    <!-- 操作区 -->
    <div style="padding-top:8px;margin-top:12px">
      <button id="ruozhi-save" style="width:100%;padding:10px;border:none;border-radius:6px;background:${COLOR.accent};color:${COLOR.textOnAccent};font-size:14px;font-weight:600;cursor:pointer;font-family:${FONT};margin-bottom:8px">保存设置</button>

      <div style="font-size:11px;font-weight:600;color:${COLOR.muted};margin-bottom:6px;margin-top:12px">数据管理</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        <button id="ruozhi-clear-cache" style="padding:7px;border:1px solid ${COLOR.border};border-radius:4px;background:${COLOR.bg};color:${COLOR.secondary};font-size:12px;cursor:pointer;font-family:${FONT}">清除缓存</button>
        <button id="ruozhi-clear-stats" style="padding:7px;border:1px solid ${COLOR.border};border-radius:4px;background:${COLOR.bg};color:${COLOR.secondary};font-size:12px;cursor:pointer;font-family:${FONT}">重置统计</button>
        <button id="ruozhi-clear-bl" style="padding:7px;border:1px solid ${COLOR.red}33;border-radius:4px;background:${COLOR.bg};color:${COLOR.red};font-size:12px;cursor:pointer;font-family:${FONT}">清空黑名单</button>
        <button id="ruozhi-clear-learning" style="padding:7px;border:1px solid ${COLOR.amber}33;border-radius:4px;background:${COLOR.bg};color:${COLOR.amber};font-size:12px;cursor:pointer;font-family:${FONT}">清除学习记录</button>
      </div>
    </div>

    <div id="ruozhi-status" style="margin-top:10px;font-size:13px;min-height:20px;text-align:center"></div>
  </div>

  <!-- ========== 统计 Tab（含黑名单） ========== -->
  <div id="ruozhi-tab-stats" style="display:none;overflow-y:auto;flex:1;padding:16px 20px">
    <div id="ruozhi-stats-content" style="font-size:14px">
      <div style="text-align:center;color:${COLOR.muted};padding:24px">暂无统计数据，等待首次 API 调用…</div>
    </div>
    <div id="ruozhi-blacklist-panel" style="display:none;margin-top:16px;border-top:1px solid ${COLOR.border};padding-top:14px">
      <div style="font-size:12px;font-weight:600;color:${COLOR.secondary};margin-bottom:8px">黑名单</div>
      <div id="ruozhi-blacklist-content" style="font-family:${FONT}"></div>
      <div id="ruozhi-bl-more" style="display:none;text-align:center;padding:8px">
        <button id="ruozhi-bl-loadmore" style="padding:4px 20px;font-size:12px;border:1px solid ${COLOR.border};border-radius:4px;background:${COLOR.bg};color:${COLOR.secondary};cursor:pointer;font-family:${FONT}">加载更多</button>
      </div>
    </div>
  </div>

  <!-- ========== 学习 Tab（含知识库） ========== -->
  <div id="ruozhi-tab-learning" style="display:none;overflow-y:auto;flex:1;padding:16px 20px">
    <!-- 语境知识库（置顶） -->
    <div id="ruozhi-kb-panel" style="display:none;margin-bottom:16px">
      <div style="font-size:11px;font-weight:600;color:${COLOR.secondary};margin-bottom:8px;text-transform:uppercase;letter-spacing:0.05em">语境知识库</div>
      <div style="font-size:12px;color:${COLOR.muted};margin-bottom:10px">添加语境知识，辅助 AI 判断反讽、引用或特定称呼，避免误伤。</div>
      <div style="margin-bottom:10px;display:flex;gap:6px">
        <input id="ruozhi-kb-input" type="text" placeholder="例如：XX 是对 XX 的歧视性称呼"
          style="flex:1;${is}">
        <button id="ruozhi-kb-add" style="padding:7px 14px;border:none;border-radius:4px;background:${COLOR.accent};color:${COLOR.textOnAccent};font-size:13px;cursor:pointer;white-space:nowrap;font-family:${FONT}">添加</button>
      </div>
      <div id="ruozhi-kb-list" style="font-size:13px;color:${COLOR.text}">${kbItems || '<div style="text-align:center;color:' + COLOR.muted + ';padding:20px">暂无条目</div>'}</div>
      <div style="margin-top:10px;display:flex;gap:6px">
        <button id="ruozhi-kb-export" style="padding:4px 12px;border:1px solid ${COLOR.border};border-radius:4px;background:${COLOR.bg};color:${COLOR.secondary};font-size:12px;cursor:pointer;font-family:${FONT}">导出</button>
        <button id="ruozhi-kb-import" style="padding:4px 12px;border:1px solid ${COLOR.border};border-radius:4px;background:${COLOR.bg};color:${COLOR.secondary};font-size:12px;cursor:pointer;font-family:${FONT}">导入</button>
        <input id="ruozhi-kb-file" type="file" accept=".json" style="display:none">
      </div>
      <div id="ruozhi-kb-status" style="margin-top:10px;font-size:13px;min-height:18px"></div>
    </div>
    <!-- 学习记录 -->
    <div id="ruozhi-learning-content" style="font-family:${FONT}">加载中…</div>
  </div>
</div>`;
}

// ──────────────────────────────────────────────
// 面板事件绑定
// ──────────────────────────────────────────────

function bindPanelEvents(
  root: HTMLElement,
  config: FilterConfig,
  onConfigChange: (cfg: FilterConfig) => void,
): void {
  // Tab 切换
  const tabs = root.querySelectorAll(".ruozhi-tab");

  // 面板关闭按钮
  root.querySelector("#ruozhi-panel-close")?.addEventListener("click", () => {
    if (panelRoot) {
      panelRoot.style.display = "none";
      panelVisible = false;
    }
  });

  tabs.forEach((tab) => {
    tab.addEventListener("click", async () => {
      // 移除所有激活态
      tabs.forEach((t) => {
        t.classList.remove("active");
        (t as HTMLElement).style.background = "transparent";
        (t as HTMLElement).style.color = COLOR.secondary;
        (t as HTMLElement).style.fontWeight = "400";
        (t as HTMLElement).style.borderBottomColor = "transparent";
      });
      // 设置当前激活态
      const t = tab as HTMLElement;
      t.classList.add("active");
      t.style.background = COLOR.accent;
      t.style.color = COLOR.textOnAccent;
      t.style.fontWeight = "600";
      t.style.borderBottomColor = COLOR.accent;

      const tabName = t.dataset.tab;
      const sections: Record<string, HTMLElement | null> = {
        设置: root.querySelector("#ruozhi-tab-settings") as HTMLElement,
        统计: root.querySelector("#ruozhi-tab-stats") as HTMLElement,
        学习: root.querySelector("#ruozhi-tab-learning") as HTMLElement,
      };

      Object.values(sections).forEach(
        (el) => el && (el.style.display = "none"),
      );

      if (tabName === "设置" && sections["设置"]) {
        sections["设置"].style.display = "block";
      } else if (tabName === "统计" && sections["统计"]) {
        sections["统计"].style.display = "block";
        updateStatsPanel();
        loadBlacklistChunk(root, 0);
      } else if (tabName === "学习" && sections["学习"]) {
        sections["学习"].style.display = "block";
        const contentEl = root.querySelector("#ruozhi-learning-content");
        if (contentEl) {
          contentEl.innerHTML = buildLearningPanelHTML();
          bindLearningEvents(contentEl);
        }
        showKBPanel(root);
        bindKnowledgeEvents(root);
      }
    });
  });

  // 保存
  root.querySelector("#ruozhi-save")?.addEventListener("click", () => {
    let storedConfig: Partial<FilterConfig> = {};
    try {
      storedConfig = JSON.parse(GM_getValue("ruozhi-config", "{}"));
    } catch {
      /* */
    }

    const newConfig: FilterConfig = {
      ...config,
      learnedProfile:
        storedConfig.learnedProfile ?? config.learnedProfile ?? "",
      learningCorrections:
        storedConfig.learningCorrections ?? config.learningCorrections ?? [],
      lastRefinedCount:
        storedConfig.lastRefinedCount ?? config.lastRefinedCount ?? 0,
      knowledgeBase: storedConfig.knowledgeBase ?? config.knowledgeBase ?? [],
      theme:
        ((root.querySelector("#ruozhi-theme") as HTMLSelectElement)
          ?.value as ThemeName) ?? "github",
      provider:
        ((root.querySelector("#ruozhi-provider") as HTMLSelectElement)
          ?.value as ProviderName) ?? "deepseek",
      model:
        (root.querySelector("#ruozhi-model") as HTMLInputElement)?.value ??
        config.model,
      apiKey:
        (root.querySelector("#ruozhi-apikey") as HTMLInputElement)?.value ?? "",
      // 按提供商分别记忆密钥
      apiKeys: {
        ...(config.apiKeys ?? {}),
        ...(storedConfig.apiKeys ?? {}),
        [((root.querySelector("#ruozhi-provider") as HTMLSelectElement)
          ?.value as ProviderName) ?? "deepseek"]:
          (root.querySelector("#ruozhi-apikey") as HTMLInputElement)?.value ??
          "",
      },
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
      fontScale:
        parseFloat(
          (root.querySelector("#ruozhi-font-scale-label") as HTMLElement)
            ?.textContent ?? "1.0",
        ) || 1.0,
      prefilterShort:
        (root.querySelector("#ruozhi-prefilter-short") as HTMLInputElement)
          ?.checked ?? false,
      prefilterSymbols:
        (root.querySelector("#ruozhi-prefilter-symbols") as HTMLInputElement)
          ?.checked ?? false,
      prefilterEnglish:
        (root.querySelector("#ruozhi-prefilter-english") as HTMLInputElement)
          ?.checked ?? false,
      enableRcmdFilter:
        (root.querySelector("#ruozhi-rcmd-enable") as HTMLInputElement)
          ?.checked ?? false,
      rcmdPrompt:
        (root.querySelector("#ruozhi-rcmd-prompt") as HTMLTextAreaElement)
          ?.value ?? "",
    };
    saveConfig(newConfig);
    onConfigChange(newConfig);
    showPanelStatus(root, "已保存", COLOR.green);
  });

  // 推荐视频过滤开关联动
  root.querySelector("#ruozhi-rcmd-enable")?.addEventListener("change", () => {
    const checked = (
      root.querySelector("#ruozhi-rcmd-enable") as HTMLInputElement
    )?.checked;
    const promptRow = root.querySelector(
      "#ruozhi-rcmd-prompt-row",
    ) as HTMLElement;
    if (promptRow) promptRow.style.display = checked ? "" : "none";
  });

  // 黑名单开关联动
  root.querySelector("#ruozhi-enable-bl")?.addEventListener("change", () => {
    const checked = (
      root.querySelector("#ruozhi-enable-bl") as HTMLInputElement
    )?.checked;
    const confirmRow = root.querySelector(
      "#ruozhi-bl-confirm-row",
    ) as HTMLElement;
    if (confirmRow) confirmRow.style.display = checked ? "" : "none";
  });

  // 提供商切换：自动填入 endpoint + model + key，并控制 API Key 行显隐
  root.querySelector("#ruozhi-provider")?.addEventListener("change", () => {
    const val = (root.querySelector("#ruozhi-provider") as HTMLSelectElement)
      ?.value as ProviderName;
    if (!val) return;
    const preset = PROVIDER_PRESETS[val];
    const endpointEl = root.querySelector(
      "#ruozhi-endpoint",
    ) as HTMLInputElement;
    const modelEl = root.querySelector("#ruozhi-model") as HTMLInputElement;
    const apiKeyEl = root.querySelector("#ruozhi-apikey") as HTMLInputElement;
    const apiKeyRow = root.querySelector("#ruozhi-apikey-row") as HTMLElement;
    if (endpointEl && preset.endpoint) endpointEl.value = preset.endpoint;
    if (modelEl && preset.model) modelEl.value = preset.model;
    // 回填该提供商上次保存的密钥
    if (apiKeyEl) {
      apiKeyEl.value = config.apiKeys[val] ?? "";
    }
    if (apiKeyRow) {
      apiKeyRow.style.display = preset.needsAuth ? "" : "none";
    }
  });

  // 初始同步：根据当前 provider 控制 API Key 行显隐
  const initProvider = (
    root.querySelector("#ruozhi-provider") as HTMLSelectElement
  )?.value as ProviderName;
  if (initProvider) {
    const preset = PROVIDER_PRESETS[initProvider];
    const apiKeyRow = root.querySelector("#ruozhi-apikey-row") as HTMLElement;
    if (apiKeyRow && !preset.needsAuth) {
      apiKeyRow.style.display = "none";
    }
  }

  // 测试连接
  root.querySelector("#ruozhi-test")?.addEventListener("click", async () => {
    const provider = (
      root.querySelector("#ruozhi-provider") as HTMLSelectElement
    )?.value as ProviderName;
    const needsAuth = PROVIDER_PRESETS[provider]?.needsAuth ?? true;
    const apiKey = (root.querySelector("#ruozhi-apikey") as HTMLInputElement)
      ?.value;
    const apiEndpoint =
      (root.querySelector("#ruozhi-endpoint") as HTMLInputElement)?.value ??
      config.apiEndpoint;
    const model =
      (root.querySelector("#ruozhi-model") as HTMLInputElement)?.value ??
      config.model;
    const testStatus = root.querySelector("#ruozhi-test-status") as HTMLElement;
    if (needsAuth && !apiKey) {
      if (testStatus) {
        testStatus.textContent = "请先填写 API Key";
        testStatus.style.color = COLOR.amber;
      }
      return;
    }
    if (testStatus) {
      testStatus.textContent = "测试中…";
      testStatus.style.color = COLOR.secondary;
    }
    const ok = await testAPIConnection({
      ...config,
      apiKey,
      apiEndpoint,
      model,
    });
    if (testStatus) {
      testStatus.textContent = ok ? "连接成功" : "连接失败";
      testStatus.style.color = ok ? COLOR.green : COLOR.red;
    }
  });

  // 清除缓存
  root
    .querySelector("#ruozhi-clear-cache")
    ?.addEventListener("click", async () => {
      await clearCache();
      showPanelStatus(root, "缓存已清除", COLOR.green);
    });

  // 清空黑名单
  root
    .querySelector("#ruozhi-clear-bl")
    ?.addEventListener("click", async () => {
      if (!confirm("确定清空所有黑名单记录？此操作不可撤销。")) return;
      await clearBlacklist();
      _blCache = null;
      showPanelStatus(root, "黑名单已清空", COLOR.green);
      const blContent = root.querySelector("#ruozhi-blacklist-content");
      if (blContent)
        blContent.innerHTML = `<div style="padding:24px;text-align:center;color:${COLOR.muted}">暂无黑名单记录</div>`;
    });

  // 清除学习记录
  root
    .querySelector("#ruozhi-clear-learning")
    ?.addEventListener("click", () => {
      if (!confirm("确定清除所有学习记录？此操作不可撤销。")) return;
      clearLearning();
      showPanelStatus(root, "学习记录已清除", COLOR.green);
    });

  // 重置统计 (事件委托)
  root.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest("#ruozhi-clear-stats")) return;
    if (!confirm("确定重置所有统计数据？此操作不可撤销。")) return;
    resetStats();
    updateStatsPanel();
    showPanelStatus(root, "统计已重置", COLOR.green);
  });

  // 主题切换（即时生效）
  root.querySelector("#ruozhi-theme")?.addEventListener("change", () => {
    const themeName = (root.querySelector("#ruozhi-theme") as HTMLSelectElement)
      ?.value as ThemeName;
    if (!themeName) return;
    applyTheme(themeName);
    // 立即保存主题偏好
    try {
      const stored = JSON.parse(GM_getValue("ruozhi-config", "{}"));
      stored.theme = themeName;
      GM_setValue("ruozhi-config", JSON.stringify(stored));
      refreshConfig({ ...config, theme: themeName });
    } catch {
      /* */
    }
    // 重建面板以应用新主题
    panelRoot?.remove();
    panelRoot = null;
    panelVisible = false;
    toggleSettingsPanel({ ...config, theme: themeName }, onConfigChange);
  });

  // 字体缩放（即时生效）
  const fontLabel = root.querySelector(
    "#ruozhi-font-scale-label",
  ) as HTMLElement;
  const fabContainer = document.getElementById("ruozhi-fab-container");

  function applyFontScale(scale: number): void {
    const clamped = Math.round(Math.min(1.5, Math.max(0.8, scale)) * 10) / 10;
    if (fontLabel) fontLabel.textContent = clamped.toFixed(1) + "x";
    if (panelRoot) (panelRoot as HTMLElement).style.zoom = String(clamped);
    if (fabContainer) fabContainer.style.zoom = String(clamped);
  }

  root.querySelector("#ruozhi-font-down")?.addEventListener("click", () => {
    const cur = parseFloat(fontLabel?.textContent ?? "1.0");
    applyFontScale(cur - 0.1);
  });

  root.querySelector("#ruozhi-font-up")?.addEventListener("click", () => {
    const cur = parseFloat(fontLabel?.textContent ?? "1.0");
    applyFontScale(cur + 0.1);
  });

  root.querySelector("#ruozhi-font-reset")?.addEventListener("click", () => {
    applyFontScale(1.0);
  });
}

function showPanelStatus(root: HTMLElement, msg: string, color: string): void {
  const el = root.querySelector("#ruozhi-status") as HTMLElement;
  if (el) {
    el.style.opacity = "0";
    requestAnimationFrame(() => {
      el.textContent = msg;
      (el as HTMLElement).style.color = color;
      el.style.opacity = "1";
    });
  }
}

// ──────────────────────────────────────────────
// 黑名单分页加载（统计 Tab 底部）
// ──────────────────────────────────────────────

const BL_PAGE_SIZE = 15;
let _blCache: BlacklistRecord[] | null = null;
let _blOffset = 0;

function showKBPanel(root: HTMLElement): void {
  const panel = root.querySelector("#ruozhi-kb-panel") as HTMLElement;
  if (panel) panel.style.display = "";
}

async function loadBlacklistChunk(
  root: HTMLElement,
  offset: number,
): Promise<void> {
  const panel = root.querySelector("#ruozhi-blacklist-panel") as HTMLElement;
  const contentEl = root.querySelector("#ruozhi-blacklist-content");
  const moreEl = root.querySelector("#ruozhi-bl-more") as HTMLElement;
  if (!panel || !contentEl) return;

  if (_blCache === null) {
    _blCache = await getAllBlacklist();
    _blCache.sort((a, b) => b.timestamp - a.timestamp);
    _blOffset = 0;
  }

  if (offset === 0) {
    _blOffset = 0;
    contentEl.innerHTML = "";
  }

  if (_blCache.length === 0) {
    panel.style.display = "";
    contentEl.innerHTML = `<div style="padding:16px;text-align:center;color:${COLOR.muted}">暂无黑名单记录</div>`;
    if (moreEl) moreEl.style.display = "none";
    return;
  }

  panel.style.display = "";
  const chunk = _blCache.slice(_blOffset, _blOffset + BL_PAGE_SIZE);
  _blOffset += chunk.length;

  const fragment = chunk
    .map((r) => {
      const date = new Date(r.timestamp).toLocaleString("zh-CN");
      const mid = r.mid;
      const srcLabel = r.source === "manual" ? "手动" : "AI";
      const srcColor = r.source === "manual" ? COLOR.red : COLOR.blue;
      return `
      <div style="padding:9px 0;border-bottom:1px solid ${COLOR.border};font-size:12px;font-family:${FONT}">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span><span style="font-weight:500">${esc(r.uname)}</span> <span style="background:${srcColor};color:#fff;font-size:9px;padding:0 4px;border-radius:2px">${srcLabel}</span></span>
          <span style="font-size:10px;color:${COLOR.secondary}">${date}</span>
        </div>
        <div style="color:${COLOR.secondary};margin:3px 0">${esc(r.message.slice(0, 80))}${r.message.length > 80 ? "…" : ""}</div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="color:${COLOR.muted};font-size:11px">${esc(r.reason)}</span>
          <button class="ruozhi-remove-bl" data-mid="${mid}"
            style="padding:1px 6px;font-size:10px;background:${COLOR.bg};border:1px solid ${COLOR.border};border-radius:3px;cursor:pointer;font-family:${FONT};color:${COLOR.secondary}">移除</button>
        </div>
      </div>`;
    })
    .join("");

  if (offset === 0) {
    contentEl.innerHTML = fragment;
  } else {
    contentEl.insertAdjacentHTML("beforeend", fragment);
  }

  bindBlacklistEvents(contentEl);

  if (_blOffset < _blCache.length) {
    if (moreEl) moreEl.style.display = "";
    const btn = root.querySelector("#ruozhi-bl-loadmore");
    if (btn) {
      const newBtn = btn.cloneNode(true) as HTMLElement;
      btn.parentNode?.replaceChild(newBtn, btn);
      newBtn.addEventListener("click", () =>
        loadBlacklistChunk(root, _blOffset),
      );
    }
  } else {
    if (moreEl) moreEl.style.display = "none";
  }
}

// ──────────────────────────────────────────────
// 知识库
// ──────────────────────────────────────────────

function refreshKBList(root: HTMLElement): void {
  const list = root.querySelector("#ruozhi-kb-list");
  if (!list) return;
  try {
    const raw = GM_getValue("ruozhi-config", "{}");
    const cfg = JSON.parse(raw);
    const kb: string[] = Array.isArray(cfg.knowledgeBase)
      ? cfg.knowledgeBase
      : [];
    list.innerHTML = kb
      .map(
        (e, i) =>
          `<div class="ruozhi-kb-item" style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid ${COLOR.border}"><span style="flex:1;word-break:break-word;font-size:13px">${esc(e)}</span><button class="ruozhi-kb-del" data-index="${i}" style="padding:1px 6px;font-size:11px;background:none;border:1px solid ${COLOR.border};border-radius:3px;color:${COLOR.secondary};cursor:pointer;font-family:${FONT}">&times;</button></div>`,
      )
      .join("");
    if (kb.length === 0) {
      list.innerHTML = `<div style="text-align:center;color:${COLOR.muted};padding:20px">暂无条目</div>`;
    }
  } catch {
    /* */
  }
}

function bindKnowledgeEvents(root: HTMLElement): void {
  root.querySelector("#ruozhi-kb-add")?.addEventListener("click", () => {
    const input = root.querySelector("#ruozhi-kb-input") as HTMLInputElement;
    const val = input?.value?.trim();
    if (!val) return;
    try {
      const cfg = JSON.parse(GM_getValue("ruozhi-config", "{}"));
      if (!Array.isArray(cfg.knowledgeBase)) cfg.knowledgeBase = [];
      if (cfg.knowledgeBase.includes(val)) {
        kbStatus(root, "该条目已存在", COLOR.amber);
        return;
      }
      cfg.knowledgeBase.push(val);
      GM_setValue("ruozhi-config", JSON.stringify(cfg));
      refreshConfig(cfg);
      input.value = "";
      refreshKBList(root);
      kbStatus(root, "已添加", COLOR.green);
    } catch {
      /* */
    }
  });

  root.querySelector("#ruozhi-kb-input")?.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") {
      (root.querySelector("#ruozhi-kb-add") as HTMLElement)?.click();
    }
  });

  // ── 导出知识库 ──
  const exportBtn = root.querySelector("#ruozhi-kb-export") as HTMLElement;
  if (exportBtn && !exportBtn.dataset.bound) {
    exportBtn.dataset.bound = "1";
    exportBtn.addEventListener("click", () => {
      try {
        const cfg = JSON.parse(GM_getValue("ruozhi-config", "{}"));
        const entries = Array.isArray(cfg.knowledgeBase)
          ? cfg.knowledgeBase
          : [];
        const blob = new Blob(
          [
            JSON.stringify(
              {
                version: 1,
                description: "B站评论过滤 · 语境知识库",
                exportedAt: new Date().toISOString(),
                entryCount: entries.length,
                entries,
              },
              null,
              2,
            ),
          ],
          { type: "application/json" },
        );
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `ruozhi-kb-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        kbStatus(root, `已导出 ${entries.length} 条`, COLOR.green);
      } catch {
        kbStatus(root, "导出失败", COLOR.red);
      }
    });
  }

  // ── 导入知识库 ──
  const fileInput = root.querySelector("#ruozhi-kb-file") as HTMLInputElement;
  const importBtn = root.querySelector("#ruozhi-kb-import") as HTMLElement;
  if (importBtn && !importBtn.dataset.bound) {
    importBtn.dataset.bound = "1";
    importBtn.addEventListener("click", () => {
      fileInput?.click();
    });
    fileInput?.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data.entries || !Array.isArray(data.entries)) {
          kbStatus(root, "格式无效：缺少 entries 数组", COLOR.red);
          return;
        }
        const incoming = (data.entries as string[])
          .filter((e) => typeof e === "string" && e.trim().length > 0)
          .map((e) => e.trim());
        if (incoming.length === 0) {
          kbStatus(root, "文件中无有效条目", COLOR.amber);
          return;
        }
        const cfg = JSON.parse(GM_getValue("ruozhi-config", "{}"));
        if (!Array.isArray(cfg.knowledgeBase)) cfg.knowledgeBase = [];
        let added = 0;
        for (const entry of incoming) {
          if (!cfg.knowledgeBase.includes(entry)) {
            cfg.knowledgeBase.push(entry);
            added++;
          }
        }
        GM_setValue("ruozhi-config", JSON.stringify(cfg));
        refreshConfig(cfg);
        refreshKBList(root);
        kbStatus(
          root,
          `导入了 ${added} 条 (共 ${incoming.length} 条，跳过 ${incoming.length - added} 条重复)`,
          COLOR.green,
        );
      } catch {
        kbStatus(root, "文件解析失败，请检查 JSON 格式", COLOR.red);
      } finally {
        fileInput.value = "";
      }
    });
  }

  root.querySelector("#ruozhi-kb-list")?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(".ruozhi-kb-del");
    if (!btn) return;
    const idx = parseInt((btn as HTMLElement).dataset.index ?? "-1");
    if (idx < 0) return;
    try {
      const cfg = JSON.parse(GM_getValue("ruozhi-config", "{}"));
      if (Array.isArray(cfg.knowledgeBase)) {
        cfg.knowledgeBase.splice(idx, 1);
        GM_setValue("ruozhi-config", JSON.stringify(cfg));
        refreshConfig(cfg);
        refreshKBList(root);
      }
    } catch {
      /* */
    }
  });
}

function kbStatus(root: HTMLElement, msg: string, color: string): void {
  const el = root.querySelector("#ruozhi-kb-status") as HTMLElement;
  if (el) {
    el.style.opacity = "0";
    requestAnimationFrame(() => {
      el.textContent = msg;
      el.style.color = color;
      el.style.opacity = "1";
    });
  }
}

// ──────────────────────────────────────────────
// 统计面板
// ──────────────────────────────────────────────

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

  const sevLabels: Record<string, string> = {
    low: "轻微",
    medium: "违规",
    high: "严重",
    block: "拉黑",
  };
  let sevHTML = "";
  for (const [sev, count] of Object.entries(s.severityCounts).sort()) {
    const label = sevLabels[sev] ?? sev;
    sevHTML += `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid ${COLOR.border};font-size:13px"><span>${label}</span><span style="font-weight:500">${count}</span></div>`;
  }

  const ls = getLearningStats();

  contentEl.innerHTML = `
    <div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:600;color:${COLOR.secondary};margin-bottom:10px">累计统计</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
        <div class="ruozhi-stat-card" style="background:${COLOR.surface};padding:10px;border-radius:6px;text-align:center"><div style="font-size:18px;font-weight:600;color:${COLOR.secondary}">${s.totalScanned}</div><div style="font-size:10px;color:${COLOR.muted};margin-top:2px">已扫描</div></div>
        <div class="ruozhi-stat-card" style="background:${COLOR.surface};padding:10px;border-radius:6px;text-align:center"><div style="font-size:18px;font-weight:600;color:${COLOR.text}">${s.totalFiltered}</div><div style="font-size:10px;color:${COLOR.muted};margin-top:2px">已过滤</div></div>
        <div class="ruozhi-stat-card" style="background:${COLOR.surface};padding:10px;border-radius:6px;text-align:center"><div style="font-size:18px;font-weight:600;color:${COLOR.blue}">${s.apiCalls}</div><div style="font-size:10px;color:${COLOR.muted};margin-top:2px">API 调用</div></div>
        <div class="ruozhi-stat-card" style="background:${COLOR.surface};padding:10px;border-radius:6px;text-align:center"><div style="font-size:18px;font-weight:600;color:${COLOR.amber}">${tokensPerK}K</div><div style="font-size:10px;color:${COLOR.muted};margin-top:2px">Token</div></div>
        <div class="ruozhi-stat-card" style="background:${COLOR.surface};padding:10px;border-radius:6px;text-align:center"><div style="font-size:18px;font-weight:600;color:${COLOR.green}">&yen;${costEst}</div><div style="font-size:10px;color:${COLOR.muted};margin-top:2px">预估费用</div></div>
        <div class="ruozhi-stat-card" style="background:${COLOR.redBg};padding:10px;border-radius:6px;text-align:center;cursor:pointer" id="ruozhi-clear-stats"><div style="font-size:14px;color:${COLOR.red}">重置</div><div style="font-size:10px;color:${COLOR.red};margin-top:2px">统计</div></div>
      </div>
    </div>
    <div style="margin-top:16px">
      <div style="font-size:11px;font-weight:600;color:${COLOR.secondary};margin-bottom:8px">严重度分布</div>
      ${sevHTML || `<div style="color:${COLOR.muted};text-align:center;padding:10px;font-size:12px">暂无数据</div>`}
    </div>
    ${
      ls.total > 0
        ? `<div style="margin-top:16px">
      <div style="font-size:11px;font-weight:600;color:${COLOR.secondary};margin-bottom:8px">AI 学习</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
        <div class="ruozhi-stat-card" style="background:${COLOR.greenBg};padding:8px;border-radius:6px;text-align:center"><div style="font-size:16px;font-weight:600;color:${COLOR.green}">${ls.unblockCount + ls.misjudgeCount}</div><div style="font-size:10px;color:${COLOR.muted}">纠正误判</div></div>
        <div class="ruozhi-stat-card" style="background:${COLOR.amberBg};padding:8px;border-radius:6px;text-align:center"><div style="font-size:16px;font-weight:600;color:${COLOR.amber}">${ls.manualCount}</div><div style="font-size:10px;color:${COLOR.muted}">补充漏判</div></div>
        <div class="ruozhi-stat-card" style="background:${COLOR.purpleBg};padding:8px;border-radius:6px;text-align:center"><div style="font-size:16px;font-weight:600;color:${COLOR.purple}">${ls.total}</div><div style="font-size:10px;color:${COLOR.muted}">总计</div></div>
      </div>
    </div>`
        : ""
    }
    <div style="margin-top:16px;font-size:10px;color:${COLOR.muted};text-align:center">DeepSeek-chat &yen;${price}/1M tokens &middot; prompt: ${(s.promptTokens / 1000).toFixed(1)}K &middot; completion: ${(s.completionTokens / 1000).toFixed(1)}K</div>`;
}

// ──────────────────────────────────────────────
// 黑名单面板 HTML
// ──────────────────────────────────────────────

export async function buildBlacklistPanelHTML(): Promise<string> {
  const records = await getAllBlacklist();

  if (records.length === 0) {
    return `<div style="padding:24px;text-align:center;color:${COLOR.muted}">暂无黑名单记录</div>`;
  }

  const rows = records
    .sort((a, b) => b.timestamp - a.timestamp)
    .map((r) => {
      const date = new Date(r.timestamp).toLocaleString("zh-CN");
      const mid = r.mid;
      const srcLabel = r.source === "manual" ? "手动" : "AI";
      const srcColor = r.source === "manual" ? COLOR.red : COLOR.blue;
      return `
      <div style="padding:10px 12px;border-bottom:1px solid ${COLOR.border};font-size:13px;font-family:${FONT}">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span><span style="font-weight:500">${esc(r.uname)}</span> <span style="background:${srcColor};color:#fff;font-size:10px;padding:1px 5px;border-radius:3px;margin-left:4px">${srcLabel}</span></span>
          <span style="font-size:11px;color:${COLOR.secondary}">${date}</span>
        </div>
        <div style="color:${COLOR.secondary};margin:4px 0">${esc(r.message.slice(0, 100))}${r.message.length > 100 ? "…" : ""}</div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="color:${COLOR.muted};font-size:12px">${esc(r.reason)}</span>
          <button class="ruozhi-remove-bl" data-mid="${mid}"
            style="padding:2px 8px;font-size:11px;background:${COLOR.bg};border:1px solid ${COLOR.border};border-radius:3px;cursor:pointer;font-family:${FONT};color:${COLOR.secondary}">
            移除
          </button>
        </div>
        <div style="font-size:10px;color:${COLOR.muted};margin-top:2px">${esc(r.videoTitle)}</div>
      </div>`;
    })
    .join("");

  return rows;
}

function bindBlacklistEvents(container: Element): void {
  container.querySelectorAll(".ruozhi-remove-bl").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const mid = parseInt((btn as HTMLElement).dataset.mid ?? "0");
      if (mid) {
        await removeFromBlacklist(mid);
        _blCache = null;
        const root = container.closest("#ruozhi-panel") as HTMLElement;
        if (root) loadBlacklistChunk(root, 0);
      }
    });
  });
}

// ──────────────────────────────────────────────
// 学习面板
// ──────────────────────────────────────────────

function buildLearningPanelHTML(): string {
  const records = getLearningRecords();
  const profile = getLearnedProfile();
  const pendingCount = getPendingCount();

  const profileSection = profile
    ? `<div style="margin:0 8px 12px 8px;padding:12px;background:${COLOR.purpleBg};border:1px solid ${COLOR.border};border-radius:6px;font-family:${FONT}">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <span style="font-size:12px;font-weight:600;color:${COLOR.purple}">AI 学习画像（可编辑）</span>
      <span style="font-size:10px;color:${COLOR.secondary}">每次 API 调用自动注入</span>
    </div>
    <textarea id="ruozhi-profile-edit" rows="8" style="width:100%;padding:8px;border:1px solid ${COLOR.border};border-radius:4px;font-size:12px;color:${COLOR.text};background:${COLOR.surface};resize:vertical;box-sizing:border-box;line-height:1.6;font-family:${FONT};outline:none;color-scheme:${COLOR === THEMES.dark ? "dark" : "light"}">${esc(profile)}</textarea>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
      <div style="display:flex;gap:6px">
        <button id="ruozhi-profile-save" style="padding:4px 12px;font-size:11px;border:none;border-radius:4px;background:${COLOR.purple};color:${COLOR.textOnAccent};cursor:pointer;font-family:${FONT}">保存画像</button>
        <button id="ruozhi-profile-regen" style="padding:4px 12px;font-size:11px;border:1px solid ${COLOR.border};border-radius:4px;background:${COLOR.bg};color:${COLOR.amber};cursor:pointer;font-family:${FONT}" title="用全部记录重新生成画像">重新生成</button>
      </div>
      ${pendingCount > 0 ? `<span style="font-size:10px;color:${COLOR.amber}">待处理: ${pendingCount} (满 20 条自动更新)</span>` : `<span style="font-size:10px;color:${COLOR.green}">已同步 (${records.length} 条)</span>`}
    </div>
  </div>`
    : `<div style="margin:0 8px 12px 8px;padding:12px;background:${COLOR.surface};border:1px solid ${COLOR.border};border-radius:6px;text-align:center;font-family:${FONT}">
    <div style="font-size:12px;color:${COLOR.secondary};margin-bottom:4px">尚无 AI 学习画像</div>
    ${
      records.length > 0
        ? `<div style="font-size:11px;color:${COLOR.amber}">已收集 ${records.length} 条纠正，满 20 条后自动生成画像</div>`
        : `<div style="font-size:11px;color:${COLOR.muted}">执行「取消拉黑」「误判展开」「手动拉黑」后将自动学习</div>`
    }
  </div>`;

  if (records.length === 0) return profileSection;

  const typeLabel: Record<string, string> = {
    unblock: "取消拉黑",
    misjudge: "误判纠正",
    manual_blacklist: "补充拉黑",
  };
  const typeColor: Record<string, string> = {
    unblock: COLOR.green,
    misjudge: COLOR.blue,
    manual_blacklist: COLOR.red,
  };

  const rows = records
    .map((r, i) => {
      const date = new Date(r.timestamp).toLocaleString("zh-CN");
      const label = typeLabel[r.type] ?? r.type;
      const color = typeColor[r.type] ?? COLOR.secondary;
      const aiReasonHTML = r.aiReason
        ? `<div style="font-size:11px;color:${COLOR.amber};margin-top:2px">AI 曾判定: ${esc(r.aiReason)}${r.aiSeverity ? ` (${r.aiSeverity})` : ""}</div>`
        : "";
      return `
      <div style="padding:10px 12px;border-bottom:1px solid ${COLOR.border};font-size:13px;font-family:${FONT}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span style="color:${color};font-weight:500;font-size:12px">${label}</span>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:10px;color:${COLOR.muted}">${date}</span>
            <button class="ruozhi-remove-learning" data-index="${i}"
              style="padding:1px 6px;font-size:10px;background:none;border:1px solid ${COLOR.border};border-radius:3px;color:${COLOR.secondary};cursor:pointer;font-family:${FONT}">
              删除
            </button>
          </div>
        </div>
        <div style="color:${COLOR.text};line-height:1.5;word-break:break-word">${esc(r.message)}</div>
        ${aiReasonHTML}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px">
          <span style="font-size:10px;color:${COLOR.muted}">${esc(r.uname)}</span>
          ${r.videoTitle ? `<span style="font-size:10px;color:${COLOR.muted}">${esc(r.videoTitle.slice(0, 20))}${r.videoTitle.length > 20 ? "…" : ""}</span>` : ""}
        </div>
      </div>`;
    })
    .join("");

  const clearBtn = `<div style="padding:10px;text-align:center">
    <button id="ruozhi-clear-learning-inline"
      style="padding:4px 16px;font-size:11px;border:1px solid ${COLOR.border};border-radius:4px;background:${COLOR.bg};color:${COLOR.red};cursor:pointer;font-family:${FONT}">
      清空全部记录
    </button>
  </div>`;

  return profileSection + rows + clearBtn;
}

function bindLearningEvents(container: Element): void {
  container.querySelectorAll(".ruozhi-remove-learning").forEach((btn) => {
    btn.addEventListener("click", () => {
      const index = parseInt((btn as HTMLElement).dataset.index ?? "-1");
      if (index >= 0) {
        removeLearning(index);
        refreshLearningPanel(container);
      }
    });
  });

  const clearBtn = container.querySelector("#ruozhi-clear-learning-inline");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (!confirm("确定清空所有学习记录？")) return;
      clearLearning();
      refreshLearningPanel(container);
    });
  }

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
        const cfg = JSON.parse(GM_getValue("ruozhi-config", "{}"));
        cfg.learnedProfile = val.slice(0, 2000);
        GM_setValue("ruozhi-config", JSON.stringify(cfg));
        refreshConfig(cfg);
        profileEdit.value = val.slice(0, 2000);
        showToast("画像已保存", 2000);
      } catch {
        /* */
      }
    });
  }

  if (profileRegenBtn) {
    profileRegenBtn.addEventListener("click", async () => {
      (profileRegenBtn as HTMLElement).textContent = "生成中…";
      (profileRegenBtn as HTMLElement).style.pointerEvents = "none";
      try {
        await forceRefineProfile();
        refreshLearningPanel(container);
      } catch {
        /* */
      } finally {
        (profileRegenBtn as HTMLElement).textContent = "重新生成";
        (profileRegenBtn as HTMLElement).style.pointerEvents = "";
      }
    });
  }
}

function refreshLearningPanel(container: Element): void {
  const contentEl =
    container.querySelector("#ruozhi-learning-content") ?? container;
  contentEl.innerHTML = buildLearningPanelHTML();
  bindLearningEvents(contentEl);
}

// ──────────────────────────────────────────────
// 评论折叠/隐藏
// ──────────────────────────────────────────────

const TAG = "[ruozhi-filter]";

export function foldEl(
  el: Element,
  info: PendingComment,
  verdict: { reason: string; severity: string },
  style: "classic" | "light" | "dim" | "clean" = "classic",
): boolean {
  try {
    if ((el as HTMLElement).style.display === "none") return false;

    const labelMap: Record<string, string> = {
      low: "轻微不适",
      medium: "违规言论",
      high: "严重违规",
      block: "永久拉黑",
    };
    const label = labelMap[verdict.severity] ?? "已过滤";

    const severityAccent: Record<string, string> = {
      low: COLOR.muted,
      medium: COLOR.amber,
      high: COLOR.red,
      block: COLOR.purple,
    };
    const accent = severityAccent[verdict.severity] ?? COLOR.secondary;

    const showReportBtn =
      verdict.severity === "medium" ||
      verdict.severity === "high" ||
      verdict.severity === "block";

    const reportBtnsHTML = showReportBtn
      ? `<div style="margin-top:8px;display:flex;gap:8px">
  <button class="ruozhi-copy-reason" style="padding:3px 10px;font-size:11px;border:1px solid ${COLOR.border};border-radius:4px;background:${COLOR.bg};color:${COLOR.secondary};cursor:pointer;font-family:${FONT}">复制理由</button>
  <button class="ruozhi-report-btn" style="padding:3px 10px;font-size:11px;border:1px solid ${COLOR.red};border-radius:4px;background:${COLOR.bg};color:${COLOR.red};cursor:pointer;font-family:${FONT}">举报</button>
</div>`
      : "";

    const html = (() => {
      switch (style) {
        case "classic":
          return `<div class="ruozhi-folded" style="background:${COLOR.foldBg};border:1px solid ${COLOR.foldBorder};border-radius:4px;padding:8px 12px;margin:4px 0;font-size:12px;color:${COLOR.foldText};cursor:pointer;user-select:none;font-family:${FONT}">
<span style="margin-right:8px;font-weight:500">${esc(label)}</span><span style="font-weight:500">${esc(info.uname)}</span><span style="margin:0 8px;color:${COLOR.foldMuted}">|</span><span style="font-size:11px;color:${COLOR.foldMuted}">${esc(verdict.reason)}</span><span class="ruozhi-fold-arrow" data-collapsed="展开" data-expanded="收起" style="float:right;font-size:10px;color:${COLOR.foldMuted};line-height:1.8">展开</span>
</div><div class="ruozhi-original" style="display:none;padding:8px 12px;background:${COLOR.surface};border-left:3px solid ${COLOR.foldBorder};margin:4px 0;border-radius:0 4px 4px 0;font-size:13px;font-family:${FONT}">
<div style="margin-bottom:6px;font-size:11px;color:${COLOR.secondary}">AI 判定: <span style="font-weight:500">${esc(verdict.reason)}</span></div>
<div style="color:${COLOR.text};white-space:pre-wrap;word-break:break-word;line-height:1.5">${esc(info.message)}</div>${reportBtnsHTML}</div>`;
        case "dim": {
          const secHex = COLOR.secondary;
          const mutedHex = COLOR.muted;
          const surfHex = COLOR.surface;
          return `<div class="ruozhi-folded" style="padding:2px 8px;margin:1px 0;font-size:9px;color:${mutedHex};cursor:pointer;user-select:none;font-family:${FONT};line-height:1.2;transition:color .15s,background .15s;border-radius:4px"
  onmouseenter="this.style.color='${secHex}';this.style.background='${surfHex}'" onmouseleave="this.style.color='${mutedHex}';this.style.background='transparent'"
<span style="opacity:0.5">&middot;&middot;&middot;</span>
</div><div class="ruozhi-original" style="display:none;padding:4px 8px;margin:0 0 2px 0;font-size:11px;color:${COLOR.secondary};background:${COLOR.surface};border-left:2px solid ${COLOR.border};border-radius:0 4px 4px 0;font-family:${FONT}">
<div style="margin-bottom:2px;font-size:10px;color:${COLOR.muted}">${esc(verdict.reason)}</div>
<div style="color:${COLOR.secondary};white-space:pre-wrap;word-break:break-word">${esc(info.message)}</div>${reportBtnsHTML}</div>`;
        }
        case "clean":
          return `<div class="ruozhi-folded" style="height:15px;background:${COLOR.surface};border-left:4px solid ${accent};margin:1px 0;cursor:pointer;user-select:none;border-radius:0 2px 2px 0;transition:opacity .15s"
  onmouseenter="this.style.opacity='0.8'" onmouseleave="this.style.opacity='1'"
></div><div class="ruozhi-original" style="display:none;padding:6px 8px;background:${COLOR.surface};border-left:3px solid ${COLOR.border};margin:0 0 4px 0;font-size:12px;font-family:${FONT}">
<div style="filter:blur(6px);pointer-events:none;user-select:none;opacity:0.5;margin-bottom:6px">
<div style="font-size:11px;color:${COLOR.secondary};margin-bottom:4px">AI 判定: <span style="font-weight:500">${esc(verdict.reason)}</span></div>
<div style="color:${COLOR.text};white-space:pre-wrap;word-break:break-word;line-height:1.5">${esc(info.message)}</div>
</div>${reportBtnsHTML}</div>`;
        default: // light
          return `<div class="ruozhi-folded" style="height:15px;background:${COLOR.surface};border-left:4px solid ${accent};margin:1px 0;cursor:pointer;user-select:none;border-radius:0 2px 2px 0;transition:opacity .15s"
  onmouseenter="this.style.opacity='0.6'" onmouseleave="this.style.opacity='1'"
></div><div class="ruozhi-original" style="display:none;padding:6px 8px;background:${COLOR.surface};border-left:3px solid ${COLOR.border};margin:0 0 4px 0;font-size:12px;color:${COLOR.secondary};font-family:${FONT}">
<div style="color:${COLOR.secondary};white-space:pre-wrap;word-break:break-word">${esc(info.message)}</div>${reportBtnsHTML}</div>`;
      }
    })();

    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    const foldElDiv = wrapper.firstElementChild as HTMLElement;
    const origElDiv = foldElDiv.nextElementSibling as HTMLElement;
    el.parentNode?.insertBefore(foldElDiv, el);
    el.parentNode?.insertBefore(origElDiv, el);
    (el as HTMLElement).style.display = "none";

    // clean 模式：隐藏原评论上的拉黑/举报按钮（它们在 fold wrapper 之外）
    if (style === "clean") {
      const btns = (el as any).__ruozhiBtns as HTMLElement[] | undefined;
      if (btns) {
        for (const btn of btns) btn.style.display = "none";
      }
    }

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

    // 取消拉黑 / 误判按钮
    const blRecord = isBlacklistedSync(info.mid, info.uname);
    if (blRecord) {
      origElDiv.insertAdjacentHTML(
        "beforeend",
        `<div style="margin-top:8px;display:flex;gap:8px">
  <button class="ruozhi-unblock-btn" style="padding:3px 10px;font-size:11px;border:1px solid ${COLOR.green};border-radius:4px;background:${COLOR.bg};color:${COLOR.green};cursor:pointer;font-family:${FONT}">取消拉黑</button>
</div>`,
      );
      origElDiv
        .querySelector(".ruozhi-unblock-btn")
        ?.addEventListener("click", async (e) => {
          e.stopPropagation();
          try {
            const hash = commentHash(info.message, info.mid);
            await removeFromBlacklist(blRecord.mid);
            await deleteCommentFromCache(hash);
            recordLearning({
              type: "unblock",
              message: info.message,
              aiReason: blRecord.reason,
              aiSeverity: blRecord.severity,
              uname: info.uname,
              videoTitle: currentContext.videoTitle,
            });
            (el as HTMLElement).style.display = "";
            foldElDiv.remove();
            origElDiv.remove();
          } catch (err) {
            console.error(TAG, "Unblock failed:", err);
          }
        });
    } else {
      origElDiv.insertAdjacentHTML(
        "beforeend",
        `<div style="margin-top:8px;display:flex;gap:8px">
  <button class="ruozhi-misjudge-btn" style="padding:3px 10px;font-size:11px;border:1px solid ${COLOR.border};border-radius:4px;background:${COLOR.bg};color:${COLOR.secondary};cursor:pointer;font-family:${FONT}">误判 · 展开</button>
</div>`,
      );
      origElDiv
        .querySelector(".ruozhi-misjudge-btn")
        ?.addEventListener("click", async (e) => {
          e.stopPropagation();
          const hash = commentHash(info.message, info.mid);
          await deleteCommentFromCache(hash);
          recordLearning({
            type: "misjudge",
            message: info.message,
            aiReason: verdict.reason,
            aiSeverity: verdict.severity,
            uname: info.uname,
            videoTitle: currentContext.videoTitle,
          });
          (el as HTMLElement).style.display = "";
          foldElDiv.remove();
          origElDiv.remove();
        });
    }

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

export function hideEl(el: Element): boolean {
  try {
    (el as HTMLElement).style.display = "none";
    // 同时隐藏已注入的举报/拉黑按钮
    const btns = (el as any).__ruozhiBtns as HTMLElement[] | undefined;
    if (btns) {
      for (const btn of btns) btn.style.display = "none";
    }
    return true;
  } catch {
    return false;
  }
}

// ──────────────────────────────────────────────
// 手动拉黑按钮注入
// ──────────────────────────────────────────────

const blacklistButtonInjected = new WeakSet<Element>();

function blBtnStyle(): Record<string, string> {
  return {
    position: "relative",
    zIndex: "1",
    float: "right",
    marginTop: "4px",
    marginRight: "4px",
    padding: "1px 8px",
    fontSize: "10px",
    color: COLOR.muted,
    background: COLOR.bg,
    border: `1px solid ${COLOR.border}`,
    borderRadius: "8px",
    cursor: "pointer",
    userSelect: "none",
    fontFamily: FONT,
    lineHeight: "16px",
    whiteSpace: "nowrap",
    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
    transition: "color 0.15s, border-color 0.15s, background 0.15s",
  };
}

function rptBtnStyle(): Record<string, string> {
  return { ...blBtnStyle(), color: COLOR.red, borderColor: COLOR.redBg };
}

function rptBtnHover(): Record<string, string> {
  return { color: "#fff", borderColor: COLOR.red, background: COLOR.red };
}

function rptBtnDone(): Record<string, string> {
  return {
    color: COLOR.green,
    borderColor: COLOR.greenBg,
    background: COLOR.greenBg,
  };
}

function blBtnHover(): Record<string, string> {
  return {
    color: COLOR.red,
    borderColor: COLOR.red,
    background: COLOR.redBg,
  };
}

function blBtnDone(): Record<string, string> {
  return {
    color: COLOR.red,
    borderColor: COLOR.redBg,
    background: COLOR.redBg,
    boxShadow: "none",
    cursor: "default",
    pointerEvents: "none",
  };
}

function applyStyles(el: HTMLElement, styles: Record<string, string>): void {
  Object.assign(el.style, styles);
}

export function injectManualBlacklistButton(
  el: Element,
  info: PendingComment,
): void {
  if (blacklistButtonInjected.has(el)) return;
  blacklistButtonInjected.add(el);

  const parent = el.parentNode;
  if (!parent) return;

  const btn = document.createElement("span");
  btn.textContent = "拉黑";
  btn.title = `将 ${info.uname} 加入黑名单`;
  applyStyles(btn, blBtnStyle());

  parent.insertBefore(btn, el);

  btn.addEventListener("mouseenter", () => {
    if (btn.dataset.done !== "1") applyStyles(btn, blBtnHover());
  });
  btn.addEventListener("mouseleave", () => {
    if (btn.dataset.done !== "1") applyStyles(btn, blBtnStyle());
  });

  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    e.preventDefault();

    const config = getConfig();

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

      recordLearning({
        type: "manual_blacklist",
        message: info.message,
        uname: info.uname,
        videoTitle: currentContext.videoTitle,
      });

      log(TAG, `Manual block: ${info.uname}`);

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
      btn.textContent = "已拉黑";
      applyStyles(btn, blBtnDone());
    } catch (err) {
      console.error(TAG, "Manual block failed:", err);
    }
  });

  // ── 原生举报按钮（一键呼出举报弹窗） ──
  const rptBtn = document.createElement("span");
  rptBtn.textContent = "举报";
  rptBtn.title = "举报该评论（骚扰谩骂）";
  applyStyles(rptBtn, rptBtnStyle());

  parent.insertBefore(rptBtn, el);

  rptBtn.addEventListener("mouseenter", () => {
    if (rptBtn.dataset.done !== "1") applyStyles(rptBtn, rptBtnHover());
  });
  rptBtn.addEventListener("mouseleave", () => {
    if (rptBtn.dataset.done !== "1") applyStyles(rptBtn, rptBtnStyle());
  });

  rptBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    e.preventDefault();

    try {
      const { opened } = await triggerQuickReport(el, "骚扰谩骂");
      if (opened) {
        rptBtn.dataset.done = "1";
        rptBtn.textContent = "已举报";
        applyStyles(rptBtn, rptBtnDone());
      }
    } catch (err) {
      console.error(TAG, "Quick report failed:", err);
    }
  });

  // 存储按钮引用，供 hideEl / clean 模式隐藏按钮
  (el as any).__ruozhiBtns = [btn, rptBtn];
}
