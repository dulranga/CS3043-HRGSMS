require('dotenv').config();
const { createWebApplication } = require('./web-app.cjs');
const { createApplication } = require('../backend/dist/app.js');
const { initializeDatabase } = require('../backend/dist/db.js');

async function start() {
  const app = createWebApplication(createApplication());
  await initializeDatabase();
  const port = Number(process.env.PORT || 4000);
  app.listen(port, '0.0.0.0', () => console.log(`SkyNest web application listening on port ${port}`));
}

start().catch(error => {
  console.error('Failed to start web application:', error.message);
  process.exit(1);
});
