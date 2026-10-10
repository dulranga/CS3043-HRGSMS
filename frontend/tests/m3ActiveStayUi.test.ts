import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ActiveStayRow,
  BookingLineSummary,
  STAY_LINE_GRID_CLASS,
  STAY_RESPONSIVE_BREAKPOINTS,
  STAY_TABLE_WRAPPER_CLASS,
  buildStayGroup,
  describeStayFailure,
  isBranchDenial,
  mergeStayLines,
  parseActiveStays,
  parseStayFailure,
  stayRequestPath,
  summarizeStay,
} from '../src/lib/activeStayViewModel.ts';

const BOOKING_ID = '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5d01';

function assignment(overrides: Record<string, unknown> = {}) {
  return {
    assignmentId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5a01',
    roomId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5b01',
    roomNumber: '101',
    branchId: 'branch-one',
    roomActive: true,
    operationalStatus: 'READY' as const,
    unassignedAt: null,
    occupiedFrom: null,
    occupiedTo: null,
    current: true,
    ...overrides,
  };
}

function bookingLine(overrides: Partial<BookingLineSummary> = {}): BookingLineSummary {
  return {
    lineId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5c01',
    checkIn: '2026-10-05',
    checkOut: '2026-10-08',
    guestCount: 2,
    status: 'BOOKED',
    assignments: [assignment()],
    ...overrides,
  };
}

function activeStay(overrides: Partial<ActiveStayRow> = {}): ActiveStayRow {
  return {
    line_id: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5c01',
    booking_id: BOOKING_ID,
    stay_start_date: '2026-10-05',
    stay_end_date: '2026-10-08',
    guest_count: 2,
    status: 'CHECKED_IN',
    assignment_id: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5a01',
    room_id: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5b01',
    room_number: '101',
    branch_id: 'branch-one',
    occupied_from: '2026-10-06T04:15:00.000Z',
    ...overrides,
  };
}

