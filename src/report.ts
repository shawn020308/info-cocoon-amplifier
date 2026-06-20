// ============================================================
// report.ts - 举报联动: 触发原生举报弹窗 + 复制AI理由
// ============================================================

const TAG = "[ruozhi-filter]";

/**
 * AI 严重度 → B站举报类别映射
 * B站举报 radio value:
 *   2=色情低俗  4=引战不友善  15=隐私  17=未成年  23=广告  9=涉政  22=谣言  8=刷屏  0=其他
 */
const CATEGORY_VALUE = 4; // 默认「引战、不友善言论」

/** 复制文本到剪贴板 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 降级: textarea fallback
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

/** 查找包含指定文本的元素（在 shadow DOM 中递归） */
function findElementByText(
  root: Document | ShadowRoot | Element,
  text: string,
): Element | null {
  const walk = (node: ParentNode): Element | null => {
    for (const child of node.children) {
      const el = child as HTMLElement;
      if (el.innerText?.trim() === text || el.textContent?.trim() === text) {
        return el;
      }
      if ((el as Element).shadowRoot) {
        const found = walk((el as Element).shadowRoot!);
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
    root instanceof Element
      ? (((root as Element).shadowRoot ?? root) as ParentNode)
      : root,
  );
}

/** 显示轻量 toast */
function showToast(msg: string, duration = 2500): void {
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
    transition: "opacity 0.3s",
  });
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/** 等待条件满足 */
function waitFor(checker: () => boolean, timeoutMs: number): Promise<boolean> {
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

/**
 * 触发原生举报流程
 * 1. 复制 AI 判定理由到剪贴板
 * 2. 临时恢复评论元素可见性（否则 shadow DOM 内 click 不触发 UI）
 * 3. 穿透嵌套 Shadow DOM 找到「举报」菜单项并点击
 * 4. B站举报弹窗弹出后，尝试自动填写理由
 */
export async function triggerReport(
  commentEl: Element,
  reason: string,
): Promise<{ opened: boolean; reasonCopied: boolean }> {
  // Step 1: 复制理由
  const reasonCopied = await copyToClipboard(reason);
  if (reasonCopied) {
    showToast("✅ 已复制 AI 判定理由，请粘贴到举报框 (Cmd+V)");
  }

  // Step 2: 临时恢复元素可见 — foldEl 给原始评论设了 display:none，
  //         在此状态下 shadow DOM 内的 click() 不会触发浏览器 UI 弹窗
  const el = commentEl as HTMLElement;
  const prevDisplay = el.style.display;
  el.style.display = "";

  try {
    const sr = el.shadowRoot;
    if (!sr) {
      console.warn(TAG, "⚠️ 评论元素无 shadowRoot，无法触发举报");
      return { opened: false, reasonCopied };
    }

    // 找到 action-buttons → shadowRoot → #more → button
    const actionButtons = sr.querySelector(
      "bili-comment-action-buttons-renderer",
    );
    if (!actionButtons || !(actionButtons as HTMLElement).shadowRoot) {
      console.warn(TAG, "⚠️ 未找到 action-buttons");
      return { opened: false, reasonCopied };
    }

    const actionSR = (actionButtons as HTMLElement).shadowRoot!;
    const moreBtn = actionSR.querySelector(
      "#more button",
    ) as HTMLElement | null;
    if (!moreBtn) {
      console.warn(TAG, "⚠️ 未找到「更多」按钮");
      return { opened: false, reasonCopied };
    }

    // 点击「更多」
    moreBtn.click();

    // 等待菜单变为可见（bili-comment-menu 始终在 DOM 中，点击后显示）
    const menuVisible = await waitFor(() => {
      const m = actionSR.querySelector(
        "bili-comment-menu",
      ) as HTMLElement | null;
      if (!m || !m.shadowRoot) return false;
      // 检查是否可见
      const style = getComputedStyle(m);
      return style.display !== "none" && style.visibility !== "hidden";
    }, 2000);

    if (!menuVisible) {
      console.warn(TAG, "⚠️ 菜单未显示");
      return { opened: false, reasonCopied };
    }

    // 在菜单 shadowRoot 中找到「举报」并点击
    const menuEl = actionSR.querySelector("bili-comment-menu") as HTMLElement;
    const menuSR = menuEl.shadowRoot!;
    const reportLi = findElementByText(menuSR, "举报") as HTMLElement | null;
    if (!reportLi) {
      console.warn(TAG, "⚠️ 菜单中未找到「举报」");
      return { opened: false, reasonCopied };
    }

    reportLi.click();

    // Step 3: 等待举报表单出现，尝试填写理由
    waitAndFillReportForm(reason);

    console.log(TAG, "✅ 已触发原生举报弹窗");
    return { opened: true, reasonCopied };
  } finally {
    // 恢复原始显示状态
    el.style.display = prevDisplay;
  }
}

/** 等待举报表单出现并自动填写理由 */
function waitAndFillReportForm(reason: string): void {
  const start = Date.now();
  const MAX_WAIT = 3000;

  const tryFill = () => {
    const textareas = document.querySelectorAll(
      "textarea[placeholder*='举报'], textarea[maxlength='200']",
    );

    for (const ta of textareas) {
      if ((ta as HTMLTextAreaElement).value.trim() === "") {
        (ta as HTMLTextAreaElement).value = reason.slice(0, 200);
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        ta.dispatchEvent(new Event("change", { bubbles: true }));
        console.log(TAG, "✅ 已自动填写举报理由");
        return;
      }
    }

    if (Date.now() - start < MAX_WAIT) {
      setTimeout(tryFill, 300);
    }
  };

  setTimeout(tryFill, 400);
}

/** 仅复制理由到剪贴板 */
export async function copyReason(reason: string): Promise<boolean> {
  const ok = await copyToClipboard(reason);
  if (ok) showToast("✅ 已复制 AI 判定理由，请粘贴到举报框 (Cmd+V)");
  return ok;
}
