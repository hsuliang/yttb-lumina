const STYLE_DESCRIPTIONS = {
    auto: '請依影片主題、受眾、情緒與色彩線索，自行判斷最合適的視覺媒材與風格；可採寫實攝影、電影感渲染、3D 動畫、插畫、平面設計、復古印刷、科技視覺或其他適切方向。保持風格一致，不要只在預設風格間機械輪替，也不要混用不相容的效果。',
    'saturated-3d': '色彩極度飽和的現代 3D 綜藝動畫風格，材質立體、色彩鮮明，帶有強烈戲劇性光影反差。',
    'cinematic-realistic': '電影級超寫實渲染風格，具有真實材質、戲劇性輪廓光、電影調色與細緻景深。',
    'bright-3d-animation': '色彩飽和明亮的 3D 歡樂動畫風格，採用溫暖明亮色調、柔和但立體的光影與充滿童趣的高品質 3D 角色質感；適合教育、親子、陪伴與正向和解主題，但不可仿作任何受版權保護的角色。',
    'cyberpunk-neon': '帶有懸疑打光的賽博龐克霓虹科技風，以深藍與暗色調為底，搭配螢光粉、青色霓虹光、數位數據流與豐富光影層次；適合 AI、自動化、演算法與前衛科技主題。',
    'warm-realistic-photo': '帶有電影級溫暖打光的高畫質質感寫實攝影風格，運用自然窗光或柔和室內光、溫暖色調與豐富真實場景細節；適合深度訪談、知識對談與兼具知性溫度的主題。',
};

const SHOT_DESCRIPTIONS = {
    auto: '請依主體數量、關鍵物件與故事情境自行決定最適合的景別、角度與透視；預設選項只是參考，不必侷限其中，也不要每次固定使用相同鏡頭或置中構圖。鏡頭應幫助觀眾讀懂故事並看清主題。',
    'close-up': '使用景深極淺的近景特寫（close-up shot），凸顯人物表情、眼神與情緒張力。',
    'low-angle-wide': '使用充滿動態張力的廣角仰角鏡頭（low-angle wide shot），讓主體具有強烈動勢與存在感。',
    'eye-level-wide': '使用充滿視覺張力與透視感的廣角平視鏡頭，保持與觀眾視線平齊並展現寬闊空間；適合雙人戲劇互動、人物情緒對比或完整呈現教室與錄音室氛圍。',
    'high-angle': '使用廣角俯視鏡頭（high-angle shot），由上往下清楚呈現桌面佈局、關鍵物件與人物圍繞互動；適合開箱、實作課程、教材與桌面細節。',
    'symmetrical-panoramic': '使用帶有強烈透視感的對稱式全景鏡頭（symmetrical panoramic shot），讓人物與背景形成秩序鮮明的對稱構圖與明顯景深；適合群像陣容、專業知識交鋒與未來科技場景。',
};

const ASPECT_RATIO_NOTE = '畫面長寬比為 16:9';
const FINAL_LIGHTING_SENTENCE = '調整人物的光線與陰影以完全符合環境氛圍。';
const ART_STYLE_LINE_PATTERN = /^(\[藝術風格\]\s*[：:]\s*)(.*)$/m;

export function ensureThumbnailAspectRatio(text = '') {
    const source = String(text);
    const match = source.match(ART_STYLE_LINE_PATTERN);

    if (!match) {
        return `${source.trimEnd()}\n\n[藝術風格]：${ASPECT_RATIO_NOTE}。`;
    }

    const content = match[2];
    if (content.includes(ASPECT_RATIO_NOTE)) return source;

    const updatedContent = content.includes(FINAL_LIGHTING_SENTENCE)
        ? content.replace(FINAL_LIGHTING_SENTENCE, `${ASPECT_RATIO_NOTE}。${FINAL_LIGHTING_SENTENCE}`)
        : `${content.trimEnd()}${content.trimEnd() && !/[。！？!?；;，,]$/.test(content.trimEnd()) ? '。' : ''}${ASPECT_RATIO_NOTE}。`;

    return source.replace(ART_STYLE_LINE_PATTERN, (_line, prefix) => `${prefix}${updatedContent}`);
}

function getStyleDescription(style, customStyle, variationModifier, shouldOverride) {
    let description = '';
    if (style === 'custom') {
        if (!customStyle.trim()) {
            throw new Error('您選擇了「自訂風格」，請輸入自訂風格提示詞。');
        }
        description = customStyle.trim();
    } else {
        description = STYLE_DESCRIPTIONS[style] || STYLE_DESCRIPTIONS.auto;
    }

    if (variationModifier) {
        return shouldOverride
            ? variationModifier
            : `${description} 另外加入以下創意方向：${variationModifier}`;
    }
    return description;
}

