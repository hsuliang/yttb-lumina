const STYLE_DESCRIPTIONS = {
    auto: '請先分析文章的主題、情緒與受眾，自動選擇最適合的系列視覺風格，並在所有圖卡中維持一致的畫風、配色、人物比例與版面邏輯。',
    'warm-cute-chibi': '溫暖可愛 Q 版教育插畫風：頭大身體小的角色、柔和色調、厚實手繪線條與親切的教育情境。',
    'modern-minimalist-flat': '現代極簡扁平插畫風：乾淨的幾何線條、高留白比例、俐落色塊與適合社群閱讀的高對比。',
    'realistic-watercolor': '寫實手繪水彩風：細緻水彩邊緣、紙張紋理與自然手繪筆觸，適合人文、故事與情感主題。',
    minimalist: '現代極簡幾何風：俐落線條、大面積留白、高對比字體與少量精準裝飾。',
    '3d-clay': '3D 黏土擬物風：圓潤的黏土材質、精緻玩具般的立體感、柔和微距光影與明亮色彩。',
    'neo-brutalism': '高對比新醜風：粗黑邊框、撞色、不對稱構圖與帶有復古介面感的社群視覺。',
    'flat-business': '扁平商業插畫風：現代人物、柔和職場色調、清楚的資訊層次與專業感。',
    doodle: '手繪塗鴉風：不規則線稿、手繪箭頭與圖框、黑白草圖線條搭配局部色塊。',
};

const SHOT_COUNT_RULE = `若未指定張數，請依文本資訊量自動判斷：文章較短、主題集中、重點約 2～3 個時使用 4 張；文章較長、包含問題、方法、案例、延伸或結論等層次時使用 5 張。不可為了湊張數重複內容，原則上最多 5 張。`;

