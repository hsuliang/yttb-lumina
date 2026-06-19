const fs = require('fs');

const appJsPath = 'public/js/app.js';
let appJs = fs.readFileSync(appJsPath, 'utf8');

const termImportExportLogic = `
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
                    showToast(\`📥 已載入 \${rules.length} 條專有名詞！\`);
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
                a.download = \`yttb_terminology_rules_\${new Date().toISOString().slice(2, 10).replace(/-/g, "")}.json\`;
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
                        showToast(\`📥 成功匯入 \${rules.length} 條規則！\`);
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
`;

const insertStr = "        // --- Terminology Rules Logic ---";
const insertIndex = appJs.indexOf(insertStr);
if (insertIndex !== -1) {
    appJs = appJs.substring(0, insertIndex) + termImportExportLogic + "\n" + appJs.substring(insertIndex);
    fs.writeFileSync(appJsPath, appJs);
    console.log('AppJS updated with Terminology Import/Export');
} else {
    console.log('Failed to find insertion point');
}
