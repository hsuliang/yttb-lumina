/**
 * optimization-service.js
 * 提供全局的文本優化服務。
 */

// 將其包裹在一個物件中，模擬一個服務模組
window.optimizationService = {
    /**
     * 觸發 AI 文本優化流程。
     * 這是一個異步函式，會在原地顯示模態窗，並在完成後更新全局狀態。
     */
    async optimizeSourceText() {
        const apiKey = window.getBalancedApiKey ? window.getBalancedApiKey() : (localStorage.getItem('geminiApiKey') || sessionStorage.getItem('geminiApiKey'));
        if (!apiKey) {
            if (window.showApiKeyModal) window.showApiKeyModal();
            return;
        }

        const content = state.processedSrtResult ? state.processedSrtResult.trim() : document.getElementById('smart-area').value.trim();
        if (!content) {
            showModal({ title: '錯誤', message: '請先在「智慧區域」中輸入或整理原始字幕內容。' });
            return;
        }

        const prompt = `你是一位專業的文案編輯。請將以下的 SRT 字幕逐字稿，優化成一篇流暢易讀、適合用於部落格文章的純文字底稿。\n規則：\n1. 加上適當的標點符號與段落，讓文章更通順。\n2. 絕對不可以改寫、改變原文的語意。\n3. 不可新增任何字幕中沒有的資訊或自己的評論。\n4. 修正明顯的錯別字，但保留口語化的風格。\n5. 移除所有時間戳和行號。\n6. 直接輸出優化後的文章，不要有任何前言或結語。\n\n字幕逐字稿如下：\n---\n${content}\n---`;

        showModal({ title: 'AI 文本優化中...', showProgressBar: true, taskType: 'optimize' });

        try {
            const result = await callGeminiAPI(apiKey, prompt);
            
            // 成功後，更新全局狀態
            state.optimizedTextForBlog = result;
            state.blogSourceType = 'optimized';

            // 關閉進度條模態窗
            hideModal();

            // 顯示成功提示
            showToast('文本已成功優化！', { type: 'success' });
            
            // 觸發全局 UI 刷新
            if (window.updateSourceStatusUI) window.updateSourceStatusUI();
            if (window.updateTabAvailability) window.updateTabAvailability(); // 更新分頁按鈕狀態

        } catch (error) {
            // 處理 API 錯誤
            if (error.message && error.message.includes('overloaded')) {
                showModal({
                    title: 'AI 正在尖峰時段，請稍候！',
                    message: 'AI 模型目前正處於全球使用的高峰期，建議您稍等一兩分鐘後重試。',
                    buttons: [
                        { text: '關閉', class: 'btn-secondary', callback: hideModal },
                        { text: '立即重試', class: 'btn-primary', callback: () => { 
                            hideModal();
                            this.optimizeSourceText(); // 重試
                        }}
                    ]
                });
            } else {
                showModal({ title: 'AI 處理失敗', message: `發生錯誤：${error.message}` });
            }
        }
    }
};