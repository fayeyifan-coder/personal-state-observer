import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_')
  return {
    plugins: [react()],
    base: env.VITE_ISOLATED_LAB === '1' ? '/' : '/personal-state-observer/'
  }
})
