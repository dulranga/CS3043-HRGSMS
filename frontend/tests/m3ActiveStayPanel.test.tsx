import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ActiveStayPanel } from '../src/components/stay/ActiveStayPanel.tsx';
import { BookingLineSummary, buildStayGroup, mergeStayLines } from '../src/lib/activeStayViewModel.ts';

const BOOKING_ID = '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5d01';

function line(overrides: Partial<BookingLineSummary> = {}): BookingLineSummary {
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
        branchId: 'branch-one',
        roomActive: true,
        operationalStatus: 'READY',
        unassignedAt: null,
        occupiedFrom: null,
        occupiedTo: null,
        current: true,
      },
    ],
    ...overrides,
  };
}

test('the panel groups one booking and renders each line room and status distinctly', () => {
  const lines = [
    line(),
    line({
      lineId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5c02',
      guestCount: 1,
      assignments: [
        {
          ...line().assignments[0],
          assignmentId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5a02',
          roomId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5b02',
          roomNumber: '102',
        },
      ],
    }),
  ];

  const merged = mergeStayLines(lines, [
    {
      line_id: lines[0].lineId,
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
    },
  ]);

  const group = buildStayGroup(
    { bookingId: BOOKING_ID, bookingRef: 'BK-2026-0001', guestName: 'A. Patel' },
    merged,
  );

  const markup = renderToStaticMarkup(<ActiveStayPanel groups={[group]} />);

  assert.match(markup, /A\. Patel · BK-2026-0001/);
  assert.match(markup, /PARTIALLY OCCUPIED/);
  assert.match(markup, /Room 101/);
  assert.match(markup, /Room 102/);
  assert.match(markup, /CHECKED IN/);
  assert.match(markup, /BOOKED/);
  assert.match(markup, /OCCUPIED/);
  assert.match(markup, /AWAITING CHECK-IN/);
  assert.match(markup, /md:grid-cols-2/);
  assert.match(markup, /overflow-x-auto/);
});