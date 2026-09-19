# ㄚ亮笑長的內容助手 Whisper Worker 部署說明

## 概覽

這個 Cloudflare Worker 提供 Whisper 語音辨識 API，供 ㄚ亮笑長的內容助手 前端的「字幕產生器」（Whisper 模式）使用。

支援自動分段處理，可辨識 **超過 1 小時**的直播錄影。

目前 Worker 版本：**1.3.2**。新版前端使用 `POST /api/transcribe?processing=client`，Worker 只做驗證、原生 Base64 編碼及 AI 呼叫；音訊分析、詞庫校正、字幕排版、品質檢查與品質重試改由瀏覽器處理。未帶參數的舊版前端仍保留原本行為，但不會獲得本次 CPU 減量效果。

新版前端上傳前會檢查 `/api/health` 的 `clientProcessing: "client-v1"`。連到 1.3.1 或更舊的後端會明確停止並提示更新，不會靜默退回舊的高 CPU 流程。連續 3 段失敗的停止與部分字幕保留機制繼續有效。

**單檔部署：** `cf-worker/worker.js` 現在就是已打包完成的單一 Worker 檔案，包含所有字幕處理模組，不含相對路徑 import，也不依賴 `node:buffer`；可直接貼到 Cloudflare Dashboard 的 **Edit code**。`worker-standalone.js` 保留為相同內容的下載檔，兩者會由測試確認同步。使用 Wrangler 時仍可沿用本目錄的 `wrangler.jsonc`；其中的 `nodejs_compat` 設定不會升級付費方案。正式部署前仍須取得明確授權。

已有 Worker 的部署設定須先核對帳號、Worker 名稱與既有 bindings；本設定對應 `whisper`，保留既有 vars，API_TOKEN 使用原本 Secret，不寫入設定檔。GitHub push 不會代替部署授權。

CPU 超限由平台直接終止請求，Worker 的 try/catch 無法保證補上 CORS；必須降低 CPU 工作量。若優化後仍超限，再評估調整單段長度或經使用者同意採用適合的付費額度，不能僅加上重試。

---

## 部署步驟

### 1. 登入 Cloudflare Dashboard

