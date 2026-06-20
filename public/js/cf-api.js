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
    const textModel = localStorage.getItem('aliang-cf-text-model') || '@cf/qwen/qwen2.5-coder-32b-instruct';
    const aiEngine = localStorage.getItem('aliang-ai-engine') || 'auto';
    return { url, token, textModel, aiEngine };
}

export async function callCloudflareTextAPI(prompt, onStream = null, abortSignal = null) {
    const { url, token, textModel } = await getCfSettings();
    if (!url) {
        throw new Error('未設定 Cloudflare Worker URL，請至全域設定中設定。');
    }

    const apiUrl = url.replace(/\/+$/, '') + '/api/generate-text';
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const body = JSON.stringify({ prompt, model: textModel });

    try {
        if (onStream) {
            onStream('', `Cloudflare (${textModel.split('/').pop()}) 思考中...`);
            
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
                            if (data.response) {
                                responseText += data.response;
                                onStream(data.response, responseText);
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
        throw new Error(`Cloudflare API 失敗: ${e.message}`);
    }
}


