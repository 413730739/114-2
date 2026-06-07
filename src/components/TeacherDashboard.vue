<script setup>
import { ref, onMounted, watch, computed, nextTick } from 'vue'

const props = defineProps(['courseCode'])
const API_URL = 'https://script.google.com/macros/s/AKfycby3pSgIy6Gs5EK3SxWTg-o1SCzDHSVQORDGrDI03Xa7wqCQcTmxiLyF2leq1_SQ4ClM/exec'

// 確保 units 與 activeUnitIndex 在最上方正確定義並初始化
const units = ref([{ title: '單元一', blocks: [{ type: 'text', value: '', fontSize: '20px', align: 'left' }] }])
const activeUnitIndex = ref(0)
const questionsList = ref([])
const isFetching = ref(false)
const isSaving = ref(false)
const activeTab = ref('content') // content, vocab, quiz, grades
const isPreviewOpen = ref(false)

const vocabList = ref([])
const bulkVocabs = ref([{ word: '', pos: 'n.', meaning: '', id: null }])
const bulkPanelRef = ref(null)
const isEditingBulk = computed(() => bulkVocabs.value.some(item => item.id))

const normalizeBulkVocab = (item = {}) => ({
  word: String(item.word || ''),
  pos: String(item.pos || 'n.'),
  meaning: String(item.meaning || ''),
  id: item.id || null
})

const resetBulkVocabs = () => {
  bulkVocabs.value = [normalizeBulkVocab()]
}

const cancelBulkEdit = () => {
  resetBulkVocabs()
}

const fontSizeOptions = [
  { label: '12', value: '12px' },
  { label: '20', value: '20px' },
  { label: '25', value: '25px' },
  { label: '30', value: '30px' },
  { label: '50', value: '50px' }
]

// 預覽邏輯：模擬學生端的內容處理與網址轉換
const previewBlocks = computed(() => {
  if (!units.value || units.value.length === 0) return []
  const targetUnit = units.value[activeUnitIndex.value] || units.value[0]
  if (!targetUnit || !targetUnit.blocks) return []
  
  return targetUnit.blocks.map(block => {
    let processedUrl = '#'
    // 安全處理：確保 value 是字串再執行 trim
    let rawValue = String(block.value || '').trim()

    if (rawValue.startsWith('data:') || block.type === 'video') {
      processedUrl = rawValue
    } else {
      // YouTube 連結處理
      if (block.type === 'youtube') {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
        const match = rawValue.match(regExp);
        processedUrl = (match && match[2] && match[2].length === 11)
          ? `https://www.youtube.com/embed/${match[2]}` 
          : rawValue
      } else {
        if (rawValue.startsWith('<iframe')) {
          const srcMatch = rawValue.match(/src=["']([^"']+)["']/)
          if (srcMatch) rawValue = srcMatch[1]
        }

        // Google Drive / Docs / Slides 連結處理
        if (block.type === 'embed' && rawValue.includes('google.com')) {
          let url = rawValue
          if (url.includes('drive.google.com/open?id=')) {
            const id = url.split('id=')[1].split('&')[0];
            processedUrl = `https://drive.google.com/file/d/${id}/preview`;
          } else if (url.includes('/d/e/')) {
            processedUrl = url
          } else if (url.includes('drive.google.com/file/d/')) {
            processedUrl = url.replace(/\/view.*$/, '').replace(/\/edit.*$/, '').replace(/\/$/, '') + '/preview'
          } else {
            url = url.split('?')[0].split('#')[0]
            if (url.includes('/presentation/d/')) {
              processedUrl = url.replace(/\/edit.*$/, '').replace(/\/view.*$/, '').replace(/\/$/, '') + '/embed'
            } else if (url.includes('/spreadsheets/d/')) {
              processedUrl = url.replace(/\/edit.*$/, '').replace(/\/view.*$/, '').replace(/\/$/, '') + '/preview?widget=false&headers=false&chrome=false'
            } else if (url.includes('/document/d/') || url.includes('/file/d/')) {
              processedUrl = url.replace(/\/edit.*$/, '').replace(/\/view.*$/, '').replace(/\/$/, '') + '/preview'
            } else {
              processedUrl = url
            }
          }
        } else {
          processedUrl = rawValue
        }
      }
    }
    return { ...block, processedUrl }
  })
})

const newQuestion = ref({ 
  q: '', 
  a: null, // 單選題時儲存索引(Number)，是非/填充/簡答時儲存字串
  qType: 'SINGLE', 
  type: 'QUIZ', 
  options: ['', ''], // 預設提供兩個空選項
  multiIndices: [], // 儲存多選題選中的索引陣列
  points: 10 // 新增：預設每題 10 分
})

const fetchVocabs = async () => {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'getVocab',
        courseCode: String(props.courseCode).trim()
      })
    })
    const result = await response.json()
    if (result.status === 'success') {
      // 過濾掉無效或空資料，確保渲染安全
      vocabList.value = (result.vocabs || []).filter(v => v && v.word)
    }
  } catch (e) { console.error("無法獲取單字", e) }
}

const addBulkVocabEntry = () => {
  bulkVocabs.value.push(normalizeBulkVocab())
}

const removeBulkVocabEntry = (index) => {
  if (bulkVocabs.value.length <= 1) return
  bulkVocabs.value.splice(index, 1)
}

const publishBulkVocabs = async () => {
  // 安全檢查：確保 word 和 meaning 存在且為字串再執行 trim，防止 "trim is not a function" 錯誤
  const isInvalid = bulkVocabs.value.some(item => 
    !item || !item.word || typeof item.word !== 'string' || !String(item.word).trim() ||
    !item.meaning || typeof item.meaning !== 'string' || !String(item.meaning).trim()
  )
  if (isInvalid) return alert('請確保所有批次單字都已填寫完整')

  isSaving.value = true
  try {
    const results = []
    for (let i = 0; i < bulkVocabs.value.length; i++) {
      const item = bulkVocabs.value[i]
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'uploadVocab',
          courseCode: props.courseCode,
          vocab: {
            word: String(item.word).trim(),
            pos: item.pos,
            meaning: String(item.meaning).trim(),
            id: item.id || ('v_' + Date.now() + '_' + i)
          }
        })
      })
      const result = await response.json()
      results.push(result)
      if (result.status !== 'success') {
        throw new Error(result.message || `第 ${i + 1} 筆單字發佈失敗`)
      }
    }

    alert('批次單字已全部發佈！')
    bulkVocabs.value = [{ word: '', pos: 'n.', meaning: '', id: null }]
    fetchVocabs()
  } catch (e) {
    alert('批次發佈失敗：' + e.message)
  } finally {
    isSaving.value = false
  }
}

const editVocab = (vocab) => {
  activeTab.value = 'vocab'
  bulkVocabs.value = [normalizeBulkVocab(vocab)]
  nextTick(() => {
    bulkPanelRef.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
}

const deleteVocab = async (id) => {
  if (!confirm('確定刪除此單字？')) return
  isSaving.value = true
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'deleteVocab',
        courseCode: props.courseCode,
        id: id
      })
    })
    const result = await response.json()
    if (result.status === 'success') {
      fetchVocabs()
    }
  } catch (e) { alert('刪除失敗') }
  finally { isSaving.value = false }
}

const editingId = ref(null) // 追蹤目前正在編輯的題目 ID

