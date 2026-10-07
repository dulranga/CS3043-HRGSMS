import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaffBookingPanel, StaffBookingScreen } from '../src/components/bookings/StaffBookingPanel.tsx';
import { initialStaffBookingState, StaffBookingError } from '../src/lib/staffBooking.ts';
import { createdFor, quoteFor, selected, session } from './staffBookingFixtures.ts';
import { id } from './availabilityFixtures.ts';
const actions = { setGuest() {}, setChannel() {}, async requestQuote() {}, acknowledge() {}, async confirm() {} };
const state = { ...initialStaffBookingState(), lines: selected, guestId: id(25), quote: quoteFor() };
test('two-room review shows independent rates/dates, exact totals, selected policy and explicit acknowledgement', () => {
  const markup = renderToStaticMarkup(<StaffBookingPanel state={state} actions={actions} />);
  for (const value of ['Room 101', 'Room 102', '2027-06-01 to 2027-06-04', '2027-06-02 to 2027-06-06', 'LKR 10,000.50', 'LKR 18,000.00', 'LKR 125,665.85', 'Service charge (10.00%)', 'Tax (12.00%', 'Selected policy', 'Asia/Colombo', 'Primary guest record ID', 'I have reviewed']) assert.ok(markup.includes(value), value);
  assert.match(markup, /disabled=""[^>]*>Confirm staff booking/);
  assert.match(markup, /lg:grid-cols-3/); assert.doesNotMatch(markup, /Pay now|DIRECT_ONLINE|actor ID/);
});
test('production screen denies missing/wrong session without loading inventory or showing writes', () => {
  for (const identity of [null, { ...session, role: 'BRANCH_MANAGER' }]) {
    const markup = renderToStaticMarkup(<StaffBookingScreen session={identity} />);
    assert.match(markup, /Sign in as Front Desk/); assert.doesNotMatch(markup, /<input|Confirm staff booking|Get fresh/);
  }
});
test('conflict state preserves primary guest and offers fresh quote while uncertain state disables retry', () => {
  const markup = renderToStaticMarkup(<StaffBookingPanel state={{ ...state, quote: null, failure: new StaffBookingError('Get a fresh quote.', 'REQUOTE_REQUIRED', 409) }} actions={actions} />);
  assert.match(markup, /role="alert"/); assert.ok(markup.includes(id(25))); assert.match(markup, /Get fresh combined quote/); assert.doesNotMatch(markup, /Confirm staff booking/);
  const uncertain = renderToStaticMarkup(<StaffBookingPanel state={{ ...state, quote: null, uncertain: true, notice: 'Check booking records before repeating.' }} actions={actions} />);
  assert.match(uncertain, /disabled=""[^>]*>Get fresh combined quote/);
});
test('success renders server reference, all agreed room rates and one provisional DRAFT invoice without cancellation controls', () => {
  const quote = quoteFor();
  const created = createdFor({ guestId: id(25), bookingChannel: 'FRONT_DESK', quotedBillingPolicyId: quote.billingPolicy.billingPolicyId,
    lines: quote.lines.map(line => ({ ...line, quotedRoomTypeId: line.roomTypeId, quotedBaseDailyRate: line.baseDailyRate })) });
  const markup = renderToStaticMarkup(<StaffBookingPanel state={{ ...state, created }} actions={actions} />);
  for (const text of ['SN-SAMPLE-001', 'Room 101', 'Room 102', 'Agreed base rate', 'one DRAFT invoice', 'check-in are separate']) assert.ok(markup.includes(text));
  assert.doesNotMatch(markup, /Confirm staff booking|<input|Cancel booking|Checkout/);
});
