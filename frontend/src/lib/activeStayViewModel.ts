export type RoomLineStatus =
  | 'BOOKED'
  | 'CHECKED_IN'
  | 'CHECKED_OUT'
  | 'CANCELLED'
  | 'NO_SHOW';

export type StayOccupancy =
  | 'OCCUPIED'
  | 'PENDING_CHECK_IN'
  | 'DEPARTED'
  | 'NOT_STAYING';

export interface ActiveStayRow {
  line_id: string;
  booking_id: string;
  stay_start_date: string;
  stay_end_date: string;
  guest_count: number;
  status: RoomLineStatus;
  assignment_id: string;
  room_id: string;
  room_number: string;
  branch_id: string;
  occupied_from: string;
}

export interface BookingAssignmentSummary {
  assignmentId: string;
  roomId: string;
  roomNumber: string;
  branchId: string;
  roomActive: boolean;
  operationalStatus: 'READY' | 'CLEANING' | 'OUT_OF_SERVICE';
  unassignedAt: string | null;
  occupiedFrom: string | null;
  occupiedTo: string | null;
  current: boolean;
}

export interface BookingLineSummary {
  lineId: string;
  checkIn: string;
  checkOut: string;
  guestCount: number;
  status: RoomLineStatus;
  assignments: BookingAssignmentSummary[];
}

export interface BookingGuestSummary {
  guestId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  nic: string | null;
}

export interface BookingStaySummary {
  bookingId: string;
  bookingRef: string;
  guest?: BookingGuestSummary | null;
  lines: BookingLineSummary[];
}

export interface StayLineView {
  lineId: string;
  roomNumber: string | null;
  branchId: string | null;
  status: RoomLineStatus;
  stayStart: string;
  stayEnd: string;
  guestCount: number;
  occupancy: StayOccupancy;
  occupiedFrom: string | null;
}

export interface StayBookingGroup {
  bookingId: string;
  bookingRef: string;
  guestName: string | null;
  branchIds: string[];
  lines: StayLineView[];
  occupiedRoomCount: number;
  pendingRoomCount: number;
  isPartiallyOccupied: boolean;
}

export interface StayFailure {
  status: number;
  code: string;
  message: string;
}

const OCCUPANCY_BY_STATUS: Record<RoomLineStatus, StayOccupancy> = {
  CHECKED_IN: 'OCCUPIED',
  BOOKED: 'PENDING_CHECK_IN',
  CHECKED_OUT: 'DEPARTED',
  CANCELLED: 'NOT_STAYING',
  NO_SHOW: 'NOT_STAYING',
};

const OPEN_STATUSES: ReadonlySet<RoomLineStatus> = new Set<RoomLineStatus>([
  'CHECKED_IN',
  'BOOKED',
]);

function currentAssignment(line: BookingLineSummary): BookingAssignmentSummary | undefined {
  return line.assignments.find((assignment) => assignment.current && assignment.unassignedAt === null);
}

function occupancyForStatus(status: RoomLineStatus): StayOccupancy {
  return OCCUPANCY_BY_STATUS[status] ?? 'NOT_STAYING';
}

function compareLines(left: StayLineView, right: StayLineView): number {
  if (left.stayStart !== right.stayStart) return left.stayStart < right.stayStart ? -1 : 1;
  const leftRoom = left.roomNumber ?? '';
  const rightRoom = right.roomNumber ?? '';
  if (leftRoom !== rightRoom) return leftRoom < rightRoom ? -1 : 1;
  return left.lineId < right.lineId ? -1 : left.lineId > right.lineId ? 1 : 0;
}

function uniqueBranchIds(lines: StayLineView[]): string[] {
  const seen: string[] = [];
  for (const line of lines) {
    if (line.branchId && !seen.includes(line.branchId)) seen.push(line.branchId);
  }
  return seen;
}

/**
 * M3-S08's active-stay read is the only authority for actual occupancy: a line
 * is occupied when its open assignment has an open occupancy segment. Member
 * 2's booking-detail read supplies every remaining line so a partially
 * checked-in booking still shows the rooms that are not yet occupied.
 */
