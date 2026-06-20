// ============================================================
// types.ts - 全局类型定义
// ============================================================

/** B站评论API返回的评论数据 */
export interface BiliReply {
  rpid: number;
  oid: number;
  mid: number;
  root: number;
  parent: number;
  count: number;
  rcount: number;
  like: number;
  ctime: number;
  content: {
    message: string;
    jump_url?: Record<string, unknown>;
    [key: string]: unknown;
  };
  member: {
    mid: string;
    uname: string;
    avatar: string;
    [key: string]: unknown;
  };
  replies?: BiliReply[] | null;
  [key: string]: unknown;
}

/** B站评论API响应 */
export interface BiliReplyResponse {
  code: number;
  message: string;
  data?: {
    replies: BiliReply[];
    page: {
      num: number;
      size: number;
      count: number;
    };
    top?: {
      upper?: BiliReply | null;
      admin?: BiliReply | null;
    };
  };
}

/** 用户自定义过滤规则 */
export interface FilterConfig {
  apiKey: string;
  apiEndpoint: string;
  model: string;
  prompt: string;
  /** 折叠样式: "none"=完全隐藏, "classic"=黄色警告条, "light"=极简灰线 */
  foldMode: "none" | "classic" | "light";
  /** 是否启用AI过滤 */
  enableAI: boolean;
  /** 是否启用本地黑名单 */
  enableBlacklist: boolean;
  /** 黑名单严格度: 0 = 仅折叠, 1 = 折叠+标记, 2 = 直接拉黑 */
  blacklistStrictness: number;
  /** 自定义token单价 (元/百万token) */
  pricePerMToken: number;
  /** 发送请求时附带用户名 */
  sendUname: boolean;
  /** 发送请求时附带用户mid */
  sendMid: boolean;
  /** 发送请求时附带视频简介 */
  sendVideoDesc: boolean;
  /** 自定义违规判定维度 */
  filterDimensions: string;
}

/** AI判定结果: 单条评论的违规判定 */
export interface AIVerdict {
  rpid: number;
  mid: number;
  violation: boolean;
  reason: string;
  severity: "none" | "low" | "medium" | "high" | "block";
}

/** AI批处理返回 */
export interface AIBatchResult {
  verdicts: AIVerdict[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** 累计统计 */
export interface AccumulatedStats {
  totalFiltered: number;
  totalScanned: number;
  apiCalls: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  /** 各严重度计数 */
  severityCounts: Record<string, number>;
  lastUpdate: number;
}

/** 黑名单记录 */
export interface BlacklistRecord {
  uid?: number;
  mid: number;
  uname: string;
  rpid: number;
  message: string;
  reason: string;
  videoTitle: string;
  videoUrl: string;
  timestamp: number;
  severity: AIVerdict["severity"];
  /** 来源: auto=AI自动, manual=用户手动 */
  source: "auto" | "manual";
}

/** 评论缓存条目 (LRU) */
export interface CacheEntry {
  hash: string;
  violation: boolean;
  reason: string;
  severity: AIVerdict["severity"];
  timestamp: number;
}

/** 拦截到的评论请求上下文 */
export interface ReplyContext {
  oid: number;
  videoTitle: string;
  videoDesc: string;
}

/** 默认配置 */
export const DEFAULT_CONFIG: FilterConfig = {
  apiKey: "",
  apiEndpoint: "https://api.deepseek.com/chat/completions",
  model: "deepseek-chat",
  prompt:
    "请帮我识别以下评论中，具有明显性别对立、引战、人身攻击、煽动性、仇恨言论的内容。",
  foldMode: "classic",
  enableAI: true,
  enableBlacklist: true,
  blacklistStrictness: 1,
  pricePerMToken: 1.1,
  sendUname: false,
  sendMid: false,
  sendVideoDesc: false,
  filterDimensions: `- **性别对立**：将某一性别标签化、污名化，煽动敌视/仇恨（如"女人都拜金""男人都好色"）
- **人身攻击**：针对个人的侮辱、谩骂、诅咒
- **引战/煽动**：故意挑起争端，使用极端化言论
- **降智煽动**：以偏概全、简化认知、传播刻板印象的明显反智言论
- **仇恨言论**：涉及种族、地域、性别、性取向等的歧视性言论`,
};
