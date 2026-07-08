// ============================================================
// gm-fetch.ts - GM_xmlhttpRequest 的 fetch 兼容封装
// 在 Tampermonkey 环境下绕过 CORS 限制，非 TM 环境降级原生 fetch
// ============================================================

import { log } from "./debug";

const TAG = "[ruozhi-filter/gm-fetch]";

/**
 * fetch 兼容的跨域请求函数。
 *
 * - Tampermonkey 环境 → 使用 GM_xmlhttpRequest（绕过 CORS）
 * - 非 Tampermonkey 环境 → 使用 window.fetch（标准行为）
 */
export async function gmFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  if (typeof GM_xmlhttpRequest !== "undefined") {
    return gmFetchWithXhr(url, init);
  }

  // Fallback: 非 Tampermonkey 环境
  if (typeof unsafeWindow !== "undefined") {
    log(TAG, "GM_xmlhttpRequest 不可用，回退 unsafeWindow.fetch");
    return unsafeWindow.fetch(url, init);
  }
  return fetch(url, init);
}

/**
 * 使用 GM_xmlhttpRequest 发请求，返回标准 Response 对象。
 */
function gmFetchWithXhr(url: string, init?: RequestInit): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body as string | undefined;

    GM_xmlhttpRequest({
      url,
      method,
      headers,
      data: body,
      responseType: "",
      onload: (resp) => {
        const parsedHeaders = parseResponseHeaders(resp.responseHeaders);
        resolve(
          new Response(resp.responseText, {
            status: resp.status,
            statusText: resp.statusText,
            headers: parsedHeaders,
          }),
        );
      },
      onerror: (resp) => {
        reject(
          new Error(
            `GM_xmlhttpRequest 失败: ${resp.status} ${resp.statusText}`,
          ),
        );
      },
      ontimeout: () => {
        reject(new Error("GM_xmlhttpRequest 超时"));
      },
      timeout: 60000,
    });
  });
}

/**
 * 解析 GM_xmlhttpRequest 返回的原始响应头字符串为 Headers 对象。
 */
function parseResponseHeaders(raw: string): Headers {
  const headers = new Headers();
  if (!raw) return headers;

  const pairs = raw.split("\r\n");
  for (const pair of pairs) {
    const idx = pair.indexOf(":");
    if (idx > 0) {
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      if (key && val) {
        headers.append(key, val);
      }
    }
  }
  return headers;
}
