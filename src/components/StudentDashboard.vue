<script setup>
import { ref, onMounted, computed, watch } from 'vue'

const props = defineProps(['courseCode', 'studentName'])
const API_URL = 'https://script.google.com/macros/s/AKfycby3pSgIy6Gs5EK3SxWTg-o1SCzDHSVQORDGrDI03Xa7wqCQcTmxiLyF2leq1_SQ4ClM/exec'

const courseData = ref({ content: '單元一', questions: [] })
const units = ref([{ title: '單元一', blocks: [] }]) // Initialize with a default unit
const selectedUnitIndex = ref(0)

const activeTab = ref('content') // content, vocab, practice, quiz, history
const isLoading = ref(true)
const isFetching = ref(false)
const fetchError = ref(false)

const quizSubmitted = ref(false) // 追蹤測驗是否已提交
const quizScore = ref(null) // 儲存測驗分數
const quizTotalPossible = ref(0) // 儲存測驗總分
const quizDetailedResults = ref([]) // 儲存測驗詳細結果 (每題對錯)
const allSubmissions = ref([]) // 儲存所有歷史提交紀錄
const hoveredPoint = ref(null) // 新增：目前懸浮的數據點資訊
const selectedHistory = ref(null) // 目前查看的特定歷史紀錄詳情
const selectedCategory = ref('VOCAB') // 新增：追蹤目前選中的練習類別
const selectedType = ref('ALL') // 新增：追蹤目前選中的題型篩選

// 單字學習相關
const currentVocabCategory = ref('TEACHER') // TEACHER, K, E, J, S, U
const displayVocabs = ref([])
const vocabShowMode = ref('EN') // EN: 先看英文, CN: 先看中文
const flippedCards = ref(new Set())

const loadVocabs = async (category) => {
  currentVocabCategory.value = category
  flippedCards.value.clear()
  let pool = []

  if (category === 'TEACHER') {
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'getVocab', courseCode: props.courseCode })
      })
      const result = await response.json()
      if (result.status === 'success') pool = result.vocabs || []
    } catch (e) { console.error(e) }
  } else {
    // 讀取 local CSV 檔案，檔名需符合格式：單字-學制.csv
    const categoryMap = { K: '幼稚園', E: '國小', J: '國中', S: '高中', U: '大學' }
    try {
      const response = await fetch(`./單字-${categoryMap[category]}.csv`)
      if (response.ok) {
        const text = await response.text()
        // 將 CSV 文字按行分割，並過濾掉空白行
        const rows = text.split('\n').filter(row => row.trim() !== '')
        // 略過第一行標題，解析內容
        pool = rows.slice(1).map(row => {
          const cols = row.split(',')
          return {
            word: cols[0]?.trim(),
            pos: cols[1]?.trim(),
            meaning: cols[2]?.trim()
          }
        }).filter(item => item.word && item.meaning)
      }
      else {
        // 暫時 Mock 資料供測試
        pool = Array.from({length: 20}, (_, i) => ({
          word: `${category} Word ${i+1}`,
          pos: 'n.',
          meaning: `意思 ${i+1}`
        }))
      }
    } catch (e) { pool = [] }
  }

  displayVocabs.value = shuffleArray(pool).slice(0, 12)
}

const toggleCard = (index) => {
  if (flippedCards.value.has(index)) flippedCards.value.delete(index)
  else flippedCards.value.add(index)
}

// 新增：計算進步圖表資料，修復 "progressChartData" is not defined 警告
const progressChartData = computed(() => {
  if (!allSubmissions.value || allSubmissions.value.length === 0) return null;
  
  // 將紀錄按日期升序排列（從舊到新）以繪製折線
  const sorted = [...allSubmissions.value].sort((a, b) => new Date(a.submissionDate) - new Date(b.submissionDate));
  const width = 600;
  const height = 150;
  const padding = 30;

  const points = sorted.map((sub, i) => {
    const x = sorted.length > 1 
      ? padding + (i * (width - padding * 2)) / (sorted.length - 1)
      : width / 2; // 若只有一筆，數據點置中
    const ratio = Number(sub.total) > 0 ? Number(sub.score) / Number(sub.total) : 0;
    const y = height - padding - ratio * (height - padding * 2);
    return { x, y, score: Math.round(ratio * 100), date: sub.submissionDate, raw: sub };
  });

  const polylinePoints = points.length > 1 ? points.map(p => `${p.x},${p.y}`).join(' ') : '';
  return { points, polylinePoints, width, height };
});

// 題型翻譯對照表
const typeLabels = {
  SINGLE: '單選題',
  MULTI: '多選題',
  TF: '是非題',
  FILL: '填充題',
  SHORT: '簡答題'
}

// 內容渲染輔助邏輯
const parsedContentBlocks = computed(() => {
  if (!units.value) return [];
  const idx = selectedUnitIndex.value ?? 0;
  const targetUnit = units.value[idx] || null;
  if (!targetUnit || !targetUnit.blocks || !Array.isArray(targetUnit.blocks)) return [];
  
  return targetUnit.blocks.map(block => {
    let processedUrl = '';
    // 安全處理：避免非字串類型導致程式崩潰
    let rawValue = String(block.value || '').trim();

    // 1. 優先處理 Base64 檔案或影片類型
    if (rawValue.startsWith('data:') || block.type === 'video') {
      processedUrl = rawValue;
    } else {
      // 2. 如果使用者貼上的是整段 iframe 標籤，嘗試從中提取 src 網址
      if (rawValue.startsWith('<iframe')) {
        const srcMatch = rawValue.match(/src=["']([^"']+)["']/);
        if (srcMatch) rawValue = srcMatch[1];
      }

      // 3. YouTube 連結處理
      if (block.type === 'youtube') {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
        const match = rawValue.match(regExp);
        processedUrl = (match && match[2].length === 11)
          ? `https://www.youtube.com/embed/${match[2]}`
          : rawValue;
      }
      // 4. Google Drive / Docs / Slides 連結處理
      else if (block.type === 'embed' && rawValue.includes('google.com')) {
        let url = rawValue;
        // 處理 drive.google.com/open?id=... 格式
        if (url.includes('drive.google.com/open?id=')) {
          const id = url.split('id=')[1].split('&')[0];
          processedUrl = `https://drive.google.com/file/d/${id}/preview`;
        } else if (url.includes('/d/e/')) {
          // 「發佈到網路」的連結，最穩定
          processedUrl = url;
        } else if (url.includes('drive.google.com/file/d/')) {
          // 一般雲端硬碟檔案連結，轉換為 preview 模式
          processedUrl = url.replace(/\/view.*$/, '').replace(/\/edit.*$/, '').replace(/\/$/, '') + '/preview';
        } else {
          url = url.split('?')[0].split('#')[0];
          if (url.includes('/presentation/d/')) {
            processedUrl = url.replace(/\/edit.*$/, '').replace(/\/view.*$/, '').replace(/\/$/, '') + '/embed';
          } else if (url.includes('/spreadsheets/d/')) {
            processedUrl = url.replace(/\/edit.*$/, '').replace(/\/view.*$/, '').replace(/\/$/, '') + '/preview?widget=false&headers=false&chrome=false';
          } else if (url.includes('/document/d/') || url.includes('/file/d/')) {
            processedUrl = url.replace(/\/edit.*$/, '').replace(/\/view.*$/, '').replace(/\/$/, '') + '/preview';
          } else {
            processedUrl = url;
          }
        }
      } else {
        processedUrl = rawValue;
      }
    }
    return { ...block, processedUrl, fontSize: block.fontSize || '20px', align: block.align || 'left' };
  });
});

