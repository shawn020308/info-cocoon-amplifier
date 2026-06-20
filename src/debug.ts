// ============================================================
// debug.ts - 开发者模式日志门控
// ============================================================

let _devMode = false;

export function setDevMode(v: boolean): void {
  _devMode = v;
}

export function isDev(): boolean {
  return _devMode;
}

/** 开发模式下才输出的日志 */
export function log(tag: string, ...args: unknown[]): void {
  if (_devMode) console.log(tag, ...args);
}

/** 开发模式下才输出的警告 */
export function warn(tag: string, ...args: unknown[]): void {
  if (_devMode) console.warn(tag, ...args);
}
