const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const html = fs.readFileSync('index.html', 'utf8');
const dom = new JSDOM(html);
const document = dom.window.document;

// 1. Add sidebar tabs
const sidebar = document.querySelector('.flex.flex-col.md\\:flex-row.flex-1.overflow-hidden .w-full.md\\:w-48');

const typoTab = document.createElement('button');
typoTab.className = "settings-tab-btn w-full text-left px-4 py-3 text-sm font-medium transition-colors border-l-2 border-transparent text-on-surface-variant hover:bg-surface-variant/20 hover:text-on-surface flex items-center gap-2 whitespace-nowrap";
typoTab.setAttribute('data-target', 'settings-tab-typo');
typoTab.innerHTML = '<span class="material-symbols-outlined text-[18px]">spellcheck</span>錯字替換管理';

const termTab = document.createElement('button');
termTab.className = "settings-tab-btn w-full text-left px-4 py-3 text-sm font-medium transition-colors border-l-2 border-transparent text-on-surface-variant hover:bg-surface-variant/20 hover:text-on-surface flex items-center gap-2 whitespace-nowrap";
termTab.setAttribute('data-target', 'settings-tab-terminology');
termTab.innerHTML = '<span class="material-symbols-outlined text-[18px]">menu_book</span>專有名詞設定';

sidebar.appendChild(typoTab);
sidebar.appendChild(termTab);

// 2. Remove the old "錯字替換與特殊名詞處理" from the Gemini Tab panel
const oldReplaceSection = document.getElementById('batch-replace-container')?.parentElement;
if (oldReplaceSection) {
    oldReplaceSection.remove();
}

// 3. Create the Typo Tab Panel
const panelsContainer = document.querySelector('.flex-1.p-6.overflow-y-auto.custom-scrollbar');

const typoPanel = document.createElement('div');
typoPanel.id = "settings-tab-typo";
typoPanel.className = "settings-tab-panel hidden space-y-4";
typoPanel.innerHTML = `
    <div class="bg-surface-container-lowest/50 rounded-xl p-4 border border-outline-variant/10">
        <h4 class="text-lg font-bold text-on-surface mb-2 flex items-center gap-2"><span class="material-symbols-outlined text-primary">spellcheck</span>錯字替換管理</h4>
        <p class="text-xs text-on-surface-variant mb-4 leading-relaxed">
            設定全域錯字替換規則。這些規則將在「逐字稿轉換」完成後，強制執行純文字替換。
        </p>
        
        <div class="flex items-end gap-2 mb-4 bg-surface-container-highest/30 p-3 rounded-lg border border-outline-variant/20">
            <div class="flex-1">
                <label class="block text-xs font-semibold text-on-surface-variant mb-1">錯誤字 (欲替換)</label>
                <input type="text" id="global-replace-target" class="w-full px-3 py-2 bg-surface-container-lowest text-on-surface text-sm rounded-lg border border-outline-variant/30 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all placeholder:text-on-surface-variant/30" placeholder="例如：ㄚ亮">
            </div>
            <div class="flex-none flex items-center justify-center pb-2 text-on-surface-variant">
                <span class="material-symbols-outlined">arrow_forward</span>
            </div>
            <div class="flex-1">
                <label class="block text-xs font-semibold text-on-surface-variant mb-1">正確字 (替換為)</label>
                <input type="text" id="global-replace-with" class="w-full px-3 py-2 bg-surface-container-lowest text-on-surface text-sm rounded-lg border border-outline-variant/30 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all placeholder:text-on-surface-variant/30" placeholder="例如：丫亮">
            </div>
            <button id="add-global-replace-btn" class="px-4 py-2 bg-primary text-on-primary rounded-lg hover:brightness-110 transition-all font-semibold shadow-sm flex items-center gap-1 text-sm h-[38px]">
                <span class="material-symbols-outlined text-[18px]">add</span>新增
            </button>
        </div>
        
        <div id="batch-replace-container" class="space-y-2 max-h-48 overflow-y-auto custom-scrollbar pr-1">
            <!-- Rules will be dynamically inserted here -->
            <p class="text-xs text-on-surface-variant/50 italic py-2 text-center">尚未新增任何替換規則</p>
        </div>
    </div>
`;

// 4. Create the Terminology Tab Panel
const termPanel = document.createElement('div');
termPanel.id = "settings-tab-terminology";
termPanel.className = "settings-tab-panel hidden space-y-4";
termPanel.innerHTML = `
    <div class="bg-surface-container-lowest/50 rounded-xl p-4 border border-outline-variant/10">
        <h4 class="text-lg font-bold text-on-surface mb-2 flex items-center gap-2"><span class="material-symbols-outlined text-primary">menu_book</span>專有名詞設定</h4>
        <p class="text-xs text-on-surface-variant mb-4 leading-relaxed">
            設定正向與負向表列詞彙。這些規則將會附加在底層 System Prompt 之中，指導 AI (Gemini/Whisper) 產出最符合品牌調性的文字，並提早應用於語音辨識階段。
        </p>
        
        <div class="flex items-end gap-2 mb-4 bg-surface-container-highest/30 p-3 rounded-lg border border-outline-variant/20 flex-wrap">
            <div class="flex-none w-32">
                <label class="block text-xs font-semibold text-on-surface-variant mb-1">規則類型</label>
                <select id="global-term-type" class="w-full px-3 py-2 bg-surface-container-lowest text-on-surface text-sm rounded-lg border border-outline-variant/30 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all appearance-none cursor-pointer">
                    <option value="positive">🟢 必須使用</option>
                    <option value="negative">🔴 絕對禁用</option>
                </select>
            </div>
            <div class="flex-1 min-w-[200px]">
                <label class="block text-xs font-semibold text-on-surface-variant mb-1">詞彙內容</label>
                <input type="text" id="global-term-value" class="w-full px-3 py-2 bg-surface-container-lowest text-on-surface text-sm rounded-lg border border-outline-variant/30 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all placeholder:text-on-surface-variant/30" placeholder="例如：噗噗聊聊">
            </div>
            <button id="add-global-term-btn" class="px-4 py-2 bg-primary text-on-primary rounded-lg hover:brightness-110 transition-all font-semibold shadow-sm flex items-center gap-1 text-sm h-[38px]">
                <span class="material-symbols-outlined text-[18px]">add</span>新增
            </button>
        </div>
        
        <div id="ai-terminology-container" class="space-y-2 max-h-48 overflow-y-auto custom-scrollbar pr-1">
            <!-- Terminology Rules will be dynamically inserted here -->
            <p class="text-xs text-on-surface-variant/50 italic py-2 text-center">尚未新增任何專有名詞規則</p>
        </div>
    </div>
`;

panelsContainer.appendChild(typoPanel);
panelsContainer.appendChild(termPanel);

fs.writeFileSync('index.html', dom.serialize());
console.log('Successfully updated index.html');
