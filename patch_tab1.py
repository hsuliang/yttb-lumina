import re

with open('public/js/tab1-srt.js', 'r') as f:
    content = f.read()

# Replace the top part to handle abort
search_top = """        const btn = type === 'chapters' ? generateChaptersBtn : generateSummaryBtn;
        const originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.classList.add('btn-loading');"""

replace_top = """        if (state.currentAbortController) {
            state.currentAbortController.abort();
            state.currentAbortController = null;
            return;
        }
        state.currentAbortController = new AbortController();

        const btn = type === 'chapters' ? generateChaptersBtn : generateSummaryBtn;
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<span class="material-symbols-outlined text-[18px]">close</span>中斷生成';
        btn.classList.add('bg-error/10', 'text-error', 'border-error/20');
        // btn.disabled = true; // allow abort
        // btn.classList.add('btn-loading');"""

content = content.replace(search_top, replace_top)

# Replace the thinking text with centered blinking text
search_text = """        if (targetTextarea) {
            targetTextarea.value = 'AI 思考中...';
        }"""

replace_text = """        if (targetTextarea) {
            targetTextarea.value = 'AI 思考中...';
            targetTextarea.classList.add('text-center', 'animate-pulse');
        }"""

content = content.replace(search_text, replace_text)


# Replace the try catch finally to handle abort
search_catch = """        try {
            const result = await callGeminiAPI(apiKey, prompt, false, (chunkText, fullText) => {
                if (targetTextarea) {
                    targetTextarea.value = fullText;
                    targetTextarea.scrollTop = targetTextarea.scrollHeight;
                }
            });"""

replace_catch = """        try {
            let isFirstChunk = true;
            const result = await callGeminiAPI(apiKey, prompt, false, (chunkText, fullText) => {
                if (targetTextarea) {
                    if (isFirstChunk && chunkText !== '') {
                        isFirstChunk = false;
                        targetTextarea.classList.remove('text-center', 'animate-pulse');
                    }
                    targetTextarea.value = fullText;
                    targetTextarea.scrollTop = targetTextarea.scrollHeight;
                }
            }, state.currentAbortController.signal);"""

content = content.replace(search_catch, replace_catch)

search_finally = """        } finally {
            btn.disabled = false;
            btn.classList.remove('btn-loading');
            btn.innerHTML = originalHtml;
        }"""

replace_finally = """        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('生成已中斷');
                if (targetTextarea) {
                    targetTextarea.classList.remove('text-center', 'animate-pulse');
                    targetTextarea.value = '生成已中斷。';
                }
                return;
            }
            if (error.message && error.message.includes('overloaded')) {
                // Keep the overloaded message logic intact
            }
            // re-throw or show modal if it's other error
            throw error;
        } finally {
            state.currentAbortController = null;
            btn.disabled = false;
            btn.classList.remove('btn-loading', 'bg-error/10', 'text-error', 'border-error/20');
            btn.innerHTML = originalHtml;
        }"""

# Wait, the overloaded message logic is in the original code.
# Let's use regex to replace the catch block
content = re.sub(
    r'        } catch \(error\) \{[\s\S]*?\} finally \{[\s\S]*?\}',
    r'''        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('生成已中斷');
                if (targetTextarea) {
                    targetTextarea.classList.remove('text-center', 'animate-pulse');
                    targetTextarea.value = '生成已中斷。';
                }
                return;
            }
            if (error.message && error.message.includes('overloaded')) {
                showModal({ 
                    title: 'AI 正在尖峰時段，請稍候！', 
                    message: '別擔心，這不是您的程式或 API Key 有問題。\n\n這代表 Gemini AI 模型目前正處於全球使用的高峰期，就像一位超級名廚的廚房突然湧入了大量訂單一樣。\n\n建議您稍等一兩分鐘後，再點擊一次「生成」按鈕即可。\n\n感謝您的耐心！'
                });
            } else {
                showModal({ title: '錯誤', message: error.message || String(error) });
            }
        } finally {
            state.currentAbortController = null;
            btn.disabled = false;
            btn.classList.remove('btn-loading', 'bg-error/10', 'text-error', 'border-error/20');
            btn.innerHTML = originalHtml;
        }''',
    content
)

with open('public/js/tab1-srt.js', 'w') as f:
    f.write(content)