export function buildThumbnailPrompt({
    sourceContent,
    roles = [],
    includeLogo = false,
    title = '',
    subtitle = '',
    shot = 'auto',
    style = 'auto',
    customStyle = '',
    variationModifier = '',
    shouldOverride = false,
}) {
    const cleanSource = sourceContent.replace(/<[^>]+>/g, ' ').trim();
    if (!cleanSource) throw new Error('無法找到可用於生成 YT 封面提示詞的內容。');

    const validRoles = roles.map(role => role.trim()).filter(Boolean).slice(0, 4);
    const roleMapping = validRoles.map((role, index) => `image${index + 1} 是${role}`).join('，');
    const personOutputInstruction = validRoles.length
        ? `請參考我上傳的角色圖片（${roleMapping}），並啟動嚴格臉部一致性模式，確保人物的五官、髮型與特徵完全保持不變。`
        : '本封面不使用人物、角色圖片或臉部一致性指令，請以物件、場景、象徵元素與環境敘事呈現主題。';
    const logoIndex = validRoles.length + 1;
    const roleInstruction = validRoles.length
        ? `使用者會依序上傳以下角色參考圖片：${roleMapping}。
最終輸出的「[人物設定]」段落必須完整保留這組對應資訊，並以「請參考我上傳的角色圖片（${roleMapping}），並啟動嚴格臉部一致性模式，確保人物的五官、髮型與特徵完全保持不變。」開頭。
只能使用上述已設定角色，不可擅自增加其他主持人、來賓或路人；依內容為角色安排自然、有差異且有意義的表情、動作與互動，不必刻意誇張。`
        : `使用者沒有設定角色。最終繪圖提示詞不可出現主持人、來賓、路人或其他人物，請改以物件、場景、象徵元素與環境敘事呈現主題。不要加入角色圖片或臉部一致性指令。`;
    const logoInstruction = includeLogo
        ? `最終提示詞須加入：「右上角必須直接放上 image${logoIndex} 的 Logo 圖示，保留原始比例、原始樣貌與原始文字，不可重繪、不可變形、不可改色、不可裁切。」`
        : '最終提示詞不可出現 Logo、浮水印或商標相關描述。';
    const titleInstruction = title.trim()
        ? `封面標題必須使用使用者指定的繁體中文：「${title.trim()}」，不可改寫。`
        : '請由 AI 從影片內容自動產生一個吸睛的繁體中文封面標題，製造好奇、衝突或結果承諾；字數不設限，但應優先保持精煉、清楚且不可誇大或捏造內容。';
    const subtitleInstruction = subtitle.trim()
        ? `封面副標題必須使用使用者指定的繁體中文：「${subtitle.trim()}」，不可改寫，並作為主標題的補充說明。`
        : '使用者未指定副標題；除非 AI 判斷確有必要，否則不要額外新增副標題。';
    const titleFocusInstruction = title.trim() || subtitle.trim()
        ? `使用者指定的封面文字是整體設計核心。${title.trim() ? `主標題為「${title.trim()}」。` : '主標題未指定，請自行產生。'}${subtitle.trim() ? `副標題為「${subtitle.trim()}」。` : '副標題未指定。'}主體、動作、地點、背景、構圖、鏡頭與藝術風格都必須共同強化這組文字傳達的核心衝突、情緒與觀看承諾，不得設計出與文字無關的另一個主題。`
        : '尚未指定封面文字；請先從影片內容找出最值得點擊的核心，再讓主體、動作、地點、背景、構圖、鏡頭與藝術風格共同服務於該核心。';
    const styleDescription = getStyleDescription(style, customStyle, variationModifier, shouldOverride);
    const shotDescription = SHOT_DESCRIPTIONS[shot] || SHOT_DESCRIPTIONS.auto;

    return `你是一位專業的 YouTube 封面創意總監與 AI 繪圖提示詞專家。請根據 [原始內容] 只產出一組可以直接交給 ChatGPT Image 或 Nano Banana 類繪圖工具使用的繁體中文「YT 封面繪圖提示詞」。

先在內部判讀影片真正的主題、受眾、情緒與最值得呈現的故事，再為這張封面設計一個清楚的視覺主軸。只輸出一個完整方案，不輸出分析過程、說明、額外標題、Markdown 程式碼區塊或多個方案。

【創意安排原則】
- 「會心理解、互動討論、專業示範、投入挑戰、成果肯定」是可參考的敘事方向，不是固定模板。依影片內容挑選最合適的一種、融合相容元素，或採用更貼切的方向；不要每次照同一順序輪替。
- 人物有設定時，依角色分配不同且有意義的表情、動作與視線，例如專注觀察、思考、認同、交流、示範、期待或自然的成就感。可用微微前傾、輕指、點頭、托腮、記錄或開放手勢等細節，但要符合內容，不要為了熱鬧硬加動作。
- 避免所有人物同時瞪大雙眼、張大嘴、抱頭、尖叫、指向畫面或直視鏡頭。表情不必誇張；有情緒層次、自然互動與清楚的視線關係即可。不要因採用某種敘事方向就固定角色數量或手勢。
- 場景要與影片主題直接相關，挑選 2～4 個最能說明主題的背景細節即可。背景可適度簡化或虛化，並用人物視線、物件方向與光線自然引導觀眾閱讀。
- 主標題位置必須依人物、主題物件、視線與實際留白彈性安排，可置於左上、右上、上方中央、左右側中央、左下偏中、人物之間的負空間或其他合適位置；不要固定在同一側，也不要遮住人物臉部、重要手勢或主題物件。關鍵文字避開最右下角的影片時間標籤區。
- 標題長度不設上限。可依實際字數和語意拆成 1～4 行、調整字級與行距，或放大原文中的關鍵詞；只能調整視覺排版，不能刪改文字來遷就版面。
- 整張封面以 1 個主標題、至多 1 個副標題和 1 個主要視覺焦點為主；控制在 2～3 種主要色彩，避免同時堆疊多層描邊、陰影、底框與裝飾。
- 不要捏造影片內容未支持的事實、數據、承諾或成果。所有構圖、人物、物件與風格選擇都應服務同一主題，並確保縮成手機縮圖時仍容易辨認。

【最終輸出格式（必須完全遵守）】
只輸出以下六個段落，順序、標題、冒號與段落間的空白行都不可改變；標題不要加上 Markdown 的「**」符號。每個段落的「提示詞」都要替換成根據原始內容生成的實際描述，不要輸出「提示詞」這三個字：
[人物設定]：${personOutputInstruction}

[主體與動作]：畫面主體、表情、動作及情緒反差。

[地點/背景]：具體地點、背景與能強化主題的環境細節。

[構圖/鏡頭]：鏡頭景別、角度、主體位置、視線引導與負空間。

[文字]：實際封面標題、字體、大小、顏色、效果與文字排版。

[藝術風格]：整體藝術風格、光影、材質與渲染方式，並明確寫出「畫面長寬比為 16:9」。

六個段落都必須保留；不要增加其他標題或清單。

【角色一致性與素材指代】
${roleInstruction}
${logoInstruction}

【封面文字設計核心】
${titleFocusInstruction}

【六段式視覺架構】
1. [人物設定]：必須以「${personOutputInstruction}」開頭。
2. [主體與動作]：依影片內容描述主體、情緒與動作。有人物時，安排自然且彼此有差異的反應與視線；沒有設定角色時，以物件、場景或象徵元素承載故事，不要新增人物。
3. [地點/背景]：選擇與影片主題直接相關的具體場景，保留少量代表性細節，避免背景搶走人物、物件或文字的焦點。
4. [構圖/鏡頭]：${shotDescription}
5. [文字]：${titleInstruction} ${subtitleInstruction} ${logoInstruction} ${title.trim() ? '主標題原文是「' + title.trim() + '」；' : ''}${subtitle.trim() ? '副標題原文是「' + subtitle.trim() + '」；' : ''}使用者指定文字必須逐字保留，包括標點、數字、專有名詞及原有順序。若以引號標示文字（例如：""爆款密碼""與""三個方法解決你的困擾""），引號僅供辨識，不要把引號畫進圖片。依人物、主題物件、視線與留白彈性選擇文字位置，不要固定放在同一側；主標題必須比副標題醒目，字體與效果需在手機縮圖尺寸仍清楚可讀。
6. [藝術風格]：${styleDescription} 本段必須完整加註：「畫面長寬比為 16:9」。

【圖片與排版規格】
- 長寬比必須設定為 16:9，符合 YouTube 影片封面比例。
- 這是一張單一且完整的圖片，絕對不要使用分割畫面、拼貼格、多圖組合或漫畫方格（single complete image, no split screen, no collage, no grid, no panels, no comic strip）。
- 直接寫出應出現在圖片上的文字，不可印出「主標題：」、「文字：」或其他分類標籤。
- 若使用者有提供主標題或副標題，圖片必須逐字呈現原文；可換行與改變視覺層級，不可修改字詞、標點、數字、專有名詞或順序。標示用的引號不可印在圖片上。
- 文字位置、人物表情動作、場景細節與鏡頭選擇應隨影片內容變化；附件中的五種方向是靈感參考，不代表每張封面都必須使用其中固定的姿勢或版位。
- 不可出現任何未授權動漫、影視角色或仿冒品牌識別。
- 最終提示詞的最後一句必須原文寫上：「調整人物的光線與陰影以完全符合環境氛圍。」

【原始內容】
---
${cleanSource}
---`;
}
