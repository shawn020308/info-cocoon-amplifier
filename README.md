<p align="center">
  <img src="https://img.shields.io/badge/状态-能用就行-brightgreen?style=flat-square" alt="status" />
  <img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="license" />
  <img src="https://img.shields.io/badge/PR-welcome-ff69b4?style=flat-square" alt="pr" />
  <img src="https://img.shields.io/badge/信息茧房-放大器-purple?style=flat-square" alt="cocoon" />
</p>

<h1 align="center">🧠 信息茧房放大器</h1>
<h3 align="center"><i>Info Cocoon Amplifier — 看不见就不存在。</i></h3>

<p align="center">
  <sub>AI 驱动的 B 站降智评论过滤器 · 一个 Tampermonkey 脚本 · 由 DeepSeek 提供智能判定</sub>
</p>

---

<p align="center">
  <a href="#-中文">🇨🇳 中文</a> &nbsp;|&nbsp;
  <a href="#-english">🇺🇸 English</a> &nbsp;|&nbsp;
  <a href="#-日本語">🇯🇵 日本語</a> &nbsp;|&nbsp;
  <a href="#-한국어">🇰🇷 한국어</a>
</p>

---

## 🇨🇳 中文

### 💬 作者的话

你是否厌倦了大数据总给你推送那些争议性极大，让你迅速上火的视频？是否懒得在评论区跟满嘴喷粪的人争论半句？

开启这个插件，把评论区变成你的私人信息茧房——看不见，就不存在。

> 本插件仅图一乐，切莫认真。**我即算法，我即茧房。**
>
> 遵循 MIT 开源协议，欢迎 fork 修改。

### ✨ 特性

| 功能 | 说明 |
|------|------|
| 🔍 纯 DOM 扫描 | 遍历评论区 Shadow DOM，不做网络拦截，不依赖 B 站 API |
| 🤖 AI 判定 | DeepSeek API 批量判定，带视频标题/简介上下文 |
| 📋 本地黑名单 | IndexedDB 持久化，block / high 级别自动拉黑，以用户名 hash 为 key |
| 🔄 智能缓存 | LRU 缓存 24h 过期，避免重复 API 调用 |
| 👁️ 折叠模式 | 违规评论折叠显示，点开可查看 AI 判定原因（支持开关） |
| 📊 统计面板 | Token 消耗、预估费用、违规严重度分布 |
| ⚙️ 自定义 Prompt | 自由编写过滤规则，支持/反对立场可直接写进 Prompt |
| 💰 自定义计费 | 支持任意模型的价格设定 |
| 🛡️ 滚动拦截 | MutationObserver + scroll 双重监听，翻页/加载更多不漏 |

### 📦 安装

```bash
git clone https://github.com/<your-name>/ruozhi-filter.git
cd ruozhi-filter
npm install
npm run build
```

将 `dist/ruozhi-filter.user.js` 拖入 Tampermonkey / Violentmonkey。

### 🚀 使用

1. 打开任意 B 站视频页面
2. 点击右下角 🧠 悬浮按钮 → 打开设置面板
3. 填入 **DeepSeek API Key**，自定义 Prompt
4. 保存设置，滚动到评论区 → 自动扫描 & 过滤
5. 切换到 **📊 统计** 标签查看 token 消耗
6. 控制台执行 `__ruozhi_diag()` 查看诊断信息

### 📝 Prompt 示例

```
请帮我识别以下评论中，具有明显性别对立、引战、人身攻击、煽动性、仇恨言论性质的内容。
对严重违规的评论标记为 high 或 block 级别。
```

### 🛠 技术栈

`TypeScript` · `Vite` · `vite-plugin-monkey` · `IndexedDB (idb)` · `DeepSeek API`

---

## 🇺🇸 English

### 💬 From the Author

Tired of algorithmic feeds shoving rage-bait down your throat? Sick of wading through comment sections full of personal attacks and brain-rot takes?

Flip the switch. Turn the comment section into your private info cocoon — if you can't see it, it doesn't exist.

> This plugin is for entertainment only. **I am the algorithm. I am the cocoon.**
>
> MIT Licensed. Fork freely.

### ✨ Features

| Feature | Description |
|---------|-------------|
| 🔍 Pure DOM Scan | Traverses comment Shadow DOM directly — no network interception |
| 🤖 AI Judgment | Batch-evaluates via DeepSeek API with video context |
| 📋 Local Blacklist | IndexedDB persistence, auto-blocks block/high severity users by username hash |
| 🔄 Smart Cache | LRU cache with 24h expiry, saves tokens |
| 👁️ Fold Mode | Violating comments folded behind a clickable bar showing AI reasoning |
| 📊 Stats Panel | Token usage, cost estimate, violation severity breakdown |
| ⚙️ Custom Prompt | Write your own filtering criteria |
| 💰 Custom Pricing | Set your model's per-token price |
| 🛡️ Scroll Detection | MutationObserver + scroll listener, catches lazy-loaded comments |

### 📦 Install

```bash
git clone https://github.com/<your-name>/ruozhi-filter.git
cd ruozhi-filter
npm install
npm run build
```

Drag `dist/ruozhi-filter.user.js` into Tampermonkey / Violentmonkey.

### 🚀 Usage

1. Open any Bilibili video page
2. Click the 🧠 floating button (bottom-right) → opens settings panel
3. Enter your **DeepSeek API Key** and custom prompt
4. Save settings, scroll to comments → auto-scan & filter
5. Switch to **📊 Stats** tab to check token consumption
6. Run `__ruozhi_diag()` in console for diagnostics

### 📝 Prompt Example

