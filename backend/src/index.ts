import express, { Application } from 'express';
import cors from 'cors';
import { initializeDatabase } from './db';
import homeRoutes from './routes/homeRoutes';
import roomRoutes from './routes/roomRoutes';
import adminRoutes from './routes/adminRoutes';

const app: Application = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.use('/', homeRoutes);
app.use('/rooms', roomRoutes);
app.use('/api/admin', adminRoutes);

// Initialize database and start server
async function startServer(): Promise<void> {
  try {
    await initializeDatabase();
    app.listen(PORT, () => {
      console.log(`✓ Server listening on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
