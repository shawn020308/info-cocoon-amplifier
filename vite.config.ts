import { defineConfig } from "vite";
import monkey from "vite-plugin-monkey";

export default defineConfig({
  plugins: [
    monkey({
      entry: "src/main.ts",
      userscript: {
        name: "信息茧房放大器 - B站降智评论过滤器",
        namespace: "ruozhi-filter",
        version: "0.4.3",
        description: "AI驱动：自动识别并折叠B站评论区中的降智/引战言论",
        author: "ruozhi-filter",
        match: ["*://www.bilibili.com/video/*", "*://www.bilibili.com/list/*"],
        grant: ["GM_getValue", "GM_setValue", "GM_deleteValue", "GM_xmlhttpRequest", "unsafeWindow"],
        // @connect 白名单：仅放行预设提供商的 host。
        // 自定义 provider 的 endpoint 不在此列时，TM 首次请求会弹授权对话框，
        // 用户需手动确认；如想免弹窗，请在此处追加对应 host。
        connect: [
          "api.deepseek.com",
          "api.openai.com",
          "openrouter.ai",
          "api.groq.com",
          "opencode.ai",
          "localhost",
          "127.0.0.1",
          "api.bilibili.com",
        ],
        license: "MIT",
        updateURL:
          "https://update.greasyfork.org/scripts/583755/%E4%BF%A1%E6%81%AF%E8%8C%A7%E6%88%BF%E6%94%BE%E5%A4%A7%E5%99%A8%20-%20B%E7%AB%99%E9%99%8D%E6%99%BA%E8%AF%84%E8%AE%BA%E8%BF%87%E6%BB%A4%E5%99%A8.meta.js",
        downloadURL:
          "https://update.greasyfork.org/scripts/583755/%E4%BF%A1%E6%81%AF%E8%8C%A7%E6%88%BF%E6%94%BE%E5%A4%A7%E5%99%A8%20-%20B%E7%AB%99%E9%99%8D%E6%99%BA%E8%AF%84%E8%AE%BA%E8%BF%87%E6%BB%A4%E5%99%A8.user.js",
      },
      build: {
        fileName: "ruozhi-filter.user.js",
        autoGrant: true,
      },
    }),
  ],
});
