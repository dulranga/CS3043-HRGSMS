import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import RootLayout from './components/RootLayout';
import DashboardLayout from './components/layout/DashboardLayout';
import IndexPage from './routes/IndexPage';
import RoomsPage from './routes/RoomsPage';
import StaffBookingCreatePage from './routes/StaffBookingCreatePage';
import StaffBookingRecordsPage from './routes/StaffBookingRecordsPage';
import StaffBookingModificationPage from './routes/StaffBookingModificationPage';
import GuestBookingCreatePage from './routes/GuestBookingCreatePage';
import RoomAdministrationPage from './routes/RoomAdministrationPage';
import CheckInPage from './routes/CheckInPage';
import ActiveStayPage from './routes/ActiveStayPage';
import CheckoutPage from './routes/CheckoutPage';
import CancellationPage from './routes/CancellationPage';
import NoShowPage from './routes/NoShowPage';
import GuestBookingRecordsPage from './routes/GuestBookingRecordsPage';
import ServiceCataloguePage from './routes/ServiceCataloguePage';
import ServiceUsagePage from './routes/ServiceUsagePage';
import UIRoutePage from './routes/UIRoutePage';
import DashboardPage from './routes/DashboardPage';
import AdminConfigPage from './routes/AdminConfigPage';
import AuditLogPage from './routes/AuditLogPage';
import BranchManagementPage from './routes/BranchManagementPage';
import UserAccountsPage from './routes/UserAccountsPage';
import ReportsPage from './routes/ReportsPage';
import LoginPage from './routes/LoginPage';
import RegisterPage from './routes/RegisterPage';
import GuestProfilesPage from './routes/GuestProfilesPage';
import AccountPage from './routes/AccountPage';
import { safeRedirectPath } from './lib/auth';
import InvoiceDetailPage from './routes/InvoiceDetailPage';
import PaymentPage from './routes/PaymentPage';

const rootRoute = createRootRoute({
  component: RootLayout,
});

// ── Public routes (no staff shell) ──────────────────────────────────────────

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: IndexPage,
});

// Public room availability. Anonymous visitors and guests browse here; staff
// use the same screen under /dashboard/rooms.
const roomsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/rooms',
  component: RoomsPage,
});

const guestBookingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/guest/my-bookings',
  component: GuestBookingRecordsPage,
});
const guestBookingDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/guest/my-bookings/$bookingId',
  component: GuestBookingRecordsPage,
});
const guestBookingCreateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/guest/bookings/new',
  component: GuestBookingCreatePage,
});

const uiRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ui',
  component: UIRoutePage,
});

const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/account',
  component: AccountPage,
});

interface LoginSearch {
  redirect?: string;
  reason?: 'expired';
}

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect: safeRedirectPath(search.redirect),
    reason: search.reason === 'expired' ? 'expired' : undefined,
  }),
  component: LoginPage,
});

interface RegisterSearch {
  redirect?: string;
  mode?: 'NEW' | 'LINK';
}

const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  validateSearch: (search: Record<string, unknown>): RegisterSearch => ({
    redirect: safeRedirectPath(search.redirect),
    mode: search.mode === 'LINK' ? 'LINK' : search.mode === 'NEW' ? 'NEW' : undefined,
  }),
  component: RegisterPage,
});

// ── Internal routes (single staff shell) ────────────────────────────────────
// Every internal page lives under /dashboard so the AppShell sidebar, sticky
// header and scroll pane are rendered once by DashboardLayout.

const dashboardLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard',
  component: DashboardLayout,
});

const dashboardIndexRoute = createRoute({
  getParentRoute: () => dashboardLayoutRoute,
  path: '/',
  component: DashboardPage,
});

const dashboardRoomsRoute = createRoute({
  getParentRoute: () => dashboardLayoutRoute,
  path: 'rooms',
  component: RoomsPage,
});

const staffBookingCreateRoute = createRoute({
  getParentRoute: () => dashboardLayoutRoute,
  path: 'bookings/new',
  component: StaffBookingCreatePage,
});

