export const FACEBOOK_POST_WRITING_RULES = [
    '- 只談一個主題；貼文本身必須先提供價值，即使讀者不點連結，看完也要有收穫。',
    '- 貼文目標只用來決定內容角度，不是額外的 CTA；全文仍只能保留一個主要行動。',
    '- 前 1～3 行就要讓人停下來，優先使用痛點、疑問、衝突、意外、真實情境、現場對話或直接結論。不要用「大家好」「今天來分享」「隨著科技發展」「在這個 AI 時代」等空泛開場。',
    '- 先寫具體情境再講觀點，讓讀者先看到畫面；避免只寫抽象效果或口號。',
    '- 至少安排一個清楚的轉折，例如「我原本以為……後來才發現……」或「真正的問題不是……而是……」，讓內容形成可記住的觀點。',
    '- 需要整理方法或案例時控制在 3～5 點；每一點都要說明怎麼做、怎麼用、為什麼、常見錯誤或實際差異，不能只寫「提升動機」「培養素養」等空話。',
    '- 以手機閱讀為優先：每段 1～3 句、一段只講一件事；重要句可獨立成段，長短句交錯並適度換行。',
    '- 優先保留逐字稿中的個人故事、教學案例、使用心得、研習現場、失敗經驗、學生反應與個人觀察；只能使用來源提供的事實，不得自行補寫。',
    '- 金句最多 1～2 句，而且要具體準確；避免空泛雞湯、過度浮誇或 AI 公版語氣。',
    '- CTA 只保留一個主要動作。若使用者提供 CTA，將它視為唯一 CTA；若沒有，選擇一個最自然的動作。不要同時要求按讚、留言、分享、追蹤、點連結、報名或標記朋友。',
    '- 不使用低品質互動誘餌，例如「留言 +1」「留言 888」「同意請按讚」；若要提問，必須是值得回答、和內容直接相關的問題。',
    '- Hashtag 只保留高度相關標籤：生活文 0 個、教學／AI／工具文 0～2 個、活動文最多 2～3 個；即使使用者輸入較多，也只保留最相關的數量。',
    '- Emoji 只用來導讀，例如 🔥、👉、🔹、📌，不要每一句都放。',
    '- 外部連結自然寫明用途，例如「完整操作步驟放在第一則留言」；貼文本身仍須先有足夠內容。',
    '- 送出前檢查：前三行是否會讓人停下來、是否只談一個主題、是否有具體內容與個人觀點、手機閱讀是否清楚、CTA 是否只有一個、Hashtag／Emoji 是否節制；不點連結時，貼文仍要值得閱讀。',
].join('\n');

export function buildFacebookPostInstruction({ listify = false, question = false, hasCta = false } = {}) {
    const rules = [FACEBOOK_POST_WRITING_RULES];
    if (listify) {
        rules.push('- 依上述手機閱讀原則，將較長的段落拆成條列式（• 或 ‣），每點保留具體做法或差異。');
    }
    if (question) {
        rules.push(hasCta
            ? '- 使用者已提供 CTA，因此不要另外加入互動問句。'
            : '- 將一個和內容直接相關、值得回答的問題作為唯一 CTA。');
    }
    return rules.join('\n');
}

