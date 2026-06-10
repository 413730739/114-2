<script setup>
import { ref, onMounted, watch, computed, nextTick } from 'vue'

const props = defineProps(['courseCode'])
const API_URL = 'https://script.google.com/macros/s/AKfycbzFSxDWsyE7Zx3fSGvJx-0UrqV10X_7fSx-xi2n-fQj13m9NZ1DUenUAhMI3Ib9DQHJ/exec'

// 確保 units 與 activeUnitIndex 在最上方正確定義並初始化
const units = ref([{ title: '單元一', blocks: [{ type: 'text', value: '' }] }])
const activeUnitIndex = ref(0)
const questionsList = ref([])
const isFetching = ref(false)
const isSaving = ref(false)
const activeTab = ref('content') // content, quiz, grades
const isPreviewOpen = ref(false)

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
      if (rawValue.startsWith('<iframe')) {
        const srcMatch = rawValue.match(/src=["']([^"']+)["']/)
        if (srcMatch) rawValue = srcMatch[1]
      }

        if (block.type === 'embed' && rawValue.includes('drive.google.com/open?id=')) {
          const id = rawValue.split('id=')[1].split('&')[0];
          processedUrl = `https://drive.google.com/file/d/${id}/preview`;
        } else if (block.type === 'youtube') {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
        const match = rawValue.match(regExp);
        processedUrl = (match && match[2] && match[2].length === 11)
          ? `https://www.youtube.com/embed/${match[2]}` 
          : rawValue
      }
      else if (block.type === 'embed' && rawValue && rawValue.includes('google.com')) {
        let url = rawValue
        if (url.includes('/d/e/')) {
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
            units.value = parsed
          } else {
            // 舊資料相容處理
            const oldBlocks = Array.isArray(parsed) ? parsed : [{ type: 'text', value: result.content }]
            units.value = [{ title: '單元一', blocks: oldBlocks }]
          }
        } catch (e) {
          units.value = [{ title: '單元一', blocks: [{ type: 'text', value: result.content }] }]
        }
      }
    }
  } catch (e) {
    console.error("無法獲取題目", e)
  } finally {
    isFetching.value = false // 確保在完成或失敗後重置狀態
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
        finalAnswer = answers.join('|||')
      }

      // 如果是是非或選擇題，處理選項
      let finalOptions = ''
      if (['SINGLE', 'MULTI', 'TF'].includes(q.qType)) {
        if (q.qType === 'TF') {
          finalOptions = 'True|||False'
        } else {
          finalOptions = q.options.filter(opt => opt.trim() !== '').join('|||')
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
          points: q.points,
          type: activeTab.value === 'quiz' ? 'QUIZ' : q.type // 強制根據當前頁籤更新分類
        }
      } else {
        payload.question = { 
        q: q.q,
        a: finalAnswer,
        qType: q.qType,
        options: finalOptions,
        type: type, // 這裡會是傳入的 'QUIZ' 或 'PRACTICE'
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
        multiIndices: [],
        points: 10 // 重置預設配分
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
  units.value.push({ title: `新單元 ${units.value.length + 1}`, blocks: [{ type: 'text', value: '' }] })
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
  units.value[activeUnitIndex.value].blocks.push({ type, value: '' })
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
const editQuestion = async (q) => {
  editingId.value = q.id
  activeTab.value = 'quiz' // 切換到測驗題管理頁籤
  
  // 確保畫面已切換到測驗分頁後再執行即時捲動
  await nextTick()
  window.scrollTo({
    top: 0,
    behavior: 'auto' // 使用 auto 達到「直接跳轉」的效果，若喜歡平滑感可改回 smooth
  })

  newQuestion.value.q = q.q
  newQuestion.value.qType = q.qType
  newQuestion.value.type = q.type // 保存原始類別，避免編輯後類別跳掉
  newQuestion.value.points = q.points || 10 // 載入配分
  
  // 處理選項與答案的對應
  if (['SINGLE', 'MULTI', 'TF'].includes(q.qType)) {
    const opts = q.options ? String(q.options).split('|||') : []
    newQuestion.value.options = opts
    if (q.qType === 'SINGLE') {
      newQuestion.value.a = opts.findIndex(opt => opt.trim() === String(q.a).trim())
    } else if (q.qType === 'MULTI') {
      const answers = q.a ? String(q.a).split('|||').map(s => s.trim()) : []
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
  const correctList = String(correctAns).split('|||').map(s => s.trim())
  // 修正：同步標籤解析邏輯
  const currentOpt = /^[a-zA-Z]\./.test(opt) ? opt.split('.')[0].trim() : opt.trim();

  // 特別處理是非題：相容大小寫
  const tfValues = ['true', 'false']
  if (correctList.length === 1 && tfValues.includes(correctList[0].toLowerCase())) {
    return currentOpt.toLowerCase() === correctList[0].toLowerCase()
  }

  return correctList.includes(currentOpt)
}

const cancelEdit = () => {
  editingId.value = null
  newQuestion.value = { q: '', a: null, qType: 'SINGLE', type: 'QUIZ', options: ['', ''], multiIndices: [], points: 10 }
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
      // 立即從本地列表移除，不需要等待 fetchQuestions 回傳，達到「馬上消失」的效果
      questionsList.value = questionsList.value.filter(q => q.id !== id)
    } else {
      alert('刪除失敗：' + (result.message || '找不到該題目 ID'))
    }
  } catch (e) {
    alert('刪除失敗')
  }
}

onMounted(() => {
  fetchQuestions();
  // 首次載入時也獲取成績列表，如果預設顯示成績頁籤
  // fetchGrades(); 
});

// 監聽 activeTab 變化，當切換到 'grades' 時自動獲取成績
watch(activeTab, (newTab) => {
  if (newTab === 'grades') {
    fetchGrades();
  }
});
</script>
<template>
  <div class="teacher-panel">
    <div class="tab-menu">
      <button :class="{ active: activeTab === 'content' }" @click="activeTab = 'content'">📘 編輯課程</button>
      <button :class="{ active: activeTab === 'quiz' }" @click="activeTab = 'quiz'">🎓 測驗題管理</button>
      <button :class="{ active: activeTab === 'grades' }" @click="activeTab = 'grades'">📊 成績</button>
    </div>

    <section class="editor-section">
      <div v-if="activeTab === 'content' && units.length > 0">
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
            <button @click="addContentBlock('text')" class="btn-mini">＋文字</button>
            <button @click="addContentBlock('youtube')" class="btn-mini">＋YouTube</button>
            <button @click="addContentBlock('embed')" class="btn-mini">＋文件/簡報</button>
            <button @click="addContentBlock('video')" class="btn-mini">＋影片連結</button>
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
            
            <textarea 
              v-if="block.type === 'text'" 
              v-model="block.value" 
              placeholder="請在此輸入教學文字或 HTML..."
            ></textarea>
            
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
      
      <div v-if="activeTab === 'quiz'" class="editor-card">
        <div class="editor-header">
          <h3>{{ editingId ? '📝 編輯題目' : '🎓 新增測驗題' }}</h3>
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
            <textarea v-model="newQuestion.q" class="q-textarea" placeholder="例如: Which of the following is an apple?"></textarea>
          </div>

          <div class="form-group">
            <label>配分 (Points)</label>
            <input type="number" v-model="newQuestion.points" class="styled-input" min="1">
          </div>

          <!-- 選擇題區塊 -->
          <div v-if="['SINGLE', 'MULTI'].includes(newQuestion.qType)" class="options-group">
            <label>選項與正確答案 (請勾選正確項)</label>
            <div v-for="(opt, index) in newQuestion.options" :key="index" class="option-item">
              <input 
                v-if="newQuestion.qType === 'SINGLE'" 
                type="radio" 
                :value="index" 
                v-model="newQuestion.a"
              >
              <input 
                v-else 
                type="checkbox" 
                :value="index" 
                v-model="newQuestion.multiIndices"
              >
              <input v-model="newQuestion.options[index]" class="opt-input" :placeholder="'選項 ' + (index+1)">
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
        <button @click="deleteAllGrades" class="delete-all-btn" :disabled="isSaving">🗑️ 刪除所有成績</button>
        <button @click="downloadGradesCSV" class="download-btn">📥 下載 CSV 報表</button>
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
            <button @click="deleteSingleGrade(student.studentName, student.submissionDate)" class="item-del-btn" title="刪除此筆">🗑️</button>
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
                <template v-for="(opt, idx) in String(answer.options).split('|||')" :key="idx">
                  <div v-if="opt.trim()" class="opt-preview-item" :class="{ 'is-correct-answer': isOptionCorrect(opt, answer.correctAnswer) }">
                    <input 
                      :type="answer.qType === 'MULTI' ? 'checkbox' : 'radio'" 
                      :checked="isOptionCorrect(opt, answer.studentAnswer)" 
                      disabled
                      class="preview-input"
                    >
                    <span :class="{ 'is-correct-text': isOptionCorrect(opt, answer.correctAnswer) }">{{ opt.trim() }}</span>
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
        <span class="count-tag">共 {{ questionsList.filter(q => q.type === 'QUIZ').length || 0 }} 題</span>
      </div>
      <div v-for="q in questionsList.filter(q => q.type === 'QUIZ')" :key="q.id" class="q-item">
        <div class="q-info">
          <span class="tag" :class="q.type">{{ q.type === 'PRACTICE' ? '練習' : '測驗' }}</span>
          <span class="tag-outline">{{ typeLabels[q.qType] || q.qType }}</span>
          <p class="q-text">{{ q.q }}</p>
          
          <!-- 確保選項顯示為獨立列表，防止文字擠在一起 -->
          <div v-if="['SINGLE', 'MULTI', 'TF'].includes(q.qType)" class="options-list-preview">
            <template v-for="(opt, idx) in String(q.options || (q.qType === 'TF' ? 'True|||False' : '')).split('|||')" :key="idx">
              <div v-if="opt.trim()" class="opt-preview-item" :class="{ 'is-correct-answer': isOptionCorrect(opt, q.a) }">
                <input 
                  :type="q.qType === 'MULTI' ? 'checkbox' : 'radio'" 
                  :checked="isOptionCorrect(opt, q.a)" 
                  disabled
                  class="preview-input"
                >
                <span :class="{ 'is-correct-text': isOptionCorrect(opt, q.a) }">{{ opt.trim() }}</span>
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
              <div v-if="block.type === 'text'" v-html="(block.value || '').replace(/\n/g, '<br>')" class="text-content"></div>
              
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
                  <source :src="block.value" type="video/mp4">
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
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  border: none;
  border-top: 1px solid #e2e8f0;
  padding: 25px 0;
  border-radius: 0;
  min-height: 80vh;
}
.tab-menu { display: flex; gap: 10px; margin-bottom: 25px; padding: 0 20px; }
.tab-menu button {
  flex: 1; padding: 14px; border: none; background: #fff; border-radius: 12px;
  font-weight: 600; color: #64748b; cursor: pointer; transition: 0.2s;
  box-shadow: 0 4px 6px rgba(0,0,0,0.05);
}
.tab-menu button.active { background: #334155; color: #fff; transform: translateY(-2px); }
.tab-menu button:hover { transform: scale(1.05); }
.tab-menu button.active:hover { transform: translateY(-2px) scale(1.05); }

.editor-section { padding: 0 20px; }
.editor-card { background: var(--surface-strong); padding: 36px; border-radius: calc(var(--border-radius-lg) + 6px); box-shadow: 0 18px 40px rgba(17,24,39,0.06); border: 1px solid rgba(16,24,40,0.03); }
.editor-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.type-picker select { padding: 8px; border-radius: 8px; border: 1px solid #ddd; }

.content-editor-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
.unit-title-input { font-size: 1.2em; font-weight: bold; border: none; border-bottom: 2px solid #e2e8f0; background: transparent; outline: none; padding: 5px; color: #1e293b; }
.unit-title-input:focus { border-color: #3b82f6; }
.unit-manager { margin-bottom: 20px; overflow-x: auto; }
.unit-tabs { display: flex; gap: 8px; padding-bottom: 5px; }
.unit-tab-btn { padding: 8px 16px; border-radius: var(--border-radius-lg); border: 1px solid #dbe7e4; background: #fff; cursor: pointer; white-space: nowrap; transition: 0.2s; }
.unit-tab-btn.active { background: var(--accent-color); color: var(--text-main); border-color: var(--accent-color); }
.unit-tab-btn:hover { transform: scale(1.05); }
.add-unit-btn { padding: 8px 16px; border-radius: var(--border-radius-lg); border: 1px dashed #94a3b8; background: transparent; cursor: pointer; color: #64748b; transition: 0.2s; }
.add-unit-btn:hover { transform: scale(1.05); color: #3b82f6; border-color: #3b82f6; }

.add-buttons { display: flex; gap: 5px; }
.btn-mini { padding: 6px 14px; font-size: 0.85em; cursor: pointer; border-radius: var(--border-radius-lg); border: none; background: #d6e2e9; transition: 0.2s; }
.btn-mini:hover { background: #f1f5f9; transform: scale(1.1); }

.btn-danger-outline { width: 100%; padding: 10px; margin-bottom: 10px; background: #fde2e4; border: none; color: #232946; border-radius: var(--border-radius-lg); cursor: pointer; transition: 0.2s; }
.btn-danger-outline:hover { background: #fad2e1; transform: scale(1.02); }

.blocks-container { display: flex; flex-direction: column; gap: 20px; margin-bottom: 20px; }
.content-block-item { background: #fff1e6; padding: 20px; border-radius: var(--border-radius-lg); border: 1px solid #eddcd2; }
.block-label { display: flex; justify-content: space-between; margin-bottom: 8px; }
.block-type { font-size: 0.8em; font-weight: bold; color: #64748b; }
.btn-remove-block { background: none; border: none; color: #ef4444; cursor: pointer; font-size: 0.8em; }
.hint-text { font-size: 0.75em; color: #94a3b8; margin-top: 5px; }

.save-btn { 
  width: 100%; padding: 14px; background: #3b82f6; color: white; border: none; 
  border-radius: 12px; font-weight: bold; cursor: pointer; font-size: 1em; transition: 0.2s;
  box-shadow: 0 4px 6px rgba(59, 130, 246, 0.2);
}
.save-btn:hover { background: #2563eb; transform: scale(1.02); }
.save-btn:disabled { opacity: 0.6; }

.form-group { margin-bottom: 20px; }
.form-group label { display: block; margin-bottom: 10px; font-weight: 700; color: #334155; }
textarea,
.styled-input {
  width: 100%;
  padding: 18px 20px;
  border-radius: var(--border-radius-lg);
  border: 1px solid var(--border-soft);
  background: var(--surface);
  box-sizing: border-box;
  font-size: 1.02em;
  line-height: 1.5;
  color: var(--text-main);
  transition: box-shadow 0.18s ease, border-color 0.18s ease, transform 0.12s ease;
  box-shadow: 0 6px 18px rgba(17,24,39,0.03);
}
textarea { min-height: 180px; resize: vertical; }
.q-textarea {
  width: 100%;
  min-height: 120px;
  padding: 18px 20px;
  border-radius: var(--border-radius-lg);
  border: 1px solid var(--border-soft);
  background: var(--surface);
  box-shadow: 0 6px 18px rgba(17,24,39,0.03);
  box-sizing: border-box;
  font-size: 1.02em;
  line-height: 1.5;
  color: var(--text-main);
  transition: box-shadow 0.18s ease, border-color 0.18s ease, transform 0.12s ease;
  margin-top: 0;
}

textarea::placeholder, .styled-input::placeholder {
  color: #94a3b8;
  opacity: 1;
}
textarea:focus, .styled-input:focus {
  outline: none;
  border-color: var(--primary-color);
  box-shadow: 0 10px 30px rgba(59,130,246,0.10);
}

.options-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.option-item {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
  padding: 14px 16px;
  /* 預設為米色底 + 淡藍邊框 */
  background: #f5efe5;
  border: 1px solid #bfd7e8;
  border-radius: var(--border-radius-lg);
  transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
}
.option-item:hover {
  background: #f1f7fb;
  border-color: var(--primary-color);
}
.option-item.selected {
  background: #e7f0ff; /* 被標為正確時淡藍底 */
  border-color: var(--primary-color);
}
.option-item input[type="radio"], .option-item input[type="checkbox"] {
  /* 隱藏原生圓點/方塊，讓整格成為點選目標 */
  position: absolute; opacity: 0; width: 0; height: 0; margin: 0; padding: 0; pointer-events: none;
}
/* 使用 :has 偵測所屬 input 的 checked 狀態（現代瀏覽器支援），讓父層變色 */
.option-item:has(input[type="radio"]:checked), .option-item:has(input[type="checkbox"]:checked) {
  background: #e7f0ff;
  border-color: var(--primary-color);
}
.opt-input {
  flex: 1;
  min-width: 0;
  padding: 12px 0;
  border: none;
  background: transparent;
  outline: none;
  color: var(--text-main);
  font-weight: 600;
}
.btn-remove {
  background: none;
  border: none;
  color: #64748b;
  cursor: pointer;
  font-size: 1.1em;
}
.btn-add-option {
  width: 100%;
  padding: 12px 14px;
  margin-top: 14px;
  border: none;
  background: rgba(255,255,255,0.06);
  color: var(--text-main);
  border-radius: 999px;
  cursor: pointer;
  text-align: center;
  box-shadow: inset 0 -1px 0 rgba(255,255,255,0.02);
  transition: transform 0.12s ease, background 0.12s ease;
}
.btn-add-option:hover { transform: translateY(-2px); background: rgba(255,255,255,0.08); }

/* 讓題目第一個 label 置中（題目內容標題） */
.editor-content > .form-group:first-of-type label { text-align: center; font-size: 1.05em; }

.tf-options { display: flex; gap: 15px; }
.tf-options button {
  flex: 1; padding: 12px; border: 2px solid #e2e8f0; border-radius: 12px;
  background: #fff; cursor: pointer; font-weight: bold; transition: 0.2s;
}
.tf-options button:hover { transform: scale(1.05); }
.tf-options button.selected { 
  background: #e7f0ff; 
  color: var(--text-main); 
  border-color: #0b4da0; 
  border-width: 2px;
}

.styled-input {
  width: 100%;
  padding: 14px 20px;
  border-radius: var(--border-radius-lg);
  border: 1px solid var(--border-soft);
  box-sizing: border-box;
  background: var(--surface);
}
.btn-publish {
  width: 100%; padding: 16px; margin-top: 25px; border: none;
  background: #1e293b; color: #fff; border-radius: 12px; font-weight: bold; cursor: pointer; transition: 0.2s;
}
.btn-publish:hover { transform: scale(1.02); background: #0f172a; }
.btn-cancel {
  width: 100%; padding: 10px; margin-top: 10px; border: 1px solid #cbd5e1;
  background: #f8fafc; color: #64748b; border-radius: 12px; font-weight: bold; cursor: pointer; transition: 0.2s;
}
.btn-cancel:hover { background: #f1f5f9; transform: scale(1.02); }
.btn-group { display: flex; flex-direction: column; }

.questions-list { margin-top: 40px; padding: 0 20px; }
.list-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
.count-tag { background: #e2e8f0; padding: 4px 12px; border-radius: 20px; font-size: 0.8em; }
.q-item {
  background: #fff; padding: 20px; border-radius: 15px; margin-bottom: 10px;
  display: flex; justify-content: space-between; align-items: flex-start;
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05);
  border-left: 6px solid #334155;
  text-align: left; /* 確保題目內容置左 */
}
.q-info { flex: 1; padding-right: 20px; }
.tag { 
  display: inline-block; font-size: 0.7em; padding: 2px 8px; border-radius: 5px; font-weight: bold;
  margin-right: 5px; text-transform: uppercase;
}
.tag.PRACTICE { background: #dcfce7; color: #166534; }
.tag.QUIZ { background: #fef9c3; color: #854d0e; }
.q-text { font-weight: bold; margin: 10px 0; white-space: pre-wrap; color: #1e293b; line-height: 1.5; overflow-wrap: break-word; }
.tag-outline {
  display: inline-block;
  font-size: 0.7em;
  padding: 2px 8px;
  border-radius: 5px;
  border: 1px solid #cbd5e1;
  color: #64748b;
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
  font-size: 0.9em; color: var(--text-main); display: flex; align-items: center; gap: 12px; 
  padding: 14px 16px; background: #f5efe5; border-radius: var(--border-radius-lg);
  border: 1px solid #bfd7e8;
  transition: background 0.18s ease, border-color 0.18s ease, box-shadow 0.12s ease;
}
/* 同步學生端：
   - 未選取：米色底 + 淡藍邊框
   - 當下選取（作答中）：深藍框 + 淡藍底
   - 批改後正確：深藍框 + 淡藍底
   - 批改後學生選取但錯誤：深藍框 + 米色底
*/
.opt-preview-item.is-chosen.is-correct-answer,
.opt-preview-item.is-correct-answer.is-chosen {
  background: #e7f0ff;
  border-color: #0b4da0;
  border-width: 2px;
  font-weight: bold;
}
.opt-preview-item.is-correct-answer {
  background: #e7f0ff;
  border-color: #0b4da0;
  border-width: 2px;
  font-weight: bold;
}
.opt-preview-item.is-chosen {
  background: #e7f0ff;
  border-color: var(--primary-color);
}
.opt-preview-item.is-chosen:not(.is-correct-answer) {
  background: #f5efe5;
  border-color: var(--primary-color);
}
.preview-input { display: none; }
.is-correct-text { color: var(--text-main); font-weight: 700; }

.ans-hint { font-size: 0.85em; margin-top: 8px; display: flex; gap: 5px; }
.ans-label { color: #64748b; }
.ans-value { color: #10b981; font-weight: bold; }

.q-actions { display: flex; gap: 8px; }
.del-btn { padding: 6px 12px; background: #fee2e2; color: #ef4444; border: none; border-radius: 12px; cursor: pointer; transition: 0.2s; }
.del-btn:hover { transform: scale(1.1); background: #fecaca; }
.edit-btn { padding: 6px 12px; background: #e0f2fe; color: #0284c7; border: none; border-radius: 12px; cursor: pointer; transition: 0.2s; }
.edit-btn:hover { transform: scale(1.1); background: #bae6fd; }

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
    border-top: 1px solid #f1f5f9; 
    justify-content: stretch;
  }
  .q-actions button { flex: 1; padding: 10px; font-size: 0.95em; }
  
  .tab-menu { gap: 8px; }
  .tab-menu button { padding: 12px 8px; font-size: 0.85em; }
}

/* 新增的成績頁籤樣式 */
.grades-section {
  background: #fff;
  padding: 30px;
  border-radius: 20px;
  box-shadow: 0 10px 25px rgba(0,0,0,0.05);
  margin: 25px 20px 0 20px;
}
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
.download-btn {
  background: #10b981;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 12px;
  cursor: pointer;
  font-weight: bold;
  transition: 0.2s;
}
.download-btn:hover { background: #059669; transform: scale(1.05); }
.delete-all-btn {
  background: #ef4444;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 12px;
  cursor: pointer;
  font-weight: bold;
  transition: 0.2s;
  margin-right: 10px;
}
.submission-record {
  border-top: 1px dashed #cbd5e1;
  padding-top: 20px;
  margin-top: 20px;
}
.delete-all-btn:hover { background: #dc2626; }
.delete-all-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.grades-list {
  margin-top: 20px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
}
.grade-item {
  display: grid;
  grid-template-columns: 2fr 1fr 1.5fr 1fr;
  align-items: center;
  padding: 12px 15px;
  border-bottom: 1px solid #f1f5f9;
}
.grade-item.header {
  background: #f8fafc;
  font-weight: bold;
  color: #475569;
}
.grade-actions {
  display: flex;
  gap: 5px;
  justify-content: flex-end;
}
.item-del-btn {
  background: #fff;
  border: 1px solid #fee2e2;
  color: #ef4444;
  padding: 4px 8px;
  border-radius: 12px;
  cursor: pointer;
  transition: 0.2s;
}
.item-del-btn:hover {
  background: #fee2e2; transform: scale(1.2);
}
.grade-item:last-child {
  border-bottom: none;
}
.view-details-btn {
  background: #3b82f6;
  color: white;
  border: none;
  padding: 6px 12px;
  border-radius: 12px;
  cursor: pointer;
  font-size: 0.9em;
  transition: 0.2s;
}
.view-details-btn:hover { transform: scale(1.05); background: #2563eb; }
.student-details-card {
  margin-top: 30px;
  background: #f8fafc;
  padding: 20px;
  border-radius: 15px;
  box-shadow: 0 4px 10px rgba(0,0,0,0.05);
}
.student-details-card h4 {
  margin-top: 0;
  color: #1e293b;
}
.detailed-answer-item {
  border-left: 4px solid #a78bfa; /* 不同於普通題目的顏色 */
}
.wrong-ans {
  color: #ef4444;
}
.submission-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f1f5f9;
  padding: 0 15px;
  border-radius: 8px;
}
.del-record-btn {
  background: #fee2e2;
  color: #b91c1c;
  border: none;
  padding: 5px 10px;
  border-radius: 12px;
  font-size: 0.8em;
  cursor: pointer;
  transition: 0.2s;
}
.del-record-btn:hover { transform: scale(1.1); background: #fecaca; }
.btn-cancel-details {
  margin-top: 20px;
  background: #e2e8f0; color: #475569; border: none; padding: 8px 15px; border-radius: 12px; cursor: pointer; transition: 0.2s;
}
.btn-cancel-details:hover { transform: scale(1.05); background: #cbd5e1; }

/* 預覽彈窗樣式 */
.btn-preview {
  background: #3b82f6 !important;
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
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  padding: 20px;
  backdrop-filter: blur(4px);
}

.preview-modal {
  background: #f1f5f9;
  width: 100%;
  max-width: 900px;
  max-height: 90vh;
  border-radius: 24px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
}

.modal-header {
  padding: 20px 25px;
  background: #fff;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.close-btn {
  background: none;
  border: none;
  font-size: 2rem;
  cursor: pointer;
  color: #94a3b8;
  line-height: 1;
  transition: 0.2s;
}
.close-btn:hover { color: #1e293b; transform: scale(1.1); }

.modal-body {
  padding: 25px;
  overflow-y: auto;
  flex: 1;
}

.student-style-preview {
  background: #fff;
  padding: 30px;
  border-radius: 16px;
  min-height: 400px;
  box-shadow: 0 4px 6px rgba(0,0,0,0.05);
}

.preview-block { margin-bottom: 30px; }
.text-content { line-height: 1.8; color: #1e293b; font-size: 1.05em; }
.video-container {
  position: relative;
  padding-bottom: 56.25%;
  height: 0;
  border-radius: 12px;
  overflow: hidden;
  background: #000;
}
.video-container iframe { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
.embed-container-preview { border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; }
.embed-fallback { padding: 40px; text-align: center; background: #f8fafc; color: #64748b; }
</style>