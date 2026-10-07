import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GuestBookingPanel, GuestBookingScreen } from '../src/components/bookings/GuestBookingPanel.tsx';
import { GuestReservationNavigation } from '../src/components/layout/GuestBookingLayout.tsx';
import { GuestBookingError, initialGuestBookingState } from '../src/lib/guestBooking.ts';
import { selected } from './staffBookingFixtures.ts';
import { guestSession, guestQuoteFor, guestCreatedFor } from './guestBookingFixtures.ts';
const actions = { async requestQuote() {}, acknowledge() {}, async confirm() {} };
const render = (patch: object = {}) => renderToStaticMarkup(<GuestBookingPanel state={{ ...initialGuestBookingState(), ...patch }} actions={actions} branchName="SkyNest Colombo" />);
test('guest quote displays all per-room dates/rates, exact policy total and explicit review without owner/channel fields', () => {
  const markup = render({ lines: selected, quote: guestQuoteFor() });
  for (const text of ['Room 101', 'Room 102', '2027-06-01', '2027-06-06', 'LKR 10,000.50', 'LKR 18,000.00', 'LKR 125,665.85', 'SkyNest Colombo', 'I reviewed these room rates and booking terms', 'Online payment is not available', 'No payment is taken']) assert.ok(markup.includes(text), text);
  assert.match(markup, /disabled=""[^>]*>Confirm my reservation/);
  assert.doesNotMatch(markup, /guestId|Guest record ID|bookingChannel|Selected policy:|<input|FRONT_DESK|createdBy/);
});
test('confirmation shows one reference and all agreed lines with provisional unpaid messaging and no internal IDs', () => {
  const q = guestQuoteFor(), input = { branchId: q.branchId, quotedBillingPolicyId: q.billingPolicy.billingPolicyId,
    lines: q.lines.map(l => ({ ...l, quotedRoomTypeId: l.roomTypeId, quotedBaseDailyRate: l.baseDailyRate })) };
  const markup = render({ created: guestCreatedFor(input) });
  assert.match(markup, /Reservation confirmed/); assert.match(markup, /2 rooms · one booking reference/); assert.match(markup, /Provisional bill: LKR 125,665.85/);
  assert.match(markup, /Room 101/); assert.match(markup, /Room 102/); assert.match(markup, /signed-in guest account/);
  assert.doesNotMatch(markup, /Confirm my reservation|Invoice ID|Billing policy ID|guestId|createdBy|Pay online/);
});
test('denial hides draft/quote data; unknown outcome locks quote and confirmation and preserves clear contact-hotel recovery', () => {
  const denied = render({ denied: true, lines: selected, quote: guestQuoteFor(), failure: new GuestBookingError('Sign in again.', 'FORBIDDEN', 403) });
  assert.match(denied, /Sign in again/); assert.doesNotMatch(denied, /Room 101|LKR 125,665.85|Get fresh combined quote/);
  const uncertain = render({ uncertain: true, lines: selected }); assert.match(uncertain, /Another confirmation is blocked/); assert.match(uncertain, /Contact the hotel/); assert.match(uncertain, /disabled=""[^>]*>Get fresh combined quote/);
});
test('production screen gates unverified or staff identity and uses a guest account without staff guest-ID fields', () => {
  for (const session of [null, { ...guestSession, accountKind: 'staff' }, { accountKind: 'guest' } as any]) {
    const markup = renderToStaticMarkup(<GuestBookingScreen session={session} />); assert.match(markup, /Sign in to your SkyNest guest account/); assert.doesNotMatch(markup, /Search available rooms|Confirm my reservation/);
  }
  const signedIn = renderToStaticMarkup(<GuestBookingScreen session={guestSession} />);
  assert.match(signedIn, /Book directly with SkyNest/); assert.doesNotMatch(signedIn, /Primary guest record ID|Require READY for immediate check-in/);
});
test('direct reservation navigation contains only guest-facing destinations', () => {
  const markup = renderToStaticMarkup(<GuestReservationNavigation />);
  assert.match(markup, /SkyNest home/); assert.match(markup, /Browse rooms/); assert.match(markup, /Book directly/);
  assert.doesNotMatch(markup, /check-in|admin\/|Staff booking|Service Usage|Reports|Payments/);
});
