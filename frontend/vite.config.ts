import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig(({ mode }) => {
  // Load every env var (not just VITE_*) so the proxy target can be configured
  // with VITE_BACKEND_URL without exposing anything to the client bundle.
  const env = loadEnv(mode, __dirname, '')
  const backendUrl = env.VITE_BACKEND_URL?.trim() || 'http://localhost:4000'

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    // Same-origin /api calls let the browser send the HTTP-only session cookie.
    // The dev server proxies those calls to VITE_BACKEND_URL (a local backend by
    // default, or a deployed one; see frontend/.env.example).
    server: {
      proxy: {
        '/api': {
          target: backendUrl,
          changeOrigin: true,
          secure: true,
        },
      },
    },
  }
})