```
Identify comments containing: gender antagonism, trolling,
personal attacks, low-quality煽动性 rhetoric, or hate speech.
Mark severe violations as "high" or "block" severity.
```

### 🛠 Tech Stack

`TypeScript` · `Vite` · `vite-plugin-monkey` · `IndexedDB (idb)` · `DeepSeek API`

---

## 🇯🇵 日本語

### 💬 作者より

炎上商法の動画ばかりレコメンドされるのにうんざりしていませんか？誹謗中傷だらけのコメント欄で言い争うのに疲れていませんか？

スイッチを入れましょう。コメント欄をあなただけの情報の繭（まゆ）に——見えなければ、存在しないのと同じです。

> このプラグインはネタです。**私がアルゴリズム、私が繭。**
>
> MIT ライセンス。フォーク歓迎。

### ✨ 機能

| 機能 | 説明 |
|------|------|
| 🔍 DOM 直接スキャン | コメント欄の Shadow DOM を直接走査、ネットワーク傍受なし |
| 🤖 AI 判定 | DeepSeek API でバッチ判定、動画タイトル・概要をコンテキストとして送信 |
| 📋 ローカルBL | IndexedDB 永続化、block/high レベルをユーザー名ハッシュで自動ブロック |
| 🔄 スマートキャッシュ | LRU キャッシュ 24h 有効、API 重複呼び出し防止 |
| 👁️ 折りたたみ | 違反コメントは削除せず折りたたみ、クリックで AI 判定理由を表示 |
| 📊 統計 | トークン消費量・推定コスト・深刻度分布 |
| ⚙️ カスタムプロンプト | フィルタリング基準を自由に記述 |
| 💰 カスタム料金 | 任意モデルのトークン単価を設定 |
| 🛡️ スクロール検出 | MutationObserver + scroll イベントで遅延読み込みにも対応 |

### 📦 インストール

```bash
git clone https://github.com/<your-name>/ruozhi-filter.git
cd ruozhi-filter
npm install
npm run build
```

`dist/ruozhi-filter.user.js` を Tampermonkey / Violentmonkey に D&D。

### 🚀 使い方

1. Bilibili の動画ページを開く
2. 右下 🧠 ボタン → 設定パネル
3. **DeepSeek API キー**とプロンプトを入力
4. 設定を保存、コメント欄までスクロール
5. **📊 統計** タブでトークン使用量を確認
6. コンソールで `__ruozhi_diag()` を実行して診断

### 📝 プロンプト例

```
以下のコメントから、性別対立・扇動・個人攻撃・
低品質なヘイト発言を検出してください。
深刻な違反は "high" または "block" でマーク。
```

### 🛠 技術スタック

`TypeScript` · `Vite` · `vite-plugin-monkey` · `IndexedDB (idb)` · `DeepSeek API`

---

## 🇰🇷 한국어

### 💬 개발자 한마디

알고리즘이 자꾸 어그로 영상만 추천해줘서 열받은 적 있나요? 인신공격과 쓰레기 댓글 투성이인 댓글창에서 논쟁하기 싫지 않나요?

스위치를 켜세요. 댓글창을 당신만의 정보 고치(繭)로 — 보이지 않으면 존재하지 않는 겁니다.

> 이 플러그인은 그냥 재미로 만든 겁니다. **내가 곧 알고리즘, 내가 곧 고치.**
>
> MIT 라이선스. 포크 환영.

### ✨ 기능

| 기능 | 설명 |
|------|------|
| 🔍 DOM 직접 스캔 | 댓글 Shadow DOM 직접 탐색, 네트워크 가로채기 없음 |
| 🤖 AI 판단 | DeepSeek API로 일괄 평가, 영상 제목·설명을 컨텍스트로 전송 |
| 📋 로컬 블랙리스트 | IndexedDB 저장, block/high 레벨 사용자명 해시로 자동 차단 |
| 🔄 스마트 캐시 | LRU 캐시 24시간 유효, 중복 API 호출 방지 |
| 👁️ 접기 모드 | 위반 댓글을 삭제하지 않고 접어서 표시, 클릭 시 AI 판단 사유 표시 |
| 📊 통계 패널 | 토큰 사용량·예상 비용·심각도 분포 |
| ⚙️ 커스텀 프롬프트 | 필터링 기준 자유롭게 작성 |
| 💰 커스텀 과금 | 모델별 토큰 단가 설정 가능 |
| 🛡️ 스크롤 감지 | MutationObserver + scroll 이벤트로 지연 로딩 댓글도 포착 |

### 📦 설치

```bash
git clone https://github.com/<your-name>/ruozhi-filter.git
cd ruozhi-filter
npm install
npm run build
```

`dist/ruozhi-filter.user.js` 파일을 Tampermonkey / Violentmonkey 에 드래그.

### 🚀 사용법

1. Bilibili 동영상 페이지 열기
2. 우측 하단 🧠 버튼 → 설정 패널
3. **DeepSeek API 키**와 프롬프트 입력
4. 설정 저장 후 댓글 영역으로 스크롤
5. **📊 통계** 탭에서 토큰 사용량 확인
6. 콘솔에서 `__ruozhi_diag()` 실행하여 진단

### 📝 프롬프트 예시

```
다음 댓글에서 성별 대립·선동·개인 공격·
저품질 혐오 발언을 감지해 주세요.
심각한 위반은 "high" 또는 "block"으로 표시.
```

### 🛠 기술 스택

`TypeScript` · `Vite` · `vite-plugin-monkey` · `IndexedDB (idb)` · `DeepSeek API`

---

<p align="center">
  <sub>Made with ❤️‍🔥 and a healthy dose of misanthropy.</sub>
</p>

## 📄 License

MIT © 2024
