// ============================================================
// main.ts - 入口
// ============================================================
import { injectUI, loadConfig, setStatsRef } from "./ui";
import type { FilterConfig, AccumulatedStats } from "./types";
import { DEFAULT_CONFIG } from "./types";
import {
  startDOMScanner,
  extractVideoInfo,
  updateContext,
  refreshConfig,
  setUpdateStats,
} from "./interceptor";
import { pruneCache, getBlacklistCount, initMemoryCache } from "./db";
import { log } from "./debug";
import { refineProfileNow } from "./api";
import { setRefineCallback } from "./learning";
import {
  startRcmdFilter,
  stopRcmdFilter,
  onVideoNavigate,
} from "./rcmd-filter";

// ruozhi = Robust User Optimized Zero-Hate Interface
const TAG = "[ruozhi-filter]";

async function main(): Promise<void> {
  log(TAG, "Plugin starting...");

  // ★ 连接学习模块 → 画像更新（独立于评论扫描）
  setRefineCallback(refineProfileNow);

  // ★ 优先加载内存缓存（黑名单 + 缓存），使后续扫描能瞬间判定
  initMemoryCache().catch(() => {});

  let config: FilterConfig = loadConfig();
  if (!config.apiKey) {
    config = { ...DEFAULT_CONFIG };
  }

  extractVideoInfo();
  startDOMScanner();

  // ★ 推荐视频过滤：根据配置决定是否启动
  if (config.enableRcmdFilter) startRcmdFilter();

  // ★ SPA 导航检测：B站点击推荐视频不刷新页面，需监听 URL 变化
  let lastUrl = location.href;
  const titleEl = document.querySelector("title");
  if (titleEl) {
    new MutationObserver(() => {
      updateContext({
        videoTitle: document.title.replace(/[ _-]哔哩哔哩.*$/, ""),
      });
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        extractVideoInfo();
        onVideoNavigate();
      }
    }).observe(titleEl, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  injectUI(config, (newConfig: FilterConfig) => {
    // 配置变更时同步启停推荐视频过滤
    const wasEnabled = config.enableRcmdFilter;
    config = newConfig;
    refreshConfig(config);

    if (newConfig.enableRcmdFilter && !wasEnabled) {
      startRcmdFilter();
    } else if (!newConfig.enableRcmdFilter && wasEnabled) {
      stopRcmdFilter();
    }
  });

  // 连接 UI 统计更新
  setUpdateStats((s: AccumulatedStats) => {
    setStatsRef(s);
  });

  // 定期清理缓存
  setInterval(
    () => {
      pruneCache().catch(() => {});
    },
    60 * 60 * 1000,
  );
}

if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", main);
else main();
