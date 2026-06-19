// ============================================================
// db.ts - IndexedDB 封装: 黑名单 & LRU缓存
// ============================================================
import { openDB, type IDBPDatabase } from "idb";
import type { BlacklistRecord, CacheEntry } from "./types";

const DB_NAME = "ruozhi-filter-db";
const DB_VERSION = 3;

let dbPromise: Promise<IDBPDatabase> | null = null;

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

/** 查询用户是否在黑名单中 (key = username hash) */
export async function isBlacklisted(
  mid: number,
  uname: string,
): Promise<BlacklistRecord | null> {
  const db = await getDB();
  // 优先用真实mid查询，如果mid为0则用username hash
  const key = mid > 0 ? mid : blacklistKey(uname);
  const record = await db.get("blacklist", key);
  return record ?? null;
}

/** 将用户加入黑名单 */
export async function addToBlacklist(record: BlacklistRecord): Promise<void> {
  const db = await getDB();
  // uid = username hash (stable key we can always compute)
  const uid = blacklistKey(record.uname);
  await db.put("blacklist", { ...record, uid });
}

/** 获取所有黑名单记录 */
export async function getAllBlacklist(): Promise<BlacklistRecord[]> {
  const db = await getDB();
  return db.getAll("blacklist");
}

/** 从黑名单移除 (by username hash) */
export async function removeFromBlacklist(uid: number): Promise<void> {
  const db = await getDB();
  await db.delete("blacklist", uid);
}

/** 获取黑名单总数 */
export async function getBlacklistCount(): Promise<number> {
  const db = await getDB();
  return db.count("blacklist");
}

/** 清空黑名单 */
export async function clearBlacklist(): Promise<void> {
  const db = await getDB();
  await db.clear("blacklist");
}

// ---------- LRU 缓存操作 ----------

/** 查询缓存 */
export async function getCache(hash: string): Promise<CacheEntry | null> {
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
}

/** 清空缓存 */
export async function clearCache(): Promise<void> {
  const db = await getDB();
  await db.clear("cache");
}

/** 清理过期缓存 (保留最近5000条) */
export async function pruneCache(): Promise<void> {
  const db = await getDB();
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
