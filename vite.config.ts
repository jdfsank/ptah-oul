import { defineConfig, loadEnv } from 'vite'
export default defineConfig(({ mode }) => {
  const { PORT } = loadEnv(mode, process.cwd(), 'PORT')
  return {
    server: {
      proxy: {
        '/api': 'http://127.0.0.1:' + (process.env.PORT || PORT || '8787'),
      },
    },
    build: { chunkSizeWarningLimit: 850 },
  }
})
