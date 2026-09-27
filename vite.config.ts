import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 必须加上这行，前后都要有斜杠。请换成你真实的 GitHub 仓库名
  base: '/personal-state-observer/', 
})