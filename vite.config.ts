import { defineConfig } from "vite";
import monkey from "vite-plugin-monkey";

export default defineConfig({
  plugins: [
    monkey({
      entry: "src/main.ts",
      userscript: {
        name: "信息茧房放大器 - B站降智评论过滤器",
        namespace: "ruozhi-filter",
        version: "0.4.2",
        description: "AI驱动：自动识别并折叠B站评论区中的降智/引战言论",
        author: "ruozhi-filter",
        match: ["*://www.bilibili.com/video/*"],
        grant: ["GM_getValue", "GM_setValue", "GM_deleteValue", "unsafeWindow"],
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
