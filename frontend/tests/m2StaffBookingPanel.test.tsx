import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaffBookingAlerts, StaffBookingConfirmation, StaffBookingGuestStep, StaffBookingReviewStep, StaffBookingScreen, StaffBookingWizard } from '../src/components/bookings/StaffBookingPanel.tsx';
import { GuestPicker } from '../src/components/bookings/GuestPicker.tsx';
import { initialStaffBookingState, StaffBookingError } from '../src/lib/staffBooking.ts';
import { initialAvailabilityState } from '../src/lib/availability.ts';
import { createdFor, quoteFor, selected, session } from './staffBookingFixtures.ts';
import { draft, id, options } from './availabilityFixtures.ts';
const actions = { setGuest() {}, setChannel() {}, async requestQuote() {}, acknowledge() {}, async confirm() {} };
const availability = { setDraft() {}, async search() {}, add() {}, remove() {}, clear() {}, async recheck() {}, async loadOptions() {} };
const searchState = { ...initialAvailabilityState(), options, draft };
const state = { ...initialStaffBookingState(), lines: selected, guestId: id(25), quote: quoteFor() };

test('quote review shows independent rates/dates, exact totals, selected policy and explicit acknowledgement', () => {
  const markup = renderToStaticMarkup(<StaffBookingWizard state={state} actions={actions} searchState={searchState} availability={availability} initialStage="review" />);
  for (const value of ['Room 101', 'Room 102', '1 Jun – 4 Jun 2027', '2 Jun – 6 Jun 2027', 'LKR 10,000.50', 'LKR 18,000.00', 'LKR 125,665.85', 'Service charge (10.00%)', 'Tax (12.00%', 'Selected policy', 'Asia/Colombo', 'I have reviewed']) assert.ok(markup.includes(value), value);
  // The stage actions are pinned to the bottom of the scroll pane.
  assert.match(markup, /sticky bottom-0/);
  // Policy acknowledgement is a checkbox, not a button.
  assert.match(markup, /role="checkbox"/);
  assert.match(markup, /disabled=""[^>]*>Confirm staff booking/);
  assert.match(markup, /lg:grid-cols-3/); assert.doesNotMatch(markup, /Pay now|DIRECT_ONLINE|actor ID/);
});
test('guest step lets front desk pick or create the primary guest instead of pasting a UUID', () => {
  const chosen = renderToStaticMarkup(<StaffBookingGuestStep state={state} actions={actions} />);
  for (const value of ['Primary guest', 'Front desk', id(25)]) assert.ok(chosen.includes(value), value);
  const empty = renderToStaticMarkup(<StaffBookingGuestStep state={{ ...initialStaffBookingState(), lines: selected }} actions={actions} />);
  for (const value of ['Search existing', 'New guest', 'Name, email or phone']) assert.ok(empty.includes(value), value);
  assert.doesNotMatch(empty, /Primary guest record ID/);
});
test('guest picker offers search and inline creation against the guest API', () => {
  const search = renderToStaticMarkup(<GuestPicker value="" selectedName="" onSelect={() => {}} />);
  for (const value of ['Search existing', 'New guest', 'Name, email or phone', 'Full NIC (exact)']) assert.ok(search.includes(value), value);
  const create = renderToStaticMarkup(<GuestPicker value="" selectedName="" onSelect={() => {}} initialMode="new" />);
  for (const value of ['Full name', 'Email (or phone)', 'Phone (or email)', 'Full NIC (optional)', 'Create guest']) assert.ok(create.includes(value), value);
});
test('create flow is a three-stage wizard and gates later stages on room selection', () => {
  const labels = ['Select rooms', 'Guest details', 'Review and confirm'];
  const empty = renderToStaticMarkup(<StaffBookingWizard state={initialStaffBookingState()} actions={actions} searchState={searchState} availability={availability} />);
  for (const label of labels) assert.ok(empty.includes(label), label);
  assert.match(empty, /disabled=""[^>]*>Continue to guest details/);
  const ready = renderToStaticMarkup(<StaffBookingWizard state={state} actions={actions} searchState={searchState} availability={availability} initialStage="review" />);
  assert.match(ready, /Review the provisional combined quote/);
  assert.doesNotMatch(ready, /disabled=""[^>]*>Continue to guest details/);
});
test('production screen denies missing/wrong session without loading inventory or showing writes', () => {
  for (const identity of [null, { ...session, role: 'BRANCH_MANAGER' }]) {
    const markup = renderToStaticMarkup(<StaffBookingScreen session={identity} />);
    assert.match(markup, /Sign in as Front Desk/); assert.doesNotMatch(markup, /<input|Confirm staff booking|Get fresh/);
  }
});
test('conflict state preserves primary guest and offers fresh quote while uncertain state disables retry', () => {
  const conflict = { ...state, quote: null, failure: new StaffBookingError('Get a fresh quote.', 'REQUOTE_REQUIRED', 409) };
  const markup = renderToStaticMarkup(<><StaffBookingAlerts state={conflict} /><StaffBookingReviewStep state={conflict} actions={actions} /></>);
  assert.match(markup, /role="alert"/); assert.ok(markup.includes(id(25))); assert.match(markup, /Get fresh combined quote/); assert.doesNotMatch(markup, /Confirm staff booking/);
  // The terminal action appears in the pinned footer but stays disabled without a reviewed quote.
  const wizard = renderToStaticMarkup(<StaffBookingWizard state={conflict} actions={actions} searchState={searchState} availability={availability} initialStage="review" />);
  assert.match(wizard, /disabled=""[^>]*>Confirm staff booking/);
  const uncertain = { ...state, quote: null, uncertain: true, notice: 'Check booking records before repeating.' };
  const blocked = renderToStaticMarkup(<><StaffBookingAlerts state={uncertain} /><StaffBookingReviewStep state={uncertain} actions={actions} disabled /></>);
  assert.match(blocked, /disabled=""[^>]*>Get fresh combined quote/);
});
test('success renders server reference, all agreed room rates and one provisional DRAFT invoice without cancellation controls', () => {
  const quote = quoteFor();
  const created = createdFor({ guestId: id(25), bookingChannel: 'FRONT_DESK', quotedBillingPolicyId: quote.billingPolicy.billingPolicyId,
    lines: quote.lines.map(line => ({ ...line, quotedRoomTypeId: line.roomTypeId, quotedBaseDailyRate: line.baseDailyRate })) });
  const markup = renderToStaticMarkup(<StaffBookingConfirmation created={created} />);
  for (const text of ['SN-SAMPLE-001', 'Room 101', 'Room 102', 'Agreed base rate', 'one DRAFT invoice', 'check-in are separate']) assert.ok(markup.includes(text));
  assert.doesNotMatch(markup, /Confirm staff booking|<input|Cancel booking|Checkout/);
});
