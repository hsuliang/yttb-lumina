import { callGeminiAudioAPI } from './gemini-api.js';

import { showToast, showModal, hideModal, saveFile } from './ui-components.js';
import { state, AI_PROMPT_MESSAGES } from './state.js';
import { applyReplacementRules } from './srt-processor.js';
import { shouldConfirmSourceReplacement } from './content-source.js';
import { normalizeSrtTimeline, offsetSrtTimestamps, splitPcmByLowEnergy, splitPcmChunk } from './transcription-timeline.js';
import { getBalancedApiKey, showGlobalSettingsModal, switchTab } from './app.js';

/**
 * tab0-transcribe.js
 * Tab0 字幕產生器：支援 Gemini AI 與 Whisper Worker 雙軌模式。
 */

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
        dictInstruction = `\n\n特別要求：\n請嚴格遵守以下專有名詞，當遇到聽起來類似的詞彙時，必須輸出以下指定的正向詞彙：\n${customDict}`;
    }

    const durationMin = Math.ceil(chunkDuration / 60);
    const durationSec = Math.ceil(chunkDuration % 60);
    const maxTimeStr = `00:${String(durationMin).padStart(2, '0')}:${String(durationSec).padStart(2, '0')},000`;

    return `請將以下音訊內容轉寫為標準 SRT 字幕格式。${dictInstruction}

嚴格要求：
1. 語言偏好：${langHint}
2. 輸出格式必須是標準 SRT，範例如下：
   1
   00:00:00,000 --> 00:00:05,000
   這是第一句話的內容

   2
   00:00:05,000 --> 00:00:10,000
   這是第二句話的內容

3. 【極度重要】這是一段長度只有約 ${Math.ceil(chunkDuration)} 秒的音訊切片。你產出的所有時間戳必須從 00:00:00,000 開始計算。請確保將音訊中【最後一秒】的語音都完整辨識並加上時間戳，絕不可遺漏或截斷結尾的任何一句話。
4. 【強制格式】每段字幕只能有 1 行，不可換行。每行字幕的理想長度為「15 到 27 個字」，不可少於 10 個字（除非是極短語句），也不可超過 30 個字。如果語句過長，必須強制切分到下一個時間段。
5. 【強制切分】你必須依照講者的「呼吸換氣點」與「句點」切分時間區塊，每一段字幕的時間長度建議在 3 到 8 秒之間。絕對不可以把幾十秒的話塞進同一個時間區塊中！
6. 時間戳必須精準對應音訊中的語音位置，按時間順序排列，絕對不可發生時間倒退或重疊。
7. 序號必須從 1 開始，連續遞增
8. 只輸出 SRT 內容，不要加任何說明文字、開頭語或 markdown 格式標記
9. 逐字轉寫，不要遺漏或創造原始音訊中沒有的內容
10. 如果音訊中有靜音段，不要為靜音段產生字幕`;
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

    // 已經是標準格式 HH:MM:SS,mmm → 直接回傳
    if (/^\d{2}:\d{2}:\d{2},\d{3}$/.test(tc)) return tc;

    // 格式: HH:MM:SS.mmm → 換點為逗號
    if (/^\d{2}:\d{2}:\d{2}\.\d{3}$/.test(tc)) {
        return tc.replace('.', ',');
    }

    // 格式: MM:SS:mmm (如 00:01:400) → 補小時，冒號改逗號
    const mmssmmm = tc.match(/^(\d{1,2}):(\d{2}):(\d{3})$/);
    if (mmssmmm) {
        const mm = mmssmmm[1].padStart(2, '0');
        const ss = mmssmmm[2];
        const ms = mmssmmm[3];
        return `00:${mm}:${ss},${ms}`;
    }

    // 格式: MM:SS.mmm (如 01:23.456) → 補小時
    const mmssdotmmm = tc.match(/^(\d{1,2}):(\d{2})\.(\d{3})$/);
    if (mmssdotmmm) {
        const mm = mmssdotmmm[1].padStart(2, '0');
        const ss = mmssdotmmm[2];
        const ms = mmssdotmmm[3];
        return `00:${mm}:${ss},${ms}`;
    }

    // 格式: H:MM:SS,mmm 或 H:MM:SS.mmm → 補零
    const hmmss = tc.match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})$/);
    if (hmmss) {
        return `${hmmss[1].padStart(2, '0')}:${hmmss[2]}:${hmmss[3]},${hmmss[4]}`;
    }

    return null; // 無法識別
}

