import express, { Application } from 'express';
import cors from 'cors';
import { initializeDatabase } from './db';
import homeRoutes from './routes/homeRoutes';
import roomRoutes from './routes/roomRoutes';
import adminRoutes from './routes/adminRoutes';
import reportRoutes from './routes/reportRoutes';
import invoiceRoutes from './routes/invoiceRoutes';
import paymentRoutes from './routes/paymentRoutes';
import checkoutRoutes from './routes/checkoutRoutes';
import availabilityRoutes from './routes/availabilityRoutes';
import serviceUsageRoutes from './routes/serviceUsageRoutes';

const app: Application = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.use('/', homeRoutes);
app.use('/rooms', roomRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api', invoiceRoutes);
app.use('/api', paymentRoutes);
app.use('/api', checkoutRoutes);
app.use('/api', availabilityRoutes);
app.use('/api', serviceUsageRoutes);
// M2/M3 protected route factories await Member 1's production session middleware.
// Mount service, check-in and active-stay routers only with authenticated actors.

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
