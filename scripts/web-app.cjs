const express = require('express');
const path = require('node:path');
const fs = require('node:fs');

// Azure App Service exposes one HTTP port. Serve the Vite build and the API
// on that origin so the existing session cookies work without a proxy.
function createWebApplication(backend, frontendDir = path.resolve(__dirname, '../frontend/dist')) {
  const index = path.join(frontendDir, 'index.html');
  if (!fs.existsSync(index)) throw new Error('Frontend build missing. Run npm run build before npm start.');
  const app = express();
  const assets = express.static(frontendDir, { index: false });
  const isApi = req => req.path === '/api' || req.path.startsWith('/api/');
  app.use((req, res, next) => isApi(req) ? next() : assets(req, res, next));
  app.get('*', (req, res, next) => {
    // API errors and missing assets must never be replaced with index.html.
    // JSON clients also retain the legacy GET / and GET /rooms API contracts.
    if (isApi(req) || path.extname(req.path) || !req.accepts('html')) return next();
    res.sendFile(index);
  });
  app.use(backend);
  return app;
}

module.exports = { createWebApplication };
