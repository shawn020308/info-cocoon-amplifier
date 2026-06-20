<p align="center">
  <img src="https://img.shields.io/badge/状态-能用就行-brightgreen?style=flat-square" alt="status" />
  <img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="license" />
  <img src="https://img.shields.io/badge/PR-welcome-ff69b4?style=flat-square" alt="pr" />
  <img src="https://img.shields.io/badge/信息茧房-放大器-purple?style=flat-square" alt="cocoon" />
</p>

<h1 align="center">🧠 信息茧房放大器</h1>
<h3 align="center"><i>Info Cocoon Amplifier — 看不见就不存在。</i></h3>

<p align="center">
  <sub>AI 驱动的 B 站降智评论过滤器 · Tampermonkey 脚本 · DeepSeek 提供智能判定</sub>
</p>

---

## 💬 作者的话

你是否厌倦了大数据总给你推送那些争议性极大、让你迅速上火的视频？是否懒得在评论区跟满嘴喷粪的人争论半句？

开启这个插件，把评论区变成你的私人信息茧房——看不见，就不存在。

> 本插件仅图一乐，切莫认真。**我即算法，我即茧房。**
>
> 遵循 MIT 开源协议，欢迎 fork 修改。

---

## ✨ 特性

| 功能 | 说明 |
|------|------|
| 🔍 纯 DOM 扫描 | 遍历评论区 Shadow DOM，不做网络拦截，不依赖 B 站 API |
| 🤖 AI 判定 | DeepSeek API 批量判定，带视频标题/简介上下文，最多 20 条/批 |
| 🧠 AI 自我学习 | 用户"取消拉黑"/"误判展开"/"手动拉黑"自动累积纠正，攒够 20 条 AI 生成过滤画像，持续迭代 |
| 📚 知识库 | 手动添加语境知识（如"XX是对XX的歧视性称呼"），注入 System Prompt 辅助判定反讽/引用 |
| 🎯 用户画像 | AI 生成 300 字过滤画像（应过滤/应放过/立场），优先级高于基础规则，支持手动编辑 + 一键重新生成 |
| 🚫 手动拉黑 | 每条评论右侧浮动圆角胶囊按钮，hover 变红，一键拉黑讨厌的用户 |
| 📋 本地黑名单 | IndexedDB 持久化，block / high 级别 AI 自动拉黑 + 用户手动拉黑，以 mid (B站UID) 为 key |
| 🔄 智能缓存 | LRU 缓存 24h 过期，自动清理，避免重复 API 调用 |
| 👁️ 折叠样式 | 三种模式可选：⚠️ 经典黄底警告 / ▎**极简灰线弱提示** / 🚫 完全隐藏 |
| 📊 统计面板 | 扫描数、过滤数、Token 消耗、预估费用、违规严重度分布、AI学习记录统计 |
| ⚙️ 自定义 Prompt | 自由编写过滤规则，支持/反对立场可直接写进 Prompt |
| 💰 自定义计费 | 支持任意模型的 Token 单价设定，精确费用估算 |
| 🔐 请求内容控制 | 可独立开关：附带用户名 / 附带用户ID / 附带视频简介，节省 Token |
| 🛡️ 滚动拦截 | MutationObserver + scroll 双重监听，翻页 / 加载更多 / 切换排序不漏评论 |

---

## 📸 截图

### 设置面板 & 统计

![设置面板](assets/main-panel.png)

### 黑名单管理

![统计面板](assets/count-panel.png)

---

## 📦 安装

```bash
git clone <repo-url>
cd ruozhi-filter
npm install
npm run build
```

将 `dist/ruozhi-filter.user.js` 拖入 Tampermonkey / Violentmonkey 即可。

---

## 🚀 使用

1. 打开任意 B 站视频页面
2. 点击右下角 🧠 悬浮按钮 → 打开设置面板
3. 填入 **DeepSeek API Key**，自定义 Prompt
4. 保存设置，滚动到评论区 → 自动扫描 & 过滤
5. 在设置中选择折叠样式：
   - ▎**极简标记**（推荐）— 灰线弱提示，不抢夺阅读注意力
   - ⚠️ 经典警告 — 黄底醒目提示，一眼可见
   - 🚫 完全隐藏 — 直接移除评论，眼不见为净
6. 点击评论旁的 `🚫 拉黑` 按钮可手动屏蔽用户（圆角胶囊按钮，hover 变红）
7. **AI 自我学习**：频繁使用"取消拉黑"、"误判展开"、"手动拉黑"，AI 会自动学习你的偏好
8. 切换到 **🧠 学习** 标签查看 AI 生成的过滤画像，可手动编辑或点击 **🔄 重新生成**
9. 切换到 **📚 知识库** 标签添加语境知识，辅助 AI 判断反讽/特定称呼
10. 切换到 **📊 统计** 标签查看 Token 消耗与费用估算
11. 切换到 **📋 黑名单** 标签管理拉黑记录，可单条移除或一键清空
12. 控制台执行 `__ruozhi_diag()` 查看诊断信息

---

## ⚙️ 配置项详解

### 🔑 API 配置

- **API Key**：DeepSeek API 密钥（必填，否则 AI 判定不工作）
- **API 地址**：默认 `https://api.deepseek.com/chat/completions`，兼容任意 OpenAI 兼容接口

### 📝 Prompt & 判定维度

- **过滤规则 Prompt**：自由编写，告诉 AI 你要过滤什么。示例见下方
- **违规判定维度**：可编辑的维度列表，每条一行 markdown 格式。AI 会严格按照这些维度判定

### 👁️ 折叠样式

| 模式 | 效果 | 适用场景 |
|------|------|----------|
| ▎ 极简标记 | 左边 3px 细色线（按严重度分色），12px 灰字，`#fafafa` 背景 | 不想被标注干扰，保持阅读流畅 |
| ⚠️ 经典警告 | Bootstrap warning 黄底深棕字 | 需要醒目标识每条违规 |
| 🚫 完全隐藏 | 直接从 DOM 移除，不可见 | 彻底净化评论区 |

### 💰 Token 控制

- **Token 单价**：自定义每百万 Token 价格，用于费用估算
- **附带用户名**：关闭则不发送用户昵称，节省 Token
- **附带用户ID**：关闭则不发送用户 mid
- **附带视频简介**：关闭则不发送视频简介（最多节省 ~300 Token/批）

---

## 📝 Prompt 示例

```
请帮我识别以下评论中，具有明显性别对立、引战、人身攻击、煽动性、仇恨言论性质的内容。
对严重违规的评论标记为 high 或 block 级别。
```

---

## 🛠 技术栈

`TypeScript` · `Vite` · `vite-plugin-monkey` · `IndexedDB (idb)` · `DeepSeek API`

---

## 📄 License

MIT © 2024–2026
