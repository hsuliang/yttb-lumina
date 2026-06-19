const fs = require('fs');
let content = fs.readFileSync('public/js/tab0-transcribe.js', 'utf8');

// 1. Replace the fake progress bar logic in startBtn click listener
// We need to find the interval logic and remove it, making it use onProgress for both.
// Let's use string matching or Regex.
const oldProgressLogic = `
                let progressInterval;
                if (engine === 'gemini') {
                    startProgressMessages(false, estSec);
                }

                try {
                    let result;
                    if (engine === 'whisper') {
                        // Whisper 結合了強制替換和專有名詞 (因為 whisper 的 prompt 主要用來給定語境詞彙)
                        let whisperPrompt = terminologyDict;
                        if (state.batchReplaceRules && state.batchReplaceRules.length > 0) {
                            const replaceDict = '強制替換：\\n' + state.batchReplaceRules.map(r => \`\${r.original}=\${r.replacement}\`).join('\\n');
                            whisperPrompt = whisperPrompt ? whisperPrompt + '\\n' + replaceDict : replaceDict;
                        }

                        result = await transcribeWithWhisper(selectedFile, state.transcribeLanguage, whisperPrompt, (info) => {
                            if (info.type === 'chunks') {
                                // 更新進度條
                                const p = (info.current / info.total) * 100;
                                updateProgress(p, info.message, info.eta);
                            } else if (info.type === 'status' || info.type === 'done') {
                                updateProgress(null, info.message);
                            }
                        });
                    } else {
                        result = await transcribeWithGemini(selectedFile, state.transcribeLanguage, terminologyDict);
                    }
`;

const newProgressLogic = `
                let progressInterval;

                try {
                    let result;
                    const progressCallback = (info) => {
                        if (info.type === 'chunks') {
                            const p = (info.current / info.total) * 100;
                            updateProgress(p, info.message, info.eta);
                        } else if (info.type === 'status' || info.type === 'done') {
                            updateProgress(null, info.message);
                        }
                    };

                    if (engine === 'whisper') {
                        // Whisper 結合了強制替換和專有名詞 (因為 whisper 的 prompt 主要用來給定語境詞彙)
                        let whisperPrompt = terminologyDict;
                        if (state.batchReplaceRules && state.batchReplaceRules.length > 0) {
                            const replaceDict = '強制替換：\\n' + state.batchReplaceRules.map(r => \`\${r.original}=\${r.replacement}\`).join('\\n');
                            whisperPrompt = whisperPrompt ? whisperPrompt + '\\n' + replaceDict : replaceDict;
                        }

                        result = await transcribeWithWhisper(selectedFile, state.transcribeLanguage, whisperPrompt, progressCallback);
                    } else {
                        result = await transcribeWithGemini(selectedFile, state.transcribeLanguage, terminologyDict, progressCallback);
                    }
`;
if (!content.includes(oldProgressLogic.trim().substring(0, 50))) {
    console.log("Could not find oldProgressLogic!");
}
content = content.replace(oldProgressLogic, newProgressLogic);

// 2. Remove clearInterval logic for gemini
const oldClearInterval = `
                } finally {
                    if (engine === 'gemini') {
                        stopProgressMessages();
                    }
                    hideSpinner();
`;
const newClearInterval = `
                } finally {
                    stopProgressMessages(); // 確保清理
                    hideSpinner();
`;
content = content.replace(oldClearInterval, newClearInterval);

// 3. Replace transcribeWithGemini function
const oldTranscribeWithGeminiRegex = /async function transcribeWithGemini\(file, language, customDict\) \{[\s\S]*?return \{[\s\S]*?warning: null\n    \};\n\}/;

const newTranscribeWithGemini = `async function transcribeWithGemini(file, language, customDict, onProgress = () => {}) {
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
    onProgress({ type: 'status', message: \`正在轉換格式（16kHz mono，共 \${durationMin} 分鐘）...\` });

    const targetLen = Math.ceil(rawBuffer.duration * TARGET_SR);
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
        message: \`準備分段辨識，共 \${totalChunks} 段（每段 \${CHUNK_DURATION} 秒）\`,
        eta: '',
    });

    const allSrtBlocks = [];
    const allText = [];
    let globalSeq = 1;
    const chunkStartTimes = [];

    // 建構 prompt
    const prompt = buildTranscriptionPrompt(language, customDict);

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
                ? \`預估剩餘 \${Math.ceil(remaining / 60)} 分鐘\`
                : \`預估剩餘 \${Math.ceil(remaining)} 秒\`;
        }

        onProgress({
            type: 'chunks',
            current: i + 1, total: totalChunks,
            message: \`Gemini 辨識第 \${i + 1} 段（\${startMin}:\${String(startSec).padStart(2, '0')} 開始）\`,
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

        const rawResponse = await callGeminiAudioAPI(apiKey, base64, 'audio/wav', prompt);
        const result = validateAndFixSrt(rawResponse);

        if (!result.isValid) {
            console.warn(\`[Tab0] Gemini 第 \${i + 1} 段回傳內容無法解析為 SRT，原始回應：\`, rawResponse);
            // 如果某段失敗，我們只能把它當純文字
            allText.push(rawResponse);
        } else {
            if (result.srt.trim()) {
                const offsetted = offsetSrtTimestamps(result.srt, chunk.offsetSeconds, globalSeq - 1);
                const blocks = offsetted.split(/\\n\\n/).filter(b => b.trim());
                allSrtBlocks.push(...blocks);
                globalSeq += blocks.length;
            }
            if (result.plainText) allText.push(result.plainText.trim());
        }
    }

    const finalSrt = allSrtBlocks.join('\\n\\n');
    const finalVtt = 'WEBVTT\\n\\n' + finalSrt.replace(/(\\d{2}:\\d{2}:\\d{2}),(\\d{3})/g, '$1.$2');
    
    onProgress({ type: 'done', message: '全部辨識完成！' });

    return {
        text: allText.join('\\n'),
        vtt: finalVtt,
        srt: finalSrt,
        engine: 'gemini',
        blockCount: allSrtBlocks.length,
        warning: totalChunks > 1
            ? \`長音訊分段辨識：共 \${totalChunks} 段（每段 \${CHUNK_DURATION} 秒），SRT 時間戳已自動對齊合併。\`
            : null,
    };
}`;

if (!oldTranscribeWithGeminiRegex.test(content)) {
    console.log("Could not find transcribeWithGemini function via regex!");
} else {
    content = content.replace(oldTranscribeWithGeminiRegex, newTranscribeWithGemini);
}

fs.writeFileSync('public/js/tab0-transcribe.js', content);
console.log('tab0-transcribe.js updated successfully');
