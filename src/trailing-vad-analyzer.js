import * as ort from 'onnxruntime-web/wasm';
import { NonRealTimeVAD, FrameProcessor } from '@ricky0123/vad-web';
import { SileroV5 } from '@ricky0123/vad-web/dist/models';

/**
 * 創建使用 Silero v5 模型的 NonRealTimeVAD 實例
 */
async function createNonRealTimeVADv5(options = {}) {
    if (options.model && options.model !== 'v5') {
        throw new Error(`本系統僅支援 Silero v5 模型分析，不支援: ${options.model}`);
    }

    const appBaseUrl = new URL(
        import.meta.env.BASE_URL,
        globalThis.location.origin
    );
    const vadBaseUrl = new URL('vad/', appBaseUrl);
    const modelUrl = new URL('silero_vad_v5.onnx', vadBaseUrl).href;

    const defaultOptions = {
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.35,
        redemptionMs: 300,
        preSpeechPadMs: 300,
        minSpeechMs: 250,
        submitUserSpeechOnPause: false,
        modelURL: modelUrl,
        modelFetcher: async (url) => {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`無法載入 VAD 模型檔案: ${url}`);
            return await res.arrayBuffer();
        },
        ortConfig: (ortInstance) => {
            // 啟用單線程以避免依賴 cross-origin isolation 或 SharedArrayBuffer 相容性問題
            ortInstance.env.wasm.numThreads = 1;
            // 明確配置 WASM 與 MJS 的本地路徑對照，避免加載錯 JSEP runtime
            const mjsUrl = new URL(
                'ort-wasm-simd-threaded.mjs',
                vadBaseUrl
            ).href;
            const wasmUrl = new URL(
                'ort-wasm-simd-threaded.wasm',
                vadBaseUrl
            ).href;
            ortInstance.env.wasm.wasmPaths = {
                mjs: mjsUrl,
                wasm: wasmUrl
            };
        }
    };

    const fullOptions = { ...defaultOptions, ...options };

    if (fullOptions.ortConfig) {
        fullOptions.ortConfig(ort);
    }

    const modelFetcher = () => fullOptions.modelFetcher(fullOptions.modelURL);
    const model = await SileroV5.new(ort, modelFetcher);

    // Silero v5 在 16kHz 下使用 512 樣本做為 frame size (32 ms)
    const frameSamples = 512;
    const msPerFrame = frameSamples / 16; // 32 ms
    const frameProcessor = new FrameProcessor(
        model.process,
        model.reset_state,
        {
            positiveSpeechThreshold: fullOptions.positiveSpeechThreshold,
            negativeSpeechThreshold: fullOptions.negativeSpeechThreshold,
            redemptionMs: fullOptions.redemptionMs,
            preSpeechPadMs: fullOptions.preSpeechPadMs,
            minSpeechMs: fullOptions.minSpeechMs,
            submitUserSpeechOnPause: fullOptions.submitUserSpeechOnPause,
        },
        msPerFrame
    );
    frameProcessor.resume();

    const vad = new NonRealTimeVAD(modelFetcher, ort, fullOptions, frameProcessor);
    // 確保 NonRealTimeVAD 內部執行 run 時也使用 512 樣本計算起訖時間與設定 resampler
    vad.frameSamples = frameSamples;
    return vad;
}

/**
 * 分析媒體結尾的連續無人聲區 (trailing non-speech)
 * @param {AudioBuffer} resampledBuffer - 已降採樣的單聲道 AudioBuffer (16000 Hz)
 * @param {Object} options - 分析參數
 */
