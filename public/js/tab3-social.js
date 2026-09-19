import { showToast, showModal, hideModal, populateSelectWithOptions, stopPromptRotation } from './ui-components.js';
import { callGeminiAPI } from './gemini-api.js';
import { state } from './state.js';
import { activateSource, getPreferredSource, isCurrentSource } from './content-source.js';
import { VariationHub } from './variation-hub.js';
import { updateAiButtonStatus, getBalancedApiKey, hasTextAIEnabled, showApiKeyModal } from './app.js';
import { renderMarkdownBold } from './markdown-renderer.js';
import { assembleSocialPrompt } from './social-prompt.js';

/**
 * tab3-social.js
 * 負責管理第三分頁「社群貼文生成」的所有 UI 互動與邏輯。
 */
const SOCIAL_SETTINGS_STORAGE_KEYS = {
    OBJECTIVE: 'aliang-yttb-setting-social-objective',
    LENGTH: 'aliang-yttb-setting-social-length',
    TONE: 'aliang-yttb-setting-social-tone',
    PROMPT_WIZARD: 'aliang-yttb-setting-social-wizard'
};

function resetTab3() {
    state.socialPostVersions = [];
    state.currentSocialVersionIndex = 0;
    const outputContainer = document.getElementById('social-output-container');
    const placeholder = document.getElementById('social-placeholder');
    const varBtn = document.getElementById('generate-social-variation-btn');
    const copyBtn = document.getElementById('social-copy-btn');
    
    if(outputContainer) outputContainer.classList.add('hidden');
    if(placeholder) placeholder.classList.remove('hidden');
    if(varBtn) varBtn.disabled = true;
    if(copyBtn) copyBtn.classList.add('hidden');
    
    renderMarkdownBold(document.getElementById('facebook-post-output'), '');
    renderMarkdownBold(document.getElementById('instagram-post-output'), '');
    renderMarkdownBold(document.getElementById('line-post-output'), '');
    document.getElementById('social-hashtags').value = '';
    document.getElementById('social-cta').value = '';
    const wizardSettings = JSON.parse(localStorage.getItem(SOCIAL_SETTINGS_STORAGE_KEYS.PROMPT_WIZARD)) || {};
    if (wizardSettings.coreViewpoint) {
        delete wizardSettings.coreViewpoint;
        localStorage.setItem(SOCIAL_SETTINGS_STORAGE_KEYS.PROMPT_WIZARD, JSON.stringify(wizardSettings));
    }
    if (wizardCoreViewpoint) wizardCoreViewpoint.value = '';
    
}

window.addEventListener('lumina:clearDownstreamTabs', resetTab3);

function renderSocialVersionTabs() {
    const tabsContainer = document.getElementById('social-version-tabs-list') || document.getElementById('social-versions-tabs-container');
    tabsContainer.innerHTML = '';
    state.socialPostVersions.forEach((version, index) => {
        const tab = document.createElement('button');
        tab.className = 'tab-btn text-sm py-2 px-4';
        tab.textContent = `版本 ${index + 1}`;
        if (index === state.currentSocialVersionIndex) {
            tab.classList.add('active');
        }
        tab.addEventListener('click', () => switchSocialVersionView(index));
        tabsContainer.appendChild(tab);
    });
}

function switchSocialVersionView(index) {
    state.currentSocialVersionIndex = index;
    renderSocialVersionTabs();
    renderCurrentSocialVersionUI();
}

