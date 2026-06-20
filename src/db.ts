// ============================================================
// db.ts - IndexedDB 封装: 黑名单 & LRU缓存
// 性能关键: 启动时将数据加载到内存 Map，查询 O(1) 瞬间完成
// ============================================================
import { openDB, type IDBPDatabase } from "idb";
import type { BlacklistRecord, CacheEntry } from "./types";

const DB_NAME = "ruozhi-filter-db";
const DB_VERSION = 4;

let dbPromise: Promise<IDBPDatabase> | null = null;

// ── 内存缓存（查询瞬间完成，无需 await）──

/** 黑名单内存索引: mid → record */
const blByMid = new Map<number, BlacklistRecord>();
/** 黑名单内存索引: username hash → record */
const blByUid = new Map<number, BlacklistRecord>();
/** 评论缓存内存索引: hash → entry (最多保留 3000 条) */
const cacheByHash = new Map<string, CacheEntry>();
/** 内存缓存是否已初始化 */
let memoryCacheReady = false;

function getDB(): Promise<IDBPDatabase> {
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
          // v2: 改用 username hash 作为key，先删旧表重建
          if (db.objectStoreNames.contains("blacklist")) {
            db.deleteObjectStore("blacklist");
          }
          const bl = db.createObjectStore("blacklist", {
            keyPath: "uid",
          });
          bl.createIndex("timestamp", "timestamp");
          bl.createIndex("severity", "severity");
        }
        if (oldVersion < 3) {
          // v3: 添加 source 字段 (manual/auto)，旧数据默认为 auto
          // 新字段自动兼容，无需重建store
        }
        if (oldVersion < 4) {
          // v4: 改回 mid 作为主键 (username hash 不稳定，用户可改名)
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
      },
    });
  }
  return dbPromise;
}

// ---------- 工具 ----------

/** 简单字符串 hash (djb2) */
function strHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) & 0x7fffffff;
  }
  return h;
}

/** 根据用户名生成黑名单key */
export function blacklistKey(uname: string): number {
  return strHash(uname.trim());
}

/** 生成评论hash (基于内容和uid) */
export function commentHash(message: string, mid: number): string {
  const input = `${mid}:${message.trim().slice(0, 200)}`;
  return strHash(input).toString(16);
}

// ---------- 黑名单操作 ----------

/** 同步查询黑名单（内存命中，O(1)，无需 await） */
export function isBlacklistedSync(
  mid: number,
  uname: string,
): BlacklistRecord | null {
  if (mid > 0) {
    const record = blByMid.get(mid);
    if (record) return record;
  }
  const uid = blacklistKey(uname);
  return blByUid.get(uid) ?? null;
}

/** 同步查询缓存（内存命中，O(1)，无需 await） */
export function getCacheSync(hash: string): CacheEntry | null {
  return cacheByHash.get(hash) ?? null;
}

/** 查询用户是否在黑名单中 (key = mid, fallback to username hash) */
export async function isBlacklisted(
  mid: number,
  uname: string,
): Promise<BlacklistRecord | null> {
  // 优先查内存
  const mem = isBlacklistedSync(mid, uname);
  if (mem) return mem;

  const db = await getDB();
  // 优先用 mid（B站UID唯一且稳定）
  if (mid > 0) {
    const record = await db.get("blacklist", mid);
    if (record) return record;
  }
  // fallback: username hash (mid为0时)
  return (
    (await db.getFromIndex("blacklist", "uid", blacklistKey(uname))) ?? null
  );
}

/** 将用户加入黑名单 (key = mid, fallback to username hash) */
export async function addToBlacklist(record: BlacklistRecord): Promise<void> {
  const db = await getDB();
  const uid = blacklistKey(record.uname);
  // B站新UI的Shadow DOM不总是暴露data-mid，此时用username hash做key
  const key = record.mid > 0 ? record.mid : uid;
  const entry = { ...record, mid: key, uid };
  await db.put("blacklist", entry);
  // 同步更新内存
  if (memoryCacheReady) {
    blByMid.set(key, entry);
    blByUid.set(uid, entry);
  }
}

/** 获取所有黑名单记录 */
export async function getAllBlacklist(): Promise<BlacklistRecord[]> {
  const db = await getDB();
  return db.getAll("blacklist");
}

