import type { StaffRole } from './roomAdministration';
import { ROLE_GRANTS } from './rolePermissions.generated';

// Navigation is derived from the backend's single role-grant matrix (generated
// into rolePermissions.generated.ts). Each staff page declares the operation(s)
// it requires; '*' means any authenticated staff role. Every API still
// authorizes independently, so hiding a link is discovery only, never control.
type PageRequirement = '*' | string | readonly string[];

const PAGE_PERMISSIONS: Record<string, PageRequirement> = {
  '/dashboard': '*',
  '/rooms': 'room.read',
  '/bookings': 'booking.manage',
  '/bookings/new': 'booking.manage',
  '/check-in': 'booking.check_in',
  '/stays': ['room.read', 'invoice.read.chain'],
  '/service-usage': 'service_usage.record',
  '/admin/services': '*',
  '/admin/rooms': 'room.read',
  '/guests': 'guest.manage',
  '/admin/reports': ['report.read.branch', 'report.read.chain'],
  '/admin/branches': 'branch.write',
  '/admin/users': 'account.read',
  '/admin/config': ['config.read', 'config.write'],
  '/admin/audit': 'audit.read',
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
