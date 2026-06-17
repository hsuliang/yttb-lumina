/**
 * yttb-lumina Whisper Worker
 * 部署在 Cloudflare Workers，使用 @cf/openai/whisper-large-v3-turbo 模型
 *
 * 端點：
 *   GET  /api/health     → 健康檢查
 *   POST /api/transcribe → 音訊辨識（Binary WAV 或 multipart/form-data）
 *
 * 環境變數（選填）：
 *   API_TOKEN → 若設定，所有請求須帶 "Authorization: Bearer {token}"
 */

const WORKER_VERSION = '1.0.0';
const MODEL = '@cf/openai/whisper-large-v3-turbo';
const MAX_AUDIO_SIZE_MB = 28; // 略低於 Whisper 上限以保留緩衝

// ─── 時間戳處理工具 ──────────────────────────────────────────────
function parseTimestampToMs(timeStr) {
    const cleaned = timeStr.replace(',', '.').trim();
    const parts = cleaned.split(':');
    if (parts.length === 2) {
        // MM:SS.mmm
        const mins = parseInt(parts[0], 10);
        const secs = parseFloat(parts[1]);
        return Math.round((mins * 60 + secs) * 1000);
    } else if (parts.length === 3) {
        // HH:MM:SS.mmm
        const hours = parseInt(parts[0], 10);
        const mins = parseInt(parts[1], 10);
        const secs = parseFloat(parts[2]);
        return Math.round((hours * 3600 + mins * 60 + secs) * 1000);
    }
    return 0;
}

