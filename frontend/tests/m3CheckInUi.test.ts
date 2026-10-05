import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CheckInLine,
  applyCheckInSuccess,
  checkInRequestPath,
  describeCheckInRejection,
  evaluateLineForCheckIn,
  lineStatusCounts,
  parseCheckInFailure,
} from '../src/lib/checkInViewModel.ts';

function line(overrides: Partial<CheckInLine> = {}): CheckInLine {
  return {
    lineId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5c01',
    checkIn: '2026-10-05',
    checkOut: '2026-10-08',
    guestCount: 2,
    status: 'BOOKED',
    assignments: [
      {
        assignmentId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5a01',
        roomId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5b01',
        roomNumber: '101',
        roomActive: true,
        operationalStatus: 'READY',
        assignedAt: '2026-10-01T09:00:00.000Z',
        unassignedAt: null,
        occupiedFrom: null,
        current: true,
      },
    ],
    ...overrides,
  };
}

const STAY_DATE = '2026-10-06';

test('one eligible line can check in while the other stays BOOKED', () => {
  const lines = [line(), line({ lineId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5c02' })];

  const states = lines.map((candidate) => evaluateLineForCheckIn(candidate, STAY_DATE));
  assert.deepEqual(
    states.map((state) => state.availability),
    ['ELIGIBLE', 'ELIGIBLE'],
  );

  const success = {
    bookingId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5d01',
    lineId: lines[0].lineId,
    assignmentId: lines[0].assignments[0].assignmentId,
    roomId: lines[0].assignments[0].roomId,
    checkedInAt: '2026-10-06T04:15:00.000Z',
  };

  const updated = applyCheckInSuccess(lines, success);

  assert.equal(updated[0].status, 'CHECKED_IN');
  assert.equal(updated[1].status, 'BOOKED');
  assert.equal(updated[1].assignments[0].occupiedFrom, null);
  assert.equal(updated[0].assignments[0].occupiedFrom, '2026-10-06T04:15:00.000Z');
  assert.equal(lines[0].status, 'BOOKED', 'input lines must not be mutated');

  const counts = lineStatusCounts(updated);
  assert.equal(counts.CHECKED_IN, 1);
  assert.equal(counts.BOOKED, 1);
});

test('room readiness gates the check-in control', () => {
  const ready = evaluateLineForCheckIn(line(), STAY_DATE);
  assert.equal(ready.checkInAllowed, true);
  assert.equal(ready.roomCondition, 'READY');

  const cleaning = evaluateLineForCheckIn(
    line({
      assignments: [{ ...line().assignments[0], roomNumber: '102', operationalStatus: 'CLEANING' }],
    }),
    STAY_DATE,
  );
  assert.equal(cleaning.checkInAllowed, false);
  assert.equal(cleaning.availability, 'ROOM_NOT_READY');
  assert.match(cleaning.summary, /Room 102 is CLEANING/);

  const outOfService = evaluateLineForCheckIn(
    line({
      assignments: [
        { ...line().assignments[0], roomNumber: '103', operationalStatus: 'OUT_OF_SERVICE' },
      ],
    }),
    STAY_DATE,
  );
  assert.equal(outOfService.checkInAllowed, false);
  assert.equal(outOfService.availability, 'ROOM_NOT_READY');
  assert.equal(outOfService.roomCondition, 'OUT_OF_SERVICE');
});

test('non-BOOKED lines, missing assignment and inactive rooms cannot check in', () => {
  const checkedIn = evaluateLineForCheckIn(line({ status: 'CHECKED_IN' }), STAY_DATE);
  assert.equal(checkedIn.checkInAllowed, false);
  assert.equal(checkedIn.availability, 'NOT_BOOKED');
  assert.match(checkedIn.detail, /BOOKED/);

  const unassigned = evaluateLineForCheckIn(line({ assignments: [] }), STAY_DATE);
  assert.equal(unassigned.checkInAllowed, false);
  assert.equal(unassigned.availability, 'NO_OPEN_ASSIGNMENT');

  const inactive = evaluateLineForCheckIn(
    line({ assignments: [{ ...line().assignments[0], roomActive: false }] }),
    STAY_DATE,
  );
  assert.equal(inactive.availability, 'ROOM_INACTIVE');
  assert.equal(inactive.checkInAllowed, false);
});

test('stay-window guard mirrors the server date rule', () => {
  const early = evaluateLineForCheckIn(line(), '2026-10-04');
  assert.equal(early.availability, 'OUTSIDE_STAY');

  const departureDay = evaluateLineForCheckIn(line(), '2026-10-08');
  assert.equal(departureDay.availability, 'OUTSIDE_STAY');

  const lastNight = evaluateLineForCheckIn(line(), '2026-10-07');
  assert.equal(lastNight.checkInAllowed, true);
});

test('rejected check-in responses map to staff-facing messages', () => {
  const conflict = parseCheckInFailure(409, {
    error: { code: 'CHECK_IN_CONFLICT', message: 'Assigned room must be READY for check-in.' },
  });
  assert.equal(conflict.status, 409);
  assert.match(describeCheckInRejection(conflict), /condition changed/i);

  const branch = parseCheckInFailure(403, {
    error: { code: 'BRANCH_ACCESS_DENIED', message: 'Check-in is restricted to the staff member branch.' },
  });
  assert.match(describeCheckInRejection(branch), /own branch/i);

  const unauthenticated = parseCheckInFailure(401, {
    error: { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication is required for check-in.' },
  });
  assert.match(describeCheckInRejection(unauthenticated), /Sign in/);

  const unknown = parseCheckInFailure(500, null);
  assert.equal(unknown.code, 'CHECK_IN_FAILED');
  assert.match(describeCheckInRejection(unknown), /could not be completed/i);
});

test('check-in request targets the selected line only', () => {
  assert.equal(
    checkInRequestPath('BK-2026-0001', '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5c02'),
    '/bookings/BK-2026-0001/lines/0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5c02/checkin',
  );
});