const fs = require('fs');

const appJsPath = 'public/js/app.js';
let appJs = fs.readFileSync(appJsPath, 'utf8');

// The logic to add:
const newLogic = `
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
                termRulesList.innerHTML = \`<p class="p-4 text-center text-on-surface-variant/60">尚未新增任何專有名詞規則</p>\`;
                return;
            }
            state.aiTerminologyRules.forEach((rule, index) => {
                const ruleEl = document.createElement('div');
                const isPositive = rule.type === 'positive';
                const bgClass = isPositive ? 'bg-success/10 border-success/20' : 'bg-error/10 border-error/20';
                const textClass = isPositive ? 'text-success' : 'text-error';
                const label = isPositive ? '🟢 必須使用' : '🔴 絕對禁用';
                
                ruleEl.className = \`rule-item p-2 rounded mb-2 flex items-center justify-between border \${bgClass}\`;
                ruleEl.innerHTML = \` 
                    <div class="flex items-center space-x-2 truncate">
                        <span class="text-xs font-bold \${textClass}">\${label}</span>
                        <span class="rule-text font-mono text-on-surface">\${rule.term}</span>
                    </div>
                    <button class="term-delete-btn text-on-surface-variant hover:text-error transition-colors" data-index="\${index}" title="刪除此規則">
                        <span class="material-symbols-outlined text-[18px]">delete</span>
                    </button> \`;
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
`;

// Insert the new logic before `if (replaceRulesList) {`
const insertionPointStr = `        if (replaceRulesList) {`;
const insertionIndex = appJs.indexOf(insertionPointStr);

if (insertionIndex !== -1) {
    appJs = appJs.substring(0, insertionIndex) + newLogic + "\n" + appJs.substring(insertionIndex);
}

// Fix the delete button logic for replace rules. The old code relied on event delegation on the container? 
// Yes, there is event delegation around line 935:
// `if (replaceRulesList) replaceRulesList.addEventListener('click', (e) => { const btn = e.target.closest('.rule-delete-btn'); if(btn){ deleteRule(parseInt(btn.dataset.index)); } });`
// So the delegation is fine.

// Now modify the `importRules` / `exportRules` to also include term rules, or keep them separate? The HTML only has one set of import/export buttons in each tab. 
// Ah, the HTML was duplicated! Let's check update_tabs_str.cjs output carefully.

fs.writeFileSync(appJsPath, appJs);
console.log('AppJS updated');
