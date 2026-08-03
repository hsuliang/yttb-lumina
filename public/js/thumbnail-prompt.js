const STYLE_DESCRIPTIONS = {
    auto: '請分析影片主題、受眾與情緒，從現代 3D 綜藝動畫、電影級超寫實渲染、明亮 3D 歡樂動畫、賽博龐克霓虹科技或暖光寫實攝影中，選擇最能提高點擊意願的視覺風格。',
    'saturated-3d': '色彩極度飽和的現代 3D 綜藝動畫風格，材質立體、色彩鮮明，帶有強烈戲劇性光影反差。',
    'cinematic-realistic': '電影級超寫實渲染風格，具有真實材質、戲劇性輪廓光、電影調色與細緻景深。',
    'bright-3d-animation': '色彩飽和明亮的 3D 歡樂動畫風格，採用溫暖明亮色調、柔和但立體的光影與充滿童趣的高品質 3D 角色質感；適合教育、親子、陪伴與正向和解主題，但不可仿作任何受版權保護的角色。',
    'cyberpunk-neon': '帶有懸疑打光的賽博龐克霓虹科技風，以深藍與暗色調為底，搭配螢光粉、青色霓虹光、數位數據流與豐富光影層次；適合 AI、自動化、演算法與前衛科技主題。',
    'warm-realistic-photo': '帶有電影級溫暖打光的高畫質質感寫實攝影風格，運用自然窗光或柔和室內光、溫暖色調與豐富真實場景細節；適合深度訪談、知識對談與兼具知性溫度的主題。',
};

const SHOT_DESCRIPTIONS = {
    auto: '請依主體數量、關鍵物件與故事情境，從廣角仰角、近景特寫、廣角平視、廣角俯視或對稱式全景中選擇最能引導視線並強化情緒張力的鏡頭。',
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
只能使用上述已設定角色，不可擅自增加其他主持人、來賓或路人；依內容為角色安排強烈但自然的表情、動作與互動。`
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

請先在內部分析影片最值得點擊的核心衝突、驚喜、問題或結果，再撰寫語意完整、具有攝影機運鏡概念的敘事性指令。不要輸出分析過程、說明、標題標籤、Markdown 程式碼區塊或多個方案，只輸出最終提示詞。

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
2. [主體與動作]：清楚描述畫面主體、表情、動作及情緒反差，讓縮小後仍能瞬間理解故事。
3. [地點/背景]：設計能強化影片主題的具體場景，避免無關裝飾與資訊過載。
4. [構圖/鏡頭]：${shotDescription}
5. [文字]：${titleInstruction} ${subtitleInstruction} ${logoInstruction} 依主體位置在另一側或畫面上方預留乾淨負空間，將主標題與副標題（若有）用兩組半形雙引號標示，例如：""爆款密碼""與""三個方法解決你的困擾""。主標題必須比副標題醒目；明確描述兩者的字體、大小、顏色與效果，使用巨大的現代無襯線粗體、高對比配色、深色粗描邊或醒目色塊，確保手機縮圖尺寸仍清楚可讀。
6. [藝術風格]：${styleDescription} 本段必須完整加註：「畫面長寬比為 16:9」。

【圖片與排版規格】
- 長寬比必須設定為 16:9，符合 YouTube 影片封面比例。
- 這是一張單一且完整的圖片，絕對不要使用分割畫面、拼貼格、多圖組合或漫畫方格（single complete image, no split screen, no collage, no grid, no panels, no comic strip）。
- 直接寫出應出現在圖片上的文字，不可印出「主標題：」、「文字：」或其他分類標籤。
- 不可出現任何未授權動漫、影視角色或仿冒品牌識別。
- 最終提示詞的最後一句必須原文寫上：「調整人物的光線與陰影以完全符合環境氛圍。」

【原始內容】
---
${cleanSource}
---`;
}
