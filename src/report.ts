// ============================================================
// report.ts - 举报联动: 触发原生举报弹窗 + 复制AI理由
// ============================================================

const TAG = "[ruozhi-filter]";
import { log, warn } from "./debug";

async function copyToClipboard(text: string): Promise<boolean> {
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

function findByText(root: ParentNode, text: string): Element | null {
  const walk = (node: ParentNode): Element | null => {
    for (const child of node.children) {
      const el = child as HTMLElement;
      if ((el.innerText?.trim() || el.textContent?.trim() || "") === text)
        return el;
      if ((el as Element).shadowRoot) {
        const f = walk((el as Element).shadowRoot!);
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
    root instanceof Element ? ((root as Element).shadowRoot ?? root) : root,
  );
}

function showToast(msg: string, d = 2500): void {
  const t = document.createElement("div");
  t.textContent = msg;
  Object.assign(t.style, {
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
    transition: "opacity 0.3s",
  });
  document.body.appendChild(t);
  setTimeout(() => {
    t.style.opacity = "0";
    setTimeout(() => t.remove(), 300);
  }, d);
}

function waitFor(cb: () => boolean, ms: number): Promise<boolean> {
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

function deepFind(root: ParentNode, sel: string): Element | null {
  const e = root.querySelector(sel);
  if (e) return e;
  for (const c of root.children) {
    const ce = c as Element;
    if (ce.shadowRoot) {
      const f = deepFind(ce.shadowRoot, sel);
      if (f) return f;
    }
  }
  return null;
}

/** 查找评论渲染器容器（宿主演进） */
function findCommentRenderer(el: HTMLElement): HTMLElement {
  const rootNode = el.getRootNode();
  const shadowHost =
    rootNode instanceof ShadowRoot ? (rootNode.host as HTMLElement) : null;

  // 情况1: host 本身就是 comment renderer（el 在它的 shadow 内）
  if (
    shadowHost &&
    shadowHost.tagName.toLowerCase().includes("comment-renderer")
  ) {
    return shadowHost;
  }

  // 情况2: host 是 bili-comments 容器，renderer 在同一 shadow tree 内
  const found =
    (el.closest("bili-comment-renderer") as HTMLElement) ??
    (el.closest("bili-comment-thread-renderer") as HTMLElement);
  if (found) return found;

  // 情况3: 都没有，返回原始元素
  return el;
}

export async function triggerReport(
  commentEl: Element,
  reason: string,
): Promise<{ opened: boolean; reasonCopied: boolean }> {
  const reasonCopied = await copyToClipboard(reason);
  if (reasonCopied) showToast("✅ 已复制 AI 判定理由，请粘贴到举报框 (Cmd+V)");

  const renderer = findCommentRenderer(commentEl as HTMLElement);
  console.log(
    TAG,
    "🔍 评论容器:",
    renderer.tagName.toLowerCase(),
    "| shadowRoot:",
    !!renderer.shadowRoot,
    "| children:",
    renderer.shadowRoot?.children.length ?? 0,
  );

  const prevDisplay = renderer.style.display;
  renderer.style.display = "";
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));

  try {
    const sr = renderer.shadowRoot;
    if (!sr) {
      warn(TAG, "⚠️ 无 shadowRoot:", renderer.tagName);
      return { opened: false, reasonCopied };
    }

    const actionBar = deepFind(sr, "bili-comment-action-buttons-renderer");
    if (!actionBar || !(actionBar as HTMLElement).shadowRoot) {
      console.warn(
        TAG,
        "⚠️ 未找到 action-buttons",
        "| 子元素:",
        [...sr.children].map((c) => (c as HTMLElement).tagName.toLowerCase()),
      );
      return { opened: false, reasonCopied };
    }

    const actionSR = (actionBar as HTMLElement).shadowRoot!;
    const moreBtn = actionSR.querySelector(
      "#more button",
    ) as HTMLElement | null;
    if (!moreBtn) {
      warn(TAG, "⚠️ 未找到「更多」按钮");
      return { opened: false, reasonCopied };
    }

    log(TAG, "🔍 点击「更多」...");
    moreBtn.click();

    const ok = await waitFor(() => {
      const m = actionSR.querySelector(
        "bili-comment-menu",
      ) as HTMLElement | null;
      return !!(
        m?.shadowRoot &&
        (m.getAttribute("style") || "").includes(
          "--bili-comment-menu-display:block",
        )
      );
    }, 2000);
    if (!ok) {
      warn(TAG, "⚠️ 菜单未显示");
      return { opened: false, reasonCopied };
    }

    const menuEl = actionSR.querySelector("bili-comment-menu") as HTMLElement;
    const reportLi = findByText(
      menuEl.shadowRoot!,
      "举报",
    ) as HTMLElement | null;
    if (!reportLi) {
      warn(TAG, "⚠️ 菜单中未找到「举报」");
      return { opened: false, reasonCopied };
    }

    log(TAG, "🔍 点击「举报」...");
    reportLi.click();
    waitAndFillReportForm(reason);
    log(TAG, "✅ 已触发原生举报");
    return { opened: true, reasonCopied };
  } finally {
    renderer.style.display = prevDisplay;
  }
}

function waitAndFillReportForm(reason: string): void {
  const s = Date.now();
  let n = 0;
  const f = () => {
    n++;
    const popup = document.querySelector("bili-comments-popup");
    if (!popup) {
      if (Date.now() - s < 4000) setTimeout(f, 200);
      return;
    }
    const form = popup.querySelector("bili-comment-report-form");
    if (!form || !(form as HTMLElement).shadowRoot) {
      if (Date.now() - s < 4000) setTimeout(f, 200);
      return;
    }
    const sr = (form as HTMLElement).shadowRoot!;

    if (n <= 2) {
      for (const opt of sr.querySelectorAll("#option")) {
        const nameEl = opt.querySelector("#option-name");
        if (nameEl && (nameEl as HTMLElement).innerText?.includes("引战")) {
          const radio = opt.querySelector("bili-radio");
          if (radio && (radio as HTMLElement).shadowRoot) {
            const sp = (radio as HTMLElement).shadowRoot!.querySelector(
              "#input",
            ) as HTMLElement | null;
            if (sp) {
              sp.click();
              log(TAG, "✅ 已选中「引战、不友善言论」");
              break;
            }
          }
          const inp = opt.querySelector(
            'input[type="radio"][value="4"]',
          ) as HTMLElement | null;
          if (inp) {
            inp.click();
            break;
          }
        }
      }
      setTimeout(f, 300);
      return;
    }

    const ta = sr.querySelector(
      "textarea[maxlength='200']",
    ) as HTMLTextAreaElement | null;
    if (ta) {
      ta.value = reason.slice(0, 200);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      ta.dispatchEvent(new Event("change", { bubbles: true }));
      log(TAG, "✅ 已自动填写举报理由");
      return;
    }
    if (Date.now() - s < 4000) setTimeout(f, 300);
  };
  setTimeout(f, 600);
}

export async function copyReason(reason: string): Promise<boolean> {
  const ok = await copyToClipboard(reason);
  if (ok) showToast("✅ 已复制 AI 判定理由，请粘贴到举报框 (Cmd+V)");
  return ok;
}
