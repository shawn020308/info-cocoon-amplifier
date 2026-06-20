// ==UserScript==
// @name         信息茧房放大器 - B站降智评论过滤器
// @namespace    ruozhi-filter
// @version      0.2.2
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

  const DEFAULT_CONFIG = {
    apiKey: "",
    apiEndpoint: "https://api.deepseek.com/chat/completions",
    model: "deepseek-chat",
    prompt: "请帮我识别以下评论中，具有明显性别对立、引战、人身攻击、煽动性、仇恨言论的内容。",
    foldMode: "classic",
    enableAI: true,
    enableBlacklist: true,
    blacklistConfirm: true,
    blacklistStrictness: 1,
    pricePerMToken: 1.1,
    sendUname: false,
    sendMid: false,
    sendVideoDesc: false,
    filterDimensions: `- **性别对立**：将某一性别标签化、污名化，煽动敌视/仇恨（如"女人都拜金""男人都好色"）
- **人身攻击**：针对个人的侮辱、谩骂、诅咒
- **引战/煽动**：故意挑起争端，使用极端化言论
- **降智煽动**：以偏概全、简化认知、传播刻板印象的明显反智言论
- **仇恨言论**：涉及种族、地域、性别、性取向等的歧视性言论`
  };
  const TAG$6 = "[ruozhi-filter]";
  function buildSystemPrompt(config, ctx) {
    let ctxBlock = `视频标题：${ctx.videoTitle}`;
    if (config.sendVideoDesc) {
      ctxBlock += `
视频简介：${ctx.videoDesc.slice(0, 300)}`;
    }
    return `你是一个评论净化判官。你的任务是严格根据用户的过滤规则，判断每条评论是否违规。

## 判定标准
用户过滤规则：${config.prompt}

违规判定维度：
${config.filterDimensions}

## 上下文
${ctxBlock}

## 输出要求
返回一个JSON对象，格式如下（不要包含任何markdown标记，只输出纯JSON）：
{
  "verdicts": [
    { "rpid": 123, "mid": 456, "violation": true, "reason": "煽动性别对立", "severity": "high" }
  ]
}

- severity 可选值: "none", "low", "medium", "high", "block"
- 只返回违规的评论（violation=true），没有违规则返回空数组`;
  }
  function buildUserMessage(config, replies) {
    const comments = replies.map((r) => {
      const item = {
        rpid: r.rpid,
        content: r.content.message
      };
      if (config.sendMid) item.mid = r.mid;
      if (config.sendUname) item.uname = r.member.uname;
      return item;
    });
    return JSON.stringify(comments);
  }
  async function batchJudge(config, replies, ctx) {
    var _a, _b, _c;
    if (!config.apiKey || replies.length === 0) return { verdicts: [] };
    const systemPrompt = buildSystemPrompt(config, ctx);
    const userMessage = buildUserMessage(config, replies);
    console.log(
      TAG$6,
      "📤 请求体:",
      JSON.stringify({
        model: config.model,
        systemPrompt,
        userMessage: JSON.parse(userMessage),
        temperature: 0.1,
        max_tokens: 4096,
        response_format: { type: "json_object" }
      })
    );
    const fetchStart = Date.now();
    const fetcher = typeof unsafeWindow !== "undefined" ? unsafeWindow.fetch : window.fetch;
    try {
      const response = await fetcher(config.apiEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage }
          ],
          temperature: 0.1,
          max_tokens: 4096,
          response_format: { type: "json_object" }
        })
      });
      console.log(
        TAG$6,
        `📡 API HTTP ${response.status}, ${Date.now() - fetchStart}ms`
      );
      if (!response.ok) {
        const errText = await response.text();
        console.error(TAG$6, `❌ API ${response.status}:`, errText.slice(0, 200));
        throw new Error(`DeepSeek API error ${response.status}`);
      }
      const data = await response.json();
      const content = (_c = (_b = (_a = data.choices) == null ? void 0 : _a[0]) == null ? void 0 : _b.message) == null ? void 0 : _c.content;
      const usage = data.usage;
      if (!content) {
        console.warn(TAG$6, "⚠️ AI 返回空内容");
        return { verdicts: [], usage };
      }
      try {
        let jsonStr = content.trim();
        if (jsonStr.startsWith("```json")) jsonStr = jsonStr.slice(7);
        if (jsonStr.startsWith("```")) jsonStr = jsonStr.slice(3);
        if (jsonStr.endsWith("```")) jsonStr = jsonStr.slice(0, -3);
        jsonStr = jsonStr.trim();
        const parsed = JSON.parse(jsonStr);
        return { verdicts: parsed.verdicts ?? [], usage };
      } catch (e) {
        console.error(TAG$6, "❌ AI 返回解析失败:", e);
        return { verdicts: [], usage };
      }
    } catch (err) {
      console.error(TAG$6, "❌ 网络请求失败:", err);
      throw err;
    }
  }
  async function testAPIConnection(config) {
    try {
      const fetcher = typeof unsafeWindow !== "undefined" ? unsafeWindow.fetch : window.fetch;
      const response = await fetcher(config.apiEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 5
        })
      });
      return response.ok;
    } catch {
      return false;
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
      console.log(
        "[ruozhi-filter]",
        `📋 内存缓存就绪: 黑名单=${blByMid.size}条, 缓存=${cacheByHash.size}条`
      );
    } catch (err) {
      console.error("[ruozhi-filter]", "❌ 内存缓存初始化失败:", err);
    }
  }
  function escapeHtml$1(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }
  async function buildBlacklistPanelHTML() {
    const records = await getAllBlacklist();
    if (records.length === 0) {
      return `<div style="padding:16px;text-align:center;color:#999">暂无黑名单记录，一片祥和 🎉</div>`;
    }
    const rows = records.sort((a, b) => b.timestamp - a.timestamp).map((r) => {
      const date = new Date(r.timestamp).toLocaleString("zh-CN");
      const mid = r.mid;
      const sourceBadge = r.source === "manual" ? '<span style="background:#d9534f;color:#fff;font-size:10px;padding:1px 5px;border-radius:3px;margin-left:4px">手动</span>' : '<span style="background:#667eea;color:#fff;font-size:10px;padding:1px 5px;border-radius:3px;margin-left:4px">AI</span>';
      return `
      <div style="padding:10px 12px;border-bottom:1px solid #eee;font-size:13px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span><strong>${escapeHtml$1(r.uname)}</strong>${sourceBadge}</span>
          <span style="font-size:12px;color:#999">${date}</span>
        </div>
        <div style="color:#666;margin:4px 0">💬 ${escapeHtml$1(r.message.slice(0, 100))}${r.message.length > 100 ? "..." : ""}</div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="color:#d9534f">📋 ${escapeHtml$1(r.reason)}</span>
          <button class="ruozhi-remove-bl" data-mid="${mid}"
            style="padding:2px 8px;font-size:12px;background:#fff;border:1px solid #ddd;border-radius:4px;cursor:pointer">
            移除
          </button>
        </div>
        <div style="font-size:11px;color:#bbb;margin-top:2px">📺 ${escapeHtml$1(r.videoTitle)}</div>
      </div>`;
    }).join("");
    return rows;
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
        _config = parsed;
        return parsed;
      }
    } catch {
    }
    return {
      apiKey: "",
      apiEndpoint: "https://api.deepseek.com/chat/completions",
      model: "deepseek-chat",
      prompt: "",
      foldMode: "classic",
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
- **仇恨言论**：涉及种族、地域、性别、性取向等的歧视性言论`
    };
  }
  function refreshConfig(cfg) {
    _config = cfg;
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
  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
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
    "记笔记"
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
      if (!message || message.length < 2) return null;
      return { el, rpid, mid, uname, message };
    } catch (e) {
      console.warn("[ruozhi-filter]", "  ❌ extractComment 异常:", e);
      return null;
    }
  }
  const TAG$5 = "[ruozhi-filter]";
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
  function findElementByText(root, text) {
    const walk = (node) => {
      var _a, _b;
      for (const child of node.children) {
        const el = child;
        if (((_a = el.innerText) == null ? void 0 : _a.trim()) === text || ((_b = el.textContent) == null ? void 0 : _b.trim()) === text) {
          return el;
        }
        if (el.shadowRoot) {
          const found = walk(el.shadowRoot);
          if (found) return found;
        }
        if (el.children.length > 0) {
          const found = walk(el);
          if (found) return found;
        }
      }
      return null;
    };
    return walk(
      root instanceof Element ? root.shadowRoot ?? root : root
    );
  }
  function showToast(msg, duration = 2500) {
    const toast = document.createElement("div");
    toast.textContent = msg;
    Object.assign(toast.style, {
      position: "fixed",
      bottom: "60px",
      left: "50%",
      transform: "translateX(-50%)",
      background: "rgba(0,0,0,0.82)",
      color: "#fff",
      padding: "10px 20px",
      borderRadius: "8px",
      fontSize: "14px",
      zIndex: "999999",
      fontFamily: "system-ui, sans-serif",
      pointerEvents: "none",
      transition: "opacity 0.3s"
    });
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
  function waitFor(checker, timeoutMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        if (checker()) return resolve(true);
        if (Date.now() - start > timeoutMs) return resolve(false);
        requestAnimationFrame(check);
      };
      check();
    });
  }
  async function triggerReport(commentEl, reason) {
    const reasonCopied = await copyToClipboard(reason);
    if (reasonCopied) {
      showToast("✅ 已复制 AI 判定理由，请粘贴到举报框 (Cmd+V)");
    }
    const el = commentEl;
    const prevDisplay = el.style.display;
    el.style.display = "";
    try {
      const sr = el.shadowRoot;
      if (!sr) {
        console.warn(TAG$5, "⚠️ 评论元素无 shadowRoot，无法触发举报");
        return { opened: false, reasonCopied };
      }
      const actionButtons = sr.querySelector(
        "bili-comment-action-buttons-renderer"
      );
      if (!actionButtons || !actionButtons.shadowRoot) {
        console.warn(TAG$5, "⚠️ 未找到 action-buttons");
        return { opened: false, reasonCopied };
      }
      const actionSR = actionButtons.shadowRoot;
      const moreBtn = actionSR.querySelector(
        "#more button"
      );
      if (!moreBtn) {
        console.warn(TAG$5, "⚠️ 未找到「更多」按钮");
        return { opened: false, reasonCopied };
      }
      moreBtn.click();
      const menuVisible = await waitFor(() => {
        const m = actionSR.querySelector(
          "bili-comment-menu"
        );
        if (!m || !m.shadowRoot) return false;
        const style = getComputedStyle(m);
        return style.display !== "none" && style.visibility !== "hidden";
      }, 2e3);
      if (!menuVisible) {
        console.warn(TAG$5, "⚠️ 菜单未显示");
        return { opened: false, reasonCopied };
      }
      const menuEl = actionSR.querySelector("bili-comment-menu");
      const menuSR = menuEl.shadowRoot;
      const reportLi = findElementByText(menuSR, "举报");
      if (!reportLi) {
        console.warn(TAG$5, "⚠️ 菜单中未找到「举报」");
        return { opened: false, reasonCopied };
      }
      reportLi.click();
      waitAndFillReportForm(reason);
      console.log(TAG$5, "✅ 已触发原生举报弹窗");
      return { opened: true, reasonCopied };
    } finally {
      el.style.display = prevDisplay;
    }
  }
  function waitAndFillReportForm(reason) {
    const start = Date.now();
    const MAX_WAIT = 3e3;
    const tryFill = () => {
      const textareas = document.querySelectorAll(
        "textarea[placeholder*='举报'], textarea[maxlength='200']"
      );
      for (const ta of textareas) {
        if (ta.value.trim() === "") {
          ta.value = reason.slice(0, 200);
          ta.dispatchEvent(new Event("input", { bubbles: true }));
          ta.dispatchEvent(new Event("change", { bubbles: true }));
          console.log(TAG$5, "✅ 已自动填写举报理由");
          return;
        }
      }
      if (Date.now() - start < MAX_WAIT) {
        setTimeout(tryFill, 300);
      }
    };
    setTimeout(tryFill, 400);
  }
  async function copyReason(reason) {
    const ok = await copyToClipboard(reason);
    if (ok) showToast("✅ 已复制 AI 判定理由，请粘贴到举报框 (Cmd+V)");
    return ok;
  }
  function foldEl(el, info, verdict, style = "classic") {
    var _a, _b;
    try {
      const labelMap = {
        low: "⚠️ 轻微不适",
        medium: "🚫 违规言论",
        high: "⛔ 严重违规",
        block: "🛑 永久拉黑"
      };
      const label = labelMap[verdict.severity] ?? "🚫 已过滤";
      const severityAccent = {
        low: "#c8c8c8",
        medium: "#d4a574",
        high: "#d47574",
        block: "#b87070"
      };
      const accent = severityAccent[verdict.severity] ?? "#ccc";
      const showReportBtn = verdict.severity === "high" || verdict.severity === "block";
      const reportBtnsHTML = showReportBtn ? `<div style="margin-top:8px;display:flex;gap:8px">
  <button class="ruozhi-copy-reason" style="padding:3px 10px;font-size:12px;border:1px solid #d4a574;border-radius:4px;background:#fff;color:#d4a574;cursor:pointer">📋 复制理由</button>
  <button class="ruozhi-report-btn" style="padding:3px 10px;font-size:12px;border:1px solid #d47574;border-radius:4px;background:#fff;color:#d47574;cursor:pointer">🚨 举报此评论</button>
</div>` : "";
      const html = style === "classic" ? `<div class="ruozhi-folded" style="background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:8px 12px;margin:4px 0;font-size:13px;color:#856404;cursor:pointer;user-select:none;font-family:system-ui,sans-serif">
<span style="margin-right:8px">${label}</span><span style="font-weight:600">${esc(info.uname)}</span><span style="margin:0 8px;color:#ccc">|</span><span style="font-size:12px;color:#aaa">${esc(verdict.reason)}</span><span style="float:right;font-size:11px;color:#999">▼ 展开</span>
</div><div class="ruozhi-original" style="display:none;padding:8px 12px;background:#f8f9fa;border-left:3px solid #ffc107;margin:4px 0;border-radius:0 6px 6px 0;font-size:13px">
<div style="margin-bottom:6px;font-size:12px;color:#999">🧠 AI判定: <strong>${esc(verdict.reason)}</strong></div>
<div style="color:#333;white-space:pre-wrap;word-break:break-word">${esc(info.message)}</div>${reportBtnsHTML}</div>` : `<div class="ruozhi-folded" style="background:#fafafa;border-left:3px solid ${accent};padding:6px 12px;margin:4px 0;font-size:12px;color:#aaa;cursor:pointer;user-select:none;font-family:system-ui,sans-serif">
<span style="margin-right:6px">${label}</span><span style="color:#999">${esc(info.uname)}</span><span style="float:right;font-size:10px;color:#ccc">▾</span>
</div><div class="ruozhi-original" style="display:none;padding:6px 12px;background:#fafafa;border-left:3px solid #ddd;margin:0 0 4px 0;font-size:12px;color:#999">
<div style="margin-bottom:4px;font-size:11px;color:#bbb">AI判定: ${esc(verdict.reason)}</div>
<div style="color:#bbb;white-space:pre-wrap;word-break:break-word">${esc(info.message)}</div>${reportBtnsHTML}</div>`;
      const wrapper = document.createElement("div");
      wrapper.innerHTML = html;
      const foldElDiv = wrapper.firstElementChild;
      const origElDiv = foldElDiv.nextElementSibling;
      (_a = el.parentNode) == null ? void 0 : _a.insertBefore(foldElDiv, el);
      (_b = el.parentNode) == null ? void 0 : _b.insertBefore(origElDiv, el);
      el.style.display = "none";
      foldElDiv.addEventListener("click", () => {
        const hidden = origElDiv.style.display === "none";
        origElDiv.style.display = hidden ? "block" : "none";
        const arrow = foldElDiv.querySelector("span:last-child");
        if (arrow) arrow.textContent = hidden ? "▴" : "▾";
      });
      if (showReportBtn) {
        const copyBtn = origElDiv.querySelector(".ruozhi-copy-reason");
        const reportBtn = origElDiv.querySelector(".ruozhi-report-btn");
        copyBtn == null ? void 0 : copyBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          copyReason(verdict.reason);
        });
        reportBtn == null ? void 0 : reportBtn.addEventListener("click", (e) => {
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
      return true;
    } catch {
      return false;
    }
  }
  const TAG$4 = "[ruozhi-filter]";
  const blacklistButtonInjected = /* @__PURE__ */ new WeakSet();
  const BL_BTN_STYLE = {
    position: "relative",
    zIndex: "1",
    float: "right",
    marginTop: "4px",
    marginRight: "4px",
    padding: "1px 8px",
    fontSize: "11px",
    color: "#aaa",
    background: "rgba(255,255,255,0.88)",
    border: "1px solid #e0e0e0",
    borderRadius: "10px",
    cursor: "pointer",
    userSelect: "none",
    fontFamily: "system-ui, -apple-system, sans-serif",
    lineHeight: "18px",
    whiteSpace: "nowrap",
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    transition: "color 0.15s, border-color 0.15s, background 0.15s, box-shadow 0.15s"
  };
  const BL_BTN_HOVER = {
    color: "#d9534f",
    borderColor: "#d9534f",
    background: "#fff5f5"
  };
  const BL_BTN_DONE = {
    color: "#d9534f",
    borderColor: "#f5c6cb",
    background: "#fff0f0",
    boxShadow: "none",
    cursor: "default",
    pointerEvents: "none"
  };
  function applyStyles(el, styles) {
    Object.assign(el.style, styles);
  }
  function injectManualBlacklistButton(el, info) {
    if (blacklistButtonInjected.has(el)) return;
    blacklistButtonInjected.add(el);
    const parent = el.parentNode;
    if (!parent) return;
    const btn = document.createElement("span");
    btn.textContent = "🚫 拉黑";
    btn.title = `将 ${info.uname} 加入黑名单`;
    applyStyles(btn, BL_BTN_STYLE);
    parent.insertBefore(btn, el);
    btn.addEventListener("mouseenter", () => {
      if (btn.dataset.done !== "1") applyStyles(btn, BL_BTN_HOVER);
    });
    btn.addEventListener("mouseleave", () => {
      if (btn.dataset.done !== "1") applyStyles(btn, BL_BTN_STYLE);
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
        console.log(TAG$4, `🚫 手动拉黑: ${info.uname}`);
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
        btn.textContent = "✅ 已拉黑";
        applyStyles(btn, BL_BTN_DONE);
      } catch (err) {
        console.error(TAG$4, "❌ 手动拉黑失败:", err);
      }
    });
  }
  const TAG$3 = "[ruozhi-filter]";
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
              console.log(TAG$3, `🚫 自动拉黑: uid=${v.mid} ${reply.member.uname}`);
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
        console.error(TAG$3, "❌ AI判定失败:", err);
      }
    } else if (needAICheck.length > 0 && !config.apiKey) {
      console.warn(TAG$3, "⚠️ 未配置 API Key，跳过 AI 判定");
    }
    if (stats) stats.lastUpdate = Date.now();
    return { violations, newBlacklistEntries };
  }
  const TAG$2 = "[ruozhi-filter]";
  function fullPageDiagnostic() {
    var _a, _b;
    console.log(TAG$2, "══════ 诊断 ══════");
    const bc = document.querySelector("bili-comments");
    console.log(
      TAG$2,
      `📦 bili-comments: ${bc ? "✅ shadowRoot=" + !!bc.shadowRoot + " children=" + bc.children.length : "❌ 未找到"}`
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
        console.log(
          TAG$2,
          `  📌 "${sel}" → ${els.length}个 ${first.tagName.toLowerCase()}${id}${cls}`
        );
      }
    }
    if (bc && bc.shadowRoot) {
      const sr = bc.shadowRoot;
      const allNodes = sr.querySelectorAll("*");
      console.log(TAG$2, `🔬 ShadowRoot 总节点: ${allNodes.length}`);
      const tagCounts = /* @__PURE__ */ new Map();
      allNodes.forEach((n) => {
        const t = n.tagName.toLowerCase();
        tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      });
      console.log(
        TAG$2,
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
        console.log(TAG$2, `  🎯 "${sel}" → ${count}个`);
      }
      console.log(TAG$2, "📋 ShadowRoot 直接子元素:");
      for (const child of sr.children) {
        const tag = child.tagName.toLowerCase();
        const id = child.id ? `#${child.id}` : "";
        const cls = child.className ? "." + child.className.split(" ").slice(0, 3).join(".") : "";
        const text = ((_a = child.innerText) == null ? void 0 : _a.slice(0, 60)) ?? "";
        const childCount = child.querySelectorAll("*").length;
        console.log(
          TAG$2,
          `  <${tag}${id}${cls}> 子元素:${childCount} text:"${text}"`
        );
        if (childCount > 0 && childCount <= 30) {
          for (const c2 of child.children) {
            const t2 = c2.tagName.toLowerCase();
            const id2 = c2.id ? `#${c2.id}` : "";
            const cls2 = c2.className ? "." + c2.className.split(" ").slice(0, 2).join(".") : "";
            const txt2 = ((_b = c2.innerText) == null ? void 0 : _b.slice(0, 50)) ?? "";
            const dataAttrs = c2 instanceof HTMLElement ? c2.getAttributeNames().filter((a) => a.startsWith("data-")).join(", ") : "";
            console.log(
              TAG$2,
              `    <${t2}${id2}${cls2}>${dataAttrs ? " [" + dataAttrs + "]" : ""} "${txt2}"`
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
    console.log(TAG$2, "📐 页面结构:");
    for (const sel of mainSections) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) console.log(TAG$2, `  ${sel}: ${els.length}个`);
    }
    console.log(TAG$2, "══════ 完成 ══════");
  }
  function inspectShadowRoot() {
    const bc = document.querySelector("bili-comments");
    if (!bc || !bc.shadowRoot) {
      console.log(TAG$2, "❌ bili-comments 或其 shadowRoot 未找到");
      return;
    }
    const sr = bc.shadowRoot;
    console.log(TAG$2, "══════ ShadowRoot 完整探查 ══════");
    console.log(TAG$2, `总节点数: ${sr.querySelectorAll("*").length}`);
    console.log(TAG$2, `直接子元素数: ${sr.children.length}`);
    function dump(el, depth = 0) {
      var _a, _b;
      if (depth > 4) return;
      const indent = "  ".repeat(depth);
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : "";
      const cls = el.className ? "." + el.className.split(" ").slice(0, 3).join(".") : "";
      const attrs = el instanceof HTMLElement ? el.getAttributeNames().filter((a) => a !== "class" && a !== "id").map((a) => `${a}="${el.getAttribute(a)}"`.slice(0, 60)).join(" ") : "";
      const text = ((_b = (_a = el.innerText) == null ? void 0 : _a.slice(0, 80)) == null ? void 0 : _b.replace(/\n/g, " ")) ?? "";
      console.log(TAG$2, `${indent}<${tag}${id}${cls}> ${attrs} "${text}"`);
      if (el.children.length <= 4) {
        for (const c of el.children) dump(c, depth + 1);
      } else if (depth < 3) {
        console.log(TAG$2, `${indent}  ... ${el.children.length}个子元素，取前4个`);
        for (let i = 0; i < Math.min(4, el.children.length); i++) {
          dump(el.children[i], depth + 1);
        }
      }
    }
    for (const child of sr.children) {
      dump(child, 0);
    }
    console.log(TAG$2, "══════ 探查完成 ══════");
  }
  const TAG$1 = "[ruozhi-filter]";
  let pendingBatch = [];
  let batchTimer = null;
  const scannedRpids = /* @__PURE__ */ new Set();
  let isFlushing = false;
  function scanPage() {
    const root = getCommentRoot();
    if (!root) {
      console.log(TAG$1, "🔍 scanPage: 未找到评论区根节点");
      return;
    }
    const items = findCommentElements(root);
    console.log(
      TAG$1,
      `🔍 scanPage: 找到 ${items.length} 个评论元素, root=${root === document ? "document" : root.tagName || "shadowRoot"}`
    );
    if (items.length === 0) return;
    let found = 0;
    items.forEach((el) => {
      const info = extractComment(el);
      if (!info) return;
      injectManualBlacklistButton(el, info);
      if (scannedRpids.has(info.rpid)) return;
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
      scannedRpids.add(info.rpid);
      found++;
      if (!config.enableAI && !config.enableBlacklist) return;
      pendingBatch.push(info);
    });
    if (found > 0) {
      if (pendingBatch.length >= 10) flushBatch();
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
    console.log(TAG$1, `🚀 AI判定: ${batch.length} 条评论`);
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
        console.log(TAG$1, `🛡️ ${result.violations.size}/${batch.length} 条违规`);
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
      console.error(TAG$1, "❌ AI失败:", err);
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
    console.log(TAG$1, "👁️ MutationObserver 已绑定到评论根节点");
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
          if (pendingBatch.length >= 10) flushBatch();
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
      if (pendingBatch.length >= 10) flushBatch();
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
      gap: "4px"
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
      boxShadow: "0 2px 6px rgba(217,83,79,0.3)"
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
      userSelect: "none"
    });
    btn.addEventListener("mouseenter", () => {
      btn.style.transform = "scale(1.1)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.transform = "scale(1)";
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
      width: "400px",
      maxHeight: "600px",
      background: "#fff",
      borderRadius: "12px",
      boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
      zIndex: "99998",
      display: "none",
      overflow: "hidden",
      fontFamily: "system-ui, -apple-system, sans-serif"
    });
    root.innerHTML = buildPanelHTML(config);
    document.body.appendChild(root);
    bindPanelEvents(root, config, onConfigChange);
    return root;
  }
  function buildPanelHTML(config) {
    return `
<div style="display:flex;flex-direction:column;max-height:600px">
  <!-- Header -->
  <div style="padding:16px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border-radius:12px 12px 0 0">
    <div style="font-size:16px;font-weight:700">🧠 信息茧房放大器</div>
    <div style="font-size:12px;opacity:0.8;margin-top:4px">AI驱动的降智言论过滤器</div>
  </div>

  <!-- Tab切换 -->
  <div id="ruozhi-tabs" style="display:flex;border-bottom:1px solid #eee">
    <button class="ruozhi-tab active" data-tab="settings" style="flex:1;padding:10px;border:none;background:none;cursor:pointer;font-size:13px;color:#667eea;border-bottom:2px solid #667eea">⚙️ 设置</button>
    <button class="ruozhi-tab" data-tab="stats" style="flex:1;padding:10px;border:none;background:none;cursor:pointer;font-size:13px;color:#999">📊 统计</button>
    <button class="ruozhi-tab" data-tab="blacklist" style="flex:1;padding:10px;border:none;background:none;cursor:pointer;font-size:13px;color:#999">📋 黑名单</button>
  </div>

  <!-- Settings Tab -->
  <div id="ruozhi-tab-settings" style="overflow-y:auto;flex:1;padding:12px 16px">
    <div style="margin-bottom:12px">
      <label style="font-size:12px;color:#666;display:block;margin-bottom:4px">🔑 DeepSeek API Key</label>
      <input id="ruozhi-apikey" type="password" value="${escapeAttr(config.apiKey)}"
        placeholder="sk-xxxxxxxx"
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

  <!-- Stats Tab -->
  <div id="ruozhi-tab-stats" style="display:none;overflow-y:auto;flex:1;padding:12px 16px">
    <div id="ruozhi-stats-content" style="font-size:13px">
      <div style="text-align:center;color:#999;padding:20px">暂无统计数据，等待首次 API 调用...</div>
    </div>
  </div>

  <!-- Blacklist Tab -->
  <div id="ruozhi-tab-blacklist" style="display:none;overflow-y:auto;flex:1;max-height:400px">
    <div id="ruozhi-blacklist-content" style="padding:8px 0">加载中...</div>
  </div>
</div>`;
  }
  function escapeAttr(s) {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }
  function bindPanelEvents(root, config, onConfigChange) {
    var _a, _b, _c, _d, _e;
    const tabs = root.querySelectorAll(".ruozhi-tab");
    tabs.forEach((tab) => {
      tab.addEventListener("click", async () => {
        tabs.forEach((t2) => {
          t2.style.color = "#999";
          t2.style.borderBottomColor = "transparent";
        });
        const t = tab;
        t.style.color = "#667eea";
        t.style.borderBottomColor = "#667eea";
        const tabName = t.dataset.tab;
        const settingsEl = root.querySelector(
          "#ruozhi-tab-settings"
        );
        const statsEl = root.querySelector("#ruozhi-tab-stats");
        const blEl = root.querySelector("#ruozhi-tab-blacklist");
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
    (_a = root.querySelector("#ruozhi-save")) == null ? void 0 : _a.addEventListener("click", () => {
      var _a2, _b2, _c2, _d2, _e2, _f, _g, _h, _i, _j, _k, _l;
      const newConfig = {
        ...config,
        apiKey: ((_a2 = root.querySelector("#ruozhi-apikey")) == null ? void 0 : _a2.value) ?? "",
        apiEndpoint: ((_b2 = root.querySelector("#ruozhi-endpoint")) == null ? void 0 : _b2.value) ?? config.apiEndpoint,
        prompt: ((_c2 = root.querySelector("#ruozhi-prompt")) == null ? void 0 : _c2.value) ?? config.prompt,
        enableAI: ((_d2 = root.querySelector("#ruozhi-enable-ai")) == null ? void 0 : _d2.checked) ?? true,
        foldMode: ((_e2 = root.querySelector("#ruozhi-fold-mode")) == null ? void 0 : _e2.value) ?? "classic",
        enableBlacklist: ((_f = root.querySelector("#ruozhi-enable-bl")) == null ? void 0 : _f.checked) ?? true,
        blacklistConfirm: ((_g = root.querySelector("#ruozhi-bl-confirm")) == null ? void 0 : _g.checked) ?? true,
        pricePerMToken: parseFloat(
          ((_h = root.querySelector("#ruozhi-price")) == null ? void 0 : _h.value) || "1.1"
        ) || 1.1,
        sendUname: ((_i = root.querySelector("#ruozhi-send-uname")) == null ? void 0 : _i.checked) ?? false,
        sendMid: ((_j = root.querySelector("#ruozhi-send-mid")) == null ? void 0 : _j.checked) ?? false,
        sendVideoDesc: ((_k = root.querySelector("#ruozhi-send-videodesc")) == null ? void 0 : _k.checked) ?? false,
        filterDimensions: ((_l = root.querySelector("#ruozhi-dimensions")) == null ? void 0 : _l.value) ?? config.filterDimensions
      };
      saveConfig(newConfig);
      onConfigChange(newConfig);
      showStatus(root, "✅ 设置已保存", "#28a745");
    });
    (_b = root.querySelector("#ruozhi-enable-bl")) == null ? void 0 : _b.addEventListener("change", () => {
      var _a2;
      const checked = (_a2 = root.querySelector("#ruozhi-enable-bl")) == null ? void 0 : _a2.checked;
      const confirmRow = root.querySelector(
        "#ruozhi-bl-confirm-row"
      );
      if (confirmRow) confirmRow.style.display = checked ? "" : "none";
    });
    (_c = root.querySelector("#ruozhi-test")) == null ? void 0 : _c.addEventListener("click", async () => {
      var _a2;
      const apiKey = (_a2 = root.querySelector("#ruozhi-apikey")) == null ? void 0 : _a2.value;
      if (!apiKey) {
        showStatus(root, "⚠️ 请先填写 API Key", "#ffc107");
        return;
      }
      showStatus(root, "⏳ 正在测试...", "#666");
      const ok = await testAPIConnection({ ...config, apiKey });
      showStatus(
        root,
        ok ? "✅ 连接成功" : "❌ 连接失败，请检查API Key和地址",
        ok ? "#28a745" : "#d9534f"
      );
    });
    (_d = root.querySelector("#ruozhi-clear-cache")) == null ? void 0 : _d.addEventListener("click", async () => {
      await clearCache();
      showStatus(root, "✅ 缓存已清除", "#28a745");
    });
    (_e = root.querySelector("#ruozhi-clear-bl")) == null ? void 0 : _e.addEventListener("click", async () => {
      if (!confirm("确定要清空所有黑名单记录吗？此操作不可撤销。")) return;
      await clearBlacklist();
      showStatus(root, "✅ 黑名单已清空", "#28a745");
      const blContent = root.querySelector("#ruozhi-blacklist-content");
      if (blContent) {
        blContent.innerHTML = '<div style="padding:16px;text-align:center;color:#999">暂无黑名单记录，一片祥和 🎉</div>';
      }
    });
    root.addEventListener("click", (e) => {
      const target = e.target;
      if (!target.closest("#ruozhi-clear-stats")) return;
      if (!confirm("确定要重置所有统计数据吗？")) return;
      resetStats();
      updateStatsPanel();
    });
  }
  function showStatus(root, msg, color) {
    const el = root.querySelector("#ruozhi-status");
    if (el) {
      el.textContent = msg;
      el.style.color = color;
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
    let sevHTML = "";
    const labels = {
      low: "⚠️ 轻微",
      medium: "🚫 违规",
      high: "⛔ 严重",
      block: "🛑 拉黑"
    };
    for (const [sev, count] of Object.entries(s.severityCounts).sort()) {
      const label = labels[sev] ?? sev;
      sevHTML += `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f0f0f0">
      <span>${label}</span><strong>${count}</strong></div>`;
    }
    contentEl.innerHTML = `
    <div style="margin-bottom:12px">
      <div style="font-weight:600;margin-bottom:8px;color:#333">📈 累计统计</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <div style="background:#f5f7fa;padding:8px;border-radius:6px;text-align:center">
          <div style="font-size:20px;font-weight:700;color:#909399">${s.totalScanned}</div>
          <div style="font-size:11px;color:#999">已扫描</div>
        </div>
        <div style="background:#f5f7fa;padding:8px;border-radius:6px;text-align:center">
          <div style="font-size:20px;font-weight:700;color:#667eea">${s.totalFiltered}</div>
          <div style="font-size:11px;color:#999">已过滤</div>
        </div>
        <div style="background:#f5f7fa;padding:8px;border-radius:6px;text-align:center">
          <div style="font-size:20px;font-weight:700;color:#764ba2">${s.apiCalls}</div>
          <div style="font-size:11px;color:#999">API 调用</div>
        </div>
        <div style="background:#f5f7fa;padding:8px;border-radius:6px;text-align:center">
          <div style="font-size:20px;font-weight:700;color:#e6a23c">${tokensPerK}K</div>
          <div style="font-size:11px;color:#999">Token</div>
        </div>
        <div style="background:#f5f7fa;padding:8px;border-radius:6px;text-align:center">
          <div style="font-size:20px;font-weight:700;color:#67c23a">¥${costEst}</div>
          <div style="font-size:11px;color:#999">预估费用</div>
        </div>
        <div style="background:#fef0f0;padding:8px;border-radius:6px;text-align:center;cursor:pointer" id="ruozhi-clear-stats">
          <div style="font-size:16px;color:#f56c6c">🗑️</div>
          <div style="font-size:11px;color:#f56c6c">重置统计</div>
        </div>
      </div>
    </div>
    <div style="margin-top:12px">
      <div style="font-weight:600;margin-bottom:8px;color:#333">🏷️ 违规分布</div>
      ${sevHTML || '<div style="color:#999;text-align:center;padding:8px">暂无</div>'}
    </div>
    <div style="margin-top:12px;font-size:11px;color:#aaa;text-align:center">
      DeepSeek-chat ¥${price}/1M tokens · prompt: ${(s.promptTokens / 1e3).toFixed(1)}K · completion: ${(s.completionTokens / 1e3).toFixed(1)}K
    </div>
  `;
  }
  function bindBlacklistEvents(container) {
    container.querySelectorAll(".ruozhi-remove-bl").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const mid = parseInt(btn.dataset.mid ?? "0");
        if (mid) {
          await removeFromBlacklist(mid);
          const contentEl = container.querySelector("#ruozhi-blacklist-content") ?? container;
          contentEl.innerHTML = await buildBlacklistPanelHTML();
          bindBlacklistEvents(contentEl);
        }
      });
    });
  }
  const TAG = "[ruozhi-filter]";
  async function main() {
    console.log(TAG, "🚀 插件启动中...");
    initMemoryCache().catch(() => {
    });
    let config = loadConfig();
    if (!config.apiKey) {
      config = { ...DEFAULT_CONFIG };
    }
    extractVideoInfo();
    startDOMScanner();
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
      config = newConfig;
      refreshConfig(config);
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