// --- 這裡放置固定的練習題庫 (不需要等老師從後台新增) ---
const FIXED_PRACTICE_POOL = [
  // region 單字類別 (VOCAB) - 100題
  { category: 'VOCAB', q: 'The CEO decided to ________ his position due to health issues.', a: 'C', qType: 'SINGLE', options: 'A. retain, B. assume, C. resign, D. pursue', explanation: 'Resign (動詞) 代表「辭職」；由於健康問題，執行長決定辭職。' },
  { category: 'VOCAB', q: 'She has a vivid ________ and loves writing fictional stories.', a: 'A', qType: 'SINGLE', options: 'A. imagination, B. isolation, C. obligation, D. illustration', explanation: 'Imagination (名詞) 代表「想像力」；她有豐富的想像力。' },
  { category: 'VOCAB', q: 'The new software is highly ________; even beginners can use it easily.', a: 'B', qType: 'SINGLE', options: 'A. hostile, B. intuitive, C. redundant, D. ambiguous' },
  { category: 'VOCAB', q: 'After a long and ________ journey, they finally reached the mountain peak.', a: 'D', qType: 'SINGLE', options: 'A. trivial, B. fragile, C. superficial, D. grueling' },
  { category: 'VOCAB', q: 'The local government aims to ________ poverty through new job programs.', a: 'A', qType: 'SINGLE', options: 'A. alleviate, B. aggravate, C. advocate, D. accumulate', explanation: 'Alleviate (動詞) 代表「減輕、緩和」；政府旨在透過就業計畫減輕貧窮。' },
  { category: 'VOCAB', q: 'His ________ excuse for missing the meeting didn\'t convince anyone.', a: 'B', qType: 'SINGLE', options: 'A. profound, B. flimsy, C. rigid, D. eternal', explanation: 'Flimsy (形容詞) 代表「輕薄的、站不住腳的」；這裡指拙劣的藉口。' },
  { category: 'VOCAB', q: 'The smell of freshly baked bread ________ through the entire house.', a: 'C', qType: 'SINGLE', options: 'A. condensed, B. vanished, C. permeated, D. decayed', explanation: 'Permeated (動詞) 代表「滲透、瀰漫」；麵包香氣瀰漫全屋。' },
  { category: 'VOCAB', q: 'Technology has become an ________ part of our daily lives.', a: 'D', qType: 'SINGLE', options: 'A. obsolete, B. eccentric, C. abstract, D. indispensable' },
  { category: 'VOCAB', q: 'The sudden rainstorm caused a ________ delay in the baseball game.', a: 'A', qType: 'SINGLE', options: 'A. temporary, B. contemporary, C. permanent, D. continuous' },
  { category: 'VOCAB', q: 'She showed great ________ by remaining calm during the crisis.', a: 'B', qType: 'SINGLE', options: 'A. anxiety, B. resilience, C. reluctance, D. ignorance' },
  { category: 'VOCAB', q: 'Which of the following words are synonyms of "generous"?', a: 'A,C', qType: 'MULTI', options: 'A. magnanimous, B. stingy, C. benevolent, D. malicious' },
  { category: 'VOCAB', q: 'Select all words that can describe something very small.', a: 'B,D', qType: 'MULTI', options: 'A. immense, B. minuscule, C. vast, D. microscopic' },
  { category: 'VOCAB', q: 'Which of the following nouns refer to a person?', a: 'A,B,D', qType: 'MULTI', options: 'A. physician, B. antagonist, C. architecture, D. beneficiary' },
  { category: 'VOCAB', q: 'Select all words that have a negative connotation.', a: 'B,C', qType: 'MULTI', options: 'A. prosperous, B. catastrophic, C. deceptive, D. innovative' },
  { category: 'VOCAB', q: 'Which prefixes can be added to "correct" to change its meaning?', a: 'A,C', qType: 'MULTI', options: 'A. in-, B. un-, C. hyper-, D. dis-' },
  { category: 'VOCAB', q: 'Choose all adjectives that mean "very smart or clever".', a: 'A,D', qType: 'MULTI', options: 'A. ingenious, B. naive, C. tedious, D. astute' },
  { category: 'VOCAB', q: 'Which words can mean "to change or adjust"?', a: 'B,C,D', qType: 'MULTI', options: 'A. preserve, B. alter, C. adapt, D. modify' },
  { category: 'VOCAB', q: 'Select all words related to the concept of "time".', a: 'A,C', qType: 'MULTI', options: 'A. chronological, B. spatial, C. ephemeral, D. audio' },
  { category: 'VOCAB', q: 'Which of the following are antonyms of "frequent"?', a: 'B,D', qType: 'MULTI', options: 'A. constant, B. sporadic, C. chronic, D. scarce' },
  { category: 'VOCAB', q: 'Select the words that correctly fill the blank: "The instructions were ________, leaving no room for doubt."', a: 'A,C', qType: 'MULTI', options: 'A. explicit, B. ambiguous, C. precise, D. vague' },
  { category: 'VOCAB', q: 'The word "loquacious" means very quiet and shy.', a: 'FALSE', qType: 'TF', options: 'True, False' },
  { category: 'VOCAB', q: '"Apathy" means a lack of interest, enthusiasm, or concern.', a: 'TRUE', qType: 'TF', options: 'True, False' },
  { category: 'VOCAB', q: 'The words "empathy" and "sympathy" mean exactly the same thing.', a: 'FALSE', qType: 'TF', options: 'True, False' },
  { category: 'VOCAB', q: 'The suffix "-phobia" refers to an extreme or irrational fear of something.', a: 'TRUE', qType: 'TF', options: 'True, False' },
  { category: 'VOCAB', q: '"Obsolete" describes something that is modern and cutting-edge.', a: 'FALSE', qType: 'TF', options: 'True, False' },
  { category: 'VOCAB', q: 'To "subsidize" means to support financially.', a: 'TRUE', qType: 'TF', options: 'True, False' },
  { category: 'VOCAB', q: 'An "amateur" is someone who does an activity as a professional career.', a: 'FALSE', qType: 'TF', options: 'True, False' },
  { category: 'VOCAB', q: 'The word "hazardous" is a synonym for "dangerous".', a: 'TRUE', qType: 'TF', options: 'True, False' },
  { category: 'VOCAB', q: '"Meticulous" means showing great attention to detail; very careful.', a: 'TRUE', qType: 'TF', options: 'True, False' },
  { category: 'VOCAB', q: 'The verb "excel" means to be exceptionally good at something.', a: 'TRUE', qType: 'TF', options: 'True, False' },
  { category: 'VOCAB', q: 'Write the noun form of the verb "create".', a: 'creation', qType: 'FILL', options: '' },
  { category: 'VOCAB', q: 'What is the antonym of "clumsy"?', a: 'graceful', qType: 'FILL', options: '' },
  { category: 'VOCAB', q: 'Complete the sentence: "A person who predicts the future is a ________."', a: 'prophet', qType: 'FILL', options: '' },
  { category: 'VOCAB', q: 'Change the adjective "happy" into an adverb.', a: 'happily', qType: 'FILL', options: '' },
  { category: 'VOCAB', q: 'What word starting with \'C\' means "a state of total confusion and disorder"?', a: 'chaos', qType: 'FILL', options: '' },
  { category: 'VOCAB', q: 'Add a prefix to the word "understand" to mean "to interpret incorrectly".', a: 'misunderstand', qType: 'FILL', options: '' },
  { category: 'VOCAB', q: 'Fill in the blank: "Water boils at 100 degrees ________."', a: 'Celsius', qType: 'FILL', options: '' },
  { category: 'VOCAB', q: 'What is the synonym of "fragile" that starts with the letter \'B\'?', a: 'brittle', qType: 'FILL', options: '' },
  { category: 'VOCAB', q: 'Complete the phrase: "Prevention is better than ________."', a: 'cure', qType: 'FILL', options: '' },
  { category: 'VOCAB', q: 'Write the adjective form of the noun "mystery".', a: 'mysterious', qType: 'FILL', options: '' },
  { category: 'VOCAB', q: 'What does the idiom "bite the bullet" mean?', a: 'To face a difficult situation with courage and get it over with.', qType: 'SHORT', options: '' },
  { category: 'VOCAB', q: 'Explain the difference between "recipe" and "receipt".', a: 'A "recipe" is a set of instructions for cooking, while a "receipt" is a written proof of payment.', qType: 'SHORT', options: '' },
  { category: 'VOCAB', q: 'What is the meaning of the word "vulnerable"?', a: 'Susceptible to physical or emotional attack or harm.', qType: 'SHORT', options: '' },
  { category: 'VOCAB', q: 'Provide a synonym and an antonym for the word "abundant".', a: 'Synonym: plentiful; Antonym: scarce.', qType: 'SHORT', options: '' },
  { category: 'VOCAB', q: 'What field of study does an "anthropologist" work in?', a: 'The study of human societies, cultures, and their development.', qType: 'SHORT', options: '' },
  { category: 'VOCAB', q: 'Give an example sentence using the word "procrastinate".', a: 'I always procrastinate when it comes to doing my taxes.', qType: 'SHORT', options: '' },
  { category: 'VOCAB', q: 'What is the meaning of the root word "chrono-"?', a: 'It means "time".', qType: 'SHORT', options: '' },
  { category: 'VOCAB', q: 'Explain the term "bilingual".', a: 'Fluent in speaking two different languages.', qType: 'SHORT', options: '' },
  { category: 'VOCAB', q: 'What is the noun form of the adjective "brave"?', a: 'bravery', qType: 'SHORT', options: '' },
  { category: 'VOCAB', q: 'What does it mean if an event is "inevitable"?', a: 'It is certain to happen and cannot be avoided.', qType: 'SHORT', options: '' },
  { category: 'VOCAB', q: 'The doctor advised him to ________ from eating fast food.', a: 'A', qType: 'SINGLE', options: 'A. refrain, B. retain, C. obtain, D. sustain' },
  { category: 'VOCAB', q: 'Her voice was barely ________ above the loud noise of the traffic.', a: 'C', qType: 'SINGLE', options: 'A. legible, B. visible, C. audible, D. credible' },
  { category: 'VOCAB', q: 'The company hopes to ________ its sales by launching a new marketing campaign.', a: 'B', qType: 'SINGLE', options: 'A. diminish, B. boost, C. mimic, D. fluctuate' },
  { category: 'VOCAB', q: 'He is a ________ reader who devours three books a week.', a: 'D', qType: 'SINGLE', options: 'A. reluctant, B. passive, C. casual, D. voracious' },
  { category: 'VOCAB', q: 'The country\'s economy relies heavily on the ________ of oil.', a: 'A', qType: 'SINGLE', options: 'A. export, B. tuition, C. deficit, D. census' },
  { category: 'VOCAB', q: 'We need to find a ________ solution that satisfies both parties.', a: 'B', qType: 'SINGLE', options: 'A. superficial, B. amicable, C. hostile, D. random' },
  { category: 'VOCAB', q: 'The pollution levels in the river have reached a ________ state.', a: 'C', qType: 'SINGLE', options: 'A. minor, B. festive, C. critical, D. pleasant' },
  { category: 'VOCAB', q: 'She gave a ________ summary of the project, keeping it short and clear.', a: 'D', qType: 'SINGLE', options: 'A. tedious, B. redundant, C. vague, D. concise' },
  { category: 'VOCAB', q: 'Winning the championship was a ________ milestone for the team.', a: 'A', qType: 'SINGLE', options: 'A. monumental, B. trivial, C. versatile, D. skeletal' },
  { category: 'VOCAB', q: 'The diamond\'s ________ made it incredibly valuable.', a: 'B', qType: 'SINGLE', options: 'A. density, B. authenticity, C. humidity, D. toxicity' },
  { category: 'VOCAB', q: 'Which of the following words mean "to happen at the same time"?', a: 'B,D', qType: 'MULTI', options: 'A. postdate, B. coincide, C. isolate, D. synchronize' },
  { category: 'VOCAB', q: 'Select all words that describe bad weather.', a: 'A,C,D', qType: 'MULTI', options: 'A. turbulent, B. serene, C. bleak, D. tempestuous' },
  { category: 'VOCAB', q: 'Which of the following are types of emotions?', a: 'A,B,C', qType: 'MULTI', options: 'A. euphoria, B. resentment, C. nostalgia, D. vertical' },
  { category: 'VOCAB', q: 'Select all words that can mean "to praise someone".', a: 'B,D', qType: 'MULTI', options: 'A. condemn, B. applaud, C. criticize, D. commend' },
  { category: 'VOCAB', q: 'Which of the following adjectives are related to water or liquid?', a: 'A,C', qType: 'MULTI', options: 'A. aquatic, B. arid, C. saturated, D. sterile' },
  { category: 'VOCAB', q: 'Choose the correct synonyms for "obstacle".', a: 'A,D', qType: 'MULTI', options: 'A. barrier, B. catalyst, C. asset, D. hurdle' },
  { category: 'VOCAB', q: 'Which suffixes can be used to turn a verb into a noun representing a person?', a: 'B,C,D', qType: 'MULTI', options: 'A. -ness, B. -er, C. -ist, D. -ant' },
  { category: 'VOCAB', q: 'Select all words that mean "lasting for a very short time".', a: 'A,B', qType: 'MULTI', options: 'A. transient, B. fleeting, C. perpetual, D. enduring' },
  { category: 'VOCAB', q: 'Which of the following words describe food that tastes good?', a: 'B,C', qType: 'MULTI', options: 'A. rancid, B. savory, C. delectable, D. bland' },
  { category: 'VOCAB', q: 'Select the words that mean "to gather or collect over time".', a: 'A,D', qType: 'MULTI', options: 'A. accumulate, B. squander, C. disperse, D. amass' },
  { category: 'VOCAB', q: '"Optimistic" means expecting the worst possible outcome.', a: 'FALSE', qType: 'TF', options: 'True, False' },
  { category: 'VOCAB', q: 'A "monopoly" exists when a single company dominates an entire industry.', a: 'TRUE', qType: 'TF', options: 'True, False' },
  { category: 'VOCAB', q: '"Conscientious" employees are usually careless and irresponsible.', a: 'FALSE', qType: 'TF', options: 'True, False' },
  { category: 'VOCAB', q: 'The word "lethal" means sufficient to cause death.', a: 'TRUE', qType: 'TF', options: 'True, False' },
  { category: 'VOCAB', q: 'To "validate" something means to prove that it is false or invalid.', a: 'FALSE', qType: 'TF', options: 'True, False' },
  { category: 'VOCAB', q: '"Sovereignty" refers to supreme power or authority.', a: 'TRUE', qType: 'TF', options: 'True, False' },
  { category: 'VOCAB', q: 'The adjective "audacious" means showing a willingness to take surprisingly bold risks.', a: 'TRUE', qType: 'TF', options: 'True, False' },
  { category: 'VOCAB', q: '"Pragmatic" people deal with things sensibly and realistically based on practical considerations.', a: 'TRUE', qType: 'TF', options: 'True, False' },
  { category: 'VOCAB', q: 'A "paradox" is a statement that is completely simple and easy to understand without contradictions.', a: 'FALSE', qType: 'TF', options: 'True, False' },
  { category: 'VOCAB', q: 'The word "juvenile" relates to old age and senior citizens.', a: 'FALSE', qType: 'TF', options: 'True, False' },
  { category: 'VOCAB', q: 'Write the opposite of the adjective "voluntary".', a: 'involuntary', qType: 'FILL', options: '' },
  { category: 'VOCAB', q: 'Fill in the blank: "A person who travels into space is an ________."', a: 'astronaut', qType: 'FILL', options: '' },
  { category: 'VOCAB', q: 'What is the noun form of the adjective "pure"?', a: 'purity', qType: 'FILL', options: '' },
  { category: 'VOCAB', q: 'Complete the sentence: "An architecture specialist who designs buildings is an ________."', a: 'architect', qType: 'FILL', options: '' },
  { category: 'VOCAB', q: 'What word starting with \'N\' means "neither good nor bad; not taking sides in a conflict"?', a: 'neutral', qType: 'FILL', options: '' },
  { category: 'VOCAB', q: 'Write the synonym of "imitate" that starts with the letter \'M\'.', a: 'mimic', qType: 'FILL', options: '' },
  { category: 'VOCAB', q: 'Fill in the blank: "A book that contains facts and definitions arranged alphabetically is a ________."', a: 'dictionary', qType: 'FILL', options: '' },
  { category: 'VOCAB', q: 'What is the antonym of "artificial"?', a: 'natural', qType: 'FILL', options: '' },
  { category: 'VOCAB', q: 'Add a suffix to "hope" to mean "having no hope".', a: 'hopeless', qType: 'FILL', options: '' },
  { category: 'VOCAB', q: 'What term refers to "the crime of stealing goods from a shop while pretending to be a customer"?', a: 'shoplifting', qType: 'FILL', options: '' },
  { category: 'VOCAB', q: 'What does the idiom "break a leg" mean?', a: 'A way to wish an actor or performer good luck before a show.', qType: 'SHORT', options: '' },
  { category: 'VOCAB', q: 'Explain the difference between "desert" (noun) and "dessert".', a: 'A "desert" is a dry, sandy region with little water, while a "dessert" is a sweet course eaten at the end of a meal.', qType: 'SHORT', options: '' },
  { category: 'VOCAB', q: 'What is the definition of "ubiquitous"?', a: 'Present, appearing, or found everywhere.', qType: 'SHORT', options: '' },
  { category: 'VOCAB', q: 'Provide a synonym and an antonym for "courageous".', a: 'Synonym: brave; Antonym: cowardly.', qType: 'SHORT', options: '' },
  { category: 'VOCAB', q: 'What does a "cardiologist" specialize in?', a: 'The study and treatment of heart disorders.', qType: 'SHORT', options: '' },
  { category: 'VOCAB', q: 'Use the word "simultaneous" in a sentence.', a: 'There was a simultaneous broadcast of the game on TV and radio.', qType: 'SHORT', options: '' },
  { category: 'VOCAB', q: 'What does the prefix "mis-" generally mean?', a: 'Wrongly, badly, or incorrectly.', qType: 'SHORT', options: '' },
  { category: 'VOCAB', q: 'Explain the term "anonymous".', a: 'Made or done by a person whose name is not publicly known.', qType: 'SHORT', options: '' },
  { category: 'VOCAB', q: 'What is the verb form of the noun "sympathy"?', a: 'sympathize', qType: 'SHORT', options: '' },
  { category: 'VOCAB', q: 'What does it mean if a liquid is "potable"?', a: 'It is safe to drink.', qType: 'SHORT', options: '' },
  // endregion
  
  // 文法類別 (GRAMMAR)
  { category: 'GRAMMAR', q: 'She ________ to school every day.', a: 'A', qType: 'SINGLE', options: 'A. walks, B. walk, C. walking, D. is walk' },
  { category: 'GRAMMAR', q: 'Either the teacher or the students ________ going to clean the classroom.', a: 'B', qType: 'SINGLE', options: 'A. is, B. are, C. am, D. be' },
  { category: 'GRAMMAR', q: 'The book ________ I bought yesterday is very interesting.', a: 'B', qType: 'SINGLE', options: 'A. who, B. which, C. whom, D. whose' },
  { category: 'GRAMMAR', q: 'If it ________ tomorrow, we will cancel the picnic.', a: 'C', qType: 'SINGLE', options: 'A. rain, B. rained, C. rains, D. will rain' },
  { category: 'GRAMMAR', q: 'By the time the police arrived, the thief ________.', a: 'D', qType: 'SINGLE', options: 'A. escapes, B. has escaped, C. escaping, D. had escaped' },
  { category: 'GRAMMAR', q: 'I am looking forward to ________ you soon.', a: 'C', qType: 'SINGLE', options: 'A. see, B. seen, C. seeing, D. saw' },
  { category: 'GRAMMAR', q: 'He is ________ intelligent boy that everyone likes him.', a: 'B', qType: 'SINGLE', options: 'A. so, B. such an, C. such, D. very' },
  { category: 'GRAMMAR', q: 'Under no circumstances ________ leave the room during the exam.', a: 'A', qType: 'SINGLE', options: 'A. should you, B. you should, C. you can, D. did you' },
  { category: 'GRAMMAR', q: 'The heavy rain prevented us ________ going hiking.', a: 'D', qType: 'SINGLE', options: 'A. to, B. for, C. with, D. from' },
  { category: 'GRAMMAR', q: 'I would rather ________ at home than go out in this bad weather.', a: 'A', qType: 'SINGLE', options: 'A. stay, B. to stay, C. staying, D. stayed' },
  { category: 'GRAMMAR', q: 'Which of the following words can be used to fill in the blank? "He is fluent ________ English."', a: 'A,B', qType: 'MULTI', options: 'A. in, B. at, C. with, D. for' },
  { category: 'GRAMMAR', q: 'Choose the correct sentences.', a: 'B,C', qType: 'MULTI', options: 'A. She don\'t like apples., B. She doesn\'t like apples., C. They don\'t like apples., D. They doesn\'t like apples.' },
  { category: 'GRAMMAR', q: 'Which of the following relative pronouns can refer to a person?', a: 'A,B,D', qType: 'MULTI', options: 'A. who, B. whom, C. which, D. that' },
  { category: 'GRAMMAR', q: 'Select all sentences that use the passive voice correctly.', a: 'A,D', qType: 'MULTI', options: 'A. The cake was eaten by the children., B. The cake was eat by the children., C. The house built in 1990., D. The house was built in 1990.' },
  { category: 'GRAMMAR', q: 'Which words can complete the sentence: "I don\'t have ________ money."?', a: 'B,C', qType: 'MULTI', options: 'A. many, B. any, C. much, D. a' },
  { category: 'GRAMMAR', q: 'Choose the correct negative forms of "He has finished his homework."', a: 'B,D', qType: 'MULTI', options: 'A. He hasn\'t finished his homework yet., B. He has not finished his homework., C. He didn\'t finished his homework., D. He has yet to finish his homework.' },
  { category: 'GRAMMAR', q: 'Which of the following are uncountable nouns?', a: 'B,C,D', qType: 'MULTI', options: 'A. apple, B. water, C. information, D. advice' },
  { category: 'GRAMMAR', q: 'Select the sentences that correctly use "used to".', a: 'A,C', qType: 'MULTI', options: 'A. I used to live in London., B. I used to living in London., C. I am used to living in London., D. I am used to live in London.' },
  { category: 'GRAMMAR', q: 'Which conjunctions can express contrast?', a: 'A,B,C', qType: 'MULTI', options: 'A. although, B. however, C. while, D. because' },
  { category: 'GRAMMAR', q: 'Choose the correct comparative or superlative sentences.', a: 'A,D', qType: 'MULTI', options: 'A. This book is more interesting than that one., B. This book is more interest than that one., C. He is the most tallest boy in class., D. He is the tallest boy in class.' },
  { category: 'GRAMMAR', q: 'The word "beautiful" is a noun.', a: 'FALSE', qType: 'TF', options: 'True, False' },
  { category: 'GRAMMAR', q: 'In the sentence "He runs fast," the word "fast" is an adverb.', a: 'TRUE', qType: 'TF', options: 'True, False' },
  { category: 'GRAMMAR', q: '"Information" is a countable noun, so we can say "an information".', a: 'FALSE', qType: 'TF', options: 'True, False' },
  { category: 'GRAMMAR', q: 'The past tense of "read" is pronounced differently from its base form, though spelled the same.', a: 'TRUE', qType: 'TF', options: 'True, False' },
  { category: 'GRAMMAR', q: 'We use "since" to indicate a specific point in time in the past.', a: 'TRUE', qType: 'TF', options: 'True, False' },
  { category: 'GRAMMAR', q: '"Unless" means the same as "if... not".', a: 'TRUE', qType: 'TF', options: 'True, False' },
  { category: 'GRAMMAR', q: 'The gerund (V-ing) can function as the subject of a sentence.', a: 'TRUE', qType: 'TF', options: 'True, False' },
  { category: 'GRAMMAR', q: 'We can use the modal verb "must" to express a strong recommendation.', a: 'TRUE', qType: 'TF', options: 'True, False' },
  { category: 'GRAMMAR', q: '"Furniture" can be pluralized as "furnitures".', a: 'FALSE', qType: 'TF', options: 'True, False' },
  { category: 'GRAMMAR', q: 'In conditional sentences type 3 (unreal past), we use "would + base verb" in the main clause.', a: 'FALSE', qType: 'TF', options: 'True, False' },
  { category: 'GRAMMAR', q: 'Write the past participle form of the verb "go".', a: 'gone', qType: 'FILL', options: '' },
  { category: 'GRAMMAR', q: 'Complete the sentence with the correct preposition: "She is interested ________ art."', a: 'in', qType: 'FILL', options: '' },
  { category: 'GRAMMAR', q: 'Fill in the blank with the correct form of "be": "The news ________ shocking."', a: 'is', qType: 'FILL', options: '' },
  { category: 'GRAMMAR', q: 'Turn the verb into the correct form: "I suggested ________ (go) for a walk."', a: 'going', qType: 'FILL', options: '' },
  { category: 'GRAMMAR', q: 'Fill in the blank with "make" or "do": "I need to ________ a phone call."', a: 'make', qType: 'FILL', options: '' },
  { category: 'GRAMMAR', q: 'Fill in the blank with a relative pronoun: "The man ________ car was stolen called the police."', a: 'whose', qType: 'FILL', options: '' },
  { category: 'GRAMMAR', q: 'Complete the sentence: "If I ________ (be) you, I would accept the offer."', a: 'were', qType: 'FILL', options: '' },
  { category: 'GRAMMAR', q: 'Write the opposite of "interesting" using a prefix or suffix.', a: 'uninteresting', qType: 'FILL', options: '' },
  { category: 'GRAMMAR', q: 'Fill in the blank: "He has been working here ________ five years."', a: 'for', qType: 'FILL', options: '' },
  { category: 'GRAMMAR', q: 'Complete the question tag: "You are coming to the party, ________ you?"', a: 'aren\'t', qType: 'FILL', options: '' },
  { category: 'GRAMMAR', q: 'Change the following sentence into the passive voice: "Tom broke the window."', a: 'The window was broken by Tom.', qType: 'SHORT', options: '' },
  { category: 'GRAMMAR', q: 'Explain the difference between "few" and "a few".', a: '"Few" implies a negative meaning (almost none), while "a few" implies a positive meaning (some). Both are used with plural countable nouns.', qType: 'SHORT', options: '' },
  { category: 'GRAMMAR', q: 'Rewrite the sentence using "Too... to...": "He is so young that he cannot go to school."', a: 'He is too young to go to school.', qType: 'SHORT', options: '' },
  { category: 'GRAMMAR', q: 'What is the plural form of the noun "child"?', a: 'children', qType: 'SHORT', options: '' },
  { category: 'GRAMMAR', q: 'Combine these two sentences using a relative pronoun: "I met a lady. She can speak five languages."', a: 'I met a lady who can speak five languages.', qType: 'SHORT', options: '' },
  { category: 'GRAMMAR', q: 'Correct the error in this sentence: "He don\'t know the answer."', a: 'He doesn\'t know the answer.', qType: 'SHORT', options: '' },
  { category: 'GRAMMAR', q: 'Turn this direct speech into indirect speech: "I am tired," said Mary.', a: 'Mary said that she was tired.', qType: 'SHORT', options: '' },
  { category: 'GRAMMAR', q: 'What is the comparative form of the adjective "bad"?', a: 'worse', qType: 'SHORT', options: '' },
  { category: 'GRAMMAR', q: 'Rewrite the sentence starting with "Not only": "He is talented and he is also hardworking."', a: 'Not only is he talented, but he is also hardworking.', qType: 'SHORT', options: '' },
  { category: 'GRAMMAR', q: 'Explain when we use the Present Perfect Tense.', a: 'It is used for actions that happened at an unspecified time in the past, actions that started in the past and continue to the present, or past actions that have a result in the present.', qType: 'SHORT', options: '' },
  { category: 'GRAMMAR', q: 'She was tired, ________ she went to bed early.', a: 'A', qType: 'SINGLE', options: 'A. so, B. but, C. because, D. or' },
  { category: 'GRAMMAR', q: 'The children ________ playing in the garden right now.', a: 'B', qType: 'SINGLE', options: 'A. is, B. are, C. was, D. were' },
  { category: 'GRAMMAR', q: 'My father enjoys ________ newspapers in the morning.', a: 'C', qType: 'SINGLE', options: 'A. read, B. to read, C. reading, D. reads' },
  { category: 'GRAMMAR', q: 'This is the ________ expensive watch in the shop.', a: 'D', qType: 'SINGLE', options: 'A. more, B. much, C. highly, D. most' },
  { category: 'GRAMMAR', q: 'If I ________ enough money, I would buy a sports car.', a: 'B', qType: 'SINGLE', options: 'A. have, B. had, C. have had, D. will have' },
  { category: 'GRAMMAR', q: 'You ________ smoke in the hospital. It is strictly forbidden.', a: 'A', qType: 'SINGLE', options: 'A. mustn\'t, B. needn\'t, C. shouldn\'t, D. won\'t' },
  { category: 'GRAMMAR', q: 'The flight was delayed ________ the heavy fog.', a: 'C', qType: 'SINGLE', options: 'A. because, B. as, C. because of, D. since' },
  { category: 'GRAMMAR', q: 'I didn\'t see ________ at the front desk. The office was empty.', a: 'B', qType: 'SINGLE', options: 'A. someone, B. anyone, C. no one, D. everyone' },
  { category: 'GRAMMAR', q: 'He ________ lunch when the phone rang.', a: 'D', qType: 'SINGLE', options: 'A. eats, B. has eaten, C. ate, D. was eating' },
  { category: 'GRAMMAR', q: 'The meeting has been put ________ until next week.', a: 'C', qType: 'SINGLE', options: 'A. on, B. away, C. off, D. down' },
  { category: 'GRAMMAR', q: 'Select the correct sentences using "wish".', a: 'A,C', qType: 'MULTI', options: 'A. I wish I were taller., B. I wish I am taller., C. I wish I had studied harder yesterday., D. I wish I studied harder yesterday.' },
  { category: 'GRAMMAR', q: 'Which of the following words can be adverbs?', a: 'A,B,C', qType: 'MULTI', options: 'A. happily, B. fast, C. well, D. friendly' },
  { category: 'GRAMMAR', q: 'Choose the sentences that use correct punctuation.', a: 'B,D', qType: 'MULTI', options: 'A. Although it rained but we went out., B. Although it rained, we went out., C. He likes apples, bananas, and oranges., D. He likes apples, bananas and oranges.' },
  { category: 'GRAMMAR', q: 'Which verbs are followed by a gerund (V-ing) instead of an infinitive?', a: 'A,B,D', qType: 'MULTI', options: 'A. avoid, B. enjoy, C. decide, D. mind' },
  { category: 'GRAMMAR', q: 'Select all options that correctly complete: "Neither of the plans ________ feasible."', a: 'A,C', qType: 'MULTI', options: 'A. is, B. are, C. seems, D. seem' },
  { category: 'GRAMMAR', q: 'Which of the following can indicate future time?', a: 'A,B,C,D', qType: 'MULTI', options: 'A. will + verb, B. be going to + verb, C. present continuous, D. simple present' },
  { category: 'GRAMMAR', q: 'Choose the correct passive forms.', a: 'A,C', qType: 'MULTI', options: 'A. It is said that he is rich., B. It says that he is rich., C. He is said to be rich., D. He is saying to be rich.' },
  { category: 'GRAMMAR', q: 'Which of the following are reflexive pronouns?', a: 'B,C', qType: 'MULTI', options: 'A. mine, B. myself, C. themselves, D. their' },
  { category: 'GRAMMAR', q: 'Select the correct conditional sentences.', a: 'B,D', qType: 'MULTI', options: 'A. If you heat ice, it melted., B. If you heat ice, it melts., C. If I will see him, I\'ll tell him., D. If I see him, I\'ll tell him.' },
  { category: 'GRAMMAR', q: 'Which of the following nouns have the same singular and plural form?', a: 'A,C,D', qType: 'MULTI', options: 'A. sheep, B. child, C. deer, D. fish' },
  { category: 'GRAMMAR', q: '"Although" and "but" can be used in the same sentence together.', a: 'FALSE', qType: 'TF', options: 'True, False' },
  { category: 'GRAMMAR', q: 'The past tense of "cut" is "cutted".', a: 'FALSE', qType: 'TF', options: 'True, False' },
  { category: 'GRAMMAR', q: '"Mice" is the plural form of "mouse".', a: 'TRUE', qType: 'TF', options: 'True, False' },
  { category: 'GRAMMAR', q: 'An adjective usually modifies a verb.', a: 'FALSE', qType: 'TF', options: 'True, False' },
  { category: 'GRAMMAR', q: '"A pack of wolves" uses the correct collective noun.', a: 'TRUE', qType: 'TF', options: 'True, False' },
  { category: 'GRAMMAR', q: 'Subordinating conjunctions connect two independent clauses.', a: 'FALSE', qType: 'TF', options: 'True, False' },
  { category: 'GRAMMAR', q: '"Luggage" is a countable noun.', a: 'FALSE', qType: 'TF', options: 'True, False' },
  { category: 'GRAMMAR', q: 'The sentence "I have seen him yesterday" is grammatically correct.', a: 'FALSE', qType: 'TF', options: 'True, False' },
  { category: 'GRAMMAR', q: '"None" can take either a singular or a plural verb depending on the context.', a: 'TRUE', qType: 'TF', options: 'True, False' },
  { category: 'GRAMMAR', q: '"Each" and "every" are always followed by plural nouns.', a: 'FALSE', qType: 'TF', options: 'True, False' },
  { category: 'GRAMMAR', q: 'Fill in the blank with a preposition: "He is good ________ playing basketball."', a: 'at', qType: 'FILL', options: '' },
  { category: 'GRAMMAR', q: 'Write the past tense form of the verb "bring".', a: 'brought', qType: 'FILL', options: '' },
  { category: 'GRAMMAR', q: 'Complete the sentence with an article (a/an/the) or leave blank if none: "He is ________ honest man."', a: 'an', qType: 'FILL', options: '' },
  { category: 'GRAMMAR', q: 'Fill in the blank with "do" or "make": "Did you ________ your homework?"', a: 'do', qType: 'FILL', options: '' },
  { category: 'GRAMMAR', q: 'Complete the question tag: "He can\'t swim, ________ he?"', a: 'can', qType: 'FILL', options: '' },
  { category: 'GRAMMAR', q: 'Fill in the blank with the correct form of "study": "She ________ English for ten years before she moved to New York."', a: 'had studied', qType: 'FILL', options: '' },
  { category: 'GRAMMAR', q: 'Complete the sentence: "The older I get, ________ wiser I become."', a: 'the', qType: 'FILL', options: '' },
  { category: 'GRAMMAR', q: 'Write the comparative form of "happy".', a: 'happier', qType: 'FILL', options: '' },
  { category: 'GRAMMAR', q: 'Fill in the blank: "We arrived ________ the airport at 6 PM."', a: 'at', qType: 'FILL', options: '' },
  { category: 'GRAMMAR', q: 'Complete the sentence: "I don\'t know ________ he will come or not."', a: 'whether', qType: 'FILL', options: '' },
  { category: 'GRAMMAR', q: 'Rewrite the sentence using a passive structure: "They are painting the house."', a: 'The house is being painted.', qType: 'SHORT', options: '' },
  { category: 'GRAMMAR', q: 'What is the difference between "its" and "it\'s"?', a: '"Its" is a possessive determiner (belonging to it), while "it\'s" is a contraction of "it is" or "it has".', qType: 'SHORT', options: '' },
  { category: 'GRAMMAR', q: 'Correct the error in this sentence: "I look forward to hear from you."', a: 'I look forward to hearing from you.', qType: 'SHORT', options: '' },
  { category: 'GRAMMAR', q: 'Change this sentence into a question: "He lives in London."', a: 'Does he live in London?', qType: 'SHORT', options: '' },
  { category: 'GRAMMAR', q: 'What is the superlative form of the adjective "far"?', a: 'farthest / furthest', qType: 'SHORT', options: '' },
  { category: 'GRAMMAR', q: 'Combine the sentences using "so... that...": "The coffee was hot. I couldn\'t drink it."', a: 'The coffee was so hot that I couldn\'t drink it.', qType: 'SHORT', options: '' },
  { category: 'GRAMMAR', q: 'Rewrite using a conditional sentence: "I didn\'t study, so I failed the test."', a: 'If I had studied, I wouldn\'t have failed the test.', qType: 'SHORT', options: '' },
  { category: 'GRAMMAR', q: 'What is the plural form of "criterion"?', a: 'criteria', qType: 'SHORT', options: '' },
  { category: 'GRAMMAR', q: 'Change the following into direct speech: She said that she was learning English.', a: 'She said, "I am learning English."', qType: 'SHORT', options: '' },
  { category: 'GRAMMAR', q: 'Explain when to use "who" vs "whom".', a: '"Who" is used as the subject of a verb, while "whom" is used as the object of a verb or preposition.', qType: 'SHORT', options: '' },
]
 
