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

  // Vite rejects requests whose Host header it doesn't recognise (DNS-rebinding
  // protection). Behind a platform ingress (Azure Container Apps, etc.) the Host
  // is the public domain, so allow the deployed domain(s). Override with a
  // comma-separated VITE_ALLOWED_HOSTS, or set it to "true"/"*" to allow any
  // host. Localhost is always allowed.
  const allowedHosts: string[] | true = (() => {
    const raw = (
      process.env.VITE_ALLOWED_HOSTS ||
      env.VITE_ALLOWED_HOSTS ||
      ''
    ).trim()
    if (!raw) return ['.azurecontainerapps.io']
    if (raw === 'true' || raw === '*') return true
    return raw
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean)
  })()

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: { proxy, allowedHosts },
    preview: {
      host: true,
      port: 4173,
      proxy,
      allowedHosts,
    },
  }
})
