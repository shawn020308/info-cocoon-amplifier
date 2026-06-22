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

/** 用户纠正记录：AI自我学习的数据来源 */
export interface LearningCorrection {
  /** 纠正类型 */
  type: "unblock" | "misjudge" | "manual_blacklist";
  /** 评论原文（截取前200字） */
  message: string;
  /** AI原始判定理由 (unblock/misjudge 时有效) */
  aiReason?: string;
  /** AI原始判定严重度 */
  aiSeverity?: string;
  /** 用户名 */
  uname: string;
  /** 时间戳 */
  timestamp: number;
  /** 视频标题 */
  videoTitle?: string;
}

/** 主题名称 */
export type ThemeName = "claude" | "github" | "dark";

/** AI 提供商名称 */
export type ProviderName =
  | "deepseek"
  | "openai"
  | "openrouter"
  | "groq"
  | "ollama"
  | "vllm"
  | "custom";

/** 提供商预设：一键填入 endpoint + model */
export interface ProviderPreset {
  label: string;
  endpoint: string;
  model: string;
  /** 是否需要 Authorization header */
  needsAuth: boolean;
  /** 是否支持 response_format: json_object */
  supportsJsonFormat: boolean;
}

export const PROVIDER_PRESETS: Record<ProviderName, ProviderPreset> = {
  deepseek: {
    label: "DeepSeek",
    endpoint: "https://api.deepseek.com/chat/completions",
    model: "deepseek-v4-flash",
    needsAuth: true,
    supportsJsonFormat: true,
  },
  openai: {
    label: "OpenAI",
    endpoint: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini",
    needsAuth: true,
    supportsJsonFormat: true,
  },
  openrouter: {
    label: "OpenRouter",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    model: "deepseek/deepseek-chat",
    needsAuth: true,
    supportsJsonFormat: true,
  },
  groq: {
    label: "Groq",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.3-70b-versatile",
    needsAuth: true,
    supportsJsonFormat: true,
  },
  ollama: {
    label: "Ollama (本地)",
    endpoint: "http://localhost:11434/v1/chat/completions",
    model: "qwen2.5:7b",
    needsAuth: false,
    supportsJsonFormat: false,
  },
  vllm: {
    label: "vLLM (本地)",
    endpoint: "http://localhost:8000/v1/chat/completions",
    model: "qwen2.5-7b-instruct",
    needsAuth: false,
    supportsJsonFormat: false,
  },
  custom: {
    label: "自定义",
    endpoint: "",
    model: "",
    needsAuth: true,
    supportsJsonFormat: true,
  },
};

/** 用户自定义过滤规则 */
export interface FilterConfig {
  /** AI 提供商 */
  provider: ProviderName;
  apiKey: string;
  /** 按提供商分别记忆的密钥，切换时自动回填 */
  apiKeys: Partial<Record<ProviderName, string>>;
  apiEndpoint: string;
  model: string;
  prompt: string;
  /** UI 主题 */
  theme: ThemeName;
  /** 折叠样式: "none"=完全隐藏, "classic"=黄色警告条, "light"=极简灰线, "dim"=隐形弱化, "clean"=清爽护眼(高斯模糊) */
  foldMode: "none" | "classic" | "light" | "dim" | "clean";
  /** 是否启用AI过滤 */
  enableAI: boolean;
  /** 是否启用本地黑名单 */
  enableBlacklist: boolean;
  /** 手动拉黑是否需要确认弹窗 */
  blacklistConfirm: boolean;
  /** 开发者模式：开启后显示调试日志 */
  devMode: boolean;
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
  /** 启用AI自我学习：根据用户纠正行为调整判定 */
  learningEnabled: boolean;
  /** AI凝练的学习画像（注入System Prompt的核心片段，由AI持续维护，最长300字） */
  learnedProfile: string;
  /** 学习记录（最近500条纠正，UI展示+AI学习用） */
  learningCorrections: LearningCorrection[];
  /** 上次更新画像时已处理的记录数（新累积 ≥20 条触发下次更新） */
  lastRefinedCount: number;
  /** 知识库：用户手动添加的辅助判定条目（如"XX是对XX的歧视性称呼"） */
  knowledgeBase: string[];
  /** 全局字体缩放系数 (0.8 ~ 1.5) */
  fontScale: number;
  /** 预过滤：跳过短评论（<3个非空白字符，如"哈""嗯"），默认关闭 */
  prefilterShort: boolean;
  /** 预过滤：跳过纯符号/表情评论（如"666""😂"），默认关闭 */
  prefilterSymbols: boolean;
  /** 预过滤：跳过纯英文短评论（如"good""nb"），默认关闭 */
  prefilterEnglish: boolean;
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
  provider: "deepseek",
  apiKey: "",
  apiKeys: {},
  apiEndpoint: "https://api.deepseek.com/chat/completions",
  model: "deepseek-v4-flash",
  theme: "github",
  prompt: `请帮我识别以下评论中，具有明显性别对立、引战、人身攻击、煽动性、仇恨言论的内容。

违规判定维度：
- **性别对立**：将某一性别标签化、污名化，煽动敌视/仇恨
- **人身攻击**：针对个人的侮辱、谩骂、诅咒和阴阳怪气
- **引战/煽动**：故意挑起争端，使用极端化言论
- **降智煽动**：以偏概全、简化认知、传播刻板印象的明显反智言论
- **仇恨言论**：涉及种族、地域、性别、性取向等的歧视性言论
- **政治敏感**：各类键盘政治黑话、谐音变体、暗喻代称等隐蔽违规表述；针对国家政策、公职人员发布恶意抹黑造谣、歪曲历史的内容；涉及煽动颠覆、破坏民族团结、泄露涉密信息的言论；恶意调侃英烈、违规使用国家象征符号的相关违规内容
- **引用/复述判断**：如果用户是在引用、复述他人的歧视言论以反驳、批评或表达反对态度，则不应判定为违规。只有当用户本人表达、认同或宣扬歧视观点时，才标记为违规`,
  foldMode: "classic",
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