// 當使用者手動切換題型時，清空已選答案
const handleTypeChange = () => {
  newQuestion.value.a = (newQuestion.value.qType === 'SINGLE') ? null : ''
  newQuestion.value.multiIndices = []
  if (newQuestion.value.qType === 'TF') newQuestion.value.options = ['True', 'False']
  else if (['SINGLE', 'MULTI'].includes(newQuestion.value.qType)) newQuestion.value.options = ['', '']
}

// 新增選項
const addOption = () => {
  newQuestion.value.options.push('')
}

// 移除選項
const removeOption = (index) => {
  if (newQuestion.value.options.length <= 1) return alert('至少需要一個選項')
  newQuestion.value.options.splice(index, 1)
  newQuestion.value.a = null // 移除選項後清空選擇狀態避免索引錯位
  newQuestion.value.multiIndices = []
}

// 題型翻譯對照表
const typeLabels = {
  SINGLE: '單選題',
  MULTI: '多選題',
  TF: '是非題',
  FILL: '填充題',
  SHORT: '簡答題'
}
const gradesList = ref([]) // 儲存所有學生的成績
const selectedStudentGrade = ref(null) // 儲存選中學生的詳細作答情況

// 獲取課程題目清單
const normalizeUnits = (rawUnits) => {
  if (!Array.isArray(rawUnits)) {
    return [{ title: '單元一', blocks: [{ type: 'text', value: String(rawUnits || ''), fontSize: '20px', align: 'left' }] }]
  }

  const normalizeBlock = (block) => {
    if (!block || typeof block !== 'object') return { type: 'text', value: String(block || ''), fontSize: '20px', align: 'left' }
    return block.type === 'text'
      ? { ...block, value: String(block.value || ''), fontSize: block.fontSize || '20px', align: block.align || 'left' }
      : { ...block, value: String(block.value || '') }
  }

  return rawUnits.map((unit, idx) => ({
    title: unit.title || `單元 ${idx + 1}`,
    blocks: Array.isArray(unit.blocks)
      ? unit.blocks.map(normalizeBlock)
      : [normalizeBlock({ type: 'text', value: String(unit.value || unit.blocks || '') })]
  }))
}

const fetchQuestions = async () => {
  if (isFetching.value) return
  try {
    isFetching.value = true
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'getContent',
        courseCode: String(props.courseCode).trim()
      })
    })
    const result = await response.json()
    console.log("GAS 獲取課程回應:", result) // 加入日誌檢查 GAS 資料
    if (result.status === 'success') {
      questionsList.value = (result.questions || []).map(q => ({
        ...q,
        q: q.q != null ? String(q.q) : '',
        a: q.a != null ? String(q.a) : '',
        options: q.options != null ? String(q.options) : ''
      }))
      
      // 解析結構化內容
      if (result.content) {
        try {
          const parsed = JSON.parse(result.content)
          // 檢查是否為多單元格式
          if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].blocks) {
            units.value = normalizeUnits(parsed)
          } else {
            // 舊資料相容處理
            const oldBlocks = Array.isArray(parsed) ? parsed : [{ type: 'text', value: result.content }]
            units.value = normalizeUnits([{ title: '單元一', blocks: oldBlocks }])
          }
        } catch (e) {
          units.value = normalizeUnits([{ title: '單元一', blocks: [{ type: 'text', value: result.content }] }])
        }
      }
    }
  } catch (e) {
    console.error("無法獲取題目", e)
  }
}

// 獲取所有學生的成績
const fetchGrades = async () => {
  selectedStudentGrade.value = null; // 清空選中的學生詳細資料
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'getGrades', // 新的 GAS action
        courseCode: String(props.courseCode).trim()
      })
    })
    const result = await response.json()
    if (result.status === 'success') {
      gradesList.value = result.grades || []
    }
  } catch (e) {
    console.error("無法獲取成績列表", e)
    alert('無法獲取成績列表')
  }
}

const uploadContent = async (type) => {
  isSaving.value = true
  try {
    const payload = {
      action: 'uploadContent',
      courseCode: props.courseCode,
    }

    if (type === 'TEXT') {
      // 儲存整個單元陣列結構
      payload.content = JSON.stringify(units.value)
    } else {
      // 驗證與資料轉換
      const q = newQuestion.value
      let finalAnswer = ''

      // 處理單選題：將索引轉回對應的文字內容
      if (q.qType === 'SINGLE') {
        if (q.a === null || q.a === '') return alert('請勾選一個正確答案')
        finalAnswer = q.options[q.a]
        if (!finalAnswer || finalAnswer.trim() === '') return alert('選中的正確答案內容不能為空')
      } else {
        finalAnswer = q.a
      }

      // 處理多選題：驗證至少選擇兩項並合併答案
      if (q.qType === 'MULTI') {
        if (q.multiIndices.length < 2) return alert('多選題請至少勾選兩個正確答案')
        // 將索引陣列轉為文字陣列，增加安全性檢查避免 trim 報錯
        const answers = q.multiIndices
          .map(i => q.options[i])
          .filter(text => text && typeof text === 'string' && text.trim() !== '')
          
        if (answers.length < 2) return alert('多選題請確保至少有兩個選中的選項填寫了內容')
        finalAnswer = answers.join(',')
      }

      // 如果是是非或選擇題，處理選項
      let finalOptions = ''
      if (['SINGLE', 'MULTI', 'TF'].includes(q.qType)) {
        if (q.qType === 'TF') {
          finalOptions = 'True,False'
        } else {
          finalOptions = q.options.filter(opt => opt.trim() !== '').join(',')
        }
      }

      if (!String(q.q || '').trim() || !finalAnswer) return alert('請完整填寫題目與正確答案')

      // 如果是編輯模式，使用 updateQuestion 指令
      if (editingId.value) {
        payload.action = 'updateQuestion'
        payload.question = {
          id: editingId.value,
          q: q.q,
          a: finalAnswer,
          qType: q.qType,
          options: finalOptions,
          points: q.points
        }
      } else {
        payload.question = { 
        q: q.q,
        a: finalAnswer,
        qType: q.qType,
        options: finalOptions,
        type: type,
        id: 'q_' + Date.now(),
        points: q.points // 傳送配分到後端
      }
      }
    }

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    })
    
    const result = await response.json()
    console.log("GAS 上傳回應:", result) // 加入日誌檢查上傳結果
    if (result.status === 'success') {
      alert(editingId.value ? '題目已成功更新！' : '內容已成功發佈！')
    } else {
      throw new Error(result.message || '後端同步失敗')
    }

    editingId.value = null // 清除編輯狀態
    if (type !== 'TEXT') {
      newQuestion.value = { 
        q: '', 
        a: null, 
        qType: 'SINGLE', 
        type: 'QUIZ',
        options: ['', ''], 
        multiIndices: [] 
      }
      fetchQuestions() // 刷新題目列表，無論新增或編輯
    }
  } catch (e) {
    console.error('上傳詳情錯誤:', e)
    alert('發佈失敗：' + e.message)
  } finally {
    isSaving.value = false
  }
}

