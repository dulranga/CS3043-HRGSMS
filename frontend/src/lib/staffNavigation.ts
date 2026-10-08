import type { StaffRole } from './roomAdministration';
// Discovery follows server permissions; every API still authorizes independently.
const PAGE_ROLES: Record<string, readonly StaffRole[]> = {
  '/dashboard': ['FRONT_DESK', 'SERVICE_STAFF', 'BRANCH_MANAGER', 'CHAIN_MANAGER', 'SYSTEM_ADMINISTRATOR', 'AUDITOR'],
  '/rooms': ['FRONT_DESK', 'SERVICE_STAFF', 'BRANCH_MANAGER'],
  '/bookings': ['FRONT_DESK'], '/bookings/new': ['FRONT_DESK'],
  '/check-in': ['FRONT_DESK'], '/stays': ['FRONT_DESK', 'SERVICE_STAFF', 'BRANCH_MANAGER', 'CHAIN_MANAGER', 'AUDITOR'],
  '/service-usage': ['FRONT_DESK', 'SERVICE_STAFF'],
  '/admin/services': ['FRONT_DESK', 'SERVICE_STAFF', 'BRANCH_MANAGER', 'CHAIN_MANAGER', 'SYSTEM_ADMINISTRATOR', 'AUDITOR'],
  '/admin/rooms': ['FRONT_DESK', 'SERVICE_STAFF', 'BRANCH_MANAGER', 'CHAIN_MANAGER', 'SYSTEM_ADMINISTRATOR', 'AUDITOR'],
  '/guests': ['FRONT_DESK'],
  '/admin/reports': ['BRANCH_MANAGER', 'CHAIN_MANAGER', 'AUDITOR'],
  '/admin/operations': ['SYSTEM_ADMINISTRATOR', 'AUDITOR'],
  '/admin/config': ['SYSTEM_ADMINISTRATOR', 'AUDITOR'],
  '/admin/audit': ['SYSTEM_ADMINISTRATOR', 'AUDITOR'],
};
export function canViewStaffPage(role: StaffRole | null, path: string): boolean {
  return role !== null && Boolean(PAGE_ROLES[path]?.includes(role));
}
