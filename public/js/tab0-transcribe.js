import { callGeminiAudioAPI, callGeminiAPI, isPollutedGeminiAudioOutput, translateError } from './gemini-api.js';

import { showToast, showModal, hideModal, saveFile } from './ui-components.js';
import { state, AI_PROMPT_MESSAGES } from './state.js';
import { getBalancedApiKey, showGlobalSettingsModal, switchTab } from './app.js';

/**
 * tab0-transcribe.js
 * Tab0 字幕產生器：支援 Gemini AI 與 Whisper Worker 雙軌模式。
 */

// ########## TAB 0 ERROR HANDLING HELPERS ##########
function isAbortError(error) {
    const message = error?.message || '';
    return error?.name === 'AbortError' ||
           message.includes('AbortError') ||
           message.includes('aborted') ||
           message.includes('The user aborted a request') ||
           message.includes('使用者已取消辨識') ||
           message.includes('使用者主動取消');
}

function getUserFriendlyTranscriptionError(error) {
    const message = error?.message || String(error || '');

    if (error?.name === 'PureGeminiSrtGuardError' || message.includes('Pure Gemini SRT output suspicious')) {
        return '【Gemini 字幕格式異常】\n\nGemini 回傳的字幕時間碼或內容格式異常，系統已阻止輸出可能錯誤的 SRT。\n這通常不是 API Key 無效，而是模型在某一段音訊中產生了不穩定輸出。\n建議稍後重試，或改用「超精準字幕」模式。';
    }

    if (typeof translateError === 'function') {
        return translateError(message);
    }
    return `辨識失敗：${message}`;
}

function showTranscriptionErrorModal(error) {
    const friendlyMessage = getUserFriendlyTranscriptionError(error);
    showModal({
        title: '語音辨識錯誤',
        message: friendlyMessage,
        buttons: [
            { text: '關閉', class: 'btn-primary', callback: hideModal }
        ]
    });
}

// ########## TAB 0 CONSTANTS ##########
const TAB0_SUPPORTED_FORMATS = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.webm', '.mp4'];
const TAB0_MIME_MAP = {
    'mp3': 'audio/mp3', 'wav': 'audio/wav', 'ogg': 'audio/ogg',
    'm4a': 'audio/mp4', 'flac': 'audio/flac', 'webm': 'audio/webm', 'mp4': 'audio/mp4'
};
const TAB0_MAX_FILE_SIZE_MB = 20;
const TAB0_STORAGE_KEYS = {
    workerUrl: 'aliang-tab0-worker-url',
    workerToken: 'aliang-tab0-worker-token',
    engine: 'aliang-tab0-engine',
    language: 'aliang-tab0-language',
};

// ########## TAB 0 PROMPT ##########
function buildTranscriptionPrompt(language, customDict, chunkDuration = 180) {
    const langHint = language === 'auto' ? '自動偵測語言' :
        language === 'zh' ? '中文（繁體）' :
            language === 'en' ? 'English' :
                language === 'ja' ? '日本語' : '自動偵測語言';

    let dictInstruction = '';
    if (customDict) {
        dictInstruction = `\n\n特別要求：\n專有名詞只作為詞彙偏好，不是知識問答。請嚴格遵守以下專有名詞，當遇到聽起來類似的詞彙時，必須輸出以下指定的正向詞彙：\n${customDict}`;
    }

    const durationMin = Math.ceil(chunkDuration / 60);
    const durationSec = Math.ceil(chunkDuration % 60);
    const maxTimeStr = `00:${String(durationMin).padStart(2, '0')}:${String(durationSec).padStart(2, '0')},000`;

    return `請將以下音訊內容轉寫為標準 SRT 字幕格式。${dictInstruction}

嚴格要求：
1. 語言偏好：${langHint}

【重要：時間碼規則】
- 這是一個被切割出來的獨立音訊片段，不是完整原始影片。
- 本片段長度約為 ${Math.ceil(chunkDuration)} 秒。
- SRT 時間碼必須以本片段開頭作為 00:00:00,000。
- 第一條字幕時間碼必須接近 00:00:00,000 或本片段中第一個有人聲的時間。
- 所有時間碼都必須落在 00:00:00,000 到本片段長度之內。
- 絕對禁止輸出原始影片的全域時間碼，例如 00:21:00,000、01:02:00,000、02:15:00,000。
- 即使音訊來自長影片，也只能輸出此片段內的相對時間碼。
- 如果本片段長度是 60 秒，最後一個時間碼不可超過 00:01:00,000。
- 如果本片段長度不足 60 秒，最後一個時間碼不可超過該片段實際長度。
- 單一字幕區段建議 2 到 8 秒，最長不要超過 15 秒。
- 不可產生長達數分鐘的字幕區段。
- 時間戳必須精準對應音訊中的語音位置，按時間順序排列，絕對不可發生時間倒退或重疊。

【重要：格式規則】
- 必須輸出標準 SRT。
- 不可只輸出純文字。
- 不可輸出說明文字。
- 不可輸出 markdown。
- 不可輸出 \`\`\`srt 或 \`\`\`。
- 每個字幕區塊必須包含：序號、時間碼、字幕文字。
- 序號從 1 開始連續遞增。
- 每段字幕只能有 1 行，不可換行。每行字幕的理想長度為「15 到 27 個字」，不可少於 10 個字（除非是極短語句），也不可超過 30 個字。
- 只根據音訊內容轉寫，不補充、不推理、不猜測，不要遺漏或創造原始音訊中沒有的內容。
- 如果音訊中有靜音段，不要為靜音段產生字幕。
- 請確保將音訊中【最後一秒】的語音都完整辨識並加上時間戳，絕不可遺漏或截斷結尾的任何一句話。

標準 SRT 範例如下：
1
00:00:00,000 --> 00:00:05,000
這是第一句話的內容

2
00:00:05,000 --> 00:00:10,000
這是第二句話的內容`;
}

function buildPureGeminiSrtRescuePrompt(language, customDict, chunkDuration = 60) {
    const langHint = language === 'zh-TW'
        ? '請使用繁體中文轉寫，保留原始口語語氣。'
        : `請使用 ${language || '原音訊語言'} 轉寫。`;

    const dictInstruction = customDict
        ? `\n\n專有名詞與修正詞庫：\n${customDict}\n請優先依照上述詞庫修正人名、地名、工具名稱與專有名詞。`
        : '';

    return `這是一次重新嘗試。前一次輸出疑似產生了錯誤的 SRT、過長內容、重複文字或超出本片段範圍的時間碼。

請將這段音訊重新轉寫成「極簡、嚴格、標準 SRT」。

語言規則：
${langHint}${dictInstruction}

本片段長度：約 ${Math.ceil(chunkDuration)} 秒。

絕對規則：
1. 只輸出標準 SRT。
2. 不可輸出純文字。
3. 不可輸出 markdown。
4. 不可輸出說明。
5. 不可輸出 \`\`\`srt 或 \`\`\`。
6. 時間碼必須從 00:00:00,000 開始計算。
7. 所有時間碼都必須落在 00:00:00,000 到本片段長度內。
8. 絕對不可輸出原始影片的全域時間碼，例如 00:21:00,000、01:02:00,000、02:15:00,000。
9. 如果本片段約 60 秒，最後時間碼不可超過 00:01:00,000。
10. 單一字幕區段建議 2 到 8 秒，最長不可超過 15 秒。
11. 最多輸出 20 個字幕區塊。
12. 每個字幕區塊只能有一行字幕文字。
13. 不要重複單字、語助詞或無意義聲音。
14. 不要輸出大量「我我我」、「嗯嗯嗯」、「啊啊啊」或類似重複內容。
15. 不要補空白時間。
16. 不要創造音訊中沒有的內容。
17. 如果只有短句，就只輸出短句的 SRT。
18. 整體輸出請控制在 2000 字元以內。

格式範例：
1
00:00:00,000 --> 00:00:04,000
這是第一句話

2
00:00:04,000 --> 00:00:08,000
這是第二句話`;
}

// ########## SRT VALIDATION & FIX ##########

/**
 * 修正非標準時間碼為標準 SRT 格式 (HH:MM:SS,mmm)
 * 支援以下 Gemini 常見的非標準格式：
 *   00:01:400  (MM:SS:mmm，冒號分隔毫秒)  → 00:00:01,400
 *   00:01.400  (MM:SS.mmm，點分隔毫秒)    → 00:00:01,400
 *   00:00:05.000 (HH:MM:SS.mmm，點分隔)   → 00:00:05,000
 *   1:23:456  (M:SS:mmm)                  → 00:01:23,456
 */
function fixTimecode(tc) {
    tc = tc.trim();

    // 1. 先做一般的格式修復
    let standardTc = null;

    if (/^\d{2}:\d{2}:\d{2},\d{3}$/.test(tc)) {
        standardTc = tc;
    } else if (/^\d{2}:\d{2}:\d{2}\.\d{3}$/.test(tc)) {
        standardTc = tc.replace('.', ',');
    } else {
        const mmssmmm = tc.match(/^(\d{1,2}):(\d{2}):(\d{3})$/);
        if (mmssmmm) {
            const mm = mmssmmm[1].padStart(2, '0');
            const ss = mmssmmm[2];
            const ms = mmssmmm[3];
            standardTc = `00:${mm}:${ss},${ms}`;
        } else {
            const mmssdotmmm = tc.match(/^(\d{1,2}):(\d{2})\.(\d{3})$/);
            if (mmssdotmmm) {
                const mm = mmssdotmmm[1].padStart(2, '0');
                const ss = mmssdotmmm[2];
                const ms = mmssdotmmm[3];
                standardTc = `00:${mm}:${ss},${ms}`;
            } else {
                const hmmss = tc.match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})$/);
                if (hmmss) {
                    standardTc = `${hmmss[1].padStart(2, '0')}:${hmmss[2]}:${hmmss[3]},${hmmss[4]}`;
                }
            }
        }
    }

    if (!standardTc) return null;

    // 2. 檢測並修正 Gemini 的時間碼欄位右移 (Column Shift) 幻想
    // 例如：01:40:00,000 (代表 1分40秒) 應該是 00:01:40,000
    // 例如：01:43:50,000 (代表 1分43.5秒) 應該是 00:01:43,500
    const m = standardTc.match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
    if (m) {
        const h = parseInt(m[1], 10);
        const min = parseInt(m[2], 10);
        const sec = parseInt(m[3], 10);
        const ms = parseInt(m[4], 10);

        if (h > 0 && h < 60) {
            const newMin = h;
            const newSec = min;
            const newMs = (sec > 0 && ms === 0) ? (sec * 10) : ms;

            const pad = (n, len = 2) => String(n).padStart(len, '0');
            return `00:${pad(newMin)}:${pad(newSec)},${pad(newMs, 3)}`;
        }
    }

    return standardTc;
}

