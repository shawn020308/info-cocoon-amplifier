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

const TAG = "[ruozhi-filter]";

async function main(): Promise<void> {
  console.log(TAG, "🚀 插件启动中...");

  // ★ 优先加载内存缓存（黑名单 + 缓存），使后续扫描能瞬间判定
  initMemoryCache().catch(() => {});

  let config: FilterConfig = loadConfig();
  if (!config.apiKey) {
    config = { ...DEFAULT_CONFIG };
  }

  extractVideoInfo();
  startDOMScanner();

  const titleEl = document.querySelector("title");
  if (titleEl) {
    new MutationObserver(() => {
      updateContext({
        videoTitle: document.title.replace(/[ _-]哔哩哔哩.*$/, ""),
      });
    }).observe(titleEl, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  injectUI(config, (newConfig: FilterConfig) => {
    config = newConfig;
    refreshConfig(config);
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
