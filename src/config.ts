// ============================================================
// config.ts - 配置管理和上下文状态
// ============================================================
import type { FilterConfig, ReplyContext } from "./types";
import { DEFAULT_CONFIG } from "./types";
import { setDevMode } from "./debug";

/** 缓存的配置，null 表示需要从 GM 存储加载 */
let _config: FilterConfig | null = null;

/** 获取当前配置（从缓存或GM存储加载） */
export function getConfig(): FilterConfig {
  if (_config) return _config;
  try {
    const raw = GM_getValue("ruozhi-config", "");
    if (raw) {
      const parsed = JSON.parse(raw);
      // 兼容旧版 boolean foldMode
      if (typeof parsed.foldMode === "boolean") {
        parsed.foldMode = parsed.foldMode ? "classic" : "none";
      }
      // 兼容旧版配置
      if (parsed.blacklistConfirm === undefined) {
        parsed.blacklistConfirm = true;
      }
      if (parsed.devMode === undefined) {
        parsed.devMode = false;
      }
      // 迁移：将旧的 filterDimensions 合并到 prompt
      if (parsed.filterDimensions) {
        parsed.prompt =
          (parsed.prompt || "") +
          "\n\n违规判定维度：\n" +
          parsed.filterDimensions;
        delete parsed.filterDimensions;
      }
      // 兼容旧版：无 theme 字段
      if (!parsed.theme) {
        parsed.theme = "claude";
      }
      // 兼容旧版：无 fontScale 字段
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
      // ★ 关键修复：始终合并 DEFAULT_CONFIG，确保新增字段不会为 undefined
      const merged: FilterConfig = { ...DEFAULT_CONFIG, ...parsed };
      setDevMode(merged.devMode);
      _config = merged;
      return merged;
    }
  } catch (e) {
    console.error("[ruozhi-filter]", "Config load failed:", e);
  }
  return {
    provider: "deepseek",
    apiKey: "",
    apiEndpoint: "https://api.deepseek.com/chat/completions",
    model: "deepseek-v4-flash",
    theme: "github",
    prompt: "",
    foldMode: "classic" as const,
    enableAI: true,
    enableBlacklist: true,
    blacklistConfirm: true,
    devMode: false,
    blacklistStrictness: 1,
    pricePerMToken: 1.1,
    sendUname: false,
    sendMid: false,
    sendVideoDesc: false,
    learningEnabled: true,
    learnedProfile: "",
    learningCorrections: [],
    lastRefinedCount: 0,
    knowledgeBase: [],
    fontScale: 1.0,
    prefilterShort: false,
    prefilterSymbols: false,
    prefilterEnglish: false,
  };
}

/** 从外部注入新配置（UI保存时调用） */
export function refreshConfig(cfg: FilterConfig): void {
  _config = cfg;
  setDevMode(cfg.devMode);
}

/** 当前视频上下文 */
export const currentContext: ReplyContext = {
  oid: 0,
  videoTitle: "",
  videoDesc: "",
};

/** 更新视频上下文 */
export function updateContext(ctx: Partial<ReplyContext>): void {
  if (ctx.oid) currentContext.oid = ctx.oid;
  if (ctx.videoTitle) currentContext.videoTitle = ctx.videoTitle;
  if (ctx.videoDesc) currentContext.videoDesc = ctx.videoDesc;
}