function validateAndFixSrt(rawText) {
    // 移除 markdown code block 包裝
    let text = String(rawText || '').trim();
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
    const protectedTerms = state.aiTerminologyRules
        .filter(rule => rule.type === 'positive')
        .map(rule => rule.term);
    return srtText.split('\n').map(line => {
        if (/^\d+$/.test(line.trim()) || line.includes('-->')) return line;
        return applyReplacementRules(line, rules, protectedTerms).text;
    }).join('\n');
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
        // VTT 用 . 分隔毫秒，SRT 用 , 分隔
        timeLine = timeLine.replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, '$1,$2');
        // 如果時間碼缺少小時，補上 00:
        timeLine = timeLine.replace(/^(\d{2}:\d{2},\d{3})/g, '00:$1');
        timeLine = timeLine.replace(/--> (\d{2}:\d{2},\d{3})/g, '--> 00:$1');

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

// ########## CORE: TRANSCRIBE FUNCTIONS ##########

async function transcribeWithGemini(file, language, customDict, onProgress = () => {}, onChunkComplete = () => {}, onStream = () => {}) {
    const apiKey = getBalancedApiKey();
    if (!apiKey) {
        throw new Error("請先設定 Gemini API Key。");
    }

    const CHUNK_DURATION = 180; // 3分鐘切段，確保 SRT 輸出不會超過 8192 token
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
    const failedRanges = [];
    let recoveredChunkCount = 0;

    const formatAudioTime = (seconds) => {
        const totalSeconds = Math.max(0, Math.round(seconds));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const remainingSeconds = totalSeconds % 60;
        return [hours, minutes, remainingSeconds].map(value => String(value).padStart(2, '0')).join(':');
    };

    const transcribeChunk = async (chunk) => {
        const prompt = buildTranscriptionPrompt(language, customDict, chunk.durationSeconds);
        const wavBlob = float32ToWavBlob(chunk.data, chunk.sampleRate);
        const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(wavBlob);
        });
        const rawResponse = await callGeminiAudioAPI(apiKey, base64, 'audio/wav', prompt, (chunkText, fullText) => {
            onStream(fullText);
        });
        return { rawResponse, result: validateAndFixSrt(rawResponse) };
    };

    const appendChunkResult = (chunk, result) => {
        if (result.srt.trim()) {
            const offsetted = offsetSrtTimestamps(result.srt, chunk.offsetSeconds, globalSeq - 1);
            const blocks = offsetted.split(/\n\n/).filter(block => block.trim());
            allSrtBlocks.push(...blocks);
            globalSeq += blocks.length;
            onChunkComplete(blocks.join('\n\n'));
        }
        if (result.plainText) allText.push(result.plainText.trim());
    };

    // 4. 逐段辨識並合併 SRT
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
            message: `Gemini 辨識第 ${i + 1} 段（${startMin}:${String(startSec).padStart(2, '0')} 開始）`,
            eta: etaText,
        });

        chunkStartTimes.push(Date.now());

        const primaryAttempt = await transcribeChunk(chunk);

        if (primaryAttempt.result.isValid) {
            appendChunkResult(chunk, primaryAttempt.result);
        } else {
            console.warn(`[Tab0] Gemini 第 ${i + 1} 段回傳內容無法解析為 SRT，改以 90 秒子分段補救。原始回應：`, primaryAttempt.rawResponse);
            const recoveryChunks = splitPcmChunk(chunk, 90);
            recoveredChunkCount++;

            for (let recoveryIndex = 0; recoveryIndex < recoveryChunks.length; recoveryIndex++) {
                const recoveryChunk = recoveryChunks[recoveryIndex];
                onProgress({
                    type: 'chunks',
                    current: i + 1,
                    total: totalChunks,
                    message: `第 ${i + 1} 段格式異常，補救辨識 ${recoveryIndex + 1}/${recoveryChunks.length}（${formatAudioTime(recoveryChunk.offsetSeconds)} 開始）`,
                    eta: '依 API 呼叫限制安全排程中',
                });

                const recoveryAttempt = await transcribeChunk(recoveryChunk);
                if (recoveryAttempt.result.isValid) {
                    appendChunkResult(recoveryChunk, recoveryAttempt.result);
                    continue;
                }

                const rangeStart = recoveryChunk.offsetSeconds;
                const rangeEnd = rangeStart + recoveryChunk.durationSeconds;
                failedRanges.push({
                    startSeconds: rangeStart,
                    endSeconds: rangeEnd,
                    label: `${formatAudioTime(rangeStart)}–${formatAudioTime(rangeEnd)}`,
                });
                const recoveryPlainText = String(recoveryAttempt.rawResponse || '').trim();
                if (recoveryPlainText) {
                    allText.push(recoveryPlainText);
                }
                console.warn(
                    `[Tab0] Gemini 補救分段 ${formatAudioTime(rangeStart)}–${formatAudioTime(rangeEnd)} 仍無法解析為 SRT，原始回應：`,
                    recoveryAttempt.rawResponse
                );
            }
        }

        // 額外保留分段間隔；底層 API 排程器仍會依每組 Key 的 RPM 安全間隔執行。
        if (i < chunks.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 4500));
        }
    }

    let finalSrt = allSrtBlocks.join('\n\n');
    // 第一階段：對辨識結果套用錯別字替換（後處理）
    finalSrt = applyBatchReplaceToSrt(finalSrt, state.batchReplaceRules);
    const protectedTerms = state.aiTerminologyRules.filter(rule => rule.type === 'positive').map(rule => rule.term);
    const finalText = applyReplacementRules(allText.join('\n'), state.batchReplaceRules, protectedTerms).text;
    const finalVtt = 'WEBVTT\n\n' + finalSrt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    
    onProgress({
        type: 'done',
        message: failedRanges.length > 0 ? '辨識流程結束，部分區段需要重新處理。' : '全部辨識完成！'
    });

    let warning = null;
    if (failedRanges.length > 0) {
        warning = `辨識未完整：${failedRanges.map(range => range.label).join('、')} 仍無法產生有效字幕。已保留其他成功內容。`;
    } else if (recoveredChunkCount > 0) {
        warning = `有 ${recoveredChunkCount} 個 180 秒分段格式異常，已自動拆成 90 秒補回；SRT 時間軸已依原始音訊位置重新對齊。`;
    } else if (totalChunks > 1) {
        warning = `長音訊分段辨識：共 ${totalChunks} 段（每段 ${CHUNK_DURATION} 秒），SRT 時間戳已自動對齊合併。`;
    }

    return {
        text: finalText,
        vtt: finalVtt,
        srt: finalSrt,
        engine: 'gemini',
        blockCount: allSrtBlocks.length,
        warning,
        incomplete: failedRanges.length > 0,
        failedRanges,
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
async function transcribeWithWhisper(file, language, customDict, onProgress = () => {}, onChunkComplete = () => {}) {
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
    const targetLen = Math.ceil(rawBuffer.length * TARGET_SR / rawBuffer.sampleRate);
    const offlineCtx = new OfflineAudioContext(1, targetLen, TARGET_SR);
    const srcNode = offlineCtx.createBufferSource();
    srcNode.buffer = rawBuffer;
    srcNode.connect(offlineCtx.destination);
    srcNode.start(0);
    const resampled = await offlineCtx.startRendering();

    // 3. 切段
    const chunks = splitPcmByLowEnergy(
        resampled.getChannelData(0),
        resampled.sampleRate,
        CHUNK_DURATION,
        2,
        8
    );
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
    const failedRanges = [];

    async function requestWhisperChunk(chunk, displayIndex, previousContext = '', recoveryDepth = 0) {
        const wavBlob = float32ToWavBlob(chunk.data, chunk.sampleRate);
        const chunkHeaders = {
            ...authHeaders,
            'Content-Type': 'audio/wav',
            'X-Chunk-Index': String(displayIndex),
            'X-Chunk-Offset': String(chunk.offsetSeconds),
            'X-First-Chunk': chunk.offsetSeconds < 0.001 ? '1' : '0',
            'X-Media-Title': encodeURIComponent(file.name.replace(/\.[^.]+$/, '').slice(0, 160)),
        };
        if (language && language !== 'auto') chunkHeaders['X-Language'] = language;
        if (customDict) chunkHeaders['X-Custom-Dict'] = encodeURIComponent(customDict);
        if (previousContext) {
            chunkHeaders['X-Previous-Context'] = encodeURIComponent(previousContext.slice(-240));
        }

        let response;
        let retries = 2;
        while (retries >= 0) {
            try {
                response = await fetch(`${baseUrl}/api/transcribe`, {
                    method: 'POST',
                    headers: {
                        ...chunkHeaders,
                        'X-Recovery-Depth': String(recoveryDepth),
                        'X-Request-Attempt': String(3 - retries),
                    },
                    body: wavBlob,
                    signal: state.currentAbortController ? state.currentAbortController.signal : undefined
                });
                if (response.ok || response.status === 401 || response.status === 403) break;
                if (response.status < 500 && response.status !== 429) break;
                if (retries > 0) {
                    onProgress({
                        type: 'status',
                        message: `第 ${displayIndex + 1} 段伺服器忙碌，重試中... (${3 - retries}/2)`
                    });
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            } catch (error) {
                if (error?.name === 'AbortError' || retries === 0) throw error;
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            retries--;
        }

        if (!response?.ok) {
            let errorMessage = response ? response.statusText : '網路連線失敗';
            let errorBody = null;
            try {
                errorBody = await response.json();
                errorMessage = errorBody.error || errorMessage;
            } catch (_) {}
            if (response && (response.status === 401 || response.status === 403)) {
                throw new Error('Worker Token 驗證失敗，請檢查設定。');
            }
            const requestError = new Error(
                `第 ${displayIndex + 1} 段辨識失敗 (${response ? response.status : 'Network'}): ${errorMessage}`
            );
            requestError.status = response?.status || 0;
            requestError.code = errorBody?.code || '';
            requestError.retryable = Boolean(errorBody?.retryable);
            throw requestError;
        }
        const payload = await response.json();
        const { normalizeTranscriptionPayload } = await import('./transcription-text.js');
        return normalizeTranscriptionPayload(payload, language);
    }

    async function transcribeChunkWithRecovery(
        chunk,
        displayIndex,
        recoveryDepth = 0,
        previousContext = ''
    ) {
        const recoverAsShorterChunks = async (message) => {
            onProgress({
                type: 'status',
                message,
            });
            const childDuration = Math.max(3, chunk.durationSeconds / 2);
            const children = splitPcmChunk(chunk, childDuration);
            if (children.length <= 1) return null;

            const recovered = [];
            let childContext = previousContext;
            for (const child of children) {
                const childResults = await transcribeChunkWithRecovery(
                    child,
                    displayIndex,
                    recoveryDepth + 1,
                    childContext
                );
                recovered.push(...childResults);
                const childText = childResults.map(result => result.data.text || '').join(' ').trim();
                if (childText) childContext = `${childContext} ${childText}`.trim().slice(-240);
            }
            return recovered;
        };

        let data;
        try {
            data = await requestWhisperChunk(chunk, displayIndex, previousContext, recoveryDepth);
        } catch (error) {
            if (error?.code === 'AI_INVALID_INPUT' && recoveryDepth < 2 && chunk.durationSeconds > 6) {
                const recovered = await recoverAsShorterChunks(
                    `第 ${displayIndex + 1} 段被模型拒絕，正在改用較短片段...`
                );
                if (recovered) return recovered;
            }
            throw error;
        }

        if (data.quality?.suspect && recoveryDepth < 2 && chunk.durationSeconds > 6) {
            const recovered = await recoverAsShorterChunks(
                `第 ${displayIndex + 1} 段品質偏低，正在拆成較短片段重新辨識...`
            );
            if (recovered) return recovered;
        }
        return [{ chunk, data }];
    }

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
        const previousContext = allText.slice(-3).join(' ').slice(-240);
        let results;
        try {
            results = await transcribeChunkWithRecovery(chunk, i, 0, previousContext);
        } catch (error) {
            failedRanges.push({
                start: chunk.offsetSeconds,
                end: chunk.offsetSeconds + chunk.durationSeconds,
                reasons: [error?.code || 'request_failed'],
                message: error?.message || '辨識請求失敗',
            });
            onProgress({
                type: 'status',
                message: `第 ${i + 1} 段重試後仍失敗，已保留其他辨識結果。`,
            });
            continue;
        }
        for (const result of results) {
            const { chunk: resultChunk, data } = result;
            const chunkSrt = data.srt || (data.vtt ? convertVttToSrt(data.vtt) : '');

            if (chunkSrt.trim()) {
                const offsetted = offsetSrtTimestamps(chunkSrt, resultChunk.offsetSeconds, globalSeq - 1);
                const blocks = offsetted.split(/\n\n/).filter(block => block.trim());
                allSrtBlocks.push(...blocks);
                globalSeq += blocks.length;
                onChunkComplete(blocks.join('\n\n'));
            }
            if (data.text) allText.push(data.text.trim());
            if (data.quality?.suspect) {
                failedRanges.push({
                    start: resultChunk.offsetSeconds,
                    end: resultChunk.offsetSeconds + resultChunk.durationSeconds,
                    reasons: data.quality.reasons || [],
                });
            }
        }
    }

    let finalSrt = normalizeSrtTimeline(allSrtBlocks.join('\n\n'));
    // 第一階段：對辨識結果套用錯別字替換（後處理）
    finalSrt = applyBatchReplaceToSrt(finalSrt, state.batchReplaceRules);
    const protectedTerms = state.aiTerminologyRules.filter(rule => rule.type === 'positive').map(rule => rule.term);
    const finalText = applyReplacementRules(allText.join('\n'), state.batchReplaceRules, protectedTerms).text;
    const finalVtt = 'WEBVTT\n\n' + finalSrt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    const finalBlockCount = finalSrt ? finalSrt.split(/\n\s*\n/).filter(Boolean).length : 0;
    const requestFailures = failedRanges.filter(range => range.reasons?.some(
        reason => reason === 'request_failed' || String(reason).startsWith('AI_')
    ));
    const requestFailureLabels = requestFailures
        .map(range => `${formatAudioTime(range.start)}–${formatAudioTime(range.end)}`)
        .join('、');
    
    onProgress({ type: 'done', message: '全部辨識完成！' });

    return {
        text: finalText,
        vtt: finalVtt,
        srt: finalSrt,
        engine: 'whisper',
        blockCount: finalBlockCount,
        incomplete: failedRanges.length > 0,
        failedRanges,
        warning: failedRanges.length > 0
            ? requestFailures.length > 0
                ? `有 ${requestFailures.length} 個片段重試後仍無法辨識（${requestFailureLabels}），其他內容已保留。`
                : `有 ${failedRanges.length} 個片段經重試後品質仍偏低，請優先人工複核。`
            : totalChunks > 1
                ? `長音訊分段辨識：共 ${totalChunks} 段（約 ${CHUNK_DURATION} 秒並優先在低音量處切分），SRT 時間戳已自動對齊合併。`
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
    const savedLanguage = localStorage.getItem(TAB0_STORAGE_KEYS.language) || 'zh';

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
            const pct = info.total > 0 ? ((info.current - 1) / info.total) * 100 : 0;
            if (chunkBarEl) chunkBarEl.style.width = `${pct}%`;
            if (chunkCounterEl) chunkCounterEl.textContent = `${info.current - 1 < 0 ? 0 : info.current - 1} / ${info.total}`;
            if (chunkLabelEl) {
                const engineText = state.transcribeEngine === 'whisper' ? 'Whisper' : 'Gemini';
                chunkLabelEl.textContent = `${engineText} 處理中...`;
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
        if (data.warning && !data.incomplete) {
            showToast(data.warning, { type: 'warning' });
        }

        // 顯示引擎與字幕數資訊
        const infoEl = document.getElementById('tab0-result-info');
        if (infoEl) {
            const engineLabel = isWhisper ? 'Whisper 專業版 (@cf/openai/whisper-large-v3-turbo)' : 'Gemini AI (gemini-1.5-flash)';
            infoEl.textContent = `引擎：${engineLabel}${data.blockCount ? ` | 字幕段數：${data.blockCount}` : ''}`;
            infoEl.classList.remove('hidden');
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
                            { text: '前往設定', class: 'btn-primary', callback: () => {
                                hideModal();
                                if (showGlobalSettingsModal) showGlobalSettingsModal('settings-tab-worker');
                            }}
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
                            { text: '前往設定', class: 'btn-primary', callback: () => {
                                hideModal();
                                if (showGlobalSettingsModal) showGlobalSettingsModal('settings-tab-gemini');
                            }}
                        ]
                    });
                    return;
                }
            }

            const confirmDictAndStart = async () => {
                startBtn.disabled = true;

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

                    if (state.transcribeEngine === 'whisper') {
                        const tab0Badge = document.getElementById('tab0-model-badge');
                        if (tab0Badge) {
                            tab0Badge.classList.remove('hidden');
                            tab0Badge.textContent = '模型：whisper-large-v3-turbo';
                        }
                        
                        // 專有名詞作為提示；錯字替換同時交給 Worker 與前端最終輸出確定性執行。
                        const { buildWhisperDictionary } = await import('./transcription-text.js');
                        const whisperPrompt = buildWhisperDictionary(
                            state.aiTerminologyRules,
                            state.batchReplaceRules
                        );

                        result = await transcribeWithWhisper(
                            selectedFile,
                            state.transcribeLanguage,
                            whisperPrompt,
                            handleWhisperProgress,
                            handleChunkComplete
                        );
                    } else {
                        // Gemini 模式同樣只提供專有名詞辨識提示。
                        let geminiDict = terminologyDict;
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
                    if (result.incomplete) {
                        showToast(result.warning || '辨識未完整，請檢查結果。', { type: 'error' });
                    } else {
                        showToast('🎉 語音辨識完成！', { type: 'success' });
                    }

                } catch (error) {
                    console.error('[Tab0] Transcription failed:', error);
                    showToast(`辨識失敗：${error.message}`, { type: 'error' });
                } finally {
                    stopProgressMessages();
                    updateTab0StartButton();
                }
            };

            const positiveTermCount = state.aiTerminologyRules
                .filter(rule => rule.type === 'positive' && rule.term?.trim()).length;
            const replacementRuleCount = state.batchReplaceRules
                .filter(rule => rule.original?.trim()).length;
            showModal({
                title: '確認開始辨識',
                message: `本次已載入：專有名詞 ${positiveTermCount} 條、錯字替換 ${replacementRuleCount} 條。\n是否需要先調整設定？\n如果不需要，請點擊「直接開始」。`,
                buttons: [
                    { text: '設定錯字', class: 'btn-secondary', callback: () => {
                        hideModal();
                        if (showGlobalSettingsModal) showGlobalSettingsModal('settings-tab-typo');
                    }},
                    { text: '設定專有名詞', class: 'btn-secondary', callback: () => {
                        hideModal();
                        if (showGlobalSettingsModal) showGlobalSettingsModal('settings-tab-terminology');
                    }},
                    { text: '直接開始', class: 'btn-primary', callback: () => {
                        hideModal();
                        confirmDictAndStart();
                    }}
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

    // --- 傳入逐字稿整理頁面 ---
    if (sendToTab1Btn) {
        sendToTab1Btn.addEventListener('click', () => {
            const content = state.transcribeResult?.srt || state.transcribeResult?.text || '';
            if (!content) {
                showToast('沒有可傳入的內容。', { type: 'warning' });
                return;
            }
            const smartArea = document.getElementById('smart-area');
            if (!smartArea) return;

            const replaceAndOpenTab1 = () => {
                if (state.currentAbortController) {
                    try { state.currentAbortController.abort(); } catch (_) {}
                    state.currentAbortController = null;
                }
                smartArea.value = content;
                smartArea.dispatchEvent(new Event('input', { bubbles: true }));
                window.dispatchEvent(new Event('lumina:showTab1Input'));
                switchTab('tab1');
                showToast('✅ 字幕已傳入「逐字稿整理」頁面，準備開始整理！');
            };

            if (shouldConfirmSourceReplacement(smartArea.value, content)) {
                showModal({
                    title: '取代目前逐字稿？',
                    message: '逐字稿整理頁面已有另一份逐字稿。取代後，系統會清除由舊逐字稿產生的摘要、文章與其他內容。',
                    buttons: [
                        { text: '取消', class: 'btn-secondary', callback: hideModal },
                        { text: '取代', class: 'btn-danger', callback: () => {
                            hideModal();
                            replaceAndOpenTab1();
                        }}
                    ]
                });
                return;
            }

            replaceAndOpenTab1();
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