function renderCurrentSocialVersionUI() {
    const currentVersion = state.socialPostVersions[state.currentSocialVersionIndex];
    if (!currentVersion) return;
    
    renderMarkdownBold(document.getElementById('facebook-post-output'), currentVersion.facebook);
    renderMarkdownBold(document.getElementById('instagram-post-output'), currentVersion.instagram);
    renderMarkdownBold(document.getElementById('line-post-output'), currentVersion.line);

    switchSocialTab(state.activeSocialTab);
}


    const generateSocialBtn = document.getElementById('generate-social-btn');
    const generateSocialVariationBtn = document.getElementById('generate-social-variation-btn');
    const socialOutputContainer = document.getElementById('social-output-container');
    const socialPlaceholder = document.getElementById('social-placeholder');
    const socialPostOutputs = {
        facebook: document.getElementById('facebook-post-output'),
        instagram: document.getElementById('instagram-post-output'),
        line: document.getElementById('line-post-output')
    };
    const socialCopyBtn = document.getElementById('social-copy-btn');
    const socialTabBtns = document.querySelectorAll('.social-tab-btn');
    const socialObjectiveSelect = document.getElementById('social-objective');
    const socialLengthSelect = document.getElementById('social-length');
    const socialToneSelect = document.getElementById('social-tone-select');
    const socialHashtagsInput = document.getElementById('social-hashtags');
    const socialCtaTextarea = document.getElementById('social-cta');
    const openSocialWizardBtn = document.getElementById('open-social-wizard-btn');
    const socialWizardModal = document.getElementById('social-prompt-wizard-modal');
    const closeSocialWizardBtn = document.getElementById('close-social-wizard-btn');
    const saveSocialWizardBtn = document.getElementById('save-social-wizard-btn');
    const restoreSocialWizardDefaultsBtn = document.getElementById('restore-social-wizard-defaults-btn');
    const wizardCoreViewpoint = document.getElementById('social-wizard-core-viewpoint');
    const wizardFbListify = document.getElementById('social-wizard-fb-listify');
    const wizardFbQuestion = document.getElementById('social-wizard-fb-question');
    const wizardIgEmoji = document.getElementById('social-wizard-ig-emoji');
    const wizardIgHashtags = document.getElementById('social-wizard-ig-hashtags');
    const wizardLineColloquial = document.getElementById('social-wizard-line-colloquial');
    const wizardLineSticker = document.getElementById('social-wizard-line-sticker');

    function openSocialWizard() { loadAndPopulateSocialWizard(); socialWizardModal.classList.remove('hidden'); }
    function closeSocialWizard() { socialWizardModal.classList.add('hidden'); }

    function saveSocialWizardSettings() {
        const settings = {
            coreViewpoint: wizardCoreViewpoint.value.trim(),
            hook: document.querySelector('input[name="social-wizard-hook"]:checked').value,
            fbListify: wizardFbListify.checked, fbQuestion: wizardFbQuestion.checked,
            igEmoji: wizardIgEmoji.checked, igHashtags: wizardIgHashtags.checked,
            lineColloquial: wizardLineColloquial.checked, lineSticker: wizardLineSticker.checked,
            ctaStrategy: document.querySelector('input[name="social-wizard-cta"]:checked').value
        };
        localStorage.setItem(SOCIAL_SETTINGS_STORAGE_KEYS.PROMPT_WIZARD, JSON.stringify(settings));
        showToast('AI 社群風格已儲存！');
        closeSocialWizard();
    }

    function restoreSocialWizardDefaults() {
        if (confirm('您確定要清除所有社群風格設定，並恢復為預設嗎？')) {
            localStorage.removeItem(SOCIAL_SETTINGS_STORAGE_KEYS.PROMPT_WIZARD);
            loadAndPopulateSocialWizard();
            showToast('已恢復為預設社群風格。');
        }
    }

    function loadAndPopulateSocialWizard() {
        const settings = JSON.parse(localStorage.getItem(SOCIAL_SETTINGS_STORAGE_KEYS.PROMPT_WIZARD)) || {};
        wizardCoreViewpoint.value = settings.coreViewpoint || '';
        document.querySelector(`input[name="social-wizard-hook"][value="${settings.hook || 'auto'}"]`).checked = true;
        wizardFbListify.checked = settings.fbListify || false;
        wizardFbQuestion.checked = settings.fbQuestion || false;
        wizardIgEmoji.checked = settings.igEmoji || false;
        wizardIgHashtags.checked = settings.igHashtags || false;
        wizardLineColloquial.checked = settings.lineColloquial || false;
        wizardLineSticker.checked = settings.lineSticker || false;
        document.querySelector(`input[name="social-wizard-cta"][value="${settings.ctaStrategy || 'default'}"]`).checked = true;
    }

    function saveSocialSetting(key, value) { try { localStorage.setItem(key, value); } catch (e) { console.error(`無法儲存設定 ${key}:`, e); } }

    function loadSocialSettings() {
        socialObjectiveSelect.value = localStorage.getItem(SOCIAL_SETTINGS_STORAGE_KEYS.OBJECTIVE) || '引導觀看 YouTube';
        socialLengthSelect.value = localStorage.getItem(SOCIAL_SETTINGS_STORAGE_KEYS.LENGTH) || '中等';
        socialToneSelect.value = localStorage.getItem(SOCIAL_SETTINGS_STORAGE_KEYS.TONE) || '充滿能量與感染力';
    }
    
