import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaffBookingModificationPanel, StaffBookingModificationScreen } from '../src/components/bookings/StaffBookingModificationPanel.tsx';
import { BookingModificationModel, initialModificationState, BookingModificationError } from '../src/lib/staffBookingModification.ts';
import { bookingDetail, terminalDetail } from './staffBookingReadFixtures.ts';
import { modificationSession, createModificationFixture, targetSingle, mutationResult } from './staffBookingModificationFixtures.ts';
const actions = { async load() {}, start() {}, close() {}, setDraft() {}, async search() {}, select() {}, async prepare() {}, acknowledge() {}, async confirm() {}, reconciled() {} };
const render = (patch: object = {}) => renderToStaticMarkup(<StaffBookingModificationPanel state={{ ...initialModificationState(), ...patch }} actions={actions} bookingId={bookingDetail.bookingId} onCancellation={() => {}} />);
test('operation controls preserve all other lines and histories and hand cancellation to billing', () => {
  const markup = render({ booking: bookingDetail });
  for (const text of ['Add another room line', 'Change room line 102', 'Move room line 103', 'Move room line 102', 'Room 101', 'Room 103', 'Room 102', 'Guest extended reserved stay', 'Open billing cancellation workflow']) assert.ok(markup.includes(text), text);
  assert.doesNotMatch(markup, /Change room line 103|Delete line|Cancel booking/);
  assert.doesNotMatch(render({ booking: terminalDetail }), /Move room line|Change room line/);
});
test('checked-in review clearly preserves agreed price and disables dates and confirmation before acknowledgement', async () => {
  const fixture = createModificationFixture(), model = new BookingModificationModel(modificationSession, fixture.read, fixture.availability, fixture.modifications);
  await model.load(bookingDetail.bookingId); model.start('move', bookingDetail.lines[0].lineId); model.setDraft({ reason: 'Quieter room' });
  await model.search(); model.select(targetSingle.roomId); await model.prepare();
  const markup = render(model.getSnapshot());
  assert.match(markup, /CHECKED_IN move keeps the agreed rate/); assert.match(markup, /LKR 11,000.00/); assert.match(markup, /LKR 10,000.50/);
  assert.match(markup, /type="date"[^>]*disabled/); assert.match(markup, /disabled=""[^>]*>Confirm room-line change/);
  assert.match(markup, /approved non-zero difference requires a Branch Manager/);
});
test('conflict, uncertainty, committed credit and reload failure messages are explicit and accessible', () => {
  assert.match(render({ booking: bookingDetail, failure: new BookingModificationError('Operation rolled back. Other lines remain unchanged.', 'INVENTORY_CONFLICT', 409) }), /role="alert"/);
  const uncertain = render({ booking: bookingDetail, uncertain: true }); assert.match(uncertain, /previous outcome is unknown/); assert.match(uncertain, /I checked the booking and invoice outcome/);
  const fixtureReview: any = { bookingId: bookingDetail.bookingId, checkIn: '2027-06-03', checkOut: '2027-06-07', guestCount: 2, roomId: targetSingle.roomId,
    roomNumber: '105', agreedRate: '10000.50', originalStatus: 'BOOKED', input: { quotedRoomTypeId: targetSingle.roomType.roomTypeId } };
  const committed = render({ result: mutationResult(fixtureReview, true), needsRefresh: true });
  assert.match(committed, /Credit: LKR 1,234.50/); assert.match(committed, /manual refund workflow/); assert.match(committed, /change succeeded, but booking history has not refreshed/);
});
test('production screen gates missing, wrong-role and missing-CSRF identity', () => {
  for (const session of [null, { ...modificationSession, role: 'BRANCH_MANAGER' }, { role: 'FRONT_DESK', branchId: modificationSession.branchId } as any]) {
    const markup = renderToStaticMarkup(<StaffBookingModificationScreen session={session} bookingId={bookingDetail.bookingId} />);
    assert.match(markup, /Sign in as Front Desk/); assert.doesNotMatch(markup, /Add another room line|Reload booking records|Sample Guest/);
  }
});