function formatMsToSrtTime(ms) {
    const h   = Math.floor(ms / 3600000);
    const min = Math.floor((ms % 3600000) / 60000);
    const s   = Math.floor((ms % 60000) / 1000);
    const ms2 = ms % 1000;
    return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms2).padStart(3,'0')}`;
}

// ─── VTT → SRT 轉換 ──────────────────────────────────────────────
function vttToSrt(vttText) {
    let text = (vttText || '').trim();
    // 移除 WEBVTT header 與 NOTE 區塊
    text = text.replace(/^WEBVTT\s*\n*/m, '');
    text = text.replace(/NOTE[\s\S]*?\n\n/g, '');
    text = text.trim();

    const blocks = text.split(/\n\s*\n/).filter(b => b.trim().length > 0);
    let seqNum = 1;
    const srtBlocks = [];

    for (const block of blocks) {
        const lines = block.trim().split('\n').filter(l => l.trim().length > 0);
        const timeLineIdx = lines.findIndex(l => l.includes('-->'));
        if (timeLineIdx === -1) continue;

        const timeLine = lines[timeLineIdx];
        const times = timeLine.split('-->');
        if (times.length !== 2) continue;

        const startMs = parseTimestampToMs(times[0]);
        const endMs = parseTimestampToMs(times[1]);

        const subtitleText = lines.slice(timeLineIdx + 1).join('\n').trim();
        if (!subtitleText) continue;

        const srtTimeLine = `${formatMsToSrtTime(startMs)} --> ${formatMsToSrtTime(endMs)}`;
        srtBlocks.push(`${seqNum}\n${srtTimeLine}\n${subtitleText}`);
        seqNum++;
    }

    return srtBlocks.join('\n\n');
}

// ─── 合併字元級 SRT → 完整句子 ────────────────────────────────────
// Whisper 對中文會產生每字一段的細粒度字幕，需要合併成完整句子
// 斷句基準（優先順序）：
//   1. 遇到句子結尾標點（。！？…）→ 強制斷段
//   2. 時間間距 > maxGapMs ms（長暫停） → 強制斷段
//   3. 單句時長超過 maxDurationMs（避免字幕過長） → 強制斷段
//   ❌ 不用字數當基準，保持完整語意
function mergeSrtBlocks(srtText, maxGapMs = 800, maxDurationMs = 5000) {
    if (!srtText || !srtText.trim()) return srtText;

    // 解析 SRT 塊
    const blocks = srtText.trim().split(/\n\n/).filter(b => b.trim());
    const parsed = [];

    for (const block of blocks) {
        const lines = block.trim().split('\n');
        if (lines.length < 3) continue;
        const timeLine = lines[1];
        const times = timeLine.split('-->');
        if (times.length !== 2) continue;

        const startMs = parseTimestampToMs(times[0]);
        const endMs = parseTimestampToMs(times[1]);
        const text = lines.slice(2).join(' ').trim();
        parsed.push({ startMs, endMs, text });
    }

    if (parsed.length === 0) return srtText;

    // 斷句標點：句號、驚嘆號、問號、省略號（逗號/頓號視為句中，不強制斷）
    const hardEnders = /[。！？…]/;

    const merged = [];
    let cur = null;

    for (const blk of parsed) {
        if (!cur) {
            cur = { startMs: blk.startMs, endMs: blk.endMs, text: blk.text };
            continue;
        }
        const gap = blk.startMs - cur.endMs;
        const duration = blk.endMs - cur.startMs;
        const hasPunctuation = hardEnders.test(cur.text.slice(-1)); // 句子結尾標點
        
        const isLongPause = gap > maxGapMs;                         // 長暫停
        const isTooLong = duration > maxDurationMs                  // 超過 5 秒安全上限
            || cur.text.length >= 25;                               // 超過 25 個字強制斷行

        // 斷行規則：
        // 1. 有標點且長度 >= 3
        // 2. 遇到長暫停 (無條件斷行)
        // 3. 句子太長或時間太久 (無條件斷行)
        const shouldBreak = (hasPunctuation && cur.text.length >= 3)
            || isLongPause
            || isTooLong;

        if (shouldBreak) {
            merged.push(cur);
            cur = { startMs: blk.startMs, endMs: blk.endMs, text: blk.text };
        } else {
            cur.endMs = blk.endMs;
            const needsSpace = /[a-zA-Z0-9]$/.test(cur.text) && /^[a-zA-Z0-9]/.test(blk.text);
            cur.text = cur.text + (needsSpace ? ' ' : '') + blk.text;
        }
    }
    if (cur) merged.push(cur);

    return merged
        .map((b, i) => `${i+1}\n${formatMsToSrtTime(b.startMs)} --> ${formatMsToSrtTime(b.endMs)}\n${b.text.trim()}`)
        .join('\n\n');
}


// ─── CORS ─────────────────────────────────────────────────────────
function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Language, X-Custom-Dict',
        'Access-Control-Max-Age': '86400',
    };
}

// ─── 工具函式 ─────────────────────────────────────────────────────
function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
}

function errorResponse(message, status = 400) {
    return jsonResponse({ error: message }, status);
}

function checkAuth(request, env) {
    // 若沒有設定 API_TOKEN，則不驗證
    if (!env.API_TOKEN) return true;
    const auth = request.headers.get('Authorization') || '';
    if (!auth.startsWith('Bearer ')) return false;
    return auth.slice(7).trim() === env.API_TOKEN;
}

// ─── 主要 Handler ─────────────────────────────────────────────────
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const method = request.method;

        // CORS Preflight
        if (method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders() });
        }

        // 健康檢查不需要 Token
        if (url.pathname === '/api/health' && method === 'GET') {
            return jsonResponse({
                status: 'ok',
                model: MODEL,
                version: WORKER_VERSION,
                maxAudioMB: MAX_AUDIO_SIZE_MB,
                authRequired: !!env.API_TOKEN,
            });
        }

        // 其他端點需要驗證
        if (!checkAuth(request, env)) {
            return errorResponse('Unauthorized: 請提供有效的 Bearer Token', 401);
        }

        // 辨識端點
        if (url.pathname === '/api/transcribe' && method === 'POST') {
            return handleTranscribe(request, env);
        }

        return errorResponse('Not Found', 404);
    },
};

// ─── 辨識端點 ─────────────────────────────────────────────────────
async function handleTranscribe(request, env) {
    try {
        // 一律走 Binary 模式（分段 WAV，主要路徑）
        const audioBuffer = await request.arrayBuffer();
        const language = request.headers.get('X-Language') || null;

        if (!audioBuffer || audioBuffer.byteLength === 0) {
            return errorResponse('音訊資料為空，請確認上傳的檔案');
        }

        // 大小檢查
        const sizeMB = audioBuffer.byteLength / 1024 / 1024;
        if (sizeMB > MAX_AUDIO_SIZE_MB) {
            return errorResponse(
                `音訊區塊大小 ${sizeMB.toFixed(1)}MB 超過單段上限 ${MAX_AUDIO_SIZE_MB}MB。請使用分段模式。`,
                413
            );
        }

        // 將音訊轉為 Base64 字串 (Cloudflare AI binding 接收大檔案時，陣列會被強制轉為錯誤的字串，Base64 則可穩健通過)
        const uint8 = new Uint8Array(audioBuffer);
        // 使用更高效的轉換方式，避免大檔案時超過 call stack 限制
        // 但由於 Worker 沒有 Buffer，這裡分段處理或使用 btoa
        let binary = '';
        const chunkSize = 8192;
        for (let i = 0; i < uint8.length; i += chunkSize) {
            const chunk = uint8.subarray(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, chunk);
        }
        const audioBase64 = btoa(binary);

        const input = {
            audio: audioBase64,
        };
        
        // 🚨 關鍵修復：之前的代理對陣列大小有限制，會導致 string 化報錯
        // 我們測試過 Base64 字串是可以成功通過驗證的，所以直接採用原本成功的 Base64 寫法
        
        const customDictHeader = request.headers.get('X-Custom-Dict') || '';
        const customDict = customDictHeader ? decodeURIComponent(customDictHeader) : '';
        
        let promptWords = [];
        let replaceRules = [];
        
        if (customDict) {
            const items = customDict.split(/[\n,，]+/).map(i => i.trim()).filter(i => i);
            for (const item of items) {
                if (item.includes('=') || item.includes('＝')) {
                    const parts = item.split(/=|＝/);
                    if (parts.length >= 2) {
                        const wrong = parts[0].trim();
                        const correct = parts.slice(1).join('=').trim();
                        if (wrong && correct) {
                            replaceRules.push({ wrong, correct });
                            promptWords.push(correct); // 也把正確字加進 prompt
                        }
                    }
                } else {
                    promptWords.push(item);
                }
            }
        }
        
        // 加入 prompt 和 language
        let basePrompt = '以下是繁體中文的對話：';
        if (promptWords.length > 0) {
            basePrompt += `\n包含專有名詞：${promptWords.join('、')}`;
        }
        input.initial_prompt = basePrompt;
        
        const lang = language && language !== 'auto' ? normalizeLanguageCode(language) : 'zh';
        input.language = lang;

        const whisperResult = await env.AI.run(MODEL, input);

        if (!whisperResult || !whisperResult.text) {
            return errorResponse('Whisper 辨識失敗，請確認音訊格式正確（建議 WAV/MP3）', 500);
        }

        let rawText = whisperResult.text.trim();
        let vtt = whisperResult.vtt || '';
        
        // 執行字典事後校正替換
        if (replaceRules.length > 0) {
            for (const rule of replaceRules) {
                const escapedWrong = rule.wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(escapedWrong, 'g');
                rawText = rawText.replace(regex, rule.correct);
                vtt = vtt.replace(regex, rule.correct);
            }
        }

        const rawSrt = vtt ? vttToSrt(vtt) : '';
        // 合併字元級段落為自然句子（解決 Whisper 中文每字一段問題）
        const srt = mergeSrtBlocks(rawSrt);

        return jsonResponse({
            text: rawText,
            vtt: vtt,
            srt,
            wordCount: whisperResult.word_count || 0,
        });

    } catch (err) {
        console.error('[Whisper Worker Error]', err?.message || err);
        return errorResponse(`處理失敗：${err?.message || '未知錯誤'}`, 500);
    }
}

// ─── 語言代碼正規化 ────────────────────────────────────────────────
// Whisper 接受 BCP-47 格式，如 "zh"、"en"、"ja"
function normalizeLanguageCode(lang) {
    const map = {
        'zh-TW': 'zh',
        'zh-CN': 'zh',
        'zh': 'zh',
        'en': 'en',
        'ja': 'ja',
        'ko': 'ko',
    };
    return map[lang] || lang;
}