// 儲存隨機篩選後的練習題
const practiceQuestions = ref([])
const QUIZ_COUNT = 10 // 設定每次練習要出現的題數

// 隨機洗牌演算法 (Fisher-Yates Shuffle)
const shuffleArray = (array) => {
  const newArr = [...array]
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]]
  }
  return newArr
}

// 初始化隨機練習題
const initPractice = () => {
  // 1. 先根據選擇的分類 (單字或文法) 以及 題型進行篩選
  let filteredPool = FIXED_PRACTICE_POOL.filter(q => q.category === selectedCategory.value)
  
  if (selectedType.value !== 'ALL') {
    filteredPool = filteredPool.filter(q => q.qType === selectedType.value)
  }
  
  // 2. 從該分類中隨機抽取題目
  const selected = shuffleArray(filteredPool).slice(0, QUIZ_COUNT)
  
  // 確保每次抽出的題目都是全新的狀態，避免複用到上一次練習的答案
  practiceQuestions.value = selected.map(q => ({
    ...q,
    // 根據題型初始化答案格式：多選為陣列，其餘為字串
    studentAnswer: (q.qType === 'MULTI' || (typeof q.a === 'string' && q.a.includes(','))) ? [] : '',
    type: 'PRACTICE', // 補充 type 標記
    isSubmitted: false, // 是否已檢查答案
    isCorrect: null,    // 對錯狀態
    showExplanation: false // 是否顯示解析
  }))
}

