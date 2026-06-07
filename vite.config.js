import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
  // 這裡的名稱必須與你在 GitHub 上的 Repository (倉庫) 名稱一致
  // 例如你的倉庫叫 interactive-english-system
  base: '/114-2/', 
  plugins: [vue()],
})
