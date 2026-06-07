<script setup>
import { ref, reactive } from 'vue'

const emit = defineEmits(['login-success'])
const API_URL = 'https://script.google.com/macros/s/AKfycby3pSgIy6Gs5EK3SxWTg-o1SCzDHSVQORDGrDI03Xa7wqCQcTmxiLyF2leq1_SQ4ClM/exec'

const activeRole = ref('student') // 預設為學生
const loading = ref(false)
const showDropdown = ref(false)
const presets = ['認識ABC', '日常英文', '英文歌學英文']

const formData = reactive({
  email: '',
  name: '',
  courseCode: ''
})

const selectPreset = (code) => {
  formData.courseCode = code
  showDropdown.value = false
}

const handleLogin = async () => {
  if (!formData.courseCode) return alert('請輸入課程代碼')

  // 檢查特定課程的教師權限
  if (activeRole.value === 'teacher' && presets.includes(formData.courseCode)) {
    if (formData.email !== 'mia998508mia@gmail.com') {
      alert('您沒有此課程的編輯權限')
      return
    }
  }
  
  loading.value = true
  try {
    // 這裡發送請求到 GAS 驗證或初始化課程
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'login',
        role: activeRole.value,
        ...formData
      })
    })

    const result = await response.json()
    
    if (result.status !== 'success') {
      alert(result.message || '登入失敗')
      return
    }

    emit('login-success', {
      role: activeRole.value,
      courseCode: formData.courseCode,
      userData: { name: formData.name || formData.email }
    })
  } catch (error) {
    console.error('Login error:', error)
    alert('登入發生錯誤')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-screen">
    <div class="preset-container">
      <button type="button" class="preset-toggle" @click="showDropdown = !showDropdown">
        課程推薦 ▾
      </button>
      <div v-if="showDropdown" class="preset-menu">
        <div v-for="item in presets" :key="item" @click="selectPreset(item)" class="preset-item">
          {{ item }}
        </div>
      </div>
    </div>
    <div class="login-box">
      <div class="login-header">
        <h1>英文課程系統</h1>
      </div>
      <div class="role-selector">
        <button :class="{ active: activeRole === 'teacher' }" @click="activeRole = 'teacher'">我是教師</button>
        <button :class="{ active: activeRole === 'student' }" @click="activeRole = 'student'">我是學生</button>
      </div>

      <form @submit.prevent="handleLogin" class="login-form">
        <div v-if="activeRole === 'teacher'">
          <label>教師信箱</label>
          <input v-model="formData.email" type="email" placeholder="example@email.com" required>
        </div>
        
        <div v-else>
          <label>學生姓名</label>
          <input v-model="formData.name" type="text" placeholder="輸入你的姓名" required>
        </div>

        <div>
          <label>課程代碼</label>
          <input v-model="formData.courseCode" type="text" placeholder="請輸入課程代碼" required>
        </div>

        <button type="submit" :disabled="loading">
          {{ loading ? '登入中...' : '登入課程' }}
        </button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.login-screen {
  width: 100%;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent; /* 移除自己的背景，改用 App.vue 的全域畫布背景 */
  padding: 20px;
  box-sizing: border-box;
  overflow-y: auto;
}

.login-box {
  max-width: 400px;
  width: 100%;
  padding: 3rem;
  background: var(--surface);
  border-radius: var(--border-radius-lg);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.05);
  text-align: left;
  transition: var(--transition);
}

.login-header {
  text-align: center;
}

h1 {
  color: var(--text-main);
  margin-bottom: 30px;
  font-weight: 800;
  font-size: 2rem;
  text-shadow: 2px 2px 4px rgba(0,0,0,0.1);
}

.role-selector {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
}
.role-selector button {
  flex: 1;
  padding: 12px;
  cursor: pointer;
  border: 2px solid var(--border);
  background: var(--surface-soft);
  border-radius: var(--border-radius-sm);
  transition: all 0.2s ease;
  font-weight: 600;
}
.role-selector button:hover {
  transform: scale(1.05);
}
.role-selector button.active {
  background: var(--primary-color);
  color: var(--text-main);
  border-color: var(--primary-color);
  box-shadow: 0 4px 12px rgba(153, 193, 222, 0.3);
}
.login-form {
  text-align: left;
}
.login-form div {
  margin-bottom: 15px;
}
.login-form label {
  display: block;
  margin-bottom: 5px;
  font-size: 0.9em;
  color: var(--primary-color);
  font-weight: 600;
}
.login-form input {
  width: 100%;
  padding: 12px;
  margin-top: 5px;
  box-sizing: border-box;
  border: 2px solid var(--border);
  background: var(--surface-soft); /* 輸入框使用柔和背景，增加層次感 */
  border-radius: var(--border-radius-sm);
  outline: none;
  transition: border-color 0.2s;
}
.login-form input:focus {
  border-color: var(--primary-color);
  background: var(--surface);
}
.login-form button[type="submit"] {
  width: 100%;
  padding: 14px;
  background: var(--primary-color);
  color: var(--surface);
  border: none;
  border-radius: var(--border-radius-sm);
  font-size: 1em;
  font-weight: bold;
  cursor: pointer;
  margin-top: 10px;
  transition: all 0.2s ease;
}
.login-form button[type="submit"]:hover {
  background: var(--accent-color);
  transform: translateY(-2px) scale(1.02);
  box-shadow: 0 8px 15px rgba(197, 222, 221, 0.4);
}

/* 響應式手機版調整 */
@media (max-width: 480px) {
  .login-box {
    padding: 1.5rem;
  }
  
  h1 {
    font-size: 1.5rem;
    margin-bottom: 20px;
  }
}

.preset-container {
  position: absolute;
  top: 20px;
  right: 20px;
  z-index: 100;
}
.preset-toggle {
  background: var(--surface);
  border: 1px solid var(--border);
  padding: 8px 15px;
  border-radius: var(--border-radius-sm);
  cursor: pointer;
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}
.preset-menu {
  position: absolute;
  top: 100%;
  right: 0;
  background: white;
  border: 1px solid var(--border);
  border-radius: var(--border-radius-sm);
  margin-top: 5px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  min-width: 150px;
}
.preset-item {
  padding: 10px 15px;
  cursor: pointer;
  transition: background 0.2s;
  white-space: nowrap;
  color: var(--text-main);
}
.preset-item:hover {
  background: var(--surface-soft);
}
</style>