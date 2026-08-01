/**
 * yttb-lumina Whisper Worker
 * 部署在 Cloudflare Workers，使用 @cf/openai/whisper-large-v3-turbo 模型
 * Version: 1.3.0
 *
 * 端點：
 *   GET  /api/health     → 健康檢查
 *   POST /api/transcribe → 音訊辨識（Binary audio）
 *
 * 環境變數（選填）：
 *   API_TOKEN → 若設定，所有請求須帶 "Authorization: Bearer {token}"
 */

// 版本規則：每次發布程式變更時版號前進一版，例如 1.2.9 → 1.3.0。
const WORKER_VERSION = '1.3.0';
const MODEL = '@cf/openai/whisper-large-v3-turbo';
const MAX_AUDIO_SIZE_MB = 28; // 略低於 Whisper 上限以保留緩衝
const AI_TRANSCRIPT_LABEL = '《 字幕君：ㄚ亮笑長的內容助手》';
const MUSIC_LABEL = '【音樂】';
const MAX_SUBTITLE_DURATION_MS = 6000;
const MAX_SUBTITLE_CHARS = 28;
const MIN_SUBTITLE_DURATION_MS = 700;
const MAX_READABLE_CPS = 20;
const MIN_CONFIDENT_ZH_CPS = 1.5;

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

    // 僅修復「兩側都不是完整單字，但合併後是字典單字」的明確拆字。
    // 不再猜測未知字或常見字尾，避免 ChatGPT Codex → ChatGPTCodex。
    return !dictSet.has(l1) && !dictSet.has(l2) && dictSet.has(combined);
}

