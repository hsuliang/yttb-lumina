/**
 * tab1-srt.js
 * 負責管理第一分頁「字幕整理與優化」的所有 UI 互動與邏輯。
 */

// --- 元素選擇 (模組級) ---
const generateChaptersBtn = document.getElementById('generate-chapters-btn');
const generateSummaryBtn = document.getElementById('generate-summary-btn');
const smartAreaContainer = document.getElementById('smart-area-container');
const smartArea = document.getElementById('smart-area');
const displayOriginal = document.getElementById('display-original');
const displayProcessed = document.getElementById('display-processed');
const fileInput = document.getElementById('file-input');
const maxCharsSlider = document.getElementById('max-chars-per-line');
const maxCharsValue = document.getElementById('max-chars-value');
const mergeShortLinesSlider = document.getElementById('merge-short-lines-threshold');
const mergeShortLinesValue = document.getElementById('merge-short-lines-value');
const keepPunctuationCheckbox = document.getElementById('keep-punctuation');
const fixTimestampsCheckbox = document.getElementById('fix-timestamps');
const timestampThresholdInput = document.getElementById('timestamp-threshold');
const processSrtBtn = document.getElementById('process-srt-btn');
const exportSrtBtn = document.getElementById('export-srt-btn');
const batchReplaceBtn = document.getElementById('batch-replace-btn');
const batchReplaceModal = document.getElementById('batch-replace-modal');
const closeReplaceModalBtn = document.getElementById('close-replace-modal-btn');
const addReplaceRuleBtn = document.getElementById('add-replace-rule-btn');
const replaceOriginalInput = document.getElementById('replace-original-input');
const replaceReplacementInput = document.getElementById('replace-replacement-input');
const replaceRulesList = document.getElementById('replace-rules-list');
const clearAllRulesBtn = document.getElementById('clear-all-rules-btn');
const timelineShiftInput = document.getElementById('timeline-shift');
const timelineShiftValue = document.getElementById('timeline-shift-value');
const timestampThresholdValue = document.getElementById('timestamp-threshold-value');
const loadPresetRulesBtn = document.getElementById('load-preset-rules-btn');
const savePresetRulesBtn = document.getElementById('save-preset-rules-btn');
const exportRulesBtn = document.getElementById('export-rules-btn');
const importRulesBtn = document.getElementById('import-rules-btn');
const importRulesFileInput = document.getElementById('import-rules-file-input');

// [第二階段優化] - 新增返回編輯按鈕的選擇器
const returnToEditBtn = document.getElementById('return-to-edit-btn');
// [第三階段優化] - 新增字幕教學面板選擇器
const toggleSubtitleHelpBtn = document.getElementById('toggle-subtitle-help-btn');
const subtitleHelpPanel = document.getElementById('subtitle-help-panel');
// [Tab 1 Empty State]
const tab1EmptyState = document.getElementById('tab1-empty-state');

const STORAGE_KEY_REPLACE_RULES = 'aliang-yttb-replace-rules-preset';


// --- 輔助函式 (模組級) ---
function toggleEmptyState() {
    if (!smartArea || !tab1EmptyState) return;
    const hasContent = smartArea.value.length > 0;
    if (hasContent) {
        tab1EmptyState.classList.add('hidden');
    } else {
        tab1EmptyState.classList.remove('hidden');
    }
}

function updateCharCount(text = '') {
    const count = text.length;
    const display = document.getElementById('char-count-display');
    if (display) {
        display.textContent = `字數: ${count}`;
    }
}

function setMode(mode) {
    const viewToggleHeader = document.getElementById('view-toggle-header');
    if (mode === 'input') {
        viewToggleHeader.classList.add('hidden');
        smartArea.classList.remove('hidden');
        displayOriginal.classList.add('hidden');
        displayProcessed.classList.add('hidden');
        // smartArea.value = ''; // 返回編輯時不清空
        updateCharCount(smartArea.value);
        toggleEmptyState();
    } else if (mode === 'preview') {
        viewToggleHeader.classList.remove('hidden');
        smartArea.classList.add('hidden');
        if (tab1EmptyState) tab1EmptyState.classList.add('hidden');
    }
}

