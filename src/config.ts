// ============================================================
// config.ts - 配置管理和上下文状态
// ============================================================
import type { FilterConfig, ReplyContext } from "./types";
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
      setDevMode(parsed.devMode);
      _config = parsed;
      return parsed;
    }
  } catch {
    /* */
  }
  return {
    apiKey: "",
    apiEndpoint: "https://api.deepseek.com/chat/completions",
    model: "deepseek-chat",
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