function validateAndFixSrt(rawText) {
    // 移除 markdown code block 包裝
    let text = rawText.trim();
    text = text.replace(/^```(?:srt)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
    text = text.trim();

    // 嘗試解析 SRT 區塊
    const blocks = text.split(/\n\s*\n/).filter(b => b.trim().length > 0);
    const fixedBlocks = [];
    let seqNum = 1;

    for (const block of blocks) {
        const lines = block.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);

        // 找到時間碼行（包含 --> 的行）
        const timeLineIdx = lines.findIndex(l => l.includes('-->'));
        if (timeLineIdx === -1) continue;

        const timeLine = lines[timeLineIdx];

        // 拆分 --> 兩側的時間碼
        const arrowParts = timeLine.split('-->').map(p => p.trim());
        if (arrowParts.length !== 2) continue;

        const startTime = fixTimecode(arrowParts[0]);
        const endTime = fixTimecode(arrowParts[1]);

        if (!startTime || !endTime) continue;

        // 取得字幕文字（時間碼之後的所有行）
        const subtitleText = lines.slice(timeLineIdx + 1).join('\n');
        if (!subtitleText.trim()) continue;

        fixedBlocks.push(`${seqNum}\n${startTime} --> ${endTime}\n${subtitleText}`);
        seqNum++;
    }

    if (fixedBlocks.length === 0) {
        return { isValid: false, srt: '', plainText: text, blockCount: 0 };
    }

    return {
        isValid: true,
        srt: fixedBlocks.join('\n\n'),
        plainText: fixedBlocks.map(b => b.split('\n').slice(2).join(' ')).join('\n'),
        blockCount: fixedBlocks.length,
    };
}

// ########## BATCH REPLACE ON SRT (Stage 1 Post-Processing) ##########

/**
 * 對已完成的 SRT 文字做錯別字批次替換（第一階段後處理）。
 * 只會替換字幕文字內容，不會影響時間戳。
 * @param {string} srtText - 完整的 SRT 字串
 * @param {Array} rules - [{original, replacement}, ...]
 * @returns {string} 替換後的 SRT 字串
 */
function applyBatchReplaceToSrt(srtText, rules) {
    if (!rules || rules.length === 0 || !srtText) return srtText;
    let result = srtText;
    for (const rule of rules) {
        if (rule.original) {
            const escaped = rule.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            result = result.replace(new RegExp(escaped, 'g'), rule.replacement);
        }
    }
    return result;
}

// ########## AUDIO CHUNKING UTILITIES ##########

/**
 * Float32Array PCM → WAV Blob（16-bit, 單聲道）
 * @param {Float32Array} float32Array - 16000Hz 單聲道 PCM 資料
 * @param {number} sampleRate - 採樣率（通常是 16000）
 */
function float32ToWavBlob(float32Array, sampleRate) {
    const numSamples = float32Array.length;
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    function writeStr(offset, str) {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);           // fmt chunk size
    view.setUint16(20, 1, true);            // PCM format
    view.setUint16(22, 1, true);            // Mono
    view.setUint32(24, sampleRate, true);   // sample rate
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true);            // block align
    view.setUint16(34, 16, true);           // bits per sample
    writeStr(36, 'data');
    view.setUint32(40, numSamples * 2, true);

    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        offset += 2;
    }

    return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * 將已降採樣的 AudioBuffer 切成若干段
 * @param {AudioBuffer} resampledBuffer - 16000Hz 單聲道 AudioBuffer
 * @param {number} chunkDurationSeconds - 每段秒數（預設 600 = 10 分鐘）
 */
function splitAudioBuffer(resampledBuffer, chunkDurationSeconds = 600) {
    const sampleRate = resampledBuffer.sampleRate;
    const totalSamples = resampledBuffer.length;
    const samplesPerChunk = Math.ceil(chunkDurationSeconds * sampleRate);
    const channelData = resampledBuffer.getChannelData(0);
    const chunks = [];

    for (let start = 0; start < totalSamples; start += samplesPerChunk) {
        const end = Math.min(start + samplesPerChunk, totalSamples);
        chunks.push({
            data: channelData.slice(start, end),
            sampleRate,
            offsetSeconds: start / sampleRate,
            durationSeconds: (end - start) / sampleRate,
        });
    }
    return chunks;
}

// ─── 時間戳單調遞增與修復工具 ──────────────────────────────────
function parseTimestampToMs(timeStr) {
    const cleaned = timeStr.replace(',', ':').replace('.', ':').trim();
    const parts = cleaned.split(':');
    if (parts.length === 4) {
        return (
            parseInt(parts[0], 10) * 3600000 +
            parseInt(parts[1], 10) * 60000 +
            parseInt(parts[2], 10) * 1000 +
            parseInt(parts[3], 10)
        );
    }
    return 0;
}

function formatMsToSrtTime(ms) {
    const h = Math.floor(ms / 3600000);
    const min = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const ms2 = ms % 1000;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms2).padStart(3, '0')}`;
}

// ########## SUBTITLE GAP SMOOTHING ##########
const SUBTITLE_GAP_SMOOTHING_MAX_GAP_SECONDS = 0.8;
const SUBTITLE_GAP_SMOOTHING_SAFETY_GAP_SECONDS = 0.05;

function smoothSubtitleCueGaps(cues, options = {}) {
    if (!cues || cues.length === 0) return cues;

    const newCues = JSON.parse(JSON.stringify(cues));
    let adjustedCount = 0;

    const maxGapMs = SUBTITLE_GAP_SMOOTHING_MAX_GAP_SECONDS * 1000;
    const safetyGapMs = SUBTITLE_GAP_SMOOTHING_SAFETY_GAP_SECONDS * 1000;

    for (let i = 0; i < newCues.length - 1; i++) {
        const curr = newCues[i];
        const next = newCues[i + 1];

        if (!curr.endTime || !next.startTime) continue;

        const currEndMs = parseTimestampToMs(curr.endTime);
        const nextStartMs = parseTimestampToMs(next.startTime);

        if (isNaN(currEndMs) || isNaN(nextStartMs)) continue;

        const gapMs = nextStartMs - currEndMs;

        if (gapMs > 0 && gapMs <= maxGapMs) {
            const newEndMs = nextStartMs - safetyGapMs;
            if (newEndMs > currEndMs) {
                curr.endTime = formatMsToSrtTime(newEndMs);
                adjustedCount++;
            }
        }
    }

    if (adjustedCount > 0) {
        console.log(`[Subtitle] Gap smoothing applied: ${adjustedCount} cue gaps adjusted`);
    }

    return newCues;
}

function applyGapSmoothingToSrt(srtText) {
    if (!srtText || !srtText.trim()) return srtText;
    const blocks = parseSrtToBlocks(srtText);
    if (!blocks || blocks.length === 0) return srtText;
    const smoothedBlocks = smoothSubtitleCueGaps(blocks);
    return smoothedBlocks.map(b => `${b.id}\n${b.startTime} --> ${b.endTime}\n${b.text}`).join('\n\n');
}

function enforceMonotonicTimestamps(srtText) {
    if (!srtText || !srtText.trim()) return srtText;

    const blocks = srtText.trim().split(/\n\s*\n/).filter(b => b.trim());
    const parsed = [];

    for (const block of blocks) {
        const lines = block.trim().split('\n');
        if (lines.length < 3) continue;

        const timeLineIdx = lines.findIndex(l => l.includes('-->'));
        if (timeLineIdx === -1) continue;

        const timeLine = lines[timeLineIdx];
        const times = timeLine.split('-->');
        if (times.length !== 2) continue;

        const startMs = parseTimestampToMs(times[0]);
        const endMs = parseTimestampToMs(times[1]);
        const text = lines.slice(timeLineIdx + 1).join('\n').trim();
        parsed.push({ startMs, endMs, text });
    }

    if (parsed.length === 0) return srtText;

    let lastEndMs = 0;
    const fixed = [];

    for (let i = 0; i < parsed.length; i++) {
        const item = parsed[i];
        let currentStartMs = item.startMs;
        let currentEndMs = item.endMs;

        // 確保 startTime >= 前一筆的 endTime
        if (currentStartMs < lastEndMs) {
            currentStartMs = lastEndMs + 50;
        }

        // 確保 endTime > startTime
        if (currentEndMs <= currentStartMs) {
            const minDuration = Math.max(800, item.text.length * 150);
            currentEndMs = currentStartMs + minDuration;
        }

        fixed.push({
            startMs: currentStartMs,
            endMs: currentEndMs,
            text: item.text
        });

        lastEndMs = currentEndMs;
    }

    return fixed
        .map((b, i) => `${i + 1}\n${formatMsToSrtTime(b.startMs)} --> ${formatMsToSrtTime(b.endMs)}\n${b.text}`)
        .join('\n\n');
}

/**
 * 對 SRT 字串內所有時間戳加上偏移秒數，並重新編號
 * @param {string} srt - 原始 SRT 字串
 * @param {number} offsetSeconds - 要加上的偏移（秒）
 * @param {number} seqOffset - 序號偏移（從幾號開始）
 */
function offsetSrtTimestamps(srt, offsetSeconds, seqOffset = 0) {
    if (!srt) return '';

    function addMs(timeStr, addMs) {
        const m = timeStr.match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
        if (!m) return timeStr;
        let totalMs = (
            parseInt(m[1]) * 3600000 +
            parseInt(m[2]) * 60000 +
            parseInt(m[3]) * 1000 +
            parseInt(m[4])
        ) + addMs;
        totalMs = Math.max(0, totalMs);
        const h = Math.floor(totalMs / 3600000);
        const min = Math.floor((totalMs % 3600000) / 60000);
        const sec = Math.floor((totalMs % 60000) / 1000);
        const ms = totalMs % 1000;
        return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
    }

    const offsetMs = Math.round(offsetSeconds * 1000);
    let localSeq = 1;

    return srt
        .replace(
            /(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/g,
            (_, s, e) => `${addMs(s, offsetMs)} --> ${addMs(e, offsetMs)}`
        )
        .replace(
            /^(\d+)$/gm,
            () => String(seqOffset + localSeq++)
        );
}

// ########## VTT → SRT CONVERSION (for Whisper) ##########
function convertVttToSrt(vttText) {
    let text = vttText.trim();
    // 移除 WEBVTT header
    text = text.replace(/^WEBVTT\s*\n*/, '');
    // 移除 NOTE 區塊
    text = text.replace(/NOTE\s[\s\S]*?\n\n/g, '');
    text = text.trim();

    const blocks = text.split(/\n\s*\n/).filter(b => b.trim().length > 0);
    const srtBlocks = [];
    let seqNum = 1;

    for (const block of blocks) {
        const lines = block.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const timeLineIdx = lines.findIndex(l => l.includes('-->'));
        if (timeLineIdx === -1) continue;

        let timeLine = lines[timeLineIdx];
        const times = timeLine.split('-->').map(t => t.trim());
        if (times.length === 2) {
            const formatTime = (tc) => {
                if (/^\d{2}:\d{2}:\d{2},\d{3}$/.test(tc)) return tc;
                if (/^\d{2}:\d{2}:\d{2}\.\d{3}$/.test(tc)) return tc.replace('.', ',');

                const mmssdot = tc.match(/^(\d{1,2}):(\d{2})\.(\d{3})$/);
                if (mmssdot) return `00:${mmssdot[1].padStart(2, '0')}:${mmssdot[2]},${mmssdot[3]}`;

                const mmsscomma = tc.match(/^(\d{1,2}):(\d{2}),(\d{3})$/);
                if (mmsscomma) return `00:${mmsscomma[1].padStart(2, '0')}:${mmsscomma[2]},${mmsscomma[3]}`;

                const hmmssdot = tc.match(/^(\d{1,2}):(\d{2}):(\d{2})\.(\d{3})$/);
                if (hmmssdot) return `${hmmssdot[1].padStart(2, '0')}:${hmmssdot[2]}:${hmmssdot[3]},${hmmssdot[4]}`;

                const hmmsscomma = tc.match(/^(\d{1,2}):(\d{2}):(\d{2}),(\d{3})$/);
                if (hmmsscomma) return `${hmmsscomma[1].padStart(2, '0')}:${hmmsscomma[2]}:${hmmsscomma[3]},${hmmsscomma[4]}`;

                return tc;
            };
            timeLine = `${formatTime(times[0])} --> ${formatTime(times[1])}`;
        }

        const subtitleText = lines.slice(timeLineIdx + 1).join('\n');
        if (!subtitleText.trim()) continue;

        srtBlocks.push(`${seqNum}\n${timeLine}\n${subtitleText}`);
        seqNum++;
    }

    return srtBlocks.join('\n\n');
}

// ########## FILE HELPERS ##########
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = reader.result.split(',')[1]; // 去除 data:xxx;base64, 前綴
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function getFileExtension(filename) {
    return filename.split('.').pop().toLowerCase();
}

function formatSecondsForLog(seconds) {
    const safeSeconds = Math.max(0, Math.floor(seconds || 0));
    const hh = Math.floor(safeSeconds / 3600);
    const mm = Math.floor((safeSeconds % 3600) / 60);
    const ss = safeSeconds % 60;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

const PURE_GEMINI_RATE_LIMIT_MAX_RETRIES = 2;
const PURE_GEMINI_RATE_LIMIT_RETRY_WAIT_MS = 75 * 1000;

const PURE_GEMINI_SRT_GUARD_MAX_RETRIES = 2;
const PURE_GEMINI_SRT_GUARD_RETRY_WAIT_MS = 5 * 1000;
const PURE_GEMINI_SRT_MAX_RESPONSE_LENGTH = 6000;
const PURE_GEMINI_SRT_MAX_CUE_DURATION_SECONDS = 90;
const PURE_GEMINI_SRT_CHUNK_END_TOLERANCE_SECONDS = 20;
const PURE_GEMINI_SRT_MAX_CUES_PER_CHUNK = 120;

const PRECISE_PHASE1_RATE_LIMIT_MAX_RETRIES = 2;
const PRECISE_PHASE1_RATE_LIMIT_RETRY_WAIT_MS = 75 * 1000;

const PRECISE_PHASE3_RATE_LIMIT_MAX_RETRIES = 1;
const PRECISE_PHASE3_RATE_LIMIT_RETRY_WAIT_MS = 75 * 1000;

function isPureGeminiRateLimitError(error) {
    const errMsg = String(error?.message || error || '');
    const lowerErrMsg = errMsg.toLowerCase();

    return (
        errMsg.includes('429') ||
        lowerErrMsg.includes('quota') ||
        lowerErrMsg.includes('resource exhausted') ||
        lowerErrMsg.includes('too many requests') ||
        lowerErrMsg.includes('rate limit') ||
        lowerErrMsg.includes('rate limited') ||
        errMsg.includes('配額') ||
        errMsg.includes('頻率限制') ||
        errMsg.includes('冷卻') ||
        errMsg.includes('請求過多') ||
        errMsg.includes('暫時無法處理音訊') ||
        lowerErrMsg.includes('rpm')
    );
}

function waitForPureGeminiRetry(ms, abortSignal) {
    return new Promise((resolve, reject) => {
        if (abortSignal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }

        const timer = setTimeout(resolve, ms);

        if (abortSignal) {
            abortSignal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new DOMException('Aborted', 'AbortError'));
            }, { once: true });
        }
    });
}

function parsePureGeminiTimestampToSeconds(timestamp) {
    const match = String(timestamp || '').match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/);
    if (!match) return null;

    const [, hh, mm, ss, ms] = match;
    return Number(hh) * 3600 + Number(mm) * 60 + Number(ss) + Number(ms) / 1000;
}

function getPureGeminiSrtStats(srtText) {
    const text = String(srtText || '');
    const timestampRegex = /(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/g;

    const stats = {
        cueCount: 0,
        maxEndSec: 0,
        maxCueDurationSec: 0,
        invalidOrderCount: 0,
        hasTimestamp: false
    };

    let match;
    while ((match = timestampRegex.exec(text)) !== null) {
        const startSec = parsePureGeminiTimestampToSeconds(match[1]);
        const endSec = parsePureGeminiTimestampToSeconds(match[2]);

        if (startSec === null || endSec === null) continue;

        stats.hasTimestamp = true;
        stats.cueCount += 1;
        stats.maxEndSec = Math.max(stats.maxEndSec, endSec);
        stats.maxCueDurationSec = Math.max(stats.maxCueDurationSec, endSec - startSec);

        if (endSec <= startSec) {
            stats.invalidOrderCount += 1;
        }
    }

    return stats;
}

function hasSuspiciousRepeatedText(text) {
    const compactText = String(text || '').replace(/\s+/g, '');
    if (!compactText) return false;

    // 單一字元大量連續重複，例如「我我我我我……」
    if (/(.)\1{29,}/u.test(compactText)) {
        return true;
    }

    // 常見中文語助詞或單字異常重複
    if (/(我){20,}/u.test(compactText)) return true;
    if (/(嗯){20,}/u.test(compactText)) return true;
    if (/(啊){20,}/u.test(compactText)) return true;
    if (/(喔){20,}/u.test(compactText)) return true;
    if (/(好){20,}/u.test(compactText)) return true;

    // 2至6個中文字的短詞大量重複，例如「現在現在現在……」
    if (/([\u4e00-\u9fff]{2,6})\1{12,}/.test(compactText)) {
        return true;
    }

    return false;
}

function hasMalformedTimestampArrow(text) {
    const lines = String(text || '').split(/\r?\n/);
    const standardSrtTimeLine = /^\s*\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}\s*$/;

    return lines.some(line => {
        const trimmed = line.trim();
        if (!trimmed.includes('-->')) return false;
        return !standardSrtTimeLine.test(trimmed);
    });
}

function inspectPureGeminiSrtOutput(rawResponse, chunkDurationSeconds = 60) {
    const text = String(rawResponse || '');
    const stats = getPureGeminiSrtStats(text);
    const reasons = [];

    const safeChunkDuration = Number.isFinite(chunkDurationSeconds) && chunkDurationSeconds > 0
        ? chunkDurationSeconds
        : 60;

    if (text.length > PURE_GEMINI_SRT_MAX_RESPONSE_LENGTH) {
        reasons.push(`response too long: ${text.length}`);
    }

    if (stats.hasTimestamp && stats.maxEndSec > safeChunkDuration + PURE_GEMINI_SRT_CHUNK_END_TOLERANCE_SECONDS) {
        reasons.push(`timestamp exceeds chunk range: maxEndSec=${stats.maxEndSec}, chunkDuration=${safeChunkDuration}`);
    }

    if (stats.maxCueDurationSec > PURE_GEMINI_SRT_MAX_CUE_DURATION_SECONDS) {
        reasons.push(`cue duration too long: ${stats.maxCueDurationSec}`);
    }

    // out-of-order timestamps are repairable by enforceMonotonicTimestamps
    // do not fail the chunk solely for invalid order

    if (stats.cueCount > PURE_GEMINI_SRT_MAX_CUES_PER_CHUNK) {
        reasons.push(`too many cues: ${stats.cueCount}`);
    }

    if (!stats.hasTimestamp && text.trim().length > 200) {
        reasons.push('long response without SRT timestamps');
    }

    if (hasSuspiciousRepeatedText(text)) {
        reasons.push('suspicious repeated text');
    }

    if (hasMalformedTimestampArrow(text)) {
        reasons.push('malformed timestamp arrow');
    }

    return {
        suspicious: reasons.length > 0,
        reasons,
        stats
    };
}

function createPureGeminiSrtGuardError(chunkIndex, totalChunks, diagRange, safety) {
    const error = new Error(
        `Pure Gemini SRT output suspicious at chunk ${chunkIndex}/${totalChunks}, range ${diagRange}: ${safety.reasons.join('; ')}`
    );
    error.name = 'PureGeminiSrtGuardError';
    error.pureGeminiSafety = safety;
    return error;
}

function isPureGeminiSrtGuardError(error) {
    return error?.name === 'PureGeminiSrtGuardError';
}

// ########## CORE: TRANSCRIBE FUNCTIONS ##########

async function transcribeWithGemini(file, language, customDict, onProgress = () => { }, onChunkComplete = () => { }, onStream = () => { }) {
    const apiKey = getBalancedApiKey();
    if (!apiKey) {
        throw new Error("請先設定 Gemini API Key。");
    }

    const CHUNK_DURATION = 60; // 60秒切段，顯著提升時間軸精度並防超長漂移
    const TARGET_SR = 16000;

    // 1. 讀取並解碼音訊
    onProgress({ type: 'status', message: '正在讀取音訊檔案（Gemini 模式）...' });
    const arrayBuffer = await file.arrayBuffer();

    onProgress({ type: 'status', message: '正在解碼音訊（可能需要數秒）...' });
    const audioContext = new AudioContext();
    let rawBuffer;
    try {
        rawBuffer = await audioContext.decodeAudioData(arrayBuffer);
    } finally {
        await audioContext.close();
    }

    // 2. 降採樣至 16000Hz 單聲道
    const durationMin = Math.round(rawBuffer.duration / 60);
    onProgress({ type: 'status', message: `正在轉換格式（16kHz mono，共 ${durationMin} 分鐘）...` });

    const targetLen = Math.ceil(rawBuffer.length * TARGET_SR / rawBuffer.sampleRate) + TARGET_SR;
    const offlineCtx = new OfflineAudioContext(1, targetLen, TARGET_SR);
    const srcNode = offlineCtx.createBufferSource();
    srcNode.buffer = rawBuffer;
    srcNode.connect(offlineCtx.destination);
    srcNode.start(0);
    const resampled = await offlineCtx.startRendering();

    // 3. 切段
    const chunks = splitAudioBuffer(resampled, CHUNK_DURATION);
    const totalChunks = chunks.length;

    onProgress({
        type: 'chunks',
        current: 0, total: totalChunks,
        message: `準備分段辨識，共 ${totalChunks} 段（每段 ${CHUNK_DURATION} 秒）`,
        eta: '',
    });

    const allSrtBlocks = [];
    const allText = [];
    let globalSeq = 1;
    const chunkStartTimes = [];

    // 4. 逐段辨識並合併 SRT
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const startMin = Math.floor(chunk.offsetSeconds / 60);
        const startSec = Math.floor(chunk.offsetSeconds % 60);

        // 針對每一段建立 prompt，限制其秒數
        const prompt = buildTranscriptionPrompt(language, customDict, chunk.durationSeconds);

        let etaText = '';
        if (i > 0 && chunkStartTimes.length > 0) {
            const elapsed = (Date.now() - chunkStartTimes[0]) / 1000;
            const avgPerChunk = elapsed / i;
            const remaining = avgPerChunk * (totalChunks - i);
            etaText = remaining > 60
                ? `預估剩餘 ${Math.ceil(remaining / 60)} 分鐘`
                : `預估剩餘 ${Math.ceil(remaining)} 秒`;
        }

        onProgress({
            type: 'chunks',
            current: i + 1, total: totalChunks,
            message: `Gemini 辨識第 ${i + 1} 段（${startMin}:${String(startSec).padStart(2, '0')} 開始）`,
            eta: etaText,
        });

        chunkStartTimes.push(Date.now());

        const wavBlob = float32ToWavBlob(chunk.data, chunk.sampleRate);
        const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(wavBlob);
        });

        const diagStartSec = chunk.offsetSeconds;
        const diagEndSec = chunk.offsetSeconds + chunk.durationSeconds;
        const diagRange = `${formatSecondsForLog(diagStartSec)}-${formatSecondsForLog(diagEndSec)}`;
        console.log(`[Pure Gemini] Starting chunk ${i + 1}/${totalChunks}, range ${diagRange}, startSec=${diagStartSec}, endSec=${diagEndSec}, durationSec=${chunk.durationSeconds}`);

        let rawResponse;
        let pureGeminiAttempt = 0;
        let rateLimitRetryCount = 0;
        let srtGuardRetryCount = 0;
        let useSrtRescuePrompt = false;

        while (true) {
            try {
                if (pureGeminiAttempt > 0) {
                    console.warn(`[Pure Gemini] Retrying chunk ${i + 1}/${totalChunks}, attempt ${pureGeminiAttempt}, range ${diagRange}`);
                }

                const activePrompt = useSrtRescuePrompt
                    ? buildPureGeminiSrtRescuePrompt(language, customDict, chunk.durationSeconds)
                    : prompt;

                rawResponse = await callGeminiAudioAPI(apiKey, base64, 'audio/wav', activePrompt, (chunkText, fullText) => {
                    onStream(fullText);
                }, state.currentAbortController?.signal);

                const textLength = rawResponse ? rawResponse.length : 0;
                const safety = inspectPureGeminiSrtOutput(rawResponse, chunk.durationSeconds);

                if (safety.suspicious) {
                    console.error(`[Pure Gemini] Suspicious SRT output at chunk ${i + 1}/${totalChunks}, range ${diagRange}, textLength=${textLength}, reasons=`, safety.reasons, safety.stats);
                    throw createPureGeminiSrtGuardError(i + 1, totalChunks, diagRange, safety);
                }

                console.log(`[Pure Gemini] Completed chunk ${i + 1}/${totalChunks}, range ${diagRange}, textLength=${textLength}, attempts=${pureGeminiAttempt + 1}`);
                break;
            } catch (error) {
                console.error(`[Pure Gemini] Failed chunk ${i + 1}/${totalChunks}, range ${diagRange}, attempt=${pureGeminiAttempt + 1}, error=`, error);

                const isRateLimit = isPureGeminiRateLimitError(error);
                const isSrtGuard = isPureGeminiSrtGuardError(error);

                if (isRateLimit) {
                    console.error(`[Pure Gemini] Rate limit happened at chunk ${i + 1}/${totalChunks}, range ${diagRange}, attempt=${pureGeminiAttempt + 1}`);
                }

                if (isSrtGuard) {
                    console.error(`[Pure Gemini] SRT guard triggered at chunk ${i + 1}/${totalChunks}, range ${diagRange}, attempt=${pureGeminiAttempt + 1}`, error.pureGeminiSafety);
                }

                if (isRateLimit && rateLimitRetryCount < PURE_GEMINI_RATE_LIMIT_MAX_RETRIES) {
                    rateLimitRetryCount += 1;
                    pureGeminiAttempt += 1;

                    console.warn(`[Pure Gemini] Waiting ${Math.ceil(PURE_GEMINI_RATE_LIMIT_RETRY_WAIT_MS / 1000)} seconds before retrying chunk ${i + 1}/${totalChunks}, range ${diagRange}`);
                    await waitForPureGeminiRetry(PURE_GEMINI_RATE_LIMIT_RETRY_WAIT_MS, state.currentAbortController?.signal);
                    continue;
                }

                if (isSrtGuard && srtGuardRetryCount < PURE_GEMINI_SRT_GUARD_MAX_RETRIES) {
                    srtGuardRetryCount += 1;
                    pureGeminiAttempt += 1;
                    useSrtRescuePrompt = true;

                    console.warn(`[Pure Gemini] Switching to rescue SRT prompt for chunk ${i + 1}/${totalChunks}, range ${diagRange}`);
                    console.warn(`[Pure Gemini] Waiting ${Math.ceil(PURE_GEMINI_SRT_GUARD_RETRY_WAIT_MS / 1000)} seconds before retrying suspicious SRT chunk ${i + 1}/${totalChunks}, range ${diagRange}`);
                    await waitForPureGeminiRetry(PURE_GEMINI_SRT_GUARD_RETRY_WAIT_MS, state.currentAbortController?.signal);
                    continue;
                }

                throw error;
            }
        }

        const result = validateAndFixSrt(rawResponse);

        if (!result.isValid) {
            console.warn(`[Tab0] Gemini 第 ${i + 1} 段回傳內容無法解析為 SRT，原始回應：`, rawResponse);
            if (isPollutedGeminiAudioOutput(rawResponse)) {
                throw new Error("POLLUTED_AUDIO_TRANSCRIPTION_OUTPUT: 偵測到嚴重污染內容，無法解析為 SRT，終止當前任務。");
            } else {
                // 如果某段失敗，我們只能把它當純文字
                console.warn(`[Tab0] 第 ${i + 1} 段非 SRT fallback：`, rawResponse);
                allText.push(rawResponse);
            }
        } else {
            if (result.srt.trim()) {
                const monotonicChunkSrt = enforceMonotonicTimestamps(result.srt);
                const offsetted = offsetSrtTimestamps(monotonicChunkSrt, chunk.offsetSeconds, globalSeq - 1);
                const blocks = offsetted.split(/\n\n/).filter(b => b.trim());
                allSrtBlocks.push(...blocks);
                globalSeq += blocks.length;
                onChunkComplete(blocks.join('\n\n'));
            }
            if (result.plainText) allText.push(result.plainText.trim());
        }

        // 避免觸發 API Rate Limit (15 RPM)
        // 每次處理完一個片段，強制延遲 4.5 秒，將 15 次請求分散到超過一分鐘
        if (i < chunks.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 4500));
        }
    }

    let finalSrt = allSrtBlocks.join('\n\n');
    // 全局時間戳單調性強化與重疊修復
    finalSrt = enforceMonotonicTimestamps(finalSrt);
    finalSrt = applyGapSmoothingToSrt(finalSrt);
    // 第一階段：對辨識結果套用錯別字替換（後處理）
    finalSrt = applyBatchReplaceToSrt(finalSrt, state.batchReplaceRules);
    const finalVtt = 'WEBVTT\n\n' + finalSrt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');

    onProgress({ type: 'done', message: '全部辨識完成！' });

    return {
        text: allText.join('\n'),
        vtt: finalVtt,
        srt: finalSrt,
        engine: 'gemini',
        blockCount: allSrtBlocks.length,
        warning: totalChunks > 1
            ? `長音訊分段辨識：共 ${totalChunks} 段（每段 ${CHUNK_DURATION} 秒），SRT 時間戳已自動對齊合併。`
            : null,
    };
}