export const switchSocialTab = function(platform) {
        state.activeSocialTab = platform;
        socialTabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.platform === platform));
        for (const key in socialPostOutputs) {
            socialPostOutputs[key].classList.toggle('hidden', key !== platform);
        }
        if (state.socialPostVersions.length > 0) {
            socialCopyBtn.classList.remove('hidden');
        }
    }

        async function proceedGenerateSocialPosts(variationModifier = '', shouldOverride = false) {
            const apiKey = getBalancedApiKey ? getBalancedApiKey() : (localStorage.getItem('geminiApiKey') || sessionStorage.getItem('geminiApiKey'));
    
            const rawSourceText = document.getElementById('smart-area').value.trim();
            if (!state.currentSourceId && rawSourceText) activateSource(rawSourceText);
            const requestSourceId = state.currentSourceId;
            const preferredSource = getPreferredSource(rawSourceText);
            const sourceText = preferredSource.text.replace(/<[^>]+>/g, ' ');
    
            if (!sourceText) { showModal({ title: '錯誤', message: '缺少用於生成貼文的來源內容。' }); return; }
    
            // Determine if this is a variation based on modifier presence
            const isVariation = variationModifier !== '';
            // Removed the if(isVariation) random modifier block
    
            const wizardSettings = JSON.parse(localStorage.getItem(SOCIAL_SETTINGS_STORAGE_KEYS.PROMPT_WIZARD)) || {};
            const promptOptions = {
                objective: socialObjectiveSelect.value, length: socialLengthSelect.value, tone: socialToneSelect.value,
                hashtags: socialHashtagsInput.value, cta: socialCtaTextarea.value, sourceText: sourceText,
                variationModifier: variationModifier, shouldOverride: shouldOverride, wizardSettings
            };
            const prompt = assembleSocialPrompt(promptOptions);
    
            if (state.currentAbortController) {
                state.currentAbortController.abort();
                state.currentAbortController = null;
                return;
            }
            state.currentAbortController = new AbortController();

            const btn = isVariation ? generateSocialVariationBtn : generateSocialBtn;
            const originalBtnHtml = btn.innerHTML;
            btn.innerHTML = '<span class="material-symbols-outlined text-[18px]">close</span>中斷生成';
            btn.classList.add('bg-error/10', 'text-error', 'border-error/20');
            // btn.disabled = true; // DO NOT DISABLE so we can click to abort
            // btn.classList.add('btn-loading');

            socialPlaceholder.classList.add('hidden');
            socialOutputContainer.classList.remove('hidden');
            const activeOutput = socialPostOutputs[state.activeSocialTab];
            if (activeOutput) {
                renderMarkdownBold(activeOutput, '');
                activeOutput.classList.add('text-center', 'animate-pulse');
                activeOutput.style.color = '#f97316';
                activeOutput.style.fontSize = '1.1rem';
                activeOutput.style.fontWeight = '600';
            }

            try {
                let fullResponse = '';
                let isValidResponse = false;
                let isFirstSocialChunk = true;
                for (let i = 0; i < 2; i++) {
                    fullResponse = await callGeminiAPI(apiKey, prompt, false, (chunkText, fullText) => {
                        if (!isCurrentSource(requestSourceId)) return;
                        if (activeOutput) {
                            if (isFirstSocialChunk && chunkText !== '') {
                                isFirstSocialChunk = false;
                                activeOutput.classList.remove('text-center', 'animate-pulse');
                                activeOutput.style.color = '';
                                activeOutput.style.fontSize = '';
                                activeOutput.style.fontWeight = '';
                            }
                            renderMarkdownBold(activeOutput, fullText);
                            activeOutput.scrollTop = activeOutput.scrollHeight;
                        }
                    }, state.currentAbortController.signal);
                    if (!isCurrentSource(requestSourceId)) return;
                    if (fullResponse.includes('[FACEBOOK_POST_START]') && fullResponse.includes('[INSTAGRAM_POST_START]') && fullResponse.includes('[LINE_POST_START]')) {
                        isValidResponse = true;
                        break;
                    }
                    console.warn(`第 ${i+1} 次嘗試，社群貼文回應格式不完整，正在自動重試...`);
                    if (activeOutput) renderMarkdownBold(activeOutput, '初步回應格式不完整，正在自動重試...');
                }
            if (!isValidResponse) {
                throw new Error("AI 回應格式不完整，請稍後再試或生成另一版本。");
            }

            const fbMatch = fullResponse.match(/\[FACEBOOK_POST_START\]([\s\S]*?)\[FACEBOOK_POST_END\]/);
            const igMatch = fullResponse.match(/\[INSTAGRAM_POST_START\]([\s\S]*?)\[INSTAGRAM_POST_END\]/);
            const lineMatch = fullResponse.match(/\[LINE_POST_START\]([\s\S]*?)\[LINE_POST_END\]/);
            
            if (!isCurrentSource(requestSourceId)) return;
            const newVersion = {
                sourceId: requestSourceId,
                facebook: fbMatch ? fbMatch[1].trim() : '無法解析 Facebook 貼文。',
                instagram: igMatch ? igMatch[1].trim() : '無法解析 Instagram 貼文。',
                line: lineMatch ? lineMatch[1].trim() : '無法解析 Line 貼文。'
            };

            if (isVariation) {
                state.socialPostVersions.push(newVersion);
                state.currentSocialVersionIndex = state.socialPostVersions.length - 1;
            } else {
                state.socialPostVersions = [newVersion];
                state.currentSocialVersionIndex = 0;
            }
            
            renderSocialVersionTabs();
            renderCurrentSocialVersionUI();

            generateSocialVariationBtn.disabled = false;
            switchSocialTab('facebook');
        } catch (error) {
            if (error.name === 'AbortError' || (error.message && error.message.includes('aborted'))) {
                console.log('社群貼文生成已中斷');
                if (activeOutput) {
                    activeOutput.classList.remove('text-center', 'animate-pulse');
                    activeOutput.style.color = '';
                    activeOutput.style.fontSize = '';
                    activeOutput.style.fontWeight = '';
                    renderMarkdownBold(activeOutput, '生成已中斷。');
                }
            } else if (error.message && error.message.includes('overloaded')) { 
                showModal({ 
                    title: 'AI 正在尖峰時段，請稍候！', message: '別擔心...',
                    buttons: [ { text: '關閉', class: 'btn-secondary', callback: hideModal }, { text: '立即重試', class: 'btn-primary', callback: () => { hideModal(); proceedGenerateSocialPosts(variationModifier, shouldOverride); } } ]
                });
            } else { 
                showModal({ title: '社群貼文生成失敗', message: `發生錯誤：${error.message}` }); 
            }
        } finally {
            state.currentAbortController = null;
            btn.innerHTML = originalBtnHtml;
            btn.classList.remove('bg-error/10', 'text-error', 'border-error/20');
            btn.disabled = false;
            btn.classList.remove('btn-loading');
        }
    }

    function generateSocialPosts() {
        if (state.socialPostVersions.length > 0 && !confirm("這將會清除所有已生成的版本並重新開始，您確定嗎？")) {
            return;
        }
        proceedGenerateSocialPosts('', false);
    }

    function generateSocialVariation() {
        // Open the VariationHub modal for social posts, passing the proceed function as callback
        // The callback will receive the chosen variationModifier from the modal.
        VariationHub.open('social', (modifier, shouldOverride) => {
            proceedGenerateSocialPosts(modifier, shouldOverride);
        });
    }

    function copySocialPost() {
        const currentVersion = state.socialPostVersions[state.currentSocialVersionIndex];
        if (!currentVersion) return;
        const targetContent = currentVersion[state.activeSocialTab];
        if (targetContent) {
            navigator.clipboard.writeText(targetContent).then(() => {
                showToast('已複製到剪貼簿！');
                const originalHtml = socialCopyBtn.innerHTML;
                socialCopyBtn.innerHTML = '<span class="material-symbols-outlined text-[16px]">check</span>已複製!';
                setTimeout(() => {
                    socialCopyBtn.innerHTML = originalHtml;
                }, 2000);
            });
        }
    }

    openSocialWizardBtn.addEventListener('click', openSocialWizard);
    closeSocialWizardBtn.addEventListener('click', closeSocialWizard);
    saveSocialWizardBtn.addEventListener('click', saveSocialWizardSettings);
    restoreSocialWizardDefaultsBtn.addEventListener('click', restoreSocialWizardDefaults);
    
    generateSocialBtn.addEventListener('click', generateSocialPosts);
    generateSocialVariationBtn.addEventListener('click', generateSocialVariation);
    socialCopyBtn.addEventListener('click', copySocialPost);
    socialTabBtns.forEach(btn => btn.addEventListener('click', () => switchSocialTab(btn.dataset.platform)));

    socialObjectiveSelect.addEventListener('change', (e) => { saveSocialSetting(SOCIAL_SETTINGS_STORAGE_KEYS.OBJECTIVE, e.target.value); });
    socialLengthSelect.addEventListener('change', (e) => { saveSocialSetting(SOCIAL_SETTINGS_STORAGE_KEYS.LENGTH, e.target.value); });
    socialToneSelect.addEventListener('change', (e) => { saveSocialSetting(SOCIAL_SETTINGS_STORAGE_KEYS.TONE, e.target.value); });

    const socialObjectiveOptions = { '引導觀看 YouTube': '引導觀看 YouTube', '引導閱讀部落格': '引導閱讀部落格', '引發留言互動': '引發留言互動', '分享核心觀點': '分享核心觀點' };
    const socialLengthOptions = { '簡短': '簡短 (一句話)', '中等': '中等 (一段)', '詳細': '詳細 (多段)' };
    const toneOptions = { '充滿能量與感染力': '能量感染力', '專業且具權威性': '專業權威', '口語化且親切': '口語親切', '幽默風趣': '幽默風趣' };
    populateSelectWithOptions(socialObjectiveSelect, socialObjectiveOptions);
    populateSelectWithOptions(socialLengthSelect, socialLengthOptions);
    populateSelectWithOptions(socialToneSelect, toneOptions);
    
    loadSocialSettings();

export function initializeTab3() {}