// 處理檔案上傳並轉為 Base64
const handleFileUpload = (event, blockIndex) => {
  const file = event.target.files[0]
  if (!file) return

  // 限制檔案大小 (例如 2MB)，避免 Base64 太大導致 GAS 儲存失敗
  if (file.size > 2 * 1024 * 1024) {
    alert('檔案太大囉！請將檔案壓縮在 2MB 以內（建議簡報可轉存為 PDF 後再上傳）。')
    return
  }

  const reader = new FileReader()
  reader.onload = (e) => {
    units.value[activeUnitIndex.value].blocks[blockIndex].value = e.target.result
  }
  reader.readAsDataURL(file)
}

// 管理內容區塊的函式
const addUnit = () => {
  units.value.push({ title: `新單元 ${units.value.length + 1}`, blocks: [{ type: 'text', value: '' }], fontSize: '1.05em' })
  activeUnitIndex.value = units.value.length - 1
}

const removeUnit = (index) => {
  if (units.value.length <= 1) return alert('至少需保留一個單元')
  if (confirm(`確定要刪除「${units.value[index].title}」嗎？內部所有教材將會遺失。`)) {
    units.value.splice(index, 1)
    if (activeUnitIndex.value >= units.value.length) activeUnitIndex.value = units.value.length - 1
  }
}

const addContentBlock = (type) => {
  units.value[activeUnitIndex.value].blocks.push(
    type === 'text'
      ? { type, value: '', fontSize: '20px', align: 'left' }
      : { type, value: '' }
  )
}

const removeContentBlock = (index) => {
  const blocks = units.value[activeUnitIndex.value].blocks
  if (blocks.length <= 1 && blocks[0].type === 'text') {
    blocks[0].value = ''
    return
  }
  blocks.splice(index, 1)
}


// 載入題目進入編輯模式
const editQuestion = (q) => {
  editingId.value = q.id
  activeTab.value = 'quiz' // 切換到測驗題管理頁籤
  
  newQuestion.value.q = q.q
  newQuestion.value.qType = q.qType
  newQuestion.value.type = q.type // 保存原始類別，避免編輯後類別跳掉
  newQuestion.value.points = q.points || 10 // 載入配分
  
  // 處理選項與答案的對應
  if (['SINGLE', 'MULTI', 'TF'].includes(q.qType)) {
    const opts = q.options ? String(q.options).split(',') : []
    newQuestion.value.options = opts
    if (q.qType === 'SINGLE') {
      newQuestion.value.a = opts.findIndex(opt => opt.trim() === String(q.a).trim())
    } else if (q.qType === 'MULTI') {
      const answers = q.a ? String(q.a).split(',').map(s => s.trim()) : []
      newQuestion.value.multiIndices = answers
        .map(ans => opts.findIndex(opt => opt.trim() === ans))
        .filter(idx => idx !== -1)
    } else {
      newQuestion.value.a = q.a // 是非題直接存字串
    }
  } else {
    newQuestion.value.a = q.a // 填充/簡答
  }
}

// 判斷該選項是否為正確答案
const isOptionCorrect = (opt, correctAns) => {
  if (!correctAns) return false
  const normalizedCorrect = String(correctAns).split(',').map(s => s.trim().toLowerCase())
  const normalizedOpt = String(opt).trim().toLowerCase()
  return normalizedCorrect.includes(normalizedOpt)
}

const cancelEdit = () => {
  editingId.value = null
  newQuestion.value = { q: '', a: null, qType: 'SINGLE', options: ['', ''], multiIndices: [] }
}

// 新增：刪除單筆成績紀錄，修復 "_ctx.deleteSingleGrade is not a function" 錯誤
const deleteSingleGrade = async (studentName, submissionDate) => {
  if (!confirm(`確定要刪除學生「${studentName}」於 ${submissionDate} 的這筆紀錄嗎？`)) return

  isSaving.value = true
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'deleteSingleGrade',
        courseCode: String(props.courseCode).trim(),
        studentName: studentName,
        submissionDate: submissionDate
      })
    })

    const result = await response.json()
    if (result.status === 'success') {
      alert('紀錄已刪除')
      await fetchGrades() // 重新整理成績清單
      if (selectedStudentGrade.value && selectedStudentGrade.value.studentName === studentName) {
        await viewStudentDetails(selectedStudentGrade.value) // 同步更新目前查看的詳情視窗
      }
    } else {
      alert('刪除失敗：' + (result.message || '未知錯誤'))
    }
  } catch (e) {
    console.error("刪除單筆成績失敗", e)
    alert('刪除失敗，請檢查網路連線')
  } finally {
    isSaving.value = false
  }
}

// 查看學生詳細作答
const viewStudentDetails = async (student) => {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'getStudentQuizAnswers', // 新的 GAS action
        courseCode: props.courseCode,
        studentName: student.studentName
      })
    })
    const result = await response.json()
    if (result.status === 'success') {
      selectedStudentGrade.value = { ...student, allSubmissions: result.submissions || [] } // 儲存所有提交紀錄
    }
  } catch (e) {
    console.error("無法獲取學生詳細作答", e)
    alert('無法獲取學生詳細作答')
  }
}

// 一次刪除該課程的所有成績紀錄
const deleteAllGrades = async () => {
  if (!confirm('警告：確定要刪除此課程的所有成績紀錄嗎？此動作無法復原。')) return
  
  isSaving.value = true
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'deleteAllGrades',
        courseCode: String(props.courseCode).trim()
      })
    })

    const result = await response.json()
    if (result.status === 'success') {
      alert('已成功刪除所有成績紀錄')
      gradesList.value = []
      selectedStudentGrade.value = null
      fetchGrades() // 重新整理清單
    } else {
      alert('刪除失敗：' + (result.message || '無法刪除成績'))
    }
  } catch (e) {
    console.error("刪除成績失敗", e)
    alert('刪除失敗，請檢查網路連線')
  } finally {
    isSaving.value = false
  }
}

// 下載成績 CSV
const downloadGradesCSV = () => {
  if (gradesList.value.length === 0) return alert('目前沒有成績資料可下載')

  // 設定 CSV 標題
  const headers = ['學生姓名', '得分', '總分', '提交時間']
  
  // 轉換資料內容，並處理可能包含逗號的字串
  const rows = gradesList.value.map(g => [
    g.studentName,
    g.score,
    g.total,
    g.submissionDate
  ].map(field => `"${field}"`).join(','))

  // 合併標題與內容，並加上 UTF-8 BOM (\uFEFF) 確保 Excel 開啟時不亂碼
  const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  
  link.setAttribute('href', url)
  link.setAttribute('download', `成績清單_${props.courseCode}_${new Date().toLocaleDateString()}.csv`)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

// 刪除題目
const deleteQuestion = async (id) => {
  if (!confirm('確定要刪除這道題目嗎？這將會同步移除試算表資料。')) return
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'deleteContent',
        courseCode: props.courseCode,
        id: id
      })
    })

    const result = await response.json()
    if (result.status === 'success') {
      alert('刪除成功')
      fetchQuestions()
    } else {
      alert('刪除失敗：' + (result.message || '找不到該題目 ID'))
    }
  } catch (e) {
    alert('刪除失敗')
  }
}

onMounted(() => {
  fetchQuestions();
  fetchVocabs();
  // 首次載入時也獲取成績列表，如果預設顯示成績頁籤
  // fetchGrades(); 
});

