// ============================================================
// video-info.ts - B站视频信息提取
// ============================================================
import { currentContext } from "./config";

export function extractVideoInfo(): void {
  // 获取视频标题 - B站现在的页面结构
  const titleEl =
    document.querySelector("h1.video-title") ??
    document.querySelector(".video-info-title .tit") ??
    document.querySelector("[data-title]");
  if (titleEl) {
    currentContext.videoTitle =
      (titleEl as HTMLElement).dataset?.title ??
      titleEl.getAttribute("data-title") ??
      titleEl.getAttribute("title") ??
      titleEl.textContent?.trim() ??
      "";
  }

  // 获取视频简介
  const descEl =
    document.querySelector("#v_desc .desc-info-text") ??
    document.querySelector(".desc-info-text") ??
    document.querySelector(".basic-desc-info");
  if (descEl) {
    const t = descEl.textContent?.trim() ?? "";
    currentContext.videoDesc = t === "-" ? "" : t;
  }

  // 从 bili-comments 组件获取 oid
  const bc = document.querySelector("bili-comments");
  if (bc) {
    const p = bc.getAttribute("data-params");
    if (p) {
      const pts = p.split(",");
      if (pts.length >= 2) currentContext.oid = parseInt(pts[1]) || 0;
    }
  }

  // 从 __INITIAL_STATE__ 获取 aid
  if (!currentContext.oid) {
    try {
      for (const s of document.querySelectorAll("script")) {
        const m = (s.textContent ?? "").match(
          /window\.__INITIAL_STATE__\s*=\s*(\{.+?\});/,
        );
        if (m) {
          const data = JSON.parse(m[1]);
          const aid = data?.videoData?.aid ?? data?.aid;
          if (aid) {
            currentContext.oid = aid;
            break;
          }
        }
      }
    } catch {
      /* */
    }
  }

  // 从URL提取BV号 -> 可以后续用于API查询
  if (!currentContext.oid) {
    const bvMatch = location.pathname.match(/\/video\/(BV\w+)/);
    void bvMatch;
  }
}