function cleanSourceContent(sourceContent = '') {
    return String(sourceContent)
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function normalizeRoles(roles = []) {
    return roles
        .map(role => String(role || '').trim())
        .filter(Boolean)
        .slice(0, 4);
}

function resolveStyle(style = 'auto', customStyle = '') {
    if (style === 'custom') {
        const custom = String(customStyle || '').trim();
        if (!custom) throw new Error('請輸入自訂風格提示詞。');
        return `自訂視覺風格：${custom}`;
    }
    return STYLE_DESCRIPTIONS[style] || STYLE_DESCRIPTIONS.auto;
}

function resolveShotCount(shotCount = 'auto') {
    if (shotCount === '4' || shotCount === '5') return `固定規劃 ${shotCount} 張圖卡。`;
    return SHOT_COUNT_RULE;
}

function resolveOutputPrefixInstruction(shotCount = 'auto') {
    if (shotCount === '4' || shotCount === '5') {
        return `輸出的第一行必須原樣寫出：「生成以下 ${shotCount} 張圖片，務必分開生成，一次只生一張，共 ${shotCount}張」。這一行必須是整段輸出的最前方，不可在前面加入標題、說明或其他內容。`;
    }
    return '請先依文本資訊量決定實際生成 4 或 5 張圖片，再把 XXX 替換為同一個實際張數。輸出的第一行必須是：「生成以下 XXX 張圖片，務必分開生成，一次只生一張，共 XXX張」，這一行必須是整段輸出的最前方，不可在前面加入標題、說明或其他內容。';
}

function buildRoleInstruction(roles) {
    if (!roles.length) {
        return `未提供人物參考圖片。可依文章情境安排適合的教師、學生、主持人或講師角色，但人物動作必須與內容有關；也可以只使用工具、場景或抽象視覺，不要讓人物在每張圖都只是站著微笑。`;
    }

    const roleLines = roles.map((role, index) => `- image${index + 1}：${role}`);
    return `使用者提供的角色／素材參考圖片如下，請將它們視為唯一身分參考來源，保留臉型、五官、髮型、年齡感、服裝、配件與可辨識特徵，不可擅自更換外貌或新增未設定的角色：\n${roleLines.join('\n')}\n在每張提示詞中提及角色時，必須使用對應的 image 變數與原名，例如 image1（${roles[0]}）。人物不必每張都出現，請依內容安排示範、解說、操作、討論、指向重點、陪伴或邀請等有意義的動作。`;
}

function buildLogoInstruction(includeLogo, roles) {
    if (!includeLogo) {
        return '本次不加入 Logo；所有提示詞都不可描述 Logo、浮水印或商標。';
    }
    const logoIndex = roles.length + 1;
    return `每張圖的提示詞文末都必須指定右上角安全區放置 image${logoIndex} 的原始 Logo。直接使用原始 Logo，保留原始比例、樣貌與文字，不可重繪、變形、改色或裁切，整組圖卡的位置與大小一致。`;
}

export const REELS_PROMPT_RULES = `
請完成以下整組圖卡，但務必一次只生成一張，且每張必須分開生成；不可將多張圖合併為單一拼貼圖、分割畫面、多格漫畫、contact sheet、grid、panel，也不可一次輸出多張成品。

先完整閱讀文本，再分析 Hook、核心問題、重要觀點、方法或案例、結論與 CTA，最後整理成有起承轉合、適合快速滑讀的 Facebook Reels 9:16 直式圖卡。不可逐段照抄文章，也不可把整篇文章塞進圖片。每張圖卡只能傳達一個核心訊息，主標建議 8～15 字，副標以 1 行為佳，重點最多 3 點。
`;

export function buildReelsPrompt({
    sourceContent = '',
    purpose = 'Facebook Reels 圖卡',
    roles = [],
    includeLogo = false,
    style = 'auto',
    customStyle = '',
    brandColors = '',
    shotCount = 'auto',
    variationModifier = '',
    shouldOverride = false,
} = {}) {
    const source = cleanSourceContent(sourceContent);
    if (!source) throw new Error('無法找到可用於生成 Reels 分鏡的內容。請先在「逐字稿整理」頁面輸入內容。');

    const normalizedRoles = normalizeRoles(roles);
    const styleDescription = shouldOverride && variationModifier
        ? `請以以下變化指令覆蓋原本的視覺風格：${variationModifier}`
        : `${resolveStyle(style, customStyle)}${variationModifier ? ` 另外加入：${variationModifier}` : ''}`;
    const palette = String(brandColors || '').trim()
        ? `品牌色請以「${String(brandColors).trim()}」為主要色彩邏輯，保持整組一致。`
        : '未指定品牌色，請依文章主題與選定風格決定和諧、易讀且一致的配色。';
    const countRule = resolveShotCount(shotCount);
    const outputPrefixInstruction = resolveOutputPrefixInstruction(shotCount);
    const roleInstruction = buildRoleInstruction(normalizedRoles);
    const logoInstruction = buildLogoInstruction(includeLogo, normalizedRoles);

    return `${REELS_PROMPT_RULES}
【任務目標】
使用用途：${purpose}
輸出一組 4～5 張適合短影音的 Reels 圖卡。${countRule}

【執行順序】
1. 先讀懂文本，不要直接生圖。
2. 先在內部分析 Hook、核心問題、重要觀點、方法或案例、結論與 CTA，決定每張圖卡的功能定位。
3. 只輸出逐張完整繪圖提示詞，不輸出規劃表、表格或分析過程；每張都是獨立完成品，執行時一次只生成其中一張。

【共同圖片規格】
- 所有圖卡固定為 9:16 直式，適用 ${purpose}。
- 整組維持一致畫風、色彩邏輯、人物比例、標題風格、版面系統與品牌調性，但每張構圖不可完全相同。
- 每張只能有一個主要視覺焦點，保留足夠留白，文字不得壓在人臉或主要物件上。
- 重要文字、人物臉部、CTA 與 Logo 避開最上方、最下方及右側互動區，放在 Reels 安全區。
- 不可做成簡報截圖感，不可使用版權動漫或影視角色。
- 每一張提示詞都要明確包含：「這是一張單一且完整的圖片，這次只生成這一張；絕對不要使用分割畫面、拼貼、多格漫畫、contact sheet、grid、panel、comic strip 或多圖合併。」

【角色與品牌素材】
${roleInstruction}
${logoInstruction}

【視覺風格與色彩】
${styleDescription}
${palette}

【故事節奏】
- 4 張優先採用：第 1 張封面／Hook；第 2 張核心問題或主要觀點；第 3 張方法／案例／實用重點；第 4 張結論／CTA。
- 5 張優先採用：第 1 張封面／Hook；第 2 張問題背景；第 3 張方法一／重點一；第 4 張方法二／重點二／案例；第 5 張結論／CTA。
- 只在最後一張優先放 CTA，可使用「收藏起來」「分享給需要的人」「關注更多教學應用」等 Reels 用語，不可使用「往左滑看更多」或「下一頁看重點」。Hashtag 若使用，只在最後一張放 2～4 個。

【每張提示詞固定欄位】
請為每張依序寫出：第幾張與功能定位、Facebook Reels 用途與 9:16 比例、整體風格、人物設定與對應 image、畫面主體與動作、場景背景、主標與副標、最多 3 個重點短句、CTA（需要時）、Logo 處理、安全區與留白限制，以及單張完整圖片與禁止拼貼的限制。主標與副標請直接呈現文字內容，不要把「主標題：」「副標題：」「重點短句：」等分類標籤印到圖上。

【輸出開頭固定指令】
${outputPrefixInstruction}

【原始文本】
---
${source}
---

請使用繁體中文輸出，先輸出上述固定開頭指令，再依序使用「[第 1 張]」「[第 2 張]」等標題，只輸出實際規劃的 4 或 5 段逐張完整繪圖提示詞；不要輸出規劃表、表格或分析說明，不要使用 Markdown 程式碼區塊，不要把多張圖片的成品合併成一張。`;
}

export function extractReelsPromptBlocks(text = '') {
    const matches = [];
    const markerPattern = /(?:^|\n)\s*\[?第\s*([1-5一二三四五])\s*張[^\n]*\]?/gi;
    let match;
    while ((match = markerPattern.exec(text)) !== null) {
        matches.push({ index: match.index, number: match[1] });
    }
    return matches.map((marker, index) => {
        const end = matches[index + 1]?.index ?? text.length;
        const content = text.slice(marker.index, end).trim();
        return { number: marker.number, content };
    });
}

function resolveOutputShotCount(text, requestedShotCount = 'auto') {
    if (requestedShotCount === '4' || requestedShotCount === '5') return requestedShotCount;
    const blockCount = extractReelsPromptBlocks(text).length;
    if (blockCount === 4 || blockCount === 5) return String(blockCount);
    const declaredCount = String(text).match(/生成以下\s*([45])\s*張圖片/);
    return declaredCount?.[1] || '4';
}

export function normalizeReelsPromptOutput(text = '', requestedShotCount = 'auto') {
    const cleaned = String(text || '').trim();
    if (!cleaned) return '';

    const blocks = extractReelsPromptBlocks(cleaned);
    const shotCount = resolveOutputShotCount(cleaned, requestedShotCount);
    const prefix = `生成以下 ${shotCount} 張圖片，務必分開生成，一次只生一張，共 ${shotCount}張`;
    if (!blocks.length) {
        return cleaned.startsWith(prefix) ? cleaned : `${prefix}\n\n${cleaned}`;
    }

    return `${prefix}\n\n${blocks.map(block => block.content).join('\n\n')}`;
}