前往 [https://dash.cloudflare.com](https://dash.cloudflare.com) 並登入。

### 2. 建立新 Worker

1. 點選左側選單 **Workers & Pages**
2. 點選 **Create application**
3. 選擇 **Create Worker**
4. 點選 **Start with Hello World!**
5. 點選 Worker name，填入你要的網址（例如：`yttb-whisper`），這是 Worker API URL，用來填寫連線設定。
6. 填好後按下 **Deploy**

### 3. 使用 Wrangler 部署

`cf-worker/worker.js` 已是可直接部署的單檔版本。若要保留 Wrangler 的設定、AI binding 與日誌設定，從專案根目錄執行：

```bash
npx wrangler deploy --dry-run --config cf-worker/wrangler.jsonc --outdir /tmp/whisper-build
```

取得明確正式部署授權、確認帳號與 Worker 名稱後，才執行：

```bash
npx wrangler deploy --config cf-worker/wrangler.jsonc
```

設定檔已包含 `nodejs_compat`、AI binding 與日誌。現有 API_TOKEN Secret 不會寫入原始碼。

### 3A. Dashboard 直接貼上單檔版本

若另一個 Cloudflare 帳號沒有使用 Wrangler，可直接使用本目錄的 [`worker.js`](./worker.js)。這是已打包完成的單一 Worker 檔案，沒有相對路徑 import，也不依賴 `node:buffer`；可直接在 Worker 的 **Edit code** 中全選取代後儲存部署。`worker-standalone.js` 是相同內容的下載副本。

貼上後仍須在 **Bindings** 新增 Workers AI binding，Variable name 必須是 `AI`。若設定 `API_TOKEN` Secret，前端連線時也要填入相同 Token；未設定時可直接使用健康端點與辨識端點。

單檔版本的 `/api/health` 預期回傳 `version: "1.3.2"` 與 `clientProcessing: "client-v1"`。請確認貼上的檔案是目前 GitHub 的 `cf-worker/worker.js`，不要使用舊版 354 行原始模組。

### 4. 啟用 Workers AI Binding

> ⚠️ 必須完成此步驟，否則 Whisper 模型無法運作。

1. 回到該 Worker 的設定頁面
2. 點選畫面上方 **Bindings**
3. 點選 **Add binding**
4. 選擇 **Workers AI**
5. Variable name 填入：`AI`（**大寫，必須完全一致**）
6. 點擊 **Save** 儲存

### 5. （選填）設定 API Token

若要保護您的 Worker，避免他人濫用：

1. **Settings** → **Variables**
2. 新增環境變數：
   - **Type**: 選擇 `Secret`
   - **Variable name**: `API_TOKEN`
   - **Value**: 您自訂的密碼（例如：`my-secret-token-2026`）
3. 點選 **Deploy** 儲存

---

## 驗證部署

### 測試健康端點

```bash
curl https://your-worker-name.workers.dev/api/health
```

預期回應：
```json
{
  "status": "ok",
  "model": "@cf/openai/whisper-large-v3-turbo",
  "version": "1.3.2",
  "clientProcessing": "client-v1",
  "maxAudioMB": 28,
  "authRequired": false
}
```

### 在前端測試

1. 開啟 [ㄚ亮笑長的內容助手](https://ctb.52hal.cc/) 應用程式
2. 切換到「🎙️ AI 字幕產生器」Tab 0
3. 選擇「Whisper 專業版」
4. 填入 Worker URL（例如：`https://yttb-whisper.your-name.workers.dev`）
5. 若有設定 Token，填入 Token
6. 點選「**測試連線**」

---

## 本機完整測試（不部署 Production）

```bash
npx wrangler dev --config cf-worker/wrangler.jsonc --ip 127.0.0.1 --port 8787
npm run dev -- --host 0.0.0.0
```

Wrangler 需有效的 Cloudflare 登入，Workers AI binding 使用真正的遠端 AI，會計入原帳號用量。本機 Worker 僅監聽 loopback，不對 LAN 開放。

在本機前端的 Worker 設定填入 `http://127.0.0.1:8787`，測試連線應顯示 1.3.2；沒有本機 API_TOKEN 設定時可留空。測試結束後切回正式 Worker 網址。只開前端 localhost 不代表新版後端已啟用。

本機 Worker 並不等同正式平台的 CPU 限制環境；本機及模擬測試通過後，仍須經授權部署並以實際長音檔觀察 CPU 超限是否消失。

## API 規格

### GET /api/health

健康檢查，不需要 Token。

**回應：**
```json
{
  "status": "ok",
  "model": "@cf/openai/whisper-large-v3-turbo",
  "version": "1.3.2",
  "clientProcessing": "client-v1",
  "maxAudioMB": 28,
  "authRequired": true
}
```

### POST /api/transcribe

接受音訊資料，回傳辨識結果。

**Request Headers：**
```
Authorization: Bearer {your-token}
X-Custom-Dict: URL encoded 專有名詞與「錯字=正字」規則
```

**Request Body（Binary WAV，前端分段模式）：**
```
Content-Type: audio/wav
X-Language: zh  （選填，支援：zh / en / ja / ko）
X-Chunk-Index: 0
X-Chunk-Offset: 0
X-First-Chunk: 1
X-Media-Title: URL encoded media title
X-Previous-Context: URL encoded previous transcript tail
X-Recovery-Depth: 0  （前端自動設定；0 為原始片段，1 以上為補救片段）
X-Request-Attempt: 1 （前端自動設定；同片段第幾次請求）

[WAV binary data]
```

**回應：**
```json
{
  "text": "純文字逐字稿...",
  "vtt": "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n字幕文字",
  "srt": "1\n00:00:01,000 --> 00:00:03,000\n字幕文字",
  "wordCount": 123,
  "detectedLanguage": "zh",
  "quality": {
    "score": 100,
    "suspect": false,
    "severity": "normal",
    "reasons": [],
    "longestActiveGapMs": 0,
    "retried": false
  }
}
```

---

## 規格限制

| 項目 | 上限 |
|---|---|
| 單次請求音訊大小 | 28 MB |
| 建議分段長度 | 約 20 秒（前端會優先在低音量處切分） |
| 支援格式 | WAV（16000Hz mono 最佳）、MP3、M4A |
| 最長總音訊 | 無限制（前端分段處理） |

---

## 常見問題

**Q: 辨識出錯，出現 500 錯誤**
A: 先確認 AI Binding 是否已正確設定（Variable name 必須是大寫 `AI`）。1.2.5 起，暫時性的 500 會自動重試；`8001 Invalid input` 會先改用精簡參數，再視需要縮短片段。錯誤 JSON 內的 `requestAttempt` 是同片段嘗試次數，`recoveryDepth` 大於 0 則表示縮短後的補救片段。

**Q: 出現 4006 或「daily free allocation」錯誤**
A: 代表 Workers AI 當日 10,000 neurons 免費額度已用完。1.2.9 會回傳不可重試的 `AI_DAILY_LIMIT`，前端會立即停止後續請求、保留已完成字幕並顯示額度提醒；請等待每日額度重置，或升級 Cloudflare Workers Paid 方案。

**Q: 回傳 401 Unauthorized**
A: 確認前端填入的 Token 與 Worker 環境變數 `API_TOKEN` 完全一致。

**Q: 片頭音樂與辨識品質如何處理？**
A: Worker 會啟用 VAD、檢查損壞字元／異常字系／重複片語／提示詞外洩／稀疏結果及有聲無字幕區段，必要時自動重試。第一段語音前若偵測到持續的可聽非語音內容，SRT 會以 `《 字幕君：ㄚ亮笑長的內容助手》 【音樂】` 標示；純靜音不會標成音樂。補救後仍可疑的片段會標示 `【辨識不清】` 或 `【待確認】`，並停止把該段文字帶入後續辨識提示。

**Q: 為什麼自動偵測偶爾會輸出簡體字？**
A: 自動偵測適合語言未知或多語音檔；前端預設改為「中文（繁體）」，中文結果也會在輸出階段正規化為臺灣繁體。英文、日文與其他非中文結果不套用簡繁轉換。


### 瀏覽器處理模式

`POST /api/transcribe?processing=client` 使用相同的 WAV body、Authorization 與既有 headers，回傳 `{ processing: "client-v1", result, usedMinimalInput }`。`result` 是 Whisper 原始模型輸出，尚未整理字幕。品質重試另送 `&retry=1`，移除前文提示並保留原本的品質參數；無效 AI 輸入仍由 Worker 以最小輸入補試一次。

瀏覽器對同一片段只分析一次 WAV，依原本品質分數選擇初次或重試結果，再進行原有的短片段補救、繁體轉換與全檔時間軸合併。不要把模型原始輸出直接當成最終 SRT。
