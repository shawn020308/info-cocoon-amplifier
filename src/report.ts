// ============================================================
// report.ts - 举报联动: 触发原生举报弹窗 + 复制AI理由
// ============================================================

const TAG = "[ruozhi-filter]";

/** 复制文本到剪贴板 */
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

/** 查找包含指定文本的元素（shadow DOM 递归） */
function findByText(root: ParentNode, text: string): Element | null {
  const walk = (node: ParentNode): Element | null => {
    for (const child of node.children) {
      const el = child as HTMLElement;
      const t = el.innerText?.trim() || el.textContent?.trim() || "";
      if (t === text) return el;
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
    root instanceof Element ? ((root as Element).shadowRoot ?? root) : root,
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
 *
 * 关键: foldEl 将原评论元素设为 display:none，此时 shadow DOM 内
 * .click() 不会触发浏览器 UI。必须临时恢复 display 等待重排。
 */
export async function triggerReport(
  commentEl: Element,
  reason: string,
): Promise<{ opened: boolean; reasonCopied: boolean }> {
  const reasonCopied = await copyToClipboard(reason);
  if (reasonCopied) {
    showToast("✅ 已复制 AI 判定理由，请粘贴到举报框 (Cmd+V)");
  }

  const el = commentEl as HTMLElement;
  const prevDisplay = el.style.display;

  // ★ 恢复可见 + 等浏览器重排
  el.style.display = "";
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));

  try {
    const sr = el.shadowRoot;
    if (!sr) {
      console.warn(TAG, "⚠️ 评论元素无 shadowRoot");
      return { opened: false, reasonCopied };
    }

    // ── 找到 "更多" → 点击 ──
    const actionBar = sr.querySelector("bili-comment-action-buttons-renderer");
    if (!actionBar || !(actionBar as HTMLElement).shadowRoot) {
      console.warn(TAG, "⚠️ 未找到 action-buttons");
      return { opened: false, reasonCopied };
    }
    const actionSR = (actionBar as HTMLElement).shadowRoot!;
    const moreBtn = actionSR.querySelector(
      "#more button",
    ) as HTMLElement | null;
    if (!moreBtn) {
      console.warn(TAG, "⚠️ 未找到「更多」按钮");
      return { opened: false, reasonCopied };
    }

    console.log(TAG, "🔍 点击「更多」...");
    moreBtn.click();

    // ── 等待菜单出现（B站通过 inline style CSS 变量控制）──
    const menuAppeared = await waitFor(() => {
      const m = actionSR.querySelector(
        "bili-comment-menu",
      ) as HTMLElement | null;
      if (!m || !m.shadowRoot) return false;
      return (m.getAttribute("style") || "").includes(
        "--bili-comment-menu-display:block",
      );
    }, 2000);

    if (!menuAppeared) {
      console.warn(TAG, "⚠️ 菜单未显示");
      return { opened: false, reasonCopied };
    }

    // ── 点击「举报」──
    const menuEl = actionSR.querySelector("bili-comment-menu") as HTMLElement;
    const reportLi = findByText(
      menuEl.shadowRoot!,
      "举报",
    ) as HTMLElement | null;
    if (!reportLi) {
      console.warn(TAG, "⚠️ 菜单中未找到「举报」");
      return { opened: false, reasonCopied };
    }
    console.log(TAG, "🔍 点击「举报」...");
    reportLi.click();

    // ── 等待举报弹窗渲染，填入理由 ──
    waitAndFillReportForm(reason);

    console.log(TAG, "✅ 已触发原生举报");
    return { opened: true, reasonCopied };
  } finally {
    el.style.display = prevDisplay;
  }
}

/**
 * 轮询等待 <bili-comments-popup> 弹窗出现，
 * 选中「引战、不友善言论」radio，自动填入 AI 理由。
 *
 * DOM 路径：
 *   document → bili-comments-popup (light DOM)
 *     → children: bili-comment-report-form (light DOM)
 *       → shadowRoot → #form → #main → #options → #option
 *         → textarea[data-key="4"]   (引战、不友善言论)
 */
function waitAndFillReportForm(reason: string): void {
  const start = Date.now();
  const MAX_WAIT = 4000;
  const TRIES = 30;
  let attempts = 0;

  const tryFill = () => {
    attempts++;

    // 1) 找到弹窗
    const popup = document.querySelector("bili-comments-popup");
    if (!popup) {
      if (Date.now() - start < MAX_WAIT) {
        setTimeout(tryFill, 200);
      }
      return;
    }

    // 2) 在弹窗的 light DOM 中找到 report form
    const form = popup.querySelector("bili-comment-report-form");
    if (!form || !(form as HTMLElement).shadowRoot) {
      if (Date.now() - start < MAX_WAIT) {
        setTimeout(tryFill, 200);
      }
      return;
    }

    const formSR = (form as HTMLElement).shadowRoot!;

    // 3) 先点击「引战、不友善言论」radio (value=4)
    //    否则对应的 textarea 是隐藏的
    if (attempts <= 2) {
      // 通过 bili-radio 组件的 shadow DOM 找到 <input type="radio" value="4">
      const allOptions = formSR.querySelectorAll("#option");
      for (const opt of allOptions) {
        const nameEl = opt.querySelector("#option-name");
        if (nameEl && (nameEl as HTMLElement).innerText?.includes("引战")) {
          // 找到 bili-radio → shadowRoot → span#input → click
          const radio = opt.querySelector("bili-radio");
          if (radio && (radio as HTMLElement).shadowRoot) {
            const inputSpan = (radio as HTMLElement).shadowRoot!.querySelector(
              "#input",
            ) as HTMLElement | null;
            if (inputSpan) {
              inputSpan.click();
              console.log(TAG, "✅ 已选中「引战、不友善言论」");
              break;
            }
          }
          // fallback: 直接点击 radio 的 input
          const input = opt.querySelector(
            'input[type="radio"][value="4"]',
          ) as HTMLElement | null;
          if (input) {
            input.click();
            break;
          }
        }
      }
      // 等 B站渲染出 textarea
      setTimeout(tryFill, 300);
      return;
    }

    // 4) 找到 textarea 并填入理由
    const textarea = formSR.querySelector(
      "textarea[maxlength='200']",
    ) as HTMLTextAreaElement | null;
    if (textarea) {
      textarea.value = reason.slice(0, 200);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
      console.log(TAG, "✅ 已自动填写举报理由");
      return;
    }

    if (Date.now() - start < MAX_WAIT) {
      setTimeout(tryFill, 300);
    }
  };

  setTimeout(tryFill, 600);
}

/** 仅复制理由到剪贴板 */
export async function copyReason(reason: string): Promise<boolean> {
  const ok = await copyToClipboard(reason);
  if (ok) showToast("✅ 已复制 AI 判定理由，请粘贴到举报框 (Cmd+V)");
  return ok;
}
