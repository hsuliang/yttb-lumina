# ㄚ亮笑長的內容助手 Whisper Worker 部署說明

## 概覽

這個 Cloudflare Worker 提供 Whisper 語音辨識 API，供 ㄚ亮笑長的內容助手 前端的「字幕產生器」（Whisper 模式）使用。

支援自動分段處理，可辨識 **超過 1 小時**的直播錄影。

目前 Worker 版本：**1.3.0**。此版新增局部密集短片語迴圈檢查，能攔截夾雜變形錯字的反覆內容；兩三字的自然口語強調若沒有其他異常則保留原結果，不觸發重試或切片，避免正常內容在補救過程中被改壞。

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

### 3. 貼上程式碼

1. 點選 **Edit code**（或 **Quick Edit**）
2. 將 `cf-worker/worker.js` 的全部內容**取代**預設的程式碼
3. 點選右上角 **Save and Deploy**

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
  "version": "1.3.0",
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

## API 規格

### GET /api/health

健康檢查，不需要 Token。

**回應：**
```json
{
  "status": "ok",
  "model": "@cf/openai/whisper-large-v3-turbo",
  "version": "1.3.0",
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