const staffBookingListRoute = createRoute({
  getParentRoute: () => dashboardLayoutRoute,
  path: 'bookings',
  component: StaffBookingRecordsPage,
});
const staffBookingDetailRoute = createRoute({
  getParentRoute: () => dashboardLayoutRoute,
  path: 'bookings/$bookingId',
  component: StaffBookingRecordsPage,
});
const staffBookingModificationRoute = createRoute({
  getParentRoute: () => dashboardLayoutRoute,
  path: 'bookings/$bookingId/edit',
  component: StaffBookingModificationPage,
});

const checkInRoute = createRoute({
  getParentRoute: () => dashboardLayoutRoute,
  path: 'check-in',
  component: CheckInPage,
});

const activeStayRoute = createRoute({
  getParentRoute: () => dashboardLayoutRoute,
  path: 'stays',
  component: ActiveStayPage,
});

const checkoutRoute = createRoute({
  getParentRoute: () => dashboardLayoutRoute,
  path: 'checkout',
  component: CheckoutPage,
});

const cancellationRoute = createRoute({
  getParentRoute: () => dashboardLayoutRoute,
  path: 'cancellation',
  component: CancellationPage,
});

const noShowRoute = createRoute({
  getParentRoute: () => dashboardLayoutRoute,
  path: 'no-show',
  component: NoShowPage,
});

const roomAdministrationRoute = createRoute({
  getParentRoute: () => dashboardLayoutRoute,
  path: 'admin/rooms',
  component: RoomAdministrationPage,
});

const adminConfigRoute = createRoute({
  getParentRoute: () => dashboardLayoutRoute,
  path: 'admin/config',
  component: AdminConfigPage,
});

const auditLogRoute = createRoute({
  getParentRoute: () => dashboardLayoutRoute,
  path: 'admin/audit',
  component: AuditLogPage,
});

const branchManagementRoute = createRoute({
  getParentRoute: () => dashboardLayoutRoute,
  path: 'admin/branches',
  component: BranchManagementPage,
});

const userAccountsRoute = createRoute({
  getParentRoute: () => dashboardLayoutRoute,
  path: 'admin/users',
  component: UserAccountsPage,
});

const reportsRoute = createRoute({
  getParentRoute: () => dashboardLayoutRoute,
  path: 'admin/reports',
  component: ReportsPage,
});

const guestsRoute = createRoute({
  getParentRoute: () => dashboardLayoutRoute,
  path: 'guests',
  component: GuestProfilesPage,
});

const serviceCatalogueRoute = createRoute({
  getParentRoute: () => dashboardLayoutRoute,
  path: 'admin/services',
  component: ServiceCataloguePage,
});

const serviceUsageRoute = createRoute({
  getParentRoute: () => dashboardLayoutRoute,
  path: 'service-usage',
  component: ServiceUsagePage,
});

const invoiceDetailRoute = createRoute({
  getParentRoute: () => dashboardLayoutRoute,
  path: 'billing/invoice',
  component: InvoiceDetailPage,
});

const paymentRoute = createRoute({
  getParentRoute: () => dashboardLayoutRoute,
  path: 'billing/payments',
  component: PaymentPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  registerRoute,
  roomsRoute,
  guestBookingsRoute,
  guestBookingDetailRoute,
  guestBookingCreateRoute,
  uiRoute,
  accountRoute,
  dashboardLayoutRoute.addChildren([
    dashboardIndexRoute,
    dashboardRoomsRoute,
    staffBookingCreateRoute,
    staffBookingListRoute,
    staffBookingDetailRoute,
    staffBookingModificationRoute,
    roomAdministrationRoute,
    checkInRoute,
    activeStayRoute,
    checkoutRoute,
    cancellationRoute,
    noShowRoute,
    guestsRoute,
    adminConfigRoute,
    auditLogRoute,
    branchManagementRoute,
    userAccountsRoute,
    reportsRoute,
    serviceCatalogueRoute,
    serviceUsageRoute,
    invoiceDetailRoute,
    paymentRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