// 監聽 activeTab 變化，當切換到 'grades' 時自動獲取成績
watch(activeTab, (newTab) => {
  if (newTab === 'grades') {
    fetchGrades();
  }
  if (newTab === 'vocab') {
    fetchVocabs();
  }
});
</script>
<template>
  <div class="teacher-panel">
    <div class="tab-menu">
      <button :class="{ active: activeTab === 'content' }" @click="activeTab = 'content'">編輯課程</button>
      <button :class="{ active: activeTab === 'vocab' }" @click="activeTab = 'vocab'">單字管理</button>
      <button :class="{ active: activeTab === 'grades' }" @click="activeTab = 'grades'">成績</button>
      <button :class="{ active: activeTab === 'quiz' }" @click="activeTab = 'quiz'">測驗題管理</button>
    </div>

    <section class="editor-section">
      <div v-if="activeTab === 'content' && units.length > 0" class="editor-card course-content-card">
        <!-- 單元導覽列 -->
        <div class="unit-manager">
          <div class="unit-tabs">
            <button 
              v-for="(unit, idx) in units" :key="idx" 
              :class="{ active: activeUnitIndex === idx }"
              @click="activeUnitIndex = idx"
              class="unit-tab-btn"
            >
              {{ unit.title }}
            </button>
            <button @click="addUnit" class="add-unit-btn">+ 新增單元</button>
          </div>
        </div>

        <div class="content-editor-header">
          <input v-model="units[activeUnitIndex].title" class="unit-title-input" placeholder="輸入單元名稱" v-if="units[activeUnitIndex]">
          <div class="add-buttons">
            <button @click.stop="isPreviewOpen = true" class="btn-mini btn-preview" title="以學生視角查看目前單元內容">預覽</button>
            <button @click="addContentBlock('text')" class="btn-mini">+ 文字</button>
            <button @click="addContentBlock('youtube')" class="btn-mini">+ YouTube</button>
            <button @click="addContentBlock('embed')" class="btn-mini">+ 文件/簡報</button>
            <button @click="addContentBlock('video')" class="btn-mini">+ 影片連結</button>
          </div>
        </div>
        
        <div class="blocks-container">
          <div v-for="(block, index) in (units[activeUnitIndex]?.blocks || [])" :key="'block-'+index" class="content-block-item">
            <div class="block-label">
              <span class="block-type">{{ block.type === 'text' ? '文字內容' : block.type === 'embed' ? '文件/簡報連結' : block.type.toUpperCase() + ' 連結' }}</span>
              <div class="block-actions">
                <button @click="removeContentBlock(index)" class="btn-remove-block">移除區塊</button>
              </div>
            </div>
            
            <div v-if="block.type === 'text'" class="text-block-editor">
              <div class="metric-controls">
                <div class="font-size-picker">
                  <label>字型大小：</label>
                  <select v-model="block.fontSize">
                    <option v-for="option in fontSizeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                  </select>
                </div>
                <div class="alignment-picker">
                  <label>文字對齊：</label>
                  <select v-model="block.align">
                    <option value="left">置左</option>
                    <option value="center">置中</option>
                    <option value="right">置右</option>
                  </select>
                </div>
              </div>
              <textarea 
                v-model="block.value" 
                placeholder="請在此輸入教學文字或 HTML..."
              ></textarea>
            </div>
            
            <input 
              v-else 
              v-model="block.value" 
              class="styled-input" 
              :placeholder="block.type === 'youtube' ? '請貼上 YouTube 網址' : block.type === 'embed' ? '請貼上 Google 文件/簡報連結 (建議使用：檔案 > 共用 > 發佈到網路)' : '請貼上直接影片網址 (.mp4)'"
            >
          </div>
        </div>

        <button v-if="units.length > 1" @click="removeUnit(activeUnitIndex)" class="btn-danger-outline">刪除目前整個單元</button>
        <button @click="uploadContent('TEXT')" :disabled="isSaving" class="save-btn">
          {{ isSaving ? '儲存中...' : '儲存並更新所有內容' }}
        </button>
      </div>

      <div v-if="activeTab === 'vocab'" class="editor-card">
        <div class="editor-header"><h3>新增單字</h3></div>

        <div class="bulk-vocab-panel" ref="bulkPanelRef">
          <div class="bulk-header">
            <div>
              <h4>編輯單字</h4>
            </div>
            <button @click="addBulkVocabEntry" class="btn-mini">+ 新增一筆</button>
          </div>
          <div class="bulk-vocab-list">
            <div v-for="(item, index) in bulkVocabs" :key="index" class="bulk-vocab-row">
              <input v-model="item.word" placeholder="英文單字" class="styled-input">
              <select v-model="item.pos" class="styled-input pos-select">
                <option value="n.">n.</option>
                <option value="v.">v.</option>
                <option value="adj.">adj.</option>
                <option value="adv.">adv.</option>
                <option value="prep.">prep.</option>
              </select>
              <input v-model="item.meaning" placeholder="中文意思" class="styled-input">
              <button @click="removeBulkVocabEntry(index)" class="btn-remove" v-if="bulkVocabs.length > 1">✕</button>
            </div>
          </div>
          <div class="bulk-actions">
            <button @click="publishBulkVocabs" :disabled="isSaving" class="btn-publish-bulk">
              {{ isSaving ? '處理中...' : '發佈' }}
            </button>
            <button v-if="isEditingBulk" @click="cancelBulkEdit" :disabled="isSaving" class="btn-publish-bulk">
              取消
            </button>
          </div>
        </div>

        <div class="vocab-list-admin">
          <h4>已發佈單字 ({{ vocabList.length }})</h4>
          <div class="vocab-grid">
            <div v-for="v in vocabList" :key="v.id" class="vocab-item-admin">
              <span class="v-word">{{ v.word }}</span>
              <span class="v-pos">{{ v.pos }}</span>
              <span class="v-mean">{{ v.meaning }}</span>
              <div class="vocab-actions">
                <button @click="editVocab(v)" class="mini-edit-btn">編輯</button>
                <button @click="deleteVocab(v.id)" class="mini-del-btn">×</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div v-if="activeTab === 'quiz'" class="editor-card">
        <div class="editor-header">
          <h3>{{ editingId ? '編輯題目' : '新增測驗題' }}</h3>
          <div class="type-picker">
            <label>題型：</label>
            <select v-model="newQuestion.qType" @change="handleTypeChange">
              <option value="SINGLE">單選題</option>
              <option value="MULTI">多選題</option>
              <option value="TF">是非題</option>
              <option value="FILL">填充題</option>
              <option value="SHORT">簡答題</option>
            </select>
          </div>
        </div>

        <div class="editor-content">
          <div class="form-group">
            <label>題目內容</label>
            <textarea v-model="newQuestion.q" class="q-textarea" placeholder="請輸入題目內容..."></textarea>
          </div>

          <div class="form-group">
            <label>配分 (Points)</label>
            <input type="number" v-model="newQuestion.points" class="styled-input" min="1">
          </div>

          <!-- 選擇題區塊 -->
          <div v-if="['SINGLE', 'MULTI'].includes(newQuestion.qType)" class="options-group">
            <label>選項與正確答案 (請勾選正確項)</label>
            <div v-for="(opt, index) in newQuestion.options" :key="index" 
                 class="option-item editor-option" 
                 :class="{ 'is-selected-correct': newQuestion.qType === 'SINGLE' ? newQuestion.a === index : newQuestion.multiIndices.includes(index) }">
              <input 
                v-if="newQuestion.qType === 'SINGLE'" 
                type="radio" 
                :value="index" 
                v-model="newQuestion.a"
                class="hidden-input"
              >
              <input 
                v-else 
                type="checkbox" 
                :value="index" 
                v-model="newQuestion.multiIndices"
                class="hidden-input"
              >
              <input v-model="newQuestion.options[index]" class="opt-input" :placeholder="'輸入選項內容...'" @click.stop>
              <button @click="removeOption(index)" class="btn-remove">✕</button>
            </div>
            <button @click="addOption" class="btn-add-option">+ 新增選項</button>
          </div>

          <!-- 是非題區塊 -->
          <div v-if="newQuestion.qType === 'TF'" class="tf-group">
            <label>正確答案</label>
            <div class="tf-options">
              <button :class="{ selected: newQuestion.a === 'True' }" @click="newQuestion.a = 'True'">True</button>
              <button :class="{ selected: newQuestion.a === 'False' }" @click="newQuestion.a = 'False'">False</button>
            </div>
          </div>

          <!-- 填充/簡答 -->
          <div v-if="['SHORT', 'FILL'].includes(newQuestion.qType)" class="form-group">
            <label>設定正確答案</label>
            <input v-model="newQuestion.a" class="styled-input" placeholder="輸入學生應回答的正確文字">
          </div>
        </div>

        <div class="btn-group">
          <button @click="uploadContent('QUIZ')" :disabled="isSaving" class="btn-publish">
            {{ isSaving ? '處理中...' : (editingId ? '確認並更新題目' : '確認並發佈題目') }}
          </button>
          <button v-if="editingId" @click="cancelEdit" class="btn-cancel">取消編輯</button>
        </div>
      </div>
    </section>

    <section v-if="activeTab === 'grades'" class="grades-section">
      <div class="section-header">
        <h3>學生測驗成績</h3>
        <button @click="deleteAllGrades" class="delete-all-btn" :disabled="isSaving">刪除所有成績</button>
        <button @click="downloadGradesCSV" class="download-btn">下載 CSV 報表</button>
      </div>
      <div v-if="gradesList.length === 0" class="info-box">目前沒有學生提交測驗。</div>
      <div v-else class="grades-list">
        <div class="grade-item header">
          <span>學生姓名</span>
          <span>分數</span>
          <span>提交時間</span>
          <span>操作</span>
        </div>
        <div v-for="student in gradesList" :key="student.studentName" class="grade-item">
          <span>{{ student.studentName }}</span>
          <span>{{ student.score }} / {{ student.total }}</span>
          <span>{{ student.submissionDate }}</span>
          <div class="grade-actions">
            <button @click="viewStudentDetails(student)" class="view-details-btn">詳情</button>
            <button @click="deleteSingleGrade(student.studentName, student.submissionDate)" class="item-del-btn" title="刪除此筆">刪除</button>
          </div>
        </div>
      </div>

      <div v-if="selectedStudentGrade && selectedStudentGrade.allSubmissions" class="student-details-card">
        <h4>{{ selectedStudentGrade.studentName }} 的作答詳情</h4>
        <div v-for="(submission, subIdx) in selectedStudentGrade.allSubmissions" :key="subIdx" class="submission-record">
          <h5>提交日期：{{ submission.submissionDate }} — 分數：{{ submission.score }} / {{ submission.total }}</h5>
          <div v-for="(answer, index) in submission.studentAnswers" :key="index" class="q-item detailed-answer-item">
            <div class="q-info">
              <span class="tag-outline">{{ typeLabels[answer.qType] || answer.qType }}</span>
              <p class="q-text"><strong>Q:</strong> {{ answer.q }}</p>
              
              <div v-if="['SINGLE', 'MULTI', 'TF'].includes(answer.qType) && answer.options" class="options-list-preview">
                <template v-for="(opt, idx) in String(answer.options).split(',')" :key="idx">
                  <div v-if="opt.trim()" class="opt-preview-item" :class="{ 'is-correct-answer': isOptionCorrect(opt, answer.correctAnswer) }">
                    <span class="opt-text">{{ opt.trim() }}</span>
                  </div>
                </template>
              </div>

              <div class="ans-hint">
                <span class="ans-label">學生作答:</span>
                <span :class="{ 'ans-value': true, 'wrong-ans': !answer.isCorrect }">{{ answer.studentAnswer || '未作答' }}</span>
              </div>
              <div class="ans-hint">
                <span class="ans-label">正確答案:</span>
                <span class="ans-value">{{ answer.correctAnswer }}</span>
              </div>
            </div>
          </div>
        </div>
        <button @click="selectedStudentGrade = null" class="btn-cancel-details">返回成績列表</button>
      </div>
    </section>

    <section v-if="activeTab === 'quiz'" class="questions-list">
      <div class="list-header">
        <h3>已發佈題目清單</h3>
        <span class="count-tag">共 {{ questionsList?.length || 0 }} 題</span>
      </div>
      <div v-for="q in (questionsList || [])" :key="q.id || Math.random()" class="q-item">
        <div class="q-info">
          <span class="tag" :class="q.type">{{ q.type === 'PRACTICE' ? 'PRACTICE' : 'QUIZ' }}</span>
          <span class="tag-outline">{{ typeLabels[q.qType] || q.qType }}</span>
          <p class="q-text">{{ q.q }}</p>
          
          <!-- 確保選項顯示為獨立列表，防止文字擠在一起 -->
          <div v-if="['SINGLE', 'MULTI', 'TF'].includes(q.qType) && q.options" class="options-list-preview">
            <template v-for="(opt, idx) in String(q.options).split(',')" :key="idx">
              <div v-if="opt.trim()" class="opt-preview-item" :class="{ 'is-correct-answer': isOptionCorrect(opt, q.a) }">
                <span class="opt-text">{{ opt.trim() }}</span>
              </div>
            </template>
          </div>
          <div class="ans-hint">
            <span class="ans-label">正確答案:</span>
            <span class="ans-value">{{ q.a }}</span>
          </div>
        </div>
        <div class="q-actions">
          <button @click="editQuestion(q)" class="edit-btn">編輯</button>
          <button @click="deleteQuestion(q.id)" class="del-btn">刪除</button>
        </div>
      </div>
    </section>

    <!-- 學生端畫面預覽彈窗 -->
    <div v-if="isPreviewOpen" class="modal-overlay" @click.self="isPreviewOpen = false">
      <div class="modal-content preview-modal">
        <div class="modal-header">
          <h3>學生視角預覽：{{ units[activeUnitIndex]?.title || '預覽' }}</h3>
          <button class="close-btn" @click="isPreviewOpen = false">×</button>
        </div>
        <div class="modal-body">
          <div class="student-style-preview">
            <div v-if="!previewBlocks || previewBlocks.length === 0" class="empty-state">目前尚無內容</div>
            <div v-for="(block, index) in previewBlocks" :key="'prev-' + index" class="preview-block">
              <!-- 文字區塊 -->
              <div v-if="block.type === 'text'" v-html="(block.value || '').replace(/\n/g, '<br>')" class="text-content" :style="{ fontSize: block.fontSize || '20px', textAlign: block.align || 'left' }"></div>
              
              <!-- YouTube 區塊 -->
              <div v-else-if="block.type === 'youtube'" class="video-container">
                <iframe :src="block.processedUrl" frameborder="0" allowfullscreen></iframe>
              </div>
              
              <!-- 文件嵌入區塊 -->
              <div v-else-if="block.type === 'embed'" class="embed-container-preview">
                <iframe v-if="block.processedUrl && block.processedUrl !== '#'" :src="block.processedUrl" width="100%" height="450px" frameborder="0"></iframe>
                <div v-else class="embed-fallback">⚠️ 此連結無法預覽，學生屆時需點擊連結另開分頁。</div>
              </div>

              <!-- 影片連結區塊 -->
              <div v-else-if="block.type === 'video'" class="video-container">
                <video controls width="100%">
                  <source :src="block.processedUrl" type="video/mp4">
                </video>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.teacher-panel {
  width: 100%;
  background: transparent;
  border: none;
  padding: 0 !important;
  border-radius: 0;
  min-height: 100vh;
}
.tab-menu { display: flex; gap: 10px; margin-bottom: 25px; padding: 0; }
.tab-menu button {
  flex: 1;
  padding: 14px;
  cursor: pointer;
  border: none;
  background: var(--surface);
  border-radius: var(--border-radius-lg); /* 統一使用大圓角以符合現代設計 */
  font-weight: 600;
  color: var(--text-muted);
  box-shadow: 0 4px 15px rgba(0,0,0,0.03);
  transition: var(--transition);
}
.tab-menu button.active { background: var(--primary-color); color: var(--text-main); transform: translateY(-2px); }
.tab-menu button:hover { transform: scale(1.05); }
.tab-menu button.active:hover { transform: translateY(-2px) scale(1.05); }