export async function analyzeTrailingNonSpeech(resampledBuffer, options = {}) {
    if (options.model && options.model !== 'v5') {
        throw new Error(`本系統僅支援 Silero v5 模型分析，不支援: ${options.model}`);
    }
    const startTime = Date.now();
    const config = {
        analysisTailSeconds: options.analysisTailSeconds || 20,
        minimumTrailingNonSpeechSeconds: options.minimumTrailingNonSpeechSeconds || 2,
        safetyMarginSeconds: options.safetyMarginSeconds || 0.4,
        model: 'v5'
    };

    const mediaDurationSeconds = resampledBuffer.duration;
    const sampleRate = resampledBuffer.sampleRate;
    const channelData = resampledBuffer.getChannelData(0);

    // 1. 計算要分析的尾端區間
    const analysisDurationSeconds = Math.min(config.analysisTailSeconds, mediaDurationSeconds);
    const analysisStartSeconds = Math.max(0, mediaDurationSeconds - analysisDurationSeconds);
    
    const startSample = Math.floor(analysisStartSeconds * sampleRate);
    const endSample = Math.floor(mediaDurationSeconds * sampleRate);
    
    // 取得尾部音訊切片
    const tailPCM = channelData.subarray(startSample, endSample);

    // 2. 進行 windowed RMS / Peak / dBFS 診斷計算 (視窗大小 100 ms)
    const windowSizeMs = 100;
    const windowSizeSamples = Math.floor((windowSizeMs / 1000) * sampleRate);
    const rmsWindows = [];

    for (let i = 0; i < tailPCM.length; i += windowSizeSamples) {
        const slice = tailPCM.subarray(i, i + windowSizeSamples);
        if (slice.length === 0) continue;

        let sumSquare = 0;
        let peak = 0;
        for (let j = 0; j < slice.length; j++) {
            const val = slice[j];
            sumSquare += val * val;
            const absVal = Math.abs(val);
            if (absVal > peak) peak = absVal;
        }

        const rms = Math.sqrt(sumSquare / slice.length);
        const dbfs = rms > 0 ? 20 * Math.log10(rms) : -100;
        
        rmsWindows.push({
            offsetSeconds: analysisStartSeconds + (i / sampleRate),
            rms: Number(rms.toFixed(5)),
            peak: Number(peak.toFixed(5)),
            dbfs: Number(dbfs.toFixed(2))
        });
    }

    // 3. 執行 VAD 分析
    const speechSegments = [];
    let detected = false;
    let lastSpeechEndSeconds = null;
    let candidateNonSpeechStartSeconds = null;
    let trailingNonSpeechDurationSeconds = 0;
    let errorMsg = null;
    let success = false;

    try {
        if (tailPCM.length === 0) {
            throw new Error("PCM 資料為空，無法進行分析");
        }

        const vad = await createNonRealTimeVADv5({
            positiveSpeechThreshold: 0.5,
            negativeSpeechThreshold: 0.35
        });

        // 執行語意音訊偵測 (輸入採樣率必定為 16000)
        for await (const segment of vad.run(tailPCM, 16000)) {
            // vad 返回的 start 和 end 均為相對於傳入 tailPCM 起點的毫秒數，轉換成秒
            const relStartSec = segment.start / 1000;
            const relEndSec = segment.end / 1000;

            speechSegments.push({
                startSeconds: Number((analysisStartSeconds + relStartSec).toFixed(3)),
                endSeconds: Number((analysisStartSeconds + relEndSec).toFixed(3))
            });
        }

        success = true;

        if (speechSegments.length > 0) {
            // 找出最後一段語音的結束時間
            const lastSeg = speechSegments[speechSegments.length - 1];
            lastSpeechEndSeconds = lastSeg.endSeconds;
            candidateNonSpeechStartSeconds = Number((lastSpeechEndSeconds + config.safetyMarginSeconds).toFixed(3));
        } else {
            // 最後 20 秒完全沒人聲
            lastSpeechEndSeconds = analysisStartSeconds;
            candidateNonSpeechStartSeconds = analysisStartSeconds;
        }

        // 計算尾端連續無人聲長度
        trailingNonSpeechDurationSeconds = Number((mediaDurationSeconds - candidateNonSpeechStartSeconds).toFixed(3));

        if (trailingNonSpeechDurationSeconds >= config.minimumTrailingNonSpeechSeconds) {
            detected = true;
        }
    } catch (err) {
        console.warn('[VAD 診斷] 載入或推理過程出錯:', err);
        errorMsg = err.message || String(err);
    }

    const elapsedMs = Date.now() - startTime;

    return {
        success,
        detected,
        method: `silero-${config.model}-non-real-time-vad`,
        mediaDurationSeconds: Number(mediaDurationSeconds.toFixed(3)),
        analysisStartSeconds: Number(analysisStartSeconds.toFixed(3)),
        analysisDurationSeconds: Number(analysisDurationSeconds.toFixed(3)),
        lastSpeechEndSeconds: lastSpeechEndSeconds !== null ? Number(lastSpeechEndSeconds.toFixed(3)) : null,
        candidateNonSpeechStartSeconds: candidateNonSpeechStartSeconds !== null ? Number(candidateNonSpeechStartSeconds.toFixed(3)) : null,
        trailingNonSpeechDurationSeconds: Number(trailingNonSpeechDurationSeconds.toFixed(3)),
        minimumTrailingNonSpeechSeconds: config.minimumTrailingNonSpeechSeconds,
        safetyMarginSeconds: config.safetyMarginSeconds,
        elapsedMs,
        speechSegmentCount: speechSegments.length,
        speechSegments,
        rmsWindows,
        removedCount: 0,
        removedIds: [],
        diagnosticOnly: true,
        error: errorMsg
    };
}
