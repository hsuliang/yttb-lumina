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

        if (!isW1Valid && !isW2Valid) return true;
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
        let basePrompt = '以下是繁體中文的對話：';
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
