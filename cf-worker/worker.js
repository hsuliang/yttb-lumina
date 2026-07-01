/**
 * yttb-lumina Whisper Worker
 * 部署在 Cloudflare Workers，使用 @cf/openai/whisper-large-v3-turbo 模型
 *
 * 端點：
 *   GET  /api/health     → 健康檢查
 *   POST /api/transcribe → 音訊辨識（Binary WAV 或 multipart/form-data）
 *
 * 環境變數（選填）：
 *   API_TOKEN → 若設定，所有請求須帶 "Authorization: Bearer {token}"
 */

const WORKER_VERSION = '1.1.0';
const MODEL = '@cf/openai/whisper-large-v3-turbo';
const MAX_AUDIO_SIZE_MB = 28; // 略低於 Whisper 上限以保留緩衝

const ENGLISH_DICT_SET = new Set([
    'a', 'a few', 'a little', 'a lot', 'able', 'about', 'above', 'abroad',
    'across', 'actress', 'afraid', 'after', 'afternoon', 'again', 'age', 'ago',
    'agree', 'ahead', 'air', 'airplane', 'airport', 'all', 'almost', 'along',
    'already', 'also', 'always', 'america', 'american', 'and', 'angry', 'animal',
    'another', 'answer', 'ant', 'any', 'anyone', 'anything', 'apartment', 'ai', 'api',
    'appear', 'apple', 'april', 'arm', 'around', 'arrive', 'art', 'as',
    'ask', 'at', 'august', 'aunt', 'autumn', 'away', 'baby', 'back',
    'bad', 'badminton', 'bag', 'bake', 'bakery', 'balcony', 'ball', 'banana',
    'band', 'bank', 'barbecue', 'baseball', 'basket', 'basketball', 'bat', 'bath',
    'bathroom', 'be', 'beach', 'bean', 'bear', 'beautiful', 'because', 'become',
    'bed', 'bedroom', 'bee', 'beef', 'before', 'begin', 'behind', 'believe',
    'bell', 'belong', 'below', 'belt', 'bench', 'beside', 'between', 'big',
    'bike', 'bird', 'birthday', 'bite', 'black', 'blackboard', 'blanket', 'blind',
    'block', 'blow', 'blue', 'boat', 'body', 'boil', 'book', 'bookstore',
    'bored', 'boring', 'born', 'borrow', 'boss', 'both', 'bottle', 'bottom',
    'bow', 'bowl', 'box', 'boy', 'bread', 'break', 'breakfast', 'bridge',
    'bright', 'bring', 'brother', 'brown', 'brush', 'bug', 'build', 'bun',
    'burn', 'bus', 'business', 'businessman', 'busy', 'but', 'butter', 'butterfly',
    'buy', 'by', 'cage', 'cake', 'call', 'camera', 'camp', 'can',
    'candle', 'candy', 'cap', 'car', 'card', 'care', 'careful', 'carry',
    'case', 'castle', 'cat', 'catch', 'celebrate', 'cell', 'cell phone', 'cent',
    'center', 'centimeter', 'chair', 'chalk', 'chance', 'change', 'cheap', 'cheat',
    'check', 'cheer', 'cheese', 'chess', 'chicken', 'child', 'china', 'chinese',
    'chocolate', 'choose', 'chopsticks', 'christmas', 'church', 'circle', 'city', 'clap',
    'class', 'classmate', 'classroom', 'clean', 'clear', 'clerk', 'climb', 'clock',
    'close', 'clothes', 'cloudflare', 'cloudy', 'club', 'coat', 'coffee', 'coke',
    'cold', 'collect', 'color', 'comb', 'come', 'comfortable', 'comic', 'common',
    'computer', 'convenient', 'cook', 'cookie', 'cool', 'copy', 'corner', 'correct',
    'cost', 'couch', 'count', 'country', 'course', 'cousin', 'cover', 'cow',
    'cowboy', 'crazy', 'cream', 'cross', 'cry', 'cup', 'cut', 'cute',
    'dance', 'dangerous', 'dark', 'date', 'daughter', 'day', 'dead', 'dear',
    'december', 'decide', 'delicious', 'dentist', 'department', 'department store', 'desk', 'dictionary',
    'die', 'different', 'difficult', 'dig', 'dining', 'dining room', 'dinner', 'dirty',
    'dish', 'do', 'doctor', 'dodge', 'dodge ball', 'dog', 'doll', 'dollar',
    'door', 'dot', 'down', 'dozen', 'dragon', 'draw', 'drawer', 'dream',
    'dress', 'drink', 'drive', 'driver', 'drop', 'drum', 'dry', 'duck',
    'dumpling', 'during', 'e-mail', 'each', 'ear', 'early', 'earth', 'east',
    'easter', 'easy', 'eat', 'egg', 'eight', 'eighteen', 'eighth', 'eighty',
    'either', 'elementary', 'elementary school', 'elephant', 'eleven', 'eleventh', 'else', 'end',
    'engineer', 'english', 'enjoy', 'enough', 'enter', 'envelope', 'eraser', 'even',
    'evening', 'ever', 'every', 'everyone', 'everything', 'example', 'excellent', 'except',
    'excited', 'exciting', 'excuse', 'exercise', 'expensive', 'experience', 'eye', 'face',
    'facebook', 'fact', 'factory', 'fail', 'fall', 'family', 'famous', 'fan',
    'far', 'farm', 'farmer', 'fast', 'fat', 'father', 'favorite', 'february',
    'feed', 'feel', 'festival', 'fever', 'few', 'fifteen', 'fifteenth', 'fifth',
    'fifty', 'fight', 'fill', 'finally', 'find', 'fine', 'finger', 'finish',
    'fire', 'first', 'fish', 'fisherman', 'five', 'fix', 'floor', 'flower',
    'flute', 'fly', 'follow', 'food', 'foot', 'for', 'foreign', 'foreigner',
    'forget', 'fork', 'forty', 'four', 'fourteen', 'fourteenth', 'fourth', 'fox',
    'free', 'french', 'french fries', 'fresh', 'friday', 'friend', 'friendly', 'fries',
    'frisbee', 'frog', 'from', 'front', 'fruit', 'fry', 'full', 'fun',
    'funny', 'future', 'game', 'garbage', 'garden', 'gas', 'gate', 'gemini',
    'get', 'ghost', 'giant', 'gift', 'girl', 'give', 'glad', 'glass',
    'glasses', 'glove', 'glue', 'go', 'goat', 'good', 'goodbye', 'google',
    'goose', 'grade', 'gram', 'grandfather', 'grandmother', 'grape', 'grass', 'gray',
    'great', 'green', 'ground', 'group', 'grow', 'guava', 'guess', 'guitar',
    'guy', 'gym', 'habit', 'hair', 'half', 'halloween', 'ham', 'hamburger',
    'hand', 'handsome', 'hang', 'happen', 'happy', 'hard', 'hard-working', 'hat',
    'hate', 'have', 'he', 'head', 'headache', 'health', 'healthy', 'hear',
    'heart', 'heat', 'heavy', 'hello', 'help', 'helpful', 'hen', 'here',
    'hey', 'hi', 'hide', 'high', 'hike', 'hill', 'hippo', 'history',
    'hit', 'ghost', 'hold', 'holiday', 'home', 'homework', 'honest', 'honey',
    'hop', 'hope', 'horse', 'hospital', 'hot', 'hot dog', 'hotel', 'hour',
    'house', 'housewife', 'how', 'however', 'hundred', 'hungry', 'hunt', 'hurry',
    'hurt', 'husband', 'i', 'ice', 'ice cream', 'idea', 'if', 'important',
    'in', 'insect', 'inside', 'instagram', 'interest', 'interested', 'interesting', 'internet',
    'interview', 'into', 'invite', 'island', 'it', 'jacket', 'january', 'jeans',
    'job', 'jog', 'join', 'joy', 'juice', 'july', 'jump', 'june',
    'junior', 'junior high school', 'just', 'kangaroo', 'keep', 'key', 'kick', 'kid',
    'kill', 'kilo', 'kind', 'king', 'kiss', 'kitchen', 'kite', 'knee',
    'knife', 'knock', 'know', 'knowledge', 'koala', 'lake', 'lamp', 'land',
    'language', 'lantern', 'large', 'last', 'late', 'later', 'laugh', 'lawyer',
    'lazy', 'lead', 'leader', 'learn', 'least', 'leave', 'left', 'leg',
    'lemon', 'lend', 'less', 'lesson', 'let', 'letter', 'lettuce', 'library',
    'lid', 'lie', 'life', 'light', 'like', 'line', 'linux', 'lion',
    'lip', 'list', 'listen', 'little', 'live', 'living', 'living room', 'lonely',
    'long', 'look', 'lose', 'lot', 'loud', 'love', 'lovely', 'low',
    'lucky', 'lunch', 'mac', 'machine', 'mad', 'magic', 'mail', 'mailman',
    'make', 'man', 'many', 'map', 'march', 'mark', 'marker', 'market',
    'married', 'mask', 'mat', 'math', 'matter', 'may', 'maybe', 'meal',
    'mean', 'meat', 'medicine', 'medium', 'meet', 'meeting', 'menu', 'mile',
    'milk', 'million', 'mind', 'minute', 'miss', 'mistake', 'modern', 'moment',
    'monday', 'money', 'monkey', 'month', 'moon', 'mop', 'more', 'morning',
    'most', 'mother', 'motorcycle', 'mountain', 'mouse', 'mouth', 'move', 'movie',
    'mr', 'mrs', 'mrt', 'ms', 'much', 'mud', 'museum', 'music',
    'must', 'nail', 'name', 'national', 'near', 'neck', 'need', 'neighbor',
    'never', 'new', 'news', 'next', 'nice', 'night', 'nine', 'nineteen',
    'nineteenth', 'ninety', 'ninth', 'no', 'nobody', 'nod', 'noise', 'noodle',
    'noon', 'north', 'nose', 'not', 'note', 'notebook', 'nothing', 'notice',
    'november', 'now', 'number', 'nurse', 'october', 'of', 'off', 'office',
    'officer', 'often', 'oil', 'ok', 'old', 'on', 'once', 'one',
    'only', 'open', 'or', 'orange', 'order', 'other', 'out', 'outside',
    'over', 'own', 'ox', 'o’', 'o’ clock', 'p', 'pack', 'package',
    'page', 'paint', 'pair', 'pants', 'papaya', 'paper', 'parent', 'park',
    'part', 'party', 'pass', 'past', 'paste', 'pay', 'pe', 'peach',
    'pear', 'pen', 'pencil', 'people', 'perhaps', 'person', 'pet', 'phone',
    'photo', 'piano', 'pick', 'picnic', 'picture', 'pie', 'piece', 'pig',
    'pin', 'pink', 'pipe', 'pizza', 'place', 'plan', 'planet', 'plant',
    'plate', 'play', 'player', 'playground', 'please', 'pleasure', 'pocket', 'point',
    'police', 'polite', 'pond', 'pool', 'poor', 'popcorn', 'popular', 'pork',
    'possible', 'post', 'post office', 'postcard', 'pot', 'pound', 'practice', 'pray',
    'prepare', 'present', 'pretty', 'price', 'princess', 'prize', 'problem', 'program',
    'proud', 'public', 'pull', 'pumpkin', 'purple', 'push', 'put', 'quarter',
    'queen', 'question', 'quick', 'quiet', 'quite', 'quiz', 'rabbit', 'race',
    'radio', 'railroad', 'rain', 'rainbow', 'rainy', 'raise', 'rat', 'read',
    'ready', 'real', 'really', 'recorder', 'red', 'refrigerator', 'remember', 'repeat',
    'reporter', 'rest', 'restaurant', 'restroom', 'rice', 'rich', 'ride', 'right',
    'ring', 'river', 'road', 'robot', 'roc', 'rock', 'roll', 'roller-skate',
    'room', 'rope', 'rose', 'row', 'rule', 'ruler', 'run', 'sacred',
    'sad', 'safe', 'sail', 'salad', 'sale', 'salesman', 'salt', 'same',
    'sandwich', 'saturday', 'save', 'say', 'school', 'science', 'scooter', 'screen',
    'sea', 'season', 'seat', 'second', 'secretary', 'see', 'seed', 'seesaw',
    'seldom', 'sell', 'send', 'senior', 'senior high school', 'sentence', 'september', 'serious',
    'set', 'seven', 'seventeen', 'seventeenth', 'seventh', 'seventy', 'several', 'shake',
    'shall', 'shape', 'share', 'shark', 'she', 'ship', 'shirt', 'shoe',
    'shop', 'shopkeeper', 'short', 'shorts', 'should', 'shoulder', 'shout', 'show',
    'shy', 'sick', 'side', 'sidewalk', 'sight', 'sign', 'simple', 'since',
    'sing', 'singer', 'sir', 'sister', 'sit', 'six', 'sixteen', 'sixteenth',
    'sixth', 'sixty', 'size', 'skate', 'skirt', 'sky', 'sleep', 'slide',
    'slim', 'slow', 'small', 'smart', 'smell', 'smile', 'smoke', 'snack',
    'snake', 'snow', 'snowman', 'snowy', 'so', 'soccer', 'sofa', 'soldier',
    'some', 'someone', 'something', 'sometimes', 'somewhere', 'son', 'song', 'soon',
    'sore', 'sorry', 'sound', 'soup', 'south', 'space', 'spaghetti', 'speak',
    'special', 'spell', 'spend', 'spider', 'spoon', 'sport', 'spring', 'square',
    'stairs', 'stamp', 'stand', 'star', 'start', 'station', 'stay', 'steak',
    'still', 'stomach', 'stop', 'store', 'story', 'straight', 'strange', 'stranger',
    'strawberry', 'street', 'strong', 'student', 'study', 'stupid', 'successful', 'sugar',
    'summer', 'sun', 'sunday', 'sunny', 'supermarket', 'sure', 'surf', 'surprise',
    'surprised', 'sweater', 'sweet', 'swim', 'swing', 't', 't-shirt', 't-shirt t',
    'table', 'tail', 'taiwan', 'take', 'talk', 'tall', 'tape', 'taste',
    'taxi', 'tea', 'teach', 'teacher', 'team', 'teenager', 'telephone', 'television',
    'tell', 'temple', 'ten', 'tennis', 'tenth', 'terrible', 'test', 'than',
    'thank', 'that', 'the', 'theater', 'then', 'there', 'these', 'they',
    'thick', 'thin', 'thing', 'think', 'third', 'thirsty', 'thirteen', 'thirteenth',
    'thirty', 'this', 'those', 'though', 'thousand', 'three', 'throat', 'throw',
    'thursday', 'ticket', 'tidy', 'tie', 'tiger', 'tiktok', 'time', 'tired',
    'to', 'toast', 'today', 'toe', 'together', 'tomato', 'tomorrow', 'tonight',
    'too', 'tooth', 'top', 'total', 'touch', 'towel', 'town', 'toy',
    'traffic', 'train', 'trash', 'treat', 'tree', 'trick', 'trip', 'trouble',
    'truck', 'true', 'try', 'tub', 'tuesday', 'turkey', 'turn', 'turtle',
    'twelfth', 'twelve', 'twentieth', 'twenty', 'twice', 'two', 'type', 'typhoon',
    'umbrella', 'uncle', 'under', 'understand', 'unhappy', 'uniform', 'until', 'up',
    'usa', 'use', 'useful', 'usually', 'vacation', 'vegetable', 'very', 'vest',
    'video', 'violin', 'visit', 'voice', 'wait', 'waiter', 'waitress', 'wake',
    'walk', 'wall', 'wallet', 'want', 'warm', 'wash', 'watch', 'water',
    'watermelon', 'wave', 'way', 'we', 'weak', 'wear', 'weather', 'wednesday',
    'week', 'weekend', 'welcome', 'well', 'west', 'wet', 'whale', 'what',
    'when', 'where', 'whether', 'which', 'whisper', 'white', 'who', 'whose',
    'why', 'wife', 'will', 'win', 'wind', 'window', 'windows', 'windy',
    'winter', 'wise', 'wish', 'with', 'without', 'woman', 'wonderful', 'word',
    'work', 'workbook', 'worker', 'workers', 'world', 'worry', 'write', 'writer',
    'wrong', 'yard', 'year', 'yellow', 'yes', 'yesterday', 'yet', 'you',
    'young', 'youtube', 'yummy', 'zebra', 'zero', 'zoo',
    'github', 'git', 'cursor', 'copilot', 'gpt', 'opencc', 'srt', 'vtt',
    'pdf', 'url', 'http', 'https', 'json', 'web', 'app', 'nextjs',
    'nodejs', 'npm', 'vite', 'tailwind', 'css', 'html', 'js', 'prompt',
]);