// 重置當前所有練習題的作答狀態（不更換題目）
const resetPractice = () => {
  practiceQuestions.value.forEach(item => {
    item.studentAnswer = (item.qType === 'MULTI' || (typeof item.a === 'string' && item.a.includes(','))) ? [] : ''
    item.isSubmitted = false
    item.isCorrect = null
  })
}

// 檢查是否所有練習題都已提交
const allPracticeCompleted = computed(() => {
  return practiceQuestions.value.length > 0 && practiceQuestions.value.every(q => q.isSubmitted)
})

// 計算練習分數與正確率
const practiceResult = computed(() => {
  const total = practiceQuestions.value.length
  const correct = practiceQuestions.value.filter(q => q.isCorrect).length
  return {
    correct,
    total,
    percentage: total > 0 ? Math.round((correct / total) * 100) : 0
  }
})

// 從試算表讀取資料
const fetchCourseData = async () => {
  try {
    fetchError.value = false;
    isLoading.value = true;
    isFetching.value = true;
    const response = await fetch(API_URL, {
      method: 'POST', // 雖然是獲取，但 GAS 通常用 POST 處理 JSON 較方便
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify({
        action: 'getContent',
        courseCode: String(props.courseCode).trim() // 確保是字串且無空白
      })
    })

    if (!response.ok) throw new Error('網路回應不正常');
    const result = await response.json()

    if (result.status === 'success') {
      // 解析結構化內容 (比照教師端邏輯)
      let newUnits = [{ title: '單元一', blocks: [] }];
      if (result.content) {
        try {
          const parsed = JSON.parse(result.content)
          if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].blocks) {
            newUnits = parsed
          } else {
            const oldBlocks = Array.isArray(parsed) ? parsed : [{ type: 'text', value: result.content }]
            newUnits = [{ title: '單元一', blocks: oldBlocks }]
          }
        } catch (e) {
          newUnits = [{ title: '單元一', blocks: [{ type: 'text', value: result.content }] }]
        }
      }
      units.value = newUnits;

      courseData.value = {
        content: (result.content === "" || result.content === null) ? '目前尚無課程內容' : result.content,
        questions: (result.questions || []).map(q => ({
          ...q,
          a: q.a != null ? String(q.a) : '',
          id: q.id != null ? String(q.id) : 'q_' + Date.now(), // 確保每題都有 ID
          studentAnswer: q.qType === 'MULTI' ? [] : '',
          isSubmitted: false
        }))
      }
      initPractice() // 讀取完畢後初始化練習題

      // 新增：檢查該學生先前是否已提交過測驗，以實現紀錄持久化
      await checkPreviousSubmission()
    }
  } catch (err) {
    console.error('無法讀取課程內容', err)
    // 如果是測驗模式，且讀取失敗，可以考慮重置測驗狀態
    if (activeTab.value === 'quiz') {
      quizSubmitted.value = false
    }
    fetchError.value = true
  } finally {
    isLoading.value = false
    isFetching.value = false
  }
}