function updateBatchReplaceButtonStatus() {
    if (state.batchReplaceRules.length > 0) {
        batchReplaceBtn.textContent = `批次取代 (已設定 ${state.batchReplaceRules.length} 條)`;
        batchReplaceBtn.classList.add('active');
    } else {
        batchReplaceBtn.textContent = '批次取代';
        batchReplaceBtn.classList.remove('active');
    }
}

// [第二階段優化] - 新增返回編輯模式的函式
function returnToEditMode() {
    setMode('input');
    smartArea.value = state.originalContentForPreview;
    smartArea.dispatchEvent(new Event('input')); // 觸發 input 事件以更新UI
    smartArea.focus();
}

// --- 清除函式 ---
function resetTab1() {
    document.getElementById('view-toggle-header').classList.add('hidden');
    displayOriginal.classList.add('hidden');
    displayProcessed.classList.add('hidden');
    smartArea.value = '';
    smartArea.classList.remove('hidden');
    state.originalContentForPreview = '';
    state.processedSrtResult = '';
    state.originalFileName = '';
    exportSrtBtn.disabled = true;
    exportSrtBtn.className = 'font-bold py-2 px-4 rounded btn-disabled';
    state.batchReplaceRules = [];
    updateBatchReplaceButtonStatus();
    updateCharCount();
    toggleEmptyState();
}

