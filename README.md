# ㄚ亮笑長的內容助手

這是一個強大且靈活的內容生產與轉換系統。主要用於將語音與影音內容（如 YouTube 直播、Podcasts、演講錄音）快速轉換為文字，並透過 AI 延伸為部落格、Google Blogger、社群、電子報與視覺提示詞素材。

目前版本：`20260804R12`

## 🌟 核心功能

本專案提供八大核心分頁功能，形成一套完整的「數位內容煉金術」工作流：

### 1. 🎙️ 語音轉文字辨識
支援 .mp3、.wav、.ogg、.m4a、.flac、.webm、.mp4；可選擇 Gemini 或自建 Cloudflare Whisper Worker，輸出 SRT、純文字與 VTT，並可匯出或送往逐字稿整理。

### 2. 📝 智慧字幕整理
可貼上或拖曳匯入字幕與逐字稿，進行標點補全、長句分拆、時間軸平移、短句合併與間隔修復；支援 AI 校對建議、爆款主題配對、摘要、章節、複製與 SRT 匯出。

### 3. ✍️ 部落格文章生成
將整理後的內容重構為文章，可設定人稱、字數、語氣與 CTA；支援多版本、Quill 編輯器、HTML／Markdown、SEO 建議、關鍵字分析、內部連結、複製與下載。

### 4. 📱 多平台社群貼文
一次生成 Facebook、Instagram、LINE 三種平台文案，可設定目標、長度、語氣、Hashtags 與 CTA，並支援社群風格精靈、多版本與複製。

### 5. ✉️ 行銷電子報
依目標受眾與風格生成包含主旨、重點與 CTA 按鈕的 HTML 電子報，支援多版本與 HTML 複製。

### 6. 🎨 社群輪播圖規劃
專為 IG／FB 多圖輪播打造，可設定素材／角色、Logo、版型與視覺風格，輸出每一頁的中英文繪圖提示詞，支援多版本與全部複製。

### 7. 📊 資訊圖表規劃
分析內容並推薦圖表型態，可設定視覺風格、配色、比例、文字量與素材／角色，輸出中英文提示詞，支援多版本與複製。

### 8. 🎬 YouTube 封面提示詞
從內容或爆款主題配對產生繁中主標題、副標題與固定六段結構的 16:9 繪圖提示詞；支援角色／素材、Logo、鏡頭、藝術風格、多版本與複製。

## 🚀 部署與執行

### 開發環境
本專案為基於 Vite 的前端專案，無須架設複雜的後端資料庫。

1. 安裝相依套件：
   ```bash
   npm install
   ```
2. 啟動開發伺服器：
   ```bash
   npm run dev
   ```
3. 打包專案：
   ```bash
   npm run build
   ```

### 部署 Cloudflare Whisper Worker (進階功能)
為了更精準地辨識超長時數的語音檔，您可以免費部署專屬的 Cloudflare Worker 來充當 Whisper API 中繼站。請參閱 `cf-worker/README.md` 的詳細教學，只要五分鐘就能建立專屬的語音伺服器。

### Google Blogger 發佈整合（選用）

「部落格文章」分頁可透過 Google Blogger API 建立草稿或直接發佈。每位使用者以自己的 Google 帳號授權並選擇可使用的網誌；可先從全域設定的「Blogger 連線」完成連結與預設網誌設定，也可以在發佈時依導引完成。

1. 在 Google Cloud 建立專案並啟用 Blogger API v3。
2. 設定 OAuth consent screen，建立 Web application OAuth Client ID。
3. 將 `http://localhost:5179` 與正式網站 HTTPS 網域加入 Authorized JavaScript origins。
4. 複製 `.env.example` 為 `.env.local`，填入：

   ```text
   VITE_GOOGLE_BLOGGER_CLIENT_ID=你的 OAuth Client ID
   ```

5. 本機重新啟動 Vite 或重新建置；Cloudflare Pages 則分別在 Preview／Production 環境設定同名變數，再重新部署。

程式只在瀏覽器記憶體中保存短期 access token，不會把 Google Token 寫入 `localStorage`。文章標題、HTML 內容與標籤會自動送出；永久網址與搜尋說明請到 Blogger 後台設定。同一文章版本再次發佈時會更新原文章，預設先建立草稿；若選擇直接發佈，系統會建立草稿後立即公開。

## 🔐 隱私與安全性

- **瀏覽器端設定**：Gemini API Key 與 Cloudflare Worker 設定依保存期限存於 localStorage 或 Session Storage；請勿在共用電腦選擇永久保存。
- **Blogger 授權安全**：Blogger access token 只存在目前頁面的記憶體，不會寫入 localStorage，也不會上傳到本專案伺服器。
- **邊緣運算選項**：使用自建 Cloudflare Worker 處理語音時，資料會送至您設定的 Cloudflare 帳戶；請依自己的隱私需求選擇 Gemini 或 Whisper。

## 📜 關於

Design by [ㄚ亮笑長練功坊](https://52hal.cc/al) | 2026
