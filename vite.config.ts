import { defineConfig } from "vite";
import monkey from "vite-plugin-monkey";

export default defineConfig({
  plugins: [
    monkey({
      entry: "src/main.ts",
      userscript: {
        name: "信息茧房放大器 - B站降智评论过滤器",
        namespace: "ruozhi-filter",
        version: "0.3.1",
        description: "AI驱动：自动识别并折叠B站评论区中的降智/引战言论",
        author: "ruozhi-filter",
        match: ["*://www.bilibili.com/video/*"],
        grant: ["GM_getValue", "GM_setValue", "GM_deleteValue", "unsafeWindow"],
        license: "MIT",
      },
      build: {
        fileName: "ruozhi-filter.user.js",
        autoGrant: true,
      },
    }),
  ],
});