// --- 初始化函式 ---
function initializeTab1() {
    // --- 函式定義 ---
    async function handleAiFeature(type) {
        const apiKey = window.getBalancedApiKey ? window.getBalancedApiKey() : (localStorage.getItem('geminiApiKey') || sessionStorage.getItem('geminiApiKey'));
        // ########## FIX END ##########

        const content = state.processedSrtResult.trim() || smartArea.value.trim();
        if (!content) {
            showModal({ title: '錯誤', message: '沒有可用於 AI 處理的字幕內容。' });
            return;
        }

        const btn = type === 'chapters' ? generateChaptersBtn : generateSummaryBtn;
        const originalHtml = btn.innerHTML;
        let prompt = '';
        let modalTitle = 'AI 處理中...';
        let successTitle = 'AI 處理完成';

        btn.disabled = true;
        btn.classList.add('btn-loading');

        if (type === 'chapters') {
            prompt = `你是一個專業的 YouTube 影片剪輯師。請根據以下影片字幕內容，為這部影片生成 YouTube 影片章節。\n規則：\n1. 格式必須是 "時間戳 - 標題" (例如：00:00 - 影片開頭)。\n2. 時間戳必須從 00:00 開始。\n3. 根據影片長度合理分配章節數量，30分鐘內影片最多10個章節，依此類推。\n4. 章節標題需簡潔且能總結該段落的核心內容。\n5. 不要包含前言或結語，直接輸出章節列表。\n\n字幕內容如下：\n---\n${content}\n---`;
            successTitle = 'AI 章節生成 完成';
        } else if (type === 'summary') {
            prompt = `你是一位專業的 YouTube 內容策劃。請根據下方的影片逐字稿，撰寫一段約 150 字左右、引人入勝的影片摘要，用於 YouTube 的說明欄。\n規則：\n1. 摘要需包含影片的核心觀點和最吸引人的亮點。\n2. 語氣需充滿能量與好奇心，鼓勵觀眾觀看影片。\n3. 不要使用任何 markdown 語法，直接輸出純文字段落。\n4. 直接輸出摘要內容，不要有任何前言或結語 (例如不要寫「這是一段摘要」)。\n\n影片逐字稿如下：\n---\n${content}\n---`;
            successTitle = 'AI 影片摘要 完成';
        }
        
        showModal({ title: modalTitle, showProgressBar: true, taskType: 'chapters' });

        try {
            const result = await callGeminiAPI(apiKey, prompt);
            showModal({ title: successTitle, message: result, showCopyButton: true });
        } catch (error) {
            if (error.message && error.message.includes('overloaded')) {
                showModal({ 
                    title: 'AI 正在尖峰時段，請稍候！', 
                    message: '別擔心，這不是您的程式或 API Key 有問題。\n\n這代表 Gemini AI 模型目前正處於全球使用的高峰期，就像一位超級名廚的廚房突然湧入了大量訂單一樣。\n\n建議您稍等一兩分鐘後，再點擊一次「生成」按鈕即可。\n\n感謝您的耐心！',
                    buttons: [
                        { text: '關閉', class: 'btn-secondary', callback: hideModal },
                        { text: '立即重試', class: 'btn-primary', callback: () => { 
                            hideModal(); 
                            handleAiFeature(type); 
                        } }
                    ]
                });
            } else {
                showModal({ title: 'AI 處理失敗', message: `發生錯誤：${error.message}` });
            }
        } finally {
            btn.disabled = false;
            btn.classList.remove('btn-loading');
            btn.innerHTML = originalHtml;
        }
    }

    function openBatchReplaceModal() { batchReplaceModal.classList.remove('hidden'); renderReplaceRules(); }
    function closeBatchReplaceModal() { if (state.batchReplaceRules.length > 0) { processSrtBtn.classList.add('button-flash'); setTimeout(() => { processSrtBtn.classList.remove('button-flash'); }, 1500); } batchReplaceModal.classList.add('hidden'); }
    
    function renderReplaceRules() {
        replaceRulesList.innerHTML = '';
        if (state.batchReplaceRules.length === 0) {
            replaceRulesList.innerHTML = `<p class="p-4 text-center text-white/60">尚未新增任何取代規則</p>`;
            return;
        }
        state.batchReplaceRules.forEach((rule, index) => {
            const ruleEl = document.createElement('div');
            ruleEl.className = 'rule-item text-white';
            ruleEl.innerHTML = ` <span class="rule-text font-mono text-white">${rule.original}</span> <span class="text-white/60 mx-1">→</span> <span class="rule-text font-mono text-white">${rule.replacement}</span> <button class="rule-delete-btn" data-index="${index}" title="刪除此規則"> <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg> </button> `;
            replaceRulesList.appendChild(ruleEl);
        });
        updateBatchReplaceButtonStatus();
    }

    function addReplaceRule() {
        const original = replaceOriginalInput.value.trim();
        const replacement = replaceReplacementInput.value.trim();
        if (original) {
            state.batchReplaceRules.push({ original, replacement });
            replaceOriginalInput.value = '';
            replaceReplacementInput.value = '';
            replaceOriginalInput.focus();
            renderReplaceRules();
        }
    }

    function deleteRule(index) {
        state.batchReplaceRules.splice(index, 1);
        renderReplaceRules();
    }

    function clearAllRules() {
        state.batchReplaceRules = [];
        renderReplaceRules();
    }

    function savePresetRules() {
        if (state.batchReplaceRules.length === 0) {
            showToast('目前沒有規則可儲存。', { type: 'error' });
            return;
        }
        try {
            localStorage.setItem(STORAGE_KEY_REPLACE_RULES, JSON.stringify(state.batchReplaceRules));
            showToast('✅ 已將目前規則儲存為常用範本！');
        } catch (e) {
            console.error('儲存失敗:', e);
            showToast('儲存失敗，可能是儲存空間不足。', { type: 'error' });
        }
    }

    function loadPresetRules() {
        try {
            const savedRules = localStorage.getItem(STORAGE_KEY_REPLACE_RULES);
            if (!savedRules) {
                showToast('尚無儲存的常用範本。', { type: 'error' });
                return;
            }
            
            const rules = JSON.parse(savedRules);
            if (Array.isArray(rules) && rules.length > 0) {
                // 混合模式策略：載入範本時，覆蓋當前暫存規則
                if (state.batchReplaceRules.length > 0) {
                    if (!confirm('載入範本將會清除目前未儲存的規則，確定要繼續嗎？')) {
                        return;
                    }
                }
                
                state.batchReplaceRules = rules;
                renderReplaceRules();
                showToast(`📥 已載入 ${rules.length} 條常用規則！`);
            } else {
                showToast('儲存的範本格式錯誤或為空。', { type: 'error' });
            }
        } catch (e) {
            console.error('載入失敗:', e);
            showToast('載入失敗，請重試。', { type: 'error' });
        }
    }

    function exportRules() {
        if (state.batchReplaceRules.length === 0) {
            showToast('目前沒有任何取代規則可以匯出。', { type: 'error' });
            return;
        }
        try {
            const jsonStr = JSON.stringify(state.batchReplaceRules, null, 2);
            const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `yttb_replace_rules_${new Date().toISOString().slice(2, 10).replace(/-/g, "")}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast('📤 規則匯出成功！');
        } catch (e) {
            console.error('匯出失敗:', e);
            showToast('匯出失敗，請重試。', { type: 'error' });
        }
    }

    function handleImportRulesFile(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const rules = JSON.parse(e.target.result);
                if (Array.isArray(rules)) {
                    // 驗證規則格式是否正確
                    const isValid = rules.every(r => r && typeof r.original === 'string' && typeof r.replacement === 'string');
                    if (!isValid) {
                        showModal({ title: '匯入失敗', message: '匯入的檔案格式不正確，必須是包含 original 與 replacement 欄位的規則陣列。' });
                        return;
                    }
                    
                    if (state.batchReplaceRules.length > 0) {
                        if (!confirm('匯入規則將會覆蓋當前暫存的規則，確定要繼續嗎？')) {
                            return;
                        }
                    }
                    
                    state.batchReplaceRules = rules;
                    renderReplaceRules();
                    showToast(`📥 成功匯入 ${rules.length} 條取代規則！`);
                } else {
                    showModal({ title: '匯入失敗', message: '匯入的檔案內容必須是 JSON 陣列。' });
                }
            } catch (error) {
                console.error('解析匯入檔案失敗:', error);
                showModal({ title: '匯入失敗', message: '解析 JSON 檔案失敗，請確保檔案格式正確。' });
            }
        };
        reader.readAsText(file);
    }

    function switchView(viewToShow) {
        console.log("[switchView] Switching view to:", viewToShow);
        const buttons = document.querySelectorAll('.view-btn');
        buttons.forEach(btn => btn.classList.remove('active'));
        const activeBtn = document.querySelector(`.view-btn[data-view="${viewToShow}"]`);
        if (activeBtn) {
            activeBtn.classList.add('active');
        }

        if (viewToShow === 'original') {
            displayOriginal.classList.remove('hidden');
            displayProcessed.classList.add('hidden');
            updateCharCount(state.originalContentForPreview || '');
            console.log("[switchView] Showing original content, length:", (state.originalContentForPreview || '').length);
        } else {
            displayOriginal.classList.add('hidden');
            displayProcessed.classList.remove('hidden');
            updateCharCount(state.processedSrtResult || '');
            console.log("[switchView] Showing processed content, length:", (state.processedSrtResult || '').length);
        }
    }

    function updateContent(content, fileName = '') {
        smartArea.value = content;
        state.originalFileName = fileName;
        smartArea.dispatchEvent(new Event('input'));
        toggleEmptyState();
    }

    async function handleFile(file) {
        if (!file) return;
        const nameLower = file.name.toLowerCase();
        if (!nameLower.endsWith('.srt') && !nameLower.endsWith('.txt') && !nameLower.endsWith('.pdf')) {
            showModal({ title: '檔案錯誤', message: '請上傳 .srt、.txt 或 .pdf 格式的檔案。' });
            return;
        }

        const baseName = file.name.split('.').slice(0, -1).join('.');

        if (nameLower.endsWith('.pdf')) {
            if (!window.pdfjsLib) {
                showModal({ title: '載入錯誤', message: 'PDF 解析器尚未準備就緒，請重試或重新整理網頁。' });
                return;
            }
            showModal({ title: '正在讀取 PDF...', showProgressBar: true });
            try {
                const arrayBuffer = await file.arrayBuffer();
                const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
                const pdf = await loadingTask.promise;
                let fullText = '';
                
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    const pageText = textContent.items.map(item => item.str).join(' ');
                    fullText += pageText + '\n';
                }
                
                hideModal();
                if (!fullText.trim()) {
                    showModal({ title: '讀取失敗', message: '無法從該 PDF 檔案中提取文字，可能是因為檔案為掃描圖檔或受密碼保護。' });
                } else {
                    updateContent(fullText, baseName);
                    showToast('✅ 成功匯入 PDF 文字！');
                }
            } catch (error) {
                console.error('PDF 讀取錯誤:', error);
                hideModal();
                showModal({ title: '讀取失敗', message: `讀取 PDF 時發生錯誤：${error.message}` });
            }
        } else {
            const reader = new FileReader();
            reader.onload = (e) => {
                updateContent(e.target.result, baseName);
                showToast('✅ 成功匯入文稿！');
            };
            reader.readAsText(file);
        }
    }

    function formatSrtForDisplay(srtContent, placeholder) {
        if (!srtContent || !srtContent.trim()) {
            return `<span class="text-[var(--gray-text)]">${placeholder}</span>`;
        }
        const blocks = srtContent.trim().split(/\n\s*\n/);
        return blocks.map(block => {
            const lines = block.split('\n');
            if (lines.length < 2) return block;
            return `${lines[0]}\n\n${lines[1]}\n\n${lines.slice(2).join('\n')}`;
        }).join('\n\n\n');
    }

    function processAndDisplaySrt() {
        const currentSrtContent = smartArea.value.trim();
        if (!currentSrtContent) {
            showModal({ title: '輸入錯誤', message: '沒有可以處理的字幕內容。' });
            return;
        }
        state.originalContentForPreview = currentSrtContent;
        
        const options = {
            maxCharsPerLine: parseInt(maxCharsSlider.value, 10),
            mergeShortLinesThreshold: parseInt(mergeShortLinesSlider.value, 10),
            keepPunctuation: keepPunctuationCheckbox.checked,
            fixTimestamps: fixTimestampsCheckbox.checked,
            timestampThreshold: parseInt(timestampThresholdInput.value, 10),
            batchReplaceRules: state.batchReplaceRules,
            timelineShift: parseInt(timelineShiftInput.value, 10) || 0
        };

        try {
            const result = processSubtitles(currentSrtContent, options);
            state.processedSrtResult = result.processedSrt;
            const report = result.report;

            setMode('preview');
            displayOriginal.textContent = formatSrtForDisplay(state.originalContentForPreview, '');
            displayProcessed.textContent = formatSrtForDisplay(state.processedSrtResult, '');
            switchView('processed');
            updateCharCount(state.processedSrtResult);
            
            // 計算行數縮減百分比
            let reductionPercent = 0;
            if (report.originalLineCount > 0) {
                reductionPercent = Math.round(((report.originalLineCount - report.finalLineCount) / report.originalLineCount) * 100);
            }
            
            // 構建報告訊息 HTML (使用字串組裝以避免換行符號造成的空白)
            let listItems = '';
            
            // 1. 行數縮減
            listItems += `<li class="flex flex-row items-center m-0 p-0"><span class="flex-shrink-0 w-6 text-center mr-2 text-base">📉</span><span><strong>行數縮減：</strong> ${report.originalLineCount} 行 ➔ ${report.finalLineCount} 行 ${reductionPercent > 0 ? `<span class="text-green-400 font-bold">(-${reductionPercent}%)</span>` : ''}</span></li>`;
            
            // 2. 段落合併
            listItems += `<li class="flex flex-row items-center m-0 p-0"><span class="flex-shrink-0 w-6 text-center mr-2 text-base">🔗</span><span><strong>段落合併：</strong> 執行 ${report.linesMerged} 次</span></li>`;
            
            // 3. 長句拆分 (條件式)
            if (report.linesSplit > 0) {
                listItems += `<li class="flex flex-row items-center m-0 p-0"><span class="flex-shrink-0 w-6 text-center mr-2 text-base">✂️</span><span><strong>長句拆分：</strong> 執行 ${report.linesSplit} 次</span></li>`;
            }
            
            // 4. 時間軸修復
            listItems += `<li class="flex flex-row items-center m-0 p-0"><span class="flex-shrink-0 w-6 text-center mr-2 text-base">⏱️</span><span><strong>時間軸修復：</strong> ${report.fixedOverlaps + report.fixedGaps} 處</span></li>`;
            
            // 5. 批次取代
            listItems += `<li class="flex flex-row items-center m-0 p-0"><span class="flex-shrink-0 w-6 text-center mr-2 text-base">🔄</span><span><strong>批次取代：</strong> 共執行 ${report.replacementsMade} 次</span></li>`;
            
            // 6. 時間平移 (條件式)
            if (report.timelineShifted !== 0) {
                listItems += `<li class="flex flex-row items-center m-0 p-0"><span class="flex-shrink-0 w-6 text-center mr-2 text-base">↔️</span><span><strong>時間平移：</strong> ${report.timelineShifted} ms</span></li>`;
            }

            const reportHtml = `<div class="py-1"><ul class="m-0 p-0 list-none space-y-1 text-sm text-white/90 leading-normal">${listItems}</ul><p class="text-center text-white/60 text-xs mt-3 pt-2 border-t border-white/10">您的字幕已準備好進行下一步！</p></div>`;

            showModal({
                title: '✅ 字幕整理報告',
                message: reportHtml, // 這裡直接傳入 HTML 字串，showModal 需支援 HTML (通常 innerHTML 即可)
                isHtml: true, // 確保 showModal 知道這是 HTML (如果您的實作需要這個 flag)
                buttons: [
                    { text: '留在本頁', class: 'btn-secondary', callback: hideModal },
                    { text: '前往生成文章 >', class: 'btn-primary', callback: () => {
                        hideModal();
                        window.switchTab('tab2');
                    }}
                ]
            });

            exportSrtBtn.disabled = false;
            exportSrtBtn.className = 'font-bold py-2 px-4 rounded btn-success';
        } catch (error) {
            console.error('處理時發生錯誤:', error);
            showModal({ title: '處理失敗', message: `發生未預期的錯誤: ${error.message}` });
        }
    }

    function exportSrtFile() {
        if (!state.processedSrtResult) {
            showModal({ title: '匯出失敗', message: '沒有可供匯出的內容。' });
            return;
        }
        const blob = new Blob([state.processedSrtResult], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        let fileName = state.originalFileName ? `${state.originalFileName}_已處理.srt` : `AliangYTTB_${new Date().toISOString().slice(2, 10).replace(/-/g, "")}.srt`;
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // --- 事件監聽 ---
    generateChaptersBtn.addEventListener('click', () => handleAiFeature('chapters'));
    generateSummaryBtn.addEventListener('click', () => handleAiFeature('summary'));
    
    // 動態查詢並綁定檢視切換按鈕
    const viewButtons = document.querySelectorAll('.view-btn');
    console.log("[initializeTab1] Found view buttons count:", viewButtons.length);
    viewButtons.forEach(button => {
        button.addEventListener('click', () => {
            console.log("[viewButton click] Clicked:", button.dataset.view);
            switchView(button.dataset.view);
        });
    });
    maxCharsSlider.addEventListener('input', (e) => { maxCharsValue.textContent = e.target.value; });
    mergeShortLinesSlider.addEventListener('input', (e) => { mergeShortLinesValue.textContent = e.target.value; });
    if (timelineShiftInput && timelineShiftValue) {
        timelineShiftInput.addEventListener('input', (e) => { timelineShiftValue.textContent = e.target.value; });
    }
    if (timestampThresholdInput && timestampThresholdValue) {
        timestampThresholdInput.addEventListener('input', (e) => { timestampThresholdValue.textContent = e.target.value; });
    }
    fixTimestampsCheckbox.addEventListener('change', () => {
        timestampThresholdInput.disabled = !fixTimestampsCheckbox.checked;
        timestampThresholdInput.classList.toggle('opacity-50', !fixTimestampsCheckbox.checked);
    });
    
    if(returnToEditBtn) {
        returnToEditBtn.addEventListener('click', returnToEditMode);
    }
    
    if (toggleSubtitleHelpBtn && subtitleHelpPanel) {
        toggleSubtitleHelpBtn.addEventListener('click', () => {
            subtitleHelpPanel.classList.toggle('hidden');
            const svg = toggleSubtitleHelpBtn.querySelector('svg');
            if (svg) {
                svg.classList.toggle('rotate-180');
            }
        });
    }
    
    smartArea.addEventListener('input', () => {
        updateCharCount(smartArea.value);
        toggleEmptyState();
        if (window.updateTabAvailability) window.updateTabAvailability();
        if (window.updateAiButtonStatus) window.updateAiButtonStatus();
    });

    if (tab1EmptyState) {
        tab1EmptyState.addEventListener('click', (e) => {
            if (e.target.closest('label') || e.target.closest('a') || e.target.tagName === 'INPUT') return;
            smartArea.focus();
        });
    }

    smartAreaContainer.addEventListener('dragover', (e) => { e.preventDefault(); smartAreaContainer.classList.add('dragover'); });
    smartAreaContainer.addEventListener('dragleave', (e) => { e.preventDefault(); smartAreaContainer.classList.remove('dragover'); });
    smartAreaContainer.addEventListener('drop', (e) => { e.preventDefault(); smartAreaContainer.classList.remove('dragover'); if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]); });
    fileInput.addEventListener('change', (e) => { if (e.target.files.length) handleFile(e.target.files[0]); });
    processSrtBtn.addEventListener('click', processAndDisplaySrt);
    exportSrtBtn.addEventListener('click', exportSrtFile);
    batchReplaceBtn.addEventListener('click', openBatchReplaceModal);
    closeReplaceModalBtn.addEventListener('click', closeBatchReplaceModal);
    addReplaceRuleBtn.addEventListener('click', addReplaceRule);
    clearAllRulesBtn.addEventListener('click', clearAllRules);
    if (loadPresetRulesBtn) loadPresetRulesBtn.addEventListener('click', loadPresetRules);
    if (savePresetRulesBtn) savePresetRulesBtn.addEventListener('click', savePresetRules);
    if (exportRulesBtn) exportRulesBtn.addEventListener('click', exportRules);
    if (importRulesBtn) importRulesBtn.addEventListener('click', () => importRulesFileInput.click());
    if (importRulesFileInput) {
        importRulesFileInput.addEventListener('change', (e) => {
            if (e.target.files.length) {
                handleImportRulesFile(e.target.files[0]);
                e.target.value = '';
            }
        });
    }

    replaceRulesList.addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('.rule-delete-btn');
        if (deleteBtn) {
            deleteRule(parseInt(deleteBtn.dataset.index, 10));
        }
    });

    // --- 初始化 ---
    timestampThresholdInput.disabled = !fixTimestampsCheckbox.checked;
    timestampThresholdInput.classList.toggle('opacity-50', !fixTimestampsCheckbox.checked);
    toggleEmptyState();
}