// ============================================================
// interceptor.ts - 桶文件（兼容导出）
//
// 此文件已模块化，职责拆分到以下模块：
//   stats.ts           - 统计数据的加载/保存/更新
//   config.ts          - 配置管理和上下文状态
//   video-info.ts      - B站视频信息提取
//   dom-utils.ts       - DOM 工具函数
//   diagnostics.ts     - 页面诊断/调试
//   comment-extractor.ts - 评论提取
//   fold-ui.ts         - 评论折叠/隐藏 UI
//   manual-blacklist.ts - 手动拉黑按钮
//   comment-scanner.ts - 扫描器核心（批处理+观察器+启动）
// ============================================================

// 重新导出 main.ts 需要的所有符号
export { setUpdateStats, resetStats, ruozhiStats } from "./stats";
export { refreshConfig, updateContext, currentContext } from "./config";
export { extractVideoInfo } from "./video-info";
export { startDOMScanner } from "./comment-scanner";
