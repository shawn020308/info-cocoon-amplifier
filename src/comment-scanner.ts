// ============================================================
// comment-scanner.ts - 评论扫描器核心（批处理 + 观察器 + 启动）
// ============================================================
import type { BiliReply } from "./types";
import { getConfig, currentContext } from "./config";
import { extractVideoInfo } from "./video-info";
import { getCommentRoot, findCommentElements } from "./dom-utils";
import type { PendingComment } from "./comment-extractor";
import { extractComment } from "./comment-extractor";
import { injectManualBlacklistButton } from "./ui";
import { log } from "./debug";
import { foldEl, hideEl } from "./ui";
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

// ── 本地预过滤：跳过明显无需 AI 判断的低价值评论 ──

/** 检测是否为纯@呼朋引伴评论（如 "@张三 @李四"，无实质内容） */
function isAtOnlyComment(message: string): boolean {
  // 匹配B站 @用户名: 允许中日韩文字、假名、韩文、字母数字、下划线、连字符
  const stripped = message
    .replace(
      /@[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af\w\-]+/g,
      "",
    )
    .trim();
  return stripped.length === 0;
}

/** 预过滤：根据配置决定是否跳过（不需要AI判定） */
function skipAI(info: PendingComment): boolean {
  const config = getConfig();
  // 四项预过滤全部关闭时，不做任何跳过
  if (
    !config.prefilterShort &&
    !config.prefilterSymbols &&
    !config.prefilterEnglish &&
    !config.prefilterAtOnly
  ) {
    return false;
  }
  const msg = info.message.trim();
  // 过短（<3个非空白字符），如 "哈" "嗯" "dd"
  if (config.prefilterShort && [...msg].filter((c) => c !== " ").length < 3)
    return true;
  // 纯符号/表情/数字/标点（如 "666"、"2333"、"？？？"、"😂"）
  if (
    config.prefilterSymbols &&
    /^[\s\d\p{P}\p{S}\p{Emoji}，,。.！!？?…~～、]+$/u.test(msg) &&
    msg.length < 15
  )
    return true;
  // 纯英文简单评论（如 "good"、"nice"、"nb"）
  if (config.prefilterEnglish && /^[a-zA-Z\s!~]+$/.test(msg) && msg.length < 8)
    return true;
  // 纯@呼朋引伴（如 "@张三 @李四"），跳过AI并直接折叠
  if (config.prefilterAtOnly && isAtOnlyComment(msg)) return true;
  return false;
}

// ── 扫描 ──

function scanPage(): void {
  const root = getCommentRoot();
  if (!root) {
    log(TAG, "scanPage: 未找到评论区根节点");
    return;
  }

  const items = findCommentElements(root);
  log(
    TAG,
    `scanPage: 找到 ${items.length} 个评论元素, root=${root === document ? "document" : (root as Element).tagName || "shadowRoot"}`,
  );
  if (items.length === 0) return;

  let found = 0;
  items.forEach((el) => {
    // 跳过已被折叠隐藏的评论（防止重复折叠叠加）
    if ((el as HTMLElement).style.display === "none") return;

    const info = extractComment(el);
    if (!info) return;

    // 注入手动拉黑按钮（在 rpid 检查前，切换排序时 DOM 重建也能注入）
    // WeakSet<Element> 仍能防重复注入，不依赖 rpid
    injectManualBlacklistButton(el, info);

    const config = getConfig();

    // ★ 快速路径必须在 scannedRpids 守卫之前：
    // 切换排序/翻页时 DOM 重建，同一条评论的 rpid 不变，
    // 若先检查 scannedRpids 则会跳过黑名单/缓存判定，导致已拉黑的评论不会立刻折叠。

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

    // ★ 快速路径：纯@呼朋引伴评论，直接折叠，节省AI token
    if (config.prefilterAtOnly && isAtOnlyComment(info.message)) {
      scannedRpids.add(info.rpid);
      found++;
      if (config.foldMode === "none") hideEl(info.el);
      else
        foldEl(
          info.el,
          info,
          { reason: "[呼朋引伴] 纯@提及，无实质内容", severity: "low" },
          config.foldMode,
        );
      ruozhiStats.totalFiltered++;
      ruozhiStats.totalScanned++;
      ruozhiStats.severityCounts["low"] =
        (ruozhiStats.severityCounts["low"] ?? 0) + 1;
      return;
    }

    // 已经扫描过且未命中黑名单/缓存 → 跳过，避免重复加入 pendingBatch
    if (scannedRpids.has(info.rpid)) return;

    scannedRpids.add(info.rpid);
    found++;
    if (!config.enableAI && !config.enableBlacklist) return;

    // 本地预过滤：跳过明显低价值评论，节省 AI token
    if (config.enableAI && skipAI(info)) return;

    pendingBatch.push(info);
  });

  if (found > 0) {
    // 凑够 15 条立刻发，减少 API 调用次数（System Prompt 重复发送是主要token开销）
    if (pendingBatch.length >= 15) flushBatch();
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

  log(TAG, `AI judging: ${batch.length} 条评论`);

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
      log(TAG, ` ${result.violations.size}/${batch.length} 条违规`);
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
    console.error(TAG, "AI failure:", err);
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
  log(TAG, " MutationObserver 已绑定到评论根节点");

  // 绑定后立即扫描一次（评论可能已存在但 observer 尚未触发）
  scanPage();
}

/** 滚动加载检测 */
function watchScrollLoading(): void {
  let scrollTimer: ReturnType<typeof setTimeout> | null = null;
  window.addEventListener(
    "scroll",
    () => {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        scanPage();
        if (pendingBatch.length >= 15) flushBatch();
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

  // 周期性扫描 (每3秒)
  setInterval(() => {
    scanPage();
    if (pendingBatch.length >= 15) flushBatch();
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
