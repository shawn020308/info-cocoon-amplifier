// ============================================================
// config.ts - 配置管理和上下文状态
// ============================================================
import type { FilterConfig, ReplyContext } from "./types";

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
      // 兼容旧版配置：没有 blacklistConfirm 时默认 true
      if (parsed.blacklistConfirm === undefined) {
        parsed.blacklistConfirm = true;
      }
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
    blacklistStrictness: 1,
    pricePerMToken: 1.1,
    sendUname: false,
    sendMid: false,
    sendVideoDesc: false,
    filterDimensions: `- **性别对立**：将某一性别标签化、污名化，煽动敌视/仇恨
- **人身攻击**：针对个人的侮辱、谩骂、诅咒
- **引战/煽动**：故意挑起争端，使用极端化言论
- **降智煽动**：以偏概全、简化认知、传播刻板印象的明显反智言论
- **仇恨言论**：涉及种族、地域、性别、性取向等的歧视性言论`,
  };
}

/** 从外部注入新配置（UI保存时调用） */
export function refreshConfig(cfg: FilterConfig): void {
  _config = cfg;
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