test('a partially checked-in booking shows one occupied room and one awaiting check-in', () => {
  const lines = [
    bookingLine(),
    bookingLine({
      lineId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5c02',
      guestCount: 1,
      assignments: [assignment({ roomNumber: '102', roomId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5b02' })],
    }),
  ];

  const merged = mergeStayLines(lines, [activeStay()]);

  assert.deepEqual(
    merged.map((line) => [line.roomNumber, line.status, line.occupancy]),
    [
      ['101', 'CHECKED_IN', 'OCCUPIED'],
      ['102', 'BOOKED', 'PENDING_CHECK_IN'],
    ],
  );
  assert.equal(merged[0].occupiedFrom, '2026-10-06T04:15:00.000Z');
  assert.equal(merged[1].occupiedFrom, null);

  const group = buildStayGroup(
    { bookingId: BOOKING_ID, bookingRef: 'BK-2026-0001', guestName: 'A. Patel' },
    merged,
  );
  assert.equal(group.occupiedRoomCount, 1);
  assert.equal(group.pendingRoomCount, 1);
  assert.equal(group.isPartiallyOccupied, true);
  assert.deepEqual(group.branchIds, ['branch-one']);

  assert.deepEqual(summarizeStay([group]), {
    bookings: 1,
    occupiedRooms: 1,
    pendingRooms: 1,
  });
});

test('fully occupied and fully pending bookings are not marked partially occupied', () => {
  const both = mergeStayLines(
    [bookingLine(), bookingLine({ lineId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5c02' })],
    [
      activeStay(),
      activeStay({
        line_id: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5c02',
        assignment_id: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5a02',
        room_id: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5b02',
        room_number: '102',
      }),
    ],
  );
  const occupied = buildStayGroup({ bookingId: BOOKING_ID, bookingRef: 'BK-1' }, both);
  assert.equal(occupied.isPartiallyOccupied, false);
  assert.equal(occupied.pendingRoomCount, 0);

  const pending = buildStayGroup(
    { bookingId: BOOKING_ID, bookingRef: 'BK-2' },
    mergeStayLines([bookingLine()], []),
  );
  assert.equal(pending.occupiedRoomCount, 0);
  assert.equal(pending.isPartiallyOccupied, false);
});

test('closed and cancelled lines are shown but never counted as staying', () => {
  const lines = [
    bookingLine(),
    bookingLine({
      lineId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5c03',
      status: 'CHECKED_OUT',
      assignments: [assignment({ occupiedTo: '2026-10-08T09:00:00.000Z', roomNumber: '103' })],
    }),
    bookingLine({
      lineId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5c04',
      status: 'CANCELLED',
      checkIn: '2026-11-01',
      checkOut: '2026-11-04',
      assignments: [assignment({ roomNumber: '104' })],
    }),
  ];

  const merged = mergeStayLines(lines, [activeStay()]);

  assert.deepEqual(
    merged.map((line) => line.occupancy),
    ['OCCUPIED', 'DEPARTED', 'NOT_STAYING'],
  );

  const group = buildStayGroup({ bookingId: BOOKING_ID, bookingRef: 'BK-2026-0002' }, merged);
  assert.equal(group.occupiedRoomCount, 1);
  assert.equal(group.pendingRoomCount, 0);
  assert.equal(group.isPartiallyOccupied, false);
  assert.equal(group.lines.length, 3, 'closed lines stay visible for history');
});

test('a future BOOKED line without an occupancy segment is never shown as occupied', () => {
  const merged = mergeStayLines(
    [
      bookingLine({
        lineId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5c09',
        checkIn: '2026-12-01',
        checkOut: '2026-12-05',
        assignments: [assignment({ occupiedFrom: null, roomNumber: '109' })],
      }),
    ],
    [],
  );

  assert.equal(merged[0].occupancy, 'PENDING_CHECK_IN');
  assert.equal(merged[0].occupiedFrom, null);
});

test('the active-stay read is the occupancy authority over the booking read', () => {
  const merged = mergeStayLines(
    [bookingLine({ status: 'BOOKED', assignments: [assignment({ roomNumber: '101' })] })],
    [activeStay({ room_number: '205', room_id: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5b05' })],
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].roomNumber, '205');
  assert.equal(merged[0].status, 'CHECKED_IN');
  assert.equal(merged[0].occupancy, 'OCCUPIED');
});

test('a stay read with no booking detail still resolves each occupied room', () => {
  const merged = mergeStayLines(
    [],
    [activeStay(), activeStay({ line_id: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5c02', room_number: '102' })],
  );

  assert.deepEqual(
    merged.map((line) => [line.roomNumber, line.occupancy]),
    [
      ['101', 'OCCUPIED'],
      ['102', 'OCCUPIED'],
    ],
  );
  assert.deepEqual(
    parseActiveStays({ active_stays: [] }),
    [],
  );
  assert.deepEqual(parseActiveStays({}), []);
  assert.deepEqual(parseActiveStays(null), []);
});

test('branch denial is separated from other load failures', () => {
  const denial = parseStayFailure(403, {
    error: { code: 'STAY_ACCESS_DENIED', message: 'Access denied.' },
  });
  assert.equal(isBranchDenial(denial), true);
  assert.match(describeStayFailure(denial), /another branch/i);

  const missing = parseStayFailure(404, {
    error: { code: 'BOOKING_NOT_FOUND', message: 'Booking was not found.' },
  });
  assert.equal(isBranchDenial(missing), false);
  assert.match(describeStayFailure(missing), /not found/i);

  const anonymous = parseStayFailure(401, {
    error: { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication is required.' },
  });
  assert.match(describeStayFailure(anonymous), /Sign in/);

  const unmapped = parseStayFailure(500, null);
  assert.equal(unmapped.code, 'ACTIVE_STAY_READ_FAILED');
  assert.match(describeStayFailure(unmapped), /could not be loaded/i);
});

test('the stay request targets a single booking reference', () => {
  assert.equal(stayRequestPath(' BK-2026-0001 '), '/stays/BK-2026-0001');
});

test('responsive layout tokens follow the documented 1 then 2 column grid', () => {
  for (const breakpoint of STAY_RESPONSIVE_BREAKPOINTS) {
    assert.ok(STAY_LINE_GRID_CLASS.includes(breakpoint), `${breakpoint} missing from grid class`);
  }
  assert.match(STAY_LINE_GRID_CLASS, /grid-cols-1/);
  assert.match(STAY_LINE_GRID_CLASS, /md:grid-cols-2/);
  assert.ok(!STAY_LINE_GRID_CLASS.includes('lg:grid-cols-3'), 'line cards must not jump to 3 columns');
  assert.match(STAY_TABLE_WRAPPER_CLASS, /overflow-x-auto/);
});