/** 从黑名单移除 (by mid) */
export async function removeFromBlacklist(mid: number): Promise<void> {
  const db = await getDB();
  // 同步删除内存
  const record = blByMid.get(mid);
  if (record) {
    blByMid.delete(mid);
    if (record.uid) blByUid.delete(record.uid);
  }
  await db.delete("blacklist", mid);
}

/** 获取黑名单总数 */
export async function getBlacklistCount(): Promise<number> {
  const db = await getDB();
  return db.count("blacklist");
}

/** 清空黑名单 */
export async function clearBlacklist(): Promise<void> {
  const db = await getDB();
  blByMid.clear();
  blByUid.clear();
  await db.clear("blacklist");
}

// ---------- LRU 缓存操作 ----------

/** 查询缓存 */
export async function getCache(hash: string): Promise<CacheEntry | null> {
  // 优先查内存
  const mem = cacheByHash.get(hash);
  if (mem) {
    if (Date.now() - mem.timestamp > 24 * 60 * 60 * 1000) {
      cacheByHash.delete(hash);
      return null;
    }
    return mem;
  }

  const db = await getDB();
  const entry = await db.get("cache", hash);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > 24 * 60 * 60 * 1000) {
    await db.delete("cache", hash);
    return null;
  }
  return entry;
}

/** 写入缓存 */
export async function setCache(entry: CacheEntry): Promise<void> {
  const db = await getDB();
  await db.put("cache", entry);
  // 同步更新内存（LRU: 超过上限时删除最旧的）
  if (memoryCacheReady) {
    cacheByHash.set(entry.hash, entry);
    if (cacheByHash.size > 3000) {
      const oldest = [...cacheByHash.entries()].sort(
        (a, b) => a[1].timestamp - b[1].timestamp,
      )[0];
      if (oldest) cacheByHash.delete(oldest[0]);
    }
  }
}

/** 清空缓存 */
export async function clearCache(): Promise<void> {
  const db = await getDB();
  cacheByHash.clear();
  await db.clear("cache");
}

/** 清理过期缓存 (保留最近5000条) */
export async function pruneCache(): Promise<void> {
  const db = await getDB();
  // 同时清理内存
  const now = Date.now();
  const expiry = 24 * 60 * 60 * 1000;
  for (const [hash, entry] of cacheByHash) {
    if (now - entry.timestamp > expiry) cacheByHash.delete(hash);
  }
  // 截断到 3000
  if (cacheByHash.size > 3000) {
    const sorted = [...cacheByHash.entries()].sort(
      (a, b) => b[1].timestamp - a[1].timestamp,
    );
    cacheByHash.clear();
    for (const [hash, entry] of sorted.slice(0, 3000)) {
      cacheByHash.set(hash, entry);
    }
  }

  const all = await db.getAll("cache");
  all.sort((a, b) => b.timestamp - a.timestamp);
  const keep = all.slice(0, 5000);
  const keepHashes = new Set(keep.map((e) => e.hash));
  const toDelete = all.filter((e) => !keepHashes.has(e.hash));
  const tx = db.transaction("cache", "readwrite");
  for (const entry of toDelete) {
    await tx.store.delete(entry.hash);
  }
  await tx.done;
}

// ── 内存缓存初始化 ──

/** 初始化内存缓存：从 IndexedDB 加载所有黑名单和缓存到内存 */
export async function initMemoryCache(): Promise<void> {
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
    const expiry = 24 * 60 * 60 * 1000;
    allCache.sort((a, b) => b.timestamp - a.timestamp);
    for (const entry of allCache.slice(0, 3000)) {
      if (now - entry.timestamp <= expiry) {
        cacheByHash.set(entry.hash, entry);
      }
    }

    memoryCacheReady = true;
    console.log(
      "[ruozhi-filter]",
      `📋 内存缓存就绪: 黑名单=${blByMid.size}条, 缓存=${cacheByHash.size}条`,
    );
  } catch (err) {
    console.error("[ruozhi-filter]", "❌ 内存缓存初始化失败:", err);
    // 失败不阻塞，走 IndexedDB 降级路径
  }
}
