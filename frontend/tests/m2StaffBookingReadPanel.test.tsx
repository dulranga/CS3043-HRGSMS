import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaffBookingReadPanel, StaffBookingReadScreen, StaffBookingDetailPanel } from '../src/components/bookings/StaffBookingReadPanel.tsx';
import { initialStaffBookingReadState, StaffBookingReadError } from '../src/lib/staffBookingRead.ts';
import { bookingDetail, page, readSession, terminalDetail } from './staffBookingReadFixtures.ts';
const actions = { async loadList() {}, async open() {}, back() {}, async next() {}, async previous() {} };
test('booking list shows each multi-room reference once and clearly derives mixed line progress', () => {
  const markup = renderToStaticMarkup(<StaffBookingReadPanel state={{ ...initialStaffBookingReadState(), page: page() }} actions={actions} />);
  assert.equal((markup.match(/<h3[^>]*>SN-SAMPLE-MULTI<\/h3>/g) ?? []).length, 1);
  for (const text of ['Mixed line states', '2 room lines', '1 BOOKED', '1 CHECKED_IN', 'View all room lines', 'page size 20', 'Asia/Colombo']) assert.ok(markup.includes(text), text);
  assert.match(markup, /grid-cols-1/); assert.match(markup, /lg:grid-cols-3/);
});
test('detail renders every line plus old/current assignments, occupancy and rate/date revision evidence', () => {
  const markup = renderToStaticMarkup(<StaffBookingDetailPanel booking={bookingDetail} />);
  for (const text of ['Room 101', 'Room 103', 'Room 102', 'Closed assignment', 'Current assignment', 'Actual occupancy began', 'Actual occupancy ended', 'LKR 10,000.50', 'LKR 11,000.00', 'LKR 18,000.00', 'Before:', 'After:', 'Guest arrived', 'Guest extended reserved stay', 'physical condition READY', 'physical condition CLEANING', 'Currently occupied', 'Assigned; not currently checked in']) assert.ok(markup.includes(text), text);
  assert.doesNotMatch(markup, /Cancel booking|Confirm booking|<input|NIC/);
  const terminal = renderToStaticMarkup(<StaffBookingDetailPanel booking={terminalDetail} />);
  assert.match(terminal, /CANCELLED/); assert.match(terminal, /No open room assignment/); assert.match(terminal, /Room 102/);
});
test('loading, empty, denied and failed reads have accessible messages and recovery controls without stale detail', () => {
  const render = (patch: object) => renderToStaticMarkup(<StaffBookingReadPanel state={{ ...initialStaffBookingReadState(), ...patch }} actions={actions} />);
  assert.match(render({ loadingList: true }), /role="status"[^>]*>Loading branch/);
  assert.match(render({ page: page([]) }), /No bookings found in your assigned branch/);
  assert.match(render({ page: page([], 20, 20), offset: 20 }), /Return to the previous page/);
  const denied = render({ selectedId: bookingDetail.bookingId, detailFailure: new StaffBookingReadError('Booking not found in your assigned branch.', 'BOOKING_NOT_FOUND', 404) });
  assert.match(denied, /role="alert"/); assert.match(denied, /Reload booking/); assert.doesNotMatch(denied, /Sample Guest|Room 101|SN-SAMPLE-MULTI/);
});
test('production screen has no read controls for absent or wrong-role identity', () => {
  for (const session of [null, { ...readSession, role: 'CHAIN_MANAGER' }]) {
    const markup = renderToStaticMarkup(<StaffBookingReadScreen session={session} />);
    assert.match(markup, /Sign in as Front Desk/); assert.doesNotMatch(markup, /Reload bookings|Sample Guest|View all room lines/);
  }
});