function fixSpellingInText(text, dictSet) {
    if (!text) return text;
    const acronymRepaired = text
        .replace(/\b(?:[A-Z]\s+){1,}[A-Z]\b/g, value => value.replace(/\s+/g, ''))
        .replace(/\b([A-Z])\s+(\d+)\b/g, '$1$2');
    const tokens = acronymRepaired.split(/([a-zA-Z0-9\-\'\’]+)/);
    if (tokens.length < 3) return acronymRepaired;

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
    return Number.NaN;
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
    const lines = String(vttText || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
    const timelinePattern = /^((?:\d{2}:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d{2}:)?\d{2}:\d{2}[.,]\d{3})/;
    const cues = [];
    let current = null;
    let inNote = false;

    const flush = () => {
        if (!current) return;
        const text = normalizeSubtitleText(current.lines.join(' '));
        if (text && current.endMs > current.startMs) {
            cues.push({ startMs: current.startMs, endMs: current.endMs, text });
        }
        current = null;
    };

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (/^NOTE(?:\s|$)/.test(line)) {
            flush();
            inNote = true;
            continue;
        }
        if (inNote) {
            if (!line) inNote = false;
            continue;
        }

        const match = line.match(timelinePattern);
        if (match) {
            flush();
            const startMs = parseTimestampToMs(match[1]);
            const endMs = parseTimestampToMs(match[2]);
            current = Number.isFinite(startMs) && Number.isFinite(endMs)
                ? { startMs, endMs, lines: [] }
                : null;
            continue;
        }

        if (!current || !line || /^(?:WEBVTT|STYLE|REGION)$/i.test(line)) continue;
        // 即使模型回傳格式不完整，也不允許下一條時間軸成為字幕文字。
        if (line.includes('-->')) continue;
        current.lines.push(line);
    }
    flush();
    return serializeSrtCues(cues);
}

function segmentTimeToMs(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 1000);
    if (typeof value === 'string') return parseTimestampToMs(value);
    return Number.NaN;
}

function segmentsToSrt(segments) {
    if (!Array.isArray(segments) || segments.length === 0) return '';
    const cues = [];
    for (const segment of segments) {
        const startMs = segmentTimeToMs(segment?.start ?? segment?.start_time);
        const endMs = segmentTimeToMs(segment?.end ?? segment?.end_time);
        const text = normalizeSubtitleText(segment?.text || '');
        if (!text || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
        cues.push({ startMs, endMs, text });
    }
    return serializeSrtCues(cues);
}

// ─── 字幕解析、正規化與自然斷句 ────────────────────────────────────
const HARD_ENDERS = /[。！？.!?…]$/u;
const SOFT_ENDERS = /[，、；：,;:]$/u;
const CHINESE_WORD_SEGMENTER = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('zh-TW', { granularity: 'word' })
    : null;

function subtitleLength(text) {
    return Array.from(String(text || '').replace(/\s+/g, '')).length;
}

function normalizeSubtitleText(text) {
    return String(text || '')
        .replace(/\[(?:music|instrumental music)\]|\((?:music|instrumental music)\)/gi, MUSIC_LABEL)
        .replace(/[♪♫♬]+/g, MUSIC_LABEL)
        .replace(/(?:【音樂】\s*){2,}/g, MUSIC_LABEL)
        .replace(/\s+([，。！？、；：,.!?;:])/g, '$1')
        .replace(/[ \t]+/g, ' ')
        .trim();
}

function parseSrtCues(srtText) {
    if (!srtText || !srtText.trim()) return [];
    const cues = [];
    const blocks = srtText.trim().split(/\n\s*\n/).filter(Boolean);

    for (const block of blocks) {
        const lines = block.trim().split('\n');
        const timeLineIndex = lines.findIndex(line => line.includes('-->'));
        if (timeLineIndex < 0) continue;
        const times = lines[timeLineIndex].split('-->');
        if (times.length !== 2) continue;

        const startMs = parseTimestampToMs(times[0]);
        const endMs = parseTimestampToMs(times[1]);
        const text = normalizeSubtitleText(lines.slice(timeLineIndex + 1).join(' '));
        if (!text || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
        cues.push({ startMs, endMs, text });
    }

    return cues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

function serializeSrtCues(cues) {
    return cues
        .filter(cue => cue.text && cue.endMs > cue.startMs)
        .map((cue, index) => `${index + 1}\n${formatMsToSrtTime(cue.startMs)} --> ${formatMsToSrtTime(cue.endMs)}\n${cue.text.trim()}`)
        .join('\n\n');
}

function findNaturalSplit(chars, limit) {
    const minimum = Math.max(1, Math.floor(limit * 0.45));
    const maximum = Math.min(limit, chars.length - 1);
    const text = chars.join('');
    const boundaries = [];
    if (CHINESE_WORD_SEGMENTER) {
        let offset = 0;
        for (const part of CHINESE_WORD_SEGMENTER.segment(text)) {
            offset += Array.from(part.segment).length;
            if (offset >= minimum && offset <= maximum) boundaries.push(offset);
        }
    }
    if (boundaries.length === 0) {
        for (let index = minimum; index <= maximum; index++) boundaries.push(index);
    }

    for (let index = boundaries.length - 1; index >= 0; index--) {
        const boundary = boundaries[index];
        if (/[。！？!?…，、；：,;:\s]/u.test(chars[boundary - 1])) return boundary;
    }

    const semanticStart = /^(?:但更重要的是|更重要的是|但是|可是|不過|所以|因此|然後|接下來|另外|其實|如果|因為|有些|好|那)/u;
    for (let index = boundaries.length - 1; index >= 0; index--) {
        const boundary = boundaries[index];
        if (semanticStart.test(chars.slice(boundary).join('').trimStart())) return boundary;
    }

    const incompleteEnding = /(?:的|在|把|被|跟|和|與|或|因為|所以|但是|可是|然後|就是|其實|如果|要|會|可以|需要|讓)$/u;
    for (let index = boundaries.length - 1; index >= 0; index--) {
        const boundary = boundaries[index];
        if (!incompleteEnding.test(chars.slice(0, boundary).join('').trimEnd())) return boundary;
    }
    return boundaries.at(-1) || maximum;
}

function splitTextNaturally(text, maxChars, minimumPieces = 1) {
    const pieces = [];
    let remaining = Array.from(text.trim());
    const target = Math.max(1, Math.min(maxChars, Math.ceil(remaining.length / minimumPieces)));

    while (remaining.length > target) {
        // 網址、縮寫與英文專有名詞視為不可拆的單位，寧可在前一個詞界切開。
        if (/^[A-Za-z0-9][A-Za-z0-9._'’+@:/-]*[A-Za-z0-9]$/u.test(remaining.join(''))) break;
        const splitAt = findNaturalSplit(remaining, target);
        const piece = remaining.slice(0, splitAt).join('').trim();
        if (piece) pieces.push(piece);
        remaining = remaining.slice(splitAt);
        while (remaining[0] === ' ') remaining.shift();
    }
    const tail = remaining.join('').trim();
    if (tail) pieces.push(tail);
    return pieces;
}

function splitLongCue(cue, maxDurationMs, maxChars) {
    const length = subtitleLength(cue.text);
    const duration = cue.endMs - cue.startMs;
    const requiredPieces = Math.max(
        1,
        Math.ceil(length / maxChars),
        Math.ceil(duration / maxDurationMs)
    );
    if (requiredPieces === 1) return [cue];
    if (length < requiredPieces) {
        return [{ ...cue, endMs: Math.min(cue.endMs, cue.startMs + maxDurationMs) }];
    }

    const pieces = splitTextNaturally(cue.text, maxChars, requiredPieces);
    if (pieces.length < 2) return [cue];
    const weights = pieces.map(piece => Math.max(1, subtitleLength(piece)));
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    let cursor = cue.startMs;

    return pieces.map((piece, index) => {
        const remainingPieces = pieces.length - index - 1;
        const weightedEnd = Math.round(
            cue.startMs + duration * (weights.slice(0, index + 1).reduce((sum, value) => sum + value, 0) / totalWeight)
        );
        const endMs = index === pieces.length - 1 ? cue.endMs : Math.max(
            cue.endMs - remainingPieces * maxDurationMs,
            Math.min(weightedEnd, cursor + maxDurationMs)
        );
        const part = { startMs: cursor, endMs, text: piece };
        cursor = endMs;
        return part;
    }).filter(part => part.endMs > part.startMs);
}

function canMergeShortUtterances(current, next, gap) {
    return gap <= 250
        && subtitleLength(current.text) <= 6
        && subtitleLength(next.text) <= 8
        && subtitleLength(current.text + next.text) <= 12
        && next.endMs - current.startMs <= 3000;
}

function joinSubtitleText(left, right, mergeEnglishFragment = false) {
    if (!left) return right;
    if (!right) return left;
    const chinesePhrasePause = /\p{Script=Han}$/u.test(left)
        && /^\p{Script=Han}/u.test(right)
        && subtitleLength(left) >= 2
        && subtitleLength(right) >= 2
        && /^(?:但更重要的是|更重要的是|但是|可是|不過|所以|因此|然後|接下來|另外|其實|如果|因為|有些|很多|好|那)/u.test(right);
    const latinBoundary = /[a-zA-Z0-9.!?]$/.test(left) && /^[a-zA-Z0-9]/.test(right);
    const needsSpace = chinesePhrasePause || (latinBoundary && !mergeEnglishFragment);
    return left + (needsSpace ? ' ' : '') + right;
}

function canMergeForReadability(left, right) {
    const gap = right.startMs - left.endMs;
    return gap >= 0
        && gap <= 300
        && right.endMs - left.startMs <= MAX_SUBTITLE_DURATION_MS
        && subtitleLength(joinSubtitleText(left.text, right.text)) <= MAX_SUBTITLE_CHARS;
}

function improveShortCueTimings(cues, minDurationMs = MIN_SUBTITLE_DURATION_MS) {
    const result = cues.map(cue => ({ ...cue }));
    for (let i = 0; i < result.length; i++) {
        const cue = result[i];
        if (cue.endMs - cue.startMs >= minDurationMs) continue;

        const next = result[i + 1];
        const previous = result[i - 1];
        if (next && (canMergeShortUtterances(cue, next, next.startMs - cue.endMs)
            || canMergeForReadability(cue, next))) {
            cue.endMs = next.endMs;
            cue.text = joinSubtitleText(cue.text, next.text);
            result.splice(i + 1, 1);
            i--;
            continue;
        }
        if (previous && canMergeForReadability(previous, cue)) {
            previous.endMs = cue.endMs;
            previous.text = joinSubtitleText(previous.text, cue.text);
            result.splice(i, 1);
            i -= 2;
            continue;
        }

        const nextStart = next?.startMs ?? cue.startMs + minDurationMs;
        cue.endMs = Math.max(cue.endMs, Math.min(nextStart, cue.startMs + minDurationMs));
    }
    return result.filter(cue => cue.endMs > cue.startMs);
}

function mergeSrtBlocks(
    srtText,
    maxGapMs = 800,
    maxDurationMs = MAX_SUBTITLE_DURATION_MS,
    maxChars = MAX_SUBTITLE_CHARS
) {
    const parsed = parseSrtCues(srtText)
        .flatMap(cue => splitLongCue(cue, maxDurationMs, maxChars));
    if (parsed.length === 0) return '';

    const merged = [];
    let current = null;

    for (const block of parsed) {
        if (!current) {
            current = { ...block };
            continue;
        }

        const gap = block.startMs - current.endMs;
        const prospectiveDuration = block.endMs - current.startMs;
        const w1 = current.text.match(/[a-zA-Z0-9\-\'\’]+$/)?.[0];
        const w2 = block.text.match(/^[a-zA-Z0-9\-\'\’]+/)?.[0];
        const mergeEnglishFragment = gap >= 0 && gap <= 120
            && w1 && w2 && shouldMergeEnglish(w1, w2, ENGLISH_DICT_SET);
        const joinedText = joinSubtitleText(current.text, block.text, mergeEnglishFragment);
        const shortUtterances = canMergeShortUtterances(current, block, gap);
        const hardBoundary = HARD_ENDERS.test(current.text) && !shortUtterances;
        const softBoundary = SOFT_ENDERS.test(current.text)
            && subtitleLength(current.text) >= 12
            && current.endMs - current.startMs >= 1200;
        const nonSpeechBoundary = current.text.includes(MUSIC_LABEL) || block.text.includes(MUSIC_LABEL);
        const orphanTail = gap >= 0
            && gap <= 120
            && subtitleLength(current.text) >= 12
            && subtitleLength(block.text) <= 4
            && prospectiveDuration <= maxDurationMs
            && subtitleLength(joinedText) <= maxChars + 2;
        const exceedsLimit = prospectiveDuration > maxDurationMs
            || (subtitleLength(joinedText) > maxChars && !orphanTail);
        const shouldBreak = gap < 0
            || gap > maxGapMs
            || nonSpeechBoundary
            || hardBoundary
            || softBoundary
            || exceedsLimit;

        if (shouldBreak) {
            merged.push(current);
            current = { ...block };
        } else {
            current.endMs = block.endMs;
            current.text = joinedText;
        }
    }
    if (current) merged.push(current);

    const splitAgain = merged.flatMap(cue => splitLongCue(cue, maxDurationMs, maxChars));
    return serializeSrtCues(improveShortCueTimings(splitAgain));
}

function restoreConfiguredTerms(text, promptWords = []) {
    let result = String(text || '');
    const terms = [...new Set(promptWords.map(term => String(term || '').trim()).filter(Boolean))]
        .sort((a, b) => b.replace(/\s+/g, '').length - a.replace(/\s+/g, '').length);

    for (const term of terms) {
        const compact = term.replace(/\s+/g, '');
        if (compact.length < 2) continue;
        const pattern = Array.from(compact)
            .map(char => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('[\\s._-]*');
        if (/^[A-Za-z0-9]+$/.test(compact)) {
            result = result.replace(
                new RegExp(`(^|[^A-Za-z0-9])(${pattern})(?![A-Za-z0-9])`, 'gi'),
                (_, prefix) => `${prefix}${term}`
            );
        } else {
            result = result.replace(new RegExp(pattern, 'giu'), () => term);
        }
    }
    return result;
}

function applyRecognitionTextRules(text, replaceRules = [], promptWords = []) {
    let result = restoreConfiguredTerms(text, promptWords);
    result = fixSpellingInText(result, ENGLISH_DICT_SET);
    for (const rule of replaceRules) {
        const escapedWrong = rule.wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replace(new RegExp(escapedWrong, 'g'), () => rule.correct);
    }
    return result;
}

function restoreChinesePunctuation(srtText) {
    const cues = parseSrtCues(srtText).map(cue => ({ ...cue }));
    let restored = 0;
    const questionEnding = /(?:嗎|呢|對不對|是不是|好不好|可不可以|為什麼|怎麼辦|怎麼樣|如何|哪裡|多少)$/u;

    for (let index = 0; index < cues.length; index++) {
        const cue = cues[index];
        if (!cue.text || cue.text.includes(MUSIC_LABEL) || HARD_ENDERS.test(cue.text) || SOFT_ENDERS.test(cue.text)) {
            continue;
        }

        const next = cues[index + 1];
        const gap = next ? Math.max(0, next.startMs - cue.endMs) : Number.POSITIVE_INFINITY;
        // 沒有足夠語意證據時保留無標點，避免把換行誤當句末。
        if (questionEnding.test(cue.text) && (!next || gap >= 250)) {
            cue.text += '？';
            restored++;
        }
    }
    return { srt: serializeSrtCues(cues), restored };
}

// ─── WAV 能量分析與片頭非語音標記 ──────────────────────────────────
function readFourCc(view, offset) {
    return String.fromCharCode(
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2),
        view.getUint8(offset + 3)
    );
}

function analyzeWavPcm(audioBuffer, windowMs = 100) {
    if (!(audioBuffer instanceof ArrayBuffer) || audioBuffer.byteLength < 44) return null;
    const view = new DataView(audioBuffer);
    if (readFourCc(view, 0) !== 'RIFF' || readFourCc(view, 8) !== 'WAVE') return null;

    let format = null;
    let dataOffset = -1;
    let dataSize = 0;
    let offset = 12;
    while (offset + 8 <= view.byteLength) {
        const chunkId = readFourCc(view, offset);
        const chunkSize = view.getUint32(offset + 4, true);
        const payloadOffset = offset + 8;
        if (payloadOffset + chunkSize > view.byteLength) break;

        if (chunkId === 'fmt ' && chunkSize >= 16) {
            format = {
                audioFormat: view.getUint16(payloadOffset, true),
                channels: view.getUint16(payloadOffset + 2, true),
                sampleRate: view.getUint32(payloadOffset + 4, true),
                blockAlign: view.getUint16(payloadOffset + 12, true),
                bitsPerSample: view.getUint16(payloadOffset + 14, true),
            };
        } else if (chunkId === 'data') {
            dataOffset = payloadOffset;
            dataSize = chunkSize;
        }
        offset = payloadOffset + chunkSize + (chunkSize % 2);
    }

    if (!format || dataOffset < 0 || format.audioFormat !== 1 || format.bitsPerSample !== 16
        || format.channels < 1 || format.sampleRate < 1 || format.blockAlign < 2) {
        return null;
    }

    const frameCount = Math.floor(dataSize / format.blockAlign);
    const windowFrames = Math.max(1, Math.round(format.sampleRate * windowMs / 1000));
    const rmsDb = [];
    let sumSquares = 0;
    let framesInWindow = 0;

    for (let frame = 0; frame < frameCount; frame++) {
        const frameOffset = dataOffset + frame * format.blockAlign;
        let mono = 0;
        for (let channel = 0; channel < format.channels; channel++) {
            mono += view.getInt16(frameOffset + channel * 2, true) / 32768;
        }
        mono /= format.channels;
        sumSquares += mono * mono;
        framesInWindow++;

        if (framesInWindow === windowFrames || frame === frameCount - 1) {
            const rms = Math.sqrt(sumSquares / framesInWindow);
            rmsDb.push(20 * Math.log10(Math.max(rms, 1e-10)));
            sumSquares = 0;
            framesInWindow = 0;
        }
    }

    const sorted = [...rmsDb].sort((a, b) => a - b);
    const p90 = sorted[Math.floor(Math.max(0, sorted.length - 1) * 0.9)] ?? -50;
    return {
        durationMs: Math.round(frameCount / format.sampleRate * 1000),
        windowMs: windowFrames / format.sampleRate * 1000,
        rmsDb,
        audibleThresholdDb: Math.max(-55, p90 - 35),
    };
}

function detectLeadingMusicRange(audioAnalysis, firstSpeechMs = null) {
    if (!audioAnalysis?.rmsDb?.length) return null;
    const endMs = Math.min(
        audioAnalysis.durationMs,
        Number.isFinite(firstSpeechMs) ? Math.max(0, firstSpeechMs) : audioAnalysis.durationMs
    );
    if (endMs < 2000) return null;

    const windowCount = Math.min(
        audioAnalysis.rmsDb.length,
        Math.ceil(endMs / audioAnalysis.windowMs)
    );
    const audible = [];
    for (let i = 0; i < windowCount; i++) {
        if (audioAnalysis.rmsDb[i] > audioAnalysis.audibleThresholdDb) audible.push(i);
    }
    if (audible.length === 0) return null;

    const first = audible[0];
    const last = audible[audible.length - 1];
    const spanWindows = last - first + 1;
    const audibleRatio = audible.length / spanWindows;
    const minimumRatio = Number.isFinite(firstSpeechMs) ? 0.45 : 0.8;
    const spanMs = spanWindows * audioAnalysis.windowMs;
    if (spanMs < 1500 || audibleRatio < minimumRatio) return null;

    return {
        startMs: Math.round(first * audioAnalysis.windowMs),
        endMs: Math.round(Math.min(endMs, (last + 1) * audioAnalysis.windowMs)),
    };
}

function srtToVtt(srtText) {
    if (!srtText) return '';
    const cues = parseSrtCues(srtText);
    if (cues.length === 0) return 'WEBVTT\n';
    const blocks = cues.map(cue => {
        const start = formatMsToSrtTime(cue.startMs).replace(',', '.');
        const end = formatMsToSrtTime(cue.endMs).replace(',', '.');
        return `${start} --> ${end}\n${cue.text}`;
    });
    return `WEBVTT\n\n${blocks.join('\n\n')}`;
}

function decorateFirstChunkSrt(srtText, audioAnalysis, isFirstChunk) {
    const cues = parseSrtCues(srtText);
    if (!isFirstChunk) return serializeSrtCues(cues);

    const firstSpeechCue = cues.find(cue => cue.text !== MUSIC_LABEL);
    const musicRange = detectLeadingMusicRange(audioAnalysis, firstSpeechCue?.startMs ?? null);
    const alreadyHasLeadingMusic = cues.some(cue => cue.text === MUSIC_LABEL && cue.startMs < 2000);
    if (musicRange && musicRange.endMs > musicRange.startMs && !alreadyHasLeadingMusic) {
        cues.push({ ...musicRange, text: MUSIC_LABEL });
        cues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
    }

    if (cues.length === 0 && audioAnalysis?.durationMs > 0) {
        cues.push({
            startMs: 0,
            endMs: Math.min(2000, audioAnalysis.durationMs),
            text: AI_TRANSCRIPT_LABEL,
        });
    } else if (cues.length > 0 && !cues[0].text.startsWith(AI_TRANSCRIPT_LABEL)) {
        cues[0].text = `${AI_TRANSCRIPT_LABEL} ${cues[0].text}`.trim();
    }
    return serializeSrtCues(cues);
}

// ─── 辨識品質閘門 ──────────────────────────────────────────────────
function findLongestActiveUncaptionedMs(audioAnalysis, cues, ignoredRanges = []) {
    if (!audioAnalysis?.rmsDb?.length || !audioAnalysis.windowMs) return 0;
    const windowMs = audioAnalysis.windowMs;
    const covered = new Array(audioAnalysis.rmsDb.length).fill(false);
    const markCovered = ({ startMs, endMs }) => {
        const start = Math.max(0, Math.floor(startMs / windowMs));
        const end = Math.min(covered.length, Math.ceil(endMs / windowMs));
        for (let i = start; i < end; i++) covered[i] = true;
    };
    cues.forEach(markCovered);
    ignoredRanges.filter(Boolean).forEach(markCovered);

    const missing = audioAnalysis.rmsDb.map(
        (db, index) => db > audioAnalysis.audibleThresholdDb && !covered[index]
    );
    const bridgeWindows = Math.max(1, Math.round(400 / windowMs));
    for (let i = 0; i < missing.length;) {
        if (missing[i] || covered[i]) {
            i++;
            continue;
        }
        const start = i;
        while (i < missing.length && !missing[i] && !covered[i]) i++;
        if (i - start <= bridgeWindows && start > 0 && i < missing.length
            && missing[start - 1] && missing[i]) {
            for (let j = start; j < i; j++) missing[j] = true;
        }
    }

    let longestWindows = 0;
    let currentWindows = 0;
    for (const isMissing of missing) {
        currentWindows = isMissing ? currentWindows + 1 : 0;
        longestWindows = Math.max(longestWindows, currentWindows);
    }
    return Math.round(longestWindows * windowMs);
}

function hasExcessivePhraseRepetition(text) {
    const compact = String(text || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\p{P}\p{S}\s]/gu, '');
    const phraseLength = 8;
    if (compact.length < phraseLength * 4) return false;

    const occurrences = new Map();
    for (let index = 0; index <= compact.length - phraseLength; index++) {
        const phrase = compact.slice(index, index + phraseLength);
        if (/^(.)\1+$/u.test(phrase)) continue;
        const state = occurrences.get(phrase) || { count: 0, lastEnd: -1 };
        if (index < state.lastEnd) continue;
        state.count++;
        state.lastEnd = index + phraseLength;
        if (state.count >= 4) return true;
        occurrences.set(phrase, state);
    }
    return false;
}

function hasDenseShortPhraseLoop(text) {
    const compact = String(text || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\p{P}\p{S}\s]/gu, '');
    const minOccurrences = 6;
    const maxWindowChars = 140;

    for (let phraseLength = 4; phraseLength <= 7; phraseLength++) {
        const occurrences = new Map();
        for (let index = 0; index <= compact.length - phraseLength; index++) {
            const phrase = compact.slice(index, index + phraseLength);
            if (/^(.)\1+$/u.test(phrase)) continue;

            const positions = occurrences.get(phrase) || [];
            if (positions.length > 0 && index < positions.at(-1) + phraseLength) continue;
            positions.push(index);
            while (positions.length > 0
                && index + phraseLength - positions[0] > maxWindowChars) {
                positions.shift();
            }
            occurrences.set(phrase, positions);

            if (positions.length < minOccurrences) continue;
            const first = positions.at(-minOccurrences);
            const span = index + phraseLength - first;
            if ((minOccurrences * phraseLength) / span >= 0.18) return true;
        }
    }
    return false;
}

function evaluateTranscriptionQuality({ text, srt, rawSrt = srt, audioAnalysis, language, isFirstChunk = false }) {
    const cues = parseSrtCues(srt);
    const combinedText = normalizeSubtitleText(text || cues.map(cue => cue.text).join(' '));
    const reasons = [];
    let score = 100;

    const embeddedTimeline = /(?:\d{2}:)?\d{2}:\d{2}[.,]\d{2,3}\s*-->\s*(?:\d{2}:)?\d{2}:\d{2}[.,]\d{2,3}/u;
    if (embeddedTimeline.test(combinedText) || cues.some(cue => embeddedTimeline.test(cue.text))) {
        reasons.push('timestamp_leak');
        score -= 70;
    }

    const promptLeak = /請(?:使用|用)繁體(?:中文)?字幕|繁體中文字幕|請不吝.{0,20}(?:訂閱|轉發)|(?:點贊|按讚).{0,20}(?:訂閱|轉發)/u;
    if (promptLeak.test(combinedText)) {
        reasons.push('prompt_leak');
        score -= 55;
    }

    if (/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(combinedText)) {
        reasons.push('invalid_characters');
        score -= 70;
    }

    const hanChars = combinedText.match(/\p{Script=Han}/gu) || [];
    const likelyChinese = language === 'zh' || hanChars.length >= 8;
    if (likelyChinese) {
        const rareForeignChars = combinedText.match(/[\p{Script=Greek}\p{Script=Hebrew}\p{Script=Cyrillic}\p{Script=Arabic}]/gu) || [];
        const neighboringForeignChars = combinedText.match(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || [];
        const totalChars = Math.max(1, subtitleLength(combinedText));
        const rareScriptAnomaly = rareForeignChars.length >= 2
            && rareForeignChars.length / totalChars > 0.005;
        const neighboringScriptAnomaly = neighboringForeignChars.length >= 3
            && neighboringForeignChars.length / totalChars > 0.06;
        if (rareScriptAnomaly || neighboringScriptAnomaly) {
            reasons.push('unexpected_scripts');
            score -= 40;
        }
    }

    const repeatedCharacter = /(.)\1{7,}/u.test(combinedText);
    const adjacentPhraseMatch = combinedText.match(/(.{2,8})(?:[、，, ]*\1){3,}/u);
    const repeatedShortPhrase = Boolean(adjacentPhraseMatch);
    const naturalOralEmphasis = repeatedShortPhrase
        && subtitleLength(adjacentPhraseMatch[1]) <= 3;
    const suspiciousAdjacentPhrase = repeatedShortPhrase && !naturalOralEmphasis;
    const repeatedShortLoop = hasDenseShortPhraseLoop(combinedText);
    const repeatedLongPhrase = hasExcessivePhraseRepetition(combinedText);
    if (repeatedCharacter || repeatedShortPhrase || repeatedShortLoop || repeatedLongPhrase) {
        reasons.push('repetition');
    }
    if (repeatedCharacter || suspiciousAdjacentPhrase || repeatedShortLoop || repeatedLongPhrase) {
        score -= 40;
    } else if (naturalOralEmphasis) {
        score -= 10;
    }
    if (repeatedCharacter) reasons.push('repeated_character');
    if (repeatedShortLoop) reasons.push('repeated_short_loop');
    if (repeatedLongPhrase) reasons.push('repeated_phrase');

    const rawCueBlocks = String(rawSrt || '').split(/\n\s*\n/).filter(Boolean);
    let invalidRawTimings = 0;
    let implausibleRawCues = 0;
    for (const block of rawCueBlocks) {
        const lines = block.trim().split('\n');
        const timeline = lines.find(line => line.includes('-->'));
        if (!timeline) continue;
        const timeParts = timeline.split('-->');
        if (timeParts.length !== 2) {
            invalidRawTimings++;
            continue;
        }
        const start = parseTimestampToMs(timeParts[0]);
        const end = parseTimestampToMs(timeParts[1]);
        const cueText = lines.slice(lines.indexOf(timeline) + 1).join(' ').trim();
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) invalidRawTimings++;
        if (end - start > MAX_SUBTITLE_DURATION_MS && subtitleLength(cueText) <= 2) {
            implausibleRawCues++;
        }
    }
    if (invalidRawTimings > 0) {
        reasons.push('invalid_timestamps');
        score -= 15;
    }
    if (implausibleRawCues > 0) {
        reasons.push('implausible_cue');
        score -= 40;
    }

    const extremeCues = cues.filter(cue => {
        const durationSeconds = (cue.endMs - cue.startMs) / 1000;
        return durationSeconds <= 0 || subtitleLength(cue.text) / durationSeconds > MAX_READABLE_CPS;
    });
    if (extremeCues.length >= Math.max(1, Math.floor(cues.length * 0.2))) {
        reasons.push('unreadable_timing');
        score -= 25;
    }

    const firstSpeechCue = cues.find(cue => cue.text !== MUSIC_LABEL);
    const musicRange = isFirstChunk
        ? detectLeadingMusicRange(audioAnalysis, firstSpeechCue?.startMs ?? null)
        : null;
    const audibleWindows = audioAnalysis?.rmsDb?.filter(db => db > audioAnalysis.audibleThresholdDb).length || 0;
    const audibleRatio = audioAnalysis?.rmsDb?.length
        ? audibleWindows / audioAnalysis.rmsDb.length
        : 0;
    const cueCoverageMs = cues.reduce((sum, cue) => sum + Math.max(0, cue.endMs - cue.startMs), 0);
    // 只有已辨識到後續語音時，才把前導有聲區段視為片頭音樂並排除。
    // 若整段完全沒有字幕，保留為缺漏，避免把漏辨人聲誤標成音樂。
    const ignoredMusicRanges = firstSpeechCue ? [musicRange] : [];
    const longestActiveGapMs = findLongestActiveUncaptionedMs(audioAnalysis, cues, ignoredMusicRanges);
    if (longestActiveGapMs >= 3000) {
        reasons.push('active_audio_gap');
        score -= 50;
    }
    const transcriptChars = subtitleLength(combinedText);
    const audioDurationSeconds = (audioAnalysis?.durationMs || 0) / 1000;
    const charactersPerSecond = audioDurationSeconds > 0
        ? transcriptChars / audioDurationSeconds
        : null;
    const sparseCoverage = audioAnalysis?.durationMs > 8000
        && audibleRatio > 0.55
        && (transcriptChars < 4
            || charactersPerSecond < 0.75
            || (transcriptChars < 8 && cueCoverageMs / audioAnalysis.durationMs < 0.4));
    if (sparseCoverage && !(musicRange && firstSpeechCue)) {
        reasons.push('sparse_transcript');
        score -= 50;
    } else {
        const lowSpeechDensity = language === 'zh'
            && audioAnalysis?.durationMs >= 12000
            && audibleRatio >= 0.75
            && charactersPerSecond < MIN_CONFIDENT_ZH_CPS;
        if (lowSpeechDensity && !(musicRange && firstSpeechCue)) {
            reasons.push('low_speech_density');
            score -= 50;
        }
    }

    const severeReasons = new Set([
        'timestamp_leak',
        'prompt_leak',
        'invalid_characters',
        'repeated_character',
        'repeated_short_loop',
        'repeated_phrase',
    ]);
    const severe = reasons.some(reason => severeReasons.has(reason));
    const severeTimingFailure = reasons.includes('unreadable_timing');
    const suspect = score <= 60 || severeTimingFailure;
    return {
        score: Math.max(0, score),
        suspect,
        severity: severe ? 'severe' : suspect ? 'warning' : 'normal',
        reasons,
        longestActiveGapMs,
        charactersPerSecond,
        audibleRatio,
    };
}

function cleanPromptContext(value, maxLength) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(-maxLength);
}

function isInvalidAiInputError(error) {
    return /(?:8001|invalid input|badinput)/i.test(String(error?.message || error || ''));
}

function isWorkersAiDailyLimitError(error) {
    return /(?:4006|used up your daily free allocation|daily free allocation.+neurons)/i
        .test(String(error?.message || error || ''));
}

function buildWhisperInput(
    audioBase64,
    language,
    promptWords = [],
    retry = false,
    previousContext = '',
    mediaTitle = '',
    minimal = false
) {
    const input = {
        audio: audioBase64,
        task: 'transcribe',
    };
    if (language && language !== 'auto') {
        input.language = normalizeLanguageCode(language);
    }
    if (minimal) return input;

    Object.assign(input, {
        vad_filter: true,
        beam_size: 5,
        condition_on_previous_text: !retry,
        no_speech_threshold: 0.6,
        compression_ratio_threshold: 2.4,
        log_prob_threshold: -1,
        hallucination_silence_threshold: 1.0,
    });
    const promptParts = [];
    if (input.language === 'zh') promptParts.push('繁體中文口語。');
    if (input.language === 'en') promptParts.push('English conversation.');
    if (input.language === 'ja') promptParts.push('日本語の会話。');
    const titleContext = cleanPromptContext(mediaTitle, 80);
    if (titleContext) promptParts.push(titleContext);
    if (promptWords.length > 0) {
        const terminologyContext = promptWords.slice(0, 80).join('、').slice(0, 200);
        if (terminologyContext) promptParts.push(terminologyContext);
    }
    const transcriptContext = retry ? '' : cleanPromptContext(previousContext, 160);
    if (transcriptContext) promptParts.push(transcriptContext);
    if (promptParts.length > 0) input.initial_prompt = promptParts.join(' ');
    return input;
}


// ─── CORS ─────────────────────────────────────────────────────────
function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Language, X-Custom-Dict, X-Chunk-Index, X-Chunk-Offset, X-First-Chunk, X-Previous-Context, X-Media-Title, X-Recovery-Depth, X-Request-Attempt',
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

function decodeHeaderValue(value) {
    if (!value) return '';
    try {
        return decodeURIComponent(value);
    } catch (_) {
        return value;
    }
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
        const previousContext = decodeHeaderValue(request.headers.get('X-Previous-Context'));
        const mediaTitle = decodeHeaderValue(request.headers.get('X-Media-Title'));
        const chunkIndex = request.headers.get('X-Chunk-Index');
        const firstChunkHeader = request.headers.get('X-First-Chunk');
        const isFirstChunk = firstChunkHeader !== null
            ? firstChunkHeader === '1' || firstChunkHeader === 'true'
            : chunkIndex === null || chunkIndex === '0';

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
        const audioAnalysis = analyzeWavPcm(audioBuffer);
        
        // 🚨 關鍵修復：之前的代理對陣列大小有限制，會導致 string 化報錯
        // 我們測試過 Base64 字串是可以成功通過驗證的，所以直接採用原本成功的 Base64 寫法
        
        const customDict = decodeHeaderValue(request.headers.get('X-Custom-Dict'));
        
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
        
        async function transcribeAttempt(retry = false) {
            let usedMinimalInput = false;
            let result;
            try {
                result = await env.AI.run(
                    MODEL,
                    buildWhisperInput(
                        audioBase64,
                        language,
                        promptWords,
                        retry,
                        previousContext,
                        mediaTitle
                    )
                );
            } catch (error) {
                if (!isInvalidAiInputError(error)) throw error;
                usedMinimalInput = true;
                result = await env.AI.run(
                    MODEL,
                    buildWhisperInput(audioBase64, language, [], true, '', '', true)
                );
            }
            if (!result) return null;

            const detectedLanguage = result.transcription_info?.language
                || result.language
                || null;
            const qualityLanguage = language && language !== 'auto'
                ? normalizeLanguageCode(language)
                : /^(?:zh|chinese|mandarin)/i.test(String(detectedLanguage || '')) ? 'zh' : null;

            const rawText = applyRecognitionTextRules(
                String(result.text || '').trim(),
                replaceRules,
                promptWords
            );
            const structuredSrt = segmentsToSrt(result.segments);
            const parsedSrt = structuredSrt || vttToSrt(String(result.vtt || ''));
            const rawSrt = serializeSrtCues(parseSrtCues(parsedSrt).map(cue => ({
                ...cue,
                text: applyRecognitionTextRules(cue.text, replaceRules, promptWords),
            })));
            let srt = mergeSrtBlocks(rawSrt);
            srt = serializeSrtCues(parseSrtCues(srt).map(cue => ({
                ...cue,
                text: applyRecognitionTextRules(cue.text, replaceRules, promptWords),
            })));
            let punctuationRestored = 0;
            if (qualityLanguage === 'zh') {
                const punctuated = restoreChinesePunctuation(srt);
                srt = punctuated.srt;
                punctuationRestored = punctuated.restored;
            }
            const quality = evaluateTranscriptionQuality({
                text: rawText,
                srt,
                rawSrt,
                audioAnalysis,
                language: qualityLanguage,
                isFirstChunk,
            });
            quality.punctuationRestored = punctuationRestored;
            quality.usedMinimalInput = usedMinimalInput;
            quality.dictionaryTermCount = promptWords.length;
            quality.replacementRuleCount = replaceRules.length;
            return {
                rawText,
                srt,
                quality,
                wordCount: result.word_count || 0,
                detectedLanguage,
            };
        }

        const primary = await transcribeAttempt(false);
        if (!primary) {
            return errorResponse('Whisper 辨識失敗，請確認音訊格式正確（建議 WAV/MP3）', 500);
        }
        let selected = primary;
        let retried = false;
        if (primary.quality.suspect) {
            const retryResult = await transcribeAttempt(true);
            retried = true;
            if (retryResult && retryResult.quality.score > selected.quality.score) {
                selected = retryResult;
            }
        }

        const srt = decorateFirstChunkSrt(selected.srt, audioAnalysis, isFirstChunk);
        return jsonResponse({
            text: selected.rawText,
            vtt: srtToVtt(srt),
            srt,
            wordCount: selected.wordCount,
            detectedLanguage: selected.detectedLanguage,
            quality: {
                ...selected.quality,
                retried,
            },
        });

    } catch (err) {
        console.error('[Whisper Worker Error]', err?.message || err);
        const requestDetails = {
            chunkIndex: request.headers.get('X-Chunk-Index'),
            recoveryDepth: Number(request.headers.get('X-Recovery-Depth') || 0),
            requestAttempt: Number(request.headers.get('X-Request-Attempt') || 1),
        };
        if (isWorkersAiDailyLimitError(err)) {
            return jsonResponse({
                error: 'Cloudflare Workers AI 每日 10,000 neurons 的免費額度已用完；請等待額度重置或升級 Workers Paid 方案。',
                code: 'AI_DAILY_LIMIT',
                retryable: false,
                ...requestDetails,
            }, 429);
        }
        if (isInvalidAiInputError(err)) {
            return jsonResponse({
                error: 'Workers AI 拒絕此音訊片段；請改用較短片段重試。',
                code: 'AI_INVALID_INPUT',
                retryable: true,
                ...requestDetails,
            }, 422);
        }
        return jsonResponse({
            error: `處理失敗：${err?.message || '未知錯誤'}`,
            code: 'AI_REQUEST_FAILED',
            retryable: true,
            ...requestDetails,
        }, 500);
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

export {
    analyzeWavPcm,
    buildWhisperInput,
    decorateFirstChunkSrt,
    detectLeadingMusicRange,
    evaluateTranscriptionQuality,
    fixSpellingInText,
    mergeSrtBlocks,
    parseSrtCues,
    restoreChinesePunctuation,
    segmentsToSrt,
    serializeSrtCues,
    shouldMergeEnglish,
    srtToVtt,
    vttToSrt,
};
