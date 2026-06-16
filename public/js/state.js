/**
 * state.js
 * 集中管理整個應用程式的共用狀態變數。
 */

// --- 預設資料 ---
const THEMES = {
    'old-newspaper': '老式報紙',
    'caramel-pudding': '焦糖布丁',
    'muji-style': '無印風格',
    'blueberry-pancake': '藍莓鬆餅',
    'mint-soda': '薄荷蘇打',
    'dark-knight': '暗夜騎士'
};
const PRESET_CTAS = {
    'puchat': { title: '噗噗聊聊', content: `<h2>喜歡噗噗聊聊嗎？</h2>\n<p>如果你想要了解更多關於教育及<a href="https://bit.ly/PuChatPodcast" target="_blank" rel="noopener">Podcast</a>的內容，歡迎追蹤我們的節目，一起探索教育的無限可能。</p>\n<ul>\n<li><a href="https://bit.ly/PuChatFB">噗噗聊聊粉絲專頁</a></li>\n<li><a href="https://bit.ly/PuChatYT">噗噗聊聊Youtube頻道</a></li>\n<li><a href="https://bit.ly/PuChatPodcast">噗噗聊聊Podcast</a></li>\n<li><a href="https://bit.ly/aliangblog">ㄚ亮笑長練功坊Blog</a></li>\n</ul>` },
    'izakaya': { title: '居久屋微醺夜', content: `<h2>🎁 喜歡我們的課程嗎？</h2>\n<p>如果你想要學習更多學科教學知識與科技應用，歡迎訂閱謙懿科技Youtube頻道，記得按讚追蹤我們的節目，一起探索教育的無限可能。</p>\n<ul>\n<li>謙懿科技Youtube：<a href="http://www.youtube.com/@morganfang0905" target="_blank">http://www.youtube.com/@morganfang0905</a></li>\n<li>ㄚ亮笑長練功坊Blog：<a href="https://bit.ly/aliangblog" target="_blank">https://bit.ly/aliangblog</a></li>\n</ul>` }
};
const AI_PROMPT_MESSAGES = { chapters: [ "AI 正在精讀影片內容，定位關鍵時間點...", "正在為您的影片**建立強而有力的小標題**...", "AI 正在努力思考中... 這可能會需要一點時間 (約 10-30 秒)...", "正在與ㄚ亮笑長討論**最佳章節劃分 logique**...", "影片章節結構已完成，正在進行最終格式化...", "請保持耐心，AI 正在將您的逐字稿變成導覽地圖！", ], optimize: [ "AI 正在仔細傾聽你的逐字稿，**準備修補語句**...", "正在為文本加入**更流暢的標點和分段**，保持耐心...", "AI 正在努力思考中... **優化深度內容需要較長時間** (約 30-60 秒)...", "**語句通順度檢查中**，確保文章口語化且易讀...", "正在深度校對錯別字，同時保留您說話的原味...", "我們正在請 AI 檢查，**是否有任何句子偷偷跑去放假了**...", ], blog: [ "AI 正在將口語轉化為**部落格的專業結構**...", "根據您的**人稱與語氣**設定，進行文章重構中...", "AI 正在努力思考中... **請保持耐心，內容發想需要較長時間** (約 45-90 秒)...", "正在為 SEO 目的**調整段落關鍵字密度**...", "文章的結論和 CTA 正在最終定稿，即將完成...", "AI 正在為您的文章**建立強而有力的小標題**...", ], social: [ "AI 正在為 Facebook, IG, Line **量身打造多種風格文案**...", "AI 正在確保**每個平台的語氣都符合目標受眾**...", "**最佳化 Hashtags**，讓貼文獲得更多曝光...", "正在撰寫**多個行動呼籲版本**，鼓勵粉絲互動...", "AI 正在確保您的文案**獲得社群平台的最佳演算法青睞**！", "社群貼文的多版本創意發想已進入尾聲...", ],edm: [ "AI 正在構思一封無法抗拒的郵件主旨...", "正在將您的文章精煉成最吸引人的核心重點...", "AI 正在設計一個強而有力的行動呼籲 (CTA) 按鈕...", "確保郵件語氣親切，就像寫信給好朋友一樣...", "正在為您的電子報進行最終的版面與排版檢查...", "思考如何讓讀者一點開郵件，就想馬上點擊連結..."],
    carousel: [
    "正在閱讀您的逐字稿，發想社群輪播圖的精彩故事...",
    "正在為 4 張輪播圖構思流暢的場景與視角...",
    "正在生成溫暖可愛裝扮的 Q 版角色動作與表情提示詞...",
    "正在為每一頁輪播圖提煉最吸睛的標題與副標題...",
    "正在套用 Logo 規則與繁體中文排版規範...",
    "AI 正在精細雕琢 4 組正方形輪播圖提示詞，請稍候..."
],
    infographic: [
        "正在精讀您的內容，分析並推薦最契合的排版型態...",
        "正在提煉結構化圖表文案與布局規劃...",
        "正在構建一鍵複製的 Universal AI 繪圖提示詞...",
        "正在規劃角色指代與 Logo 浮水印位置...",
        "正在編寫 Mermaid 結構圖代碼以供即時預覽...",
        "AI 正在進行最後修飾，請稍候..."
    ] };

const PRESET_TAGS = ['居久屋微醺夜', '噗噗聊聊'];
const CUSTOM_CTA_STORAGE_KEY = 'aliang-yttb-custom-ctas';
const CUSTOM_TAGS_STORAGE_KEY = 'aliang-yttb-custom-tags';

// --- 動態狀態變數 ---
let state = {
    originalFileName: '',
    processedSrtResult: '',
    apiKeyCountdownInterval: null,
    originalContentForPreview: '',
    optimizedTextForBlog: '',
    blogArticleVersions: [], 
    currentBlogVersionIndex: 0, 
    blogSourceType: 'raw',
    batchReplaceRules: [],
    socialPostVersions: [],
    currentSocialVersionIndex: 0,
    activeSocialTab: 'facebook',
    currentBlogTags: [],
    currentAiTask: null,
    promptInterval: null,
    // ########## NEW ##########
    // 新增用於管理電子報多版本的狀態
    edmVersions: [],
    currentEdmVersionIndex: 0,
    // ########## TAB 5 NEW ##########
    carouselVersions: [],
    currentCarouselVersionIndex: 0,
    // ########## TAB 6 NEW ##########
    infographicVersions: [],
    currentInfographicVersionIndex: 0
    // ########## END TAB 6 NEW ##########
};