import type { StaffRole } from './roomAdministration';
import { ROLE_GRANTS } from './rolePermissions.generated';

// Navigation is derived from the backend's single role-grant matrix (generated
// into rolePermissions.generated.ts). Each staff page declares the operation(s)
// it requires; '*' means any authenticated staff role. Every API still
// authorizes independently, so hiding a link is discovery only, never control.
type PageRequirement = '*' | string | readonly string[];

const PAGE_PERMISSIONS: Record<string, PageRequirement> = {
  '/dashboard': '*',
  '/dashboard/rooms': 'room.read',
  '/dashboard/bookings': 'booking.manage',
  '/dashboard/bookings/new': 'booking.manage',
  '/dashboard/check-in': 'booking.check_in',
  '/dashboard/stays': ['room.read', 'invoice.read.chain'],
  '/dashboard/checkout': 'checkout.perform',
  '/dashboard/cancellation': 'booking.cancel',
  '/dashboard/no-show': 'booking.no_show',
  '/dashboard/billing/invoice': ['invoice.read.branch', 'invoice.read.chain'],
  '/dashboard/billing/payments': 'payment.record',
  '/dashboard/service-usage': 'service_usage.record',
  '/dashboard/admin/services': '*',
  '/dashboard/admin/rooms': ['room.read', 'catalogue.write'],
  '/dashboard/guests': 'guest.manage',
  '/dashboard/admin/reports': ['report.read.branch', 'report.read.chain'],
  '/dashboard/admin/branches': 'branch.write',
  '/dashboard/admin/users': 'account.read',
  '/dashboard/admin/config': ['config.read', 'config.write'],
  '/dashboard/admin/audit': 'audit.read',
};

export function canViewStaffPage(role: StaffRole | null, path: string): boolean {
  if (!role) return false;
  const grants = ROLE_GRANTS[role];
  if (!grants) return false;
  const required = PAGE_PERMISSIONS[path];
  if (required === undefined) return false;
  if (required === '*') return true;
  const operations = typeof required === 'string' ? [required] : required;
  return operations.some((operation) => grants[operation as keyof typeof grants] !== undefined);
}

// Each staff role's single most frequent day-to-day action, surfaced and
// highlighted at the top of the sidebar so it never scrolls out of reach. The
// path is still validated with canViewStaffPage, so a stale entry can never
// expose a link the role cannot open.
const PRIMARY_ACTION_PATHS: Record<StaffRole, string> = {
  FRONT_DESK: '/dashboard/bookings/new',
  SERVICE_STAFF: '/dashboard/service-usage',
  BRANCH_MANAGER: '/dashboard/admin/rooms',
  CHAIN_MANAGER: '/dashboard/admin/reports',
  SYSTEM_ADMINISTRATOR: '/dashboard/admin/users',
  AUDITOR: '/dashboard/admin/audit',
};

export function primaryActionPath(role: StaffRole | null): string | null {
  if (!role) return null;
  const path = PRIMARY_ACTION_PATHS[role];
  return path && canViewStaffPage(role, path) ? path : null;
}
