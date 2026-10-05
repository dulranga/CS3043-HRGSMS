import express, { Application } from 'express';
import cors from 'cors';
import { initializeDatabase, pool } from './db';
import { createAuthFromEnv } from './auth';
import {
  ADMIN_ROUTE_POLICY,
  REPORT_ROUTE_POLICY,
  createAuthorization,
  requireGuestOrStaff,
  requireStaff,
  sessionBranchId,
  sessionUserId,
} from './authorization';
import { createAuthRouter } from './routes/authRoutes';
import { createGuestRegistrationFromEnv } from './guestRegistration';
import { createGuestRegistrationRouter } from './routes/guestRegistrationRoutes';
import { createGuestProfiles } from './guestProfiles';
import { createGuestProfileRouter } from './routes/guestProfileRoutes';
import { createGuestAccount } from './guestAccount';
import { createGuestAccountRouter } from './routes/guestAccountRoutes';
import homeRoutes from './routes/homeRoutes';
import roomRoutes from './routes/roomRoutes';
import adminRoutes from './routes/adminRoutes';
import reportRoutes from './routes/reportRoutes';

import { createInvoiceRouter } from './routes/invoiceRoutes';
import { createPaymentRouter } from './routes/paymentRoutes';
import { createCheckoutRouter } from './routes/checkoutRoutes';
import { createCatalogueRouter } from './routes/catalogueRoutes';
import { createRoomInventoryRouter } from './routes/roomInventoryRoutes';
import availabilityRoutes from './routes/availabilityRoutes';

const app: Application = express();
const PORT = process.env.PORT || 4000;
export const auth = createAuthFromEnv(pool);
const authorization = createAuthorization(auth.authenticate);

app.use(cors());
app.use(express.json());

app.use('/', homeRoutes);
app.use('/api/auth', createAuthRouter(auth));
app.use('/api', createGuestRegistrationRouter(createGuestRegistrationFromEnv(pool), {
  requireLinkIssuer: authorization.staff('guest.link.issue'),
}));
app.use('/api', createGuestProfileRouter(createGuestProfiles({ db: pool }), {
  requireGuestManager: authorization.staff('guest.manage'),
}));
app.use('/api/guest/profile', createGuestAccountRouter(createGuestAccount({ db: pool }), {
  requireGuest: authorization.guest,
}));
app.use('/rooms', roomRoutes);
app.use('/api/admin', authorization.policy(ADMIN_ROUTE_POLICY), adminRoutes);
app.use('/api/reports', authorization.policy(REPORT_ROUTE_POLICY), reportRoutes);
app.use('/api', createInvoiceRouter({
  authenticate: auth.authenticate,
  authorizeBooking: requireGuestOrStaff(['invoice.read.branch', 'invoice.read.chain']),
}));
app.use('/api', createPaymentRouter({
  authenticate: auth.authenticate,
  authorizeStaff: requireStaff('payment.record'),
}));
app.use('/api', createCheckoutRouter({
  authenticate: auth.authenticate,
  authorizeStaff: requireStaff('checkout.perform'),
}));
app.use('/api', createCatalogueRouter({
  requireRead: authorization.authenticated,
  requireChainManager: authorization.staff('catalogue.write'),
}));
app.use('/api', createRoomInventoryRouter(
  {
    requireBranchRead: authorization.staff('room.read'),
    requireBranchManager: authorization.staff('room.write'),
  },
  { branchId: sessionBranchId, actorId: sessionUserId },
));
app.use('/api', availabilityRoutes);
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
