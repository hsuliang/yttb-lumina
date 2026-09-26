import { hideModal, showModal, showToast } from './ui-components.js';

const TAB_SETTINGS = {
    tab5: {
        label: 'TAB5 輪播圖',
        buttonId: 'carousel-reference-settings-btn',
        rolesContainerId: 'carousel-roles-container',
        roleInputSelector: '.carousel-role-name',
        roleDeleteSelector: '.carousel-delete-role-btn',
        roleAddButtonId: 'carousel-add-role-btn',
        logoInputId: 'carousel-include-logo',
        styleSelectId: 'carousel-style',
        customStyleInputId: 'carousel-custom-style',
    },
    tab6: {
        label: 'TAB6 資訊圖表',
        buttonId: 'infographic-reference-settings-btn',
        rolesContainerId: 'infographic-roles-container',
        roleInputSelector: '.infographic-role-name',
        roleDeleteSelector: '.infographic-delete-role-btn',
        roleAddButtonId: 'infographic-add-role-btn',
        logoInputId: 'infographic-include-logo',
        styleSelectId: 'infographic-style',
        customStyleInputId: 'infographic-custom-style',
    },
    tab7: {
        label: 'TAB7 YT 封面',
        buttonId: 'thumbnail-reference-settings-btn',
        rolesContainerId: 'thumbnail-roles-container',
        roleInputSelector: '.thumbnail-role-name',
        roleDeleteSelector: '.thumbnail-delete-role-btn',
        roleAddButtonId: 'thumbnail-add-role-btn',
        logoInputId: 'thumbnail-include-logo',
        styleSelectId: 'thumbnail-style',
        customStyleInputId: 'thumbnail-custom-style',
    },
    tab8: {
        label: 'TAB8 Reels',
        buttonId: 'reels-reference-carousel-btn',
        rolesContainerId: 'reels-roles-container',
        roleInputSelector: '.reels-role-name',
        roleDeleteSelector: '.reels-delete-role-btn',
        roleAddButtonId: 'reels-add-role-btn',
        logoInputId: 'reels-include-logo',
        styleSelectId: 'reels-style',
        customStyleInputId: 'reels-custom-style',
    },
};

function readSettings(config) {
    const rolesContainer = document.getElementById(config.rolesContainerId);
    const styleSelect = document.getElementById(config.styleSelectId);

    return {
        roles: Array.from(rolesContainer?.querySelectorAll(config.roleInputSelector) || [])
            .map(input => input.value.trim())
            .filter(Boolean)
            .slice(0, 4),
        includeLogo: Boolean(document.getElementById(config.logoInputId)?.checked),
        style: styleSelect?.value || 'auto',
        styleLabel: styleSelect?.selectedOptions?.[0]?.textContent?.trim() || 'AI 自動決定風格',
        customStyle: document.getElementById(config.customStyleInputId)?.value.trim() || '',
    };
}

function replaceRoles(config, roleNames) {
    const container = document.getElementById(config.rolesContainerId);
    const addButton = document.getElementById(config.roleAddButtonId);
    if (!container || !addButton) return;

    while (container.querySelector(config.roleInputSelector)) {
        const deleteButton = container.querySelector(config.roleDeleteSelector);
        if (!deleteButton) break;
        deleteButton.click();
    }

    roleNames.slice(0, 4).forEach(name => {
        if (addButton.disabled) return;
        addButton.click();
        const inputs = container.querySelectorAll(config.roleInputSelector);
        const input = inputs[inputs.length - 1];
        if (!input) return;
        input.value = name;
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

function applyVisualStyle(sourceConfig, targetConfig, sourceSettings) {
    const targetStyleSelect = document.getElementById(targetConfig.styleSelectId);
    const targetCustomStyle = document.getElementById(targetConfig.customStyleInputId);
    if (!targetStyleSelect || !targetCustomStyle) return { copied: false, mapped: false };

    if (sourceSettings.style === 'custom' && !sourceSettings.customStyle) {
        return { copied: false, mapped: false };
    }

    const targetSupportsStyle = Array.from(targetStyleSelect.options)
        .some(option => option.value === sourceSettings.style);
    const mapped = sourceSettings.style !== 'custom' && !targetSupportsStyle;

    targetStyleSelect.value = targetSupportsStyle ? sourceSettings.style : 'custom';
    targetCustomStyle.value = sourceSettings.style === 'custom'
        ? sourceSettings.customStyle
        : mapped
            ? `參考 ${sourceConfig.label} 的風格：${sourceSettings.styleLabel}`
            : '';
    targetStyleSelect.dispatchEvent(new Event('change', { bubbles: true }));
    return { copied: true, mapped };
}

function copySettings(sourceKey, targetKey) {
    const sourceConfig = TAB_SETTINGS[sourceKey];
    const targetConfig = TAB_SETTINGS[targetKey];
    const sourceSettings = readSettings(sourceConfig);

    replaceRoles(targetConfig, sourceSettings.roles);

    const targetLogo = document.getElementById(targetConfig.logoInputId);
    if (targetLogo) targetLogo.checked = sourceSettings.includeLogo;

    const styleResult = applyVisualStyle(sourceConfig, targetConfig, sourceSettings);
    const copied = ['角色／素材', 'Logo'];
    if (styleResult.copied) copied.push('視覺風格');

    const notice = styleResult.mapped
        ? '（此 Tab 沒有相同風格選項，已改為自訂風格描述）'
        : styleResult.copied
            ? ''
            : '（來源的自訂風格尚未填寫，因此略過風格）';
    showToast(`已參考${sourceConfig.label}的${copied.join('、')}設定${notice}。`, { type: 'success' });
}

export function initializeSharedReferenceSettings() {
    Object.entries(TAB_SETTINGS).forEach(([targetKey, targetConfig]) => {
        const button = document.getElementById(targetConfig.buttonId);
        if (!button) return;

        button.addEventListener('click', () => {
            const sourceTabs = Object.entries(TAB_SETTINGS).filter(([sourceKey]) => sourceKey !== targetKey);
            showModal({
                title: '參考其他 Tab 設定',
                message: '選擇設定來源。會複製角色／素材、Logo 與可對應的視覺風格，不會覆蓋目前 Tab 專屬的設定。',
                buttons: [
                    ...sourceTabs.map(([sourceKey, sourceConfig]) => ({
                        text: sourceConfig.label,
                        class: 'btn-secondary',
                        callback: () => {
                            hideModal();
                            copySettings(sourceKey, targetKey);
                        },
                    })),
                    { text: '取消', class: 'btn-secondary', callback: hideModal },
                ],
            });
        });
    });
}
