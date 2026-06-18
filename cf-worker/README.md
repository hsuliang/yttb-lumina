# ㄚ亮笑長的內容助手 Whisper Worker 部署說明

## 概覽

這個 Cloudflare Worker 提供 Whisper 語音辨識 API，供 yttb-lumina 前端的「字幕產生器」（Whisper 模式）使用。

支援自動分段處理，可辨識 **超過 1 小時**的直播錄影。

---

## 部署步驟

### 1. 登入 Cloudflare Dashboard

前往 [https://dash.cloudflare.com](https://dash.cloudflare.com) 並登入。

### 2. 建立新 Worker

1. 點選左側選單 **Workers & Pages**
2. 點選 **Create application**
3. 選擇 **Create Worker**
4. 給 Worker 取名（例如：`yttb-whisper`）
5. 點選 **Deploy**

### 3. 貼上程式碼

1. 點選 **Edit code**（或 **Quick Edit**）
2. 將 `cf-worker/worker.js` 的全部內容**取代**預設的程式碼
3. 點選右上角 **Save and Deploy**

### 4. 啟用 Workers AI Binding

> ⚠️ 必須完成此步驟，否則 Whisper 模型無法運作。

1. 回到 Worker 設定頁
2. 點選 **Settings** → **Bindings**
3. 點選 **Add binding**
4. 選擇 **Workers AI**
5. Variable name 填入：`AI`（**大寫，必須完全一致**）
6. 點選 **Save**
7. 重新部署一次（點選 **Deployments** → **Deploy**）

### 5. （選填）設定 API Token

若要保護您的 Worker，避免他人濫用：

1. **Settings** → **Variables**
2. 新增環境變數：
   - **Name**: `API_TOKEN`
   - **Value**: 您自訂的密鑰（例如：`my-secret-token-2024`）
3. 點選 **Save**

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
  "version": "1.0.0",
  "maxAudioMB": 28,
  "authRequired": false
}
```

### 在前端測試

1. 開啟 yttb-lumina 應用程式
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
  "version": "1.0.0",
  "maxAudioMB": 28,
  "authRequired": true
}
```

### POST /api/transcribe

接受音訊資料，回傳辨識結果。

**Headers（若有設定 Token）：**
```
Authorization: Bearer {your-token}
```

**Request Body（Binary WAV，前端分段模式）：**
```
Content-Type: audio/wav
X-Language: zh  （選填，支援：zh / en / ja / ko）

[WAV binary data]
```

**Request Body（FormData，備用）：**
```
Content-Type: multipart/form-data

audio: [音訊檔案]
language: zh  （選填）
```

**回應：**
```json
{
  "text": "純文字逐字稿...",
  "vtt": "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n字幕文字",
  "srt": "1\n00:00:01,000 --> 00:00:03,000\n字幕文字",
  "wordCount": 123
}
```

---

## 規格限制

| 項目 | 上限 |
|---|---|
| 單次請求音訊大小 | 28 MB |
| 建議分段長度 | 10 分鐘（前端自動分割） |
| 支援格式 | WAV（16000Hz mono 最佳）、MP3、M4A |
| 最長總音訊 | 無限制（前端分段處理） |

---

## 常見問題

**Q: 辨識出錯，出現 500 錯誤**
A: 確認 AI Binding 是否已正確設定（Variable name 必須是大寫 `AI`）。

**Q: 回傳 401 Unauthorized**
A: 確認前端填入的 Token 與 Worker 環境變數 `API_TOKEN` 完全一致。

**Q: 辨識品質不佳**
A: 前端已自動轉換為 Whisper 最佳格式（16000Hz 單聲道），無須額外調整。
