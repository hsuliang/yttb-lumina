import { showToast, showModal, hideModal } from './ui-components.js';
import { callGeminiAPI } from './gemini-api.js';
import { state } from './state.js';
import { activateSource, getPreferredSource, isCurrentSource } from './content-source.js';
import { VariationHub } from './variation-hub.js';
import { getBalancedApiKey, hasTextAIEnabled, showApiKeyModal } from './app.js';
import { buildReelsPrompt, extractReelsPromptBlocks, normalizeReelsPromptOutput } from './reels-prompt.js';
import { renderMarkdownBold } from './markdown-renderer.js';

export function initializeTab8() {
    const generateBtn = document.getElementById('generate-reels-btn');
    const variationBtn = document.getElementById('generate-reels-variation-btn');
    const rolesContainer = document.getElementById('reels-roles-container');
    const addRoleBtn = document.getElementById('reels-add-role-btn');
    const styleSelect = document.getElementById('reels-style');
    const customStyleContainer = document.getElementById('reels-custom-style-container');
    const customStyleTextarea = document.getElementById('reels-custom-style');
    const includeLogoInput = document.getElementById('reels-include-logo');
    const brandColorsInput = document.getElementById('reels-brand-colors');
    const purposeInput = document.getElementById('reels-purpose');
    const shotCountSelect = document.getElementById('reels-shot-count');
    const versionsContainer = document.getElementById('reels-versions-tabs-container');
    const placeholder = document.getElementById('reels-placeholder');
    const outputContainer = document.getElementById('reels-output-container');
    const promptDisplay = document.getElementById('reels-prompt-display');
    const copyAllBtn = document.getElementById('copy-all-reels-prompts-btn');
    const individualCopyContainer = document.getElementById('reels-individual-copy-container');
    const referenceCarouselBtn = document.getElementById('reels-reference-carousel-btn');

    if (!generateBtn || !variationBtn || !rolesContainer || !addRoleBtn || !styleSelect || !customStyleContainer || !customStyleTextarea || !includeLogoInput || !brandColorsInput || !purposeInput || !shotCountSelect || !versionsContainer || !placeholder || !outputContainer || !promptDisplay || !copyAllBtn || !individualCopyContainer) return;

    let roles = [];

    function syncRolesFromInputs() {
        roles = Array.from(rolesContainer.querySelectorAll('.reels-role-name'))
            .map(input => ({ name: input.value.trim() }));
    }

    function renderRoles() {
        rolesContainer.replaceChildren();
        roles.forEach((role, index) => {
            const row = document.createElement('div');
            row.className = 'flex items-center gap-2 bg-[var(--gray-bg)] p-2 rounded border border-[var(--card-border)] relative group w-full';

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'reels-role-name flex-grow min-w-0 p-1 text-xs rounded border border-[var(--card-border)] bg-[var(--bg-color)] text-[var(--body-text)]';
            input.placeholder = '角色／素材名稱（如：ㄚ亮笑長）';
            input.value = role.name;
            input.addEventListener('input', syncRolesFromInputs);

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'reels-delete-role-btn text-red-500 hover:text-red-700 text-xs font-semibold px-1 focus:outline-none';
            deleteBtn.dataset.index = String(index);
            deleteBtn.title = '刪除此角色';
            deleteBtn.textContent = '✕';

            row.append(input, deleteBtn);
            rolesContainer.appendChild(row);
        });
        addRoleBtn.disabled = roles.length >= 4;
    }

    function setLoadingState(isLoading) {
        promptDisplay.classList.toggle('text-center', isLoading);
        promptDisplay.classList.toggle('animate-pulse', isLoading);
        promptDisplay.style.color = isLoading ? '#f97316' : '';
        promptDisplay.style.fontSize = isLoading ? '1.1rem' : '';
        promptDisplay.style.fontWeight = isLoading ? '600' : '';
    }

    function renderVersionTabs() {
        versionsContainer.replaceChildren();
        state.reelsVersions.forEach((version, index) => {
            const tab = document.createElement('button');
            tab.className = 'tab-btn text-sm py-2 px-4';
            tab.textContent = `版本 ${index + 1}`;
            if (index === state.currentReelsVersionIndex) tab.classList.add('active');
            tab.addEventListener('click', () => {
                state.currentReelsVersionIndex = index;
                renderVersionTabs();
                renderCurrentVersion();
            });
            versionsContainer.appendChild(tab);
        });
    }

    function renderIndividualCopyButtons(text) {
        individualCopyContainer.replaceChildren();
        extractReelsPromptBlocks(text).forEach((block, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'font-semibold py-1 px-3 rounded btn-secondary text-xs transition-all duration-200 flex items-center gap-1';
            button.textContent = `📋 複製第 ${index + 1} 張`;
            button.title = '複製這一張的 Reels 繪圖提示詞';
            button.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(block.content);
                    showToast(`第 ${index + 1} 張 Reels 提示詞已複製！`, { type: 'success' });
                } catch (_) {
                    showToast('複製失敗，請手動選取提示詞。', { type: 'error' });
                }
            });
            individualCopyContainer.appendChild(button);
        });
    }

    function renderCurrentVersion() {
        const currentVersion = state.reelsVersions[state.currentReelsVersionIndex];
        if (!currentVersion) {
            outputContainer.classList.add('hidden');
            placeholder.classList.remove('hidden');
            variationBtn.disabled = true;
            copyAllBtn.classList.add('hidden');
            individualCopyContainer.replaceChildren();
            return;
        }
        placeholder.classList.add('hidden');
        outputContainer.classList.remove('hidden');
        variationBtn.disabled = false;
        copyAllBtn.classList.remove('hidden');
        setLoadingState(false);
        renderMarkdownBold(promptDisplay, currentVersion.textContent);
        renderIndividualCopyButtons(currentVersion.textContent);
    }

    function resetTab8() {
        state.reelsVersions = [];
        state.currentReelsVersionIndex = 0;
        roles = [];
        purposeInput.value = 'Facebook Reels 圖卡';
        includeLogoInput.checked = false;
        brandColorsInput.value = '';
        shotCountSelect.value = 'auto';
        styleSelect.value = 'auto';
        customStyleTextarea.value = '';
        customStyleContainer.classList.add('hidden');
        renderRoles();
        renderVersionTabs();
        renderCurrentVersion();
    }

    function referenceCarouselSettings() {
        syncRolesFromInputs();
        const carouselRoleInputs = document.querySelectorAll('.carousel-role-name');
        if (document.getElementById('carousel-roles-container')) {
            roles = Array.from(carouselRoleInputs).map(input => ({ name: input.value.trim() }));
        }
        const carouselLogo = document.getElementById('carousel-include-logo');
        const carouselStyle = document.getElementById('carousel-style');
        const carouselCustomStyle = document.getElementById('carousel-custom-style');
        if (carouselLogo) includeLogoInput.checked = carouselLogo.checked;
        if (carouselStyle) styleSelect.value = carouselStyle.value;
        if (carouselCustomStyle) customStyleTextarea.value = carouselCustomStyle.value;
        customStyleContainer.classList.toggle('hidden', styleSelect.value !== 'custom');
        renderRoles();
        showToast('已參考輪播圖的角色、Logo 與視覺風格設定。', { type: 'success' });
    }

    function collectPrompt(variationModifier = '', shouldOverride = false) {
        const rawSource = document.getElementById('smart-area')?.value || '';
        if (!state.currentSourceId && rawSource.trim()) activateSource(rawSource);
        const sourceContent = getPreferredSource(rawSource).text;
        syncRolesFromInputs();
        return buildReelsPrompt({
            sourceContent,
            purpose: purposeInput.value.trim() || 'Facebook Reels 圖卡',
            roles: roles.map(role => role.name),
            includeLogo: includeLogoInput.checked,
            style: styleSelect.value,
            customStyle: customStyleTextarea.value,
            brandColors: brandColorsInput.value,
            shotCount: shotCountSelect.value,
            variationModifier,
            shouldOverride,
        });
    }

    async function handleGenerate({ variationModifier = '', shouldOverride = false, isVariation = false } = {}) {
        if (state.currentAbortController) {
            state.currentAbortController.abort();
            state.currentAbortController = null;
            return;
        }
        if (!hasTextAIEnabled()) {
            showApiKeyModal();
            return;
        }

        let prompt;
        try {
            prompt = collectPrompt(variationModifier, shouldOverride);
        } catch (error) {
            showModal({ title: '無法生成 Reels 逐張繪圖提示詞', message: error.message });
            return;
        }

        const requestSourceId = state.currentSourceId;
        const apiKey = getBalancedApiKey();
        state.currentAbortController = new AbortController();
        const activeBtn = isVariation ? variationBtn : generateBtn;
        const originalBtnHtml = activeBtn.innerHTML;
        activeBtn.innerHTML = '<span class="material-symbols-outlined text-[18px]">close</span>中斷生成';
        activeBtn.classList.add('bg-error/10', 'text-error', 'border-error/20');
        placeholder.classList.add('hidden');
        outputContainer.classList.remove('hidden');
        renderMarkdownBold(promptDisplay, '正在整理 Reels 逐張繪圖提示詞…');
        setLoadingState(true);

        try {
            let receivedFirstChunk = false;
            const result = await callGeminiAPI(apiKey, prompt, false, (chunkText, fullText) => {
                if (!isCurrentSource(requestSourceId)) return;
                if (!receivedFirstChunk && chunkText) {
                    receivedFirstChunk = true;
                    setLoadingState(false);
                }
                renderMarkdownBold(promptDisplay, fullText);
                promptDisplay.scrollTop = promptDisplay.scrollHeight;
            }, state.currentAbortController.signal, '@cf/openai/gpt-oss-120b');

            if (!isCurrentSource(requestSourceId)) return;
            const textContent = normalizeReelsPromptOutput(
                result.trim().replace(/^```(?:markdown|text|prompt)?\s*|\s*```$/gi, ''),
                shotCountSelect.value,
            );
            const version = { sourceId: requestSourceId, textContent };
            if (isVariation) {
                state.reelsVersions.push(version);
                state.currentReelsVersionIndex = state.reelsVersions.length - 1;
            } else {
                state.reelsVersions = [version];
                state.currentReelsVersionIndex = 0;
            }
            renderVersionTabs();
            renderCurrentVersion();
            showToast(`Reels 逐張繪圖提示詞${isVariation ? '新版本' : ''}已生成！`, { type: 'success' });
        } catch (error) {
            console.error('Reels 逐張繪圖提示詞生成失敗:', error);
            setLoadingState(false);
            if (error.name === 'AbortError' || error.message?.includes('aborted')) {
                renderMarkdownBold(promptDisplay, '生成已中斷。');
            } else if (error.message?.includes('overloaded')) {
                showModal({
                    title: 'AI 正在尖峰時段，請稍候！',
                    message: '目前模型負載過高，您可以稍後再試。',
                    buttons: [
                        { text: '關閉', class: 'btn-secondary', callback: hideModal },
                        { text: '立即重試', class: 'btn-primary', callback: () => { hideModal(); handleGenerate({ variationModifier, shouldOverride, isVariation }); } },
                    ],
                });
            } else {
                showModal({ title: '生成失敗', message: `發生錯誤：${error.message}` });
            }
            if (!isVariation && state.reelsVersions.length === 0) renderCurrentVersion();
        } finally {
            state.currentAbortController = null;
            activeBtn.innerHTML = originalBtnHtml;
            activeBtn.classList.remove('bg-error/10', 'text-error', 'border-error/20');
        }
    }

    addRoleBtn.addEventListener('click', () => {
        if (roles.length >= 4) return;
        syncRolesFromInputs();
        roles.push({ name: '' });
        renderRoles();
    });

    rolesContainer.addEventListener('click', event => {
        if (!event.target.classList.contains('reels-delete-role-btn')) return;
        syncRolesFromInputs();
        roles.splice(Number(event.target.dataset.index), 1);
        renderRoles();
    });

    styleSelect.addEventListener('change', () => {
        customStyleContainer.classList.toggle('hidden', styleSelect.value !== 'custom');
    });
    generateBtn.addEventListener('click', () => handleGenerate());
    variationBtn.addEventListener('click', () => {
        VariationHub.open('reels', (variationModifier, shouldOverride) => {
            handleGenerate({ variationModifier, shouldOverride, isVariation: true });
        });
    });
    copyAllBtn.addEventListener('click', async () => {
        const currentVersion = state.reelsVersions[state.currentReelsVersionIndex];
        if (!currentVersion) return;
        try {
            await navigator.clipboard.writeText(currentVersion.textContent);
            showToast('全部 Reels 逐張繪圖提示詞已複製！', { type: 'success' });
        } catch (_) {
            showToast('複製失敗，請手動選取提示詞。', { type: 'error' });
        }
    });
    referenceCarouselBtn?.addEventListener('click', referenceCarouselSettings);
    window.addEventListener('lumina:clearDownstreamTabs', resetTab8);

    renderRoles();
    renderVersionTabs();
    renderCurrentVersion();
}