.editor-section { padding: 0 20px; max-width: 1200px; margin: 0 auto; }
.editor-card { background: var(--surface); padding: 30px; border-radius: var(--border-radius-lg); box-shadow: 0 10px 25px rgba(0,0,0,0.05); }
.course-content-card { border: 1px solid var(--border); }
.editor-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.type-picker select { padding: 8px; border-radius: var(--border-radius-sm); border: 1px solid var(--border); background: var(--surface-soft); }

.bulk-vocab-panel {
  border: none;
  padding: 24px;
  border-radius: var(--border-radius-lg);
  background: #eaf4fb;
  margin-bottom: 24px;
}
.bulk-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 15px;
  margin-bottom: 18px;
}
.bulk-header .btn-mini {
  background: var(--primary-color);
  color: white;
  border: none;
}
.bulk-header h4 {
  margin: 0;
  color: #1f3f6a;
}
.bulk-vocab-list {
  display: grid;
  gap: 12px;
  margin-bottom: 18px;
}
.bulk-vocab-row {
  display: grid;
  grid-template-columns: 1fr 120px 1.6fr 40px;
  gap: 10px;
  align-items: center;
}
.bulk-vocab-row .styled-input,
.bulk-vocab-row .pos-select {
  width: 100%;
  background: white;
  border: 1px solid rgba(31, 63, 106, 0.14);
  border-radius: 16px;
  padding: 12px 14px;
}
.bulk-vocab-row .styled-input:focus,
.bulk-vocab-row .pos-select:focus {
  outline: none;
  border-color: #4a8adc;
  box-shadow: 0 0 0 4px rgba(74, 138, 220, 0.12);
}
.btn-publish-bulk {
  background: #5f91d3;
  color: white;
  border: none;
  padding: 14px 26px;
  border-radius: 999px;
  cursor: pointer;
  font-weight: 700;
  box-shadow: 0 10px 20px rgba(95, 145, 211, 0.22);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.btn-publish-bulk:hover {
  transform: translateY(-1px);
  box-shadow: 0 14px 28px rgba(95, 145, 211, 0.28);
}
.bulk-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}
.btn-mini {
  background: #ffffff;
  border: 1px solid rgba(31, 63, 106, 0.16);
  color: #1f3f6a;
  padding: 10px 16px;
  border-radius: var(--border-radius-sm);
  font-weight: 700;
}
.btn-mini:hover {
  background: white;
  transform: translateY(-1px);
}
.btn-cancel-bulk {
  background: var(--danger-soft) !important;
  border-color: var(--border-strong) !important;
  color: var(--text-main) !important;
}
.vocab-actions { display: flex; gap: 8px; }
.mini-edit-btn,
.mini-del-btn {
  border: none;
  background: var(--surface-muted);
  color: var(--text-main);
  border-radius: var(--border-radius-sm);
  cursor: pointer;
  padding: 6px 10px;
  transition: transform 0.2s ease, background 0.2s ease;
}
.mini-edit-btn:hover,
.mini-del-btn:hover { transform: scale(1.05); background: var(--surface-soft); }

