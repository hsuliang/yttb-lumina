/**
 * app.js
 * 應用程式主邏輯，負責初始化各模組與處理全域事件。
 */

document.addEventListener('DOMContentLoaded', () => {

    // --- 元素選擇 ---
    const appearanceBtn = document.getElementById('appearance-btn');
    const appearancePanel = document.getElementById('appearance-panel');
    const apiKeyBtn = document.getElementById('api-key-btn');
    const apiKeyModal = document.getElementById('api-key-modal');
    const closeApiKeyModalBtn = document.getElementById('close-api-key-modal-btn');
    const apiKeyInput = document.getElementById('gemini-api-key');
    const apiKeysListContainer = document.getElementById('api-keys-list-container');
    const saveApiKeyBtn = document.getElementById('save-api-key-btn');
    const apiKeyStatus = document.getElementById('api-key-status');
    const apiKeyCountdown = document.getElementById('api-key-countdown');
    const toggleApiHelpBtn = document.getElementById('toggle-api-help-btn');
    const apiKeyHelpPanel = document.getElementById('api-key-help-panel');
    const allTabButtons = document.querySelectorAll('.tab-btn[data-tab]');
    const allTabContents = document.querySelectorAll('.tab-content');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    const modalCopyBtn = document.getElementById('modal-copy-btn');
    const resetAppBtn = document.getElementById('reset-app-btn');

    // --- 全域函式 ---

    // ########## REFACTORED ##########
    window.updateAiButtonStatus = function() {
        const hasContent = document.getElementById('smart-area').value.trim().length > 0;
        const hasApiKey = !!(localStorage.getItem('geminiApiKey') || sessionStorage.getItem('geminiApiKey'));
        
        const isAiDisabled = !hasContent || !hasApiKey;
        let tooltip = '';
        if (isAiDisabled) {
            if (!hasContent && !hasApiKey) tooltip = '請先輸入內容並設定 API Key';
            else if (!hasContent) tooltip = '請先貼上字幕內容';
            else tooltip = '請先設定 API Key';
        }

        const updateButtonState = (btn, defaultTitle, isDisabled, customTooltip, isHollow = false) => {
            if (btn) {
                btn.disabled = isDisabled;
                btn.title = isDisabled ? (customTooltip || tooltip) : defaultTitle;
                
                if (isHollow) {
                    btn.classList.toggle('opacity-50', isDisabled);
                    btn.classList.toggle('cursor-not-allowed', isDisabled);
                } else {
                    let baseClasses = btn.className.split(' ').filter(c => !['btn-primary', 'btn-disabled'].includes(c)).join(' ');
                    btn.className = `${baseClasses} ${isDisabled ? 'btn-disabled' : 'btn-primary'}`;
                }
            }
        };

        // Tab 1 AI buttons
        updateButtonState(document.getElementById('generate-summary-btn'), '生成摘要', isAiDisabled, null, true);
        updateButtonState(document.getElementById('generate-chapters-btn'), '生成章節', isAiDisabled, null, true);
        
        // ########## CRITICAL FIX START ##########
        // 優化文本按鈕的邏輯修正
        const optimizeBtn = document.getElementById('optimize-text-for-blog-btn');
        if(optimizeBtn) {
            optimizeBtn.disabled = isAiDisabled;
            optimizeBtn.title = isAiDisabled ? tooltip : '使用 AI 將逐字稿優化為流暢文章 (建議)';
            if (isAiDisabled) {
                optimizeBtn.classList.remove('btn-primary');
                optimizeBtn.classList.add('btn-disabled');
            } else {
                optimizeBtn.classList.remove('btn-disabled');
                optimizeBtn.classList.add('btn-primary');
            }
        }
        // ########## CRITICAL FIX END ##########

        // Tab 2, 3, 4 Main AI buttons
        updateButtonState(document.getElementById('generate-blog-btn'), '生成部落格文章', isAiDisabled);
        updateButtonState(document.getElementById('generate-social-btn'), '生成社群貼文', isAiDisabled);
        updateButtonState(document.getElementById('generate-edm-btn'), '生成電子報內容', isAiDisabled);
        updateButtonState(document.getElementById('generate-carousel-btn'), '生成輪播圖提示詞', isAiDisabled);
        updateButtonState(document.getElementById('generate-infographic-btn'), '生成資訊圖表提示詞', isAiDisabled);

        // 處理 Variation 按鈕的禁用狀態
        const blogVariationBtn = document.getElementById('generate-blog-variation-btn');
        if(blogVariationBtn) blogVariationBtn.disabled = state.blogArticleVersions.length === 0;

        const socialVariationBtn = document.getElementById('generate-social-variation-btn');
        if(socialVariationBtn) socialVariationBtn.disabled = state.socialPostVersions.length === 0;
        
        const edmVariationBtn = document.getElementById('generate-edm-variation-btn');
        if(edmVariationBtn) edmVariationBtn.disabled = state.edmVersions.length === 0;

        const carouselVariationBtn = document.getElementById('generate-carousel-variation-btn');
        if(carouselVariationBtn) carouselVariationBtn.disabled = state.carouselVersions.length === 0;

        const infographicVariationBtn = document.getElementById('generate-infographic-variation-btn');
        if(infographicVariationBtn) infographicVariationBtn.disabled = state.infographicVersions.length === 0;
    }
    
    window.updateSourceStatusUI = function() {
        const hasOptimizedText = state.optimizedTextForBlog && state.optimizedTextForBlog.trim().length > 0;
        const hasGeneratedBlog = state.blogArticleVersions && state.blogArticleVersions.length > 0;
        
        let sourceType = 'raw';
        if (hasGeneratedBlog) sourceType = 'blog';
        else if (hasOptimizedText) sourceType = 'optimized';

        const statusMap = {
            raw: '內容來源：字幕原始檔',
            optimized: '✔️ 內容來源：已優化的文本',
            blog: '🏆 內容來源：已生成的部落格文章 (品質最佳)'
        };

        const buttonMap = {
            raw: { text: '🚀 優化文本以提升品質', action: () => optimizationService.optimizeSourceText() },
            optimized: { text: '📝 前往生成部落格 (可選)', action: () => window.switchTab('tab2') },
        };

        const updateElements = (prefix) => {
            const statusEl = document.getElementById(`${prefix}-source-status`);
            const buttonEl = document.getElementById(`${prefix}-go-to-optimize-btn`);

            if (statusEl) {
                statusEl.innerHTML = statusMap[sourceType];
                statusEl.classList.toggle('text-green-600', sourceType !== 'raw');
            }
            if (buttonEl) {
                if (sourceType === 'blog') {
                    buttonEl.classList.add('hidden');
                } else {
                    buttonEl.textContent = buttonMap[sourceType].text;
                    buttonEl.onclick = buttonMap[sourceType].action;
                    buttonEl.classList.remove('hidden');
                }
            }
        };

        ['blog', 'social', 'edm', 'carousel', 'infographic'].forEach(updateElements);
    }

    // --- 儲存媒介存取輔助函式 ---
    function getStorageItem(key) {
        return localStorage.getItem(key) || sessionStorage.getItem(key);
    }

    function setStorageItem(key, value, isSession = false) {
        if (isSession) {
            sessionStorage.setItem(key, value);
        } else {
            localStorage.setItem(key, value);
        }
    }

    function removeStorageKeys() {
        localStorage.removeItem('geminiApiKey');
        localStorage.removeItem('geminiApiKeys');
        localStorage.removeItem('apiKeyExpiry');
        localStorage.removeItem('apiKeyExpiryMode');
        sessionStorage.removeItem('geminiApiKey');
        sessionStorage.removeItem('geminiApiKeys');
        sessionStorage.removeItem('apiKeyExpiry');
        sessionStorage.removeItem('apiKeyExpiryMode');
    }

    // --- 金鑰池管理變數與平衡輪替邏輯 ---
    let modalApiKeys = [];

    function loadModalApiKeys() {
        const stored = getStorageItem('geminiApiKeys');
        if (stored) {
            try {
                modalApiKeys = JSON.parse(stored);
            } catch (e) {
                modalApiKeys = [];
            }
        } else {
            const singleKey = getStorageItem('geminiApiKey');
            modalApiKeys = singleKey ? [{ key: singleKey, count: 0 }] : [];
        }
        renderModalApiKeys();

        // 同步下拉選單的選中值
        const expirySelect = document.getElementById('api-key-expiry-select');
        if (expirySelect) {
            const savedMode = getStorageItem('apiKeyExpiryMode') || '2h';
            expirySelect.value = savedMode;
        }
    }

    function renderModalApiKeys() {
        apiKeysListContainer.innerHTML = '';
        const isLumina = document.querySelector('.glass-panel') || document.querySelector('#api-key-modal.backdrop-blur-sm');
        
        if (modalApiKeys.length === 0) {
            if (isLumina) {
                apiKeysListContainer.innerHTML = '<p class="text-xs text-on-surface-variant/50 text-center py-2">尚未設定任何金鑰</p>';
            } else {
                apiKeysListContainer.innerHTML = '<p class="text-xs text-[var(--gray-text)] text-center py-2">尚未設定任何金鑰</p>';
            }
            return;
        }
        modalApiKeys.forEach((entry, index) => {
            const item = document.createElement('div');
            if (isLumina) {
                item.className = 'flex items-center justify-between bg-surface-container-lowest/50 p-2 rounded text-xs border border-outline-variant/10';
            } else {
                item.className = 'flex items-center justify-between bg-[var(--gray-bg)] p-2 rounded text-xs border border-[var(--card-border)]';
            }
            
            const masked = entry.key.length > 10 
                ? `${entry.key.substring(0, 6)}...${entry.key.substring(entry.key.length - 4)}`
                : entry.key;
            
            if (isLumina) {
                item.innerHTML = `
                    <span class="font-mono text-on-surface">${masked} <span class="text-on-surface-variant/70">(使用: ${entry.count || 0}次)</span></span>
                    <button type="button" class="text-red-400 hover:text-red-300 font-bold delete-key-item-btn" data-index="${index}">刪除</button>
                `;
            } else {
                item.innerHTML = `
                    <span class="font-mono text-[var(--body-text)]">${masked} <span class="text-[var(--gray-text)]">(使用: ${entry.count || 0}次)</span></span>
                    <button type="button" class="text-red-500 hover:text-red-700 font-bold delete-key-item-btn" data-index="${index}">刪除</button>
                `;
            }
            apiKeysListContainer.appendChild(item);
        });
    }

    function parseAndAddKeys(text) {
        if (!text) return { added: 0, duplicates: 0 };
        const rawKeys = text.split(/[\n,\s\t\r]+/).map(k => k.trim()).filter(k => k.length > 0);
        let added = 0;
        let duplicates = 0;
        rawKeys.forEach(key => {
            if (modalApiKeys.some(entry => entry.key === key)) {
                duplicates++;
            } else {
                modalApiKeys.push({ key, count: 0 });
                added++;
            }
        });
        return { added, duplicates };
    }



    window.getBalancedApiKey = function() {
        try {
            const keysJson = getStorageItem('geminiApiKeys');
            if (!keysJson) {
                return getStorageItem('geminiApiKey') || '';
            }
            const keysList = JSON.parse(keysJson);
            if (!Array.isArray(keysList) || keysList.length === 0) {
                return getStorageItem('geminiApiKey') || '';
            }
            
            const minCount = Math.min(...keysList.map(k => k.count || 0));
            const candidates = keysList.filter(k => (k.count || 0) === minCount);
            const selected = candidates[Math.floor(Math.random() * candidates.length)];
            
            selected.count = (selected.count || 0) + 1;
            
            console.log(`[API Key Rotation] 選擇金鑰: ${selected.key.substring(0, 6)}...${selected.key.substring(selected.key.length - 4)} (目前已累計使用: ${selected.count} 次)`);
            
            const isSession = getStorageItem('apiKeyExpiryMode') === 'session';
            setStorageItem('geminiApiKeys', JSON.stringify(keysList), isSession);
            return selected.key;
        } catch (e) {
            console.error('Error balancing API key:', e);
            return getStorageItem('geminiApiKey') || '';
        }
    };

    function toggleAppearancePanel() { appearancePanel.classList.toggle('hidden'); }
    function showApiKeyModal() { loadModalApiKeys(); apiKeyModal.classList.remove('hidden'); }
    function hideApiKeyModal() { apiKeyModal.classList.add('hidden'); }

    async function saveApiKey() {
        const text = apiKeyInput.value.trim();
        if (text) {
            parseAndAddKeys(text);
            apiKeyInput.value = '';
        }

        if (modalApiKeys.length === 0) {
            showToast('請至少新增一組 API Key。', { type: 'error' });
            return;
        }

        saveApiKeyBtn.disabled = true;
        const originalText = saveApiKeyBtn.textContent;
        saveApiKeyBtn.textContent = '驗證中...';

        try {
            const validationPromises = modalApiKeys.map(async (entry) => {
                await resolveFlashModelsList(entry.key, true);
                return entry;
            });

            const results = await Promise.allSettled(validationPromises);
            
            const validApiKeys = [];
            const invalidKeys = [];
            
            results.forEach((r, idx) => {
                if (r.status === 'fulfilled') {
                    validApiKeys.push(r.value);
                } else {
                    invalidKeys.push(modalApiKeys[idx]);
                }
            });

            if (validApiKeys.length === 0) {
                showModal({
                    title: '金鑰驗證失敗',
                    message: '您輸入的所有金鑰均無效或已耗盡額度，請檢查並重新輸入。'
                });
                return;
            }

            modalApiKeys = validApiKeys;
            renderModalApiKeys();

            // 清除之前的舊金鑰與期限
            removeStorageKeys();

            // 取得過期時間模式
            const expirySelect = document.getElementById('api-key-expiry-select');
            const expiryMode = expirySelect ? expirySelect.value : '2h';
            const isSession = expiryMode === 'session';

            setStorageItem('geminiApiKeys', JSON.stringify(validApiKeys), isSession);
            setStorageItem('geminiApiKey', validApiKeys[0].key, isSession);
            setStorageItem('apiKeyExpiryMode', expiryMode, isSession);

            let expiryTime = '';
            if (expiryMode !== 'session' && expiryMode !== 'never') {
                let durationMs = 2 * 60 * 60 * 1000;
                if (expiryMode === '4h') durationMs = 4 * 60 * 60 * 1000;
                else if (expiryMode === '8h') durationMs = 8 * 60 * 60 * 1000;
                else if (expiryMode === '24h') durationMs = 24 * 60 * 60 * 1000;
                
                expiryTime = String(Date.now() + durationMs);
                setStorageItem('apiKeyExpiry', expiryTime, isSession);
            } else if (expiryMode === 'session') {
                expiryTime = 'session';
                setStorageItem('apiKeyExpiry', expiryTime, isSession);
            } else {
                expiryTime = 'never';
                setStorageItem('apiKeyExpiry', expiryTime, isSession);
            }

            updateApiKeyStatus();
            
            if (invalidKeys.length > 0) {
                showToast(`已儲存 ${validApiKeys.length} 組有效金鑰，自動排除 ${invalidKeys.length} 組無效金鑰。`);
            } else {
                showToast('API Key 已儲存，AI 功能已啟用！');
            }
            hideApiKeyModal();

        } catch (err) {
            console.error("Key validation error:", err);
            showModal({ title: '驗證出錯', message: `驗證過程中發生錯誤：${err.message}` });
        } finally {
            saveApiKeyBtn.disabled = false;
            saveApiKeyBtn.textContent = originalText;
        }
    }

    function startApiKeyCountdown() {
        if (state.apiKeyCountdownInterval) { clearInterval(state.apiKeyCountdownInterval); }
        if (apiKeyCountdown) { apiKeyCountdown.classList.remove('hidden'); }
        
        const updateCountdownUI = () => {
            let expiryTime = getStorageItem('apiKeyExpiry');
            
            if (!expiryTime) {
                const savedMode = getStorageItem('apiKeyExpiryMode') || 'never';
                setStorageItem('apiKeyExpiry', savedMode);
                expiryTime = savedMode;
            }

            if (expiryTime === 'session') {
                apiKeyCountdown.textContent = '金鑰有效 (分頁關閉即清除)。';
                return false;
            } else if (expiryTime === 'never') {
                apiKeyCountdown.textContent = '金鑰有效 (永久保存模式)。';
                return false;
            }

            const remaining = parseInt(expiryTime, 10) - Date.now();
            if (remaining <= 0) {
                clearInterval(state.apiKeyCountdownInterval);
                removeStorageKeys();
                apiKeyCountdown.textContent = '';
                updateApiKeyStatus();
                showModal({ title: '金鑰已過期', message: '基於安全考量，您的 API Key 已被清除，請重新輸入。' });
                return false;
            }

            const hours = Math.floor((remaining / (1000 * 60 * 60)) % 24);
            const minutes = Math.floor((remaining / 1000 / 60) % 60);
            const seconds = Math.floor((remaining / 1000) % 60);
            apiKeyCountdown.textContent = `金鑰有效，尚餘 ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            return true;
        };

        const shouldInterval = updateCountdownUI();
        if (shouldInterval) {
            state.apiKeyCountdownInterval = setInterval(() => {
                updateCountdownUI();
            }, 1000);
        }
    }

    function updateApiKeyStatus() {
        const expiry = getStorageItem('apiKeyExpiry');
        if (expiry && expiry !== 'session' && expiry !== 'never' && Date.now() > parseInt(expiry, 10)) {
            removeStorageKeys();
        }
        
        const apiKey = getStorageItem('geminiApiKey');
        const apiKeysJson = getStorageItem('geminiApiKeys');
        let keysCount = 0;
        if (apiKeysJson) {
            try {
                keysCount = JSON.parse(apiKeysJson).length;
            } catch (e) {
                keysCount = 0;
            }
        } else if (apiKey) {
            keysCount = 1;
        }

        const statusBox = document.getElementById('api-key-status-box');

        if (keysCount > 0) {
            if (statusBox) {
                apiKeyStatus.textContent = `狀態：已設定 (共 ${keysCount} 組金鑰)`;
                statusBox.className = 'mt-3 p-3 rounded-xl border flex flex-col items-center justify-center text-center gap-1 transition-all duration-300 border-green-500/30 bg-green-500/10 text-green-400';
                apiKeyStatus.className = 'font-bold text-[12px] block text-green-400';
                apiKeyCountdown.className = 'text-[10px] text-green-400/80 font-mono block mt-0.5';
            } else {
                apiKeyStatus.textContent = `狀態：已設定 (共 ${keysCount} 組金鑰)`;
                apiKeyStatus.classList.remove('text-[var(--text-color)]');
                apiKeyStatus.classList.add('text-green-600');
            }
            startApiKeyCountdown();
        } else {
            if (statusBox) {
                apiKeyStatus.textContent = '金鑰未設定';
                statusBox.className = 'mt-3 p-3 rounded-xl border flex flex-col items-center justify-center text-center gap-1 transition-all duration-300 border-red-500/30 bg-red-500/10 text-red-400';
                apiKeyStatus.className = 'font-bold text-[12px] block text-red-400';
                apiKeyCountdown.className = 'text-[10px] text-green-400/80 font-mono block mt-0.5 hidden';
                apiKeyCountdown.textContent = '';
            } else {
                apiKeyStatus.textContent = '狀態：尚未設定';
                apiKeyStatus.classList.add('text-[var(--text-color)]');
                apiKeyStatus.classList.remove('text-green-600');
                apiKeyCountdown.textContent = '';
            }
            if (state.apiKeyCountdownInterval) clearInterval(state.apiKeyCountdownInterval);
        }
        window.updateTabAvailability();
        window.updateAiButtonStatus();
    }
    
    window.updateTabAvailability = function() {
        const hasContent = document.getElementById('smart-area').value.trim().length > 0;
        
        const tabs = [
            { btn: document.querySelector('.tab-btn[data-tab="tab2"]'), dot: document.getElementById('tab2-dot'), defaultTitle: '將字幕稿轉為部落格文章' },
            { btn: document.querySelector('.tab-btn[data-tab="tab3"]'), dot: document.getElementById('tab3-dot'), defaultTitle: '為多個社群平台生成貼文' },
            { btn: document.querySelector('.tab-btn[data-tab="tab4"]'), dot: document.getElementById('tab4-dot'), defaultTitle: '將文章內容生成電子報' },
            { btn: document.querySelector('.tab-btn[data-tab="tab5"]'), dot: document.getElementById('tab5-dot'), defaultTitle: '社群輪播圖提示詞' },
            { btn: document.querySelector('.tab-btn[data-tab="tab6"]'), dot: document.getElementById('tab6-dot'), defaultTitle: '資訊圖表提示詞' }
        ];

        tabs.forEach(tab => {
            if (tab.btn) {
                tab.btn.disabled = false;
                tab.btn.title = hasContent ? tab.defaultTitle : '請先在分頁 1 貼上您的字幕內容';
                tab.btn.classList.toggle('opacity-40', !hasContent);
                tab.btn.classList.toggle('cursor-not-allowed', !hasContent);
            }
        });
        
        const hasTab2Draft = window.hasBlogDraft && window.hasBlogDraft();
        document.getElementById('tab2-dot').classList.toggle('hidden', !hasTab2Draft);
        const hasTab3Draft = window.hasSocialDraft && window.hasSocialDraft();
        document.getElementById('tab3-dot').classList.toggle('hidden', !hasTab3Draft);
        const hasTab6Draft = window.hasInfographicDraft && window.hasInfographicDraft();
        const tab6Dot = document.getElementById('tab6-dot');
        if (tab6Dot) { tab6Dot.classList.toggle('hidden', !hasTab6Draft); }
        
        window.updateSourceStatusUI();
    }


    window.switchTab = (tabId) => {
        allTabButtons.forEach(btn => btn.classList.remove('active'));
        allTabContents.forEach(content => content.classList.add('hidden'));
        
        const clickedButton = document.querySelector(`[data-tab="${tabId}"]`);
        clickedButton.classList.add('active');
        document.getElementById(tabId).classList.remove('hidden');

        const dot = document.getElementById(`${tabId}-dot`);
        if (dot) { dot.classList.add('hidden'); }

        if (tabId === 'tab2' && window.updateStepperUI) { window.updateStepperUI(); }
        if (tabId === 'tab6' && window.analyzeInfographicContent) { window.analyzeInfographicContent(); }
        window.updateSourceStatusUI();
    }
    
    function initialize() {
        try { initializeTab1(); } catch(e) { console.error("Error initializing Tab 1:", e); }
        try { initializeTab2(); } catch(e) { console.error("Error initializing Tab 2:", e); }
        try { initializeTab3(); } catch(e) { console.error("Error initializing Tab 3:", e); }
        try { initializeTab4(); } catch(e) { console.error("Error initializing Tab 4:", e); }
        try { initializeTab5(); } catch(e) { console.error("Error initializing Tab 5:", e); }
        try { if (window.initializeTab6) { window.initializeTab6(); } } catch(e) { console.error("Error initializing Tab 6:", e); }

        try { updateApiKeyStatus(); } catch(e) { console.error("Error updating API key status:", e); }

        if (appearanceBtn) appearanceBtn.addEventListener('click', toggleAppearancePanel);
        if (apiKeyBtn) apiKeyBtn.addEventListener('click', showApiKeyModal);
        if (closeApiKeyModalBtn) closeApiKeyModalBtn.addEventListener('click', hideApiKeyModal);
        if (apiKeysListContainer) {
            apiKeysListContainer.addEventListener('click', (e) => {
                if (e.target.classList.contains('delete-key-item-btn')) {
                    const index = parseInt(e.target.dataset.index, 10);
                    modalApiKeys.splice(index, 1);
                    renderModalApiKeys();
                    showToast('已從清單中移除金鑰。');
                }
            });
        }
        if (saveApiKeyBtn) saveApiKeyBtn.addEventListener('click', saveApiKey);

        const toggleKeyVisibilityBtn = document.getElementById('toggle-key-visibility-btn');
        if (toggleKeyVisibilityBtn) {
            toggleKeyVisibilityBtn.addEventListener('click', () => {
                const apiKeyTextarea = document.getElementById('gemini-api-key');
                const eyeOpenIcon = document.getElementById('eye-open-icon');
                const eyeClosedIcon = document.getElementById('eye-closed-icon');
                
                if (apiKeyTextarea && eyeOpenIcon && eyeClosedIcon) {
                    const isMasked = apiKeyTextarea.classList.contains('masked-keys');
                    if (isMasked) {
                        apiKeyTextarea.classList.remove('masked-keys');
                        eyeOpenIcon.classList.add('hidden');
                        eyeClosedIcon.classList.remove('hidden');
                    } else {
                        apiKeyTextarea.classList.add('masked-keys');
                        eyeOpenIcon.classList.remove('hidden');
                        eyeClosedIcon.classList.add('hidden');
                    }
                }
            });
        }
        
        if (toggleApiHelpBtn && apiKeyHelpPanel) {
            let keepOpen = false;

            const showHelp = () => {
                apiKeyHelpPanel.classList.remove('hidden');
            };

            const hideHelp = () => {
                if (!keepOpen) {
                    apiKeyHelpPanel.classList.add('hidden');
                }
            };

            toggleApiHelpBtn.addEventListener('mouseenter', showHelp);
            toggleApiHelpBtn.addEventListener('mouseleave', () => {
                setTimeout(() => {
                    if (!apiKeyHelpPanel.matches(':hover') && !toggleApiHelpBtn.matches(':hover')) {
                        hideHelp();
                    }
                }, 100);
            });

            apiKeyHelpPanel.addEventListener('mouseleave', () => {
                setTimeout(() => {
                    if (!apiKeyHelpPanel.matches(':hover') && !toggleApiHelpBtn.matches(':hover')) {
                        hideHelp();
                    }
                }, 100);
            });

            toggleApiHelpBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                keepOpen = !keepOpen;
                if (keepOpen) {
                    showHelp();
                } else {
                    apiKeyHelpPanel.classList.add('hidden');
                }
            });

            document.addEventListener('click', (e) => {
                if (keepOpen && !apiKeyHelpPanel.contains(e.target) && e.target !== toggleApiHelpBtn) {
                    keepOpen = false;
                    apiKeyHelpPanel.classList.add('hidden');
                }
            });
        }

        document.addEventListener('click', (event) => {
            if (appearancePanel && appearanceBtn && !appearancePanel.classList.contains('hidden') && !appearancePanel.contains(event.target) && !appearanceBtn.contains(event.target)) {
                toggleAppearancePanel();
            }
        });

        allTabButtons.forEach(button => button.addEventListener('click', (e) => {
            e.preventDefault();
            const tabId = button.dataset.tab;
            if (!tabId) return;
            const smartArea = document.getElementById('smart-area');
            const hasContent = smartArea && smartArea.value.trim().length > 0;
            console.log(`[Tab Click] Target: ${tabId}, hasContent: ${hasContent}`);
            if (tabId !== 'tab1' && !hasContent) {
                console.log("[Tab Click] Navigation blocked. Showing Toast.");
                showToast('請先貼上或整理您的字幕/文稿內容！', { type: 'warning' });
                return;
            }
            window.switchTab(tabId);
        }));
        
        if (modalCloseBtn) modalCloseBtn.addEventListener('click', hideModal);
        if (modalCopyBtn) modalCopyBtn.addEventListener('click', copyModalContent);
        
        if (resetAppBtn) {
            resetAppBtn.addEventListener('click', () => {
                if (confirm('您確定要重置所有內容嗎？這將會清除所有輸入和已生成的草稿。')) {
                    if(window.clearBlogDraft) window.clearBlogDraft();
                    if(window.clearSocialDraft) window.clearSocialDraft();
                    if(window.clearInfographicDraft) window.clearInfographicDraft();
                    showToast('頁面已重置！');
                    setTimeout(() => { location.reload(); }, 500);
                }
            });
        }

        // 跨分頁金鑰與過期狀態同步監聽器
        window.addEventListener('storage', (e) => {
            if (e.key === 'geminiApiKey' || e.key === 'geminiApiKeys' || e.key === 'apiKeyExpiry' || e.key === 'apiKeyExpiryMode') {
                updateApiKeyStatus();
            }
        });
    }

    initialize();
});