import { optimizationService } from './optimization-service.js';
import { initializeTab0 } from './tab0-transcribe.js';
import { initializeTab1 } from './tab1-srt.js';
import { hasBlogDraft, clearBlogDraft, updateStepperUI, initializeTab2 } from './tab2-blog.js';
import { hasSocialDraft, clearSocialDraft, initializeTab3 } from './tab3-social.js';
import { initializeTab4 } from './tab4-edm.js';
import { initializeTab5 } from './tab5-carousel.js';
import { initializeTab6, hasInfographicDraft, clearInfographicDraft, analyzeInfographicContent } from './tab6-infographic.js';
import { showToast, showModal, hideModal, copyModalContent } from './ui-components.js';
import { resolveFlashModelsList } from './gemini-api.js';
import { state } from './state.js';
import { VariationHub } from './variation-hub.js';

/**
 * app.js
 * 應用程式主邏輯，負責初始化各模組與處理全域事件。
 */


    // --- 元素選擇 ---
    const appearanceBtn = document.getElementById('appearance-btn');
    const appearancePanel = document.getElementById('appearance-panel');
    const globalSettingsBtn = document.getElementById('global-settings-btn');
    const globalSettingsModal = document.getElementById('global-settings-modal');
    const closeGlobalSettingsBtn = document.getElementById('close-global-settings-btn');
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
export const updateAiButtonStatus = function() {
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
    
export const updateSourceStatusUI = function() {
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
            optimized: { text: '📝 前往生成部落格 (可選)', action: () => switchTab('tab2') },
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
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed)) {
                    modalApiKeys = parsed.map(entry => {
                        if (typeof entry === 'string') {
                            return { key: entry, count: 0 };
                        }
                        if (entry && typeof entry === 'object') {
                            return { key: entry.key || '', count: entry.count || 0 };
                        }
                        return { key: '', count: 0 };
                    }).filter(entry => entry.key.length > 0);
                } else if (typeof parsed === 'string') {
                    modalApiKeys = [{ key: parsed, count: 0 }];
                } else {
                    modalApiKeys = [];
                }
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
        if (!apiKeysListContainer) return;
        apiKeysListContainer.innerHTML = '';
        const isLumina = document.querySelector('.glass-panel') || document.querySelector('#api-key-modal.backdrop-blur-sm');
        
        if (!Array.isArray(modalApiKeys) || modalApiKeys.length === 0) {
            if (isLumina) {
                apiKeysListContainer.innerHTML = '<p class="text-xs text-on-surface-variant/50 text-center py-2">尚未設定任何金鑰</p>';
            } else {
                apiKeysListContainer.innerHTML = '<p class="text-xs text-[var(--gray-text)] text-center py-2">尚未設定任何金鑰</p>';
            }
            return;
        }
        modalApiKeys.forEach((entry, index) => {
            if (!entry || !entry.key) return;
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



export const getBalancedApiKey = function() {
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
            
            // 不在此處 +1，計數統一由 gemini-api.js 的成功回呼處理，避免雙重計數
            console.log(`[API Key Rotation] 選擇金鑰: ${selected.key.substring(0, 6)}...${selected.key.substring(selected.key.length - 4)} (目前已累計使用: ${selected.count || 0} 次)`);
            
            return selected.key;
        } catch (e) {
            console.error('Error balancing API key:', e);
            return getStorageItem('geminiApiKey') || '';
        }
    };

    function toggleAppearancePanel() { appearancePanel.classList.toggle('hidden'); }
    export function showGlobalSettingsModal(tabId = 'settings-tab-gemini') {
        console.log(`[showGlobalSettingsModal] Opening settings modal to tab: ${tabId}...`);
        try {
            loadModalApiKeys();
            if (globalSettingsModal) {
                globalSettingsModal.classList.remove('hidden');
                switchSettingsTab(tabId);
            } else {
                console.error("[showGlobalSettingsModal] globalSettingsModal element not found!");
            }
        } catch(e) {
            console.error("[showGlobalSettingsModal] Error loading keys or opening modal:", e);
        }
    }
export const showApiKeyModal = () => showGlobalSettingsModal('settings-tab-gemini'); // Backward compatibility
    function hideGlobalSettingsModal() { globalSettingsModal.classList.add('hidden'); }
    
    function switchSettingsTab(targetId) {
        const tabs = document.querySelectorAll('.settings-tab-btn');
        const panels = document.querySelectorAll('.settings-tab-panel');
        
        tabs.forEach(tab => {
            if (tab.dataset.target === targetId) {
                tab.classList.add('active', 'border-primary', 'bg-primary/10', 'text-primary');
                tab.classList.remove('border-transparent', 'text-on-surface-variant');
            } else {
                tab.classList.remove('active', 'border-primary', 'bg-primary/10', 'text-primary');
                tab.classList.add('border-transparent', 'text-on-surface-variant');
            }
        });
        
        panels.forEach(panel => {
            if (panel.id === targetId) {
                panel.classList.remove('hidden');
                // Auto-focus logic based on tab
                if (targetId === 'settings-tab-gemini') {
                    setTimeout(() => document.getElementById('gemini-api-key')?.focus(), 50);
                } else if (targetId === 'settings-tab-worker') {
                    setTimeout(() => document.getElementById('global-worker-url')?.focus(), 50);
                } else if (targetId === 'settings-tab-typo') {
                    setTimeout(() => document.getElementById('replace-original-input')?.focus(), 50);
                } else if (targetId === 'settings-tab-terminology') {
                    setTimeout(() => document.getElementById('terminology-term-input')?.focus(), 50);
                }
            } else {
                panel.classList.add('hidden');
            }
        });
    }

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

            if (expiryTime === 'session' || expiryTime === 'never') {
                apiKeyCountdown.textContent = '金鑰有效。';
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
            const countText = `金鑰有效，尚餘 ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            apiKeyCountdown.textContent = countText;

            const portalText = document.getElementById('portal-key-status-text');
            if (portalText && portalText.textContent.startsWith('已設定')) {
                const keysJson = getStorageItem('geminiApiKeys');
                let keysCount = 0;
                try {
                    keysCount = keysJson ? JSON.parse(keysJson).length : (getStorageItem('geminiApiKey') ? 1 : 0);
                } catch(e) {}
                portalText.textContent = `已設定 (共 ${keysCount} 組金鑰) (金鑰有效，尚餘 ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')})`;
            }
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
        // 同步歡迎首頁 (Welcome Portal) 金鑰狀態
        const portalBox = document.getElementById('portal-key-status-box');
        const portalText = document.getElementById('portal-key-status-text');
        const portalBtn = document.getElementById('portal-key-setting-btn');
        if (portalBox && portalText && portalBtn) {
            const indicator = portalBox.querySelector('span.rounded-full');
            if (keysCount > 0) {
                portalBox.className = 'portal-key-card p-3 rounded-xl border flex items-center justify-center gap-3 transition-all duration-300 border-green-500/20 bg-green-500/5 text-green-300 text-sm';
                if (indicator) {
                    indicator.className = 'inline-block w-2.5 h-2.5 rounded-full bg-green-500 shrink-0';
                }
                
                let timeText = '';
                const expiry = getStorageItem('apiKeyExpiry');
                if (expiry === 'session' || expiry === 'never') {
                    timeText = ' (金鑰有效)';
                } else if (expiry) {
                    const remaining = parseInt(expiry, 10) - Date.now();
                    if (remaining > 0) {
                        const hours = Math.floor((remaining / (1000 * 60 * 60)) % 24);
                        const minutes = Math.floor((remaining / 1000 / 60) % 60);
                        const seconds = Math.floor((remaining / 1000) % 60);
                        timeText = ` (金鑰有效，尚餘 ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')})`;
                    }
                }
                
                portalText.textContent = `已設定 (共 ${keysCount} 組金鑰)${timeText}`;
                portalBtn.textContent = '管理金鑰';
                portalBtn.className = 'py-1 px-3 rounded text-xs bg-green-500/25 hover:bg-green-500/40 text-green-200 border border-green-500/30 transition-all';
            } else {
                portalBox.className = 'portal-key-card p-3 rounded-xl border flex items-center justify-center gap-3 transition-all duration-300 border-red-500/20 bg-red-500/5 text-red-300 text-sm';
                if (indicator) {
                    indicator.className = 'inline-block w-2.5 h-2.5 rounded-full bg-red-500 shrink-0';
                }
                portalText.textContent = '金鑰尚未設定，請先進行設定以啟用 AI 功能';
                portalBtn.textContent = '設定金鑰';
                portalBtn.className = 'py-1 px-3 rounded text-xs bg-red-500/25 hover:bg-red-500/40 text-red-200 border border-red-500/30 transition-all';
            }
        }

        updateTabAvailability();
        updateAiButtonStatus();
    }
    
export const updateTabAvailability = function() {
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
        
        const hasTab2Draft = hasBlogDraft && hasBlogDraft();
        const tab2Dot = document.getElementById('tab2-dot');
        if (tab2Dot) { tab2Dot.classList.toggle('hidden', !hasTab2Draft); }
        const hasTab3Draft = hasSocialDraft && hasSocialDraft();
        const tab3Dot = document.getElementById('tab3-dot');
        if (tab3Dot) { tab3Dot.classList.toggle('hidden', !hasTab3Draft); }
        const hasTab6Draft = hasInfographicDraft && hasInfographicDraft();
        const tab6Dot = document.getElementById('tab6-dot');
        if (tab6Dot) { tab6Dot.classList.toggle('hidden', !hasTab6Draft); }
        
        updateSourceStatusUI();
    }


export const switchTab = (tabId) => {
        allTabButtons.forEach(btn => btn.classList.remove('active'));
        allTabContents.forEach(content => content.classList.add('hidden'));
        
        const clickedButton = document.querySelector(`[data-tab="${tabId}"]`);
        clickedButton.classList.add('active');
        document.getElementById(tabId).classList.remove('hidden');

        const dot = document.getElementById(`${tabId}-dot`);
        if (dot) { dot.classList.add('hidden'); }

        if (tabId === 'tab2' && updateStepperUI) { updateStepperUI(); }
        if (tabId === 'tab6' && analyzeInfographicContent) { analyzeInfographicContent(); }
        updateSourceStatusUI();
    }
    
        try { if (initializeTab0) { initializeTab0(); } } catch(e) { console.error("Error initializing Tab 0:", e); }
        try { initializeTab1(); } catch(e) { console.error("Error initializing Tab 1:", e); }
        try { initializeTab2(); } catch(e) { console.error("Error initializing Tab 2:", e); }
        try { initializeTab3(); } catch(e) { console.error("Error initializing Tab 3:", e); }
        try { initializeTab4(); } catch(e) { console.error("Error initializing Tab 4:", e); }
        try { initializeTab5(); } catch(e) { console.error("Error initializing Tab 5:", e); }
        try { if (initializeTab6) { initializeTab6(); } } catch(e) { console.error("Error initializing Tab 6:", e); }

        try { updateApiKeyStatus(); } catch(e) { console.error("Error updating API key status:", e); }

        // --- Worker Settings Logic ---
        const workerUrlInput = document.getElementById('global-worker-url');
        const workerTokenInput = document.getElementById('global-worker-token');
        const workerExpirySelect = document.getElementById('worker-expiry-select');
        const saveWorkerSettingsBtn = document.getElementById('save-worker-settings-btn');
        const clearWorkerSettingsBtn = document.getElementById('clear-worker-settings-btn');
        const testWorkerConnectionBtn = document.getElementById('test-worker-connection-btn');
        const workerTestStatus = document.getElementById('worker-test-status');

        const WORKER_URL_KEY = 'aliang-tab0-worker-url';
        const WORKER_TOKEN_KEY = 'aliang-tab0-worker-token';
        const WORKER_EXPIRY_KEY = 'aliang-worker-expiry';

        function loadWorkerSettings() {
            const url = localStorage.getItem(WORKER_URL_KEY) || sessionStorage.getItem(WORKER_URL_KEY) || '';
            const token = localStorage.getItem(WORKER_TOKEN_KEY) || sessionStorage.getItem(WORKER_TOKEN_KEY) || '';
            if (workerUrlInput) workerUrlInput.value = url;
            if (workerTokenInput) workerTokenInput.value = token;
        }

        function saveWorkerSettings() {
            const url = workerUrlInput.value.trim();
            const token = workerTokenInput.value.trim();
            const expiryType = workerExpirySelect ? workerExpirySelect.value : 'session';
            
            // Clear old storage
            localStorage.removeItem(WORKER_URL_KEY);
            localStorage.removeItem(WORKER_TOKEN_KEY);
            localStorage.removeItem(WORKER_EXPIRY_KEY);
            sessionStorage.removeItem(WORKER_URL_KEY);
            sessionStorage.removeItem(WORKER_TOKEN_KEY);

            if (!url) {
                showToast('已清除 Worker 設定');
                return;
            }

            if (expiryType === 'session') {
                sessionStorage.setItem(WORKER_URL_KEY, url);
                if (token) sessionStorage.setItem(WORKER_TOKEN_KEY, token);
            } else {
                localStorage.setItem(WORKER_URL_KEY, url);
                if (token) localStorage.setItem(WORKER_TOKEN_KEY, token);
                
                if (expiryType !== 'never') {
                    const days = parseInt(expiryType, 10);
                    const expiryTime = Date.now() + days * 24 * 60 * 60 * 1000;
                    localStorage.setItem(WORKER_EXPIRY_KEY, expiryTime.toString());
                } else {
                    localStorage.setItem(WORKER_EXPIRY_KEY, 'never');
                }
            }
            showToast('✅ Worker 設定已儲存');
        }

        function checkWorkerExpiry() {
            const expiry = localStorage.getItem(WORKER_EXPIRY_KEY);
            if (expiry && expiry !== 'never') {
                if (Date.now() > parseInt(expiry, 10)) {
                    localStorage.removeItem(WORKER_URL_KEY);
                    localStorage.removeItem(WORKER_TOKEN_KEY);
                    localStorage.removeItem(WORKER_EXPIRY_KEY);
                    console.log("Worker 設定已過期，已自動清除");
                }
            }
        }

        if (clearWorkerSettingsBtn) {
            clearWorkerSettingsBtn.addEventListener('click', () => {
                if (workerUrlInput) workerUrlInput.value = '';
                if (workerTokenInput) workerTokenInput.value = '';
                
                localStorage.removeItem(WORKER_URL_KEY);
                localStorage.removeItem(WORKER_TOKEN_KEY);
                localStorage.removeItem(WORKER_EXPIRY_KEY);
                sessionStorage.removeItem(WORKER_URL_KEY);
                sessionStorage.removeItem(WORKER_TOKEN_KEY);

                if (workerTestStatus) workerTestStatus.textContent = '';
                showToast('已清除 Worker 設定。', { type: 'success' });
            });
        }
        if (saveWorkerSettingsBtn) saveWorkerSettingsBtn.addEventListener('click', saveWorkerSettings);

        if (testWorkerConnectionBtn) {
            testWorkerConnectionBtn.addEventListener('click', async () => {
                if (!workerTestStatus) return;
                const url = workerUrlInput?.value.trim();
                const token = workerTokenInput?.value.trim();
                
                if (!url) {
                    workerTestStatus.textContent = '❌ 請先填入 Worker URL';
                    workerTestStatus.className = 'text-sm text-error mt-2';
                    return;
                }
                
                workerTestStatus.textContent = '⏳ 測試連線中...';
                workerTestStatus.className = 'text-sm text-on-surface-variant mt-2';
                
                try {
                    const baseUrl = url.replace(/\/+$/, '');
                    const testUrl = `${baseUrl}/api/health`;
                    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
                    
                    const response = await fetch(testUrl, { method: 'GET', headers: headers });
                    if (response.ok) {
                        workerTestStatus.textContent = '✅ 連線成功！';
                        workerTestStatus.className = 'text-sm text-success mt-2';
                    } else if (response.status === 401 || response.status === 403) {
                        workerTestStatus.textContent = '❌ 連線成功，但 Token 驗證失敗 (401/403)';
                        workerTestStatus.className = 'text-sm text-error mt-2';
                    } else {
                        workerTestStatus.textContent = `⚠️ 連線失敗 (狀態碼: ${response.status})`;
                        workerTestStatus.className = 'text-sm text-error mt-2';
                    }
                } catch (error) {
                    workerTestStatus.textContent = `❌ 無法連線至 Worker (${error.message})`;
                    workerTestStatus.className = 'text-sm text-error mt-2 text-wrap';
                }
            });
        }

        // Initialize worker settings
        checkWorkerExpiry();
        loadWorkerSettings();

        // --- Custom Dictionary & Worker Settings Logic ---
        const addReplaceRuleBtn = document.getElementById('add-replace-rule-btn');
        const replaceOriginalInput = document.getElementById('replace-original-input');
        const replaceReplacementInput = document.getElementById('replace-replacement-input');
        const replaceRulesList = document.getElementById('replace-rules-list');
        const clearAllRulesBtn = document.getElementById('clear-all-rules-btn');
        const loadPresetRulesBtn = document.getElementById('load-preset-rules-btn');
        const savePresetRulesBtn = document.getElementById('save-preset-rules-btn');
        const exportRulesBtn = document.getElementById('export-rules-btn');
        const importRulesBtn = document.getElementById('import-rules-btn');
        const importRulesFileInput = document.getElementById('import-rules-file-input');
        const STORAGE_KEY_REPLACE_RULES = 'aliang-yttb-replace-rules-preset';

        export function renderReplaceRules() {
            if (!replaceRulesList) return;
            replaceRulesList.innerHTML = '';
            if (state.batchReplaceRules.length === 0) {
                replaceRulesList.innerHTML = `<p class="p-4 text-center text-on-surface-variant/60">尚未新增任何取代規則</p>`;
                return;
            }
            state.batchReplaceRules.forEach((rule, index) => {
                const ruleEl = document.createElement('div');
                ruleEl.className = 'rule-item text-on-surface bg-surface-variant/20 p-2 rounded mb-2 flex items-center justify-between border border-outline-variant/10';
                ruleEl.innerHTML = ` <div class="flex items-center space-x-2 truncate"><span class="rule-text font-mono">${rule.original}</span> <span class="text-on-surface-variant/60">→</span> <span class="rule-text font-mono">${rule.replacement}</span></div> <button class="rule-delete-btn text-error hover:text-error-container" data-index="${index}" title="刪除此規則"> <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg> </button> `;
                replaceRulesList.appendChild(ruleEl);
            });
            // Update Tab1 button if it exists
            const tab1BatchBtn = document.getElementById('batch-replace-btn');
            if (tab1BatchBtn) {
                if (state.batchReplaceRules.length > 0) {
                    tab1BatchBtn.textContent = `批次取代 (已設定 ${state.batchReplaceRules.length} 條)`;
                    tab1BatchBtn.classList.add('active');
                } else {
                    tab1BatchBtn.textContent = '批次取代';
                    tab1BatchBtn.classList.remove('active');
                }
            }
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
                    if (state.batchReplaceRules.length > 0) {
                        if (!confirm('載入範本將會清除目前未儲存的規則，確定要繼續嗎？')) return;
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
                        const isValid = rules.every(r => r && typeof r.original === 'string' && typeof r.replacement === 'string');
                        if (!isValid) {
                            showModal({ title: '匯入失敗', message: '匯入的檔案格式不正確。' });
                            return;
                        }
                        if (state.batchReplaceRules.length > 0) {
                            if (!confirm('匯入規則將會覆蓋當前暫存的規則，確定要繼續嗎？')) return;
                        }
                        state.batchReplaceRules = rules;
                        renderReplaceRules();
                        showToast(`📥 成功匯入 ${rules.length} 條取代規則！`);
                    } else {
                        showModal({ title: '匯入失敗', message: '匯入的檔案內容必須是 JSON 陣列。' });
                    }
                } catch (error) {
                    showModal({ title: '匯入失敗', message: '解析 JSON 檔案失敗。' });
                }
            };
            reader.readAsText(file);
        }

        if (addReplaceRuleBtn) addReplaceRuleBtn.addEventListener('click', addReplaceRule);
        if (clearAllRulesBtn) clearAllRulesBtn.addEventListener('click', clearAllRules);
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


        const termLoadPresetRulesBtn = document.getElementById('term-load-preset-rules-btn');
        const termSavePresetRulesBtn = document.getElementById('term-save-preset-rules-btn');
        const termExportRulesBtn = document.getElementById('term-export-rules-btn');
        const termImportRulesBtn = document.getElementById('term-import-rules-btn');
        const termImportRulesFileInput = document.getElementById('term-import-rules-file-input');

        function saveTermPresetRules() {
            if (state.aiTerminologyRules.length === 0) {
                showToast('目前沒有專有名詞可儲存。', { type: 'error' });
                return;
            }
            try {
                localStorage.setItem(STORAGE_KEY_TERM_RULES, JSON.stringify(state.aiTerminologyRules));
                showToast('✅ 已將目前專有名詞儲存為常用範本！');
            } catch (e) {
                console.error('儲存失敗:', e);
                showToast('儲存失敗。', { type: 'error' });
            }
        }

        function loadTermPresetRules() {
            try {
                const savedRules = localStorage.getItem(STORAGE_KEY_TERM_RULES);
                if (!savedRules) {
                    showToast('尚無儲存的專有名詞範本。', { type: 'error' });
                    return;
                }
                const rules = JSON.parse(savedRules);
                if (Array.isArray(rules) && rules.length > 0) {
                    if (state.aiTerminologyRules.length > 0) {
                        if (!confirm('載入範本將會清除目前未儲存的規則，確定要繼續嗎？')) return;
                    }
                    state.aiTerminologyRules = rules;
                    renderTerminologyRules();
                    showToast(`📥 已載入 ${rules.length} 條專有名詞！`);
                }
            } catch (e) {
                showToast('載入失敗，請重試。', { type: 'error' });
            }
        }

        function exportTermRules() {
            if (state.aiTerminologyRules.length === 0) {
                showToast('目前沒有規則可以匯出。', { type: 'error' });
                return;
            }
            try {
                const jsonStr = JSON.stringify(state.aiTerminologyRules, null, 2);
                const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `yttb_terminology_rules_${new Date().toISOString().slice(2, 10).replace(/-/g, "")}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                showToast('📤 規則匯出成功！');
            } catch (e) {
                showToast('匯出失敗，請重試。', { type: 'error' });
            }
        }

        function handleImportTermRulesFile(file) {
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const rules = JSON.parse(e.target.result);
                    if (Array.isArray(rules)) {
                        const isValid = rules.every(r => r && typeof r.term === 'string' && typeof r.type === 'string');
                        if (!isValid) {
                            showModal({ title: '匯入失敗', message: '格式不正確。' });
                            return;
                        }
                        if (state.aiTerminologyRules.length > 0) {
                            if (!confirm('確定要覆蓋當前的專有名詞嗎？')) return;
                        }
                        state.aiTerminologyRules = rules;
                        renderTerminologyRules();
                        showToast(`📥 成功匯入 ${rules.length} 條規則！`);
                    }
                } catch (error) {
                    showModal({ title: '匯入失敗', message: '解析 JSON 失敗。' });
                }
            };
            reader.readAsText(file);
        }

        if (termLoadPresetRulesBtn) termLoadPresetRulesBtn.addEventListener('click', loadTermPresetRules);
        if (termSavePresetRulesBtn) termSavePresetRulesBtn.addEventListener('click', saveTermPresetRules);
        if (termExportRulesBtn) termExportRulesBtn.addEventListener('click', exportTermRules);
        if (termImportRulesBtn) termImportRulesBtn.addEventListener('click', () => termImportRulesFileInput.click());
        if (termImportRulesFileInput) {
            termImportRulesFileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) handleImportTermRulesFile(file);
                e.target.value = '';
            });
        }

        // --- Terminology Rules Logic ---
        const addTermRuleBtn = document.getElementById('add-terminology-rule-btn');
        const termTypeSelect = document.getElementById('terminology-type-select');
        const termValueInput = document.getElementById('terminology-term-input');
        const termRulesList = document.getElementById('terminology-rules-list');
        const clearAllTermRulesBtn = document.getElementById('clear-all-terminology-rules-btn');
        // Reusing the same preset load/save buttons but we should actually separate them or use specific IDs
        // For simplicity, we just implement basic CRUD and save to a specific localstorage key
        const STORAGE_KEY_TERM_RULES = 'aliang-yttb-terminology-rules-preset';

        export function renderTerminologyRules() {
            if (!termRulesList) return;
            termRulesList.innerHTML = '';
            if (!state.aiTerminologyRules) state.aiTerminologyRules = [];
            if (state.aiTerminologyRules.length === 0) {
                termRulesList.innerHTML = `<p class="p-4 text-center text-on-surface-variant/60">尚未新增任何專有名詞規則</p>`;
                return;
            }
            state.aiTerminologyRules.forEach((rule, index) => {
                const ruleEl = document.createElement('div');
                const isPositive = rule.type === 'positive';
                const bgClass = isPositive ? 'bg-success/10 border-success/20' : 'bg-error/10 border-error/20';
                const textClass = isPositive ? 'text-success' : 'text-error';
                const label = isPositive ? '🟢 必須使用' : '🔴 絕對禁用';
                
                ruleEl.className = `rule-item p-2 rounded mb-2 flex items-center justify-between border ${bgClass}`;
                ruleEl.innerHTML = ` 
                    <div class="flex items-center space-x-2 truncate">
                        <span class="text-xs font-bold ${textClass}">${label}</span>
                        <span class="rule-text font-mono text-on-surface">${rule.term}</span>
                    </div>
                    <button class="term-delete-btn text-on-surface-variant hover:text-error transition-colors" data-index="${index}" title="刪除此規則">
                        <span class="material-symbols-outlined text-[18px]">delete</span>
                    </button> `;
                termRulesList.appendChild(ruleEl);
            });
            // Attach event listeners for delete buttons
            document.querySelectorAll('.term-delete-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const idx = parseInt(e.currentTarget.dataset.index);
                    state.aiTerminologyRules.splice(idx, 1);
                    renderTerminologyRules();
                });
            });
        }

        function addTerminologyRule() {
            const type = termTypeSelect.value;
            const term = termValueInput.value.trim();
            if (term) {
                state.aiTerminologyRules.push({ type, term });
                termValueInput.value = '';
                termValueInput.focus();
                renderTerminologyRules();
            }
        }

        function clearAllTerminologyRules() {
            state.aiTerminologyRules = [];
            renderTerminologyRules();
        }

        if (addTermRuleBtn) addTermRuleBtn.addEventListener('click', addTerminologyRule);
        if (clearAllTermRulesBtn) clearAllTermRulesBtn.addEventListener('click', clearAllTerminologyRules);
        
        // Also need to fix the replace rule delete buttons because they were rendered with a class but no listener added in renderReplaceRules.
        // Let's modify renderReplaceRules by attaching a global listener or doing it inside the function.

        if (replaceRulesList) {
            replaceRulesList.addEventListener('click', (e) => {
                const deleteBtn = e.target.closest('.rule-delete-btn');
                if (deleteBtn) deleteRule(parseInt(deleteBtn.dataset.index, 10));
            });
        }

        // Initialize dictionary rules
        renderReplaceRules();

        if (appearanceBtn) appearanceBtn.addEventListener('click', toggleAppearancePanel);
        if (globalSettingsBtn) globalSettingsBtn.addEventListener('click', () => showGlobalSettingsModal('settings-tab-gemini'));
        if (closeGlobalSettingsBtn) closeGlobalSettingsBtn.addEventListener('click', hideGlobalSettingsModal);
        
        document.querySelectorAll('.settings-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                switchSettingsTab(e.currentTarget.dataset.target);
            });
        });
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
        const clearApiKeysBtn = document.getElementById('clear-api-keys-btn');
        if (clearApiKeysBtn) {
            clearApiKeysBtn.addEventListener('click', () => {
                modalApiKeys = [];
                renderModalApiKeys();
                removeStorageKeys();
                updateApiKeyStatus();
                if (apiKeyInput) apiKeyInput.value = '';
                showToast('已清除所有 API Key。', { type: 'success' });
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
            if (tabId !== 'tab1' && tabId !== 'tab0' && !hasContent) {
                console.log("[Tab Click] Navigation blocked. Showing Toast.");
                showToast('請先貼上或整理您的字幕/文稿內容！', { type: 'warning' });
                return;
            }
            switchTab(tabId);
        }));
        
        if (modalCloseBtn) {
            modalCloseBtn.addEventListener('click', () => {
                if (state.currentAbortController) {
                    state.currentAbortController.abort();
state.currentAbortController = null;
                }
                hideModal();
            });
        }
        if (modalCopyBtn) modalCopyBtn.addEventListener('click', copyModalContent);
        
        if (resetAppBtn) {
            resetAppBtn.addEventListener('click', () => {
                if (confirm('您確定要重置所有內容嗎？這將會清除所有輸入和已生成的草稿。')) {
                    if(clearBlogDraft) clearBlogDraft();
                    if(clearSocialDraft) clearSocialDraft();
                    if(clearInfographicDraft) clearInfographicDraft();
                    localStorage.removeItem('lumina-edm-draft');
                    localStorage.removeItem('lumina-carousel-draft');
                    localStorage.removeItem('blogDraft');
                    localStorage.removeItem('socialDraft');
                    localStorage.removeItem('infographicDraft');
                    showToast('頁面已重置！');
                    setTimeout(() => { location.reload(); }, 500);
                }
            });
        }

        // 自動清除下游 Tab 的事件監聽
        window.addEventListener('lumina:clearDownstreamTabs', () => {
            console.log('[App] Received clearDownstreamTabs event. Clearing downstream drafts.');
            if(clearBlogDraft) clearBlogDraft();
            if(clearSocialDraft) clearSocialDraft();
            if(clearInfographicDraft) clearInfographicDraft();
            
            localStorage.removeItem('lumina-edm-draft');
            localStorage.removeItem('lumina-carousel-draft');
            localStorage.removeItem('blogDraft');
            localStorage.removeItem('socialDraft');
            localStorage.removeItem('infographicDraft');
            
            state.edmVersions = [];
            state.carouselVersions = [];
            state.infographicVersions = [];
            state.blogArticleVersions = [];
            state.socialPostVersions = [];
            state.currentBlogVersionIndex = 0;
            state.currentSocialVersionIndex = 0;
            state.currentEdmVersionIndex = 0;
            state.currentCarouselVersionIndex = 0;
            state.currentInfographicVersionIndex = 0;
            
            showToast('已自動清除舊的產出內容，準備迎接新影片！');
        });

        // 歡迎首頁 Portal 邏輯與事件綁定 (採用直接綁定與事件代理雙重保險，確保按鈕在任何情況下皆有效)
        const welcomePortal = document.getElementById('welcome-portal');
        const mainApp = document.getElementById('main-app-container');
        const portalResumeBtn = document.getElementById('portal-resume-btn');
        const portalStartBtn = document.getElementById('portal-start-btn');
        const portalKeySettingBtn = document.getElementById('portal-key-setting-btn');

        const checkDraftsAndShowResume = () => {
            const hasBlog = hasBlogDraft ? hasBlogDraft() : !!localStorage.getItem('blogDraft');
            const hasSocial = hasSocialDraft ? hasSocialDraft() : !!localStorage.getItem('socialDraft');
            const hasInfo = hasInfographicDraft ? hasInfographicDraft() : !!localStorage.getItem('infographicDraft');
            const hasEdm = window.hasEdmDraft ? window.hasEdmDraft() : !!localStorage.getItem('lumina-edm-draft');
            const hasCarousel = window.hasCarouselDraft ? window.hasCarouselDraft() : !!localStorage.getItem('lumina-carousel-draft');
            
            if ((hasBlog || hasSocial || hasInfo || hasEdm || hasCarousel) && portalResumeBtn) {
                portalResumeBtn.classList.remove('hidden');
            } else if (portalResumeBtn) {
                portalResumeBtn.classList.add('hidden');
            }
        };

        checkDraftsAndShowResume();

        const handleStartBtnClick = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            console.log("[Portal] 開始全新創作 clicked");
            
            // 直接進入頁面，不管有無設定金鑰
            if (welcomePortal) {
                welcomePortal.classList.add('portal-fade-out');
                setTimeout(() => {
                    welcomePortal.style.display = 'none';
                }, 450);
            }
            if (mainApp) {
                mainApp.classList.remove('hidden');
                mainApp.classList.add('app-fade-in');
            }
        };

        const handleKeySettingBtnClick = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            console.log("[Portal] 設定/管理金鑰 clicked");
            showApiKeyModal();
        };

        const handleResumeBtnClick = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            console.log("[Portal] 繼續上次編輯 clicked");
            let targetTab = 'tab1';
            if (hasBlogDraft && hasBlogDraft()) {
                targetTab = 'tab2';
            } else if (hasSocialDraft && hasSocialDraft()) {
                targetTab = 'tab3';
            } else if (hasInfographicDraft && hasInfographicDraft()) {
                targetTab = 'tab6';
            } else if (localStorage.getItem('blogDraft')) {
                targetTab = 'tab2';
            } else if (localStorage.getItem('socialDraft')) {
                targetTab = 'tab3';
            } else if (localStorage.getItem('infographicDraft')) {
                targetTab = 'tab6';
            }
            
            if (welcomePortal) {
                welcomePortal.classList.add('portal-fade-out');
                setTimeout(() => {
                    welcomePortal.style.display = 'none';
                }, 450);
            }
            
            if (mainApp) {
                mainApp.classList.remove('hidden');
                mainApp.classList.add('app-fade-in');
            }
            
            switchTab(targetTab);
            showToast('已成功恢復您上次的編輯內容！');
        };

        // 直接綁定事件，提供最穩定的互動
        if (portalStartBtn) {
            portalStartBtn.addEventListener('click', handleStartBtnClick);
        }
        if (portalKeySettingBtn) {
            portalKeySettingBtn.addEventListener('click', handleKeySettingBtnClick);
        }
        if (portalResumeBtn) {
            portalResumeBtn.addEventListener('click', handleResumeBtnClick);
        }

        // 同時保留事件代理，作為雙重保險
        if (welcomePortal) {
            welcomePortal.addEventListener('click', (e) => {
                const target = e.target.closest('button');
                if (!target) return;

                if (target.id === 'portal-start-btn') {
                    handleStartBtnClick(e);
                } else if (target.id === 'portal-key-setting-btn') {
                    handleKeySettingBtnClick(e);
                } else if (target.id === 'portal-resume-btn') {
                    handleResumeBtnClick(e);
                }
            });
        }

        // 跨分頁金鑰與過期狀態同步監聽器
        window.addEventListener('storage', (e) => {
            if (e.key === 'geminiApiKey' || e.key === 'geminiApiKeys' || e.key === 'apiKeyExpiry' || e.key === 'apiKeyExpiryMode') {
                updateApiKeyStatus();
            }
        });
