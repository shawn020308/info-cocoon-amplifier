// ============================================================
// stats.ts - 统计数据的加载/保存/更新
// ============================================================
import type { AccumulatedStats } from "./types";

const STATS_KEY = "ruozhi-stats";

function loadStats(): AccumulatedStats {
  try {
    const raw = GM_getValue(STATS_KEY, "");
    if (raw) return JSON.parse(raw);
  } catch {
    /* */
  }
  return {
    totalFiltered: 0,
    totalScanned: 0,
    apiCalls: 0,
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    severityCounts: {},
    lastUpdate: 0,
  };
}

export function saveStats(s: AccumulatedStats): void {
  try {
    GM_setValue(STATS_KEY, JSON.stringify(s));
  } catch {
    /* */
  }
}

/** 全局统计：从持久化存储恢复，跨SPA导航保持 */
export const ruozhiStats: AccumulatedStats = loadStats();

// 暴露到全局
if (typeof window !== "undefined") {
  (window as any).__ruozhi_stats = ruozhiStats;
}

/** 延迟导入ui模块的updateStats避免循环依赖 */
let updateStats: (s: AccumulatedStats) => void = () => {};
export function setUpdateStats(fn: (s: AccumulatedStats) => void): void {
  updateStats = fn;
}

/** 触发UI统计更新 */
export function notifyStatsUpdate(): void {
  try {
    updateStats(ruozhiStats);
  } catch {
    /* */
  }
}

/** 重置统计 */
export function resetStats(): void {
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