/**
 * 透過 Cloudflare Whisper Worker 辨識音訊。
 *
 * 一律走：解碼 → 降採樣 16kHz mono → 切 60 秒段 → Binary WAV → 逐段辨識 → 合併 SRT
 *
 * 原因：Cloudflare AI Binding 對 JSON Array 有大小限制。
 *   10 分鐘 WAV @ 16kHz = ~19MB → JSON 陣列 ~77MB → 必定超限 (error 5006)
 *   60 秒 WAV @ 16kHz  = ~1.9MB → JSON 陣列 ~7.7MB → 安全範圍
 *
 * @param {File} file - 音訊/影片檔案
 * @param {string} language - 語言代碼
 * @param {string} customDict - 自訂字典
 * @param {Function} onProgress - 進度回呼
 */
async function transcribeWithWhisper(file, language, customDict, onProgress = () => { }, onChunkComplete = () => { }) {
    const workerUrl = localStorage.getItem('aliang-tab0-worker-url') || sessionStorage.getItem('aliang-tab0-worker-url');
    const workerToken = localStorage.getItem('aliang-tab0-worker-token') || sessionStorage.getItem('aliang-tab0-worker-token');

    if (!workerUrl) throw new Error('請先設定 Whisper Worker 的 API URL。');

    // 防呆：確保 URL 包含 http(s):// 協定
    let validWorkerUrl = workerUrl.trim();
    if (!/^https?:\/\//i.test(validWorkerUrl)) {
        validWorkerUrl = 'https://' + validWorkerUrl;
    }

    const baseUrl = validWorkerUrl.replace(/\/+$/, '');
    const authHeaders = workerToken ? { 'Authorization': `Bearer ${workerToken}` } : {};
    const CHUNK_DURATION = 20;        // 分段設定：每段 20 秒
    // 降低為 20 秒以減少長音檔觸發 Cloudflare 503 超時錯誤的機率

    // 1. 讀取並解碼音訊
    onProgress({ type: 'status', message: '正在讀取音訊檔案...' });
    const arrayBuffer = await file.arrayBuffer();

    onProgress({ type: 'status', message: '正在解碼音訊（可能需要數秒）...' });
    const audioContext = new AudioContext();
    let rawBuffer;
    try {
        rawBuffer = await audioContext.decodeAudioData(arrayBuffer);
    } finally {
        await audioContext.close();
    }

    // 2. 降採樣至 16000Hz 單聲道
    const durationMin = Math.round(rawBuffer.duration / 60);
    onProgress({ type: 'status', message: `正在轉換格式（16kHz mono，共 ${durationMin} 分鐘）...` });

    const TARGET_SR = 16000;
    const targetLen = Math.ceil(rawBuffer.length * TARGET_SR / rawBuffer.sampleRate) + TARGET_SR;
    const offlineCtx = new OfflineAudioContext(1, targetLen, TARGET_SR);
    const srcNode = offlineCtx.createBufferSource();
    srcNode.buffer = rawBuffer;
    srcNode.connect(offlineCtx.destination);
    srcNode.start(0);
    const resampled = await offlineCtx.startRendering();

    // 3. 切段
    const chunks = splitAudioBuffer(resampled, CHUNK_DURATION);
    const totalChunks = chunks.length;

    onProgress({
        type: 'chunks',
        current: 0, total: totalChunks,
        message: `準備分段辨識，共 ${totalChunks} 段（每段 ${CHUNK_DURATION} 秒）`,
        eta: '',
    });

    // 4. 逐段辨識並合併 SRT
    const allSrtBlocks = [];
    const allText = [];
    let globalSeq = 1;
    const chunkStartTimes = [];

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const startMin = Math.floor(chunk.offsetSeconds / 60);
        const startSec = Math.floor(chunk.offsetSeconds % 60);

        let etaText = '';
        if (i > 0 && chunkStartTimes.length > 0) {
            const elapsed = (Date.now() - chunkStartTimes[0]) / 1000;
            const avgPerChunk = elapsed / i;
            const remaining = avgPerChunk * (totalChunks - i);
            etaText = remaining > 60
                ? `預估剩餘 ${Math.ceil(remaining / 60)} 分鐘`
                : `預估剩餘 ${Math.ceil(remaining)} 秒`;
        }

        onProgress({
            type: 'chunks',
            current: i + 1, total: totalChunks,
            message: `辨識第 ${i + 1} 段（${startMin}:${String(startSec).padStart(2, '0')} 開始）`,
            eta: etaText,
        });

        chunkStartTimes.push(Date.now());

        const wavBlob = float32ToWavBlob(chunk.data, chunk.sampleRate);
        const chunkHeaders = { ...authHeaders, 'Content-Type': 'audio/wav' };
        if (language && language !== 'auto') {
            chunkHeaders['X-Language'] = language;
        }
        if (customDict) {
            console.log('[Transcribe] X-Custom-Dict:', customDict);
            chunkHeaders['X-Custom-Dict'] = encodeURIComponent(customDict);
        }

        let resp;
        let retries = 2;
        while (retries >= 0) {
            try {
                resp = await fetch(`${baseUrl}/api/transcribe`, {
                    method: 'POST',
                    headers: chunkHeaders,
                    body: wavBlob,
                    signal: state.currentAbortController ? state.currentAbortController.signal : undefined
                });
                if (resp.ok || resp.status === 401 || resp.status === 403) break;

                // 若伺服器錯誤 (例如 503 Service Unavailable)，等待後重試
                if (retries > 0) {
                    onProgress({ type: 'status', message: `第 ${i + 1} 段伺服器忙碌，重試中... (${3 - retries}/2)` });
                    await new Promise(r => setTimeout(r, 2000));
                }
            } catch (err) {
                if (retries === 0) throw err;
                await new Promise(r => setTimeout(r, 2000));
            }
            retries--;
        }

        if (!resp || !resp.ok) {
            let errMsg = resp ? resp.statusText : '網路連線失敗';
            try { const j = await resp.json(); errMsg = j.error || errMsg; } catch (_) { }
            if (resp && (resp.status === 401 || resp.status === 403))
                throw new Error('Worker Token 驗證失敗，請檢查設定。');
            throw new Error(`第 ${i + 1} 段辨識失敗 (${resp ? resp.status : 'Network'}): ${errMsg}`);
        }

        const data = await resp.json();
        const chunkSrt = data.srt || (data.vtt ? convertVttToSrt(data.vtt) : '');

        if (chunkSrt.trim()) {
            const monotonicChunkSrt = enforceMonotonicTimestamps(chunkSrt);
            const offsetted = offsetSrtTimestamps(monotonicChunkSrt, chunk.offsetSeconds, globalSeq - 1);
            const blocks = offsetted.split(/\n\n/).filter(b => b.trim());
            allSrtBlocks.push(...blocks);
            globalSeq += blocks.length;
            onChunkComplete(blocks.join('\n\n'));
        }
        if (data.text) allText.push(data.text.trim());
    }

    let finalSrt = allSrtBlocks.join('\n\n');
    // 全局時間戳單調性強化與重疊修復
    finalSrt = enforceMonotonicTimestamps(finalSrt);
    finalSrt = applyGapSmoothingToSrt(finalSrt);
    // 第一階段：對辨識結果套用錯別字替換（後處理）
    finalSrt = applyBatchReplaceToSrt(finalSrt, state.batchReplaceRules);
    const finalVtt = 'WEBVTT\n\n' + finalSrt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');

    onProgress({ type: 'done', message: '全部辨識完成！' });

    return {
        text: allText.join('\n'),
        vtt: finalVtt,
        srt: finalSrt,
        engine: 'whisper',
        blockCount: allSrtBlocks.length,
        warning: totalChunks > 1
            ? `長音訊分段辨識：共 ${totalChunks} 段（每段 ${CHUNK_DURATION} 秒），SRT 時間戳已自動對齊合併。`
            : null,
    };
}