.content-editor-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
.unit-title-input { font-size: 1.2em; font-weight: bold; border: 1px solid #cfeafc; background: transparent; outline: none; padding: 8px 10px; color: var(--text-main); border-radius: var(--border-radius-sm); }
.unit-title-input:focus { border-color: var(--primary-strong); box-shadow: 0 0 0 4px rgba(46,125,233,0.06); }
.unit-manager { margin-bottom: 20px; overflow-x: auto; }
.unit-tabs { display: flex; gap: 8px; padding-bottom: 5px; }
.unit-tab-btn { padding: 8px 16px; border-radius: var(--border-radius-sm); border: 1px solid var(--border); background: var(--surface); cursor: pointer; white-space: nowrap; transition: 0.2s; }
.unit-tab-btn.active { background: var(--primary-strong); color: white; border-color: var(--primary-strong); }
.unit-tab-btn:hover { transform: scale(1.05); }
.add-unit-btn { padding: 8px 16px; border-radius: var(--border-radius-sm); border: 1px dashed var(--border-soft); background: transparent; cursor: pointer; color: var(--text-muted); transition: 0.2s; }
.add-unit-btn:hover { transform: scale(1.05); color: var(--text-main); border-color: var(--primary-strong); }

.add-buttons { display: flex; gap: 8px; flex-wrap: wrap; }
.editor-controls { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.font-size-picker,
.alignment-picker { display: flex; align-items: center; gap: 8px; }
.font-size-picker label,
.alignment-picker label { font-weight: bold; font-size: 0.8em; color: var(--text-muted); }
.font-size-picker select,
.alignment-picker select { padding: 8px 10px; border-radius: var(--border-radius-sm); border: 1px solid var(--border); background: var(--surface-soft); color: var(--text-main); }
.metric-controls { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
.btn-mini {
  flex: 1 1 0;
  min-width: 110px;
  max-width: 160px;
  padding: 8px 10px;
  font-size: 0.85em;
  text-align: center;
  white-space: nowrap;
  cursor: pointer;
  border-radius: var(--border-radius-sm);
  border: 1px solid var(--border);
  background: var(--surface);
  transition: 0.2s;
}
.btn-mini:hover { background: var(--surface-muted); transform: scale(1.02); }

.btn-danger-outline { width: 100%; padding: 10px; margin-bottom: 10px; background: transparent; border: 1px solid var(--danger-soft); color: var(--text-main); border-radius: var(--border-radius-sm); cursor: pointer; transition: 0.2s; }
.btn-danger-outline:hover { background: var(--danger-soft); transform: scale(1.02); }

.blocks-container { display: flex; flex-direction: column; gap: 15px; margin-bottom: 20px; }
.content-block-item {
  background: var(--surface-muted);
  padding: 15px;
  border-radius: var(--border-radius-sm);
  border: none;
  box-shadow: 0 8px 18px rgba(153, 193, 222, 0.12);
}
.block-label { display: flex; justify-content: space-between; margin-bottom: 8px; }
.block-type { font-size: 0.8em; font-weight: bold; color: var(--text-muted); }
.btn-remove-block { background: none; border: none; color: var(--text-main); cursor: pointer; font-size: 0.8em; }
.hint-text { font-size: 0.75em; color: var(--text-muted); margin-top: 5px; }

.save-btn { 
  width: 100%; padding: 14px; background: var(--primary-color); color: white; border: none; 
  border-radius: var(--border-radius-sm); font-weight: bold; cursor: pointer; font-size: 1em; transition: 0.2s;
  box-shadow: 0 4px 6px rgba(153, 193, 222, 0.2);
}
.save-btn:hover { background: var(--primary-strong); transform: scale(1.02); }
.save-btn:disabled { opacity: 0.6; }

.form-group { margin-bottom: 20px; }
.form-group label { display: block; margin-bottom: 8px; font-weight: bold; color: var(--text-main); }
.content-block-item textarea {
  width: 100%;
  min-height: 120px;
  padding: 15px;
  border-radius: var(--border-radius-sm);
  border: 1px solid var(--border);
  box-sizing: border-box;
  background: #ffffff !important;
  color: var(--text-main) !important;
}
.content-block-item textarea::placeholder {
  color: var(--text-muted) !important;
}
.q-textarea { 
  width: 100%;
  min-height: 120px; 
  font-size: 1.05em; 
  padding: 18px 20px;
  border-radius: var(--border-radius-lg);
  border: 1px solid var(--border-soft);
  box-shadow: 0 6px 18px rgba(17,24,39,0.03);
  transition: var(--transition);
  resize: vertical;
  box-sizing: border-box;
  display: block;
}

.option-item {
  display: flex; align-items: center; gap: 10px; margin-bottom: 10px;
  background: var(--surface);
  padding: 8px 12px;
  border-radius: var(--border-radius-lg);
  border: 1px solid #bfd7e8;
  background: #f5efe5;
  transition: all 0.2s ease;
  cursor: pointer;
}
.opt-input { flex: 1; padding: 8px; border: none; background: transparent; outline: none; }
.btn-remove { background: none; border: none; color: var(--text-muted); cursor: pointer; }
.btn-add-option { 
  width: 100%; padding: 10px; margin-top: 10px; border: 2px dashed var(--border);
  background: none; color: var(--text-muted); border-radius: var(--border-radius-sm); cursor: pointer; transition: 0.2s;
}
.btn-add-option:hover { border-color: var(--text-muted); color: var(--text-main); transform: scale(1.02); }

.option-item.is-selected-correct {
  background: #e7f0ff;
  border-color: var(--primary-color);
}

.tf-options { display: flex; gap: 15px; }
.tf-options button {
  flex: 1; padding: 12px; border: 2px solid var(--border); border-radius: var(--border-radius-sm);
  background: var(--surface); cursor: pointer; font-weight: bold; transition: 0.2s;
}
.tf-options button:hover { transform: scale(1.05); }
.tf-options button.selected { background: var(--primary-color); color: var(--surface); border-color: var(--primary-color); }

.styled-input {
  width: 100%;
  padding: 14px 20px;
  border-radius: var(--border-radius-lg);
  border: 1px solid var(--border-soft);
  box-sizing: border-box;
  font-size: 1em;
  background: #ffffff;
  color: var(--text-main);
  transition: var(--transition);
}
.type-picker select,
.opt-input {
  background: #ffffff;
  color: var(--text-main);
}
.btn-publish {
  width: 100%; padding: 16px; margin-top: 25px; border: none;
  background: var(--text-main); color: var(--surface); border-radius: var(--border-radius-sm); font-weight: bold; cursor: pointer; transition: 0.2s;
}
.btn-publish:hover { transform: scale(1.02); background: var(--primary-strong); }
.btn-cancel {
  width: 100%; padding: 10px; margin-top: 10px; border: 1px solid var(--border);
  background: var(--surface-soft); color: var(--text-muted); border-radius: var(--border-radius-sm); font-weight: bold; cursor: pointer; transition: 0.2s;
}
.btn-cancel:hover { background: var(--surface); transform: scale(1.02); }
.btn-group { display: flex; flex-direction: column; }

.questions-list { margin-top: 40px; padding: 0 20px; }
.list-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
.count-tag { background: var(--border); padding: 4px 12px; border-radius: 20px; font-size: 0.8em; }
.q-item {
  background: var(--surface); padding: 20px; border-radius: var(--border-radius-lg); margin-bottom: 15px;
  display: flex; justify-content: space-between; align-items: flex-start;
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05);
  border-left: 6px solid var(--primary-strong);
  text-align: left; /* 確保題目內容置左 */
}
.q-info { flex: 1; padding-right: 20px; }
.tag { 
  display: inline-block; font-size: 0.7em; padding: 2px 8px; border-radius: 5px; font-weight: bold;
  margin-right: 5px; text-transform: uppercase;
}
.tag.PRACTICE { background: var(--accent-color); color: var(--text-main); }
.tag.QUIZ { background: var(--accent-warm); color: var(--text-main); }
.q-text { font-weight: bold; margin: 10px 0; white-space: pre-wrap; color: var(--text-main); line-height: 1.5; overflow-wrap: break-word; }
.tag-outline {
  display: inline-block;
  font-size: 0.7em;
  padding: 2px 8px;
  border-radius: 5px;
  border: 1px solid var(--border);
  color: var(--text-muted);
  margin-right: 5px;
}
/* 新增選項預覽清單樣式 */
.options-list-preview { 
  margin: 12px 0; 
  display: flex; 
  flex-direction: column; /* 強制垂直排列 */
  align-items: stretch;   /* 讓選項佔滿寬度 */
  gap: 8px; 
}
.opt-preview-item { 
  font-size: 0.95em; color: var(--text-main); display: flex; align-items: center; 
  padding: 10px 15px; background: var(--surface); border-radius: 8px; 
  border: 1px solid #bfd7e8; border-radius: var(--border-radius-sm);
  transition: var(--transition);
}
.opt-text { 
  color: var(--text-main); 
  width: 100%;
}
.opt-preview-item.is-correct-answer {
  border-color: #0b4da0;
  border-width: 2px;
  border-style: solid;
  background: #d6e7ff;
  font-weight: bold;
}

.ans-hint { font-size: 0.85em; margin-top: 8px; display: flex; gap: 5px; }
.ans-label { color: var(--text-muted); }
.ans-value { color: var(--accent-color); font-weight: bold; }

.q-actions { display: flex; gap: 8px; min-width: 130px; }
.del-btn { flex: 1; padding: 6px 12px; background: var(--danger-soft); color: var(--text-main); border: none; border-radius: var(--border-radius-sm); cursor: pointer; transition: 0.2s; }
.del-btn:hover { transform: scale(1.1); background: var(--danger-soft); opacity: 0.9; }
.edit-btn { flex: 1; padding: 6px 12px; background: var(--surface-soft); color: var(--text-main); border: none; border-radius: var(--border-radius-sm); cursor: pointer; transition: 0.2s; }
.edit-btn:hover { transform: scale(1.1); background: var(--surface); }

/* 手機版 RWD 優化 */
@media (max-width: 600px) {
  .teacher-panel { padding: 10px; }
  .editor-card { padding: 20px; }
  .editor-header { flex-direction: column; align-items: flex-start; gap: 12px; }
  .type-picker { width: 100%; display: flex; align-items: center; justify-content: space-between; }
  
  .q-item { flex-direction: column; }
  .q-info { padding-right: 0; margin-bottom: 15px; width: 100%; }
  .q-actions { 
    width: 100%; 
    padding-top: 15px; 
    border-top: 1px solid var(--surface-muted); 
    justify-content: stretch;
  }
  .q-actions button { flex: 1; padding: 10px; font-size: 0.95em; }
  
  .tab-menu { gap: 8px; }
  .tab-menu button { padding: 12px 8px; font-size: 0.85em; }
}

/* 新增的成績頁籤樣式 */
.grades-section {
  background: var(--surface);
  padding: 30px;
  border-radius: var(--border-radius-lg);
  box-shadow: 0 10px 25px rgba(0,0,0,0.05);
  margin: 25px auto 0;
  max-width: 1200px;
  width: calc(100% - 40px);
}
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
.download-btn {
  background: var(--accent-color);
  color: var(--text-main);
  border: none;
  padding: 8px 16px;
  border-radius: var(--border-radius-sm);
  cursor: pointer;
  font-weight: bold;
  transition: 0.2s;
}
.download-btn:hover { background: var(--primary-strong); transform: scale(1.05); }
.delete-all-btn {
  background: var(--danger-soft);
  color: var(--text-main);
  border: none;
  padding: 8px 16px;
  border-radius: var(--border-radius-sm);
  cursor: pointer;
  font-weight: bold;
  transition: 0.2s;
  margin-right: 10px;
}
.submission-record {
  border-top: 1px dashed var(--border);
  padding-top: 20px;
  margin-top: 20px;
}
.delete-all-btn:hover { background: var(--danger-soft); opacity: 0.95; }
.delete-all-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.grades-list {
  margin-top: 20px;
  border: 1px solid var(--border);
  border-radius: var(--border-radius-sm);
  overflow: hidden;
}
.grade-item {
  display: grid;
  grid-template-columns: 2fr 1fr 1.5fr 1fr;
  align-items: center;
  padding: 12px 15px;
  border-bottom: 1px solid var(--surface-muted);
}
.grade-item.header {
  background: var(--surface-soft);
  font-weight: bold;
  color: var(--text-main);
}
.grade-actions {
  display: flex;
  gap: 5px;
  justify-content: flex-end;
}
.item-del-btn {
  min-width: 60px;
  background: var(--surface);
  border: 1px solid var(--danger-soft);
  color: var(--text-main);
  padding: 4px 8px;
  border-radius: var(--border-radius-sm);
  cursor: pointer;
  transition: 0.2s;
}
.item-del-btn:hover {
  background: var(--danger-soft); transform: scale(1.2);
}
.grade-item:last-child {
  border-bottom: none;
}
.view-details-btn {
  min-width: 60px;
  background: var(--primary-color);
  color: white;
  border: none;
  padding: 6px 12px;
  border-radius: var(--border-radius-sm);
  cursor: pointer;
  font-size: 0.9em;
  transition: 0.2s;
}
.view-details-btn:hover { transform: scale(1.05); background: var(--primary-strong); }
.student-details-card {
  margin-top: 30px;
  background: var(--surface-soft);
  padding: 20px;
  border-radius: var(--border-radius-lg);
  box-shadow: 0 4px 10px rgba(0,0,0,0.05);
}
.student-details-card h4 {
  margin-top: 0;
  color: var(--text-main);
}
.detailed-answer-item {
  border-left: 4px solid var(--accent-warm); /* 不同於普通題目的顏色 */
}
.wrong-ans {
  color: var(--danger-color);
}
.submission-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--surface-soft);
  padding: 0 15px;
  border-radius: 8px;
}
.del-record-btn {
  background: var(--danger-soft);
  color: var(--text-main);
  border: none;
  padding: 5px 10px;
  border-radius: var(--border-radius-sm);
  font-size: 0.8em;
  cursor: pointer;
  transition: 0.2s;
}
.del-record-btn:hover { transform: scale(1.1); background: var(--danger-soft); }
.btn-cancel-details {
  margin-top: 20px;
  background: var(--surface-soft); color: var(--text-muted); border: none; padding: 8px 15px; border-radius: var(--border-radius-sm); cursor: pointer; transition: 0.2s;
}
.btn-cancel-details:hover { transform: scale(1.05); background: var(--surface); }

