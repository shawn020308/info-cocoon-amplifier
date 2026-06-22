// ==UserScript==
// @name         信息茧房放大器 - B站降智评论过滤器
// @namespace    ruozhi-filter
// @version      0.4.1
// @author       ruozhi-filter
// @description  AI驱动：自动识别并折叠B站评论区中的降智/引战言论
// @license      MIT
// @match        *://www.bilibili.com/video/*
// @grant        GM_deleteValue
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  'use strict';

  const PROVIDER_PRESETS = {
    deepseek: {
      label: "DeepSeek",
      endpoint: "https://api.deepseek.com/chat/completions",
      model: "deepseek-v4-flash",
      needsAuth: true,
      supportsJsonFormat: true
    },
    openai: {
      label: "OpenAI",
      endpoint: "https://api.openai.com/v1/chat/completions",
      model: "gpt-4o-mini",
      needsAuth: true,
      supportsJsonFormat: true
    },
    openrouter: {
      label: "OpenRouter",
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
      model: "deepseek/deepseek-chat",
      needsAuth: true,
      supportsJsonFormat: true
    },
    groq: {
      label: "Groq",
      endpoint: "https://api.groq.com/openai/v1/chat/completions",
      model: "llama-3.3-70b-versatile",
      needsAuth: true,
      supportsJsonFormat: true
    },
    ollama: {
      label: "Ollama (本地)",
      endpoint: "http://localhost:11434/v1/chat/completions",
      model: "qwen2.5:7b",
      needsAuth: false,
      supportsJsonFormat: false
    },
    vllm: {
      label: "vLLM (本地)",
      endpoint: "http://localhost:8000/v1/chat/completions",
      model: "qwen2.5-7b-instruct",
      needsAuth: false,
      supportsJsonFormat: false
    },
    custom: {
      label: "自定义",
      endpoint: "",
      model: "",
      needsAuth: true,
      supportsJsonFormat: true
    }
  };
  const DEFAULT_CONFIG = {
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
    fontScale: 1,
    prefilterShort: false,
    prefilterSymbols: false,
    prefilterEnglish: false,
    enableRcmdFilter: false,
    rcmdPrompt: `判断视频标题是否具有明显煽动性、引战倾向或极端化特征。

违规特征（命中其一即判定）：
- 标题直接使用人身攻击、谩骂、污名化标签
- 明确站队引战、煽动群体对立（性别/地域/阶层等）
- 以偏概全传播刻板印象、简化复杂议题为二元对立
- 标题本身即为仇恨言论或歧视性表述

不判定为违规：
- 客观陈述、新闻报道式标题
- 科普、辟谣、理性讨论
- 标题含争议性话题但立场中立、探讨性质
- 反讽、引用式标题（需判断作者意图是否为批判）

仅输出明显具有引战/煽动意图的标题，边界案例倾向于放过。`
  };
  let _devMode = false;
  function setDevMode(v) {
    _devMode = v;
  }
  function log(tag, ...args) {
    if (_devMode) console.log(tag, ...args);
  }
  function warn(tag, ...args) {
    if (_devMode) console.warn(tag, ...args);
  }
  let _config = null;
  function getConfig() {
    if (_config) return _config;
    try {
      const raw = GM_getValue("ruozhi-config", "");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed.foldMode === "boolean") {
          parsed.foldMode = parsed.foldMode ? "classic" : "none";
        }
        if (parsed.blacklistConfirm === void 0) {
          parsed.blacklistConfirm = true;
        }
        if (parsed.devMode === void 0) {
          parsed.devMode = false;
        }
        if (parsed.filterDimensions) {
          parsed.prompt = (parsed.prompt || "") + "\n\n违规判定维度：\n" + parsed.filterDimensions;
          delete parsed.filterDimensions;
        }
        if (!parsed.theme) {
          parsed.theme = "claude";
        }
        if (parsed.fontScale === void 0) {
          parsed.fontScale = 1;
        }
        if (!parsed.apiKeys || Object.keys(parsed.apiKeys).length === 0) {
          parsed.apiKeys = {};
          if (parsed.apiKey) {
            parsed.apiKeys[parsed.provider || "deepseek"] = parsed.apiKey;
          }
        }
        const merged = { ...DEFAULT_CONFIG, ...parsed };
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
      apiKeys: {},
      apiEndpoint: "https://api.deepseek.com/chat/completions",
      model: "deepseek-v4-flash",
      theme: "github",
      prompt: "",
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
      fontScale: 1,
      prefilterShort: false,
      prefilterSymbols: false,
      prefilterEnglish: false,
      enableRcmdFilter: false,
      rcmdPrompt: ""
    };
  }
  function refreshConfig(cfg) {
    _config = cfg;
    setDevMode(cfg.devMode);
  }
  const currentContext = {
    oid: 0,
    videoTitle: "",
    videoDesc: ""
  };
  function updateContext(ctx) {
    if (ctx.oid) currentContext.oid = ctx.oid;
    if (ctx.videoTitle) currentContext.videoTitle = ctx.videoTitle;
    if (ctx.videoDesc) currentContext.videoDesc = ctx.videoDesc;
  }
  const TAG$8 = "[ruozhi-filter]";
  const MAX_CORRECTIONS = 500;
  const REFINE_THRESHOLD = 20;
  const MAX_PROFILE_LENGTH = 300;
  let refineCallback = null;
  function setRefineCallback(cb) {
    refineCallback = cb;
  }
  let refining = false;
  function recordLearning(correction) {
    try {
      const config = getConfig();
      if (!config.learningEnabled) return;
      if (!Array.isArray(config.learningCorrections)) {
        config.learningCorrections = [];
      }
      const entry = {
        ...correction,
        message: correction.message.slice(0, 200),
        timestamp: Date.now()
      };
      const dupIdx = config.learningCorrections.findIndex(
        (c) => c.type === entry.type && c.message.slice(0, 50) === entry.message.slice(0, 50)
      );
      if (dupIdx >= 0) {
        config.learningCorrections.splice(dupIdx, 1);
      }
      config.learningCorrections.unshift(entry);
      if (config.learningCorrections.length > MAX_CORRECTIONS) {
        config.learningCorrections.length = MAX_CORRECTIONS;
      }
      const newSinceLast = config.learningCorrections.length - (config.lastRefinedCount ?? 0);
      persist(config);
      log(
        TAG$8,
        `学习记录: ${entry.type} | 总${config.learningCorrections.length}条 | 新${newSinceLast}条 | 画像${config.learnedProfile ? "✓" : "✗"}`
      );
      if (newSinceLast >= REFINE_THRESHOLD && refineCallback && !refining) {
        refining = true;
        refineCallback().finally(() => {
          refining = false;
        });
      }
    } catch (err) {
      console.warn(TAG$8, " 学习记录失败:", err);
    }
  }
  function buildLearningPrompt() {
    try {
      const config = getConfig();
      if (!config.learningEnabled) return "";
      if (config.learnedProfile && typeof config.learnedProfile === "string") {
        return `

[用户过滤画像] ${config.learnedProfile}`;
      }
      const records = config.learningCorrections;
      if (!Array.isArray(records) || records.length === 0) return "";
      const unblockCount = records.filter(
        (c) => c.type === "unblock" || c.type === "misjudge"
      ).length;
      const manualCount = records.filter(
        (c) => c.type === "manual_blacklist"
      ).length;
      return `

[用户学习反馈] 已收集${records.length}条纠正（误判${unblockCount}/漏判${manualCount}），攒够${REFINE_THRESHOLD}条后将自动生成学习画像。请暂时参考这些纠正调整判定。`;
    } catch {
      return "";
    }
  }
  function shouldRefineProfile() {
    try {
      const config = getConfig();
      if (!config.learningEnabled) return false;
      const records = config.learningCorrections;
      if (!Array.isArray(records)) return false;
      const newCount = records.length - (config.lastRefinedCount ?? 0);
      return newCount >= REFINE_THRESHOLD;
    } catch {
      return false;
    }
  }
  function buildRefinementInstruction() {
    try {
      const config = getConfig();
      const records = config.learningCorrections;
      if (!Array.isArray(records) || records.length === 0) return "";
      const currentProfile = config.learnedProfile || "（尚无画像）";
      const newCount = records.length - (config.lastRefinedCount ?? 0);
      if (newCount < REFINE_THRESHOLD) return "";
      const correctionLines = records.map((c) => {
        const typeLabel = c.type === "manual_blacklist" ? "拉黑" : "放过";
        const aiInfo = c.aiReason ? ` #曾判定:${c.aiReason.slice(0, 20)}` : "";
        return `[${typeLabel}]「${c.message.slice(0, 60)}」${aiInfo}`;
      });
      const totalTokens = correctionLines.join("\n").length;
      const truncated = totalTokens > 6e3 ? correctionLines.slice(
        0,
        Math.floor(6e3 / (totalTokens / correctionLines.length))
      ) : correctionLines;
      return `

--- 学习画像更新请求 ---
当前画像：${currentProfile}

全部纠正记录（${records.length}条，按时间倒序）：
[放过] = 用户恢复了AI误判的内容（这些不应被过滤）
[拉黑] = 用户手动拉黑了AI漏判的内容（这些应被过滤）
${truncated.join("\n")}

请根据以上记录，输出 refinedProfile：
- 应过滤：基于[拉黑]案例，归纳用户明确不想看的内容类型
- 应放过：基于[放过]案例，归纳用户想保留的内容类型
- 立场：一句话概括用户整体倾向

在JSON响应中增加 "refinedProfile" 字段。`;
    } catch {
      return "";
    }
  }
  function applyRefinedProfile(profile) {
    var _a;
    if (!profile || typeof profile !== "string" || profile.trim().length < 10)
      return;
    try {
      const config = getConfig();
      const trimmed = profile.trim().slice(0, MAX_PROFILE_LENGTH);
      config.learnedProfile = trimmed;
      config.lastRefinedCount = ((_a = config.learningCorrections) == null ? void 0 : _a.length) ?? 0;
      persist(config);
      log(
        TAG$8,
        ` 画像已更新 (${trimmed.length}字) | 已处理${config.lastRefinedCount}条 | 新画像: ${trimmed.slice(0, 80)}…`
      );
    } catch (err) {
      console.warn(TAG$8, " 画像保存失败:", err);
    }
  }
  function persist(config) {
    try {
      const json = JSON.stringify(config);
      GM_setValue("ruozhi-config", json);
      const verify = GM_getValue("ruozhi-config", "");
      if (!verify || verify.length < 10) {
        console.error(TAG$8, "Persistence verification failed: 写入后读取为空");
      }
    } catch (e) {
      console.error(TAG$8, "Persistence failed:", e);
    }
  }
  function getLearnedProfile() {
    try {
      const profile = getConfig().learnedProfile;
      return typeof profile === "string" ? profile : "";
    } catch {
      return "";
    }
  }
  function getPendingCount() {
    try {
      const config = getConfig();
      const records = config.learningCorrections;
      if (!Array.isArray(records)) return 0;
      return Math.max(0, records.length - (config.lastRefinedCount ?? 0));
    } catch {
      return 0;
    }
  }
  function getLearningRecords() {
    try {
      const records = getConfig().learningCorrections;
      return Array.isArray(records) ? [...records] : [];
    } catch {
      return [];
    }
  }
  function getLearningStats() {
    try {
      const records = getConfig().learningCorrections;
      if (!Array.isArray(records)) {
        return { total: 0, unblockCount: 0, misjudgeCount: 0, manualCount: 0 };
      }
      return {
        total: records.length,
        unblockCount: records.filter((c) => c.type === "unblock").length,
        misjudgeCount: records.filter((c) => c.type === "misjudge").length,
        manualCount: records.filter((c) => c.type === "manual_blacklist").length
      };
    } catch {
      return { total: 0, unblockCount: 0, misjudgeCount: 0, manualCount: 0 };
    }
  }
  function removeLearning(index) {
    try {
      const config = getConfig();
      if (!Array.isArray(config.learningCorrections)) return;
      if (index >= 0 && index < config.learningCorrections.length) {
        config.learningCorrections.splice(index, 1);
        if (typeof config.lastRefinedCount === "number" && config.lastRefinedCount > config.learningCorrections.length) {
          config.lastRefinedCount = config.learningCorrections.length;
        }
        persist(config);
      }
    } catch {
    }
  }
  function clearLearning() {
    try {
      const config = getConfig();
      config.learnedProfile = "";
      config.learningCorrections = [];
      config.lastRefinedCount = 0;
      persist(config);
    } catch {
    }
  }
  const TAG$7 = "[ruozhi-filter]";
  function getPreset(config) {
    return PROVIDER_PRESETS[config.provider] ?? PROVIDER_PRESETS.custom;
  }
  function skipAuth(config) {
    const preset = getPreset(config);
    if (!preset.needsAuth) return true;
    if (!config.apiKey && (config.apiEndpoint.startsWith("http://localhost") || config.apiEndpoint.startsWith("http://127.0.0.1"))) {
      return true;
    }
    return false;
  }
  function buildHeaders(config) {
    const h = { "Content-Type": "application/json" };
    if (!skipAuth(config)) {
      h.Authorization = `Bearer ${config.apiKey}`;
    }
    return h;
  }
  function buildRefineBody(config, instruction) {
    const preset = getPreset(config);
    const body = {
      model: config.model,
      messages: [
        {
          role: "system",
          content: `你是用户过滤画像维护助手。根据用户对AI判定的纠正记录，输出精炼的过滤画像。

纠正记录说明：
- "放过" = 用户将AI误判的内容恢复了（用户认为这些不该被过滤）
- "拉黑" = 用户手动拉黑了AI漏判的内容（用户认为这些应该被过滤）

请严格按以下格式输出画像（300字以内）：
应过滤：[用户明确不想看的内容，基于拉黑案例归纳]
应放过：[用户想保留的内容，基于放过案例归纳]
立场：[一句话概括用户倾向]

仅输出JSON：{"refinedProfile":"..."}`
        },
        { role: "user", content: instruction }
      ],
      temperature: 0,
      max_tokens: 512
    };
    if (preset.supportsJsonFormat) {
      body.response_format = { type: "json_object" };
    }
    return body;
  }
  function buildSystemPrompt$1(config, ctx) {
    const ctxParts = [`视频：${ctx.videoTitle}`];
    if (config.sendVideoDesc) {
      ctxParts.push(`简介：${ctx.videoDesc.slice(0, 200)}`);
    }
    const learningSection = buildLearningPrompt();
    const refinementSection = buildRefinementInstruction();
    const kb = config.knowledgeBase;
    const kbSection = Array.isArray(kb) && kb.length > 0 ? `

[知识库] 以下为已知的语境信息，辅助判断反讽/引用/特定称呼：
${kb.map((e, i) => `${i + 1}. ${e}`).join("\n")}` : "";
    const hasProfile = config.learnedProfile && typeof config.learnedProfile === "string";
    return `判断评论是否违规。

${hasProfile ? `[最高优先级] 用户过滤画像（与下方规则冲突时，以画像为准）：
${config.learnedProfile}

` : ""}规则：${config.prompt}
上下文：${ctxParts.join("；")}${kbSection}${hasProfile ? "" : learningSection}${refinementSection}

${hasProfile ? "重要：以上用户画像优先级高于基础规则。当规则与画像冲突时，以用户画像为准判定。" : ""}
仅输出JSON（无markdown标记）：
{"verdicts":[{"i":索引,"violation":true,"reason":"理由","severity":"low|medium|high|block"}]}
只输出违规评论，无违规返回{"verdicts":[]}`;
  }
  function buildUserMessage$1(config, replies) {
    const comments = replies.map((r, i) => {
      const item = {
        i,
        // 索引，AI 返回时用 i 对应，我们再映射回 rpid
        c: r.content.message
      };
      if (config.sendMid) item.m = r.mid;
      if (config.sendUname) item.u = r.member.uname;
      return item;
    });
    return JSON.stringify(comments);
  }
  function buildRequestBody(config, systemPrompt, userMessage, isRefining) {
    const preset = getPreset(config);
    const body = {
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ],
      temperature: 0,
      max_tokens: isRefining ? 8192 : 8192
    };
    if (preset.supportsJsonFormat) {
      body.response_format = { type: "json_object" };
    }
    return body;
  }
  async function batchJudge(config, replies, ctx) {
    var _a, _b, _c;
    if (!config.apiKey && getPreset(config).needsAuth || replies.length === 0)
      return { verdicts: [] };
    const systemPrompt = buildSystemPrompt$1(config, ctx);
    const userMessage = buildUserMessage$1(config, replies);
    const isRefining = shouldRefineProfile();
    if (isRefining) {
      log(TAG$7, `触发画像更新 (评论判定附带)`);
    }
    const reqBody = buildRequestBody(
      config,
      systemPrompt,
      userMessage,
      isRefining
    );
    log(
      TAG$7,
      "请求体:",
      JSON.stringify({
        ...reqBody,
        systemPrompt: systemPrompt.slice(0, 500) + (systemPrompt.length > 500 ? "..." : ""),
        userMessage: JSON.parse(userMessage)
      })
    );
    const rpidByIndex = new Map(replies.map((r, i) => [i, r.rpid]));
    const fetchStart = Date.now();
    const fetcher = typeof unsafeWindow !== "undefined" ? unsafeWindow.fetch : window.fetch;
    try {
      const headers = {
        "Content-Type": "application/json"
      };
      if (!skipAuth(config)) {
        headers.Authorization = `Bearer ${config.apiKey}`;
      }
      const response = await fetcher(config.apiEndpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(reqBody)
      });
      log(TAG$7, `API HTTP ${response.status}, ${Date.now() - fetchStart}ms`);
      if (!response.ok) {
        const errText = await response.text();
        console.error(
          TAG$7,
          `API error ${response.status}:`,
          errText.slice(0, 200)
        );
        throw new Error(`DeepSeek API error ${response.status}`);
      }
      const data = await response.json();
      const content = (_c = (_b = (_a = data.choices) == null ? void 0 : _a[0]) == null ? void 0 : _b.message) == null ? void 0 : _c.content;
      const usage = data.usage;
      console.log(TAG$7, "DeepSeek 返回内容:", content);
      console.log(TAG$7, "DeepSeek 用量:", usage);
      if (!content) {
        warn(TAG$7, " AI 返回空内容");
        return { verdicts: [], usage };
      }
      try {
        let jsonStr = content.trim();
        if (jsonStr.startsWith("```json")) jsonStr = jsonStr.slice(7);
        if (jsonStr.startsWith("```")) jsonStr = jsonStr.slice(3);
        if (jsonStr.endsWith("```")) jsonStr = jsonStr.slice(0, -3);
        jsonStr = jsonStr.trim();
        const parsed = JSON.parse(jsonStr);
        const verdicts = (parsed.verdicts ?? []).map((v) => ({
          rpid: rpidByIndex.get(v.i) ?? v.rpid ?? 0,
          mid: v.mid ?? 0,
          violation: v.violation,
          reason: v.reason ?? "",
          severity: v.severity ?? "medium"
        }));
        if (parsed.refinedProfile && typeof parsed.refinedProfile === "string") {
          applyRefinedProfile(parsed.refinedProfile);
        }
        return { verdicts, usage };
      } catch (e) {
        console.error(TAG$7, "AI response parse failed:", e);
        return { verdicts: [], usage };
      }
    } catch (err) {
      console.error(TAG$7, "Network request failed:", err);
      throw err;
    }
  }
  async function testAPIConnection(config) {
    try {
      const fetcher = typeof unsafeWindow !== "undefined" ? unsafeWindow.fetch : window.fetch;
      const hdrs = {
        "Content-Type": "application/json"
      };
      if (!skipAuth(config)) {
        hdrs.Authorization = `Bearer ${config.apiKey}`;
      }
      const resp = await fetcher(config.apiEndpoint, {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 5
        })
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
  async function refineProfileNow() {
    return _refineProfile(false);
  }
  async function forceRefineProfile() {
    return _refineProfile(true);
  }
  async function _refineProfile(force) {
    var _a, _b, _c;
    if (!force && !shouldRefineProfile()) {
      log(TAG$7, "refineProfile: 未达阈值，跳过");
      return;
    }
    const config = getConfig();
    if (!config.apiKey && getPreset(config).needsAuth) {
      warn(TAG$7, " 画像更新跳过: 未配置API Key");
      return;
    }
    const records = config.learningCorrections;
    if (!Array.isArray(records) || records.length === 0) {
      warn(TAG$7, " 画像更新跳过: 无学习记录");
      return;
    }
    const savedCount = config.lastRefinedCount;
    if (force) {
      config.lastRefinedCount = 0;
    }
    const instruction = buildRefinementInstruction();
    if (force) {
      config.lastRefinedCount = savedCount;
    }
    if (!instruction) {
      warn(TAG$7, " 画像更新跳过: 无更新指令");
      return;
    }
    log(
      TAG$7,
      `${force ? "强制" : "自动"}画像更新中... (指令${instruction.length}字)`
    );
    const fetcher = typeof unsafeWindow !== "undefined" ? unsafeWindow.fetch : window.fetch;
    try {
      const response = await fetcher(config.apiEndpoint, {
        method: "POST",
        headers: buildHeaders(config),
        body: JSON.stringify(buildRefineBody(config, instruction))
      });
      if (!response.ok) {
        console.error(TAG$7, `Profile update API error ${response.status}`);
        return;
      }
      const data = await response.json();
      const content = (_c = (_b = (_a = data.choices) == null ? void 0 : _a[0]) == null ? void 0 : _b.message) == null ? void 0 : _c.content;
      console.log(TAG$7, "画像更新 DeepSeek 返回内容:", content);
      if (!content) {
        warn(TAG$7, " 画像更新: AI 返回空内容");
        return;
      }
      let jsonStr = content.trim();
      if (jsonStr.startsWith("```json")) jsonStr = jsonStr.slice(7);
      if (jsonStr.startsWith("```")) jsonStr = jsonStr.slice(3);
      if (jsonStr.endsWith("```")) jsonStr = jsonStr.slice(0, -3);
      jsonStr = jsonStr.trim();
      const parsed = JSON.parse(jsonStr);
      if (parsed.refinedProfile && typeof parsed.refinedProfile === "string") {
        applyRefinedProfile(parsed.refinedProfile);
      } else {
        warn(TAG$7, " 画像更新: 未收到 refinedProfile 字段");
      }
    } catch (err) {
      console.error(TAG$7, "Profile update failed:", err);
    }
  }
  const instanceOfAny = (object, constructors) => constructors.some((c) => object instanceof c);
  let idbProxyableTypes;
  let cursorAdvanceMethods;
  function getIdbProxyableTypes() {
    return idbProxyableTypes || (idbProxyableTypes = [
      IDBDatabase,
      IDBObjectStore,
      IDBIndex,
      IDBCursor,
      IDBTransaction
    ]);
  }
  function getCursorAdvanceMethods() {
    return cursorAdvanceMethods || (cursorAdvanceMethods = [
      IDBCursor.prototype.advance,
      IDBCursor.prototype.continue,
      IDBCursor.prototype.continuePrimaryKey
    ]);
  }
  const transactionDoneMap = /* @__PURE__ */ new WeakMap();
  const transformCache = /* @__PURE__ */ new WeakMap();
  const reverseTransformCache = /* @__PURE__ */ new WeakMap();
  function promisifyRequest(request) {
    const promise = new Promise((resolve, reject) => {
      const unlisten = () => {
        request.removeEventListener("success", success);
        request.removeEventListener("error", error);
      };
      const success = () => {
        resolve(wrap(request.result));
        unlisten();
      };
      const error = () => {
        reject(request.error);
        unlisten();
      };
      request.addEventListener("success", success);
      request.addEventListener("error", error);
    });
    reverseTransformCache.set(promise, request);
    return promise;
  }
  function cacheDonePromiseForTransaction(tx) {
    if (transactionDoneMap.has(tx))
      return;
    const done = new Promise((resolve, reject) => {
      const unlisten = () => {
        tx.removeEventListener("complete", complete);
        tx.removeEventListener("error", error);
        tx.removeEventListener("abort", error);
      };
      const complete = () => {
        resolve();
        unlisten();
      };
      const error = () => {
        reject(tx.error || new DOMException("AbortError", "AbortError"));
        unlisten();
      };
      tx.addEventListener("complete", complete);
      tx.addEventListener("error", error);
      tx.addEventListener("abort", error);
    });
    transactionDoneMap.set(tx, done);
  }
  let idbProxyTraps = {
    get(target, prop, receiver) {
      if (target instanceof IDBTransaction) {
        if (prop === "done")
          return transactionDoneMap.get(target);
        if (prop === "store") {
          return receiver.objectStoreNames[1] ? void 0 : receiver.objectStore(receiver.objectStoreNames[0]);
        }
      }
      return wrap(target[prop]);
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
    has(target, prop) {
      if (target instanceof IDBTransaction && (prop === "done" || prop === "store")) {
        return true;
      }
      return prop in target;
    }
  };
  function replaceTraps(callback) {
    idbProxyTraps = callback(idbProxyTraps);
  }
  function wrapFunction(func) {
    if (getCursorAdvanceMethods().includes(func)) {
      return function(...args) {
        func.apply(unwrap(this), args);
        return wrap(this.request);
      };
    }
    return function(...args) {
      return wrap(func.apply(unwrap(this), args));
    };
  }
  function transformCachableValue(value) {
    if (typeof value === "function")
      return wrapFunction(value);
    if (value instanceof IDBTransaction)
      cacheDonePromiseForTransaction(value);
    if (instanceOfAny(value, getIdbProxyableTypes()))
      return new Proxy(value, idbProxyTraps);
    return value;
  }
  function wrap(value) {
    if (value instanceof IDBRequest)
      return promisifyRequest(value);
    if (transformCache.has(value))
      return transformCache.get(value);
    const newValue = transformCachableValue(value);
    if (newValue !== value) {
      transformCache.set(value, newValue);
      reverseTransformCache.set(newValue, value);
    }
    return newValue;
  }
  const unwrap = (value) => reverseTransformCache.get(value);
  function openDB(name, version, { blocked, upgrade, blocking, terminated } = {}) {
    const request = indexedDB.open(name, version);
    const openPromise = wrap(request);
    if (upgrade) {
      request.addEventListener("upgradeneeded", (event) => {
        upgrade(wrap(request.result), event.oldVersion, event.newVersion, wrap(request.transaction), event);
      });
    }
    if (blocked) {
      request.addEventListener("blocked", (event) => blocked(
        // Casting due to https://github.com/microsoft/TypeScript-DOM-lib-generator/pull/1405
        event.oldVersion,
        event.newVersion,
        event
      ));
    }
    openPromise.then((db) => {
      if (terminated)
        db.addEventListener("close", () => terminated());
      if (blocking) {
        db.addEventListener("versionchange", (event) => blocking(event.oldVersion, event.newVersion, event));
      }
    }).catch(() => {
    });
    return openPromise;
  }
  const readMethods = ["get", "getKey", "getAll", "getAllKeys", "count"];
  const writeMethods = ["put", "add", "delete", "clear"];
  const cachedMethods = /* @__PURE__ */ new Map();
  function getMethod(target, prop) {
    if (!(target instanceof IDBDatabase && !(prop in target) && typeof prop === "string")) {
      return;
    }
    if (cachedMethods.get(prop))
      return cachedMethods.get(prop);
    const targetFuncName = prop.replace(/FromIndex$/, "");
    const useIndex = prop !== targetFuncName;
    const isWrite = writeMethods.includes(targetFuncName);
    if (
      // Bail if the target doesn't exist on the target. Eg, getAll isn't in Edge.
      !(targetFuncName in (useIndex ? IDBIndex : IDBObjectStore).prototype) || !(isWrite || readMethods.includes(targetFuncName))
    ) {
      return;
    }
    const method = async function(storeName, ...args) {
      const tx = this.transaction(storeName, isWrite ? "readwrite" : "readonly");
      let target2 = tx.store;
      if (useIndex)
        target2 = target2.index(args.shift());
      return (await Promise.all([
        target2[targetFuncName](...args),
        isWrite && tx.done
      ]))[0];
    };
    cachedMethods.set(prop, method);
    return method;
  }
  replaceTraps((oldTraps) => ({
    ...oldTraps,
    get: (target, prop, receiver) => getMethod(target, prop) || oldTraps.get(target, prop, receiver),
    has: (target, prop) => !!getMethod(target, prop) || oldTraps.has(target, prop)
  }));
  const advanceMethodProps = ["continue", "continuePrimaryKey", "advance"];
  const methodMap = {};
  const advanceResults = /* @__PURE__ */ new WeakMap();
  const ittrProxiedCursorToOriginalProxy = /* @__PURE__ */ new WeakMap();
  const cursorIteratorTraps = {
    get(target, prop) {
      if (!advanceMethodProps.includes(prop))
        return target[prop];
      let cachedFunc = methodMap[prop];
      if (!cachedFunc) {
        cachedFunc = methodMap[prop] = function(...args) {
          advanceResults.set(this, ittrProxiedCursorToOriginalProxy.get(this)[prop](...args));
        };
      }
      return cachedFunc;
    }
  };
  async function* iterate(...args) {
    let cursor = this;
    if (!(cursor instanceof IDBCursor)) {
      cursor = await cursor.openCursor(...args);
    }
    if (!cursor)
      return;
    cursor = cursor;
    const proxiedCursor = new Proxy(cursor, cursorIteratorTraps);
    ittrProxiedCursorToOriginalProxy.set(proxiedCursor, cursor);
    reverseTransformCache.set(proxiedCursor, unwrap(cursor));
    while (cursor) {
      yield proxiedCursor;
      cursor = await (advanceResults.get(proxiedCursor) || cursor.continue());
      advanceResults.delete(proxiedCursor);
    }
  }
  function isIteratorProp(target, prop) {
    return prop === Symbol.asyncIterator && instanceOfAny(target, [IDBIndex, IDBObjectStore, IDBCursor]) || prop === "iterate" && instanceOfAny(target, [IDBIndex, IDBObjectStore]);
  }
  replaceTraps((oldTraps) => ({
    ...oldTraps,
    get(target, prop, receiver) {
      if (isIteratorProp(target, prop))
        return iterate;
      return oldTraps.get(target, prop, receiver);
    },
    has(target, prop) {
      return isIteratorProp(target, prop) || oldTraps.has(target, prop);
    }
  }));
  const DB_NAME = "ruozhi-filter-db";
  const DB_VERSION = 4;
  let dbPromise = null;
  const blByMid = /* @__PURE__ */ new Map();
  const blByUid = /* @__PURE__ */ new Map();
  const cacheByHash = /* @__PURE__ */ new Map();
  let memoryCacheReady = false;
  function getDB() {
    if (!dbPromise) {
      dbPromise = openDB(DB_NAME, DB_VERSION, {
        upgrade(db, oldVersion) {
          if (oldVersion < 1) {
            if (!db.objectStoreNames.contains("blacklist")) {
              const bl = db.createObjectStore("blacklist", { keyPath: "mid" });
              bl.createIndex("timestamp", "timestamp");
              bl.createIndex("severity", "severity");
            }
          }
          if (oldVersion < 2) {
            if (db.objectStoreNames.contains("blacklist")) {
              db.deleteObjectStore("blacklist");
            }
            const bl = db.createObjectStore("blacklist", {
              keyPath: "uid"
            });
            bl.createIndex("timestamp", "timestamp");
            bl.createIndex("severity", "severity");
          }
          if (oldVersion < 4) {
            if (db.objectStoreNames.contains("blacklist")) {
              db.deleteObjectStore("blacklist");
            }
            const bl = db.createObjectStore("blacklist", { keyPath: "mid" });
            bl.createIndex("timestamp", "timestamp");
            bl.createIndex("severity", "severity");
            bl.createIndex("uid", "uid");
          }
          if (!db.objectStoreNames.contains("cache")) {
            const c = db.createObjectStore("cache", { keyPath: "hash" });
            c.createIndex("timestamp", "timestamp");
          }
        }
      });
    }
    return dbPromise;
  }
  function strHash$1(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
      h = (h << 5) + h + s.charCodeAt(i) & 2147483647;
    }
    return h;
  }
  function blacklistKey(uname) {
    return strHash$1(uname.trim());
  }
  function commentHash(message, mid) {
    const input = `${mid}:${message.trim().slice(0, 200)}`;
    return strHash$1(input).toString(16);
  }
  function isBlacklistedSync(mid, uname) {
    if (mid > 0) {
      const record = blByMid.get(mid);
      if (record) return record;
    }
    const uid = blacklistKey(uname);
    return blByUid.get(uid) ?? null;
  }
  function getCacheSync(hash) {
    return cacheByHash.get(hash) ?? null;
  }
  async function isBlacklisted(mid, uname) {
    const mem = isBlacklistedSync(mid, uname);
    if (mem) return mem;
    const db = await getDB();
    if (mid > 0) {
      const record = await db.get("blacklist", mid);
      if (record) return record;
    }
    return await db.getFromIndex("blacklist", "uid", blacklistKey(uname)) ?? null;
  }
  async function addToBlacklist(record) {
    const db = await getDB();
    const uid = blacklistKey(record.uname);
    const key = record.mid > 0 ? record.mid : uid;
    const entry = { ...record, mid: key, uid };
    await db.put("blacklist", entry);
    if (memoryCacheReady) {
      blByMid.set(key, entry);
      blByUid.set(uid, entry);
    }
  }
  async function getAllBlacklist() {
    const db = await getDB();
    return db.getAll("blacklist");
  }
  async function removeFromBlacklist(mid) {
    const db = await getDB();
    const record = blByMid.get(mid);
    if (record) {
      blByMid.delete(mid);
      if (record.uid) blByUid.delete(record.uid);
    }
    await db.delete("blacklist", mid);
  }
  async function clearBlacklist() {
    const db = await getDB();
    blByMid.clear();
    blByUid.clear();
    await db.clear("blacklist");
  }
  async function getCache(hash) {
    const mem = cacheByHash.get(hash);
    if (mem) {
      if (Date.now() - mem.timestamp > 24 * 60 * 60 * 1e3) {
        cacheByHash.delete(hash);
        return null;
      }
      return mem;
    }
    const db = await getDB();
    const entry = await db.get("cache", hash);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > 24 * 60 * 60 * 1e3) {
      await db.delete("cache", hash);
      return null;
    }
    return entry;
  }
  async function setCache(entry) {
    const db = await getDB();
    await db.put("cache", entry);
    if (memoryCacheReady) {
      cacheByHash.set(entry.hash, entry);
      if (cacheByHash.size > 3e3) {
        const oldest = [...cacheByHash.entries()].sort(
          (a, b) => a[1].timestamp - b[1].timestamp
        )[0];
        if (oldest) cacheByHash.delete(oldest[0]);
      }
    }
  }
  async function deleteCommentFromCache(hash) {
    cacheByHash.delete(hash);
    const db = await getDB();
    await db.delete("cache", hash);
  }
  async function clearCache() {
    const db = await getDB();
    cacheByHash.clear();
    await db.clear("cache");
  }
  async function pruneCache() {
    const db = await getDB();
    const now = Date.now();
    const expiry = 24 * 60 * 60 * 1e3;
    for (const [hash, entry] of cacheByHash) {
      if (now - entry.timestamp > expiry) cacheByHash.delete(hash);
    }
    if (cacheByHash.size > 3e3) {
      const sorted = [...cacheByHash.entries()].sort(
        (a, b) => b[1].timestamp - a[1].timestamp
      );
      cacheByHash.clear();
      for (const [hash, entry] of sorted.slice(0, 3e3)) {
        cacheByHash.set(hash, entry);
      }
    }
    const all = await db.getAll("cache");
    all.sort((a, b) => b.timestamp - a.timestamp);
    const keep = all.slice(0, 5e3);
    const keepHashes = new Set(keep.map((e) => e.hash));
    const toDelete = all.filter((e) => !keepHashes.has(e.hash));
    const tx = db.transaction("cache", "readwrite");
    for (const entry of toDelete) {
      await tx.store.delete(entry.hash);
    }
    await tx.done;
  }
  async function initMemoryCache() {
    if (memoryCacheReady) return;
    try {
      const db = await getDB();
      const allBL = await db.getAll("blacklist");
      for (const record of allBL) {
        blByMid.set(record.mid, record);
        if (record.uid) blByUid.set(record.uid, record);
      }
      const allCache = await db.getAll("cache");
      const now = Date.now();
      const expiry = 24 * 60 * 60 * 1e3;
      allCache.sort((a, b) => b.timestamp - a.timestamp);
      for (const entry of allCache.slice(0, 3e3)) {
        if (now - entry.timestamp <= expiry) {
          cacheByHash.set(entry.hash, entry);
        }
      }
      memoryCacheReady = true;
      log(
        "[ruozhi-filter]",
        `Memory cache ready: 黑名单=${blByMid.size}条, 缓存=${cacheByHash.size}条`
      );
    } catch (err) {
      console.error("[ruozhi-filter]", "Memory cache init failed:", err);
    }
  }
  const TAG$6 = "[ruozhi-filter]";
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    }
  }
  function findByText(root, text) {
    const walk = (node) => {
      var _a, _b;
      for (const child of node.children) {
        const el = child;
        if ((((_a = el.innerText) == null ? void 0 : _a.trim()) || ((_b = el.textContent) == null ? void 0 : _b.trim()) || "") === text)
          return el;
        if (el.shadowRoot) {
          const f = walk(el.shadowRoot);
          if (f) return f;
        }
        if (el.children.length > 0) {
          const f = walk(el);
          if (f) return f;
        }
      }
      return null;
    };
    return walk(
      root instanceof Element ? root.shadowRoot ?? root : root
    );
  }
  function waitFor(cb, ms) {
    return new Promise((r) => {
      const s = Date.now();
      const c = () => {
        if (cb()) r(true);
        else if (Date.now() - s > ms) r(false);
        else requestAnimationFrame(c);
      };
      c();
    });
  }
  function deepFind(root, sel) {
    const e = root.querySelector(sel);
    if (e) return e;
    for (const c of root.children) {
      const ce = c;
      if (ce.shadowRoot) {
        const f = deepFind(ce.shadowRoot, sel);
        if (f) return f;
      }
    }
    return null;
  }
  function findCommentRenderer(el) {
    const rootNode = el.getRootNode();
    const shadowHost = rootNode instanceof ShadowRoot ? rootNode.host : null;
    if (shadowHost && shadowHost.tagName.toLowerCase().includes("comment-renderer")) {
      return shadowHost;
    }
    const found = el.closest("bili-comment-renderer") ?? el.closest("bili-comment-thread-renderer");
    if (found) return found;
    return el;
  }
  async function triggerReport(commentEl, reason) {
    var _a;
    const reasonCopied = await copyToClipboard(reason);
    if (reasonCopied) showToast("已复制 AI 判定理由，请粘贴到举报框 (Cmd+V)");
    const renderer = findCommentRenderer(commentEl);
    log(
      TAG$6,
      "Comment container:",
      renderer.tagName.toLowerCase(),
      "| shadowRoot:",
      !!renderer.shadowRoot,
      "| children:",
      ((_a = renderer.shadowRoot) == null ? void 0 : _a.children.length) ?? 0
    );
    const prevDisplay = renderer.style.display;
    renderer.style.display = "";
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    try {
      const sr = renderer.shadowRoot;
      if (!sr) {
        warn(TAG$6, "No shadowRoot:", renderer.tagName);
        return { opened: false, reasonCopied };
      }
      const actionBar = deepFind(sr, "bili-comment-action-buttons-renderer");
      if (!actionBar || !actionBar.shadowRoot) {
        warn(
          TAG$6,
          "No action-buttons found",
          "| 子元素:",
          [...sr.children].map((c) => c.tagName.toLowerCase())
        );
        return { opened: false, reasonCopied };
      }
      const actionSR = actionBar.shadowRoot;
      const moreBtn = actionSR.querySelector(
        "#more button"
      );
      if (!moreBtn) {
        warn(TAG$6, "No 'More' button found");
        return { opened: false, reasonCopied };
      }
      log(TAG$6, "Clicking 'More'...");
      moreBtn.click();
      const ok = await waitFor(() => {
        const m = actionSR.querySelector(
          "bili-comment-menu"
        );
        return !!((m == null ? void 0 : m.shadowRoot) && (m.getAttribute("style") || "").includes(
          "--bili-comment-menu-display:block"
        ));
      }, 2e3);
      if (!ok) {
        warn(TAG$6, "Menu did not appear");
        return { opened: false, reasonCopied };
      }
      const menuEl = actionSR.querySelector("bili-comment-menu");
      const reportLi = findByText(
        menuEl.shadowRoot,
        "举报"
      );
      if (!reportLi) {
        warn(TAG$6, "No 'Report' found in menu");
        return { opened: false, reasonCopied };
      }
      log(TAG$6, "Clicking 'Report'...");
      reportLi.click();
      waitAndFillReportForm(reason);
      log(TAG$6, "Native report triggered");
      return { opened: true, reasonCopied };
    } finally {
      renderer.style.display = prevDisplay;
    }
  }
  function waitAndFillReportForm(reason) {
    const s = Date.now();
    let n = 0;
    const f = () => {
      var _a;
      n++;
      const popup = document.querySelector("bili-comments-popup");
      if (!popup) {
        if (Date.now() - s < 4e3) setTimeout(f, 200);
        return;
      }
      const form = popup.querySelector("bili-comment-report-form");
      if (!form || !form.shadowRoot) {
        if (Date.now() - s < 4e3) setTimeout(f, 200);
        return;
      }
      const sr = form.shadowRoot;
      if (n <= 2) {
        const categoryKeywords = ["骚扰谩骂", "谩骂", "骚扰", "人身攻击", "引战"];
        let matched = false;
        for (const kw of categoryKeywords) {
          for (const opt of sr.querySelectorAll("#option")) {
            const nameEl = opt.querySelector("#option-name");
            if (nameEl && ((_a = nameEl.innerText) == null ? void 0 : _a.includes(kw))) {
              const radio = opt.querySelector("bili-radio");
              if (radio && radio.shadowRoot) {
                const sp = radio.shadowRoot.querySelector(
                  "#input"
                );
                if (sp) {
                  sp.click();
                  log(TAG$6, `Selected '${kw}' category`);
                  matched = true;
                  break;
                }
              }
              const inp = opt.querySelector(
                'input[type="radio"][value="4"]'
              );
              if (inp) {
                inp.click();
                matched = true;
                break;
              }
            }
          }
          if (matched) break;
        }
        setTimeout(f, 300);
        return;
      }
      const ta = sr.querySelector(
        "textarea[maxlength='200']"
      );
      if (ta) {
        ta.value = reason.slice(0, 200);
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        ta.dispatchEvent(new Event("change", { bubbles: true }));
        log(TAG$6, "Report reason auto-filled");
        return;
      }
      if (Date.now() - s < 4e3) setTimeout(f, 300);
    };
    setTimeout(f, 600);
  }
  async function triggerQuickReport(commentEl, reason) {
    const { opened } = await triggerReport(commentEl, reason);
    return { opened };
  }
  async function copyReason(reason) {
    const ok = await copyToClipboard(reason);
    if (ok) showToast("已复制 AI 判定理由，请粘贴到举报框 (Cmd+V)");
    return ok;
  }
  const STATS_KEY = "ruozhi-stats";
  function loadStats() {
    try {
      const raw = GM_getValue(STATS_KEY, "");
      if (raw) return JSON.parse(raw);
    } catch {
    }
    return {
      totalFiltered: 0,
      totalScanned: 0,
      apiCalls: 0,
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      severityCounts: {},
      lastUpdate: 0
    };
  }
  function saveStats(s) {
    try {
      GM_setValue(STATS_KEY, JSON.stringify(s));
    } catch {
    }
  }
  const ruozhiStats = loadStats();
  if (typeof window !== "undefined") {
    window.__ruozhi_stats = ruozhiStats;
  }
  let updateStats = () => {
  };
  function setUpdateStats(fn) {
    updateStats = fn;
  }
  function notifyStatsUpdate() {
    try {
      updateStats(ruozhiStats);
    } catch {
    }
  }
  function resetStats() {
    ruozhiStats.totalFiltered = 0;
    ruozhiStats.totalScanned = 0;
    ruozhiStats.apiCalls = 0;
    ruozhiStats.totalTokens = 0;
    ruozhiStats.promptTokens = 0;
    ruozhiStats.completionTokens = 0;
    ruozhiStats.severityCounts = {};
    ruozhiStats.lastUpdate = 0;
    saveStats(ruozhiStats);
  }
  function extractVideoInfo() {
    var _a, _b, _c, _d;
    const titleEl = document.querySelector("h1.video-title") ?? document.querySelector(".video-info-title .tit") ?? document.querySelector("[data-title]");
    if (titleEl) {
      currentContext.videoTitle = ((_a = titleEl.dataset) == null ? void 0 : _a.title) ?? titleEl.getAttribute("data-title") ?? titleEl.getAttribute("title") ?? ((_b = titleEl.textContent) == null ? void 0 : _b.trim()) ?? "";
    }
    const descEl = document.querySelector("#v_desc .desc-info-text") ?? document.querySelector(".desc-info-text") ?? document.querySelector(".basic-desc-info");
    if (descEl) {
      const t = ((_c = descEl.textContent) == null ? void 0 : _c.trim()) ?? "";
      currentContext.videoDesc = t === "-" ? "" : t;
    }
    const bc = document.querySelector("bili-comments");
    if (bc) {
      const p = bc.getAttribute("data-params");
      if (p) {
        const pts = p.split(",");
        if (pts.length >= 2) currentContext.oid = parseInt(pts[1]) || 0;
      }
    }
    if (!currentContext.oid) {
      try {
        for (const s of document.querySelectorAll("script")) {
          const m = (s.textContent ?? "").match(
            /window\.__INITIAL_STATE__\s*=\s*(\{.+?\});/
          );
          if (m) {
            const data = JSON.parse(m[1]);
            const aid = ((_d = data == null ? void 0 : data.videoData) == null ? void 0 : _d.aid) ?? (data == null ? void 0 : data.aid);
            if (aid) {
              currentContext.oid = aid;
              break;
            }
          }
        }
      } catch {
      }
    }
    if (!currentContext.oid) {
      location.pathname.match(/\/video\/(BV\w+)/);
    }
  }
  function strHash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
      h = (h << 5) + h + s.charCodeAt(i) & 2147483647;
    }
    return h;
  }
  function getCommentRoot() {
    const bc = document.querySelector("bili-comments");
    if (bc && bc.shadowRoot) return bc.shadowRoot;
    if (bc) return bc;
    const containerSelectors = [
      "#comment",
      "#commentapp",
      ".comment-container",
      ".reply-list",
      ".bb-comment"
    ];
    for (const sel of containerSelectors) {
      const el = document.querySelector(sel);
      if (el && el.querySelectorAll("*").length > 5) return el;
    }
    return null;
  }
  function findCommentElements(root) {
    var _a;
    let items = root.querySelectorAll("bili-comment-thread-renderer");
    if (items.length > 0) return items;
    items = root.querySelectorAll("[data-rpid]");
    if (items.length > 0) return items;
    items = root.querySelectorAll(
      ".reply-item, .comment-item, .comment-list > div, .reply-wrap, bb-comment"
    );
    if (items.length > 0) return items;
    const divs = root.querySelectorAll("div");
    if (divs.length > 500) return [];
    const candidates = [];
    for (const d of divs) {
      if (candidates.length >= 100) break;
      const childCount = d.querySelectorAll("*").length;
      if (childCount < 3 || childCount > 80) continue;
      const t = ((_a = d.innerText) == null ? void 0 : _a.trim()) ?? "";
      if (t.length < 30 || t.length > 5e3) continue;
      if (!t.includes("回复") || !t.includes("举报")) continue;
      candidates.push(d);
    }
    return candidates;
  }
  const IGNORE_TEXTS = /* @__PURE__ */ new Set([
    "回复",
    "举报",
    "硬核会员举报",
    "点赞",
    "踩",
    "收起",
    "展开",
    "·",
    ">>",
    "查看全文",
    "热评",
    "置顶",
    "UP主",
    "笔记",
    "UP主觉得很赞",
    "UP主赞过",
    "发起会话",
    "关注",
    "已关注",
    "复制评论链接",
    "加入黑名单",
    "记笔记",
    // UP主可见的操作按钮文本（不应混入评论内容发送给AI）
    "设为置顶",
    "删除",
    "设置屏蔽词"
  ]);
  function isUIText(s) {
    if (/^(\d+|[\d.]+[万亿]?|\d+:\d+|\d+楼|#\d+)$/.test(s)) return true;
    if (/^\d{4}-\d{2}-\d{2}\s*\d{2}:\d{2}$/.test(s)) return true;
    if (/^(刚刚|\d+分钟前|\d+小时前|昨天|\d+天前)$/.test(s)) return true;
    if (/^(共\s*\d+\s*条回复|展开\s*\d+\s*条回复|查看全部\s*\d+\s*条)$/.test(s))
      return true;
    return false;
  }
  function extractComment(el) {
    var _a;
    try {
      let deepInnerText = function(root) {
        var _a2;
        let text = "";
        for (const child of root.children) {
          const el2 = child;
          const tag2 = el2.tagName.toLowerCase();
          if (tag2 === "style") continue;
          const cls = String(
            el2.className || el2.getAttribute("class") || ""
          ).toLowerCase();
          if (cls.includes("sub-reply") || cls.includes("reply-item") || cls.includes("fan") || cls.includes("medal") || tag2.includes("-reply") || tag2.includes("-replies"))
            continue;
          if (cls.includes("report") || cls.includes("operation") || cls.includes("btn") || cls.includes("action") || cls.includes("pin") || cls.includes("shield") || cls.includes("up-") || tag2 === "button")
            continue;
          if (el2.shadowRoot) {
            text += deepInnerText(el2.shadowRoot) + "\n";
          } else if (el2.children.length > 0) {
            text += deepInnerText(el2) + "\n";
          } else {
            const t = (_a2 = el2.innerText) == null ? void 0 : _a2.trim();
            if (t) text += t + "\n";
          }
        }
        return text;
      }, findRpid = function(root) {
        const el2 = root.querySelector("[data-rpid]");
        if (el2) return el2.getAttribute("data-rpid");
        for (const child of root.children) {
          const c = child;
          if (c.shadowRoot) {
            const r = findRpid(c.shadowRoot);
            if (r) return r;
          }
        }
        return null;
      }, findMid = function(root) {
        const el2 = root.querySelector(
          "[data-mid], [data-uid], [data-user-profile-id]"
        );
        if (el2)
          return el2.getAttribute("data-mid") ?? el2.getAttribute("data-uid") ?? el2.getAttribute("data-user-profile-id");
        for (const child of root.children) {
          const c = child;
          if (c.shadowRoot) {
            const r = findMid(c.shadowRoot);
            if (r) return r;
          }
        }
        return null;
      };
      const tag = el.tagName.toLowerCase();
      let fullText = "";
      if (el.shadowRoot) {
        fullText = deepInnerText(el.shadowRoot).trim();
      }
      if (!fullText) {
        fullText = ((_a = el.innerText) == null ? void 0 : _a.trim()) ?? "";
      }
      if (fullText.length < 3) return null;
      let rpid = 0;
      const rpidStr = el.getAttribute("data-rpid") ?? (el.shadowRoot ? findRpid(el.shadowRoot) : null);
      if (rpidStr) rpid = parseInt(rpidStr);
      if (!rpid) {
        const hashInput = `${tag}:${fullText.slice(0, 300)}`;
        rpid = strHash(hashInput);
      }
      let mid = 0;
      const midStr = el.getAttribute("data-mid") ?? el.getAttribute("data-uid") ?? el.getAttribute("data-user-profile-id") ?? (el.shadowRoot ? findMid(el.shadowRoot) : null);
      if (midStr) mid = parseInt(midStr) || 0;
      const lines = fullText.split("\n").map((l) => l.trim()).filter(Boolean);
      const contentLines = lines.filter((l) => {
        if (IGNORE_TEXTS.has(l)) return false;
        if (isUIText(l)) return false;
        return true;
      });
      if (contentLines.length === 0) return null;
      const uname = contentLines.find(
        (l) => l.length >= 2 && l.length <= 20 && !/^\d/.test(l) && !l.includes("·") && !l.includes("分钟") && !l.includes("小时") && !l.includes("刚刚") && !l.includes("昨天")
      ) ?? "未知用户";
      const msgParts = contentLines.filter(
        (l) => l !== uname || contentLines.filter((x) => x === l).length > 1
      );
      let message = msgParts.join(" ");
      message = message.replace(/\s*共\s*\d+\s*条回复[，,.]?\s*$/g, "").trim();
      if (uname !== "未知用户" && message.startsWith(uname)) {
        message = message.slice(uname.length).trim();
      }
      if (!message || message.length < 1) return null;
      return { el, rpid, mid, uname, message };
    } catch (e) {
      warn("[ruozhi-filter]", "  extractComment 异常:", e);
      return null;
    }
  }
  const TAG$5 = "[ruozhi-filter]";
  async function filterReplies(config, replies, ctx, stats) {
    const violations = /* @__PURE__ */ new Map();
    let newBlacklistEntries = 0;
    if (replies.length === 0) return { violations, newBlacklistEntries };
    const needAICheck = [];
    const preChecks = await Promise.all(
      replies.map(async (reply) => {
        if (config.enableBlacklist) {
          const blRecord = await isBlacklisted(reply.mid, reply.member.uname);
          if (blRecord) {
            return {
              reply,
              hit: "blacklist",
              reason: `[黑名单] ${blRecord.reason}`,
              severity: blRecord.severity
            };
          }
        }
        const hash = commentHash(reply.content.message, reply.mid);
        const cached = await getCache(hash);
        if (cached && cached.violation) {
          return {
            reply,
            hit: "cache",
            reason: `[缓存] ${cached.reason}`,
            severity: cached.severity
          };
        }
        return { reply, hit: null };
      })
    );
    for (const result of preChecks) {
      if (result.hit) {
        violations.set(result.reply.rpid, {
          reason: result.reason,
          severity: result.severity
        });
        if (stats) {
          stats.totalFiltered++;
          stats.severityCounts[result.severity] = (stats.severityCounts[result.severity] ?? 0) + 1;
        }
      } else if (config.enableAI) {
        needAICheck.push(result.reply);
      }
    }
    if (needAICheck.length > 0 && config.enableAI && config.apiKey) {
      try {
        const result = await batchJudge(config, needAICheck, ctx);
        if (stats && result.usage) {
          stats.totalTokens += result.usage.total_tokens ?? 0;
          stats.promptTokens += result.usage.prompt_tokens ?? 0;
          stats.completionTokens += result.usage.completion_tokens ?? 0;
          stats.apiCalls++;
        }
        for (const v of result.verdicts) {
          const reply = needAICheck.find((r) => r.rpid === v.rpid);
          if (reply) {
            const hash = commentHash(reply.content.message, reply.mid);
            await setCache({
              hash,
              violation: v.violation,
              reason: v.reason,
              severity: v.severity,
              timestamp: Date.now()
            });
          }
          if (v.violation) {
            violations.set(v.rpid, {
              reason: v.reason,
              severity: v.severity
            });
            if (stats) {
              stats.totalFiltered++;
              stats.severityCounts[v.severity] = (stats.severityCounts[v.severity] ?? 0) + 1;
            }
            if ((v.severity === "block" || v.severity === "high") && reply) {
              log(TAG$5, `Auto-blocking: uid=${v.mid} ${reply.member.uname}`);
              await addToBlacklist({
                mid: v.mid,
                uname: reply.member.uname,
                rpid: v.rpid,
                message: reply.content.message,
                reason: v.reason,
                videoTitle: ctx.videoTitle,
                videoUrl: window.location.href,
                timestamp: Date.now(),
                severity: v.severity,
                source: "auto"
              });
              newBlacklistEntries++;
            }
          }
        }
      } catch (err) {
        console.error(TAG$5, "AI judgment failed:", err);
      }
    } else if (needAICheck.length > 0 && !config.apiKey) {
      warn(TAG$5, "No API key configured，跳过 AI 判定");
    }
    if (stats) stats.lastUpdate = Date.now();
    return { violations, newBlacklistEntries };
  }
  const TAG$4 = "[ruozhi-filter]";
  function fullPageDiagnostic() {
    var _a, _b;
    log(TAG$4, "══════ 诊断 ══════");
    const bc = document.querySelector("bili-comments");
    log(
      TAG$4,
      `bili-comments: ${bc ? "shadowRoot=" + !!bc.shadowRoot + " children=" + bc.children.length : "not found"}`
    );
    const containerSelectors = [
      "#comment",
      "#commentapp",
      ".comment-container",
      ".reply-list",
      ".bb-comment",
      "[class*='comment']",
      "[class*='reply']",
      "[id*='comment']",
      "[id*='reply']"
    ];
    for (const sel of containerSelectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0 && els.length < 200) {
        const first = els[0];
        const id = first.id ? `#${first.id}` : "(无id)";
        const cls = first.className ? "." + first.className.split(" ").slice(0, 3).join(".") : "(无class)";
        log(
          TAG$4,
          `   "${sel}" → ${els.length}个 ${first.tagName.toLowerCase()}${id}${cls}`
        );
      }
    }
    if (bc && bc.shadowRoot) {
      const sr = bc.shadowRoot;
      const allNodes = sr.querySelectorAll("*");
      log(TAG$4, `🔬 ShadowRoot 总节点: ${allNodes.length}`);
      const tagCounts = /* @__PURE__ */ new Map();
      allNodes.forEach((n) => {
        const t = n.tagName.toLowerCase();
        tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      });
      log(
        TAG$4,
        `  标签分布: ${[...tagCounts.entries()].map(([k, v]) => `${k}x${v}`).join(", ")}`
      );
      const itemChecks = [
        "[data-rpid]",
        ".reply-item",
        ".comment-item",
        ".reply-wrap",
        ".con",
        "bb-comment"
      ];
      for (const sel of itemChecks) {
        const count = sr.querySelectorAll(sel).length;
        log(TAG$4, `  🎯 "${sel}" → ${count}个`);
      }
      log(TAG$4, "ShadowRoot 直接子元素:");
      for (const child of sr.children) {
        const tag = child.tagName.toLowerCase();
        const id = child.id ? `#${child.id}` : "";
        const cls = child.className ? "." + child.className.split(" ").slice(0, 3).join(".") : "";
        const text = ((_a = child.innerText) == null ? void 0 : _a.slice(0, 60)) ?? "";
        const childCount = child.querySelectorAll("*").length;
        log(TAG$4, `  <${tag}${id}${cls}> 子元素:${childCount} text:"${text}"`);
        if (childCount > 0 && childCount <= 30) {
          for (const c2 of child.children) {
            const t2 = c2.tagName.toLowerCase();
            const id2 = c2.id ? `#${c2.id}` : "";
            const cls2 = c2.className ? "." + c2.className.split(" ").slice(0, 2).join(".") : "";
            const txt2 = ((_b = c2.innerText) == null ? void 0 : _b.slice(0, 50)) ?? "";
            const dataAttrs = c2 instanceof HTMLElement ? c2.getAttributeNames().filter((a) => a.startsWith("data-")).join(", ") : "";
            log(
              TAG$4,
              `   <${t2}${id2}${cls2}>${dataAttrs ? " [" + dataAttrs + "]" : ""} "${txt2}"`
            );
          }
        }
      }
    }
    const mainSections = [
      "#reply",
      "#danmakuBox",
      ".player-auxiliary",
      ".video-info-container",
      ".video-data",
      "section"
    ];
    log(TAG$4, "📐 页面结构:");
    for (const sel of mainSections) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) log(TAG$4, `  ${sel}: ${els.length}个`);
    }
    log(TAG$4, "══════ 完成 ══════");
  }
  function inspectShadowRoot() {
    const bc = document.querySelector("bili-comments");
    if (!bc || !bc.shadowRoot) {
      log(TAG$4, "bili-comments 或其 shadowRoot 未找到");
      return;
    }
    const sr = bc.shadowRoot;
    log(TAG$4, "══════ ShadowRoot 完整探查 ══════");
    log(TAG$4, `总节点数: ${sr.querySelectorAll("*").length}`);
    log(TAG$4, `直接子元素数: ${sr.children.length}`);
    function dump(el, depth = 0) {
      var _a, _b;
      if (depth > 4) return;
      const indent = "  ".repeat(depth);
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : "";
      const cls = el.className ? "." + el.className.split(" ").slice(0, 3).join(".") : "";
      const attrs = el instanceof HTMLElement ? el.getAttributeNames().filter((a) => a !== "class" && a !== "id").map((a) => `${a}="${el.getAttribute(a)}"`.slice(0, 60)).join(" ") : "";
      const text = ((_b = (_a = el.innerText) == null ? void 0 : _a.slice(0, 80)) == null ? void 0 : _b.replace(/\n/g, " ")) ?? "";
      log(TAG$4, `${indent}<${tag}${id}${cls}> ${attrs} "${text}"`);
      if (el.children.length <= 4) {
        for (const c of el.children) dump(c, depth + 1);
      } else if (depth < 3) {
        log(TAG$4, `${indent}  ... ${el.children.length}个子元素，取前4个`);
        for (let i = 0; i < Math.min(4, el.children.length); i++) {
          dump(el.children[i], depth + 1);
        }
      }
    }
    for (const child of sr.children) {
      dump(child, 0);
    }
    log(TAG$4, "══════ 探查完成 ══════");
  }
  const TAG$3 = "[ruozhi-filter]";
  let pendingBatch = [];
  let batchTimer = null;
  const scannedRpids = /* @__PURE__ */ new Set();
  let isFlushing = false;
  function skipAI(info) {
    const config = getConfig();
    if (!config.prefilterShort && !config.prefilterSymbols && !config.prefilterEnglish) {
      return false;
    }
    const msg = info.message.trim();
    if (config.prefilterShort && [...msg].filter((c) => c !== " ").length < 3)
      return true;
    if (config.prefilterSymbols && /^[\s\d\p{P}\p{S}\p{Emoji}，,。.！!？?…~～、]+$/u.test(msg) && msg.length < 15)
      return true;
    if (config.prefilterEnglish && /^[a-zA-Z\s!~]+$/.test(msg) && msg.length < 8)
      return true;
    return false;
  }
  function scanPage() {
    const root = getCommentRoot();
    if (!root) {
      log(TAG$3, "scanPage: 未找到评论区根节点");
      return;
    }
    const items = findCommentElements(root);
    log(
      TAG$3,
      `scanPage: 找到 ${items.length} 个评论元素, root=${root === document ? "document" : root.tagName || "shadowRoot"}`
    );
    if (items.length === 0) return;
    let found = 0;
    items.forEach((el) => {
      if (el.style.display === "none") return;
      const info = extractComment(el);
      if (!info) return;
      injectManualBlacklistButton(el, info);
      const config = getConfig();
      if (config.enableBlacklist) {
        const blRecord = isBlacklistedSync(info.mid, info.uname);
        if (blRecord) {
          scannedRpids.add(info.rpid);
          found++;
          if (config.foldMode === "none") hideEl(info.el);
          else
            foldEl(
              info.el,
              info,
              {
                reason: `[黑名单] ${blRecord.reason}`,
                severity: blRecord.severity
              },
              config.foldMode
            );
          ruozhiStats.totalFiltered++;
          ruozhiStats.totalScanned++;
          ruozhiStats.severityCounts[blRecord.severity] = (ruozhiStats.severityCounts[blRecord.severity] ?? 0) + 1;
          return;
        }
      }
      if (config.enableAI) {
        const hash = commentHash(info.message, info.mid);
        const cached = getCacheSync(hash);
        if (cached && cached.violation) {
          scannedRpids.add(info.rpid);
          found++;
          if (config.foldMode === "none") hideEl(info.el);
          else
            foldEl(
              info.el,
              info,
              { reason: `[缓存] ${cached.reason}`, severity: cached.severity },
              config.foldMode
            );
          ruozhiStats.totalFiltered++;
          ruozhiStats.totalScanned++;
          ruozhiStats.severityCounts[cached.severity] = (ruozhiStats.severityCounts[cached.severity] ?? 0) + 1;
          return;
        }
      }
      if (scannedRpids.has(info.rpid)) return;
      scannedRpids.add(info.rpid);
      found++;
      if (!config.enableAI && !config.enableBlacklist) return;
      if (config.enableAI && skipAI(info)) return;
      pendingBatch.push(info);
    });
    if (found > 0) {
      if (pendingBatch.length >= 15) flushBatch();
      else if (!batchTimer) batchTimer = setTimeout(flushBatch, 150);
    }
  }
  async function flushBatch() {
    if (batchTimer) {
      clearTimeout(batchTimer);
      batchTimer = null;
    }
    if (pendingBatch.length === 0 || isFlushing) return;
    isFlushing = true;
    const batch = pendingBatch.splice(0);
    log(TAG$3, `AI judging: ${batch.length} 条评论`);
    const config = getConfig();
    if (!currentContext.videoTitle) extractVideoInfo();
    const replies = batch.map((p) => ({
      rpid: p.rpid,
      oid: currentContext.oid,
      mid: p.mid,
      root: 0,
      parent: 0,
      count: 0,
      rcount: 0,
      like: 0,
      ctime: 0,
      content: { message: p.message },
      member: { mid: String(p.mid), uname: p.uname, avatar: "" }
    }));
    try {
      const result = await filterReplies(
        config,
        replies,
        currentContext,
        ruozhiStats
      );
      ruozhiStats.totalScanned += batch.length;
      if (result.violations.size > 0) {
        log(TAG$3, ` ${result.violations.size}/${batch.length} 条违规`);
        let cleaned = 0;
        for (const [rpid, v] of result.violations) {
          const p = batch.find((x) => x.rpid === rpid);
          if (!p) continue;
          if (config.foldMode === "none" ? hideEl(p.el) : foldEl(p.el, p, v, config.foldMode))
            cleaned++;
        }
        try {
          notifyStatsUpdate();
        } catch {
        }
      } else {
        try {
          notifyStatsUpdate();
        } catch {
        }
      }
      saveStats(ruozhiStats);
    } catch (err) {
      console.error(TAG$3, "AI failure:", err);
    } finally {
      isFlushing = false;
    }
  }
  function watchNewComments() {
    const root = getCommentRoot();
    if (!root) {
      setTimeout(() => watchNewComments(), 3e3);
      return;
    }
    const observer = new MutationObserver(() => {
      if (!batchTimer) {
        batchTimer = setTimeout(() => {
          scanPage();
          batchTimer = null;
        }, 100);
      }
    });
    observer.observe(root, {
      childList: true,
      subtree: true
    });
    log(TAG$3, " MutationObserver 已绑定到评论根节点");
    scanPage();
  }
  function watchScrollLoading() {
    let scrollTimer = null;
    window.addEventListener(
      "scroll",
      () => {
        if (scrollTimer) clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
          scanPage();
          if (pendingBatch.length >= 15) flushBatch();
        }, 250);
      },
      { passive: true }
    );
  }
  function startDOMScanner() {
    setTimeout(() => scanPage(), 500);
    setTimeout(() => scanPage(), 1500);
    setInterval(() => {
      scanPage();
      if (pendingBatch.length >= 15) flushBatch();
    }, 3e3);
    setTimeout(() => watchNewComments(), 500);
    watchScrollLoading();
    const uw = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    uw.__ruozhi_diag = () => {
      fullPageDiagnostic();
      scanPage();
    };
    uw.__ruozhi_scan = () => scanPage();
    uw.__ruozhi_flush = () => flushBatch();
    uw.__ruozhi_inspect = () => inspectShadowRoot();
    uw.__ruozhi_reset_stats = () => resetStats();
  }
  const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Hiragino Sans GB', Helvetica, Arial, sans-serif";
  const THEMES = {
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
      inputPlaceholder: "#bfbab3"
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
      inputPlaceholder: "#8b949e"
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
      inputPlaceholder: "#5a5a5a"
    }
  };
  let COLOR = THEMES.github;
  function ensureStyleElement() {
    let el = document.getElementById(
      "ruozhi-dynamic-styles"
    );
    if (!el) {
      el = document.createElement("style");
      el.id = "ruozhi-dynamic-styles";
      document.head.appendChild(el);
    }
    return el;
  }
  function updateDynamicStyles() {
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
  function updateFabTheme() {
    const btn = document.getElementById("ruozhi-fab");
    const badge = document.getElementById("ruozhi-fab-badge");
    if (btn) {
      btn.style.background = COLOR.accent;
      btn.style.color = COLOR.textOnAccent;
    }
    if (badge) {
      badge.style.background = COLOR.red;
      badge.style.color = COLOR.textOnAccent;
    }
  }
  function applyTheme(name) {
    if (THEMES[name]) {
      COLOR = THEMES[name];
      updateDynamicStyles();
      updateFabTheme();
    }
  }
  function inputStyle() {
    return `width:100%;padding:8px 10px;border:1px solid ${COLOR.border};border-radius:4px;font-size:14px;box-sizing:border-box;font-family:${FONT};outline:none;background:${COLOR.surface};color:${COLOR.text};color-scheme:${COLOR === THEMES.dark ? "dark" : "light"}`;
  }
  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }
  function escapeAttr(s) {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function showToast(msg, duration = 2500) {
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
      boxShadow: "0 4px 16px rgba(0,0,0,0.15)"
    });
    document.body.appendChild(t);
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
  let panelVisible = false;
  let panelRoot = null;
  let fabBadge = null;
  let currentStats = null;
  function loadConfig() {
    try {
      const raw = GM_getValue("ruozhi-config", "");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed.foldMode === "boolean") {
          parsed.foldMode = parsed.foldMode ? "classic" : "none";
        }
        if (parsed.blacklistConfirm === void 0) {
          parsed.blacklistConfirm = true;
        }
        if (parsed.devMode === void 0) {
          parsed.devMode = false;
        }
        if (parsed.filterDimensions) {
          parsed.prompt = (parsed.prompt || "") + "\n\n违规判定维度：\n" + parsed.filterDimensions;
          delete parsed.filterDimensions;
        }
        if (!parsed.theme) {
          parsed.theme = "claude";
        }
        if (parsed.fontScale === void 0) {
          parsed.fontScale = 1;
        }
        if (!parsed.apiKeys || Object.keys(parsed.apiKeys).length === 0) {
          parsed.apiKeys = {};
          if (parsed.apiKey) {
            parsed.apiKeys[parsed.provider || "deepseek"] = parsed.apiKey;
          }
        }
        return { ...DEFAULT_CONFIG, ...parsed };
      }
    } catch {
    }
    return { ...DEFAULT_CONFIG };
  }
  function saveConfig(config) {
    GM_setValue("ruozhi-config", JSON.stringify(config));
  }
  function setStatsRef(stats) {
    currentStats = stats;
    updateFabBadge();
    updateStatsPanel();
  }
  function updateFabBadge() {
    if (fabBadge && currentStats) {
      const count = currentStats.totalFiltered;
      fabBadge.textContent = String(count);
      fabBadge.style.display = count > 0 ? "flex" : "none";
    }
  }
  function injectUI(config, onConfigChange) {
    applyTheme(config.theme ?? "github");
    injectFloatingButton(config, onConfigChange);
  }
  function injectFloatingButton(config, onConfigChange) {
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
      zoom: String(config.fontScale ?? 1)
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
      fontFamily: FONT
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
      userSelect: "none"
    });
    btn.addEventListener("mouseenter", () => {
      btn.style.background = COLOR.accentHover;
      btn.style.transform = "scale(1.08)";
      btn.style.boxShadow = "0 4px 12px rgba(0,0,0,0.18)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = COLOR.accent;
      btn.style.transform = "scale(1)";
      btn.style.boxShadow = "0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.06)";
    });
    btn.addEventListener(
      "click",
      () => toggleSettingsPanel(config, onConfigChange)
    );
    container.appendChild(badge);
    container.appendChild(btn);
    document.body.appendChild(container);
  }
  function toggleSettingsPanel(config, onConfigChange) {
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
  function buildSettingsPanel(config, onConfigChange) {
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
      zoom: String(config.fontScale ?? 1)
    });
    root.innerHTML = buildPanelHTML(config);
    document.body.appendChild(root);
    bindPanelEvents(root, config, onConfigChange);
    return root;
  }
  function buildPanelHTML(config) {
    function cb(b) {
      return b ? "checked" : "";
    }
    function sel(v, t) {
      return v === t ? "selected" : "";
    }
    const is = inputStyle();
    const opt = `background:${COLOR.bg};color:${COLOR.text}`;
    const kbItems = (config.knowledgeBase ?? []).map(
      (e, i) => `<div class="ruozhi-kb-item" style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid ${COLOR.border}"><span style="flex:1;word-break:break-word;font-size:13px">${esc(e)}</span><button class="ruozhi-kb-del" data-index="${i}" style="padding:1px 6px;font-size:11px;background:none;border:1px solid ${COLOR.border};border-radius:3px;color:${COLOR.secondary};cursor:pointer;font-family:${FONT}">&times;</button></div>`
    ).join("");
    const secLabel = `font-size:11px;font-weight:600;color:${COLOR.secondary};margin-bottom:8px;text-transform:uppercase;letter-spacing:0.05em`;
    const chkRow = `font-size:13px;color:${COLOR.text};display:flex;align-items:center;gap:8px;cursor:pointer;font-family:${FONT}`;
    const subChkRow = `font-size:12px;color:${COLOR.secondary};display:flex;align-items:center;gap:8px;cursor:pointer;font-family:${FONT}`;
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
    ${["设置", "统计", "学习"].map(
    (name, idx) => `<button class="ruozhi-tab${idx === 0 ? " active" : ""}" data-tab="${name}" style="flex:1;padding:8px 12px;border:none;background:${idx === 0 ? COLOR.accent : "transparent"};cursor:pointer;font-size:13px;font-family:${FONT};color:${idx === 0 ? COLOR.textOnAccent : COLOR.secondary};border-bottom:2px solid ${idx === 0 ? COLOR.accent : "transparent"};font-weight:${idx === 0 ? "600" : "400"};border-radius:6px 6px 0 0">${name}</button>`
  ).join("")}
  </div>

  <!-- ========== 设置 Tab ========== -->
  <div id="ruozhi-tab-settings" style="overflow-y:auto;flex:1;padding:14px 20px 20px">

    <!-- API 设置卡片 -->
    <div style="${cardStyle}">
      <div style="${secLabel}">API 配置</div>
      <div style="margin-bottom:10px">
        <div style="font-size:12px;color:${COLOR.secondary};margin-bottom:4px">AI 提供商</div>
        <select id="ruozhi-provider" style="${is}">
          ${Object.keys(PROVIDER_PRESETS).map((k) => `<option value="${k}" ${sel(k, config.provider)} style="${opt}">${PROVIDER_PRESETS[k].label}</option>`).join("")}
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
          <span id="ruozhi-font-scale-label" style="font-size:14px;color:${COLOR.text};min-width:48px;text-align:center;font-family:${FONT};font-weight:600">${(config.fontScale ?? 1).toFixed(1)}x</span>
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
  function bindPanelEvents(root, config, onConfigChange) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n;
    const tabs = root.querySelectorAll(".ruozhi-tab");
    (_a = root.querySelector("#ruozhi-panel-close")) == null ? void 0 : _a.addEventListener("click", () => {
      if (panelRoot) {
        panelRoot.style.display = "none";
        panelVisible = false;
      }
    });
    tabs.forEach((tab) => {
      tab.addEventListener("click", async () => {
        tabs.forEach((t2) => {
          t2.classList.remove("active");
          t2.style.background = "transparent";
          t2.style.color = COLOR.secondary;
          t2.style.fontWeight = "400";
          t2.style.borderBottomColor = "transparent";
        });
        const t = tab;
        t.classList.add("active");
        t.style.background = COLOR.accent;
        t.style.color = COLOR.textOnAccent;
        t.style.fontWeight = "600";
        t.style.borderBottomColor = COLOR.accent;
        const tabName = t.dataset.tab;
        const sections = {
          设置: root.querySelector("#ruozhi-tab-settings"),
          统计: root.querySelector("#ruozhi-tab-stats"),
          学习: root.querySelector("#ruozhi-tab-learning")
        };
        Object.values(sections).forEach(
          (el) => el && (el.style.display = "none")
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
    (_b = root.querySelector("#ruozhi-save")) == null ? void 0 : _b.addEventListener("click", () => {
      var _a2, _b2, _c2, _d2, _e2, _f2, _g2, _h2, _i2, _j2, _k2, _l2, _m2, _n2, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x;
      let storedConfig = {};
      try {
        storedConfig = JSON.parse(GM_getValue("ruozhi-config", "{}"));
      } catch {
      }
      const newConfig = {
        ...config,
        learnedProfile: storedConfig.learnedProfile ?? config.learnedProfile ?? "",
        learningCorrections: storedConfig.learningCorrections ?? config.learningCorrections ?? [],
        lastRefinedCount: storedConfig.lastRefinedCount ?? config.lastRefinedCount ?? 0,
        knowledgeBase: storedConfig.knowledgeBase ?? config.knowledgeBase ?? [],
        theme: ((_a2 = root.querySelector("#ruozhi-theme")) == null ? void 0 : _a2.value) ?? "github",
        provider: ((_b2 = root.querySelector("#ruozhi-provider")) == null ? void 0 : _b2.value) ?? "deepseek",
        model: ((_c2 = root.querySelector("#ruozhi-model")) == null ? void 0 : _c2.value) ?? config.model,
        apiKey: ((_d2 = root.querySelector("#ruozhi-apikey")) == null ? void 0 : _d2.value) ?? "",
        // 按提供商分别记忆密钥
        apiKeys: {
          ...config.apiKeys ?? {},
          ...storedConfig.apiKeys ?? {},
          [((_e2 = root.querySelector("#ruozhi-provider")) == null ? void 0 : _e2.value) ?? "deepseek"]: ((_f2 = root.querySelector("#ruozhi-apikey")) == null ? void 0 : _f2.value) ?? ""
        },
        apiEndpoint: ((_g2 = root.querySelector("#ruozhi-endpoint")) == null ? void 0 : _g2.value) ?? config.apiEndpoint,
        prompt: ((_h2 = root.querySelector("#ruozhi-prompt")) == null ? void 0 : _h2.value) ?? config.prompt,
        enableAI: ((_i2 = root.querySelector("#ruozhi-enable-ai")) == null ? void 0 : _i2.checked) ?? true,
        foldMode: ((_j2 = root.querySelector("#ruozhi-fold-mode")) == null ? void 0 : _j2.value) ?? "classic",
        enableBlacklist: ((_k2 = root.querySelector("#ruozhi-enable-bl")) == null ? void 0 : _k2.checked) ?? true,
        blacklistConfirm: ((_l2 = root.querySelector("#ruozhi-bl-confirm")) == null ? void 0 : _l2.checked) ?? true,
        devMode: ((_m2 = root.querySelector("#ruozhi-dev-mode")) == null ? void 0 : _m2.checked) ?? false,
        pricePerMToken: parseFloat(
          ((_n2 = root.querySelector("#ruozhi-price")) == null ? void 0 : _n2.value) || "1.1"
        ) || 1.1,
        sendUname: ((_o = root.querySelector("#ruozhi-send-uname")) == null ? void 0 : _o.checked) ?? false,
        sendMid: ((_p = root.querySelector("#ruozhi-send-mid")) == null ? void 0 : _p.checked) ?? false,
        sendVideoDesc: ((_q = root.querySelector("#ruozhi-send-videodesc")) == null ? void 0 : _q.checked) ?? false,
        learningEnabled: ((_r = root.querySelector("#ruozhi-learning")) == null ? void 0 : _r.checked) ?? true,
        fontScale: parseFloat(
          ((_s = root.querySelector("#ruozhi-font-scale-label")) == null ? void 0 : _s.textContent) ?? "1.0"
        ) || 1,
        prefilterShort: ((_t = root.querySelector("#ruozhi-prefilter-short")) == null ? void 0 : _t.checked) ?? false,
        prefilterSymbols: ((_u = root.querySelector("#ruozhi-prefilter-symbols")) == null ? void 0 : _u.checked) ?? false,
        prefilterEnglish: ((_v = root.querySelector("#ruozhi-prefilter-english")) == null ? void 0 : _v.checked) ?? false,
        enableRcmdFilter: ((_w = root.querySelector("#ruozhi-rcmd-enable")) == null ? void 0 : _w.checked) ?? false,
        rcmdPrompt: ((_x = root.querySelector("#ruozhi-rcmd-prompt")) == null ? void 0 : _x.value) ?? ""
      };
      saveConfig(newConfig);
      onConfigChange(newConfig);
      showPanelStatus(root, "已保存", COLOR.green);
    });
    (_c = root.querySelector("#ruozhi-rcmd-enable")) == null ? void 0 : _c.addEventListener("change", () => {
      var _a2;
      const checked = (_a2 = root.querySelector("#ruozhi-rcmd-enable")) == null ? void 0 : _a2.checked;
      const promptRow = root.querySelector(
        "#ruozhi-rcmd-prompt-row"
      );
      if (promptRow) promptRow.style.display = checked ? "" : "none";
    });
    (_d = root.querySelector("#ruozhi-enable-bl")) == null ? void 0 : _d.addEventListener("change", () => {
      var _a2;
      const checked = (_a2 = root.querySelector("#ruozhi-enable-bl")) == null ? void 0 : _a2.checked;
      const confirmRow = root.querySelector(
        "#ruozhi-bl-confirm-row"
      );
      if (confirmRow) confirmRow.style.display = checked ? "" : "none";
    });
    (_e = root.querySelector("#ruozhi-provider")) == null ? void 0 : _e.addEventListener("change", () => {
      var _a2;
      const val = (_a2 = root.querySelector("#ruozhi-provider")) == null ? void 0 : _a2.value;
      if (!val) return;
      const preset = PROVIDER_PRESETS[val];
      const endpointEl = root.querySelector(
        "#ruozhi-endpoint"
      );
      const modelEl = root.querySelector("#ruozhi-model");
      const apiKeyEl = root.querySelector("#ruozhi-apikey");
      const apiKeyRow = root.querySelector("#ruozhi-apikey-row");
      if (endpointEl && preset.endpoint) endpointEl.value = preset.endpoint;
      if (modelEl && preset.model) modelEl.value = preset.model;
      if (apiKeyEl) {
        apiKeyEl.value = config.apiKeys[val] ?? "";
      }
      if (apiKeyRow) {
        apiKeyRow.style.display = preset.needsAuth ? "" : "none";
      }
    });
    const initProvider = (_f = root.querySelector("#ruozhi-provider")) == null ? void 0 : _f.value;
    if (initProvider) {
      const preset = PROVIDER_PRESETS[initProvider];
      const apiKeyRow = root.querySelector("#ruozhi-apikey-row");
      if (apiKeyRow && !preset.needsAuth) {
        apiKeyRow.style.display = "none";
      }
    }
    (_g = root.querySelector("#ruozhi-test")) == null ? void 0 : _g.addEventListener("click", async () => {
      var _a2, _b2, _c2, _d2, _e2;
      const provider = (_a2 = root.querySelector("#ruozhi-provider")) == null ? void 0 : _a2.value;
      const needsAuth = ((_b2 = PROVIDER_PRESETS[provider]) == null ? void 0 : _b2.needsAuth) ?? true;
      const apiKey = (_c2 = root.querySelector("#ruozhi-apikey")) == null ? void 0 : _c2.value;
      const apiEndpoint = ((_d2 = root.querySelector("#ruozhi-endpoint")) == null ? void 0 : _d2.value) ?? config.apiEndpoint;
      const model = ((_e2 = root.querySelector("#ruozhi-model")) == null ? void 0 : _e2.value) ?? config.model;
      const testStatus = root.querySelector("#ruozhi-test-status");
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
        model
      });
      if (testStatus) {
        testStatus.textContent = ok ? "连接成功" : "连接失败";
        testStatus.style.color = ok ? COLOR.green : COLOR.red;
      }
    });
    (_h = root.querySelector("#ruozhi-clear-cache")) == null ? void 0 : _h.addEventListener("click", async () => {
      await clearCache();
      showPanelStatus(root, "缓存已清除", COLOR.green);
    });
    (_i = root.querySelector("#ruozhi-clear-bl")) == null ? void 0 : _i.addEventListener("click", async () => {
      if (!confirm("确定清空所有黑名单记录？此操作不可撤销。")) return;
      await clearBlacklist();
      _blCache = null;
      showPanelStatus(root, "黑名单已清空", COLOR.green);
      const blContent = root.querySelector("#ruozhi-blacklist-content");
      if (blContent)
        blContent.innerHTML = `<div style="padding:24px;text-align:center;color:${COLOR.muted}">暂无黑名单记录</div>`;
    });
    (_j = root.querySelector("#ruozhi-clear-learning")) == null ? void 0 : _j.addEventListener("click", () => {
      if (!confirm("确定清除所有学习记录？此操作不可撤销。")) return;
      clearLearning();
      showPanelStatus(root, "学习记录已清除", COLOR.green);
    });
    root.addEventListener("click", (e) => {
      const target = e.target;
      if (!target.closest("#ruozhi-clear-stats")) return;
      if (!confirm("确定重置所有统计数据？此操作不可撤销。")) return;
      resetStats();
      updateStatsPanel();
      showPanelStatus(root, "统计已重置", COLOR.green);
    });
    (_k = root.querySelector("#ruozhi-theme")) == null ? void 0 : _k.addEventListener("change", () => {
      var _a2;
      const themeName = (_a2 = root.querySelector("#ruozhi-theme")) == null ? void 0 : _a2.value;
      if (!themeName) return;
      applyTheme(themeName);
      try {
        const stored = JSON.parse(GM_getValue("ruozhi-config", "{}"));
        stored.theme = themeName;
        GM_setValue("ruozhi-config", JSON.stringify(stored));
        refreshConfig({ ...config, theme: themeName });
      } catch {
      }
      panelRoot == null ? void 0 : panelRoot.remove();
      panelRoot = null;
      panelVisible = false;
      toggleSettingsPanel({ ...config, theme: themeName }, onConfigChange);
    });
    const fontLabel = root.querySelector(
      "#ruozhi-font-scale-label"
    );
    const fabContainer = document.getElementById("ruozhi-fab-container");
    function applyFontScale(scale) {
      const clamped = Math.round(Math.min(1.5, Math.max(0.8, scale)) * 10) / 10;
      if (fontLabel) fontLabel.textContent = clamped.toFixed(1) + "x";
      if (panelRoot) panelRoot.style.zoom = String(clamped);
      if (fabContainer) fabContainer.style.zoom = String(clamped);
    }
    (_l = root.querySelector("#ruozhi-font-down")) == null ? void 0 : _l.addEventListener("click", () => {
      const cur = parseFloat((fontLabel == null ? void 0 : fontLabel.textContent) ?? "1.0");
      applyFontScale(cur - 0.1);
    });
    (_m = root.querySelector("#ruozhi-font-up")) == null ? void 0 : _m.addEventListener("click", () => {
      const cur = parseFloat((fontLabel == null ? void 0 : fontLabel.textContent) ?? "1.0");
      applyFontScale(cur + 0.1);
    });
    (_n = root.querySelector("#ruozhi-font-reset")) == null ? void 0 : _n.addEventListener("click", () => {
      applyFontScale(1);
    });
  }
  function showPanelStatus(root, msg, color) {
    const el = root.querySelector("#ruozhi-status");
    if (el) {
      el.style.opacity = "0";
      requestAnimationFrame(() => {
        el.textContent = msg;
        el.style.color = color;
        el.style.opacity = "1";
      });
    }
  }
  const BL_PAGE_SIZE = 15;
  let _blCache = null;
  let _blOffset = 0;
  function showKBPanel(root) {
    const panel = root.querySelector("#ruozhi-kb-panel");
    if (panel) panel.style.display = "";
  }
  async function loadBlacklistChunk(root, offset) {
    var _a;
    const panel = root.querySelector("#ruozhi-blacklist-panel");
    const contentEl = root.querySelector("#ruozhi-blacklist-content");
    const moreEl = root.querySelector("#ruozhi-bl-more");
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
    const fragment = chunk.map((r) => {
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
    }).join("");
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
        const newBtn = btn.cloneNode(true);
        (_a = btn.parentNode) == null ? void 0 : _a.replaceChild(newBtn, btn);
        newBtn.addEventListener(
          "click",
          () => loadBlacklistChunk(root, _blOffset)
        );
      }
    } else {
      if (moreEl) moreEl.style.display = "none";
    }
  }
  function refreshKBList(root) {
    const list = root.querySelector("#ruozhi-kb-list");
    if (!list) return;
    try {
      const raw = GM_getValue("ruozhi-config", "{}");
      const cfg = JSON.parse(raw);
      const kb = Array.isArray(cfg.knowledgeBase) ? cfg.knowledgeBase : [];
      list.innerHTML = kb.map(
        (e, i) => `<div class="ruozhi-kb-item" style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid ${COLOR.border}"><span style="flex:1;word-break:break-word;font-size:13px">${esc(e)}</span><button class="ruozhi-kb-del" data-index="${i}" style="padding:1px 6px;font-size:11px;background:none;border:1px solid ${COLOR.border};border-radius:3px;color:${COLOR.secondary};cursor:pointer;font-family:${FONT}">&times;</button></div>`
      ).join("");
      if (kb.length === 0) {
        list.innerHTML = `<div style="text-align:center;color:${COLOR.muted};padding:20px">暂无条目</div>`;
      }
    } catch {
    }
  }
  function bindKnowledgeEvents(root) {
    var _a, _b, _c;
    (_a = root.querySelector("#ruozhi-kb-add")) == null ? void 0 : _a.addEventListener("click", () => {
      var _a2;
      const input = root.querySelector("#ruozhi-kb-input");
      const val = (_a2 = input == null ? void 0 : input.value) == null ? void 0 : _a2.trim();
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
      }
    });
    (_b = root.querySelector("#ruozhi-kb-input")) == null ? void 0 : _b.addEventListener("keydown", (e) => {
      var _a2;
      if (e.key === "Enter") {
        (_a2 = root.querySelector("#ruozhi-kb-add")) == null ? void 0 : _a2.click();
      }
    });
    const exportBtn = root.querySelector("#ruozhi-kb-export");
    if (exportBtn && !exportBtn.dataset.bound) {
      exportBtn.dataset.bound = "1";
      exportBtn.addEventListener("click", () => {
        try {
          const cfg = JSON.parse(GM_getValue("ruozhi-config", "{}"));
          const entries = Array.isArray(cfg.knowledgeBase) ? cfg.knowledgeBase : [];
          const blob = new Blob(
            [
              JSON.stringify(
                {
                  version: 1,
                  description: "B站评论过滤 · 语境知识库",
                  exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
                  entryCount: entries.length,
                  entries
                },
                null,
                2
              )
            ],
            { type: "application/json" }
          );
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `ruozhi-kb-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`;
          a.click();
          URL.revokeObjectURL(url);
          kbStatus(root, `已导出 ${entries.length} 条`, COLOR.green);
        } catch {
          kbStatus(root, "导出失败", COLOR.red);
        }
      });
    }
    const fileInput = root.querySelector("#ruozhi-kb-file");
    const importBtn = root.querySelector("#ruozhi-kb-import");
    if (importBtn && !importBtn.dataset.bound) {
      importBtn.dataset.bound = "1";
      importBtn.addEventListener("click", () => {
        fileInput == null ? void 0 : fileInput.click();
      });
      fileInput == null ? void 0 : fileInput.addEventListener("change", async () => {
        var _a2;
        const file = (_a2 = fileInput.files) == null ? void 0 : _a2[0];
        if (!file) return;
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          if (!data.entries || !Array.isArray(data.entries)) {
            kbStatus(root, "格式无效：缺少 entries 数组", COLOR.red);
            return;
          }
          const incoming = data.entries.filter((e) => typeof e === "string" && e.trim().length > 0).map((e) => e.trim());
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
            COLOR.green
          );
        } catch {
          kbStatus(root, "文件解析失败，请检查 JSON 格式", COLOR.red);
        } finally {
          fileInput.value = "";
        }
      });
    }
    (_c = root.querySelector("#ruozhi-kb-list")) == null ? void 0 : _c.addEventListener("click", (e) => {
      const btn = e.target.closest(".ruozhi-kb-del");
      if (!btn) return;
      const idx = parseInt(btn.dataset.index ?? "-1");
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
      }
    });
  }
  function kbStatus(root, msg, color) {
    const el = root.querySelector("#ruozhi-kb-status");
    if (el) {
      el.style.opacity = "0";
      requestAnimationFrame(() => {
        el.textContent = msg;
        el.style.color = color;
        el.style.opacity = "1";
      });
    }
  }
  function updateStatsPanel() {
    const contentEl = document.querySelector("#ruozhi-stats-content");
    if (!contentEl || !currentStats) return;
    const s = currentStats;
    const tokensPerK = (s.totalTokens / 1e3).toFixed(1);
    let price = 1.1;
    try {
      const cfg = JSON.parse(GM_getValue("ruozhi-config", "{}"));
      price = cfg.pricePerMToken ?? 1.1;
    } catch {
    }
    const costEst = (s.totalTokens / 1e6 * price).toFixed(4);
    const sevLabels = {
      low: "轻微",
      medium: "违规",
      high: "严重",
      block: "拉黑"
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
    ${ls.total > 0 ? `<div style="margin-top:16px">
      <div style="font-size:11px;font-weight:600;color:${COLOR.secondary};margin-bottom:8px">AI 学习</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
        <div class="ruozhi-stat-card" style="background:${COLOR.greenBg};padding:8px;border-radius:6px;text-align:center"><div style="font-size:16px;font-weight:600;color:${COLOR.green}">${ls.unblockCount + ls.misjudgeCount}</div><div style="font-size:10px;color:${COLOR.muted}">纠正误判</div></div>
        <div class="ruozhi-stat-card" style="background:${COLOR.amberBg};padding:8px;border-radius:6px;text-align:center"><div style="font-size:16px;font-weight:600;color:${COLOR.amber}">${ls.manualCount}</div><div style="font-size:10px;color:${COLOR.muted}">补充漏判</div></div>
        <div class="ruozhi-stat-card" style="background:${COLOR.purpleBg};padding:8px;border-radius:6px;text-align:center"><div style="font-size:16px;font-weight:600;color:${COLOR.purple}">${ls.total}</div><div style="font-size:10px;color:${COLOR.muted}">总计</div></div>
      </div>
    </div>` : ""}
    <div style="margin-top:16px;font-size:10px;color:${COLOR.muted};text-align:center">DeepSeek-chat &yen;${price}/1M tokens &middot; prompt: ${(s.promptTokens / 1e3).toFixed(1)}K &middot; completion: ${(s.completionTokens / 1e3).toFixed(1)}K</div>`;
  }
  function bindBlacklistEvents(container) {
    container.querySelectorAll(".ruozhi-remove-bl").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const mid = parseInt(btn.dataset.mid ?? "0");
        if (mid) {
          await removeFromBlacklist(mid);
          _blCache = null;
          const root = container.closest("#ruozhi-panel");
          if (root) loadBlacklistChunk(root, 0);
        }
      });
    });
  }
  function buildLearningPanelHTML() {
    const records = getLearningRecords();
    const profile = getLearnedProfile();
    const pendingCount = getPendingCount();
    const profileSection = profile ? `<div style="margin:0 8px 12px 8px;padding:12px;background:${COLOR.purpleBg};border:1px solid ${COLOR.border};border-radius:6px;font-family:${FONT}">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <span style="font-size:12px;font-weight:600;color:${COLOR.purple}">AI 学习画像（可编辑）</span>
      <span style="font-size:10px;color:${COLOR.secondary}">每次 API 调用自动注入</span>
    </div>
    <textarea id="ruozhi-profile-edit" rows="4" style="width:100%;padding:8px;border:1px solid ${COLOR.border};border-radius:4px;font-size:12px;color:${COLOR.text};background:${COLOR.surface};resize:vertical;box-sizing:border-box;line-height:1.6;font-family:${FONT};outline:none;color-scheme:${COLOR === THEMES.dark ? "dark" : "light"}">${esc(profile)}</textarea>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
      <div style="display:flex;gap:6px">
        <button id="ruozhi-profile-save" style="padding:4px 12px;font-size:11px;border:none;border-radius:4px;background:${COLOR.purple};color:${COLOR.textOnAccent};cursor:pointer;font-family:${FONT}">保存画像</button>
        <button id="ruozhi-profile-regen" style="padding:4px 12px;font-size:11px;border:1px solid ${COLOR.border};border-radius:4px;background:${COLOR.bg};color:${COLOR.amber};cursor:pointer;font-family:${FONT}" title="用全部记录重新生成画像">重新生成</button>
      </div>
      ${pendingCount > 0 ? `<span style="font-size:10px;color:${COLOR.amber}">待处理: ${pendingCount} (满 20 条自动更新)</span>` : `<span style="font-size:10px;color:${COLOR.green}">已同步 (${records.length} 条)</span>`}
    </div>
  </div>` : `<div style="margin:0 8px 12px 8px;padding:12px;background:${COLOR.surface};border:1px solid ${COLOR.border};border-radius:6px;text-align:center;font-family:${FONT}">
    <div style="font-size:12px;color:${COLOR.secondary};margin-bottom:4px">尚无 AI 学习画像</div>
    ${records.length > 0 ? `<div style="font-size:11px;color:${COLOR.amber}">已收集 ${records.length} 条纠正，满 20 条后自动生成画像</div>` : `<div style="font-size:11px;color:${COLOR.muted}">执行「取消拉黑」「误判展开」「手动拉黑」后将自动学习</div>`}
  </div>`;
    if (records.length === 0) return profileSection;
    const typeLabel = {
      unblock: "取消拉黑",
      misjudge: "误判纠正",
      manual_blacklist: "补充拉黑"
    };
    const typeColor = {
      unblock: COLOR.green,
      misjudge: COLOR.blue,
      manual_blacklist: COLOR.red
    };
    const rows = records.map((r, i) => {
      const date = new Date(r.timestamp).toLocaleString("zh-CN");
      const label = typeLabel[r.type] ?? r.type;
      const color = typeColor[r.type] ?? COLOR.secondary;
      const aiReasonHTML = r.aiReason ? `<div style="font-size:11px;color:${COLOR.amber};margin-top:2px">AI 曾判定: ${esc(r.aiReason)}${r.aiSeverity ? ` (${r.aiSeverity})` : ""}</div>` : "";
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
    }).join("");
    const clearBtn = `<div style="padding:10px;text-align:center">
    <button id="ruozhi-clear-learning-inline"
      style="padding:4px 16px;font-size:11px;border:1px solid ${COLOR.border};border-radius:4px;background:${COLOR.bg};color:${COLOR.red};cursor:pointer;font-family:${FONT}">
      清空全部记录
    </button>
  </div>`;
    return profileSection + rows + clearBtn;
  }
  function bindLearningEvents(container) {
    container.querySelectorAll(".ruozhi-remove-learning").forEach((btn) => {
      btn.addEventListener("click", () => {
        const index = parseInt(btn.dataset.index ?? "-1");
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
      "#ruozhi-profile-edit"
    );
    const profileRegenBtn = container.querySelector("#ruozhi-profile-regen");
    if (profileSaveBtn && profileEdit) {
      profileSaveBtn.addEventListener("click", () => {
        const val = profileEdit.value.trim();
        if (!val) return;
        try {
          const cfg = JSON.parse(GM_getValue("ruozhi-config", "{}"));
          cfg.learnedProfile = val.slice(0, 300);
          GM_setValue("ruozhi-config", JSON.stringify(cfg));
          refreshConfig(cfg);
          profileEdit.value = val.slice(0, 300);
          showToast("画像已保存", 2e3);
        } catch {
        }
      });
    }
    if (profileRegenBtn) {
      profileRegenBtn.addEventListener("click", async () => {
        profileRegenBtn.textContent = "生成中…";
        profileRegenBtn.style.pointerEvents = "none";
        try {
          await forceRefineProfile();
          refreshLearningPanel(container);
        } catch {
        } finally {
          profileRegenBtn.textContent = "重新生成";
          profileRegenBtn.style.pointerEvents = "";
        }
      });
    }
  }
  function refreshLearningPanel(container) {
    const contentEl = container.querySelector("#ruozhi-learning-content") ?? container;
    contentEl.innerHTML = buildLearningPanelHTML();
    bindLearningEvents(contentEl);
  }
  const TAG$2 = "[ruozhi-filter]";
  function foldEl(el, info, verdict, style = "classic") {
    var _a, _b, _c, _d, _e, _f;
    try {
      if (el.style.display === "none") return false;
      const labelMap = {
        low: "轻微不适",
        medium: "违规言论",
        high: "严重违规",
        block: "永久拉黑"
      };
      const label = labelMap[verdict.severity] ?? "已过滤";
      const severityAccent = {
        low: COLOR.muted,
        medium: COLOR.amber,
        high: COLOR.red,
        block: COLOR.purple
      };
      const accent = severityAccent[verdict.severity] ?? COLOR.secondary;
      const showReportBtn = verdict.severity === "medium" || verdict.severity === "high" || verdict.severity === "block";
      const reportBtnsHTML = showReportBtn ? `<div style="margin-top:8px;display:flex;gap:8px">
  <button class="ruozhi-copy-reason" style="padding:3px 10px;font-size:11px;border:1px solid ${COLOR.border};border-radius:4px;background:${COLOR.bg};color:${COLOR.secondary};cursor:pointer;font-family:${FONT}">复制理由</button>
  <button class="ruozhi-report-btn" style="padding:3px 10px;font-size:11px;border:1px solid ${COLOR.red};border-radius:4px;background:${COLOR.bg};color:${COLOR.red};cursor:pointer;font-family:${FONT}">举报</button>
</div>` : "";
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
          default:
            return `<div class="ruozhi-folded" style="height:15px;background:${COLOR.surface};border-left:4px solid ${accent};margin:1px 0;cursor:pointer;user-select:none;border-radius:0 2px 2px 0;transition:opacity .15s"
  onmouseenter="this.style.opacity='0.6'" onmouseleave="this.style.opacity='1'"
></div><div class="ruozhi-original" style="display:none;padding:6px 8px;background:${COLOR.surface};border-left:3px solid ${COLOR.border};margin:0 0 4px 0;font-size:12px;color:${COLOR.secondary};font-family:${FONT}">
<div style="color:${COLOR.secondary};white-space:pre-wrap;word-break:break-word">${esc(info.message)}</div>${reportBtnsHTML}</div>`;
        }
      })();
      const wrapper = document.createElement("div");
      wrapper.innerHTML = html;
      const foldElDiv = wrapper.firstElementChild;
      const origElDiv = foldElDiv.nextElementSibling;
      (_a = el.parentNode) == null ? void 0 : _a.insertBefore(foldElDiv, el);
      (_b = el.parentNode) == null ? void 0 : _b.insertBefore(origElDiv, el);
      el.style.display = "none";
      if (style === "clean") {
        const btns = el.__ruozhiBtns;
        if (btns) {
          for (const btn of btns) btn.style.display = "none";
        }
      }
      foldElDiv.addEventListener("click", () => {
        const collapsed = origElDiv.style.display === "none";
        origElDiv.style.display = collapsed ? "block" : "none";
        const arrow = foldElDiv.querySelector(
          ".ruozhi-fold-arrow"
        );
        if (arrow) {
          arrow.textContent = collapsed ? arrow.dataset.expanded ?? arrow.textContent : arrow.dataset.collapsed ?? arrow.textContent;
        }
      });
      const blRecord = isBlacklistedSync(info.mid, info.uname);
      if (blRecord) {
        origElDiv.insertAdjacentHTML(
          "beforeend",
          `<div style="margin-top:8px;display:flex;gap:8px">
  <button class="ruozhi-unblock-btn" style="padding:3px 10px;font-size:11px;border:1px solid ${COLOR.green};border-radius:4px;background:${COLOR.bg};color:${COLOR.green};cursor:pointer;font-family:${FONT}">取消拉黑</button>
</div>`
        );
        (_c = origElDiv.querySelector(".ruozhi-unblock-btn")) == null ? void 0 : _c.addEventListener("click", async (e) => {
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
              videoTitle: currentContext.videoTitle
            });
            el.style.display = "";
            foldElDiv.remove();
            origElDiv.remove();
          } catch (err) {
            console.error(TAG$2, "Unblock failed:", err);
          }
        });
      } else {
        origElDiv.insertAdjacentHTML(
          "beforeend",
          `<div style="margin-top:8px;display:flex;gap:8px">
  <button class="ruozhi-misjudge-btn" style="padding:3px 10px;font-size:11px;border:1px solid ${COLOR.border};border-radius:4px;background:${COLOR.bg};color:${COLOR.secondary};cursor:pointer;font-family:${FONT}">误判 · 展开</button>
</div>`
        );
        (_d = origElDiv.querySelector(".ruozhi-misjudge-btn")) == null ? void 0 : _d.addEventListener("click", async (e) => {
          e.stopPropagation();
          const hash = commentHash(info.message, info.mid);
          await deleteCommentFromCache(hash);
          recordLearning({
            type: "misjudge",
            message: info.message,
            aiReason: verdict.reason,
            aiSeverity: verdict.severity,
            uname: info.uname,
            videoTitle: currentContext.videoTitle
          });
          el.style.display = "";
          foldElDiv.remove();
          origElDiv.remove();
        });
      }
      if (showReportBtn) {
        (_e = origElDiv.querySelector(".ruozhi-copy-reason")) == null ? void 0 : _e.addEventListener("click", (e) => {
          e.stopPropagation();
          copyReason(verdict.reason);
        });
        (_f = origElDiv.querySelector(".ruozhi-report-btn")) == null ? void 0 : _f.addEventListener("click", (e) => {
          e.stopPropagation();
          triggerReport(el, verdict.reason);
        });
      }
      return true;
    } catch {
      return false;
    }
  }
  function hideEl(el) {
    try {
      el.style.display = "none";
      const btns = el.__ruozhiBtns;
      if (btns) {
        for (const btn of btns) btn.style.display = "none";
      }
      return true;
    } catch {
      return false;
    }
  }
  const blacklistButtonInjected = /* @__PURE__ */ new WeakSet();
  function blBtnStyle() {
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
      transition: "color 0.15s, border-color 0.15s, background 0.15s"
    };
  }
  function rptBtnStyle() {
    return { ...blBtnStyle(), color: COLOR.red, borderColor: COLOR.redBg };
  }
  function rptBtnHover() {
    return { color: "#fff", borderColor: COLOR.red, background: COLOR.red };
  }
  function rptBtnDone() {
    return {
      color: COLOR.green,
      borderColor: COLOR.greenBg,
      background: COLOR.greenBg
    };
  }
  function blBtnHover() {
    return {
      color: COLOR.red,
      borderColor: COLOR.red,
      background: COLOR.redBg
    };
  }
  function blBtnDone() {
    return {
      color: COLOR.red,
      borderColor: COLOR.redBg,
      background: COLOR.redBg,
      boxShadow: "none",
      cursor: "default",
      pointerEvents: "none"
    };
  }
  function applyStyles(el, styles) {
    Object.assign(el.style, styles);
  }
  function injectManualBlacklistButton(el, info) {
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
      if (config.blacklistConfirm !== false && !confirm(
        `确定要将用户 "${info.uname}" 加入黑名单吗？
该用户的所有评论将被隐藏。`
      )) {
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
          source: "manual"
        });
        recordLearning({
          type: "manual_blacklist",
          message: info.message,
          uname: info.uname,
          videoTitle: currentContext.videoTitle
        });
        log(TAG$2, `Manual block: ${info.uname}`);
        if (config.foldMode === "none") {
          hideEl(el);
        } else {
          foldEl(
            el,
            info,
            { reason: "[手动拉黑]", severity: "block" },
            config.foldMode
          );
        }
        btn.dataset.done = "1";
        btn.textContent = "已拉黑";
        applyStyles(btn, blBtnDone());
      } catch (err) {
        console.error(TAG$2, "Manual block failed:", err);
      }
    });
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
        console.error(TAG$2, "Quick report failed:", err);
      }
    });
    el.__ruozhiBtns = [btn, rptBtn];
  }
  const TAG$1 = "[ruozhi-filter/rcmd]";
  const seenUrls = /* @__PURE__ */ new Set();
  function normalizeRcmdUrl(url) {
    const q = url.indexOf("?");
    const f = url.indexOf("#");
    let end = url.length;
    if (q >= 0) end = Math.min(end, q);
    if (f >= 0) end = Math.min(end, f);
    return url.slice(0, end);
  }
  function rcmdHash(url) {
    const normalized = normalizeRcmdUrl(url);
    let h = 5381;
    for (let i = 0; i < normalized.length; i++) {
      h = (h << 5) + h + normalized.charCodeAt(i) & 2147483647;
    }
    return "rcmd:" + h.toString(16);
  }
  function extractCard(el) {
    var _a;
    const link = el.querySelector("a.video-awesome-img");
    const titleEl = el.querySelector("p.title");
    const upnameEl = el.querySelector(".upname span.name");
    if (!link || !titleEl) return null;
    const url = link.getAttribute("href") || "";
    const title = (titleEl.getAttribute("title") || titleEl.textContent || "").trim();
    const upname = ((_a = upnameEl == null ? void 0 : upnameEl.textContent) == null ? void 0 : _a.trim()) || "";
    if (!title || !url) return null;
    return { el, title, upname, url };
  }
  function buildSystemPrompt(config) {
    const title = document.title.replace(/[ _-]哔哩哔哩.*$/, "").trim() || "当前视频";
    const prompt = config.rcmdPrompt || config.prompt;
    return `你是内容过滤助手。用户正在B站观看「${title}」，右侧是算法推荐视频列表。

请根据以下规则，判断哪些推荐视频的标题需要过滤：

${prompt}

仅输出 JSON（无 markdown 标记）：
{"verdicts":[{"i":索引,"violation":true}]}
只输出违规标题对应的索引。无违规返回 {"verdicts":[]}`;
  }
  function buildUserMessage(cards) {
    return JSON.stringify(
      cards.map((c, i) => ({
        i,
        t: c.title.slice(0, 200),
        u: c.upname.slice(0, 50)
      }))
    );
  }
  async function judgeCards(cards, config) {
    var _a, _b, _c;
    const systemPrompt = buildSystemPrompt(config);
    const userMessage = buildUserMessage(cards);
    log(TAG$1, `判定 ${cards.length} 个推荐视频标题`);
    const fetcher = typeof unsafeWindow !== "undefined" ? unsafeWindow.fetch : window.fetch;
    const hdrs = {
      "Content-Type": "application/json"
    };
    if (config.apiKey) {
      hdrs.Authorization = `Bearer ${config.apiKey}`;
    }
    const preset = PROVIDER_PRESETS[config.provider] ?? PROVIDER_PRESETS.custom;
    const body = {
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ],
      temperature: 0,
      max_tokens: 4096
    };
    if (preset.supportsJsonFormat) {
      body.response_format = { type: "json_object" };
    }
    log(TAG$1, "请求体:", JSON.stringify(body));
    try {
      const resp = await fetcher(config.apiEndpoint, {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify(body)
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        warn(TAG$1, `API 返回 ${resp.status}: ${errText.slice(0, 300)}`);
        return { violations: [] };
      }
      const rawText = await resp.text().catch(() => "");
      if (!rawText) {
        warn(TAG$1, "API 返回空响应体");
        return { violations: [] };
      }
      let data;
      try {
        data = JSON.parse(rawText);
      } catch {
        warn(TAG$1, `API 返回非 JSON，原始响应(前500): ${rawText.slice(0, 500)}`);
        return { violations: [] };
      }
      const content = (_c = (_b = (_a = data.choices) == null ? void 0 : _a[0]) == null ? void 0 : _b.message) == null ? void 0 : _c.content;
      if (!content) {
        warn(
          TAG$1,
          "API 返回无 content，完整响应:",
          JSON.stringify(data).slice(0, 500)
        );
        return { violations: [] };
      }
      let jsonStr = content.trim();
      if (jsonStr.startsWith("```json")) jsonStr = jsonStr.slice(7);
      if (jsonStr.startsWith("```")) jsonStr = jsonStr.slice(3);
      if (jsonStr.endsWith("```")) jsonStr = jsonStr.slice(0, -3);
      jsonStr = jsonStr.trim();
      const parsed = JSON.parse(jsonStr);
      const violations = (parsed.verdicts ?? []).filter((v) => v.violation).map((v) => v.i);
      log(
        TAG$1,
        `${violations.length}/${cards.length} 个推荐视频违规: ${violations.map((i) => {
        var _a2;
        return (_a2 = cards[i]) == null ? void 0 : _a2.title;
      }).join(" | ")}`
      );
      return {
        violations,
        usage: data.usage ?? void 0
      };
    } catch (err) {
      warn(TAG$1, "API 调用异常:", err);
      return { violations: [] };
    }
  }
  let pendingCards = [];
  let rcmdTimer = null;
  let maxCollectTimer = null;
  let isJudging = false;
  let rcmdPhase = "collecting";
  function getRcmdContainer() {
    return document.querySelector(".recommend-list-v1");
  }
  function blurRcmd() {
    const container = getRcmdContainer();
    if (container) {
      container.style.filter = "blur(12px)";
      container.style.transition = "filter 0.3s ease";
      log(TAG$1, "推荐区已模糊");
    }
  }
  function unblurRcmd() {
    const container = getRcmdContainer();
    if (container) {
      container.style.filter = "";
      log(TAG$1, "推荐区已恢复");
    }
  }
  function clearFlushTimers() {
    if (rcmdTimer) {
      clearTimeout(rcmdTimer);
      rcmdTimer = null;
    }
    if (maxCollectTimer) {
      clearTimeout(maxCollectTimer);
      maxCollectTimer = null;
    }
  }
  async function flushRcmd() {
    clearFlushTimers();
    if (isJudging || rcmdPhase !== "collecting") return;
    if (pendingCards.length === 0) {
      rcmdPhase = "done";
      log(TAG$1, "全部推荐视频已命中缓存，无需 API 调用");
      return;
    }
    blurRcmd();
    rcmdPhase = "judging";
    isJudging = true;
    const batch = pendingCards.splice(0);
    const config = getConfig();
    if (batch.length === 0) {
      isJudging = false;
      rcmdPhase = "done";
      unblurRcmd();
      return;
    }
    log(
      TAG$1,
      `发送 ${batch.length} 个推荐视频到 AI 判定（本页唯一一次 API 调用）`
    );
    if (!config.enableAI || !config.apiKey) {
      warn(
        TAG$1,
        `${batch.length} 个推荐视频未判定: enableAI=${config.enableAI}, hasApiKey=${!!config.apiKey}`
      );
      isJudging = false;
      rcmdPhase = "done";
      unblurRcmd();
      return;
    }
    const result = await judgeCards(batch, config);
    ruozhiStats.apiCalls++;
    ruozhiStats.totalScanned += batch.length;
    if (result.usage) {
      ruozhiStats.totalTokens += result.usage.total_tokens;
      ruozhiStats.promptTokens += result.usage.prompt_tokens;
      ruozhiStats.completionTokens += result.usage.completion_tokens;
    }
    saveStats(ruozhiStats);
    notifyStatsUpdate();
    const violationSet = new Set(result.violations);
    for (let i = 0; i < batch.length; i++) {
      const card = batch[i];
      const isViolation = violationSet.has(i);
      const entry = {
        hash: rcmdHash(card.url),
        violation: isViolation,
        reason: isViolation ? "AI 判定违规" : "AI 判定通过",
        severity: isViolation ? "low" : "none",
        timestamp: Date.now()
      };
      setCache(entry).catch(() => {
      });
      if (isViolation) {
        ruozhiStats.totalFiltered++;
        ruozhiStats.severityCounts["low"] = (ruozhiStats.severityCounts["low"] ?? 0) + 1;
        card.el.style.display = "none";
      }
    }
    saveStats(ruozhiStats);
    notifyStatsUpdate();
    isJudging = false;
    rcmdPhase = "done";
    unblurRcmd();
  }
  function scheduleFlush() {
    if (!rcmdTimer) {
      rcmdTimer = setTimeout(flushRcmd, 2e3);
    }
    if (!maxCollectTimer) {
      maxCollectTimer = setTimeout(() => {
        log(TAG$1, "最大收集时间到，强制发送");
        flushRcmd();
      }, 5e3);
    }
  }
  async function doScan() {
    const newCards = scanCards();
    if (newCards.length === 0) return;
    let cachedHidden = 0;
    let cachedPass = 0;
    for (const card of newCards) {
      const hash = rcmdHash(card.url);
      try {
        const cached = await getCache(hash);
        if (cached) {
          if (cached.violation) {
            card.el.style.display = "none";
            ruozhiStats.totalFiltered++;
            ruozhiStats.severityCounts["low"] = (ruozhiStats.severityCounts["low"] ?? 0) + 1;
            cachedHidden++;
          } else {
            cachedPass++;
          }
          continue;
        }
      } catch {
      }
      if (rcmdPhase === "collecting") {
        pendingCards.push(card);
      }
    }
    if (cachedHidden > 0) {
      saveStats(ruozhiStats);
      notifyStatsUpdate();
    }
    log(
      TAG$1,
      `扫描到 ${newCards.length} 个推荐视频，缓存违规=${cachedHidden}，缓存放行=${cachedPass}，排队=${pendingCards.length}，阶段=${rcmdPhase}`
    );
    if (rcmdPhase === "collecting" && pendingCards.length > 0) {
      scheduleFlush();
    }
  }
  function scanCards() {
    const list = document.querySelector(".recommend-list-v1");
    if (!list) return [];
    const cards = list.querySelectorAll(".video-page-card-small");
    const result = [];
    for (const card of cards) {
      if (card.style.display === "none") continue;
      const info = extractCard(card);
      if (!info) continue;
      if (seenUrls.has(info.url)) continue;
      seenUrls.add(info.url);
      result.push(info);
    }
    return result;
  }
  let rcmdObserver = null;
  let pollTimer = null;
  function tryBindObserver() {
    if (rcmdObserver) return;
    const rcmdTab = document.querySelector(".rcmd-tab");
    if (!rcmdTab) return;
    rcmdObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node instanceof HTMLElement) {
            if (node.classList.contains("video-page-card-small") || node.querySelector(".video-page-card-small")) {
              doScan();
              return;
            }
          }
        }
      }
    });
    rcmdObserver.observe(rcmdTab, { childList: true, subtree: true });
    log(TAG$1, "Observer attached");
  }
  function startRcmdFilter() {
    const config = getConfig();
    if (!config.enableRcmdFilter) return;
    log(TAG$1, "started");
    rcmdPhase = "collecting";
    doScan();
    tryBindObserver();
    pollTimer = setInterval(() => {
      tryBindObserver();
      doScan();
    }, 2e3);
  }
  function stopRcmdFilter() {
    if (rcmdObserver) {
      rcmdObserver.disconnect();
      rcmdObserver = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    clearFlushTimers();
    pendingCards = [];
    seenUrls.clear();
    rcmdPhase = "collecting";
    unblurRcmd();
  }
  const TAG = "[ruozhi-filter]";
  async function main() {
    log(TAG, "Plugin starting...");
    setRefineCallback(refineProfileNow);
    initMemoryCache().catch(() => {
    });
    let config = loadConfig();
    if (!config.apiKey) {
      config = { ...DEFAULT_CONFIG };
    }
    extractVideoInfo();
    startDOMScanner();
    if (config.enableRcmdFilter) startRcmdFilter();
    const titleEl = document.querySelector("title");
    if (titleEl) {
      new MutationObserver(() => {
        updateContext({
          videoTitle: document.title.replace(/[ _-]哔哩哔哩.*$/, "")
        });
      }).observe(titleEl, {
        childList: true,
        characterData: true,
        subtree: true
      });
    }
    injectUI(config, (newConfig) => {
      const wasEnabled = config.enableRcmdFilter;
      config = newConfig;
      refreshConfig(config);
      if (newConfig.enableRcmdFilter && !wasEnabled) {
        startRcmdFilter();
      } else if (!newConfig.enableRcmdFilter && wasEnabled) {
        stopRcmdFilter();
      }
    });
    setUpdateStats((s) => {
      setStatsRef(s);
    });
    setInterval(
      () => {
        pruneCache().catch(() => {
        });
      },
      60 * 60 * 1e3
    );
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", main);
  else main();

})();