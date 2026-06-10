<script setup>
import { ref, reactive } from 'vue'
import LoginView from './components/LoginView.vue'
import TeacherDashboard from './components/TeacherDashboard.vue'
import StudentDashboard from './components/StudentDashboard.vue'

// 登入狀態管理
const auth = reactive({
  isLoggedIn: false,
  role: '', // 'teacher' 或 'student'
  userData: null,
  courseCode: ''
})

// 處理登入成功
const handleLogin = (data) => {
  auth.role = data.role
  auth.courseCode = data.courseCode
  auth.userData = data.userData
  auth.isLoggedIn = true
}

// 登出
const logout = () => {
  auth.isLoggedIn = false
  auth.role = ''
  auth.courseCode = ''
  auth.userData = null
}
</script>

<template>
  <div class="app-wrapper" :class="{ 'auth-centered': !auth.isLoggedIn }" lang="en">
    <!-- 未登入：顯示登入畫面 -->
    <LoginView 
      v-if="!auth.isLoggedIn" 
      @login-success="handleLogin" 
    />

    <!-- 已登入：依角色顯示對應看板 -->
    <div v-else class="app-container" :class="{ 'is-teacher': auth.role === 'teacher' }">
      <nav class="nav-bar">
        <div class="nav-info">
          <span class="badge">課程代碼: {{ auth.courseCode }}</span>
          <span class="role-tag">{{ auth.role === 'teacher' ? '教師模式' : '學生模式' }}</span>
        </div>
        <div class="nav-right">
          <span class="user-name">{{ auth.userData?.name }}</span>
          <button @click="logout" class="logout-btn">登出</button>
        </div>
      </nav>

      <main class="main-content">
        <TeacherDashboard 
        v-if="auth.role === 'teacher'" 
        :course-code="auth.courseCode" 
      />
      
      <StudentDashboard 
        v-else 
        :course-code="auth.courseCode" 
        :student-name="auth.userData.name"
      />
      </main>
    </div>
  </div>
</template>

<style>
:root {
  --primary-color: #99c1de;    /* 主色：天空藍 */
  --primary-strong: #bcd4e6;   /* 深主色 */
  --accent-color: #c5dedd;     /* 強調色：薄荷綠 */
  --accent-warm: #fad2e1;      /* 溫暖色：粉紅 */
  --danger-soft: #fde2e4;      /* 錯誤色：淺粉 */
  --surface: #fff1e6;          /* 卡片表面：象牙白 */
  --surface-soft: #dbe7e4;     /* 柔軟表面：霧灰綠 */
  --surface-muted: #d6e2e9;    /* 靜默表面：淺藍灰 */
  --surface-strong: #eddcd2;   /* 強力表面：杏仁色 */
  --bg-color: #f0efeb;         /* 全域背景：骨白 */
  --card-bg: rgba(255, 241, 230, 0.92);
  --text-main: #2f3a48;
  --text-muted: #5f6c7b;
  --border: #dbe7e4;           /* 邊框顏色 */
  --border-soft: #eddcd2;      /* 軟邊框 */
  --border-strong: #bcd4e6;    /* 強邊框 */
  --border-radius-lg: 16px;    /* 統一容器與卡片圓角 */
  --border-radius-sm: 16px;    /* 統一按鈕與輸入框圓角，確保視覺一致 */
  --transition: all 0.3s ease;
}

html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  min-height: 100vh;
  background: linear-gradient(135deg, #f0efeb 0%, #d6e2e9 50%, #99c1de 100%) !important;
  background-attachment: fixed;
  color: var(--text-main);
  overflow-x: hidden;
}

*, *::before, *::after {
  box-sizing: border-box;
}

/* 修正登入畫面的標題字體與擠壓問題 */
.login-container h1, .login-card h2, .login-view h1 {
  white-space: nowrap;        /* 強制不換行 */
  letter-spacing: 2px;        /* 增加字距，解決擠在一起的問題 */
  margin-bottom: 30px;
  font-weight: 800;
  color: var(--text-main);
  text-align: center;
  width: 100%;
}

.app-wrapper {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  min-height: 100vh;
  width: 100%;
}

.auth-centered {
  display: flex;
  align-items: center;
  justify-content: center;
}

.app-container {
  width: 100%;
  padding: 0;
}

.nav-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 5%;
  background: var(--card-bg);
  color: var(--text-main);
  margin-bottom: 2rem;
  border-radius: 0 0 var(--border-radius-lg) var(--border-radius-lg);
  box-shadow: 0 2px 10px rgba(0,0,0,0.03);
  width: 100%;
  border-bottom: 1px solid var(--border-strong);
}

.is-teacher .nav-bar {
  border-radius: 0;
}

.nav-info {
  display: flex;
  gap: 12px;
  align-items: center;
}

.badge {
  background: var(--accent-color);
  color: var(--text-main);
  padding: 6px 14px;
  border-radius: var(--border-radius-lg);
  font-weight: 700;
  font-size: 0.9em;
}

.role-tag {
  color: var(--text-muted);
  font-weight: 500;
}

.nav-right {
  display: flex;
  align-items: center;
  gap: 15px;
}

.main-content {
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 5% 3rem; /* 增加底部與兩側間距 */
}

.user-name {
  font-weight: 600;
}

.logout-btn {
  background: var(--surface-strong);
  color: var(--text-main);
  border: none;
  padding: 10px 20px;
  border-radius: var(--border-radius-lg);
  font-weight: 700;
  cursor: pointer;
  transition: var(--transition);
}

.logout-btn:hover {
  background: var(--accent-warm);
  transform: translateY(-2px) scale(1.05);
  box-shadow: 0 4px 12px rgba(173, 123, 133, 0.25);
}

@media (max-width: 768px) {
  .nav-bar { padding: 1rem 3%; }
  .main-content { padding: 0 3% 2rem; }
  .nav-bar {
    flex-direction: column;
    gap: 10px;
    text-align: center;
    border-radius: 0;
  }
}
</style>
