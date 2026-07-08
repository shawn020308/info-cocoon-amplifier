// ============================================================
// globals.d.ts - 声明 Tampermonkey/Violentmonkey API
// ============================================================

declare function GM_getValue(key: string, defaultValue?: string): string;
declare function GM_setValue(key: string, value: string): void;
declare function GM_deleteValue(key: string): void;
declare const unsafeWindow: Window & typeof globalThis;

// ============================================================
// GM_xmlhttpRequest 类型声明
// ============================================================
interface GMXMLHttpRequestOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  data?: string;
  responseType?: "" | "json" | "blob" | "arraybuffer" | "document" | "text" | "stream";
  onload?: (response: GMXMLHttpRequestResult) => void;
  onerror?: (response: GMXMLHttpRequestResult) => void;
  ontimeout?: () => void;
  onabort?: () => void;
  timeout?: number;
  overrideMimeType?: string;
  anonymous?: boolean;
  fetch?: boolean;
  user?: string;
  password?: string;
}

interface GMXMLHttpRequestResult {
  response: unknown;
  responseText: string;
  responseHeaders: string;
  status: number;
  statusText: string;
  readyState: number;
  finalUrl: string;
}

declare function GM_xmlhttpRequest(options: GMXMLHttpRequestOptions): void;
