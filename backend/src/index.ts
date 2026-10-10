import * as dotenv from 'dotenv';
dotenv.config();

import { createApplication } from './app';
import { initializeDatabase } from './db';

const app = createApplication();
const PORT = process.env.PORT || 4000;
async function startServer(): Promise<void> {
  try {
    await initializeDatabase();
    app.listen(PORT, () => console.log(`✓ Server listening on port ${PORT}`));
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}
void startServer();