// 新增：向後端檢查該學生的作答紀錄
const checkPreviousSubmission = async () => {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'getStudentQuizAnswers',
        courseCode: String(props.courseCode).trim(),
        studentName: String(props.studentName).trim()
      })
    })
    const result = await response.json()

    if (result.status === 'success' && result.submissions && result.submissions.length > 0) {
      allSubmissions.value = result.submissions;

      // 學生端只顯示最新一次的作答紀錄
      const latestSubmission = result.submissions[0]; 

      quizDetailedResults.value = latestSubmission.studentAnswers

      // 安全檢查：確保 courseData.value.questions 已存在
      if (courseData.value && courseData.value.questions) {
        // 將作答紀錄同步回課程題目物件，確保 UI (radio/checkbox) 顯示正確
        courseData.value.questions.forEach(q => {
          const record = latestSubmission.studentAnswers.find(r => r.questionId === q.id)
          if (record) {
            if (q.qType === 'MULTI') {
              try {
                q.studentAnswer = record.studentAnswer ? String(record.studentAnswer).split(',') : []
              } catch (e) {
                q.studentAnswer = []
              }
            } else {
              q.studentAnswer = record.studentAnswer
            }
          }
        })
      }

      // 設定分數與總分 (優先使用後端儲存的值，若無則從詳細作答中重新計算)
      quizScore.value = latestSubmission.score !== undefined ? latestSubmission.score : 0
      quizTotalPossible.value = latestSubmission.total !== undefined ? latestSubmission.total : 0
      quizSubmitted.value = true
    }
  } catch (err) {
    console.log('尚未有作答紀錄或檢查失敗', err)
    quizSubmitted.value = false
  }
}

// 監聽頁籤切換：當學生點擊「課程內容」或「課後測驗」時，自動更新資料，確保看到最新發佈的題目
watch(activeTab, (newTab) => {
  selectedHistory.value = null; // 切換頁籤時關閉歷史詳情
  if (newTab === 'content' || newTab === 'quiz' || newTab === 'history' || newTab === 'vocab') { // 每次切換到測驗或歷史頁籤時重新載入題目
    fetchCourseData()
  }
  if (newTab === 'vocab') {
    loadVocabs('TEACHER')
  }
})

const openTranslator = () => {
  window.open('https://translate.google.com/', '_blank')
}

// 判斷該選項是否為學生當時所選
const isOptionChosen = (opt, studentAnswer, qType) => {
  if (!studentAnswer) return false;
  const val = opt.includes('.') ? opt.split('.')[0].trim().toLowerCase() : opt.trim().toLowerCase();
  if (qType === 'MULTI' || Array.isArray(studentAnswer)) {
    const list = Array.isArray(studentAnswer) ? studentAnswer : String(studentAnswer).toLowerCase().split(',').map(s => s.trim());
    return list.includes(val);
  }
  return String(studentAnswer).toLowerCase().trim() === val;
}

// 判斷該選項是否為正確答案
const isOptionCorrect = (opt, correctAnswer) => {
  if (!correctAnswer) return false;
  const val = opt.includes('.') ? opt.split('.')[0].trim().toLowerCase() : opt.trim().toLowerCase();
  const correctList = String(correctAnswer).toLowerCase().split(',').map(s => s.trim());
  return correctList.includes(val);
}

const checkPracticeAnswer = (item) => {
  // 標準化答案處理函式：將 "A. Apple" 轉換為 "A" 進行比對
  const normalize = (val) => {
    if (!val) return '';
    // 轉為小寫並去除前後空白，達成「忽略大小寫」與「忽略空格」
    const s = val.toString().toLowerCase().trim();
    // 處理選擇題標籤格式 (如 "a. apple" -> "a")，正規表達式改用小寫 a-z
    return /^[a-z]\./.test(s) ? s.split('.')[0].trim() : s;
  };

  const studentAnsStr = Array.isArray(item.studentAnswer) ? 
                        item.studentAnswer.filter(Boolean).map(normalize).sort().join(',') : 
                        normalize(item.studentAnswer);
  // 練習題邏輯：本地檢查，不發送至後端
  if (item.type === 'PRACTICE') {
    item.isSubmitted = true;

    if (item.qType === 'FILL' || item.qType === 'SHORT') {
      // 支持備選答案，以斜線分隔 (例如: color/colour)
      const possibleAnswers = String(item.a || '').split('/').map(normalize);
      item.isCorrect = possibleAnswers.includes(studentAnsStr);
    } else {
      // 選擇題與是非題邏輯：維持使用逗號分隔處理多選組合
      const correctAnsStr = String(item.a || '').split(',').map(normalize).sort().join(',');
      item.isCorrect = studentAnsStr === correctAnsStr;
    }
  }
}

// 提交整份測驗
const submitQuiz = async () => {
  const quizQuestions = courseData.value.questions.filter(q => q.type === 'QUIZ')
  if (quizQuestions.length === 0) return

  // 標準化處理
  const normalize = (val) => {
    if (!val) return ''
    const s = val.toString().toLowerCase().trim()
    return /^[a-z]\./.test(s) ? s.split('.')[0].trim() : s
  }

  const answers = quizQuestions.map(q => {
    const studentAnsStr = Array.isArray(q.studentAnswer) ? 
                          q.studentAnswer.filter(Boolean).map(normalize).sort().join(',') : 
                          normalize(q.studentAnswer)
    return {
      questionId: q.id,
      studentAnswer: studentAnsStr
    }
  })

  isLoading.value = true
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'submitQuiz',
        courseCode: props.courseCode,
        studentName: props.studentName,
        answers: answers
      })
    })
    const result = await response.json()
    if (result.status === 'success') {
      quizScore.value = result.score
      quizTotalPossible.value = result.total
      quizDetailedResults.value = result.detailedResults
      quizSubmitted.value = true
      // 提交成功後立即更新歷史紀錄，以便圖表顯示最新進度
      await checkPreviousSubmission()
    }
  } catch (e) {
    console.error('提交測驗失敗', e)
    alert('提交失敗，請檢查網路連線')
  } finally {
    isLoading.value = false
  }
}

// 重新挑戰測驗 (清空狀態與答案)
const retakeQuiz = () => {
  if (!confirm('確定要重新挑戰嗎？您之前的測驗紀錄仍會保留在系統中。')) return
  
  quizSubmitted.value = false
  quizScore.value = null
  quizDetailedResults.value = []
  
  courseData.value.questions.forEach(q => {
    if (q.type === 'QUIZ') {
      q.studentAnswer = q.qType === 'MULTI' ? [] : ''
    }
  })
}

// 點擊圖表點跳轉至歷史詳情
const viewHistoryFromChart = (point) => {
  selectedHistory.value = point.raw
  activeTab.value = 'history'
}

onMounted(fetchCourseData)
</script>

