// ============================================================
// comment-scanner.ts - 评论扫描器核心（批处理 + 观察器 + 启动）
// ============================================================
import type { BiliReply } from "./types";
import { getConfig, currentContext } from "./config";
import { extractVideoInfo } from "./video-info";
import { getCommentRoot, findCommentElements } from "./dom-utils";
import type { PendingComment } from "./comment-extractor";
import { extractComment } from "./comment-extractor";
import { injectManualBlacklistButton } from "./manual-blacklist";
import { log } from "./debug";
import { foldEl, hideEl } from "./fold-ui";
import { ruozhiStats, saveStats, notifyStatsUpdate, resetStats } from "./stats";
import { filterReplies } from "./filter";
import { fullPageDiagnostic, inspectShadowRoot } from "./diagnostics";
import { isBlacklistedSync, getCacheSync, commentHash } from "./db";

const TAG = "[ruozhi-filter]";

// ── 内部状态 ──

let pendingBatch: PendingComment[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;
const scannedRpids = new Set<number>();
let isFlushing = false;

// ── 扫描 ──

function scanPage(): void {
  const root = getCommentRoot();
  if (!root) {
    log(TAG, "🔍 scanPage: 未找到评论区根节点");
    return;
  }

  const items = findCommentElements(root);
  log(
    TAG,
    `🔍 scanPage: 找到 ${items.length} 个评论元素, root=${root === document ? "document" : (root as Element).tagName || "shadowRoot"}`,
  );
  if (items.length === 0) return;

  let found = 0;
  items.forEach((el) => {
    const info = extractComment(el);
    if (!info) return;

    // 注入手动拉黑按钮（在 rpid 检查前，切换排序时 DOM 重建也能注入）
    // WeakSet<Element> 仍能防重复注入，不依赖 rpid
    injectManualBlacklistButton(el, info);

    if (scannedRpids.has(info.rpid)) return;

    const config = getConfig();

    // ★ 快速路径：同步查内存黑名单，命中即刻折叠，不等 batch
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
              severity: blRecord.severity,
            },
            config.foldMode,
          );
        ruozhiStats.totalFiltered++;
        ruozhiStats.totalScanned++;
        ruozhiStats.severityCounts[blRecord.severity] =
          (ruozhiStats.severityCounts[blRecord.severity] ?? 0) + 1;
        return;
      }
    }

    // ★ 快速路径：同步查内存缓存，命中即刻折叠，不等 batch
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
            config.foldMode,
          );
        ruozhiStats.totalFiltered++;
        ruozhiStats.totalScanned++;
        ruozhiStats.severityCounts[cached.severity] =
          (ruozhiStats.severityCounts[cached.severity] ?? 0) + 1;
        return;
      }
    }

    scannedRpids.add(info.rpid);
    found++;
    if (!config.enableAI && !config.enableBlacklist) return;
    pendingBatch.push(info);
  });

  if (found > 0) {
    // 缩短批量等待：凑够 10 条立刻发，否则最多等 150ms
    if (pendingBatch.length >= 10) flushBatch();
    else if (!batchTimer) batchTimer = setTimeout(flushBatch, 150);
  }
}

// ── 批量发送 ──

async function flushBatch(): Promise<void> {
  if (batchTimer) {
    clearTimeout(batchTimer);
    batchTimer = null;
  }
  if (pendingBatch.length === 0 || isFlushing) return;
  isFlushing = true;

  const batch = pendingBatch.splice(0);

  log(TAG, `🚀 AI判定: ${batch.length} 条评论`);

  const config = getConfig();
  if (!currentContext.videoTitle) extractVideoInfo();

  const replies: BiliReply[] = batch.map((p) => ({
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
    member: { mid: String(p.mid), uname: p.uname, avatar: "" },
  }));

  try {
    const result = await filterReplies(
      config,
      replies,
      currentContext,
      ruozhiStats,
    );

    ruozhiStats.totalScanned += batch.length;

    if (result.violations.size > 0) {
      log(TAG, `🛡️ ${result.violations.size}/${batch.length} 条违规`);
      let cleaned = 0;
      for (const [rpid, v] of result.violations) {
        const p = batch.find((x) => x.rpid === rpid);
        if (!p) continue;
        if (
          config.foldMode === "none"
            ? hideEl(p.el)
            : foldEl(p.el, p, v, config.foldMode)
        )
          cleaned++;
      }

      // 更新UI
      try {
        notifyStatsUpdate();
      } catch {
        /* */
      }
    } else {
      try {
        notifyStatsUpdate();
      } catch {
        /* */
      }
    }

    // 持久化统计
    saveStats(ruozhiStats);
  } catch (err) {
    console.error(TAG, "❌ AI失败:", err);
  } finally {
    isFlushing = false;
  }
}

// ── 观察器 ──

/** MutationObserver: 监听新评论加载 */
function watchNewComments(): void {
  const root = getCommentRoot();
  if (!root) {
    setTimeout(() => watchNewComments(), 3000);
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

  observer.observe(root as unknown as Node, {
    childList: true,
    subtree: true,
  });
  log(TAG, "👁️ MutationObserver 已绑定到评论根节点");

  // 绑定后立即扫描一次（评论可能已存在但 observer 尚未触发）
  scanPage();
}

/** 滚动加载检测 */
function watchScrollLoading(): void {
  // B站评论区滚动到底部时会加载更多评论
  // 监听滚动事件，在滚动停止后触发扫描
  let scrollTimer: ReturnType<typeof setTimeout> | null = null;

  window.addEventListener(
    "scroll",
    () => {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        scanPage();
        // 如果还有待处理，立即刷
        if (pendingBatch.length >= 10) flushBatch();
      }, 250);
    },
    { passive: true },
  );
}

// ── 启动 ──

/** 启动 DOM 扫描器（入口函数） */
export function startDOMScanner(): void {
  // 初始扫描：500ms/1.5s（原来 4s/8s 太慢，用户早已看到评论）
  setTimeout(() => scanPage(), 500);
  setTimeout(() => scanPage(), 1500);

  // 周期性扫描 (每3秒，原来5s)
  setInterval(() => {
    scanPage();
    if (pendingBatch.length >= 10) flushBatch();
  }, 3000);

  // 监听DOM变化（提前到 500ms，原来 2s）
  setTimeout(() => watchNewComments(), 500);

  // 监听滚动加载
  watchScrollLoading();

  // 暴露调试接口
  const uw =
    typeof unsafeWindow !== "undefined" ? unsafeWindow : (window as any);
  uw.__ruozhi_diag = () => {
    fullPageDiagnostic();
    scanPage();
  };
  uw.__ruozhi_scan = () => scanPage();
  uw.__ruozhi_flush = () => flushBatch();
  uw.__ruozhi_inspect = () => inspectShadowRoot();
  uw.__ruozhi_reset_stats = () => resetStats();
}