/* 預覽彈窗樣式 */
.btn-preview {
  background: var(--primary-color) !important;
  color: white !important;
  border: none !important;
  font-weight: bold;
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(47, 58, 72, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  padding: 20px;
  backdrop-filter: blur(4px);
}

.preview-modal {
  background: var(--surface-soft);
  width: 100%;
  max-width: 900px;
  max-height: 90vh;
  border-radius: var(--border-radius-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
}

.modal-header {
  padding: 20px 25px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.close-btn {
  background: none;
  border: none;
  font-size: 2rem;
  cursor: pointer;
  color: var(--text-muted);
  line-height: 1;
  transition: 0.2s;
}
.close-btn:hover { color: var(--text-main); transform: scale(1.1); }

.modal-body {
  padding: 25px;
  overflow-y: auto;
  flex: 1;
}

.student-style-preview {
  background: var(--surface);
  padding: 30px;
  border-radius: 16px;
  min-height: 400px;
  box-shadow: 0 4px 6px rgba(0,0,0,0.05);
}

.preview-block { margin-bottom: 30px; }
.text-content { line-height: 1.8; color: var(--text-main); font-size: 1.05em; }
.video-container {
  position: relative;
  padding-bottom: 56.25%;
  height: 0;
  border-radius: 12px;
  overflow: hidden;
  background: var(--surface-muted);
}
.video-container iframe { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
.embed-container-preview { border-radius: 12px; overflow: hidden; border: 1px solid var(--border); }
.embed-fallback { padding: 40px; text-align: center; background: var(--surface-soft); color: var(--text-muted); }

.vocab-form .form-row { display: flex; gap: 10px; margin-bottom: 20px; }
.pos-select { flex: 0 0 120px; }
.add-vocab-btn { background: var(--primary-color); color: white; border: none; border-radius: 12px; padding: 0 25px; cursor: pointer; font-weight: bold; }
.vocab-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; margin-top: 15px; }
.vocab-item-admin { 
  background: #fff; padding: 10px; border-radius: var(--border-radius-sm); border: 1px solid var(--border);
  display: flex; align-items: center; gap: 8px; position: relative;
}
.vocab-item-admin .v-word { font-weight: bold; color: #1f3f6a; }
.vocab-item-admin .v-pos { font-size: 0.8em; color: var(--text-muted); }
.mini-del-btn { 
  position: absolute; right: 5px; top: 5px; background: none; border: none; 
  color: #ef4444; cursor: pointer; font-size: 1.2em; 
}
</style>