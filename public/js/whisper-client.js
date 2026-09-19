import { analyzeWavPcm, processWhisperResult, formatWhisperResult } from './whisper-processing.js';

// The server only returns model output. Audio analysis and quality retries belong
// to the browser so each inference request has a small Worker CPU budget.
export async function processWhisperChunk(wavBlob, requestRaw, options) {
    const audioAnalysis = analyzeWavPcm(await wavBlob.arrayBuffer());
    const attempt = async retry => {
        const payload = await requestRaw(retry);
        if (payload?.processing !== 'client-v1' || !payload.result) {
            throw new Error('Worker 未回傳瀏覽器處理模式資料，請確認已更新至 1.3.2 或更新版本。');
        }
        return processWhisperResult(payload.result, {
            ...options, audioAnalysis, usedMinimalInput: payload.usedMinimalInput,
        });
    };
    let selected = await attempt(false);
    let retried = false;
    if (selected.quality.suspect) {
        const retryResult = await attempt(true);
        retried = true;
        if (retryResult.quality.score > selected.quality.score) selected = retryResult;
    }
    return formatWhisperResult(selected, audioAnalysis, options.isFirstChunk, retried);
}
