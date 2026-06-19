const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

// Replace sidebar button
const oldSidebarBtn = `                    <button class="settings-tab-btn w-full text-left px-4 py-3 text-sm font-medium transition-colors border-l-2 border-transparent text-on-surface-variant hover:bg-surface-variant/20 hover:text-on-surface flex items-center gap-2 whitespace-nowrap" data-target="settings-tab-dict">
                        <span class="material-symbols-outlined text-[18px]">find_replace</span>專有名詞替換
                    </button>`;

const newSidebarBtns = `                    <button class="settings-tab-btn w-full text-left px-4 py-3 text-sm font-medium transition-colors border-l-2 border-transparent text-on-surface-variant hover:bg-surface-variant/20 hover:text-on-surface flex items-center gap-2 whitespace-nowrap" data-target="settings-tab-typo">
                        <span class="material-symbols-outlined text-[18px]">spellcheck</span>錯字替換管理
                    </button>
                    <button class="settings-tab-btn w-full text-left px-4 py-3 text-sm font-medium transition-colors border-l-2 border-transparent text-on-surface-variant hover:bg-surface-variant/20 hover:text-on-surface flex items-center gap-2 whitespace-nowrap" data-target="settings-tab-terminology">
                        <span class="material-symbols-outlined text-[18px]">menu_book</span>專有名詞設定
                    </button>`;

html = html.replace(oldSidebarBtn, newSidebarBtns);

// Find the start of settings-tab-dict and its end
const startDict = html.indexOf('<!-- Tab 3: Custom Dictionary -->');
const endDictStr = `                    </div>\n                </div>\n            </div>\n        </div>\n    </div>\n\n    <!-- Blog Wizard prompt modal -->`;
const endDict = html.indexOf(endDictStr);

if (startDict !== -1 && endDict !== -1) {
    const oldDictPanel = html.substring(startDict, endDict);
    
    const newPanels = `<!-- Tab 3: Typo Replacement -->
                    <div id="settings-tab-typo" class="settings-tab-panel hidden flex flex-col h-full">
                        <h4 class="text-lg font-bold text-on-surface mb-2">錯字替換管理</h4>
                        <p class="text-xs text-on-surface-variant leading-relaxed mb-4">
                            您設定的替換規則，將會在 Tab 1「開始整理」時自動對逐字稿執行強制文字取代，用來修正 AI 經常聽錯的錯字。
                        </p>
                        
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4 shrink-0">
                            <input type="text" id="replace-original-input" placeholder="錯誤字 (要被取代的文字)" class="md:col-span-1 rounded-lg p-2.5 bg-surface-container-lowest/50 border border-outline-variant/20 text-xs text-on-surface focus:outline-none">
                            <input type="text" id="replace-replacement-input" placeholder="正確字 (取代為)" class="md:col-span-1 rounded-lg p-2.5 bg-surface-container-lowest/50 border border-outline-variant/20 text-xs text-on-surface focus:outline-none">
                            <button id="add-replace-rule-btn" class="md:col-span-1 font-bold rounded-lg bg-primary text-on-primary hover:brightness-110 text-xs flex items-center justify-center gap-1"><span class="material-symbols-outlined text-[16px]">add</span>新增規則</button>
                        </div>
                        
                        <div id="replace-rules-list" class="flex-grow border border-outline-variant/20 rounded-xl bg-surface-container-lowest/30 p-3 min-h-[180px] overflow-y-auto text-on-surface custom-scrollbar"></div>
                        
                        <div class="mt-4 flex flex-wrap justify-between items-center gap-4 shrink-0 border-t border-outline-variant/10 pt-4">
                            <div class="flex gap-2 ml-auto">
                                <button id="clear-all-replace-rules-btn" class="font-bold py-2 px-3 rounded-lg bg-error-container/20 border border-error/20 text-error hover:bg-error-container/40 text-xs">全部清除</button>
                            </div>
                        </div>
                    </div>

                    <!-- Tab 4: Terminology Settings -->
                    <div id="settings-tab-terminology" class="settings-tab-panel hidden flex flex-col h-full">
                        <h4 class="text-lg font-bold text-on-surface mb-2">專有名詞設定</h4>
                        <p class="text-xs text-on-surface-variant leading-relaxed mb-4">
                            設定專有名詞與禁用詞。這些規則將提早應用於「語音辨識」，並引導後續所有 AI 文案的生成。
                        </p>
                        
                        <div class="flex flex-col md:flex-row gap-3 mb-4 shrink-0 items-end">
                            <div class="w-full md:w-1/3">
                                <label class="block text-xs font-semibold text-on-surface-variant mb-1">規則類型</label>
                                <select id="terminology-type-select" class="w-full rounded-lg p-2.5 bg-surface-container-lowest/50 border border-outline-variant/20 text-xs text-on-surface focus:outline-none cursor-pointer appearance-none">
                                    <option value="positive">🟢 必須使用 (正向表列)</option>
                                    <option value="negative">🔴 絕對禁用 (負向表列)</option>
                                </select>
                            </div>
                            <div class="flex-1">
                                <label class="block text-xs font-semibold text-on-surface-variant mb-1">詞彙內容</label>
                                <input type="text" id="terminology-term-input" placeholder="例如：噗噗聊聊" class="w-full rounded-lg p-2.5 bg-surface-container-lowest/50 border border-outline-variant/20 text-xs text-on-surface focus:outline-none">
                            </div>
                            <div class="w-full md:w-auto">
                                <button id="add-terminology-rule-btn" class="w-full font-bold rounded-lg bg-primary text-on-primary hover:brightness-110 text-xs flex items-center justify-center gap-1 h-[36px] px-4"><span class="material-symbols-outlined text-[16px]">add</span>新增</button>
                            </div>
                        </div>
                        
                        <div id="terminology-rules-list" class="flex-grow border border-outline-variant/20 rounded-xl bg-surface-container-lowest/30 p-3 min-h-[180px] overflow-y-auto text-on-surface custom-scrollbar"></div>
                        
                        <div class="mt-4 flex flex-wrap justify-between items-center gap-4 shrink-0 border-t border-outline-variant/10 pt-4">
                            <div class="flex flex-wrap gap-1.5">
                                <button id="load-preset-rules-btn" class="font-bold py-1.5 px-2.5 rounded-lg border border-outline-variant/30 text-on-surface hover:bg-surface-variant/30 text-xs">📥 載入範本</button>
                                <button id="save-preset-rules-btn" class="font-bold py-1.5 px-2.5 rounded-lg border border-outline-variant/30 text-on-surface hover:bg-surface-variant/30 text-xs">💾 存為範本</button>
                                <button id="export-rules-btn" class="font-bold py-1.5 px-2.5 rounded-lg border border-outline-variant/30 text-on-surface hover:bg-surface-variant/30 text-xs">📤 匯出規則</button>
                                <button id="import-rules-btn" class="font-bold py-1.5 px-2.5 rounded-lg border border-outline-variant/30 text-on-surface hover:bg-surface-variant/30 text-xs">📥 匯入規則</button>
                                <input type="file" id="import-rules-file-input" class="hidden" accept=".json">
                            </div>
                            <div class="flex gap-2 ml-auto">
                                <button id="clear-all-terminology-rules-btn" class="font-bold py-2 px-3 rounded-lg bg-error-container/20 border border-error/20 text-error hover:bg-error-container/40 text-xs">全部清除</button>
                            </div>
                        </div>
                    </div>
`;
    html = html.replace(oldDictPanel, newPanels);
    fs.writeFileSync('index.html', html);
    console.log('index.html updated successfully via string replacement.');
} else {
    console.log('Could not find dict panel markers.');
}