// ########## TAB 0 INITIALIZATION ##########
export function initializeTab0() {
    // --- 元素選擇 ---
    const audioFileInput = document.getElementById('tab0-audio-input');
    const audioDropZone = document.getElementById('tab0-drop-zone');
    const fileInfoDisplay = document.getElementById('tab0-file-info');
    const startBtn = document.getElementById('tab0-start-btn');
    const languageSelect = document.getElementById('tab0-language');
    const engineSelect = document.getElementById('tab0-engine-select');
    const resultTabs = document.querySelectorAll('.tab0-result-tab');
    const resultPanels = document.querySelectorAll('.tab0-result-panel');
    const exportSrtBtn = document.getElementById('tab0-export-srt-btn');
    const exportVttBtn = document.getElementById('tab0-export-vtt-btn');
    const exportTxtBtn = document.getElementById('tab0-export-txt-btn');
    const sendToTab1Btn = document.getElementById('tab0-send-to-tab1-btn');
    const progressArea = document.getElementById('tab0-progress-area');
    const progressMessage = document.getElementById('tab0-progress-message');
    const resultArea = document.getElementById('tab0-result-area');
    const helpToggleBtn = document.getElementById('tab0-help-toggle-btn');
    const helpPanel = document.getElementById('tab0-help-panel');

    let selectedFile = null;

    // --- 載入已儲存的設定 ---
    const savedEngine = localStorage.getItem(TAB0_STORAGE_KEYS.engine) || 'gemini';
    const savedLanguage = localStorage.getItem(TAB0_STORAGE_KEYS.language) || 'auto';

    if (languageSelect) languageSelect.value = savedLanguage;

    // 設定引擎 select
    if (engineSelect) {
        engineSelect.value = savedEngine;
        state.transcribeEngine = savedEngine;

        const updateEngineOptions = () => {
            const geminiOption = engineSelect.querySelector('option[value="gemini"]');
            const whisperOption = engineSelect.querySelector('option[value="whisper"]');

            const hasGemini = typeof getBalancedApiKey !== 'undefined' && getBalancedApiKey();
            const hasWorker = localStorage.getItem('aliang-tab0-worker-url') || sessionStorage.getItem('aliang-tab0-worker-url');

            if (geminiOption) {
                geminiOption.disabled = !hasGemini;
                geminiOption.textContent = hasGemini ? 'Gemini Flash 1.5 up' : 'Gemini Flash 1.5 up (未設定金鑰)';
            }

            if (whisperOption) {
                whisperOption.disabled = !hasWorker;
                whisperOption.textContent = hasWorker ? 'Whisper Large V3 Turbo' : 'Whisper Large V3 Turbo (未設定 Worker)';
            }

            if (engineSelect.value === 'gemini' && !hasGemini && hasWorker) {
                engineSelect.value = 'whisper';
                state.transcribeEngine = 'whisper';
            } else if (engineSelect.value === 'whisper' && !hasWorker && hasGemini) {
                engineSelect.value = 'gemini';
                state.transcribeEngine = 'gemini';
            }
        };

        // 監聽全局設定變更事件
        window.addEventListener('settings-updated', updateEngineOptions);

        // 初始更新狀態
        updateEngineOptions();

        // --- 引擎切換 ---
        engineSelect.addEventListener('change', () => {
            state.transcribeEngine = engineSelect.value;
            localStorage.setItem(TAB0_STORAGE_KEYS.engine, engineSelect.value);
            updateTab0StartButton();
        });
    }

    // --- 語言選擇儲存 ---
    if (languageSelect) {
        languageSelect.addEventListener('change', () => {
            state.transcribeLanguage = languageSelect.value;
            localStorage.setItem(TAB0_STORAGE_KEYS.language, languageSelect.value);
        });
    }

    // --- 檔案上傳處理 ---
    function handleFileSelect(file) {
        if (!file) return;
        const ext = getFileExtension(file.name);
        const supported = TAB0_SUPPORTED_FORMATS.map(f => f.replace('.', ''));
        if (!supported.includes(ext)) {
            showToast(`不支援的檔案格式 (.${ext})。支援：${TAB0_SUPPORTED_FORMATS.join(', ')}`, { type: 'error' });
            return;
        }
        const sizeMB = (file.size / 1024 / 1024).toFixed(1);
        selectedFile = file;
        state.originalFileName = file.name.replace(/\.[^.]+$/, "");
        if (fileInfoDisplay) {
            fileInfoDisplay.innerHTML = `
                <div class="flex items-center gap-2 text-on-surface">
                    <span class="material-symbols-outlined text-primary text-[18px]">audio_file</span>
                    <span class="text-sm font-medium truncate max-w-[180px]">${file.name}</span>
                    <span class="text-xs text-on-surface-variant">(${sizeMB} MB)</span>
                </div>`;
            fileInfoDisplay.classList.remove('hidden');
        }
        if (parseFloat(sizeMB) > TAB0_MAX_FILE_SIZE_MB) {
            showToast(`檔案大小 ${sizeMB}MB 超過建議上限 ${TAB0_MAX_FILE_SIZE_MB}MB，處理時間可能較長。`, { type: 'warning' });
        }
        updateTab0StartButton();
    }

    if (audioFileInput) {
        audioFileInput.addEventListener('change', (e) => handleFileSelect(e.target.files[0]));
    }

    if (audioDropZone) {
        audioDropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            audioDropZone.classList.add('dragover');
        });
        audioDropZone.addEventListener('dragleave', () => {
            audioDropZone.classList.remove('dragover');
        });
        audioDropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            audioDropZone.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) {
                handleFileSelect(e.dataTransfer.files[0]);
            }
        });
    }

    // --- 結果 sub-tab 切換 ---
    resultTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.target;
            resultTabs.forEach(t => t.classList.remove('active', 'bg-primary/20', 'text-primary'));
            resultPanels.forEach(p => p.classList.add('hidden'));
            tab.classList.add('active', 'bg-primary/20', 'text-primary');
            const panel = document.getElementById(target);
            if (panel) panel.classList.remove('hidden');
        });
    });

    // --- 動態提示訊息 ---
    let promptMsgInterval = null;
    const chunkProgressEl = document.getElementById('tab0-chunk-progress');
    const chunkBarEl = document.getElementById('tab0-chunk-bar');
    const chunkCounterEl = document.getElementById('tab0-chunk-counter');
    const chunkLabelEl = document.getElementById('tab0-chunk-label');
    const chunkEtaEl = document.getElementById('tab0-chunk-eta');

    /**
     * @param {boolean} staticMode - true = 不循環提示訊息（Whisper 分段模式）
     * @param {number} audioDurationSec - 音訊秒數估算（Gemini 預估剩餘時間）
     */
    function startProgressMessages(staticMode = false, audioDurationSec = 60) {
        if (progressArea) progressArea.classList.remove('hidden');
        if (resultArea) resultArea.classList.remove('hidden'); // Show it underneath the overlay to stream the text

        if (staticMode) {
            if (chunkLabelEl) chunkLabelEl.textContent = 'Whisper 處理中...';
            if (chunkProgressEl) chunkProgressEl.classList.add('hidden');
            if (chunkBarEl) chunkBarEl.style.width = '0%';
            return; // Whisper 模式由 onProgress 直接控制訊息
        }

        // --- Gemini 模式假進度條 ---
        if (chunkProgressEl) chunkProgressEl.classList.remove('hidden');
        if (chunkBarEl) chunkBarEl.style.width = '0%';
        if (chunkCounterEl) chunkCounterEl.textContent = '';
        if (chunkLabelEl) chunkLabelEl.textContent = 'Gemini 處理中...';

        let idx = 0;
        const msgs = AI_PROMPT_MESSAGES.transcribe;
        if (progressMessage) progressMessage.textContent = msgs[0];

        let simPct = 0;
        // 假設 Gemini 速度為音訊長度的 1/10，至少給 5 秒
        const durationEstSec = Math.max(5, Math.round(audioDurationSec / 10));
        let elapsedSec = 0;

        promptMsgInterval = setInterval(() => {
            elapsedSec += 1;

            if (elapsedSec % 4 === 0) {
                idx = (idx + 1) % msgs.length;
                if (progressMessage) progressMessage.textContent = msgs[idx];
            }

            simPct += (100 - simPct) * 0.05;
            if (simPct > 99) simPct = 99;
            if (chunkBarEl) chunkBarEl.style.width = `${simPct}%`;

            if (chunkEtaEl) {
                const remaining = Math.max(0, durationEstSec - elapsedSec);
                chunkEtaEl.textContent = `預估剩餘時間: 約 ${remaining > 0 ? remaining : '即將完成'} 秒`;
            }
        }, 1000);
    }

    function stopProgressMessages() {
        if (promptMsgInterval) clearInterval(promptMsgInterval);
        promptMsgInterval = null;
        if (progressArea) progressArea.classList.add('hidden');
        if (resultArea) resultArea.classList.remove('hidden');
        // 隱藏分段進度條
        if (chunkProgressEl) chunkProgressEl.classList.add('hidden');
        if (chunkBarEl) chunkBarEl.style.width = '0%';
    }

    /** Whisper 進度回呼（由 transcribeWithWhisper 呼叫） */
    function handleWhisperProgress(info) {
        if (info.type === 'status') {
            if (progressMessage) progressMessage.textContent = info.message;
        } else if (info.type === 'chunks') {
            if (progressMessage) progressMessage.textContent = info.message;
            if (chunkProgressEl) chunkProgressEl.classList.remove('hidden');
            const pct = info.total > 0 ? (Math.max(0, info.current) / info.total) * 100 : 0;
            if (chunkBarEl) chunkBarEl.style.width = `${pct}%`;
            if (chunkCounterEl) {
                chunkCounterEl.textContent = `${info.current} / ${info.total}`;
            }
            if (chunkLabelEl) {
                if (info.label) {
                    chunkLabelEl.textContent = info.label;
                } else {
                    const engineText = state.transcribeEngine === 'whisper' ? 'Whisper' : 'Gemini';
                    chunkLabelEl.textContent = `${engineText} 處理中...`;
                }
            }
            if (chunkEtaEl) chunkEtaEl.textContent = info.eta || '';
        } else if (info.type === 'done') {
            if (chunkBarEl) chunkBarEl.style.width = '100%';
            if (chunkCounterEl && chunkCounterEl.textContent) {
                const total = chunkCounterEl.textContent.split('/')[1]?.trim() || '';
                if (total) chunkCounterEl.textContent = `${total} / ${total}`;
            }
        }
    }

    // --- 顯示結果 ---
    function displayResults(data) {
        const textPanel = document.getElementById('tab0-result-text');
        const vttPanel = document.getElementById('tab0-result-vtt');
        const srtPanel = document.getElementById('tab0-result-srt');
        const emptyState = document.getElementById('tab0-empty-state');
        const vttTabBtn = document.querySelector('.tab0-result-tab[data-target="tab0-result-vtt"]');

        const isWhisper = data.engine === 'whisper';

        if (textPanel) textPanel.textContent = data.text || '（無純文字結果）';
        if (vttPanel) vttPanel.textContent = data.vtt || '（此模式不產生 VTT）';
        if (srtPanel) srtPanel.textContent = data.srt || '（無 SRT 結果）';
        if (emptyState) emptyState.classList.add('hidden');

        // 確保 VTT 按鈕正常顯示
        if (vttTabBtn) vttTabBtn.classList.remove('hidden');

        // 儲存結果到 state
        state.transcribeResult = data;

        // 啟用匯出按鈕
        if (exportSrtBtn) {
            exportSrtBtn.disabled = !data.srt;
            exportSrtBtn.classList.toggle('opacity-50', !data.srt);
            exportSrtBtn.classList.toggle('cursor-not-allowed', !data.srt);
        }
        if (exportVttBtn) {
            exportVttBtn.classList.remove('hidden');
            exportVttBtn.disabled = !data.vtt;
            exportVttBtn.classList.toggle('opacity-50', !data.vtt);
            exportVttBtn.classList.toggle('cursor-not-allowed', !data.vtt);
        }
        if (exportTxtBtn) {
            exportTxtBtn.disabled = !data.text;
            exportTxtBtn.classList.toggle('opacity-50', !data.text);
            exportTxtBtn.classList.toggle('cursor-not-allowed', !data.text);
        }
        if (sendToTab1Btn) {
            const hasContent = !!(data.srt || data.text);
            sendToTab1Btn.disabled = !hasContent;
            sendToTab1Btn.classList.toggle('opacity-50', !hasContent);
            sendToTab1Btn.classList.toggle('cursor-not-allowed', !hasContent);
        }

        // 顯示警告（如果有）
        if (data.warning) {
            showToast(data.warning, { type: 'warning' });
        }

        // 顯示引擎與字幕數資訊
        const infoEl = document.getElementById('tab0-result-info');
        if (infoEl) {
            let engineLabel = '';
            if (isWhisper) {
                engineLabel = 'Whisper 專業版 (@cf/openai/whisper-large-v3-turbo)';
            } else if (data.engine === 'precise' || data.engine === 'precise_alignment') {
                engineLabel = '雙稿對齊超精準模式 (Whisper + Gemini)';
            } else {
                engineLabel = 'Gemini AI (gemini-1.5-flash)';
            }
            infoEl.textContent = `引擎：${engineLabel}${data.blockCount ? ` | 字幕段數：${data.blockCount}` : ''}`;
            infoEl.classList.remove('hidden');
        }

        // 渲染 alignmentReport (如果是 precise 模式且有 report)
        const reportContainer = document.getElementById('tab0-alignment-report-container');
        if (reportContainer) {
            const alignmentReport = data.alignmentReport || data.report;
            const isPreciseResult = data.engine === 'precise_alignment' || data.engine === 'precise';

            if (isPreciseResult && alignmentReport) {
                renderAlignmentReport(alignmentReport, reportContainer);
                reportContainer.classList.remove('hidden');
            } else {
                reportContainer.classList.add('hidden');
                reportContainer.innerHTML = '';
            }
        }
    }

    // --- 開始辨識按鈕 ---
    function updateTab0StartButton() {
        if (!startBtn) return;
        const hasFile = !!selectedFile;
        const engine = state.transcribeEngine;
        let canStart = hasFile;

        startBtn.disabled = !canStart;
        startBtn.classList.toggle('opacity-50', !canStart);
        startBtn.classList.toggle('cursor-not-allowed', !canStart);
    }

    if (startBtn) {
        startBtn.addEventListener('click', async () => {
            if (!selectedFile) {
                showToast('請先選擇音訊檔案。', { type: 'warning' });
                return;
            }

            if (state.transcribeEngine === 'whisper') {
                const hasWorkerUrl = !!(localStorage.getItem('aliang-tab0-worker-url') || sessionStorage.getItem('aliang-tab0-worker-url'));
                if (!hasWorkerUrl) {
                    showModal({
                        title: '缺少 Worker 連線設定',
                        message: '使用 Whisper 專業版需要設定 Cloudflare Worker。是否前往設定？',
                        buttons: [
                            { text: '取消', class: 'btn-secondary', callback: hideModal },
                            {
                                text: '前往設定', class: 'btn-primary', callback: () => {
                                    hideModal();
                                    if (showGlobalSettingsModal) showGlobalSettingsModal('settings-tab-worker');
                                }
                            }
                        ]
                    });
                    return;
                }
            } else if (state.transcribeEngine === 'gemini') {
                const hasApiKey = !!(localStorage.getItem('geminiApiKey') || sessionStorage.getItem('geminiApiKey'));
                if (!hasApiKey) {
                    showModal({
                        title: '缺少 Gemini API Key',
                        message: '使用 Gemini 模式需要設定 API Key。是否前往設定？',
                        buttons: [
                            { text: '取消', class: 'btn-secondary', callback: hideModal },
                            {
                                text: '前往設定', class: 'btn-primary', callback: () => {
                                    hideModal();
                                    if (showGlobalSettingsModal) showGlobalSettingsModal('settings-tab-gemini');
                                }
                            }
                        ]
                    });
                    return;
                }
            } else if (state.transcribeEngine === 'precise') {
                const hasWorkerUrl = !!(localStorage.getItem('aliang-tab0-worker-url') || sessionStorage.getItem('aliang-tab0-worker-url'));
                const hasApiKey = !!(localStorage.getItem('geminiApiKey') || sessionStorage.getItem('geminiApiKey'));
                if (!hasWorkerUrl || !hasApiKey) {
                    let missingMsg = '';
                    let targetTab = '';
                    if (!hasApiKey && !hasWorkerUrl) {
                        missingMsg = '使用超精準字幕模式需要同時設定 Gemini API Key 與 Cloudflare Worker 連線。';
                        targetTab = 'settings-tab-gemini';
                    } else if (!hasApiKey) {
                        missingMsg = '使用超精準字幕模式需要設定 Gemini API Key。';
                        targetTab = 'settings-tab-gemini';
                    } else {
                        missingMsg = '使用超精準字幕模式需要設定 Cloudflare Worker。';
                        targetTab = 'settings-tab-worker';
                    }
                    showModal({
                        title: '缺少連線或金鑰設定',
                        message: `${missingMsg}是否前往設定？`,
                        buttons: [
                            { text: '取消', class: 'btn-secondary', callback: hideModal },
                            {
                                text: '前往設定', class: 'btn-primary', callback: () => {
                                    hideModal();
                                    if (showGlobalSettingsModal) showGlobalSettingsModal(targetTab);
                                }
                            }
                        ]
                    });
                    return;
                }
            }

            const confirmDictAndStart = async () => {
                startBtn.disabled = true;

                state.currentAbortController = new AbortController();

                let cancelBtnContainer = document.getElementById('tab0-cancel-container');
                const modalInner = progressArea ? progressArea.firstElementChild : null;
                if (!cancelBtnContainer && modalInner) {
                    cancelBtnContainer = document.createElement('div');
                    cancelBtnContainer.id = 'tab0-cancel-container';
                    cancelBtnContainer.className = 'mt-6 flex justify-center w-full';
                    modalInner.appendChild(cancelBtnContainer);
                }

                let cancelBtn = document.getElementById('tab0-cancel-btn');
                if (!cancelBtn && cancelBtnContainer) {
                    cancelBtn = document.createElement('button');
                    cancelBtn.id = 'tab0-cancel-btn';
                    cancelBtn.className = 'font-bold py-2 px-4 rounded-lg text-xs hover:brightness-110 shadow-md transition-all btn-secondary flex items-center gap-1 text-red-400 border border-red-400/30';
                    cancelBtn.innerHTML = '<span class="material-symbols-outlined text-[18px]">cancel</span> 取消辨識';

                    cancelBtn.addEventListener('click', () => {
                        console.log('[Tab0] 使用者點擊取消辨識');
                        if (state.currentAbortController) {
                            console.log('[Tab0] AbortController abort called');
                            cancelBtn.disabled = true;
                            cancelBtn.innerHTML = '<span class="material-symbols-outlined text-[18px] animate-spin">progress_activity</span> 正在取消...';
                            state.currentAbortController.abort();
                        } else {
                            console.warn('[Tab0] 取消辨識時找不到 currentAbortController');
                        }
                    });
                    cancelBtnContainer.appendChild(cancelBtn);
                }

                if (cancelBtn) {
                    cancelBtn.classList.remove('hidden');
                    cancelBtn.disabled = false;
                    cancelBtn.innerHTML = '<span class="material-symbols-outlined text-[18px]">cancel</span> 取消辨識';
                }
                if (cancelBtnContainer) {
                    cancelBtnContainer.classList.remove('hidden');
                }

                try {
                    let result;
                    // 準備專有名詞 (只取 Positive)
                    let terminologyDict = '';
                    if (state.aiTerminologyRules && state.aiTerminologyRules.length > 0) {
                        const positiveTerms = state.aiTerminologyRules.filter(r => r.type === 'positive').map(r => r.term);
                        if (positiveTerms.length > 0) {
                            terminologyDict = positiveTerms.join(', ');
                        }
                    }

                    // 設定進度條為靜態模式（進度由 handleWhisperProgress 控制）
                    startProgressMessages(true);
                    if (progressMessage) progressMessage.textContent = '正在準備音訊...';

                    const srtPanel = document.getElementById('tab0-result-srt');
                    const emptyState = document.getElementById('tab0-empty-state');
                    if (emptyState) emptyState.classList.add('hidden');

                    const infoEl = document.getElementById('tab0-result-info');
                    if (infoEl) infoEl.classList.add('hidden');

                    // Hide all other panels, show SRT
                    document.querySelectorAll('.tab0-result-panel').forEach(p => p.classList.add('hidden'));
                    if (srtPanel) {
                        srtPanel.classList.remove('hidden');
                        srtPanel.textContent = '';
                    }

                    // Activate SRT tab
                    document.querySelectorAll('.tab0-result-tab').forEach(t => t.classList.remove('active'));
                    const srtTab = document.querySelector('.tab0-result-tab[data-target="tab0-result-srt"]');
                    if (srtTab) srtTab.classList.add('active');

                    let finalizedSrt = '';

                    const handleChunkComplete = (srtBlock) => {
                        if (finalizedSrt) finalizedSrt += '\n\n';
                        finalizedSrt += srtBlock;
                        if (srtPanel) {
                            srtPanel.textContent = finalizedSrt;
                            const resultArea = document.getElementById('tab0-result-area');
                            if (resultArea) resultArea.scrollTop = resultArea.scrollHeight;
                        }
                    };

                    const handleStream = (currentStreamText) => {
                        const streamDisplay = finalizedSrt ? finalizedSrt + '\n\n' + currentStreamText : currentStreamText;
                        if (srtPanel) {
                            srtPanel.textContent = streamDisplay;
                            const resultArea = document.getElementById('tab0-result-area');
                            if (resultArea) resultArea.scrollTop = resultArea.scrollHeight;
                        }
                    };

                    const reportContainer = document.getElementById('tab0-alignment-report-container');
                    if (reportContainer) {
                        reportContainer.classList.add('hidden');
                        reportContainer.innerHTML = '';
                    }

                    if (state.transcribeEngine === 'whisper') {
                        const tab0Badge = document.getElementById('tab0-model-badge');
                        if (tab0Badge) {
                            tab0Badge.classList.remove('hidden');
                            tab0Badge.textContent = '模型：whisper-large-v3-turbo';
                        }

                        const terminologyLines = (state.aiTerminologyRules || [])
                            .map(r => r.term?.trim())
                            .filter(Boolean);

                        const replacementLines = (state.batchReplaceRules || [])
                            .filter(r => r.original?.trim() && r.replacement?.trim())
                            .filter(r => r.original.trim() !== r.replacement.trim())
                            .map(r => `${r.original.trim()}=${r.replacement.trim()}`);

                        const customDict = [...terminologyLines, ...replacementLines].join('\n');

                        result = await transcribeWithWhisper(
                            selectedFile,
                            state.transcribeLanguage,
                            customDict,
                            handleWhisperProgress,
                            handleChunkComplete
                        );
                    } else if (state.transcribeEngine === 'precise') {
                        const tab0Badge = document.getElementById('tab0-model-badge');
                        if (tab0Badge) {
                            tab0Badge.classList.remove('hidden');
                            tab0Badge.textContent = '模型：雙稿精準對齊';
                        }
                        result = await transcribeWithPreciseAlignment(
                            selectedFile,
                            state.transcribeLanguage,
                            handleWhisperProgress,
                            handleChunkComplete,
                            handleStream
                        );
                        window.lastPreciseAlignmentResult = result;
                        window.lastAlignmentReport = result
                            ? (result.alignmentReport || result.report)
                            : undefined;
                        console.log('[超精準字幕][外層] result:', result);
                    } else {
                        // Gemini 模式：結合專有名詞 + 錯字替換提示
                        let geminiDict = '';
                        const terminologyLines = (state.aiTerminologyRules || [])
                            .map(r => r.term?.trim())
                            .filter(Boolean);
                        if (terminologyLines.length > 0) {
                            geminiDict = terminologyLines.join(', ');
                        }

                        if (state.batchReplaceRules && state.batchReplaceRules.length > 0) {
                            const replaceHints = state.batchReplaceRules.map(r => `「${r.original}」必須寫成「${r.replacement}」`).join('、');
                            geminiDict = geminiDict
                                ? geminiDict + '\n強制替換規則：' + replaceHints
                                : '強制替換規則：' + replaceHints;
                        }
                        result = await transcribeWithGemini(
                            selectedFile,
                            state.transcribeLanguage,
                            geminiDict,
                            handleWhisperProgress,
                            handleChunkComplete,
                            handleStream
                        );
                    }

                    displayResults(result);
                    showToast('🎉 語音辨識完成！', { type: 'success' });

                } catch (error) {
                    console.error('[Tab0] Transcription failed:', error);
                    if (isAbortError(error)) {
                        showToast('已取消辨識');
                    } else {
                        showTranscriptionErrorModal(error);
                    }
                } finally {
                    stopProgressMessages();
                    updateTab0StartButton();
                    const cancelBtn = document.getElementById('tab0-cancel-btn');
                    if (cancelBtn) {
                        cancelBtn.classList.add('hidden');
                        cancelBtn.disabled = false;
                        cancelBtn.innerHTML = '<span class="material-symbols-outlined text-[18px]">cancel</span> 取消辨識';
                    }
                    const cancelBtnContainer = document.getElementById('tab0-cancel-container');
                    if (cancelBtnContainer) {
                        cancelBtnContainer.classList.add('hidden');
                    }
                    if (state.currentAbortController) {
                        state.currentAbortController = null;
                    }
                }
            };

            showModal({
                title: '確認開始辨識',
                message: '是否需要設定「專有名詞」或「錯字替換」？\n(這些設定能大幅提升辨識準確度)\n如果您已經設定過或不需要，請點擊「直接開始」。',
                buttons: [
                    {
                        text: '設定錯字', class: 'btn-secondary', callback: () => {
                            hideModal();
                            if (showGlobalSettingsModal) showGlobalSettingsModal('settings-tab-typo');
                        }
                    },
                    {
                        text: '設定專有名詞', class: 'btn-secondary', callback: () => {
                            hideModal();
                            if (showGlobalSettingsModal) showGlobalSettingsModal('settings-tab-terminology');
                        }
                    },
                    {
                        text: '直接開始', class: 'btn-primary', callback: () => {
                            hideModal();
                            confirmDictAndStart();
                        }
                    }
                ]
            });
        });
    }

    // --- 匯出 SRT ---
    if (exportSrtBtn) {
        exportSrtBtn.addEventListener('click', () => {
            if (!state.transcribeResult?.srt) return;
            saveFile(state.transcribeResult.srt, (state.originalFileName || 'subtitle') + '.srt');
            showToast('SRT 檔案已下載！');
        });
    }

    // --- 匯出 VTT ---
    if (exportVttBtn) {
        exportVttBtn.addEventListener('click', () => {
            if (!state.transcribeResult?.vtt) return;
            saveFile(state.transcribeResult.vtt, (state.originalFileName || 'subtitle') + '.vtt');
            showToast('VTT 檔案已下載！');
        });
    }

    // --- 匯出文字檔 ---
    if (exportTxtBtn) {
        exportTxtBtn.addEventListener('click', () => {
            if (!state.transcribeResult?.text) return;
            saveFile(state.transcribeResult.text, (state.originalFileName || 'subtitle') + '.txt');
            showToast('文字檔案已下載！');
        });
    }

    // --- 傳入 Tab1 ---
    if (sendToTab1Btn) {
        sendToTab1Btn.addEventListener('click', () => {
            const content = state.transcribeResult?.srt || state.transcribeResult?.text || '';
            if (!content) {
                showToast('沒有可傳入的內容。', { type: 'warning' });
                return;
            }
            if (state.currentAbortController) {
                try { state.currentAbortController.abort(); } catch (_) { }
                state.currentAbortController = null;
            }
            window.dispatchEvent(new CustomEvent('lumina:clearDownstreamTabs'));
            const smartArea = document.getElementById('smart-area');
            if (smartArea) {
                smartArea.value = content;
                smartArea.dispatchEvent(new Event('input', { bubbles: true }));
            }
            switchTab('tab1');
            showToast('✅ 字幕已傳入 Tab1，準備開始整理！');
        });
    }

    // --- 教學面板折疊 ---
    if (helpToggleBtn && helpPanel) {
        helpToggleBtn.addEventListener('click', () => {
            helpPanel.classList.toggle('hidden');
        });
    }

    // 初始化按鈕狀態
    updateTab0StartButton();

    console.log("[Tab0] 字幕產生器初始化完成");
}

