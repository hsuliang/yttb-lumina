export function buildMultiImageTask(imageCount, continueAfterEachImage = false) {
    const continuation = continueAfterEachImage
        ? `\n\n完成第 i 張並核對後，接續生成第 i+1 張，直到第 ${imageCount} 張完成；不要把完成單張視為整體任務結束，也不要等待使用者再次下達下一張指令。`
        : '';

    return `# 多張圖片獨立生成任務

本次任務共需生成 ${imageCount} 張獨立圖片。

請使用 AI 原生繪圖工具，依照第 1 張至第 ${imageCount} 張的順序完成全部圖片。

**執行規則：**

1. 將每一張圖片視為獨立的繪圖任務。
2. 每次呼叫繪圖工具時，只能使用目前編號對應的提示詞，且只生成 1 張圖片。
3. 每次生成前，必須重新讀取目前編號的完整規格，包括人物設定、動作、場景、風格、標題、副標題與重點文字。
4. 禁止直接重複使用前一張的完整提示詞。
5. 各張圖片必須保留指定的共同視覺風格及人物身分特徵，但場景、動作、文字與畫面內容應依個別規格變化。
6. 每張都是獨立完整的圖片，禁止將多張圖片合併成拼貼、九宮格、分割畫面、contact sheet、grid、panel 或 comic strip。
7. 每完成一張，核對圖片編號與對應規格，再進行下一張。
8. 如果圖片內容與目前編號不符，或明顯重複上一張，應判定為生成失敗，不可計入完成數量。
9. 不得以重複圖片充數，也不得擅自改用程式合成或簡報排版冒充 AI 原生繪圖。
10. 若無法完成指定張數，必須如實回報已完成與失敗的張數，不得宣稱全部完成。${continuation}

以下為各張圖片的獨立生成規格。`;
}

export function buildSingleImageRule(index) {
    return `**單張完整圖片與獨立任務限制：**

本段提示詞僅適用於第 ${index} 張圖片。

生成本張圖片時，必須使用本段指定的人物動作、場景、文字與構圖，不得混入其他編號的畫面內容或標題。

這是一張單一且完整的圖片，禁止使用分割畫面、拼貼、多格漫畫、contact sheet、grid、panel、comic strip 或多圖合併。`;
}

const CHINESE_IMAGE_NUMBERS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5 };

export function toImageNumber(value) {
    return CHINESE_IMAGE_NUMBERS[value] || Number(value);
}
