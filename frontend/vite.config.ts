import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig(({ mode }) => {
  // The frontend always calls same-origin `/api` (so the HTTP-only session
  // cookie is sent); the dev and preview servers proxy those calls to the
  // backend. Point them at a remote backend with VITE_BACKEND_URL — read from
  // the process environment (containers) or a local .env file (see
  // frontend/.env.example). Defaults to a local backend on port 4000.
  const env = loadEnv(mode, __dirname, '')
  const backendUrl =
    (process.env.VITE_BACKEND_URL || env.VITE_BACKEND_URL || '').trim() ||
    'http://localhost:4000'
  const proxy = {
    '/api': {
      target: backendUrl,
      changeOrigin: true,
      secure: true,
    },
  }

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: { proxy },
    preview: {
      host: true,
      port: 4173,
      proxy,
    },
  }
})
