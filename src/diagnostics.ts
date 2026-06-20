// ============================================================
// diagnostics.ts - 页面诊断/调试函数
// ============================================================

import { log } from "./debug";

const TAG = "[ruozhi-filter]";

/** 全页面诊断：打印评论区结构信息 */
export function fullPageDiagnostic(): void {
  log(TAG, "══════ 诊断 ══════");

  // 1. 寻找 bili-comments web component
  const bc = document.querySelector("bili-comments");
  log(
    TAG,
    `📦 bili-comments: ${bc ? "✅ shadowRoot=" + !!bc.shadowRoot + " children=" + bc.children.length : "❌ 未找到"}`,
  );

  // 2. 寻找各种可能的评论区容器选择器
  const containerSelectors = [
    "#comment",
    "#commentapp",
    ".comment-container",
    ".reply-list",
    ".bb-comment",
    "[class*='comment']",
    "[class*='reply']",
    "[id*='comment']",
    "[id*='reply']",
  ];
  for (const sel of containerSelectors) {
    const els = document.querySelectorAll(sel);
    if (els.length > 0 && els.length < 200) {
      const first = els[0];
      const id = first.id ? `#${first.id}` : "(无id)";
      const cls = (first as Element).className
        ? "." + (first as Element).className.split(" ").slice(0, 3).join(".")
        : "(无class)";
      log(
        TAG,
        `  📌 "${sel}" → ${els.length}个 ${(first as Element).tagName.toLowerCase()}${id}${cls}`,
      );
    }
  }

  // 3. 🔍 ShadowRoot 深度探查
  if (bc && bc.shadowRoot) {
    const sr = bc.shadowRoot;
    const allNodes = sr.querySelectorAll("*");
    log(TAG, `🔬 ShadowRoot 总节点: ${allNodes.length}`);

    // 统计标签类型
    const tagCounts = new Map<string, number>();
    allNodes.forEach((n) => {
      const t = n.tagName.toLowerCase();
      tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    });
    log(
      TAG,
      `  标签分布: ${[...tagCounts.entries()].map(([k, v]) => `${k}x${v}`).join(", ")}`,
    );

    // 查找评论项
    const itemChecks = [
      "[data-rpid]",
      ".reply-item",
      ".comment-item",
      ".reply-wrap",
      ".con",
      "bb-comment",
    ];
    for (const sel of itemChecks) {
      const count = sr.querySelectorAll(sel).length;
      log(TAG, `  🎯 "${sel}" → ${count}个`);
    }

    // 打印 ShadowRoot 第一层子元素结构
    log(TAG, "📋 ShadowRoot 直接子元素:");
    for (const child of sr.children) {
      const tag = child.tagName.toLowerCase();
      const id = child.id ? `#${child.id}` : "";
      const cls = child.className
        ? "." + child.className.split(" ").slice(0, 3).join(".")
        : "";
      const text = (child as HTMLElement).innerText?.slice(0, 60) ?? "";
      const childCount = child.querySelectorAll("*").length;
      log(TAG, `  <${tag}${id}${cls}> 子元素:${childCount} text:"${text}"`);

      // 如果子元素少，继续展开一层
      if (childCount > 0 && childCount <= 30) {
        for (const c2 of child.children) {
          const t2 = c2.tagName.toLowerCase();
          const id2 = c2.id ? `#${c2.id}` : "";
          const cls2 = c2.className
            ? "." + c2.className.split(" ").slice(0, 2).join(".")
            : "";
          const txt2 = (c2 as HTMLElement).innerText?.slice(0, 50) ?? "";
          // 检查 data-* 属性
          const dataAttrs =
            c2 instanceof HTMLElement
              ? c2
                  .getAttributeNames()
                  .filter((a) => a.startsWith("data-"))
                  .join(", ")
              : "";
          log(
            TAG,
            `    <${t2}${id2}${cls2}>${dataAttrs ? " [" + dataAttrs + "]" : ""} "${txt2}"`,
          );
        }
      }
    }
  }

  // 4. 页面主要结构
  const mainSections = [
    "#reply",
    "#danmakuBox",
    ".player-auxiliary",
    ".video-info-container",
    ".video-data",
    "section",
  ];
  log(TAG, "📐 页面结构:");
  for (const sel of mainSections) {
    const els = document.querySelectorAll(sel);
    if (els.length > 0) log(TAG, `  ${sel}: ${els.length}个`);
  }

  log(TAG, "══════ 完成 ══════");
}

/** 手动探查函数：调用后滚动到评论区加载评论，再执行此函数 */
export function inspectShadowRoot(): void {
  const bc = document.querySelector("bili-comments");
  if (!bc || !bc.shadowRoot) {
    log(TAG, "❌ bili-comments 或其 shadowRoot 未找到");
    return;
  }
  const sr = bc.shadowRoot;
  log(TAG, "══════ ShadowRoot 完整探查 ══════");
  log(TAG, `总节点数: ${sr.querySelectorAll("*").length}`);
  log(TAG, `直接子元素数: ${sr.children.length}`);

  // 递归打印结构
  function dump(el: Element, depth: number = 0): void {
    if (depth > 4) return;
    const indent = "  ".repeat(depth);
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    const cls = el.className
      ? "." + el.className.split(" ").slice(0, 3).join(".")
      : "";
    const attrs =
      el instanceof HTMLElement
        ? el
            .getAttributeNames()
            .filter((a) => a !== "class" && a !== "id")
            .map((a) => `${a}="${el.getAttribute(a)}"`.slice(0, 60))
            .join(" ")
        : "";
    const text =
      (el as HTMLElement).innerText?.slice(0, 80)?.replace(/\n/g, " ") ?? "";
    log(TAG, `${indent}<${tag}${id}${cls}> ${attrs} "${text}"`);
    if (el.children.length <= 4) {
      for (const c of el.children) dump(c, depth + 1);
    } else if (depth < 3) {
      log(TAG, `${indent}  ... ${el.children.length}个子元素，取前4个`);
      for (let i = 0; i < Math.min(4, el.children.length); i++) {
        dump(el.children[i], depth + 1);
      }
    }
  }

  for (const child of sr.children) {
    dump(child, 0);
  }
  log(TAG, "══════ 探查完成 ══════");
}