export function mergeStayLines(
  bookingLines: BookingLineSummary[],
  activeStays: ActiveStayRow[],
): StayLineView[] {
  const activeByLine = new Map<string, ActiveStayRow>();
  for (const stay of activeStays) {
    activeByLine.set(stay.line_id, stay);
  }

  const views: StayLineView[] = [];
  const consumed = new Set<string>();

  for (const line of bookingLines) {
    const stay = activeByLine.get(line.lineId);
    if (stay) consumed.add(line.lineId);
    const assignment = currentAssignment(line);
    views.push({
      lineId: line.lineId,
      roomNumber: stay ? stay.room_number : assignment?.roomNumber ?? null,
      branchId: stay ? stay.branch_id : assignment?.branchId ?? null,
      status: stay ? stay.status : line.status,
      stayStart: stay ? stay.stay_start_date : line.checkIn,
      stayEnd: stay ? stay.stay_end_date : line.checkOut,
      guestCount: stay ? stay.guest_count : line.guestCount,
      occupancy: stay ? 'OCCUPIED' : occupancyForStatus(line.status),
      occupiedFrom: stay ? stay.occupied_from : null,
    });
  }

  for (const stay of activeStays) {
    if (consumed.has(stay.line_id)) continue;
    views.push({
      lineId: stay.line_id,
      roomNumber: stay.room_number,
      branchId: stay.branch_id,
      status: stay.status,
      stayStart: stay.stay_start_date,
      stayEnd: stay.stay_end_date,
      guestCount: stay.guest_count,
      occupancy: 'OCCUPIED',
      occupiedFrom: stay.occupied_from,
    });
  }

  return views.sort(compareLines);
}

export function buildStayGroup(
  booking: { bookingId: string; bookingRef: string; guestName?: string | null },
  lines: StayLineView[],
): StayBookingGroup {
  const stayLines = lines.filter((line) => OPEN_STATUSES.has(line.status));
  const occupiedRoomCount = stayLines.filter((line) => line.occupancy === 'OCCUPIED').length;
  const pendingRoomCount = stayLines.filter((line) => line.occupancy === 'PENDING_CHECK_IN').length;

  return {
    bookingId: booking.bookingId,
    bookingRef: booking.bookingRef,
    guestName: booking.guestName ?? null,
    branchIds: uniqueBranchIds(lines),
    lines,
    occupiedRoomCount,
    pendingRoomCount,
    isPartiallyOccupied: occupiedRoomCount > 0 && pendingRoomCount > 0,
  };
}

export function summarizeStay(groups: StayBookingGroup[]): {
  bookings: number;
  occupiedRooms: number;
  pendingRooms: number;
} {
  return groups.reduce(
    (totals, group) => ({
      bookings: totals.bookings + 1,
      occupiedRooms: totals.occupiedRooms + group.occupiedRoomCount,
      pendingRooms: totals.pendingRooms + group.pendingRoomCount,
    }),
    { bookings: 0, occupiedRooms: 0, pendingRooms: 0 },
  );
}

const STAY_FAILURE_MESSAGES: Record<string, string> = {
  AUTHENTICATION_REQUIRED: 'Sign in with an active staff account to view active stays.',
  STAY_ACCESS_DENIED:
    'This booking belongs to another branch. Active stays are limited to your own branch.',
  BOOKING_NOT_FOUND: 'Booking not found in the authorized branch.',
  BOOKING_LINE_NOT_FOUND: 'No active stay was found for that booking.',
  INVALID_BOOKING_REFERENCE: 'Enter a booking reference or booking UUID.',
  ACTIVE_STAY_READ_FAILED: 'Active stays could not be loaded. Retry the request.',
  INTERNAL_ERROR: 'Active stays could not be loaded. Retry the request.',
  UNKNOWN_BOOKING: 'Booking not found in the authorized branch.',
};

export function describeStayFailure(failure: StayFailure): string {
  return STAY_FAILURE_MESSAGES[failure.code] ?? failure.message ?? STAY_FAILURE_MESSAGES.ACTIVE_STAY_READ_FAILED;
}

export function parseStayFailure(status: number, payload: unknown): StayFailure {
  const error = (payload as { error?: { code?: string; message?: string } } | null)?.error;
  return {
    status,
    code: error?.code ?? 'ACTIVE_STAY_READ_FAILED',
    message: error?.message ?? '',
  };
}

export function isBranchDenial(failure: StayFailure): boolean {
  return failure.status === 403 || failure.code === 'STAY_ACCESS_DENIED';
}

export function stayRequestPath(bookingRef: string): string {
  return `/stays/${encodeURIComponent(bookingRef.trim())}`;
}

export function parseActiveStays(payload: unknown): ActiveStayRow[] {
  const rows = (payload as { active_stays?: ActiveStayRow[] } | null)?.active_stays;
  return Array.isArray(rows) ? rows : [];
}

/**
 * Shared responsive layout tokens. LAYOUT.md defines the uniform
 * 1 -> 2 -> 3 column grid and full-width fluid tables, so the breakpoints live
 * in one place instead of being retyped per component.
 */
export const STAY_LINE_GRID_CLASS =
  'grid grid-cols-1 md:grid-cols-2 gap-4';
export const STAY_TABLE_WRAPPER_CLASS = 'w-full overflow-x-auto';
export const STAY_RESPONSIVE_BREAKPOINTS = ['grid-cols-1', 'md:grid-cols-2'] as const;