function shouldMergeEnglish(w1, w2, dictSet) {
    if (!w1 || !w2) return false;
    const l1 = w1.toLowerCase();
    const l2 = w2.toLowerCase();
    const combined = l1 + l2;

    if (dictSet.has(combined)) return true;

    const isW1Valid = dictSet.has(l1);
    const isW2Valid = dictSet.has(l2);

    if (!isW1Valid || !isW2Valid) {
        if (/^\d+$/.test(w1) || /^\d+$/.test(w2)) return false;

        const isFragment = (w) => {
            if (w.length <= 3) return true;
            return w.endsWith('ing') || w.endsWith('ed') || w.endsWith('ly') || w.endsWith('er') || 
                   w.endsWith('es') || w.endsWith('tion') || w.endsWith('ment') || w.endsWith('able') || 
                   w.endsWith('ness') || w.endsWith('ful');
        };

        if (!isW1Valid && !isW2Valid) return dictSet.has(combined);
        if (!isW1Valid && isW2Valid) return isFragment(l1);
        if (isW1Valid && !isW2Valid) return isFragment(l2);
    }

    return false;
}

function fixSpellingInText(text, dictSet) {
    if (!text) return text;
    const tokens = text.split(/([a-zA-Z0-9\-\'\’]+)/);
    if (tokens.length < 3) return text;

    let result = tokens[0];
    let i = 1;
    while (i < tokens.length) {
        let curWord = tokens[i];
        while (i + 2 < tokens.length && /^[ \t]+$/.test(tokens[i+1])) {
            let nextWord = tokens[i+2];
            if (shouldMergeEnglish(curWord, nextWord, dictSet)) {
                curWord = curWord + nextWord;
                i += 2;
            } else {
                break;
            }
        }
        result += curWord;
        if (i + 1 < tokens.length) {
            result += tokens[i+1];
        }
        i += 2;
    }
    return result;
}

// ─── 簡繁轉換與亂碼清理後處理 ──────────────────────────────────
const S2T_MAP = {
    '写': '寫', '层': '層', '请': '請', '点': '點', '赞': '贊', '订': '訂', '阅': '閱', '转': '轉', '发': '發', '赏': '賞', '镜': '鏡', '与': '與', '栏': '欄', '识': '識', '后': '後', '没': '沒', '样': '樣', '这': '這', '国': '國', '会': '會', '时': '時', '间': '間', '轴': '軸', '错': '錯', '误': '誤', '现': '現', '简': '簡', '体': '體', '个': '個', '万': '萬', '专': '專', '业': '業', '东': '東', '两': '兩', '严': '嚴', '么': '麼', '义': '義', '乐': '樂', '习': '習', '乡': '鄉', '书': '書', '买': '買', '乱': '亂', '争': '爭', '于': '於', '亚': '亞', '产': '產', '亲': '親', '亿': '億', '仅': '僅', '从': '從', '仓': '倉', '仪': '儀', '们': '們', '价': '價', '众': '眾', '优': '優', '伟': '偉', '传': '傳', '伤': '傷', '儿': '兒', '党': '黨', '兰': '蘭', '关': '關', '兴': '興', '养': '養', '兽': '獸', '军': '軍', '农': '農', '决': '決', '况': '況', '冻': '凍', '净': '淨', '准': '準', '凉': '涼', '减': '減', '几': '幾', '凤': '鳳', '凭': '憑', '凯': '凱', '击': '擊', '刘': '劉', '创': '創', '刚': '剛', '剂': '劑', '饰': '飾', '剑': '劍', '剧': '劇', '劝': '勸', '办': '辦', '务': '務', '动': '動', '励': '勵', '劳': '勞', '势': '勢', '勋': '勳', '医': '醫', '华': '華', '协': '協', '单': '單', '卖': '賣', '卢': '盧', '卫': '衛', '厂': '廠', '厅': '廳', '历': '歷', '厉': '厲', '压': '壓', '厌': '厭', '厕': '廁', '县': '縣', '参': '參', '双': '雙', '变': '變', '只': '只', '号': '號', '听': '聽', '启': '啟', '员': '員', '响': '響', '哑': '啞', '哗': '嘩', '哟': '喲', '唠': '嘮', '唤': '喚', '啧': '嘖', '啸': '嘯', '喷': '噴', '嘱': '囑', '阻': '阻', '噜': '嚕', '园': '園', '围': '圍', '图': '圖', '圆': '圓', '圣': '聖', '坚': '堅', '垫': '墊', '墙': '牆', '壮': '壯', '声': '聲', '头': '頭', '夺': '奪', '奖': '獎', '妇': '婦', '妈': '媽', '学': '學', '孙': '孫', '宝': '寶', '实': '實', '宠': '寵', '审': '審', '宪': '憲', '宫': '宮', '宽': '寬', '宾': '賓', '导': '導', '寻': '尋', '寿': '壽', '将': '將', '岁': '歲', '岂': '豈', '岗': '崗', '岛': '島', '岭': '嶺', '屿': '嶼', '带': '帶', '帮': '幫', '广': '廣', '庄': '莊', '庆': '慶', '库': '庫', '应': '應', '废': '廢', '开': '開', '异': '異', '弃': '棄', '张': '張', '弥': '彌', '弯': '彎', '弹': '彈', '归': '歸', '录': '錄', '律': '律', '得': '得', '御': '御', '忆': '憶', '忧': '憂', '怀': '懷', '态': '態', '怜': '憐', '恶': '惡', '惊': '驚', '惨': '慘', '想': '想', '意': '意', '感': '感', '愿': '願', '懂': '懂', '懒': '懶', '戏': '戲', '成': '成', '战': '戰', '戴': '戴', '户': '戶', '房': '房', '所': '所', '扁': '扁', '扇': '扇', '才': '才', '扑': '撲', '打': '打', '执': '執', '扩': '擴', '扫': '掃', '扬': '揚', '扰': '擾', '抚': '撫', '抛': '拋', '拔': '拔', '择': '擇', '抢': '搶', '护': '護', '报': '報', '担': '擔', '拆': '拆', '拉': '拉', '拌': '拌', '拍': '拍', '拒': '拒', '拖': '拖', '拼': '拼', '招': '招', '拜': '拜', '拟': '擬', '拢': '攏', '拣': '揀', '拥': '擁', '拦': '攔', '拨': '撥', '挂': '掛', '指': '指', '按': '按', '挑': '挑', '挖': '挖', '挚': '摯', '挝': '撾', '挞': '撻', '挟': '挾', '挠': '撓', '挡': '擋', '挣': '掙', '挤': '擠', '挥': '揮', '捞': '撈', '损': '損', '捡': '撿', '换': '換', '据': '據', '掳': '擄', '掷': '擲', '掸': '撣', '掺': '摻', '揽': '攬', '提': '提', '插': '插', '握': '握', '揭': '揭', '援': '援', '搁': '擱', '搂': '摟', '搅': '攪', '携': '攜', '摆': '擺', '摇': '搖', '摊': '攤', '撑': '撐', '撕': '撕', '撒': '撒', '撞': '撞', '撤': '撤', '播': '播', '操': '操', '擅': '擅', '擎': '擎', '擒': '擒', '擦': '擦', '攀': '攀', '收': '收', '改': '改', '攻': '攻', '放': '放', '政': '政', '故': '故', '效': '效', '敌': '敵', '敏': '敏', '救': '救', '教': '教', '数': '數', '整': '整', '文': '文', '断': '斷', '新': '新', '方': '方', '施': '施', '旁': '旁', '旅': '旅', '旋': '旋', '族': '族', '无': '無', '既': '既', '日': '日', '旧': '舊', '时': '時', '旷': '曠', '旺': '旺', '明': '明', '是': '是', '显': '顯', '晃': '晃', '晒': '曬', '晓': '曉', '晕': '暈', '喜': '喜', '晚': '晚', '晨': '晨', '普': '普', '景': '景', '晰': '晰', '晴': '晴', '晶': '晶', '智': '智', '晾': '晾', '暂': '暫', '暑': '暑', '暖': '暖', '暗': '暗', '暴': '暴', '曜': '曜', '书': '書', '曾': '曾', '替': '替', '最': '最', '会': '會', '月': '月', '有': '有', '朋': '朋', '服': '服', '朗': '朗', '望': '望', '朝': '朝', '期': '期', '本': '本', '术': '術', '朱': '朱', '条': '條', '来': '來', '杨': '楊', '极': '極', '杰': '傑', '松': '松', '板': '板', '构': '構', '林': '林', '果': '果', '枝': '枝', '枢': '樞', '枣': '棗', '枫': '楓', '某': '某', '染': '染', '柔': '柔', '柜': '櫃', '查': '查', '柯': '柯', '柱': '柱', '柳': '柳', '标': '標', '栈': '棧', '栋': '棟', '树': '樹', '栖': '棲', '栗': '栗', '校': '校', '样': '樣', '核': '核', '根': '根', '格': '格', '栽': '栽', '桂': '桂', '桃': '桃', '案': '案', '框': '框', '桌': '桌', '桥': '橋', '梁': '梁', '梅': '梅', '梦': '夢', '梯': '梯', '械': '械', '梳': '梳', '检': '檢', '棉': '棉', '棋': '棋', '棍': '棍', '棒': '棒', '森': '森', '阻': '阻', '椅': '椅', '植': '植', '椰': '椰', '楚': '楚', '榆': '榆', '荣': '榮', '模': '模', '槛': '檻', '榻': '榻', '榜': '榜', '槐': '槐', '样': '樣', '横': '橫', '樱': '櫻', '橘': '橘', '橙': '橙', '橡': '橡', '橱': '櫥', '橹': '櫓', '檐': '檐', '欣': '欣', '欧': '歐', '欲': '欲', '欺': '欺', '款': '款', '歌': '歌', '叹': '嘆', '欢': '歡', '正': '正', '此': '此', '步': '步', '武': '武', '歧': '歧', '歪': '歪', '岁': '歲', '归': '歸', '死': '死', '残': '殘', '殒': '殞', '殓': '殮', '殖': '殖', '殚': '殫', '导': '導', '将': '將', '率': '率', '段': '段', '殿': '殿', '毁': '毀', '毅': '毅', '每': '每', '毒': '毒', '比': '比', '毕': '畢', '毙': '斃', '毛': '毛', '毡': '氈', '毫': '毫', '毯': '毯', '气': '氣', '氢': '氫', '氧': '氧', '氮': '氮', '氯': '氯', '氟': '氟', '水': '水', '永': '永', '求': '求', '汇': '匯', '汉': '漢', '汗': '汗', '污': '污', '池': '池', '汤': '湯', '汪': '汪', '汰': '汰', '汹': '洶', '汽': '汽', '沁': '沁', '沃': '沃', '沈': '沈', '沉': '沉', '沐': '沐', '沙': '沙', '沛': '沛', '沟': '溝', '没': '沒', '沤': '漚', '机': '機', '极': '極', '仅': '僅', '从': '從', '仓': '倉', '仪': '儀', '们': '們', '价': '價', '众': '眾', '优': '優', '伟': '偉', '传': '傳', '伤': '傷', '认': '認', '说': '說', '话': '話', '语': '語', '议': '議', '论': '論', '让': '讓', '设': '設', '边': '邊', '这': '這', '进': '進', '运': '運', '还': '還', '过': '過', '远': '遠', '选': '選', '违': '違', '逊': '遜', '遥': '遙', '递': '遞', '适': '適', '迟': '遲', '读': '讀', '谁': '誰', '调': '調', '谢': '謝', '课': '課', '诚': '誠', '证': '證', '评': '評', '诉': '訴', '该': '該', '详': '詳', '诸': '諸', '诺': '諾', '谤': '謗', '谦': '謙', '阻': '阻', '谨': '謹', '谬': '謬', '谱': '譜', '谴': '譴', '赞': '贊', '纠': '糾', '纪': '紀', '约': '約', '红': '紅', '纳': '納', '纸': '紙', '级': '級', '纷': '紛', '细': '細', '终': '終', '组': '組', '结': '結', '给': '給', '绝': '絕', '统': '統', '绪': '緒', '续': '續', '维': '維', '绵': '綿', '编': '編', '缓': '緩', '缔': '締', '缘': '緣', '缠': '纏', '樱': '櫻', '视频': '影片', '频道': '頻道', '知识': '知識', '订阅': '訂閱', '转发': '轉發', '打赏': '打賞', '支持': '支持', '明镜': '明鏡', '栏目': '欄目', '其次': '其次'
};

function convertSimplifiedToTraditional(text) {
    if (!text) return text;
    
    // 先處理多字詞彙的替換
    let replacedText = text;
    const phraseKeys = ['视频', '频道', '知识', '订阅', '转发', '打赏', '支持', '明镜', '栏目'];
    for (const key of phraseKeys) {
        const regex = new RegExp(key, 'g');
        replacedText = replacedText.replace(regex, S2T_MAP[key]);
    }
    
    // 再逐字做單字替換
    let out = '';
    for (let i = 0; i < replacedText.length; i++) {
        const char = replacedText[i];
        out += S2T_MAP[char] || char;
    }
    return out;
}

function cleanGarbledText(text, dictSet) {
    if (!text) return text;
    
    // 1. 移除 Unicode 亂碼字元
    text = text.replace(/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

    // 2. 處理混雜的英數字詞，拆分出英文/數字部分
    const tokens = text.split(/([a-zA-Z0-9\-\'\’]+)/);
    let result = '';
    
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (i % 2 === 0) {
            // 偶數索引是中文或標點符號，保留
            result += token;
        } else {
            // 奇數索引是英文/數字字詞
            const lowerToken = token.toLowerCase();
            
            // 檢查是否是純數字 (如 123)
            if (/^\d+$/.test(token)) {
                result += token;
                continue;
            }
            
            // 檢查是否在合法英文字典中
            const isValid = dictSet.has(lowerToken);
            
            if (isValid) {
                result += token;
            } else {
                // 如果不在字典中：
                // A. 檢查是否含有數字（例如 butterfly99arrangements），若是則判定為亂碼，丟棄
                if (/[0-9]/.test(token)) {
                    continue; 
                }
                
                // B. 或者是長度極短（小於等於 2 個字且非字典字，可能是單個字母亂碼，如 b, c 等）
                if (token.length <= 2) {
                    continue; 
                }
                
                // C. 檢查是否為「孤立字詞」（前後是中文或邊界，而不是跟其他英文單字相連）
                let hasEnglishNeighbor = false;
                if (i > 1) {
                    const prevPrevToken = tokens[i - 2];
                    const prevSeparator = tokens[i - 1];
                    // 如果前前 token 是英文，且中間只有空白
                    if (prevPrevToken && /^[ \t]+$/.test(prevSeparator)) {
                        const prevLower = prevPrevToken.toLowerCase();
                        if (dictSet.has(prevLower) && !/^\d+$/.test(prevPrevToken)) {
                            hasEnglishNeighbor = true;
                        }
                    }
                }
                if (i < tokens.length - 2) {
                    const nextNextToken = tokens[i + 2];
                    const nextSeparator = tokens[i + 1];
                    // 如果後後 token 是英文，且中間只有空白
                    if (nextNextToken && /^[ \t]+$/.test(nextSeparator)) {
                        const nextLower = nextNextToken.toLowerCase();
                        if (dictSet.has(nextLower) && !/^\d+$/.test(nextNextToken)) {
                            hasEnglishNeighbor = true;
                        }
                    }
                }
                
                if (hasEnglishNeighbor) {
                    // 有相鄰的合法英文，保留以維護句子
                    result += token;
                } else {
                    // 孤立非字典字，高機率是 hallucination 幻覺，丟棄
                    // 清理 result 尾端的空格
                    if (result.endsWith(' ')) {
                        result = result.slice(0, -1);
                    }
                }
            }
        }
    }
    
    // 3. 清理多餘的連續空格
    result = result.replace(/[ \t]+/g, ' ').trim();
    
    return result;
}

// ─── 時間戳處理工具 ──────────────────────────────────────────────
function parseTimestampToMs(timeStr) {
    const cleaned = timeStr.replace(',', '.').trim();
    const parts = cleaned.split(':');
    if (parts.length === 2) {
        // MM:SS.mmm
        const mins = parseInt(parts[0], 10);
        const secs = parseFloat(parts[1]);
        return Math.round((mins * 60 + secs) * 1000);
    } else if (parts.length === 3) {
        // HH:MM:SS.mmm
        const hours = parseInt(parts[0], 10);
        const mins = parseInt(parts[1], 10);
        const secs = parseFloat(parts[2]);
        return Math.round((hours * 3600 + mins * 60 + secs) * 1000);
    }
    return 0;
}

function formatMsToSrtTime(ms) {
    const h   = Math.floor(ms / 3600000);
    const min = Math.floor((ms % 3600000) / 60000);
    const s   = Math.floor((ms % 60000) / 1000);
    const ms2 = ms % 1000;
    return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms2).padStart(3,'0')}`;
}

// ─── VTT → SRT 轉換 ──────────────────────────────────────────────
function vttToSrt(vttText) {
    let text = (vttText || '').trim();
    // 移除 WEBVTT header 與 NOTE 區塊
    text = text.replace(/^WEBVTT\s*\n*/m, '');
    text = text.replace(/NOTE[\s\S]*?\n\n/g, '');
    text = text.trim();

    const blocks = text.split(/\n\s*\n/).filter(b => b.trim().length > 0);
    let seqNum = 1;
    const srtBlocks = [];

    for (const block of blocks) {
        const lines = block.trim().split('\n').filter(l => l.trim().length > 0);
        const timeLineIdx = lines.findIndex(l => l.includes('-->'));
        if (timeLineIdx === -1) continue;

        const timeLine = lines[timeLineIdx];
        const times = timeLine.split('-->');
        if (times.length !== 2) continue;

        const startMs = parseTimestampToMs(times[0]);
        const endMs = parseTimestampToMs(times[1]);

        const subtitleText = lines.slice(timeLineIdx + 1).join('\n').trim();
        if (!subtitleText) continue;

        const srtTimeLine = `${formatMsToSrtTime(startMs)} --> ${formatMsToSrtTime(endMs)}`;
        srtBlocks.push(`${seqNum}\n${srtTimeLine}\n${subtitleText}`);
        seqNum++;
    }

    return srtBlocks.join('\n\n');
}

// ─── 合併字元級 SRT → 完整句子 ────────────────────────────────────
// Whisper 對中文會產生每字一段的細粒度字幕，需要合併成完整句子
// 斷句基準（優先順序）：
//   1. 遇到句子結尾標點（。！？…）→ 強制斷段
//   2. 時間間距 > maxGapMs ms（長暫停） → 強制斷段
//   3. 單句時長超過 maxDurationMs（避免字幕過長） → 強制斷段
//   ❌ 不用字數當基準，保持完整語意
function mergeSrtBlocks(srtText, maxGapMs = 800, maxDurationMs = 5000) {
    if (!srtText || !srtText.trim()) return srtText;

    // 解析 SRT 塊
    const blocks = srtText.trim().split(/\n\n/).filter(b => b.trim());
    const parsed = [];

    for (const block of blocks) {
        const lines = block.trim().split('\n');
        if (lines.length < 3) continue;
        const timeLine = lines[1];
        const times = timeLine.split('-->');
        if (times.length !== 2) continue;

        const startMs = parseTimestampToMs(times[0]);
        const endMs = parseTimestampToMs(times[1]);
        const text = lines.slice(2).join(' ').trim();
        const fixedText = fixSpellingInText(text, ENGLISH_DICT_SET);
        parsed.push({ startMs, endMs, text: fixedText });
    }

    if (parsed.length === 0) return srtText;

    // 斷句標點：句號、驚嘆號、問號、省略號（逗號/頓號視為句中，不強制斷）
    const hardEnders = /[。！？…]/;

    const merged = [];
    let cur = null;

    for (const blk of parsed) {
        if (!cur) {
            cur = { startMs: blk.startMs, endMs: blk.endMs, text: blk.text };
            continue;
        }
        const gap = blk.startMs - cur.endMs;
        const duration = blk.endMs - cur.startMs;
        const hasPunctuation = hardEnders.test(cur.text.slice(-1)); // 句子結尾標點
        
        const isLongPause = gap > maxGapMs;                         // 長暫停
        const isTooLong = duration > maxDurationMs                  // 超過 5 秒安全上限
            || cur.text.length >= 25;                               // 超過 25 個字強制斷行

        // 斷行規則：
        // 1. 有標點且長度 >= 3
        // 2. 遇到長暫停 (無條件斷行)
        // 3. 句子太長或時間太久 (無條件斷行)
        let shouldBreak = (hasPunctuation && cur.text.length >= 3)
            || isLongPause
            || isTooLong;

        // 檢查是否處於英文單字拆分的中間 (是的話強制不斷行，並消除空格)
        const w1 = cur.text.match(/[a-zA-Z0-9\-\'\’]+$/)?.[0];
        const w2 = blk.text.match(/^[a-zA-Z0-9\-\'\’]+/)?.[0];
        const isMiddleOfWord = w1 && w2 && shouldMergeEnglish(w1, w2, ENGLISH_DICT_SET);

        if (isMiddleOfWord) {
            shouldBreak = false;
        }

        if (shouldBreak) {
            merged.push(cur);
            cur = { startMs: blk.startMs, endMs: blk.endMs, text: blk.text };
        } else {
            cur.endMs = blk.endMs;
            const needsSpace = /[a-zA-Z0-9]$/.test(cur.text) && /^[a-zA-Z0-9]/.test(blk.text);
            cur.text = cur.text + (needsSpace && !isMiddleOfWord ? ' ' : '') + blk.text;
        }
    }
    if (cur) merged.push(cur);

    return merged
        .map((b, i) => `${i+1}\n${formatMsToSrtTime(b.startMs)} --> ${formatMsToSrtTime(b.endMs)}\n${b.text.trim()}`)
        .join('\n\n');
}


// ─── CORS ─────────────────────────────────────────────────────────
function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Language, X-Custom-Dict',
        'Access-Control-Max-Age': '86400',
    };
}

// ─── 工具函式 ─────────────────────────────────────────────────────
function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
}

function errorResponse(message, status = 400) {
    return jsonResponse({ error: message }, status);
}

function checkAuth(request, env) {
    // 若沒有設定 API_TOKEN，則不驗證
    if (!env.API_TOKEN) return true;
    const auth = request.headers.get('Authorization') || '';
    if (!auth.startsWith('Bearer ')) return false;
    return auth.slice(7).trim() === env.API_TOKEN;
}

// ─── 主要 Handler ─────────────────────────────────────────────────
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const method = request.method;

        // CORS Preflight
        if (method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders() });
        }

        // 健康檢查不需要 Token
        if (url.pathname === '/api/health' && method === 'GET') {
            return jsonResponse({
                status: 'ok',
                model: MODEL,
                version: WORKER_VERSION,
                maxAudioMB: MAX_AUDIO_SIZE_MB,
                authRequired: !!env.API_TOKEN,
            });
        }

        // 其他端點需要驗證
        if (!checkAuth(request, env)) {
            return errorResponse('Unauthorized: 請提供有效的 Bearer Token', 401);
        }

        // 辨識端點
        if (url.pathname === "/api/transcribe" && method === "POST") {
            return handleTranscribe(request, env);
        }
        if (url.pathname === "/api/generate-text" && method === "POST") {
            return handleGenerateText(request, env);
        }
        return errorResponse("Not Found", 404);
    },
};

// ─── 辨識端點 ─────────────────────────────────────────────────────
async function handleTranscribe(request, env) {
    try {
        // 一律走 Binary 模式（分段 WAV，主要路徑）
        const audioBuffer = await request.arrayBuffer();
        const language = request.headers.get('X-Language') || null;

        if (!audioBuffer || audioBuffer.byteLength < 12) {
            return errorResponse('音訊資料為空或過短，請確認上傳的檔案');
        }

        // FEAT-05: Magic Number 驗證 (阻擋非音訊檔案惡意上傳)
        const uint8_test = new Uint8Array(audioBuffer);
        let isValidAudio = false;
        
        // 1. WAV (RIFF ... WAVE)
        if (uint8_test[0] === 0x52 && uint8_test[1] === 0x49 && uint8_test[2] === 0x46 && uint8_test[3] === 0x46 &&
            uint8_test[8] === 0x57 && uint8_test[9] === 0x41 && uint8_test[10] === 0x56 && uint8_test[11] === 0x45) {
            isValidAudio = true;
        }
        // 2. WEBM (1A 45 DF A3)
        else if (uint8_test[0] === 0x1A && uint8_test[1] === 0x45 && uint8_test[2] === 0xDF && uint8_test[3] === 0xA3) {
            isValidAudio = true;
        }
        // 3. MP4/M4A/MOV (ftyp at offset 4)
        else if (uint8_test[4] === 0x66 && uint8_test[5] === 0x74 && uint8_test[6] === 0x79 && uint8_test[7] === 0x70) {
            isValidAudio = true;
        }
        // 4. MP3 (ID3)
        else if (uint8_test[0] === 0x49 && uint8_test[1] === 0x44 && uint8_test[2] === 0x33) {
            isValidAudio = true;
        }
        // 4.1 MP3 (No ID3, starts with frame sync FF FB / FF FA / FF F3 / FF F2)
        else if (uint8_test[0] === 0xFF && (uint8_test[1] & 0xE0) === 0xE0) {
            isValidAudio = true;
        }
        // 5. OGG (OggS)
        else if (uint8_test[0] === 0x4F && uint8_test[1] === 0x67 && uint8_test[2] === 0x67 && uint8_test[3] === 0x53) {
            isValidAudio = true;
        }
        // 6. FLAC (fLaC)
        else if (uint8_test[0] === 0x66 && uint8_test[1] === 0x4C && uint8_test[2] === 0x61 && uint8_test[3] === 0x43) {
            isValidAudio = true;
        }

        if (!isValidAudio) {
            return errorResponse('不支援的檔案格式，請上傳有效的音訊檔案 (WAV, MP3, M4A, WEBM, OGG, FLAC)', 415);
        }

        // 大小檢查
        const sizeMB = audioBuffer.byteLength / 1024 / 1024;
        if (sizeMB > MAX_AUDIO_SIZE_MB) {
            return errorResponse(
                `音訊區塊大小 ${sizeMB.toFixed(1)}MB 超過單段上限 ${MAX_AUDIO_SIZE_MB}MB。請使用分段模式。`,
                413
            );
        }

        // 將音訊轉為 Base64 字串 (Cloudflare AI binding 接收大檔案時，陣列會被強制轉為錯誤的字串，Base64 則可穩健通過)
        const uint8 = new Uint8Array(audioBuffer);
        // 使用更高效的轉換方式，避免大檔案時超過 call stack 限制
        // 但由於 Worker 沒有 Buffer，這裡分段處理或使用 btoa
        let binary = '';
        const chunkSize = 8192;
        for (let i = 0; i < uint8.length; i += chunkSize) {
            const chunk = uint8.subarray(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, chunk);
        }
        const audioBase64 = btoa(binary);

        const input = {
            audio: audioBase64,
        };
        
        // 🚨 關鍵修復：之前的代理對陣列大小有限制，會導致 string 化報錯
        // 我們測試過 Base64 字串是可以成功通過驗證的，所以直接採用原本成功的 Base64 寫法
        
        const customDictHeader = request.headers.get('X-Custom-Dict') || '';
        const customDict = customDictHeader ? decodeURIComponent(customDictHeader) : '';
        
        let promptWords = [];
        let replaceRules = [];
        
        if (customDict) {
            const items = customDict.split(/[\n,，]+/).map(i => i.trim()).filter(i => i);
            for (const item of items) {
                if (item.includes('=') || item.includes('＝')) {
                    const parts = item.split(/=|＝/);
                    if (parts.length >= 2) {
                        const wrong = parts[0].trim();
                        const correct = parts.slice(1).join('=').trim();
                        if (wrong && correct) {
                            replaceRules.push({ wrong, correct });
                            promptWords.push(correct); // 也把正確字加進 prompt
                        }
                    }
                } else {
                    promptWords.push(item);
                }
            }
        }
        
        // 加入 prompt 和 language
        let basePrompt = '以下是一段繁體中文的語音內容，請使用繁體中文輸出。常見詞彙包含：的、是、我、你、他、這個、那個、然後、所以、因為、可以、沒有、知道、什麼、怎麼、為什麼';
        if (promptWords.length > 0) {
            basePrompt += `\n包含專有名詞：${promptWords.join('、')}`;
        }
        input.initial_prompt = basePrompt;
        
        const lang = language && language !== 'auto' ? normalizeLanguageCode(language) : 'zh';
        input.language = lang;

        const whisperResult = await env.AI.run(MODEL, input);

        if (!whisperResult || !whisperResult.text) {
            return errorResponse('Whisper 辨識失敗，請確認音訊格式正確（建議 WAV/MP3）', 500);
        }

        let rawText = whisperResult.text.trim();
        let vtt = whisperResult.vtt || '';
        
        // 執行智慧英文單字合併，修復 rawText 與 vtt 中的英文空格問題
        rawText = fixSpellingInText(rawText, ENGLISH_DICT_SET);
        vtt = fixSpellingInText(vtt, ENGLISH_DICT_SET);
        
        // 執行英文字詞與亂碼清理後處理，避免 Whisper 英文幻覺與無效字元
        rawText = cleanGarbledText(rawText, ENGLISH_DICT_SET);
        vtt = cleanGarbledText(vtt, ENGLISH_DICT_SET);

        // 執行簡繁轉換，消除簡體字
        rawText = convertSimplifiedToTraditional(rawText);
        vtt = convertSimplifiedToTraditional(vtt);
        
        // 執行字典事後校正替換
        if (replaceRules.length > 0) {
            for (const rule of replaceRules) {
                const escapedWrong = rule.wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(escapedWrong, 'g');
                rawText = rawText.replace(regex, rule.correct);
                vtt = vtt.replace(regex, rule.correct);
            }
        }

        const rawSrt = vtt ? vttToSrt(vtt) : '';
        // 合併字元級段落為自然句子（解決 Whisper 中文每字一段問題）
        const srt = mergeSrtBlocks(rawSrt);

        return jsonResponse({
            text: rawText,
            vtt: vtt,
            srt,
            wordCount: whisperResult.word_count || 0,
        });

    } catch (err) {
        console.error('[Whisper Worker Error]', err?.message || err);
        return errorResponse(`處理失敗：${err?.message || '未知錯誤'}`, 500);
    }
}

// ─── 語言代碼正規化 ────────────────────────────────────────────────
// Whisper 接受 BCP-47 格式，如 "zh"、"en"、"ja"
function normalizeLanguageCode(lang) {
    const map = {
        'zh-TW': 'zh',
        'zh-CN': 'zh',
        'zh': 'zh',
        'en': 'en',
        'ja': 'ja',
        'ko': 'ko',
    };
    return map[lang] || lang;
}


// ─── 文字生成端點 (SSE) ──────────────────────────────────────────────
async function handleGenerateText(request, env) {
    try {
        const body = await request.json();
        const prompt = body.prompt;
        const model = body.model || '@cf/qwen/qwen2.5-coder-32b-instruct';
        const systemPrompt = body.systemPrompt || '';

        if (!prompt) {
            return errorResponse('請提供 prompt 參數', 400);
        }

        const messages = [];
        if (systemPrompt) {
            messages.push({ role: 'system', content: systemPrompt });
        }
        messages.push({ role: 'user', content: prompt });

        const stream = await env.AI.run(model, {
            messages: messages,
            stream: true,
            max_tokens: 8000
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                ...corsHeaders()
            }
        });
    } catch (err) {
        console.error('[Generate Text Error]', err?.message || err);
        return errorResponse(`文字生成失敗：${err?.message || '未知錯誤'}`, 500);
    }
}
