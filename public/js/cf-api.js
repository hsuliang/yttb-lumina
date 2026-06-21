// Cloudflare AI API Client

export async function getCfSettings() {
    let url = localStorage.getItem('aliang-tab0-worker-url') || sessionStorage.getItem('aliang-tab0-worker-url');
    if (url) {
        url = url.trim();
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }
    }
    const token = localStorage.getItem('aliang-tab0-worker-token') || sessionStorage.getItem('aliang-tab0-worker-token');
    const textModel = localStorage.getItem('aliang-cf-text-model') || 'auto';
    const aiEngine = localStorage.getItem('aliang-ai-engine') || 'auto';
    return { url, token, textModel, aiEngine };
}

export async function callCloudflareTextAPI(prompt, onStream = null, abortSignal = null, forceModel = null) {
    const { url, token, textModel } = await getCfSettings();
    if (!url) {
        throw new Error('未設定 Cloudflare Worker URL，請至全域設定中設定。');
    }

    const apiUrl = url.replace(/\/+$/, '') + '/api/generate-text';
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    let actualModel = forceModel || textModel;
    let fallbackMessage = forceModel ? ' (強制大模型)' : '';
    const promptLength = prompt ? prompt.length : 0;

    if (!forceModel) {
        if (textModel === 'auto') {
            if (promptLength < 3000) {
                actualModel = '@cf/qwen/qwen3-30b-a3b-fp8';
            } else if (promptLength < 8000) {
                actualModel = '@cf/google/gemma-4-26b-a4b-it';
            } else {
                actualModel = '@cf/openai/gpt-oss-120b';
            }
        } else {
            // Fallback safety logic
            if (promptLength >= 8000 && textModel !== '@cf/openai/gpt-oss-120b') {
                actualModel = '@cf/openai/gpt-oss-120b';
                fallbackMessage = ' - 因字數過多自動防呆切換';
            }
        }
    }

    const systemPrompt = "請一律使用繁體中文（台灣）進行回答，絕對不要使用簡體中文。";
    const body = JSON.stringify({ prompt, model: actualModel, systemPrompt });

    try {
        if (onStream) {
            onStream('', `Cloudflare (${actualModel.split('/').pop()}${fallbackMessage}) 思考中...`);
            
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers,
                body,
                signal: abortSignal
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error || `HTTP error ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let responseText = '';
            
            // 讀取 SSE stream
            let buffer = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                
                let lineEndIndex;
                while ((lineEndIndex = buffer.indexOf('\n')) >= 0) {
                    const line = buffer.slice(0, lineEndIndex).trim();
                    buffer = buffer.slice(lineEndIndex + 1);
                    
                    if (line.startsWith('data: ')) {
                        const dataStr = line.slice(6);
                        if (dataStr === '[DONE]') break;
                        try {
                            const data = JSON.parse(dataStr);
                            const chunkText = data.response || (data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content) || "";
                            if (chunkText) {
                                responseText += chunkText;
                                onStream(chunkText, responseText);
                            }
                        } catch (e) {
                            // ignore parse error for incomplete chunks
                        }
                    }
                }
            }
            return responseText;
        } else {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers,
                body,
                signal: abortSignal
            });
            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error || `HTTP error ${response.status}`);
            }
            
            // If not streaming, the response might still be SSE or a single text.
            // But we requested stream: true in the worker...
            // Let's just handle it as text buffer.
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let responseText = '';
            let buffer = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                let lineEndIndex;
                while ((lineEndIndex = buffer.indexOf('\n')) >= 0) {
                    const line = buffer.slice(0, lineEndIndex).trim();
                    buffer = buffer.slice(lineEndIndex + 1);
                    if (line.startsWith('data: ')) {
                        const dataStr = line.slice(6);
                        if (dataStr === '[DONE]') break;
                        try {
                            const data = JSON.parse(dataStr);
                            if (data.response) responseText += data.response;
                        } catch (e) {}
                    }
                }
            }
            return responseText;
        }
    } catch (e) {
        if (e.name === 'AbortError') throw e;
        
        let errorMsg = e.message;
        if (errorMsg.includes('4006') || errorMsg.includes('10,000 neurons')) {
            errorMsg = 'Cloudflare AI 免費額度（10,000 neurons）今日已耗盡！請設定 Gemini API 金鑰啟用備援機制，或是等待明天額度重置。';
        }
        
        throw new Error(`Cloudflare API 失敗: ${errorMsg}`);
    }
}