// ########## PRECISE ALIGNMENT TRANSCRIBER ##########

function stripReviewMarkers(text) {
    if (!text) return '';
    return String(text)
        .replace(/\s*\[請人工確認\]\s*/g, '')
        .replace(/\s*\[疑似辨識異常\]\s*/g, '')
        .replace(/\s*\[HIGH_DISAGREEMENT\]\s*/g, '')
        .trim();
}

function cleanAiFormatLeak(text) {
    if (text == null) return { isLeaked: false, cleaned: '' };
    const originalText = String(text);
    const cleanedText = originalText
        .replace(/```(?:json|javascript|js)?/gi, '')
        .replace(/```/g, '')
        .replace(/^\s*json\s*/i, '')
        .trim();
    return {
        isLeaked: originalText !== cleanedText,
        cleaned: cleanedText
    };
}

function isSuspiciousGarbageText(text) {
    if (!text) return false;
    // 1. 含有 \uFFFD
    if (text.includes('\uFFFD')) {
        return true;
    }
    // 2. 單一字元連續重複 5 次以上，例如 "啊啊啊啊啊"、"啦啦啦啦啦"
    if (/(.)\1{4,}/.test(text)) {
        return true;
    }
    // 3. 雙字或多字詞連續重複 3 次以上，例如 "對對對對對對"
    const cleanStr = text.replace(/[\s，。！？、：；,.!?;:'"「」『』（）()《》〈〉\[\]【】\-—…]/g, '');
    if (cleanStr.length > 0) {
        if (/(.{2,4})\1{2,}/.test(cleanStr)) {
            return true;
        }
    }
    // 4. 特殊罕見/控制字元或非英數非中文的字元佔比大於 15% (長度大於 20 時)
    const nonAlphaNumHan = text.replace(/[A-Za-z0-9\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\s，。！？、：；,.!?;:'"「」『』（）()《》〈〉\[\]【】\-—…]/g, '');
    if (text.length > 20 && nonAlphaNumHan.length > 0 && (nonAlphaNumHan.length / text.length) > 0.15) {
        return true;
    }
    return false;
}

function classifyGarbageRisk(text) {
    if (!text) return { level: 'low' };
    if (typeof isSuspiciousGarbageText === 'function' && isSuspiciousGarbageText(text)) {
        return { level: 'high' };
    }
    return { level: 'low' };
}

function isOralRepetition(text) {
    if (!text) return false;
    const cleanStr = text.replace(/[\s，。！？、：；,.!?;:'"「」『』（）()《》〈〉\[\]【】\-—…]/g, '');
    if (cleanStr.length === 0) return false;
    // 口語無意義重複的常見字 fallback
    return /^(啊|啦|嗯|哦|哈|對|是|呃)\1*$/.test(cleanStr);
}

function getSimilarity(s1, s2) {
    if (!s1 || !s2) return 0;
    const clean1 = s1.replace(/[\s，。！？、：；,.!?;:'"「」『』（）()《》〈〉\[\]【】\-—…]/g, '').toLowerCase();
    const clean2 = s2.replace(/[\s，。！？、：；,.!?;:'"「」『』（）()《》〈〉\[\]【】\-—…]/g, '').toLowerCase();
    if (!clean1 || !clean2) return 0;
    if (clean1 === clean2) return 1.0;

    const m = clean1.length;
    const n = clean2.length;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (clean1[i - 1] === clean2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = Math.min(
                    dp[i - 1][j] + 1,
                    dp[i][j - 1] + 1,
                    dp[i - 1][j - 1] + 1
                );
            }
        }
    }
    const distance = dp[m][n];
    const maxLength = Math.max(m, n);
    return (maxLength - distance) / maxLength;
}

function validatePreciseAlignmentOutput(finalSrt, finalTxt, whisperBlocks, alignmentReport) {
    const warnings = [];

    // 1. final SRT block 數是否等於 whisperBlocks.length
    const finalBlocks = parseSrtToBlocks(finalSrt);
    if (finalBlocks.length !== whisperBlocks.length) {
        warnings.push(`最終 SRT 段數 (${finalBlocks.length}) 與 Whisper 原始段數 (${whisperBlocks.length}) 不一致`);
    }

    // 2. final SRT 每段 id / startTime / endTime 是否與 whisperBlocks 完全一致
    // 4. 是否有 missing id
    const whisperBlocksMap = {};
    for (const wb of whisperBlocks) {
        whisperBlocksMap[wb.id] = wb;
    }

    const finalBlocksMap = {};
    for (const fb of finalBlocks) {
        finalBlocksMap[fb.id] = fb;
    }

    for (const wb of whisperBlocks) {
        const fb = finalBlocksMap[wb.id];
        if (!fb) {
            warnings.push(`最終 SRT 缺少 ID: ${wb.id}`);
        } else {
            if (fb.id !== wb.id) {
                warnings.push(`最終 SRT 段落 ID 順序或對應不一致。預期 ID: ${wb.id}`);
            }
            if (fb.startTime !== wb.startTime || fb.endTime !== wb.endTime) {
                warnings.push(`ID ${wb.id} 的時間戳與原始不一致。原始: ${wb.startTime} --> ${wb.endTime}, 最終: ${fb.startTime} --> ${fb.endTime}`);
            }
        }
    }

    for (const fb of finalBlocks) {
        if (!whisperBlocksMap[fb.id]) {
            warnings.push(`最終 SRT 多出未知 ID: ${fb.id}`);
        }
    }

    // 3. finalSrt / finalTxt 是否含有 [請人工確認]、[疑似辨識異常]、[HIGH_DISAGREEMENT]
    const forbiddenMarkers = ['[請人工確認]', '[疑似辨識異常]', '[HIGH_DISAGREEMENT]'];
    for (const marker of forbiddenMarkers) {
        if (finalSrt.includes(marker)) {
            warnings.push(`最終 SRT 含有不應存在的標記: ${marker}`);
        }
        if (finalTxt.includes(marker)) {
            warnings.push(`最終純文字 含有不應存在的標記: ${marker}`);
        }
    }

    // 5. 是否有疑似亂碼
    for (const fb of finalBlocks) {
        if (isSuspiciousGarbageText(fb.text)) {
            warnings.push(`ID ${fb.id} 的最終內容疑似亂碼: "${fb.text}"`);
        }
    }

    // 6. 是否有相鄰段落高度重複
    for (let i = 1; i < finalBlocks.length; i++) {
        const prevBlock = finalBlocks[i - 1];
        const currBlock = finalBlocks[i];
        if (getSimilarity(prevBlock.text, currBlock.text) >= 0.8) {
            warnings.push(`ID ${currBlock.id} 的文字與前一段 ID ${prevBlock.id} 高度重複: "${currBlock.text}"`);
        }
    }

    return warnings;
}
window.validatePreciseAlignmentOutput = validatePreciseAlignmentOutput;


function timeToMs(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.replace('.', ',').split(':');
    if (parts.length !== 3) return 0;
    const hrs = parseInt(parts[0], 10);
    const mins = parseInt(parts[1], 10);
    const secsParts = parts[2].split(',');
    const secs = parseInt(secsParts[0], 10);
    const ms = secsParts[1] ? parseInt(secsParts[1], 10) : 0;
    return hrs * 3600000 + mins * 60000 + secs * 1000 + ms;
}

function buildSemanticAlignmentGroups(blocks, options = {}) {
    const {
        maxGroupDurationMs = 12000,
        maxGroupChars = 220,
        maxGroupBlocks = 8,
        overlapBlocks = 2
    } = options;

    const groups = [];
    let currentGroupId = 1;
    let i = 0;
    const total = blocks.length;

    while (i < total) {
        const groupBlocks = [];
        let groupText = '';
        let startMs = 0;
        const startIndex = i;

        let j = i;
        while (j < total) {
            const block = blocks[j];
            const blockText = block.text || '';

            if (groupBlocks.length > 0) {
                if (groupBlocks.length >= maxGroupBlocks) break;

                const currentDuration = timeToMs(block.endTime) - startMs;
                if (currentDuration > maxGroupDurationMs) break;

                if ((groupText.length + blockText.length) > maxGroupChars) break;
            } else {
                startMs = timeToMs(block.startTime);
            }

            groupBlocks.push(block);
            groupText += (groupText ? ' ' : '') + blockText;

            // 遇到句尾標點且已累積至少 3 段則提前結束該群
            const endsWithPunct = /[。！？?！]/.test(blockText);
            if (endsWithPunct && groupBlocks.length >= 3) {
                j++;
                break;
            }

            j++;
        }

        const endIndex = j - 1;
        groups.push({
            groupId: currentGroupId++,
            startIndex,
            endIndex,
            blockIds: groupBlocks.map(b => b.id),
            startTime: groupBlocks[0].startTime,
            endTime: groupBlocks[groupBlocks.length - 1].endTime,
            contextText: groupText,
            blocks: groupBlocks.map(b => ({ id: b.id, text: b.text }))
        });

        if (j >= total) {
            break;
        }

        // 下一次的索引加上 overlap
        const nextStart = j - overlapBlocks;
        if (nextStart > i) {
            i = nextStart;
        } else {
            i = i + 1; // 防呆防死循環
        }
    }

    return groups;
}

function buildPreciseAlignmentBatches({
    whisperBlocks,
    semanticGroups,
    targetBlocksPerBatch = 20,
    minBlocksPerBatch = 18,
    maxBlocksPerBatch = 24,
    contextBeforeBlocks = 2,
    contextAfterBlocks = 2
}) {
    const batches = [];
    const totalBlocks = whisperBlocks.length;
    let currentIdx = 0;
    let batchIndex = 0;

    const blockToGroup = {};
    if (semanticGroups && semanticGroups.length) {
        semanticGroups.forEach(g => {
            g.blockIds.forEach(id => {
                if (!blockToGroup[id]) blockToGroup[id] = g.groupId;
            });
        });
    }

    while (currentIdx < totalBlocks) {
        let batchSize = targetBlocksPerBatch;
        const remaining = totalBlocks - currentIdx;

        if (remaining <= maxBlocksPerBatch) {
            batchSize = remaining;
        } else if (remaining < targetBlocksPerBatch + minBlocksPerBatch) {
            batchSize = Math.floor(remaining / 2);
        }

        let endIdx = Math.min(currentIdx + batchSize, totalBlocks);

        if (endIdx < totalBlocks) {
            const endBlockId = whisperBlocks[endIdx - 1].id;
            const nextBlockId = whisperBlocks[endIdx].id;

            if (blockToGroup[endBlockId] && blockToGroup[endBlockId] === blockToGroup[nextBlockId]) {
                let candidateExt = endIdx;
                while(candidateExt < totalBlocks && candidateExt - currentIdx <= maxBlocksPerBatch && blockToGroup[whisperBlocks[candidateExt].id] === blockToGroup[endBlockId]) {
                    candidateExt++;
                }

                if (candidateExt < totalBlocks && blockToGroup[whisperBlocks[candidateExt].id] !== blockToGroup[endBlockId]) {
                     endIdx = candidateExt;
                } else {
                     let candidateShr = endIdx - 1;
                     while(candidateShr > currentIdx && endIdx - candidateShr <= batchSize - minBlocksPerBatch && blockToGroup[whisperBlocks[candidateShr].id] === blockToGroup[endBlockId]) {
                         candidateShr--;
                     }
                     if (candidateShr > currentIdx && blockToGroup[whisperBlocks[candidateShr].id] !== blockToGroup[endBlockId]) {
                         endIdx = candidateShr + 1;
                     }
                }
            }
        }

        const targetBlocks = whisperBlocks.slice(currentIdx, endIdx).map(b => ({ id: b.id, text: b.text, startTime: b.startTime, endTime: b.endTime }));
        const contextStartIdx = Math.max(0, currentIdx - contextBeforeBlocks);
        const contextEndIdx = Math.min(totalBlocks, endIdx + contextAfterBlocks);
        const contextBlocks = whisperBlocks.slice(contextStartIdx, contextEndIdx).map(b => ({ id: b.id, text: b.text }));

        const batch = {
            batchIndex: batchIndex++,
            targetBlocks,
            contextBlocks,
            startSeconds: timeToMs(targetBlocks[0].startTime) / 1000,
            endSeconds: timeToMs(targetBlocks[targetBlocks.length - 1].endTime) / 1000,
            queryStartSeconds: timeToMs(whisperBlocks[contextStartIdx].startTime) / 1000,
            queryEndSeconds: timeToMs(whisperBlocks[contextEndIdx - 1].endTime) / 1000
        };

        batches.push(batch);
        currentIdx = endIdx;
    }

    return batches;
}

function getReferenceTextForTimeRange(allGeminiTexts, startSec, endSec, chunkDuration = 60) {
    const safeChunkDuration = Number.isFinite(chunkDuration) && chunkDuration > 0 ? chunkDuration : 60;
    const queryStart = Math.max(0, startSec - 15);
    const queryEnd = endSec + 15;

    const startIdx = Math.floor(queryStart / safeChunkDuration);
    const endIdx = Math.floor(queryEnd / safeChunkDuration);

    const relevantTexts = [];
    for (let i = startIdx; i <= endIdx && i < allGeminiTexts.length; i++) {
        if (allGeminiTexts[i]) relevantTexts.push(allGeminiTexts[i]);
    }
    return relevantTexts.join('\\n');
}

function mergeAlignedGroupResults(existingMap, newItems, originalBlocksById) {
    if (!Array.isArray(newItems)) return existingMap;

    const confidenceRank = {
        'high': 3,
        'medium': 2,
        'low': 1
    };

    for (const newItem of newItems) {
        if (!newItem || typeof newItem.id !== 'number') continue;
        if (originalBlocksById && !originalBlocksById[newItem.id]) continue;

        const text = typeof newItem.text === 'string' ? newItem.text : '';
        const cleanText = stripReviewMarkers(text);
        const confidence = ['high', 'medium', 'low'].includes(newItem.confidence) ? newItem.confidence : 'low';
        const source = ['main', 'reference', 'merged'].includes(newItem.source) ? newItem.source : 'main';
        const flags = Array.isArray(newItem.flags) ? newItem.flags : [];
        const note = typeof newItem.note === 'string' ? newItem.note : '';

        const validatedItem = {
            id: newItem.id,
            text: cleanText,
            confidence,
            source,
            flags,
            note
        };

        const existing = existingMap[newItem.id];
        if (!existing) {
            existingMap[newItem.id] = validatedItem;
        } else {
            const rankNew = confidenceRank[validatedItem.confidence] || 1;
            const rankExisting = confidenceRank[existing.confidence] || 1;

            if (rankNew > rankExisting) {
                existingMap[newItem.id] = validatedItem;
            } else if (rankNew === rankExisting) {
                const flagsCountNew = validatedItem.flags.length;
                const flagsCountExisting = existing.flags.length;

                if (flagsCountNew < flagsCountExisting) {
                    existingMap[newItem.id] = validatedItem;
                }
            }
        }
    }
    return existingMap;
}

function parseSrtToBlocks(srtText) {
    if (!srtText) return [];
    const blocks = [];
    const blockRegex = /(\d+)\r?\n(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})\r?\n([\s\S]*?)(?=\n\n|\n*$)/g;
    let match;
    while ((match = blockRegex.exec(srtText)) !== null) {
        blocks.push({
            id: parseInt(match[1]),
            startTime: match[2],
            endTime: match[3],
            text: match[4].trim()
        });
    }
    return blocks;
}

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function generateAlignmentReportText(report) {
    const lines = [];
    lines.push('超精準字幕對齊報告');
    lines.push('');
    lines.push(`總段數：${report.totalSegments}`);
    lines.push(`Gemini 修正：${report.geminiCorrected}`);
    lines.push(`Whisper 保留：${report.whisperRetained}`);
    lines.push(`待人工確認：${report.manualCheck}`);
    lines.push(`失敗段數：${report.failedSegments}`);
    lines.push('');

    lines.push('Validation Warnings：');
    if (report.validationWarnings && report.validationWarnings.length > 0) {
        report.validationWarnings.forEach(w => {
            lines.push(w);
        });
    } else {
        lines.push('時間軸與輸出驗證通過');
    }
    lines.push('');

    lines.push('可疑段落：');
    if (report.suspicious && report.suspicious.length > 0) {
        report.suspicious.forEach(item => {
            lines.push(`ID：${item.id}`);
            lines.push(`時間：${item.timeRange}`);
            lines.push(`Whisper 原文：${item.whisperText}`);
            lines.push(`校正後文字：${item.alignedText}`);
            lines.push(`confidence：${item.confidence}`);
            lines.push(`source：${item.source}`);
            lines.push(`flags：${Array.isArray(item.flags) ? item.flags.join(', ') : ''}`);
            lines.push(`note：${item.note || ''}`);
            lines.push('---');
        });
    } else {
        lines.push('無需人工確認段落');
    }

    return lines.join('\n');
}

function renderAlignmentReport(report, container) {
    if (!container || !report) return;

    const warningsCount = report.validationWarnings?.length || 0;
    const suspiciousCount = report.suspicious?.length || 0;

    container.innerHTML = `
        <details class="glass-card rounded-xl border border-outline-variant/10 shadow-lg text-on-surface bg-surface-container-low/40 backdrop-blur-md overflow-hidden group" open>
            <summary class="cursor-pointer font-semibold flex items-center justify-between text-on-surface select-none p-4 hover:bg-surface-variant/10 transition-all text-sm list-none [&::-webkit-details-marker]:hidden">
                <span class="flex items-center gap-2">
                    <span class="material-symbols-outlined text-[18px] text-primary">analytics</span>超精準字幕對齊報告
                </span>
                <span class="material-symbols-outlined transition-transform duration-300 group-open:rotate-180">expand_more</span>
            </summary>
            <div class="p-4 border-t border-outline-variant/10 bg-surface-container/20">
                <!-- Stats Grid -->
                <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 text-center mb-4">
                    <div class="bg-surface-variant/20 p-2.5 rounded-lg flex flex-col justify-between">
                        <div class="text-[10px] text-on-surface-variant mb-1">總段數</div>
                        <div class="text-base font-bold">${report.totalSegments}</div>
                    </div>
                    <div class="bg-primary/10 p-2.5 rounded-lg text-primary flex flex-col justify-between">
                        <div class="text-[10px] text-primary/80 mb-1">Gemini 修正</div>
                        <div class="text-base font-bold">${report.geminiCorrected}</div>
                    </div>
                    <div class="bg-success/15 p-2.5 rounded-lg text-success flex flex-col justify-between">
                        <div class="text-[10px] text-success/80 mb-1">Whisper 保留</div>
                        <div class="text-base font-bold">${report.whisperRetained}</div>
                    </div>
                    <div class="bg-warning/15 p-2.5 rounded-lg text-warning flex flex-col justify-between">
                        <div class="text-[10px] text-warning/80 mb-1">待人工確認</div>
                        <div class="text-base font-bold">${report.manualCheck}</div>
                    </div>
                    <div class="bg-error/10 p-2.5 rounded-lg text-error flex flex-col justify-between">
                        <div class="text-[10px] text-error/80 mb-1">失敗段數</div>
                        <div class="text-base font-bold">${report.failedSegments}</div>
                    </div>
                    <div class="bg-outline-variant/20 p-2.5 rounded-lg text-on-surface flex flex-col justify-between">
                        <div class="text-[10px] text-on-surface/80 mb-1">驗證警告</div>
                        <div class="text-base font-bold">${warningsCount}</div>
                    </div>
                    <div class="bg-error/15 p-2.5 rounded-lg text-error flex flex-col justify-between">
                        <div class="text-[10px] text-error/80 mb-1">可疑段落</div>
                        <div class="text-base font-bold">${suspiciousCount}</div>
                    </div>
                </div>

                <!-- Download Button Row -->
                <div class="flex justify-end mb-4">
                    <button id="tab0-download-alignment-report" class="font-bold py-2 px-4 rounded-lg bg-primary text-on-primary text-xs hover:brightness-110 shadow-md transition-all flex items-center gap-1.5 cursor-pointer">
                        <span class="material-symbols-outlined text-[16px]">download</span>下載對齊報告
                    </button>
                </div>

                <!-- Validation Warnings Section -->
                <div class="mb-4">
                    ${warningsCount === 0 ? `
                        <div class="p-3 bg-success/10 border border-success/20 rounded-lg text-xs text-success flex items-center gap-1.5 font-medium">
                            <span>✅ 時間軸與輸出驗證通過</span>
                        </div>
                    ` : `
                        <div class="p-3 bg-warning/10 border border-warning/20 rounded-lg text-xs text-warning">
                            <div class="font-semibold flex items-center gap-1 mb-1.5">
                                <span class="material-symbols-outlined text-[16px]">warning</span>時間軸與輸出驗證警告 (${warningsCount} 項)
                            </div>
                            <ul class="list-disc pl-4 space-y-1">
                                ${report.validationWarnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}
                            </ul>
                        </div>
                    `}
                </div>

                <!-- Suspicious Section -->
                <div>
                    ${suspiciousCount === 0 ? `
                        <div class="p-3 bg-success/10 border border-success/20 rounded-lg text-xs text-success flex items-center gap-1.5 font-medium">
                            <span>✅ 無需人工確認段落</span>
                        </div>
                    ` : `
                        <div class="text-xs bg-surface-variant/10 border border-outline-variant/10 rounded-lg p-3">
                            <div class="font-semibold text-on-surface-variant mb-2">可疑段落列表 (${suspiciousCount} 段)</div>
                            <div class="overflow-x-auto max-h-[350px]">
                                <table class="w-full text-left border-collapse">
                                    <thead>
                                        <tr class="border-b border-outline-variant/20 text-on-surface-variant font-semibold">
                                            <th class="py-2 px-2 w-12 text-center">ID</th>
                                            <th class="py-2 px-2 w-28 text-center font-mono">時間軸</th>
                                            <th class="py-2 px-2">Whisper 原文</th>
                                            <th class="py-2 px-2">校正後文字</th>
                                            <th class="py-2 px-2 text-center font-mono">信賴度 / 來源</th>
                                            <th class="py-2 px-2">對齊備註 / 旗標</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${report.suspicious.map(item => {
        const hasManual = item.flags?.includes('HIGH_DISAGREEMENT') || item.flags?.includes('UNCERTAIN');
        const badgeClass = hasManual ? 'bg-error/20 text-error' : 'bg-primary/20 text-primary';
        const flagsText = Array.isArray(item.flags) ? item.flags.join(', ') : '';
        return `
                                            <tr class="border-b border-outline-variant/10 hover:bg-surface-variant/10 transition-colors">
                                                <td class="py-2 px-2 text-center text-on-surface-variant font-semibold">${item.id}</td>
                                                <td class="py-2 px-2 text-center text-on-surface-variant font-mono text-[11px] whitespace-nowrap">${item.timeRange}</td>
                                                <td class="py-2 px-2 text-error/80 line-through">${escapeHtml(item.whisperText)}</td>
                                                <td class="py-2 px-2 text-success font-semibold">${escapeHtml(item.alignedText)}</td>
                                                <td class="py-2 px-2 text-center text-on-surface-variant font-mono text-[10px]">${item.confidence} / ${item.source}</td>
                                                <td class="py-2 px-2">
                                                    ${flagsText ? `<span class="px-1.5 py-0.5 rounded font-semibold text-[10px] ${badgeClass} inline-block mb-1">${flagsText}</span>` : ''}
                                                    <div class="text-[10px] text-on-surface-variant/70">${escapeHtml(item.note || '')}</div>
                                                </td>
                                            </tr>
                                            `;
    }).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    `}
                </div>
            </div>
        </details>
    `;

    // Bind click event for download button
    const downloadBtn = document.getElementById('tab0-download-alignment-report');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            const reportText = generateAlignmentReportText(report);
            saveFile(reportText, (state.originalFileName || 'subtitle') + '_alignment_report.txt');
            showToast('對齊報告下載成功！');
        });
    }
}

function shouldAddToSuspicious(aligned) {
    if (!aligned) return false;

    const flags = Array.isArray(aligned.flags) ? aligned.flags : [];
    const confidence = aligned.confidence || '';

    return (
        confidence === 'low' ||
        flags.includes('HIGH_DISAGREEMENT') ||
        flags.includes('UNCERTAIN') ||
        flags.includes('GARBAGE_TEXT_REJECTED') ||
        flags.includes('POSSIBLE_DUPLICATE') ||
        flags.includes('FAILED') ||
        flags.includes('REFERENCE_MISSING') ||
        flags.includes('MAIN_GARBLED_REFERENCE_USED')
    );
}

async function transcribeWithPreciseAlignment(file, language, onProgress = () => { }, onChunkComplete = () => { }, onStream = () => { }) {
    const apiKey = getBalancedApiKey();
    const workerUrl = localStorage.getItem('aliang-tab0-worker-url') || sessionStorage.getItem('aliang-tab0-worker-url');
    if (!apiKey) throw new Error("請先設定 Gemini API Key。");
    if (!workerUrl) throw new Error("請先設定 Whisper Worker 的 API URL。");

    // 1. 讀取並解碼音訊 (16kHz mono)
    onProgress({ type: 'status', message: '正在讀取音訊檔案（超精準對齊模式）...' });
    const arrayBuffer = await file.arrayBuffer();

    onProgress({ type: 'status', message: '正在解碼音訊（可能需要數秒）...' });
    const audioContext = new AudioContext();
    let rawBuffer;
    try {
        rawBuffer = await audioContext.decodeAudioData(arrayBuffer);
    } finally {
        await audioContext.close();
    }

    const durationMin = Math.round(rawBuffer.duration / 60);
    onProgress({ type: 'status', message: `正在轉換格式（16kHz mono，共 ${durationMin} 分鐘）...` });

    const TARGET_SR = 16000;
    const targetLen = Math.ceil(rawBuffer.length * TARGET_SR / rawBuffer.sampleRate) + TARGET_SR;
    const offlineCtx = new OfflineAudioContext(1, targetLen, TARGET_SR);
    const srcNode = offlineCtx.createBufferSource();
    srcNode.buffer = rawBuffer;
    srcNode.connect(offlineCtx.destination);
    srcNode.start(0);
    const resampled = await offlineCtx.startRendering();

    // ==========================================
    // PHASE 1: 取得 Gemini 參考稿 (逐段辨識純文字)
    // ==========================================
    const tab0Badge = document.getElementById('tab0-model-badge');
    if (tab0Badge) {
        tab0Badge.classList.remove('hidden');
        tab0Badge.textContent = '模型：Gemini（文字辨識）';
    }

    const GEMINI_CHUNK_DURATION = 60; // 每段 60 秒
    const geminiChunks = splitAudioBuffer(resampled, GEMINI_CHUNK_DURATION);
    const totalGeminiChunks = geminiChunks.length;

    onProgress({
        type: 'chunks',
        current: 0, total: totalGeminiChunks,
        message: `1/3：正在產生 Gemini 文字參考稿，共 ${totalGeminiChunks} 段...`,
        eta: '',
        label: 'Gemini 處理中...'
    });

    const allGeminiTexts = [];
    const geminiPrompt = `你是一位語音轉譯助理。請將以下音訊內容轉譯為高品質繁體中文逐字稿。請遵循以下規則：
1. 使用繁體中文輸出。
2. 不要摘要，不要改寫為文章，必須完整保留所有口語細節與口語詞（如：啊、呢、對、那等）。
3. 不要刪除任何操作步驟或關鍵名詞，若語意中提到特定的專業名詞或人名，請依語意與語境修正為正確漢字寫法。
4. 不要回傳時間戳，也不要輸出任何 SRT 或時間標註格式，請直接輸出逐字稿的連續文字。`;

    const geminiStartTimes = [];
    for (let i = 0; i < geminiChunks.length; i++) {
        if (state.currentAbortController?.signal?.aborted) {
            throw new Error('使用者已取消辨識');
        }
        const chunk = geminiChunks[i];
        const startMin = Math.floor(chunk.offsetSeconds / 60);
        const startSec = Math.floor(chunk.offsetSeconds % 60);

        let etaText = '';
        if (i > 0 && geminiStartTimes.length > 0) {
            const elapsed = (Date.now() - geminiStartTimes[0]) / 1000;
            const avgPerChunk = elapsed / i;
            const remaining = avgPerChunk * (totalGeminiChunks - i);
            etaText = remaining > 60
                ? `預估剩餘 ${Math.ceil(remaining / 60)} 分鐘`
                : `預估剩餘 ${Math.ceil(remaining)} 秒`;
        }

        onProgress({
            type: 'chunks',
            current: i + 1, total: totalGeminiChunks,
            message: `1/3：Gemini 文字辨識第 ${i + 1} 段（${startMin}:${String(startSec).padStart(2, '0')} 開始）`,
            eta: etaText,
            label: 'Gemini 處理中...'
        });

        geminiStartTimes.push(Date.now());

        const wavBlob = float32ToWavBlob(chunk.data, chunk.sampleRate);
        const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(wavBlob);
        });

        let rawResponse;
        let phase1RateLimitRetryCount = 0;
        let phase1Attempt = 0;

        while (true) {
            phase1Attempt++;
            try {
                // 呼叫 Gemini Audio API
                rawResponse = await callGeminiAudioAPI(apiKey, base64, 'audio/wav', geminiPrompt, (chunkText, fullText) => {
                    // 即時在 UI 流式顯示當前識別進度
                    const prevText = allGeminiTexts.join('\n\n');
                    onStream(prevText ? prevText + '\n\n' + fullText : fullText);
                }, state.currentAbortController?.signal);

                console.log(
                    `[Precise Transcribe] Phase 1 completed chunk ${i + 1}/${totalGeminiChunks}, attempts=${phase1Attempt}`
                );
                break;
            } catch (error) {
                if (isAbortError(error) || error?.name === 'AbortError') {
                    throw error;
                }

                const isRateLimit = isPureGeminiRateLimitError(error);

                console.warn(
                    `[Precise Transcribe] Phase 1 failed chunk ${i + 1}/${totalGeminiChunks}, attempt=${phase1Attempt}, rateLimit=${isRateLimit}`,
                    error
                );

                if (
                    !isRateLimit ||
                    phase1RateLimitRetryCount >= PRECISE_PHASE1_RATE_LIMIT_MAX_RETRIES
                ) {
                    throw error;
                }

                phase1RateLimitRetryCount++;

                // 更新 onProgress 讓使用者看到等待重試的狀態
                onProgress({
                    type: 'chunks',
                    current: i + 1,
                    total: totalGeminiChunks,
                    message: `1/3：Gemini 參考稿遇到頻率限制，${Math.ceil(PRECISE_PHASE1_RATE_LIMIT_RETRY_WAIT_MS / 1000)} 秒後重試第 ${phase1RateLimitRetryCount}/${PRECISE_PHASE1_RATE_LIMIT_MAX_RETRIES} 次`,
                    eta: etaText,
                    label: 'Gemini 處理中...'
                });

                console.warn(
                    `[Precise Transcribe] Phase 1 waiting ${Math.ceil(
                        PRECISE_PHASE1_RATE_LIMIT_RETRY_WAIT_MS / 1000
                    )} seconds before retrying chunk ${i + 1}/${totalGeminiChunks}, retry=${phase1RateLimitRetryCount}/${PRECISE_PHASE1_RATE_LIMIT_MAX_RETRIES}`
                );

                await waitForPureGeminiRetry(
                    PRECISE_PHASE1_RATE_LIMIT_RETRY_WAIT_MS,
                    state.currentAbortController?.signal
                );
            }
        }

        // 清理時間戳與序號
        let plainText = rawResponse
            .replace(/\d{2}:\d{2}:\d{2}[,.]\d{3} --> \d{2}:\d{2}:\d{2}[,.]\d{3}/g, '')
            .replace(/^\d+$/gm, '')
            .split('\n')
            .map(l => l.trim())
            .filter(Boolean)
            .join(' ');

        allGeminiTexts.push(plainText);

        // 避免 Rate Limit (15 RPM)
        if (i < geminiChunks.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 4500));
        }
    }

    const geminiReferenceText = allGeminiTexts.join('\n');

    // ==========================================
    // PHASE 2: 取得 Whisper 時間碼 (20秒切段)
    // ==========================================
    if (tab0Badge) {
        tab0Badge.classList.remove('hidden');
        tab0Badge.textContent = '模型：Whisper（時間軸辨識）';
    }

    const WHISPER_CHUNK_DURATION = 20;
    const whisperChunks = splitAudioBuffer(resampled, WHISPER_CHUNK_DURATION);
    const totalWhisperChunks = whisperChunks.length;

    onProgress({
        type: 'chunks',
        current: 0, total: totalWhisperChunks,
        message: `2/3：正在產生 Whisper 時間稿，共 ${totalWhisperChunks} 段...`,
        eta: '',
        label: 'Whisper 時間軸辨識中...'
    });

    // 準備專有名詞與替換規則傳給 Whisper
    const terminologyLines = (state.aiTerminologyRules || [])
        .map(r => r.term?.trim())
        .filter(Boolean);

    const replacementLines = (state.batchReplaceRules || [])
        .filter(r => r.original?.trim() && r.replacement?.trim())
        .filter(r => r.original.trim() !== r.replacement.trim())
        .map(r => `${r.original.trim()}=${r.replacement.trim()}`);

    const customDict = [...terminologyLines, ...replacementLines].join('\n');
    const validWorkerUrl = workerUrl.trim();
    const baseUrl = (/^https?:\/\//i.test(validWorkerUrl) ? validWorkerUrl : 'https://' + validWorkerUrl).replace(/\/+$/, '');
    const workerToken = localStorage.getItem('aliang-tab0-worker-token') || sessionStorage.getItem('aliang-tab0-worker-token');
    const authHeaders = workerToken ? { 'Authorization': `Bearer ${workerToken}` } : {};

    const whisperHeaders = { ...authHeaders, 'Content-Type': 'audio/wav' };
    if (language && language !== 'auto') {
        whisperHeaders['X-Language'] = language;
    }
    if (customDict) {
        whisperHeaders['X-Custom-Dict'] = encodeURIComponent(customDict);
    }

    const whisperStartTimes = [];
    const allWhisperSrtBlocks = [];
    let globalSeq = 1;

    for (let i = 0; i < whisperChunks.length; i++) {
        if (state.currentAbortController?.signal?.aborted) {
            throw new Error('使用者已取消辨識');
        }
        const chunk = whisperChunks[i];
        const startMin = Math.floor(chunk.offsetSeconds / 60);
        const startSec = Math.floor(chunk.offsetSeconds % 60);

        let etaText = '';
        if (i > 0 && whisperStartTimes.length > 0) {
            const elapsed = (Date.now() - whisperStartTimes[0]) / 1000;
            const avgPerChunk = elapsed / i;
            const remaining = avgPerChunk * (totalWhisperChunks - i);
            etaText = remaining > 60
                ? `預估剩餘 ${Math.ceil(remaining / 60)} 分鐘`
                : `預估剩餘 ${Math.ceil(remaining)} 秒`;
        }

        if (tab0Badge) {
            tab0Badge.classList.remove('hidden');
            tab0Badge.textContent = '模型：Whisper（時間軸辨識）';
        }

        onProgress({
            type: 'chunks',
            current: i + 1, total: totalWhisperChunks,
            message: `2/3：Whisper 時間辨識第 ${i + 1} 段（${startMin}:${String(startSec).padStart(2, '0')} 開始）`,
            eta: etaText,
            label: 'Whisper 時間軸辨識中...'
        });

        whisperStartTimes.push(Date.now());

        const wavBlob = float32ToWavBlob(chunk.data, chunk.sampleRate);

        let resp;
        let retries = 2;
        while (retries >= 0) {
            try {
                resp = await fetch(`${baseUrl}/api/transcribe`, {
                    method: 'POST',
                    headers: whisperHeaders,
                    body: wavBlob,
                    signal: state.currentAbortController ? state.currentAbortController.signal : undefined
                });
                if (resp.ok || resp.status === 401 || resp.status === 403) break;
                if (retries > 0) {
                    await new Promise(r => setTimeout(r, 2000));
                }
            } catch (err) {
                if (retries === 0) throw err;
                await new Promise(r => setTimeout(r, 2000));
            }
            retries--;
        }

        if (!resp || !resp.ok) {
            let errMsg = resp ? resp.statusText : '網路連線失敗';
            try { const j = await resp.json(); errMsg = j.error || errMsg; } catch (_) { }
            throw new Error(`Whisper 第 ${i + 1} 段辨識失敗: ${errMsg}`);
        }

        const data = await resp.json();
        const chunkSrt = data.srt || (data.vtt ? convertVttToSrt(data.vtt) : '');

        if (chunkSrt.trim()) {
            const monotonicChunkSrt = enforceMonotonicTimestamps(chunkSrt);
            const offsetted = offsetSrtTimestamps(monotonicChunkSrt, chunk.offsetSeconds, globalSeq - 1);
            const blocks = offsetted.split(/\n\n/).filter(b => b.trim());
            allWhisperSrtBlocks.push(...blocks);
            globalSeq += blocks.length;
        }
    }

    let finalWhisperSrt = allWhisperSrtBlocks.join('\n\n');
    finalWhisperSrt = enforceMonotonicTimestamps(finalWhisperSrt);
    const cleanedWhisperSrt = applyBatchReplaceToSrt(finalWhisperSrt, state.batchReplaceRules);

    // 解析成 blocks
    const whisperBlocks = parseSrtToBlocks(cleanedWhisperSrt);
    if (whisperBlocks.length === 0) {
        throw new Error('未從音訊中偵測到任何時間軸段落，無法進行校稿對齊。');
    }

    // ==========================================
    // PHASE 3: 雙稿精準校對 (導入語意群上下文對齊)
    // ==========================================
    const semanticGroups = buildSemanticAlignmentGroups(whisperBlocks, {
        maxGroupDurationMs: 12000,
        maxGroupChars: 220,
        maxGroupBlocks: 8,
        overlapBlocks: 2
    });

    const blockToGroupMap = {};
    for (const group of semanticGroups) {
        for (const id of group.blockIds) {
            if (!blockToGroupMap[id]) {
                blockToGroupMap[id] = group.groupId;
            }
        }
    }

    const alignmentBatches = buildPreciseAlignmentBatches({
        whisperBlocks,
        semanticGroups,
        targetBlocksPerBatch: 20,
        minBlocksPerBatch: 18,
        maxBlocksPerBatch: 24
    });
    const totalBatches = alignmentBatches.length;
    const alignedResultsMap = {};

    let geminiCorrected = 0;
    let whisperRetained = 0;
    let manualCheck = 0;
    let failedSegments = 0;
    const suspicious = [];
    let actualGeminiAlignmentCalls = 0;
    let fallbackBatchCount = 0;
    const debugBatches = [];
    const failedSegmentDetails = [];
    const failedBatches = [];
    const errors = [];

    // 準備使用者全域批次取代與自訂詞庫設定字串
    const userReplaceRulesText = (state.batchReplaceRules || [])
        .map(r => `原詞：${r.original} ➡️ 替換為：${r.replacement}`)
        .join('\n') || '無替換規則';

    const userTerminologyText = (state.aiTerminologyRules || [])
        .map(r => `專有名詞：${r.term} (類型：${r.type})`)
        .join('\n') || '無自訂詞庫';

    const settingsText = `使用者取代規則：\n${userReplaceRulesText}\n\n使用者自訂詞庫：\n${userTerminologyText}`;

    if (tab0Badge) {
        tab0Badge.classList.remove('hidden');
        tab0Badge.textContent = '模型：Gemini（語意群對齊）';
    }

    onProgress({
        type: 'chunks',
        current: 0, total: totalBatches,
        message: `3/3：正在進行雙稿對齊校核，共 ${totalBatches} 批次...`,
        eta: '',
        label: 'Gemini 處理中...'
    });

    for (let b = 0; b < totalBatches; b++) {
        if (state.currentAbortController?.signal?.aborted) {
            throw new Error('使用者已取消辨識');
        }
        onProgress({
            type: 'chunks',
            current: b + 1, total: totalBatches,
            message: `3/3：正在以語意群對齊第 ${b + 1} 批次字幕...`,
            eta: '',
            label: 'Gemini 處理中...'
        });

        const batch = alignmentBatches[b];
        const targetBlocks = batch.targetBlocks;
        const contextBlocks = batch.contextBlocks || [];

        const partialReferenceText = getReferenceTextForTimeRange(
            allGeminiTexts,
            batch.queryStartSeconds,
            batch.queryEndSeconds,
            GEMINI_CHUNK_DURATION
        );

        // 收集這一批次所有的 block ids 做後續校驗與 Fallback
        const batchBlockIds = new Set(targetBlocks.map(blk => blk.id));

        const prompt = `你是一位專業字幕對齊與校稿師。

現在有兩份資料：

A. Whisper 語意群組：
本批次需要被校正的 targetBlocks 以及僅供參考的 contextBlocks。
targetBlocks 是你這次「必須」且「只能」回傳的段落。
contextBlocks 是幫助你理解前後文的內容，請絕對不要回傳 contextBlocks 內的 ID。
每個 block 都有 id 與 text。
id 對應的時間碼已由程式鎖定，你不得修改。

B. Gemini 參考稿：
這份文字通常比較準，但時間碼可能不準，段落也可能較粗。
請只把它當成文字校正參考。

你的任務：
針對 targetBlocks 中的每個 id，根據 Gemini 參考稿修正 text。

重要規則：
1. 必須回傳 targetBlocks 中所有的 id，且「不准」回傳 contextBlocks 中的 id。
2. 不得新增 id。
3. 不得刪除 id。
4. 不得合併多個 id 或是重新分配時間。
5. 不得拆分 id。
6. 不得輸出時間碼與 SRT 格式。
7. 不得輸出說明文字與任何 markdown 外包裝。
8. text 欄位只能包含正式字幕文字，不得包含 [請人工確認]、[疑似辨識異常]、[HIGH_DISAGREEMENT] 等任何人工確認與警示標記文字。所有可疑狀態必須放在 flags 與 note，不得寫進 text。
9. 不得新增 A 和 B 都沒有支持的內容。
10. 如果 A 有內容但 B 疑似漏掉，請保留 A 的內容，flags 加上 "REFERENCE_MISSING"。
11. 如果 A 明顯是音近錯字，而 B 有合理對應文字，請使用 B 的文字，flags 加上 "REFERENCE_USED"。
12. 如果 A 明顯是亂碼或多餘插入字，而 B 有合理對應，請使用 B 的文字，flags 加上 "MAIN_GARBLED_REFERENCE_USED"。
13. 如果 A 和 B 差異過大，請選擇較可信的文字，但不得在 text 中加入任何人工確認標記。請將 flags 加上 "HIGH_DISAGREEMENT"，並在 note 中說明「兩稿差異較大，請人工確認」。
14. 如果無法判斷，請保留 A 的文字，flags 加上 "UNCERTAIN"。
15. 如果某一句話橫跨多個 blocks，請依照原 blocks 的切分方式，將文字合理保留在對應 id 中，不得把整句都塞到第一個 id。
16. 使用繁體中文。
17. 只輸出合法 JSON array。

回傳格式：
[
  {
    "id": 1,
    "text": "修正後文字",
    "confidence": "high",
    "source": "reference",
    "flags": ["REFERENCE_USED"],
    "note": "依 Gemini 參考稿修正音近錯字"
  }
]

以下是 Whisper 資料：
---
targetBlocks:
${JSON.stringify(targetBlocks, null, 2)}

contextBlocks (僅供參考):
${JSON.stringify(contextBlocks, null, 2)}
---

以下是 Gemini 參考稿：
---
${partialReferenceText}
---

以下是使用者全域批次取代與自訂詞庫設定：
---
${settingsText}
---`;

        let rawJsonResponse;
        let phase3RateLimitRetryCount = 0;
        let phase3Attempt = 0;
        let apiFailed = false;
        let finalApiError = null;

        while (true) {
            phase3Attempt++;
            try {
                actualGeminiAlignmentCalls++;
                rawJsonResponse = await callGeminiAPI(apiKey, prompt, true, null, state.currentAbortController?.signal);
                console.log(
                    `[Precise Transcribe] Phase 3 completed batch ${b + 1}/${totalBatches}, attempts=${phase3Attempt}`
                );
                apiFailed = false;
                break;
            } catch (error) {
                if (isAbortError(error) || error?.name === 'AbortError') {
                    throw error;
                }

                finalApiError = error;
                const isRateLimit = isPureGeminiRateLimitError(error);

                console.warn(
                    `[Precise Transcribe] Phase 3 failed batch ${b + 1}/${totalBatches}, attempt=${phase3Attempt}, rateLimit=${isRateLimit}`,
                    error
                );

                if (
                    isRateLimit &&
                    phase3RateLimitRetryCount < PRECISE_PHASE3_RATE_LIMIT_MAX_RETRIES
                ) {
                    phase3RateLimitRetryCount++;

                    onProgress({
                        type: 'chunks',
                        current: b + 1,
                        total: totalBatches,
                        message: `3/3：Gemini 對齊遇到頻率限制，${Math.ceil(PRECISE_PHASE3_RATE_LIMIT_RETRY_WAIT_MS / 1000)} 秒後重試第 ${phase3RateLimitRetryCount}/${PRECISE_PHASE3_RATE_LIMIT_MAX_RETRIES} 次`,
                        eta: '',
                        label: 'Gemini 處理中...'
                    });

                    await waitForPureGeminiRetry(
                        PRECISE_PHASE3_RATE_LIMIT_RETRY_WAIT_MS,
                        state.currentAbortController?.signal
                    );

                    continue;
                }

                apiFailed = true;
                break;
            }
        }

        let batchResult = [];
        if (apiFailed) {
            const isRateLimit = isPureGeminiRateLimitError(finalApiError);
            if (isRateLimit) {
                onProgress({
                    type: 'chunks',
                    current: b + 1,
                    total: totalBatches,
                    message: `3/3：第 ${b + 1}/${totalBatches} 批次 Gemini 對齊仍受頻率限制，已保留 Whisper 原文`,
                    eta: '',
                    label: 'Gemini 處理中...'
                });
            } else {
                onProgress({
                    type: 'chunks',
                    current: b + 1,
                    total: totalBatches,
                    message: `3/3：第 ${b + 1}/${totalBatches} 批次 Gemini 對齊失敗，已保留 Whisper 原文`,
                    eta: '',
                    label: 'Gemini 處理中...'
                });
            }

            fallbackBatchCount++;
            failedBatches.push({ batchIndex: b, error: finalApiError ? finalApiError.message : "未知 API 錯誤" });
        } else {
            try {
                const cleanJson = rawJsonResponse.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
                batchResult = JSON.parse(cleanJson);

                // Validate batchResult
                if (!Array.isArray(batchResult)) {
                     batchResult = [];
                     throw new Error("回傳格式非陣列");
                }
            } catch (err) {
                console.warn(`[Precise Transcribe] Batch ${b + 1} Gemini 對齊解析或格式錯誤：`, err);
                onProgress({
                    type: 'chunks',
                    current: b + 1,
                    total: totalBatches,
                    message: `3/3：第 ${b + 1}/${totalBatches} 批次 Gemini 對齊失敗，已保留 Whisper 原文`,
                    eta: '',
                    label: 'Gemini 處理中...'
                });
                fallbackBatchCount++;
                failedBatches.push({ batchIndex: b, error: err.message });
            }
        }

        const originalBlocksById = {};
        for (const block of whisperBlocks) {
            originalBlocksById[block.id] = block;
        }

        // 為了 debugBatches 報告保存結果
        const processedBatchResult = [];

        // mergeAlignedGroupResults 會將內容放入 alignedResultsMap
        mergeAlignedGroupResults(alignedResultsMap, batchResult, originalBlocksById);

        // 針對批次中缺失的 ID 進行 Fallback 安全機制
        for (const id of batchBlockIds) {
            if (!alignedResultsMap[id]) {
                failedSegments++;
                const block = originalBlocksById[id];
                const fallbackEntry = {
                    id: id,
                    text: block ? block.text : '',
                    confidence: 'low',
                    source: 'main',
                    flags: ['FAILED'],
                    note: 'Gemini 未回傳此 ID 資訊，已自動使用原 Whisper 文字'
                };
                alignedResultsMap[id] = fallbackEntry;
                processedBatchResult.push(fallbackEntry);
                failedSegmentDetails.push({ id, reason: "Missing ID" });
            } else {
                processedBatchResult.push(alignedResultsMap[id]);
            }
        }

        debugBatches.push({
            batchIndex: b,
            batchNumber: b + 1,
            totalBatches,
            targetBlockCount: targetBlocks.length,
            contextBlockCount: contextBlocks.length,
            queryStartSeconds: batch.queryStartSeconds,
            queryEndSeconds: batch.queryEndSeconds,
            partialReferenceTextLength: partialReferenceText.length,
            fullReferenceTextLength: geminiReferenceText.length,
            promptLength: prompt.length,
            batchResult: processedBatchResult
        });

        if (b < totalBatches - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    // ==========================================
    // 統計與產生報告
    // ==========================================
    const validationWarnings = [];
    // 使用抽出後的報表計算模組
    const newReportData = rebuildAlignmentReportFromExistingData({
        whisperBlocks,
        alignedResultsMap,
        existingReport: {},
        finalSrt: '',
        finalTxt: '',
        blockToGroupMap
    });

    // ==========================================
    // Step 6: 重組最終 SRT / VTT / TXT (進行最終防呆清除)
    // ==========================================
    const finalSrtBlocks = [];
    const finalPlainTexts = [];

    let cues = whisperBlocks.map(block => {
        const aligned = alignedResultsMap[block.id] || { text: block.text };
        const cleanText = stripReviewMarkers(aligned.text || block.text);
        return {
            id: block.id,
            startTime: block.startTime,
            endTime: block.endTime,
            text: cleanText
        };
    });

    cues = smoothSubtitleCueGaps(cues);

    for (const cue of cues) {
        finalSrtBlocks.push(`${cue.id}\n${cue.startTime} --> ${cue.endTime}\n${cue.text}`);
        finalPlainTexts.push(cue.text);
    }

    const finalSrt = finalSrtBlocks.join('\n\n');
    const finalVtt = 'WEBVTT\n\n' + finalSrt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    const finalTxt = finalPlainTexts.join('\n');

    // 進行最終格式與品質輸出驗證
    const alignmentReport = {
        totalSegments: whisperBlocks.length,
        geminiCorrected: newReportData.geminiCorrected,
        whisperRetained: newReportData.whisperRetained,
        manualCheck: newReportData.manualCheck,
        failedSegments,
        suspicious: newReportData.suspicious,
        validationWarnings: newReportData.validationWarnings,
        oralRepetitions: newReportData.oralRepetitions || [],
        debugBatches: debugBatches,
        failedSegmentDetails,
        failedBatches,
        errors
    };

    // 進行最終格式與品質輸出驗證
    const outputWarnings = validatePreciseAlignmentOutput(finalSrt, finalTxt, whisperBlocks, null);

    const combinedWarnings = [...alignmentReport.validationWarnings, ...outputWarnings];
    const uniqueWarningsMap = new Map();
    for (const w of combinedWarnings) {
        const match = w.match(/^(\[[^\]]+\] ID \d+:)/);
        if (match) {
            const key = match[1];
            if (!uniqueWarningsMap.has(key)) {
                uniqueWarningsMap.set(key, w);
            }
        } else {
            uniqueWarningsMap.set(w, w);
        }
    }
    alignmentReport.validationWarnings = Array.from(uniqueWarningsMap.values());

    const preciseAlignmentResult = {
        srt: finalSrt,
        vtt: finalVtt,
        text: finalTxt,
        engine: 'precise_alignment',
        blockCount: whisperBlocks.length,
        alignmentReport: alignmentReport,
        report: alignmentReport,
        debug: debugBatches,
        blocks: whisperBlocks
    };

    window.lastAlignmentReport = alignmentReport;
    window.lastPreciseAlignmentResult = preciseAlignmentResult;
    window.lastAlignedResultsMap = alignedResultsMap;

    window.lastPreciseAlignmentDebug = {
        alignedResultsMap: alignedResultsMap,
        debugBatches: debugBatches,
        actualGeminiAlignmentCalls: debugBatches.length,
        avgBlocksPerApiBatch: debugBatches.length > 0
            ? whisperBlocks.length / debugBatches.length
            : 0,
        fallbackBatchCount: debugBatches.filter(b => b.fallback || b.usedFallback).length,
        hasResult: !!window.lastPreciseAlignmentResult,
        hasSrt: typeof finalSrt === 'string' && finalSrt.length > 0,
        srtLength: finalSrt ? finalSrt.length : 0,
        containsReviewMarkers: {
            manualCheck: finalSrt.includes('[請人工確認]'),
            uncertain: finalSrt.includes('[疑似辨識異常]'),
            highDisagreement: finalSrt.includes('[HIGH_DISAGREEMENT]')
        },
        totalSegments: whisperBlocks.length,
        reportSuspiciousCount: alignmentReport.suspicious?.length || 0,
        validationWarningsCount: alignmentReport.validationWarnings?.length || 0
    };

    console.log('[超精準字幕] lastPreciseAlignmentResult:', window.lastPreciseAlignmentResult);
    console.log('[超精準字幕] alignmentReport:', window.lastAlignmentReport);
    console.log('[超精準字幕] debug:', window.lastPreciseAlignmentDebug);

    onProgress({ type: 'done', message: '對齊辨識完成！' });

    const srtPanel = document.getElementById('tab0-result-srt');
    if (srtPanel) srtPanel.textContent = finalSrt;

    return preciseAlignmentResult;
}


function rebuildAlignmentReportFromExistingData({
    whisperBlocks,
    alignedResultsMap,
    existingReport = {},
    finalSrt = '',
    finalTxt = '',
    blockToGroupMap = {}
}) {
    let geminiCorrected = 0;
    let whisperRetained = 0;
    let manualCheck = 0;
    const suspicious = [];
    const validationWarnings = [];
    const oralRepetitions = [];
    let prevAlignedInfo = null;

    for (let index = 0; index < whisperBlocks.length; index++) {
        const block = whisperBlocks[index];
        const aligned = alignedResultsMap[block.id] || { text: block.text, flags: [], note: '', source: 'main', confidence: 'low' };

        if (!Array.isArray(aligned.flags)) {
            aligned.flags = [];
        }

        let cleanAlignedText = stripReviewMarkers(aligned.text || '');
        const leakCheck = cleanAiFormatLeak(cleanAlignedText);
        if (leakCheck.isLeaked && leakCheck.cleaned.trim().length > 0) {
            cleanAlignedText = leakCheck.cleaned;
            if (!aligned.flags.includes('AI_FORMAT_LEAK_CLEANED')) {
                aligned.flags.push('AI_FORMAT_LEAK_CLEANED');
            }
            aligned.note = '已移除 AI 格式標記';
        }
        aligned.text = cleanAlignedText;

        const geminiGarbage = classifyGarbageRisk(cleanAlignedText);
        const whisperGarbage = classifyGarbageRisk(block.text);

        if (geminiGarbage.level === 'high') {
            aligned.text = block.text;
            aligned.source = 'main';
            aligned.confidence = 'low';

            if (!aligned.flags.includes('GARBAGE_TEXT_DETECTED')) aligned.flags.push('GARBAGE_TEXT_DETECTED');
            if (!aligned.flags.includes('GARBAGE_TEXT_REJECTED')) aligned.flags.push('GARBAGE_TEXT_REJECTED');

            if (whisperGarbage.level === 'high') {
                if (!aligned.flags.includes('NEEDS_MANUAL_REVIEW')) aligned.flags.push('NEEDS_MANUAL_REVIEW');
                aligned.note = '文字疑似亂碼，已保留較安全版本，請人工確認';
                validationWarnings.push(`[高風險亂碼] ID ${block.id}: 兩稿均疑似高風險亂碼，已保留原 Whisper 文字，請人工確認。`);
            } else {
                aligned.note = '文字疑似亂碼，已保留較安全版本，請人工確認';
                validationWarnings.push(`[高風險亂碼] ID ${block.id}: Gemini 參考稿疑似高風險亂碼，已自動保留較安全之 Whisper 原文 ("${block.text}")。`);
            }
        } else if (geminiGarbage.level === 'medium') {
            if (!aligned.flags.includes('POSSIBLE_GARBAGE')) aligned.flags.push('POSSIBLE_GARBAGE');
            aligned.note = '文字疑似異常，請人工確認';
            validationWarnings.push(`[中風險亂碼] ID ${block.id}: Gemini 修正內容疑似中風險亂碼 ("${aligned.text}")，請人工確認。`);
        }

        if (prevAlignedInfo) {
            const currentText = aligned.text || '';
            const prevText = prevAlignedInfo.aligned.text || '';
            if (getSimilarity(currentText, prevText) >= 0.8) {
                if (typeof isOralRepetition === 'function' && isOralRepetition(currentText)) {
                    oralRepetitions.push({
                        id: block.id,
                        previousId: prevAlignedInfo.block.id,
                        text: currentText,
                        reason: '自然口語重複，未列為驗證警告'
                    });
                } else {
                    if (!aligned.flags.includes('POSSIBLE_DUPLICATE')) {
                        aligned.flags.push('POSSIBLE_DUPLICATE');
                    }
                    aligned.note = '相鄰字幕文字高度重複，請人工確認';
                    validationWarnings.push(`[重複警告] ID ${block.id}: 文字與前一段 (ID ${prevAlignedInfo.block.id}) 高度重複 ("${currentText}")，請人工確認。`);
                }
            }
        }
        prevAlignedInfo = { block, aligned };
    }

    for (const block of whisperBlocks) {
        const aligned = alignedResultsMap[block.id] || { text: block.text, flags: [], note: '', source: 'main', confidence: 'low' };
        const cleanAlignedText = aligned.text || block.text;

        const isCorrected = aligned.source === 'reference' || aligned.source === 'merged' || cleanAlignedText !== block.text;
        if (isCorrected) {
            geminiCorrected++;
        } else {
            whisperRetained++;
        }

        if (shouldAddToSuspicious(aligned)) {
            let note = aligned.note;
            if (!note) {
                if (aligned.flags.includes('HIGH_DISAGREEMENT')) {
                    note = '兩稿差異較大，請人工確認';
                } else if (aligned.flags.includes('UNCERTAIN')) {
                    note = '不確定對齊內容';
                } else {
                    note = '一般異常，需要人工作業確認';
                }
            }
            suspicious.push({
                id: block.id,
                timeRange: `${block.startTime} --> ${block.endTime}`,
                whisperText: block.text,
                alignedText: cleanAlignedText,
                confidence: aligned.confidence,
                source: aligned.source,
                flags: aligned.flags,
                note: note,
                groupId: blockToGroupMap[block.id] || null
            });
            manualCheck++;
        }
    }

    const outputWarnings = finalSrt ? validatePreciseAlignmentOutput(finalSrt, finalTxt, whisperBlocks, null) : [];

    const combinedWarnings = [...validationWarnings, ...outputWarnings];
    const uniqueWarningsMap = new Map();
    for (const w of combinedWarnings) {
        const match = w.match(/^(\[[^\]]+\] ID \d+:)/);
        if (match) {
            const key = match[1];
            if (!uniqueWarningsMap.has(key)) {
                uniqueWarningsMap.set(key, w);
            }
        } else {
            uniqueWarningsMap.set(w, w);
        }
    }
    const allUniqueWarnings = Array.from(uniqueWarningsMap.values());

    return {
        ...existingReport,
        totalSegments: whisperBlocks.length,
        geminiCorrected,
        whisperRetained,
        manualCheck,
        suspicious,
        validationWarnings: allUniqueWarnings,
        oralRepetitions
    };
}

window.rebuildPreciseAlignmentReportOnly = function () {
    if (!window.lastAlignedResultsMap) {
        throw new Error('缺少 lastAlignedResultsMap，無法重新分類計算；目前可使用既有 lastAlignmentReport，但不能 report-only 重算。請在下一次正式第三階段完成後確認 alignedResultsMap 有保存。');
    }
    if (!window.lastPreciseAlignmentResult) {
        throw new Error('缺少 lastPreciseAlignmentResult，無法重算 report-only。');
    }
    if (!window.lastPreciseAlignmentCache || !window.lastPreciseAlignmentCache.whisperBlocks) {
        throw new Error('缺少 window.lastPreciseAlignmentCache.whisperBlocks，無法重算 report-only。');
    }

    const whisperBlocks = window.lastPreciseAlignmentCache.whisperBlocks;
    const alignedResultsMap = window.lastAlignedResultsMap;
    const finalSrt = window.lastPreciseAlignmentResult.srt;
    const finalTxt = window.lastPreciseAlignmentResult.text;

    const semanticGroups = buildSemanticAlignmentGroups(whisperBlocks, {
        maxGroupDurationMs: 12000,
        maxGroupChars: 220,
        maxGroupBlocks: 8,
        overlapBlocks: 2
    });

    const blockToGroupMap = {};
    for (const group of semanticGroups) {
        for (const id of group.blockIds) {
            if (!blockToGroupMap[id]) {
                blockToGroupMap[id] = group.groupId;
            }
        }
    }

    const newReport = rebuildAlignmentReportFromExistingData({
        whisperBlocks,
        alignedResultsMap,
        existingReport: window.lastAlignmentReport || {},
        finalSrt,
        finalTxt,
        blockToGroupMap
    });

    newReport.failedSegments = window.lastAlignmentReport?.failedSegments || 0;
    newReport.failedSegmentDetails = window.lastAlignmentReport?.failedSegmentDetails || [];
    newReport.failedBatches = window.lastAlignmentReport?.failedBatches || [];
    newReport.errors = window.lastAlignmentReport?.errors || [];

    window.lastAlignmentReport = newReport;
    window.lastPreciseAlignmentResult.alignmentReport = newReport;

    console.log('[PreciseAlignment] Report-only rebuild complete!', {
        suspicious: newReport.suspicious.length,
        oralRepetitions: newReport.oralRepetitions.length,
        validationWarnings: newReport.validationWarnings.length,
        manualCheck: newReport.manualCheck,
        failedSegments: newReport.failedSegments
    });

    return newReport;
};

window.savePreciseAlignmentSnapshot = function () {
    const snapshot = {
        savedAt: new Date().toISOString(),
        cache: window.lastPreciseAlignmentCache || null,
        result: window.lastPreciseAlignmentResult || null,
        report: window.lastAlignmentReport || null,
        debug: window.lastPreciseAlignmentDebug || null,
        alignedResultsMap:
            window.lastAlignedResultsMap ||
            window.lastPreciseAlignmentDebug?.alignedResultsMap ||
            null
    };

    if (snapshot.result && snapshot.report) {
        snapshot.result.alignmentReport = snapshot.report;
    }

    localStorage.setItem('preciseAlignmentSnapshot_latest', JSON.stringify(snapshot));

    console.log('Precise Alignment snapshot saved to localStorage.', {
        blockCount: snapshot.result?.blockCount,
        totalSegments: snapshot.report?.totalSegments,
        suspicious: snapshot.report?.suspicious?.length,
        oralRepetitions: snapshot.report?.oralRepetitions?.length,
        validationWarnings: snapshot.report?.validationWarnings?.length,
        manualCheck: snapshot.report?.manualCheck,
        failedSegments: snapshot.report?.failedSegments,
        hasAlignedResultsMap: !!snapshot.alignedResultsMap,
        alignedResultsMapCount: snapshot.alignedResultsMap ? Object.keys(snapshot.alignedResultsMap).length : 0
    });
};

window.restorePreciseAlignmentSnapshot = function () {
    const data = localStorage.getItem('preciseAlignmentSnapshot_latest');
    if (!data) {
        throw new Error('No snapshot found in localStorage.');
    }
    const snapshot = JSON.parse(data);

    window.lastPreciseAlignmentCache = snapshot.cache || null;
    window.lastPreciseAlignmentResult = snapshot.result || null;
    window.lastAlignmentReport = snapshot.report || snapshot.result?.alignmentReport || null;
    window.lastPreciseAlignmentDebug = snapshot.debug || null;
    window.lastAlignedResultsMap =
        snapshot.alignedResultsMap ||
        snapshot.debug?.alignedResultsMap ||
        null;

    if (window.lastPreciseAlignmentResult && window.lastAlignmentReport) {
        window.lastPreciseAlignmentResult.alignmentReport = window.lastAlignmentReport;
    }

    console.log('Precise Alignment snapshot restored.', {
        blockCount: window.lastPreciseAlignmentResult?.blockCount,
        totalSegments: window.lastAlignmentReport?.totalSegments,
        suspicious: window.lastAlignmentReport?.suspicious?.length,
        oralRepetitions: window.lastAlignmentReport?.oralRepetitions?.length,
        validationWarnings: window.lastAlignmentReport?.validationWarnings?.length,
        manualCheck: window.lastAlignmentReport?.manualCheck,
        failedSegments: window.lastAlignmentReport?.failedSegments,
        hasAlignedResultsMap: !!window.lastAlignedResultsMap,
        alignedResultsMapCount: window.lastAlignedResultsMap ? Object.keys(window.lastAlignedResultsMap).length : 0
    });
};

window.downloadPreciseAlignmentSnapshot = function () {
    const snapshot = {
        savedAt: new Date().toISOString(),
        cache: window.lastPreciseAlignmentCache,
        result: window.lastPreciseAlignmentResult,
        report: window.lastAlignmentReport,
        debug: window.lastPreciseAlignmentDebug,
        alignedResultsMap: window.lastAlignedResultsMap
    };
    const jsonStr = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `precise_alignment_snapshot_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log('Precise Alignment snapshot download triggered.');
};