<template>
  <div class="student-panel">
    <div class="tab-menu">
      <button :class="{ active: activeTab === 'content' }" @click="activeTab = 'content'">課程內容</button>
      <button :class="{ active: activeTab === 'vocab' }" @click="activeTab = 'vocab'">單字學習</button>
      <button :class="{ active: activeTab === 'practice' }" @click="activeTab = 'practice'">練習題</button>
      <button :class="{ active: activeTab === 'quiz' }" @click="activeTab = 'quiz'">測驗題</button>
      <button :class="{ active: activeTab === 'history' }" @click="activeTab = 'history'">測驗歷史</button>
      <button @click="openTranslator" class="translate-btn">開啟 Google 翻譯</button>
    </div>

    <div class="dashboard-grid">
      <section v-if="activeTab === 'content'" class="course-content">
        <div class="content-layout">
          <aside class="unit-sidebar">
            <h4>課程單元</h4>
            <div v-if="!isLoading" class="unit-list">
              <button 
                v-for="(unit, idx) in units" :key="idx" 
                :class="{ active: selectedUnitIndex === idx }"
                @click="selectedUnitIndex = idx"
              >
                {{ unit.title || '未命名單元' }}
              </button>
            </div>
            <button @click="fetchCourseData" class="refresh-sidebar-btn" :disabled="isLoading">
              {{ isLoading ? '讀取中...' : '重新整理教材' }}
            </button>
          </aside>

          <div class="unit-detail">
            <div v-if="isLoading" class="loading-state">
              <div class="spinner"></div>
              <p>正在從雲端讀取課程內容...</p>
            </div>
            <div v-else-if="fetchError" class="error-state">
              <p>無法連線至伺服器，請檢查網路或確認課程代碼正確。</p>
              <button @click="fetchCourseData" class="retry-btn-small">再試一次</button>
            </div>
            <div v-else>
              <h3>{{ units[selectedUnitIndex]?.title || '教材內容' }}</h3>
              <div class="content-box">
                <div v-if="parsedContentBlocks.length === 0" class="empty-state">
                  教師尚未在此單元放置任何內容。
                </div>
                <div v-for="(block, index) in parsedContentBlocks" :key="index" class="content-block">
                  <!-- 文字區塊 -->
                  <div v-if="block.type === 'text'" v-html="(block.value || '').replace(/\n/g, '<br>')" :style="{ fontSize: block.fontSize || '20px', textAlign: block.align || 'left' }"></div>
                  
                  <!-- YouTube 區塊 -->
                  <div v-else-if="block.type === 'youtube'" class="video-container">
                    <iframe :src="block.processedUrl" frameborder="0" allowfullscreen 
                      sandbox="allow-scripts allow-same-origin allow-presentation"></iframe>
                  </div>
                  
                  <!-- 文件/簡報/PDF 嵌入區塊 -->
                  <div v-else-if="block.type === 'embed'" class="embed-block">
                    <div class="embed-container">
                      <iframe v-if="block.processedUrl" :src="block.processedUrl" width="100%" height="600px" frameborder="0"></iframe>
                      <div v-else class="embed-fallback">
                        <p>此連結受 Google 安全限制，無法直接在此顯示。</p>
                        <a :href="block.value" target="_blank" class="open-link-btn">在新分頁開啟文件</a>
                      </div>
                    </div>
                    <p v-if="block.processedUrl" class="hint-text">如果內容未顯示，請確認您已登入 Google 帳號。</p>
                  </div>

                  <!-- 直接影片連結區塊 -->
                  <div v-else-if="block.type === 'video'" class="video-container">
                    <video controls width="100%">
                      <source :src="block.value" type="video/mp4">
                      您的瀏覽器不支援影片播放。
                    </video>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section v-if="activeTab === 'vocab'" class="vocab-learning-area">
        <div class="vocab-header-panel">
          <div class="vocab-categories">
            <button v-for="(label, cat) in {TEACHER:'教師發佈', K:'幼稚園', E:'國小', J:'國中', S:'高中', U:'大學'}" 
              :key="cat" :class="{ active: currentVocabCategory === cat }" @click="loadVocabs(cat)">
              {{ label }}
            </button>
          </div>
          <div class="vocab-settings">
            <span>顯示：</span>
            <button :class="{active: vocabShowMode === 'EN'}" @click="vocabShowMode = 'EN'">英文</button>
            <button :class="{active: vocabShowMode === 'CN'}" @click="vocabShowMode = 'CN'">中文</button>
            <button @click="loadVocabs(currentVocabCategory)" class="refresh-btn">🔄 換一組</button>
          </div>
        </div>

        <div v-if="displayVocabs.length === 0" class="empty-state">此分類目前沒有單字</div>
        <div class="vocab-card-grid">
          <div v-for="(v, idx) in displayVocabs" :key="idx" class="flip-card" @click="toggleCard(idx)">
            <div class="flip-card-inner" :class="{ flipped: flippedCards.has(idx) }">
              <!-- 正面 -->
              <div class="flip-card-front">
                <template v-if="vocabShowMode === 'EN'">
                  <div class="v-main-word">{{ v.word }}</div>
                  <div class="v-hint">點擊翻轉</div>
                </template>
                <template v-else>
                  <div class="v-main-word">{{ v.meaning }}</div>
                  <div class="v-hint">點擊翻轉</div>
                </template>
              </div>
              <!-- 反面 -->
              <div class="flip-card-back">
                <template v-if="vocabShowMode === 'EN'">
                  <div class="v-pos-tag">{{ v.pos }}</div>
                  <div class="v-sub-word">{{ v.meaning }}</div>
                </template>
                <template v-else>
                  <div class="v-sub-word">{{ v.word }}</div>
                  <div class="v-pos-tag">{{ v.pos }}</div>
                </template>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section v-if="activeTab === 'practice'" class="practice-area">
        <div class="practice-top-bar">
          <div class="practice-title">
            <h3>練習題</h3>
            <div class="category-selector">
              <button :class="{ active: selectedCategory === 'VOCAB' }" @click="selectedCategory = 'VOCAB'; initPractice()">單字</button>
              <button :class="{ active: selectedCategory === 'GRAMMAR' }" @click="selectedCategory = 'GRAMMAR'; initPractice()">文法</button>
            </div>
          </div>
          <select v-model="selectedType" @change="initPractice" class="type-select">
            <option value="ALL">全部題型</option>
            <option v-for="(label, key) in typeLabels" :key="key" :value="key">{{ label }}</option>
          </select>
        </div>
        <div v-if="practiceQuestions.length === 0">本單元尚無練習題</div>
        <div v-for="(item, index) in practiceQuestions" :key="index" class="q-card">
          <div class="q-type-badge">{{ typeLabels[item.qType] || item.qType }}</div>
          <p><strong>Q:</strong> {{ item.q }}</p>
          
          <div class="answer-wrapper">
            <!-- 是非題 -->
            <div v-if="item.qType === 'TF'">
              <label class="selection-block" :class="{ 
                'selected': item.studentAnswer === 'True',
                'is-correct': item.isSubmitted && isOptionCorrect('True', item.a),
                'is-wrong-selection': item.isSubmitted && item.studentAnswer === 'True' && !isOptionCorrect('True', item.a)
              }">
                <input type="radio" v-model="item.studentAnswer" value="True" :disabled="item.isSubmitted" class="hidden-input"> True
              </label>
              <label class="selection-block" :class="{ 
                'selected': item.studentAnswer === 'False',
                'is-correct': item.isSubmitted && isOptionCorrect('False', item.a),
                'is-wrong-selection': item.isSubmitted && item.studentAnswer === 'False' && !isOptionCorrect('False', item.a)
              }">
                <input type="radio" v-model="item.studentAnswer" value="False" :disabled="item.isSubmitted" class="hidden-input"> False
              </label>
            </div>
            <!-- 單選題 -->
            <div v-else-if="item.qType === 'SINGLE'">
              <div v-for="opt in String(item.options || '').split(',').filter(Boolean)" :key="opt" class="block-option-wrapper">
                <label class="selection-block" :class="{ 
                  'selected': item.studentAnswer === opt,
                  'is-correct': item.isSubmitted && isOptionCorrect(opt, item.a),
                  'is-wrong-selection': item.isSubmitted && item.studentAnswer === opt && !isOptionCorrect(opt, item.a)
                }">
                  <input type="radio" v-model="item.studentAnswer" :value="opt" :disabled="item.isSubmitted" class="hidden-input"> {{ opt }}
                </label>
              </div>
            </div>
            <!-- 多選題 -->
            <div v-else-if="item.qType === 'MULTI'">
              <div v-for="opt in String(item.options || '').split(',').filter(Boolean)" :key="opt" class="block-option-wrapper">
                <label class="selection-block" :class="{ 
                  'selected': item.studentAnswer.includes(opt),
                  'is-correct': item.isSubmitted && isOptionCorrect(opt, item.a),
                  'is-wrong-selection': item.isSubmitted && item.studentAnswer.includes(opt) && !isOptionCorrect(opt, item.a)
                }">
                  <input type="checkbox" v-model="item.studentAnswer" :value="opt" :disabled="item.isSubmitted" class="hidden-input"> {{ opt }}
                </label>
              </div>
            </div>
            <!-- 其他 (填答/填空) -->
            <div v-else>
              <input v-model="item.studentAnswer" placeholder="請在此輸入答案..." :disabled="item.isSubmitted">
            </div>
          </div>

          <div v-if="item.isSubmitted" class="feedback-msg">
            <p v-if="item.isCorrect" class="correct-text">正確！做得好。</p>
            <div v-else class="wrong-text">
              <p>錯誤。正確答案是：<span class="ans-badge">{{ item.a }}</span></p>
              <button v-if="item.explanation" @click="item.showExplanation = !item.showExplanation" class="explain-btn">
                {{ item.showExplanation ? '隱藏解析' : '查看解析' }}
              </button>
              <div v-if="item.showExplanation" class="explanation-box">
                {{ item.explanation }}
              </div>
            </div>
          </div>
          
          <button v-if="!item.isSubmitted" @click="checkPracticeAnswer(item)" class="submit-btn">檢查答案</button>
        </div>

        <!-- 當所有試題完成後才顯示的按鈕 -->
        <div v-if="allPracticeCompleted" class="practice-footer">
          <div class="result-summary">
            <p>練習完成！</p>
            <p>您的得分：<span class="score-text">{{ practiceResult.correct }} / {{ practiceResult.total }}</span></p>
            <p>正確率：<span class="percentage-text">{{ practiceResult.percentage }}%</span></p>
          </div>
          <button @click="initPractice" class="retry-btn">再來一次 (換組新題目)</button>
        </div>
      </section>

      <section v-if="activeTab === 'quiz'" class="quiz-area">
        <h3>測驗題</h3>
        <div v-if="courseData.questions.filter(q => q.type === 'QUIZ').length === 0" class="info-box">本單元尚無測驗題</div>
        
        <div v-else-if="quizSubmitted" class="quiz-results-summary">
          <h4>測驗結果</h4>
          <p>您的分數: <span class="score-text">{{ quizScore }} / {{ quizTotalPossible }}</span></p>
          <p>正確率: <span class="percentage-text">{{ quizTotalPossible > 0 ? Math.round((quizScore / quizTotalPossible) * 100) : 0 }}%</span></p>
          
          <button @click="retakeQuiz" class="retake-btn">重新挑戰 (再次測驗)</button>

          <div class="detailed-quiz-feedback">
            <div v-for="(item, index) in courseData.questions.filter(q => q.type === 'QUIZ')" :key="index" class="q-card">
              <div class="q-type-badge">{{ typeLabels[item.qType] || item.qType }}</div>
              <p><strong>Q:</strong> {{ item.q }}</p>
              
              <div v-if="['SINGLE', 'MULTI', 'TF'].includes(item.qType)" class="options-list-preview">
                <template v-for="opt in String(item.options || '').split(',').filter(Boolean)" :key="opt">
                  <div class="opt-preview-item" 
                       :class="{ 
                         'is-correct': isOptionCorrect(opt, quizDetailedResults.find(r => r.questionId === item.id)?.correctAnswer || item.a),
                         'is-wrong-selection': isOptionChosen(opt, item.studentAnswer, item.qType) && !isOptionCorrect(opt, quizDetailedResults.find(r => r.questionId === item.id)?.correctAnswer || item.a)
                       }">
                    <span>{{ opt }}</span>
                  </div>
                </template>
              </div>
              <div v-else class="answer-wrapper">
                <input :value="item.studentAnswer" disabled class="styled-input">
              </div>

              <!-- 顯示正確答案和對錯 -->
              <div class="feedback-msg">
                <p v-if="quizDetailedResults.find(r => r.questionId === item.id)?.isCorrect" class="correct-text">正確！</p>
                <div v-else class="wrong-text">
                  <p>錯誤。正確答案是：<span class="ans-badge">{{ quizDetailedResults.find(r => r.questionId === item.id)?.correctAnswer || item.a }}</span></p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else>
          <div v-for="(item, index) in courseData.questions.filter(q => q.type === 'QUIZ')" :key="index" class="q-card">
            <div class="q-type-badge">{{ typeLabels[item.qType] || item.qType }}</div>
            <p><strong>Q:</strong> {{ item.q }}</p>
            <div class="answer-wrapper">
              <div v-if="item.qType === 'TF'">
              <label class="selection-block" :class="{ 'selected': item.studentAnswer === 'true' }">
                  <input type="radio" v-model="item.studentAnswer" value="true" class="hidden-input"> True
                </label>
              <label class="selection-block" :class="{ 'selected': item.studentAnswer === 'false' }">
                  <input type="radio" v-model="item.studentAnswer" value="false" class="hidden-input"> False
                </label>
              </div>
              <div v-else-if="item.qType === 'SINGLE'">
                <div v-for="opt in String(item.options || '').split(',').filter(Boolean)" :key="opt">
                  <label class="selection-block" :class="{ 'selected': item.studentAnswer === opt.split('.')[0].trim().toLowerCase() }">
                    <input type="radio" v-model="item.studentAnswer" :value="opt.split('.')[0].trim().toLowerCase()" class="hidden-input"> {{ opt }}
                  </label>
                </div>
              </div>
              <div v-else-if="item.qType === 'MULTI'">
                <div v-for="opt in String(item.options || '').split(',').filter(Boolean)" :key="opt">
                  <label class="selection-block" :class="{ 'selected': item.studentAnswer.includes(opt.split('.')[0].trim().toLowerCase()) }">
                    <input type="checkbox" v-model="item.studentAnswer" :value="opt.split('.')[0].trim().toLowerCase()" class="hidden-input"> {{ opt }}
                  </label>
                </div>
              </div>
              <div v-else-if="item.qType === 'FILL' || item.qType === 'SHORT'">
                <input v-model="item.studentAnswer" placeholder="請在此輸入答案...">
              </div>
              <div v-else>
                <p class="error-text">未知的題型: {{ item.qType }}</p>
              </div>
            </div>
          </div>
          <button @click="submitQuiz" :disabled="isLoading" class="submit-quiz-btn">
            {{ isLoading ? '提交中...' : '提交測驗' }}
          </button>
        </div>
      </section>

      <section v-if="activeTab === 'history'" class="history-area">
        <h3>我的測驗歷史</h3>
        <div v-if="allSubmissions.length === 0" class="info-box">目前尚無測驗紀錄</div>
        
        <div v-else>
          <!-- 進步趨勢圖 -->
          <div v-if="progressChartData && !selectedHistory" class="chart-box">
            <h4>進步趨勢圖 (正確率 %)</h4>
            <div class="svg-wrapper">
              <svg :viewBox="`0 0 ${progressChartData.width} ${progressChartData.height}`" class="progress-svg">
                <!-- 網格背景線 (100%, 50%, 0%) -->
                <line x1="30" y1="30" x2="570" y2="30" stroke="var(--surface-soft)" stroke-dasharray="4" />
                <line x1="30" y1="90" x2="570" y2="90" stroke="var(--surface-soft)" stroke-dasharray="4" />
                <line x1="30" y1="120" x2="570" y2="120" stroke="var(--surface-soft)" />
                
                <!-- 折線 -->
                <polyline
                  fill="none"
                  stroke="var(--primary-color)"
                  stroke-width="4"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  :points="progressChartData.polylinePoints"
                />
                <!-- 數據點 -->
                <circle 
                  v-for="(p, i) in progressChartData.points" 
                  :key="i" 
                  :cx="p.x" 
                  :cy="p.y" 
                  r="6" 
                  fill="var(--surface)" 
                  :stroke="p.score < 60 ? 'var(--accent-warm)' : 'var(--primary-color)'" 
                  stroke-width="3" 
                  class="chart-dot"
                  @mouseenter="hoveredPoint = p"
                  @mouseleave="hoveredPoint = null"
                  @click="viewHistoryFromChart(p)"
                />

                <!-- 懸浮提示框 (Tooltip) -->
                <g v-if="hoveredPoint" :transform="`translate(${hoveredPoint.x}, ${hoveredPoint.y - 10})`" style="pointer-events: none;">
                  <rect x="-25" y="-25" width="50" height="20" rx="6" fill="rgba(30, 41, 59, 0.9)" />
                  <text y="-11" text-anchor="middle" fill="white" font-size="11" font-weight="bold">
                    {{ hoveredPoint.score }}%
                  </text>
                  <path d="M-5,0 L0,5 L5,0 Z" fill="rgba(30, 41, 59, 0.9)" />
                </g>
              </svg>
            </div>
          </div>

          <!-- 歷史紀錄列表 -->
          <div v-if="!selectedHistory" class="history-list">
            <div v-for="(sub, idx) in allSubmissions" :key="idx" class="history-item">
              <div class="history-info">
                <span class="history-date">日期： {{ sub.submissionDate }}</span>
                <span class="history-score">得分: <strong>{{ sub.score }} / {{ sub.total }}</strong></span>
              </div>
              <button @click="selectedHistory = sub" class="view-detail-btn">查看詳情</button>
            </div>
          </div>

          <!-- 特定歷史紀錄詳情 -->
          <div v-else class="history-detail-view">
            <div class="detail-header">
              <button @click="selectedHistory = null" class="back-btn">← 返回列表</button>
              <h4>{{ selectedHistory.submissionDate }} 的測驗詳情</h4>
            </div>
            
            <div class="score-banner">
              分數：{{ selectedHistory.score }} / {{ selectedHistory.total }} ({{ Math.round((selectedHistory.score / selectedHistory.total) * 100) }}%)
            </div>

            <div v-for="(ans, idx) in selectedHistory.studentAnswers" :key="idx" class="q-card">
              <div class="q-type-badge">{{ typeLabels[ans.qType] || ans.qType }}</div>
              <p><strong>Q:</strong> {{ ans.q }}</p>
              
              <div v-if="['SINGLE', 'MULTI', 'TF'].includes(ans.qType) && ans.options" class="options-list-preview">
                <template v-for="opt in String(ans.options).split(',').filter(Boolean)" :key="opt">
                  <div class="opt-preview-item" 
                       :class="{ 
                         'is-correct': isOptionCorrect(opt, ans.correctAnswer),
                         'is-wrong-selection': isOptionChosen(opt, ans.studentAnswer, ans.qType) && !isOptionCorrect(opt, ans.correctAnswer)
                       }">
                    <span>{{ opt }}</span>
                  </div>
                </template>
              </div>

              <div class="feedback-msg">
                <p v-if="ans.isCorrect" class="correct-text">正確</p>
                <div v-else class="wrong-text">
                  <p>錯誤</p>
                  <div class="ans-hint">當初回答：<span class="ans-badge student">{{ ans.studentAnswer || '(未作答)' }}</span></div>
                  <div class="ans-hint">正確答案：<span class="ans-badge">{{ ans.correctAnswer }}</span></div>
                </div>
              </div>
            </div>
          </div>
            </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.student-panel {
  background: transparent; /* 移除組件背景，顯示 body 的漸層 */
  padding: 0 !important; /* 徹底移除外層邊距 */
  border-radius: 0;
  min-height: 100vh;
  width: 100%;
}
.translate-btn {
  margin-right: 20px;
  background: var(--accent-color);
  color: var(--text-main);
  border: none;
  padding: 14px;
  border-radius: var(--border-radius-sm);
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
  box-shadow: 0 4px 6px rgba(0,0,0,0.05);
  transition: all 0.2s ease;
}
.translate-btn:hover {
  transform: scale(1.05);
}
.tab-menu {
  display: flex;
  gap: 10px;
  margin-bottom: 25px;
  padding: 0;
}
.tab-menu button {
  flex: 1;
  padding: 14px;
  cursor: pointer;
  border: none;
  background: var(--surface);
  border-radius: var(--border-radius-sm);
  font-weight: 600;
  color: var(--text-muted);
  box-shadow: 0 4px 15px rgba(0,0,0,0.03);
  transition: var(--transition);
}
.tab-menu button.active {
  background: var(--primary-color);
  color: white;
  transform: translateY(-2px);
}
.tab-menu button:hover { transform: scale(1.05); }
.tab-menu button.active:hover { transform: translateY(-2px) scale(1.05); }
.dashboard-grid { padding: 0; }
.practice-top-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 25px;
  gap: 15px;
  background: var(--surface);
  padding: 15px;
  border-radius: var(--border-radius-lg);
}
.practice-title {
  display: flex;
  align-items: center;
  gap: 15px;
}
.type-select {
  padding: 8px 32px 8px 12px;
  border-radius: var(--border-radius-sm);
  border: 1px solid var(--border);
  background-color: var(--surface-soft);
  font-size: 0.9em;
  font-weight: 600;
  color: var(--text-main);
  cursor: pointer;
  appearance: none;
  /* 自定義下拉箭頭圖示 (SVG) */
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%232f3a48' viewBox='0 0 16 16'%3E%3Cpath d='M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  transition: all 0.2s ease;
}
.type-select:hover {
  border-color: var(--text-main);
}
.type-select:focus {
  outline: none;
  border-color: var(--text-main);
  box-shadow: 0 0 0 3px rgba(47, 58, 72, 0.1);
}
.category-selector {
  display: flex;
  gap: 10px;
}
.category-selector button {
  min-width: 80px;
  padding: 6px 15px;
  font-size: 0.85em;
  background: var(--surface-soft);
  border-radius: var(--border-radius-sm);
  border: 1px solid var(--border);
  font-weight: 600;
  cursor: pointer;
  transition: 0.2s;
}
.category-selector button:hover { transform: scale(1.05); border-color: var(--text-main); }
.category-selector button.active {
  background: var(--primary-color);
  color: white;
  border-color: var(--primary-color);
}
.practice-header {
  margin-bottom: 15px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.reset-btn {
  background: var(--danger-soft);
  border: 1px solid var(--danger-soft);
  padding: 6px 12px;
  color: var(--text-main);
  border-radius: var(--border-radius-sm);
  cursor: pointer;
  font-size: 0.9em;
}
.refresh-btn {
  background: var(--surface-soft);
  border: 1px solid var(--border);
  padding: 6px 12px;
  border-radius: var(--border-radius-sm);
  cursor: pointer;
  font-size: 0.9em;
}
.practice-footer {
  margin-top: 30px;
  padding: 20px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  border-top: 2px dashed var(--border);
}
.result-summary {
  text-align: center;
  background: var(--surface);
  padding: 15px 30px;
  border-radius: var(--border-radius-sm);
  box-shadow: 0 2px 8px rgba(0,0,0,0.05);
}
.result-summary p { margin: 5px 0; color: var(--text-muted); font-size: 1.1em; }
.score-text { color: var(--text-main); font-weight: 800; }
.percentage-text { 
  color: var(--primary-color); 
  font-size: 1.5em; 
  font-weight: 800; 
}
.retry-btn {
  background: var(--primary-color);
  color: white;
  border: none;
  padding: 12px 60px;
  border-radius: var(--border-radius-sm);
  font-size: 1.1em;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 8px 20px rgba(153, 193, 222, 0.2);
  transition: transform 0.2s;
}
.retry-btn:hover {
  transform: scale(1.05);
}
.quiz-area,
.history-area {
  background: var(--surface);
  padding: 30px;
  border-radius: var(--border-radius-lg);
  box-shadow: 0 10px 25px rgba(0,0,0,0.05);
}
.quiz-area h3,
.history-area h3 {
  margin-top: 0;
}
.unit-detail {
  background: var(--surface);
  padding: 30px;
  border-radius: var(--border-radius-lg);
  box-shadow: 0 10px 25px rgba(0,0,0,0.05);
}
.content-box {
  background: transparent;
  padding: 0;
  border-radius: 0; 
  min-height: 200px;
  box-shadow: none;
  line-height: 1.6;
  width: 100%;
}
.content-layout { display: grid; grid-template-columns: 200px 1fr; gap: 20px; }
.unit-sidebar { background: var(--surface); padding: 15px; border-radius: var(--border-radius-sm); box-shadow: 0 2px 8px rgba(0,0,0,0.05); height: fit-content; }
.unit-sidebar h4 { margin-top: 0; margin-bottom: 15px; color: var(--text-muted); font-size: 0.9em; }
.unit-list { display: flex; flex-direction: column; gap: 8px; }
.unit-list button { text-align: left; padding: 10px; border: none; background: var(--surface-soft); border-radius: var(--border-radius-sm); cursor: pointer; transition: 0.2s; font-size: 0.9em; }
.unit-list button:hover { background: var(--surface-muted); transform: scale(1.02); }
.refresh-sidebar-btn {
  margin-top: 20px;
  width: 100%;
  padding: 8px;
  background: var(--surface-muted);
  border: 1px solid var(--border);
  border-radius: var(--border-radius-sm);
  cursor: pointer;
  font-size: 0.8em;
  color: var(--text-muted);
  transition: 0.2s;
}
.refresh-sidebar-btn:hover { transform: scale(1.05); background: var(--surface-soft); }
.unit-list button:hover { background: var(--surface-muted); }
.unit-list button.active { background: var(--primary-strong); color: var(--surface); font-weight: bold; }

@media (max-width: 768px) {
  .student-panel { padding: 12px 0; } /* 移除兩側留白，僅保留上下 */
  .content-layout { grid-template-columns: 1fr; gap: 15px; }
  .content-box { padding: 10px; } /* 減少內容框邊距，給 PDF 更多空間 */
  .embed-container iframe {
    height: 450px; /* 手機端稍微降低高度以符合螢幕比例 */
  }
}

.loading-state, .error-state, .empty-state {
  text-align: center;
  padding: 50px 20px;
  color: var(--text-muted);
}
.spinner {
  width: 40px;
  height: 40px;
  margin: 0 auto 20px;
  border: 4px solid rgba(240, 239, 235, 0.8);
  border-top: 4px solid var(--accent-color);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}
@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
.retry-btn-small {
  margin-top: 10px;
  padding: 6px 15px;
  background: var(--primary-color);
  color: white;
  border: none;
  border-radius: var(--border-radius-sm);
  cursor: pointer;
  transition: 0.2s;
}
.retry-btn-small:hover { transform: scale(1.05); background: var(--primary-strong); }

.content-block {
  margin-bottom: 25px;
}
.video-container {
  position: relative;
  padding-bottom: 56.25%; /* 16:9 Aspect Ratio */
  height: 0;
  overflow: hidden;
  border-radius: var(--border-radius-sm);
  background: var(--surface-muted);
}
.video-container iframe {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}
.embed-container {
  width: 100%;
  overflow: hidden;
}
.embed-container iframe {
  width: 100%;
  display: block;
  border: 1px solid var(--border);
  border-radius: var(--border-radius-sm);
}
.embed-fallback {
  margin-top: 15px;
  padding: 15px;
  background: var(--danger-soft);
  border: 1px solid var(--accent-warm);
  border-radius: var(--border-radius-sm);
  text-align: center;
}
.embed-fallback p {
  font-size: 0.85em;
  color: var(--text-main);
  margin-bottom: 10px;
}
.open-link-btn {
  display: inline-block;
  padding: 8px 20px;
  background: var(--primary-color);
  color: var(--surface);
  text-decoration: none;
  border-radius: var(--border-radius-sm);
  font-weight: 600;
  font-size: 0.9em;
}
.q-card {
  background: var(--surface);
  padding: 30px;
  margin-top: 20px;
  border-radius: var(--border-radius-lg);
  border: 1px solid var(--border);
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05);
  text-align: left; /* 確保題目與選項皆置左 */
  transition: transform 0.2s ease;
}
.answer-wrapper {
  margin: 15px 0;
}
.block-option-wrapper { margin-bottom: 10px; }
.selection-block {
  display: block;
  width: 100%;
  padding: 14px 18px;
  margin-bottom: 10px;
  background: var(--surface);
  border: 1px solid #bfd7e8;
  border-radius: var(--border-radius-lg);
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
  font-weight: 600;
  color: var(--text-main);
}
.selection-block:last-child {
  margin-bottom: 0;
}
.selection-block:hover {
  border-color: var(--primary-color);
  background: #eef6ff;
}
.selection-block.selected {
  background: #e7f0ff;
  border-color: var(--primary-color);
  border-width: 2px;
}
.selection-block.is-correct {
  background: #e7f0ff;
  border-color: var(--primary-color);
  border-width: 2px;
}
.selection-block.is-wrong-selection {
  background: var(--surface);
  border-color: var(--primary-color);
  border-width: 2px;
}
.hidden-input { display: none; }

