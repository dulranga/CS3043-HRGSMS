import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import RootLayout from './components/RootLayout';
import IndexPage from './routes/IndexPage';
import RoomsPage from './routes/RoomsPage';
import CheckInPage from './routes/CheckInPage';
import ActiveStayPage from './routes/ActiveStayPage';
import CheckoutPage from './routes/CheckoutPage';
import CancellationPage from './routes/CancellationPage';
import NoShowPage from './routes/NoShowPage';
import GuestBookingsPage from './routes/GuestBookingsPage';
import ServiceCataloguePage from './routes/ServiceCataloguePage';
import ServiceUsagePage from './routes/ServiceUsagePage';
import UIRoutePage from './routes/UIRoutePage';
import DashboardPage from './routes/DashboardPage';
import AdminConfigPage from './routes/AdminConfigPage';
import AuditLogPage from './routes/AuditLogPage';
import AdminOperationsPage from './routes/AdminOperationsPage';
import ReportsPage from './routes/ReportsPage';
import InvoiceDetailPage from './routes/InvoiceDetailPage';
import PaymentPage from './routes/PaymentPage';

const rootRoute = createRootRoute({
  component: RootLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: IndexPage,
});

const roomsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/rooms',
  component: RoomsPage,
});

const checkInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/check-in',
  component: CheckInPage,
});

const activeStayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/stays',
  component: ActiveStayPage,
});

const checkoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/checkout',
  component: CheckoutPage,
});

const cancellationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cancellation',
  component: CancellationPage,
});

const noShowRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/no-show',
  component: NoShowPage,
});

const guestBookingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/guest/my-bookings',
  component: GuestBookingsPage,
});

const uiRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ui',
  component: UIRoutePage,
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard',
  component: DashboardPage,
});

const adminConfigRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/config',
  component: AdminConfigPage,
});

const auditLogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/audit',
  component: AuditLogPage,
});

const adminOperationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/operations',
  component: AdminOperationsPage,
});

const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/reports',
  component: ReportsPage,
});

const invoiceDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/billing/invoice',
  component: InvoiceDetailPage,
});

const paymentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/billing/payments',
  component: PaymentPage,
});

const serviceCatalogueRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/services',
  component: ServiceCataloguePage,
});

const serviceUsageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/service-usage',
  component: ServiceUsagePage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  roomsRoute,
  checkInRoute,
  activeStayRoute,
  checkoutRoute,
  cancellationRoute,
  noShowRoute,
  guestBookingsRoute,
  uiRoute,
  dashboardRoute,
  adminConfigRoute,
  auditLogRoute,
  adminOperationsRoute,
  reportsRoute,
  serviceCatalogueRoute,
  serviceUsageRoute,
  invoiceDetailRoute,
  paymentRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}