export function assembleSocialPrompt(options) {
    const {
        objective,
        length,
        tone,
        hashtags,
        cta,
        sourceText,
        variationModifier,
        shouldOverride = false,
        wizardSettings = {},
    } = options;

    const globalRules = [];
    globalRules.push('- 粗體格式：需要強調時，直接使用 <strong>...</strong> 標記文字；不要使用 Markdown 的雙星號粗體標記，也不要輸出其他 HTML 標籤。');
    if (variationModifier) globalRules.push(`- 風格變化指令: ${variationModifier}`);
    globalRules.push(`- 貼文目標: ${objective}`);
    globalRules.push(`- 貼文長度: ${length}`);
    if (!variationModifier || !shouldOverride) globalRules.push(`- 寫作語氣: ${tone}`);
    if (hashtags) globalRules.push(`- 指定Hashtags: ${hashtags}`);
    if (cta) globalRules.push(`- 行動呼籲: ${cta}`);
    if (wizardSettings.coreViewpoint) {
        globalRules.push(`- 核心觀點: 請務必在所有貼文中，特別強調並放大這個核心觀點：「${wizardSettings.coreViewpoint}」`);
    }
    if (wizardSettings.hook && wizardSettings.hook !== 'auto') {
        const hookMap = {
            question: '用一個引人深思的問題開始',
            painpoint: '點出一個讀者的痛點或驚人的數據來開頭',
            story: '描述一個小故事或情境來開頭',
        };
        globalRules.push(`- 開頭鉤子: ${hookMap[wizardSettings.hook]}`);
    }
    if (wizardSettings.ctaStrategy && wizardSettings.ctaStrategy !== 'default') {
        const ctaMap = {
            highlight: '請將行動呼籲(CTA)用分隔線「---」或特殊符號「👇」包圍，使其在文末特別醒目',
            natural: '請將行動呼籲(CTA)的核心意思，自然地安插在文章中段的某個地方，而不是放在文末',
        };
        globalRules.push(`- CTA策略: ${ctaMap[wizardSettings.ctaStrategy]}`);
    }

    const fbRules = buildFacebookPostInstruction({
        listify: wizardSettings.fbListify,
        question: wizardSettings.fbQuestion,
        hasCta: Boolean(cta?.trim()),
    });
    const igRules = [];
    if (wizardSettings.igEmoji) igRules.push('- 規則: 請在每個段落或條列項目前，都加上最符合語意的 Emoji，讓版面更生動。');
    if (wizardSettings.igHashtags) igRules.push('- 規則: 除了使用者指定的Hashtags，請根據內文，自動額外生成 5-10 個相關的熱門 Hashtags。');
    const lineRules = [];
    if (wizardSettings.lineColloquial) lineRules.push('- 規則: 請務必使用更像朋友聊天的口語化詞彙（例如：「話說」、「～啊」、「啦」）。');
    if (wizardSettings.lineSticker) lineRules.push('- 規則: 在適當的地方，用文字建議適合的貼圖，例如 `(熊大灑花)`、`(兔兔驚訝)`。');

    return `你是一位專業的社群內容總監。請根據以下[逐字稿]和指定的[參數]，把同一份內容依照不同平台的閱讀情境，分別改寫成 Facebook、Instagram、Line 推廣貼文。優先抓出受眾痛點與具體解方、反差衝突，或逐字稿中的有力金句，避免流水帳摘要。

所有人名、機構、數字、事件、引言與觀點只能取自逐字稿；未提供的事實不得自行補寫。請嚴格按照指定的格式與分隔標記輸出，不要有任何額外的文字或說明。

[通用參數]:
${globalRules.join('\n')}

[FACEBOOK_POST_START]
${fbRules}
[FACEBOOK_POST_END]

[INSTAGRAM_POST_START]
(撰寫一篇適合 Instagram 閱讀與收藏的深度貼文。以有力金句或痛點情境開場，依序完成「引言／痛點破題 → 精簡的情境鋪陳 → 核心解方 → 明確 CTA → Hashtags」。段落短、節奏鮮明並適量使用 Emoji；文末附上 5-10 個相關 Hashtags。${igRules.length > 0 ? '\n' + igRules.join('\n') : ''})
[INSTAGRAM_POST_END]

[LINE_POST_START]
(撰寫一則能在一秒內促使讀者點擊的 Line 官方帳號／群組推播。依序完成「朋友般的親切問候或痛點提問 → 一句話揭露最強亮點並保留懸念 → 明確邀請點擊連結」。內容必須極短、親切、急迫且高轉換；若[行動呼籲]或逐字稿沒有提供網址，使用「【置入短連結】」作為可編輯位置，不得虛構網址。${lineRules.length > 0 ? '\n' + lineRules.join('\n') : ''})
[LINE_POST_END]

[逐字稿]:
---
${sourceText}
---`;
}
