import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AvailabilityPanel } from '../src/components/rooms/AvailabilityPanel.tsx';
import { AvailabilityError, AvailabilityState, initialAvailabilityState, validateSearch } from '../src/lib/availability.ts';
import { double, draft, options, search, single } from './availabilityFixtures.ts';
const actions = { setDraft() {}, async search() {}, add() {}, remove() {}, clear() {}, async recheck() {}, async loadOptions() {} };
function render(patch: Partial<AvailabilityState> = {}) {
  return renderToStaticMarkup(<AvailabilityPanel state={{ ...initialAvailabilityState(), options, draft, ...patch }} actions={actions} />);
}

test('shared staff/direct-guest search exposes labelled per-line dates/capacity and type/READY filters', () => {
  const markup = render();
  for (const label of ['Arrival date', 'Departure date', 'Guests for this room', 'Any type', 'SkyNest Colombo', 'SkyNest Kandy', 'immediate check-in']) assert.ok(markup.includes(label), label);
  assert.match(markup, /direct guest reservation or a staff-assisted booking/);
  assert.match(markup, /departure is exclusive/);
  assert.doesNotMatch(markup, /Confirm booking|Pay now|guestId|userId/);
});

test('room results show exact LKR prices, capacity and amenities; CLEANING is explained as future inventory', () => {
  const markup = render({ results: { search, rooms: [single, double] } });
  for (const value of ['Room 101', 'Room 102', 'LKR 10,000.50', 'LKR 18,000.00', 'Wi-Fi', 'Up to 2 guests', 'Cleaning now']) assert.ok(markup.includes(value));
  assert.match(markup, /Available for the requested stay; immediate check-in requires READY/);
  assert.match(markup, /grid-cols-1/); assert.match(markup, /md:grid-cols-2/); assert.match(markup, /lg:grid-cols-3/);
});

test('running selection displays distinct line dates/guest counts and disables overlapping Add buttons', () => {
  const selected = [
    { selectionId: 'a', room: single, search, check: 'available' as const, issue: null },
    { selectionId: 'b', room: double, search: { ...search, checkIn: '2027-06-05', checkOut: '2027-06-09', guestCount: 2 }, check: 'unavailable' as const, issue: 'Room no longer available.' },
  ];
  const markup = render({ selected, results: { search, rooms: [single] } });
  assert.match(markup, /2 room lines · 3 guests across lines · 7 room nights/);
  assert.match(markup, /2027-06-05 to 2027-06-09/);
  assert.match(markup, /role="alert"[^>]*>Room no longer available/);
  assert.match(markup, /disabled=""[^>]*aria-label="Add room 101"/);
  assert.match(markup, /Selections are not reservations/);
});

test('empty results, loading, conflict and field validation states provide recovery instructions', () => {
  assert.match(render({ results: { search, rooms: [] } }), /No rooms match/);
  assert.match(render({ searching: true }), /Searching current inventory/);
  assert.match(render({ options: null, loadingOptions: true }), /Loading branches/);
  assert.match(render({ options: null }), /Reload search choices/);
  assert.match(render({ failure: new AvailabilityError('Availability changed. Search again.', 'CONFLICT', 409) }), /role="alert"/);
  let failure!: AvailabilityError;
  try { validateSearch({ ...draft, guestCount: '0' }, options); } catch (error) { failure = error as AvailabilityError; }
  const markup = render({ failure });
  assert.match(markup, /aria-invalid="true"/); assert.match(markup, /aria-describedby=/);
  assert.match(markup, /Enter 1–32767 guests/);
});