.answer-wrapper input {
  width: 100%;
  padding: 14px 20px;
  border-radius: var(--border-radius-lg);
  border: 1px solid #bfd7e8;
  background: var(--surface);
  box-sizing: border-box;
  outline: none;
  font-size: 1em;
  font-weight: 600;
  color: var(--text-main);
  transition: var(--transition);
}
.submit-btn {
  background: var(--accent-color);
  color: var(--text-main);
  border: none;
  padding: 8px 16px;
  border-radius: var(--border-radius-sm);
  cursor: pointer;
  transition: 0.2s;
}
.submit-btn:hover { transform: scale(1.05); background: var(--primary-strong); }
.feedback-msg {
  margin: 10px 0;
  padding: 10px;
  border-radius: var(--border-radius-sm);
  background: rgba(240, 239, 235, 0.6);
  color: var(--text-main);
}
.correct-text {
  color: var(--accent-color);
  font-weight: bold;
  margin: 0;
}
.wrong-text {
  color: var(--danger-color);
  font-weight: bold;
  margin: 0;
}
.ans-badge {
  background: var(--primary-strong);
  padding: 2px 8px;
  border-radius: var(--border-radius-sm);
  color: var(--surface);
}
.q-type-badge {
  display: inline-block;
  font-size: 0.75em;
  padding: 2px 10px;
  background: var(--surface-soft);
  color: var(--text-main);
  border-radius: var(--border-radius-sm);
  margin-bottom: 10px;
  font-weight: 700;
  border: 1px solid var(--border-soft);
}
.options-list-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 15px 0;
}
.opt-preview-item {
  display: flex;
  align-items: center;
  padding: 14px 16px;
  background: var(--surface);
  border-radius: var(--border-radius-lg);
  border: 1px solid #bfd7e8;
  color: var(--text-main);
  transition: background 0.18s ease, border-color 0.18s ease, box-shadow 0.12s ease;
}
.opt-preview-item.is-correct {
  background: #e7f0ff;
  border-color: var(--primary-color);
  border-width: 2px;
  font-weight: bold;
}
.opt-preview-item.is-wrong-selection {
  background: var(--surface);
  border-color: var(--primary-color);
  border-width: 2px;
}
.opt-preview-item .preview-input { display: none; }
.retake-btn {
  background: var(--text-main);
  color: var(--surface);
  border: none;
  padding: 10px 20px;
  border-radius: var(--border-radius-sm);
  font-weight: bold;
  cursor: pointer;
  margin: 15px 0;
  transition: 0.2s;
}
.retake-btn:hover { transform: scale(1.05); background: var(--primary-strong); }
.history-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.history-item {
  background: var(--surface);
  border: 1px solid var(--border);
  padding: 15px;
  border-radius: var(--border-radius-sm);
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 2px 8px rgba(0,0,0,0.05);
}
.history-info {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.history-date { color: var(--text-muted); font-size: 0.9em; }
.history-score { color: var(--text-main); }
.view-detail-btn {
  background: var(--surface-muted);
  color: var(--text-main);
  border: 1px solid var(--border);
  padding: 8px 16px;
  border-radius: var(--border-radius-sm);
  cursor: pointer;
  font-weight: 600;
  transition: 0.2s;
}
.view-detail-btn:hover { transform: scale(1.05); background: var(--surface-soft); }
.detail-header {
  display: flex;
  align-items: center;
  gap: 15px;
  margin-bottom: 20px;
}
.back-btn {
  background: none; border: none; color: var(--accent-color); font-weight: bold; cursor: pointer;
  transition: 0.2s;
}
.back-btn:hover { transform: scale(1.1); }
.score-banner {
  background: var(--surface);
  color: var(--text-main);
  padding: 15px;
  border-radius: var(--border-radius-sm);
  text-align: center;
  font-weight: bold;
  margin-bottom: 20px;
  border: 1px solid var(--border);
}
.score-banner strong {
  color: var(--primary-color);
}
.ans-badge.student {
  background: var(--danger-soft); color: var(--text-main);
}
.ans-hint {
  font-size: 0.9em;
  margin-top: 5px;
  color: var(--text-muted);
}
.styled-input {
  width: 100%;
  padding: 12px;
  border-radius: var(--border-radius-sm);
  border: 1px solid var(--border);
  box-sizing: border-box;
}
.submit-quiz-btn {
  width: 100%;
  padding: 16px;
  background: var(--text-main);
  color: var(--surface);
  border: none;
  border-radius: var(--border-radius-sm);
  font-weight: bold;
  cursor: pointer;
  margin-top: 20px;
  transition: 0.2s;
}
.chart-box {
  background: var(--surface);
  padding: 20px;
  border-radius: var(--border-radius-lg);
  margin-bottom: 25px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.05);
  border: 1px solid var(--border);
}
.chart-box h4 { margin-top: 0; color: var(--text-main); font-size: 0.95em; }
.svg-wrapper { width: 100%; overflow: hidden; }

