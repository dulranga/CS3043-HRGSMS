import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GuestBookingReadPanel, GuestBookingReadScreen, GuestBookingDetailPanel } from '../src/components/bookings/GuestBookingReadPanel';
import { GuestReservationNavigation } from '../src/components/layout/GuestBookingLayout';
import { initialGuestBookingReadState, GuestBookingReadError } from '../src/lib/guestBookingRead';
import { guestReadDetail, guestReadPage, guestReadSession, guestAllStatesDetail } from './guestBookingReadFixtures';
const actions = { async loadList() {}, async open() {}, back() {}, async next() {}, async previous() {} };
const panel = (patch: object) => renderToStaticMarkup(<GuestBookingReadPanel state={{ ...initialGuestBookingReadState(), ...patch }} actions={actions} />);
test('owned list groups multiple room states under one card/reference and has only guest read/navigation actions', () => {
  const markup = panel({ page: guestReadPage() });
  assert.equal((markup.match(/<h3[^>]*>SN-SAMPLE-MULTI/g) ?? []).length, 1);
  for (const text of ['My Bookings', 'Mixed room states', '2 room lines', '1 reserved', '1 checked in', 'View all room lines', 'Book another stay', 'Each room may have different dates']) assert.ok(markup.includes(text), text);
  assert.doesNotMatch(markup, /Guest Session Simulator|x-user-id|Account UUID|Guest ID|Manage room lines|Confirm Cancellation|Check Out|Pay online|<input/);
});
test('detail shows every active/terminal line, agreed dates/rates, previous rooms and preserved revisions without internal identity or condition details', () => {
  const markup = renderToStaticMarkup(<GuestBookingDetailPanel booking={guestAllStatesDetail()} />);
  for (const text of ['Reserved', 'Checked in', 'Checked out', 'Cancelled', 'No-show', 'Room 101', 'Room 103', 'Previous room', 'Current room', 'LKR 11,000.00', 'LKR 18,000.00', 'LKR 10,000.50', '2027-06-04', '2027-06-06', 'Before:', 'After:', 'Asia/Colombo']) assert.ok(markup.includes(text), text);
  assert.equal((markup.match(/<h3[^>]*>Room line /g) ?? []).length, 5);
  assert.doesNotMatch(markup, /Booking ID|Line ID|Actor:|Created by|physical condition|READY|CLEANING|FRONT_DESK|NIC|00000000-/);
  assert.match(markup, /not a final bill or proof of payment/); assert.match(markup, /contact SkyNest/);
});
test('denied reads expose only sign-in recovery with no private list/detail/action controls', () => {
  const markup = panel({ denied: true, page: guestReadPage(), detail: guestReadDetail, listFailure: new GuestBookingReadError('Your session expired. Sign in again.', 'REQUEST_FAILED', 401) });
  assert.match(markup, /Your session expired/); assert.doesNotMatch(markup, /SN-SAMPLE|Room 103|Reload my bookings|View all room lines/);
});
test('empty, loading, failed and missing detail states are readable and retain back/reload recovery', () => {
  assert.match(panel({ page: guestReadPage([]) }), /You have no bookings yet/);
  assert.match(panel({ page: guestReadPage([], 20, 20), offset: 20 }), /No more bookings/);
  assert.match(panel({ loadingList: true }), /Loading your bookings/);
  const missing = panel({ selectedId: guestReadDetail.bookingId, detailFailure: new GuestBookingReadError('Booking not found.', 'BOOKING_NOT_FOUND', 404) });
  assert.match(missing, /Booking not found/); assert.match(missing, /Back to my bookings/); assert.match(missing, /Reload booking/); assert.doesNotMatch(missing, /Room 103|SN-SAMPLE/);
});
test('unverified/staff session stays gated; guest reads require no staff branch or ownership input', () => {
  for (const session of [null, { accountKind: 'staff' }]) {
    const markup = renderToStaticMarkup(<GuestBookingReadScreen session={session} bookingId={guestReadDetail.bookingId} />);
    assert.match(markup, /Sign in to your SkyNest guest account/); assert.doesNotMatch(markup, /Reload booking|View all room lines|<input/);
  }
  const allowed = renderToStaticMarkup(<GuestBookingReadScreen session={guestReadSession} />);
  assert.match(allowed, /My Bookings/); assert.doesNotMatch(allowed, /Sign in to your SkyNest guest account|Front Desk|assigned branch/);
});
test('guest navigation marks My Bookings active on list and detail and has no staff operation links', () => {
  for (const activePath of ['/guest/my-bookings', `/guest/my-bookings/${guestReadDetail.bookingId}`]) {
    const markup = renderToStaticMarkup(<GuestReservationNavigation activePath={activePath} />);
    assert.match(markup, /href="\/guest\/my-bookings" aria-current="page"/); assert.equal((markup.match(/aria-current="page"/g) ?? []).length, 1);
    assert.doesNotMatch(markup, /check-in|admin\/|Staff booking|Service Usage|Reports|Payments/);
  }
});
