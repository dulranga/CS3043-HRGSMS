import express, { Application } from 'express';
import cors from 'cors';
import { pool } from './db';
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
import { createOnlineGuestBookingReadRouter } from './routes/onlineGuestBookingReadRoutes';
import { createStaffAccounts } from './staffAccounts';
import { createStaffAccountRouter } from './routes/staffAccountRoutes';
import { createBranches } from './branches';
import { createBranchRouter } from './routes/branchRoutes';
import homeRoutes from './routes/homeRoutes';
import roomRoutes from './routes/roomRoutes';
import adminRoutes from './routes/adminRoutes';
import reportRoutes from './routes/reportRoutes';

import { createInvoiceRouter } from './routes/invoiceRoutes';
import { createPaymentRouter } from './routes/paymentRoutes';
import { createCheckoutRouter } from './routes/checkoutRoutes';
import { createCatalogueRouter } from './routes/catalogueRoutes';
import { createRoomInventoryRouter } from './routes/roomInventoryRoutes';
import { createCancellationRouter } from './routes/cancellationRoutes';
import { createNoShowRouter } from './routes/noShowRoutes';
import availabilityRoutes from './routes/availabilityRoutes';
import serviceUsageRoutes from './routes/serviceUsageRoutes';
import { createBookingCreateRouter } from './routes/bookingCreateRoutes';
import { createBookingReadRouter } from './routes/bookingReadRoutes';
import { createBookingModificationRouter } from './routes/bookingModificationRoutes';
import { createOnlineGuestBookingRouter } from './routes/onlineGuestBookingCreateRoutes';
import { createCheckInRouter } from './routes/checkInRoutes';
import { createActiveStayRouter } from './routes/activeStayRoutes';
import { createServiceRouter } from './routes/serviceRoutes';
import { createRoomConditionRouter } from './routes/roomConditionRoutes';

export function createApplication(env: NodeJS.ProcessEnv = process.env): Application {
  const app: Application = express();
  const auth = createAuthFromEnv(pool, env);
  const authorization = createAuthorization(auth.authenticate);

  app.use(cors());
  app.use(express.json());

  app.use('/', homeRoutes);
  app.use('/api/auth', createAuthRouter(auth));
  app.use('/api', createGuestRegistrationRouter(createGuestRegistrationFromEnv(pool, env), {
    requireLinkIssuer: authorization.staff('guest.link.issue'),
  }));
  app.use('/api', createGuestProfileRouter(createGuestProfiles({ db: pool }), {
    requireGuestManager: authorization.staff('guest.manage'),
  }));
  app.use('/api/guest/profile', createGuestAccountRouter(createGuestAccount({ db: pool }), {
    requireGuest: authorization.guest,
  }));
  // M1-S18: expose Member 2's read-only online guest booking list/detail (M2-S14)
  // behind Member 1's production guest session middleware. Ownership is derived
  // from the authenticated user; no client-supplied guest id is accepted.
  app.use('/api/guest', createOnlineGuestBookingReadRouter(
    { requireOnlineGuest: authorization.guest },
    { authenticatedUserId: sessionUserId },
  ));
  app.use('/api', createStaffAccountRouter(createStaffAccounts({ db: pool }), {
    requireRead: authorization.staff('account.read'),
    requireWrite: authorization.staff('account.write'),
  }));
  app.use('/api', createBranchRouter(createBranches({ db: pool }), {
    requireRead: authorization.staff('branch.read'),
    requireWrite: authorization.staff('branch.write'),
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
  // Member 4's cancellation and no-show engines and Member 3's service-usage
  // router enforce branch and ownership rules from the verified session
  // principal (req.user). Cancellation and no-show are mounted behind the same
  // shared role-grant middleware as every other protected route, so the matrix
  // alone decides who may reach them; the services keep the resource-derived
  // branch/ownership check. No header or client-supplied identity reaches them
  // in production.
  app.use('/api', createCancellationRouter(undefined, authorization.guestOrStaff('booking.cancel')));
  app.use('/api', createNoShowRouter(undefined, authorization.staff('booking.no_show')));
  app.use('/api', authorization.authenticated, serviceUsageRoutes);
  const staffBookingContext = { branchId: sessionBranchId, actorId: sessionUserId };
  app.use('/api', createBookingCreateRouter({ requireFrontDesk: authorization.staff('booking.manage') }, staffBookingContext));
  app.use('/api', createBookingReadRouter({ requireFrontDesk: authorization.staff('booking.manage') }, staffBookingContext));
  app.use('/api', createBookingModificationRouter({
    requireFrontDesk: authorization.staff('booking.manage'),
    requireReservationMoveStaff: authorization.staff(['booking.manage', 'discount.apply']),
  }, staffBookingContext));
  app.use('/api/guest', createOnlineGuestBookingRouter({ requireOnlineGuest: authorization.guest }, { authenticatedUserId: sessionUserId }));
  app.use('/api', createCheckInRouter(authorization.staff('booking.check_in')));
  app.use('/api', createActiveStayRouter(authorization.staff(['room.read', 'invoice.read.chain'])));
  app.use('/api/services', createServiceRouter({ requireRead: authorization.authenticated, requireChainManager: authorization.staff('catalogue.write') }));
  app.use('/api', createRoomConditionRouter(authorization.staff('room.condition.write')));

  return app;
}