.progress-svg {
  width: 100%;
  height: auto;
  display: block;
}
.chart-dot {
  cursor: pointer;
  transition: r 0.2s ease, stroke-width 0.2s ease;
}
.chart-dot:hover { r: 7; stroke-width: 3; }

.vocab-header-panel { background: var(--surface); padding: 20px; border-radius: var(--border-radius-lg); margin-bottom: 20px; }
.vocab-categories { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 15px; }
.vocab-categories button { padding: 8px 15px; border-radius: var(--border-radius-sm); border: 1px solid var(--border); background: #fff; cursor: pointer; }
.vocab-categories button.active { background: var(--primary-color); color: white; border-color: var(--primary-color); }
.vocab-settings { display: flex; align-items: center; gap: 10px; font-size: 0.9em; }
.vocab-settings button { padding: 5px 12px; border-radius: var(--border-radius-sm); border: 1px solid var(--border); background: #fff; cursor: pointer; }
.vocab-settings button.active { background: var(--text-main); color: #fff; }

.vocab-card-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
.flip-card { height: 180px; perspective: 1000px; cursor: pointer; }
.flip-card-inner { 
  position: relative; width: 100%; height: 100%; text-align: center; 
  transition: transform 0.6s; transform-style: preserve-3d; 
}
.flip-card-inner.flipped { transform: rotateY(180deg); }
.flip-card-front, .flip-card-back { 
  position: absolute; width: 100%; height: 100%; -webkit-backface-visibility: hidden; backface-visibility: hidden; 
  border-radius: var(--border-radius-lg); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 15px;
  box-shadow: 0 4px 8px rgba(0,0,0,0.1);
}
.flip-card-front { background-color: var(--surface); border: 1px solid var(--border); color: var(--text-main); }
.flip-card-back { background-color: var(--primary-color); color: white; transform: rotateY(180deg); }
.v-main-word { font-size: 1.4em; font-weight: 800; margin-bottom: 10px; }
.v-sub-word { font-size: 1.2em; font-weight: 700; margin-bottom: 5px; }
.v-pos-tag { font-style: italic; font-size: 0.9em; opacity: 0.9; }
.v-hint { font-size: 0.7em; color: var(--text-muted); margin-top: 10px; }

@media (max-width: 992px) { .vocab-card-grid { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 600px) { .vocab-card-grid { grid-template-columns: repeat(2, 1fr); } }
</style>