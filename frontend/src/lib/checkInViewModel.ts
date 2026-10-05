export type RoomLineStatus =
  | 'BOOKED'
  | 'CHECKED_IN'
  | 'CHECKED_OUT'
  | 'CANCELLED'
  | 'NO_SHOW';

export type RoomCondition = 'READY' | 'CLEANING' | 'OUT_OF_SERVICE';

export interface CheckInAssignment {
  assignmentId: string;
  roomId: string;
  roomNumber: string;
  roomActive: boolean;
  operationalStatus: RoomCondition;
  assignedAt: string;
  unassignedAt: string | null;
  occupiedFrom: string | null;
  current: boolean;
}

export interface CheckInLine {
  lineId: string;
  checkIn: string;
  checkOut: string;
  guestCount: number;
  status: RoomLineStatus;
  assignments: CheckInAssignment[];
}

export type LineAvailability =
  | 'ELIGIBLE'
  | 'NOT_BOOKED'
  | 'NO_OPEN_ASSIGNMENT'
  | 'ROOM_NOT_READY'
  | 'ROOM_INACTIVE'
  | 'OUTSIDE_STAY';

export interface LineCheckInState {
  lineId: string;
  availability: LineAvailability;
  roomNumber: string | null;
  roomCondition: RoomCondition | null;
  checkInAllowed: boolean;
  summary: string;
  detail: string;
}

export interface CheckInSuccess {
  bookingId: string;
  lineId: string;
  assignmentId: string;
  roomId: string;
  checkedInAt: string;
}

export interface CheckInFailure {
  code: string;
  message: string;
  status: number;
}

const AVAILABILITY_DETAIL: Record<Exclude<LineAvailability, 'ELIGIBLE'>, string> = {
  NOT_BOOKED: 'Only a BOOKED room line can be checked in.',
  NO_OPEN_ASSIGNMENT: 'Assign a physical room before checking this line in.',
  ROOM_NOT_READY: 'Physical room condition must be READY before check-in.',
  ROOM_INACTIVE: 'Assigned room is not an active inventory item.',
  OUTSIDE_STAY: "Check-in is only allowed inside the line's stay window.",
};

function openAssignment(line: CheckInLine): CheckInAssignment | undefined {
  return line.assignments.find(
    (assignment) =>
      assignment.current && assignment.unassignedAt === null && assignment.occupiedFrom === null,
  );
}

function isDateWithinStay(stayDate: string, checkIn: string, checkOut: string): boolean {
  return stayDate >= checkIn && stayDate < checkOut;
}

export function evaluateLineForCheckIn(
  line: CheckInLine,
  stayDate: string,
): LineCheckInState {
  const assignment = openAssignment(line);
  const base = {
    lineId: line.lineId,
    roomNumber: assignment?.roomNumber ?? null,
    roomCondition: assignment?.operationalStatus ?? null,
  };

  if (line.status !== 'BOOKED') {
    return {
      ...base,
      availability: 'NOT_BOOKED',
      checkInAllowed: false,
      summary: `Line is ${line.status}`,
      detail: AVAILABILITY_DETAIL.NOT_BOOKED,
    };
  }

  if (!assignment) {
    return {
      ...base,
      availability: 'NO_OPEN_ASSIGNMENT',
      checkInAllowed: false,
      summary: 'No open room assignment',
      detail: AVAILABILITY_DETAIL.NO_OPEN_ASSIGNMENT,
    };
  }

  if (!assignment.roomActive) {
    return {
      ...base,
      availability: 'ROOM_INACTIVE',
      checkInAllowed: false,
      summary: `Room ${assignment.roomNumber} is inactive`,
      detail: AVAILABILITY_DETAIL.ROOM_INACTIVE,
    };
  }

  if (assignment.operationalStatus !== 'READY') {
    return {
      ...base,
      availability: 'ROOM_NOT_READY',
      checkInAllowed: false,
      summary: `Room ${assignment.roomNumber} is ${assignment.operationalStatus}`,
      detail: AVAILABILITY_DETAIL.ROOM_NOT_READY,
    };
  }

  if (!isDateWithinStay(stayDate, line.checkIn, line.checkOut)) {
    return {
      ...base,
      availability: 'OUTSIDE_STAY',
      checkInAllowed: false,
      summary: `Stay window ${line.checkIn} to ${line.checkOut}`,
      detail: AVAILABILITY_DETAIL.OUTSIDE_STAY,
    };
  }

  return {
    ...base,
    availability: 'ELIGIBLE',
    checkInAllowed: true,
    summary: `Room ${assignment.roomNumber} is READY`,
    detail: `Check in room ${assignment.roomNumber} without affecting other lines of this booking.`,
  };
}

const REJECTION_MESSAGES: Record<string, string> = {
  AUTHENTICATION_REQUIRED: 'Sign in with an active staff account to check a guest in.',
  INVALID_BOOKING_REFERENCE: 'That booking reference could not be read. Reload the booking and retry.',
  INVALID_LINE_ID: 'That room line is not valid for this booking. Reload the booking and retry.',
  BOOKING_LINE_NOT_FOUND: 'That room line is not part of this booking. Reload the booking and retry.',
  BOOKING_NOT_FOUND: 'Booking not found in the authorized branch.',
  STAFF_AUTHORIZATION_REQUIRED: 'An active staff profile is required to check a guest in.',
  CHECK_IN_FORBIDDEN: 'Your role cannot perform check-in.',
  BRANCH_ACCESS_DENIED: "Check-in is restricted to your own branch.",
  STAY_ACCESS_DENIED: 'This booking is outside your branch scope.',
  INVALID_CHECK_IN_STATE: 'This room line is no longer eligible for check-in.',
  CHECK_IN_CONFLICT: 'The room line or room condition changed. Reload and retry.',
  CHECK_IN_FAILED: 'Check-in could not be completed. Retry the request.',
  INTERNAL_ERROR: 'The server could not complete check-in. Retry the request.',
};

export function describeCheckInRejection(failure: CheckInFailure): string {
  return REJECTION_MESSAGES[failure.code] ?? failure.message ?? REJECTION_MESSAGES.CHECK_IN_FAILED;
}

export function applyCheckInSuccess(
  lines: CheckInLine[],
  success: CheckInSuccess,
): CheckInLine[] {
  return lines.map((line) => {
    if (line.lineId !== success.lineId) return line;
    return {
      ...line,
      status: 'CHECKED_IN',
      assignments: line.assignments.map((assignment) =>
        assignment.assignmentId === success.assignmentId
          ? { ...assignment, occupiedFrom: success.checkedInAt }
          : assignment,
      ),
    };
  });
}

export function lineStatusCounts(
  lines: CheckInLine[],
): Record<RoomLineStatus, number> {
  const counts: Record<RoomLineStatus, number> = {
    BOOKED: 0,
    CHECKED_IN: 0,
    CHECKED_OUT: 0,
    CANCELLED: 0,
    NO_SHOW: 0,
  };
  for (const line of lines) {
    counts[line.status] += 1;
  }
  return counts;
}

export function checkInRequestPath(bookingRef: string, lineId: string): string {
  return `/bookings/${encodeURIComponent(bookingRef.trim())}/lines/${encodeURIComponent(
    lineId.trim(),
  )}/checkin`;
}

export function parseCheckInFailure(status: number, payload: unknown): CheckInFailure {
  const error = (payload as { error?: { code?: string; message?: string } } | null)?.error;
  return {
    status,
    code: error?.code ?? 'CHECK_IN_FAILED',
    message: error?.message ?? '',
  };
}