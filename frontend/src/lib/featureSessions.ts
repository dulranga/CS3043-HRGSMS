import type { SessionUser } from './auth';
import type { StaffRole, RoomAdminSession } from './roomAdministration';
import type { StaffBookingSession } from './staffBooking';
import type { GuestBookingSession } from './guestBooking';

const ROLES: readonly StaffRole[] = ['FRONT_DESK', 'SERVICE_STAFF', 'BRANCH_MANAGER', 'CHAIN_MANAGER', 'SYSTEM_ADMINISTRATOR', 'AUDITOR'];
export function verifiedStaffRole(user: SessionUser | null): StaffRole | null {
  return user?.kind === 'STAFF' && ROLES.includes(user.role as StaffRole) ? user.role as StaffRole : null;
}

// Requests use the same-origin HTTP-only, SameSite session cookie. JSON writes
// already set Content-Type in their clients; no actor/role header is authority.
const mutationHeaders = async (): Promise<HeadersInit> => ({});

export function staffFeatureSession(user: SessionUser | null): StaffBookingSession | null {
  const role = verifiedStaffRole(user);
  return role && user?.branchId ? { role, branchId: user.branchId, mutationHeaders } : null;
}
export function roomFeatureSession(user: SessionUser | null): RoomAdminSession | null {
  const role = verifiedStaffRole(user);
  return role ? { role, branchId: user?.branchId ?? null } : null;
}
export function guestFeatureSession(user: SessionUser | null): GuestBookingSession | null {
  return user?.kind === 'GUEST' && user.guestId ? { accountKind: 'guest', mutationHeaders } : null;
}
