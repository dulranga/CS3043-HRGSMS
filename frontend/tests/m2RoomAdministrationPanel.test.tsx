import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Reservations, RoomAdministrationPanel } from '../src/components/rooms/RoomAdministrationPanel.tsx';
import { RoomAdminApi, StaffRole } from '../src/lib/roomAdministration.ts';
import { branchId, initialData, line } from './roomAdministrationFixtures.ts';
function render(role: StaffRole | null) {
  const session = role ? { role, branchId } : null;
  return renderToStaticMarkup(<RoomAdministrationPanel session={session} api={new RoomAdminApi(session)} initialData={initialData} />);
}
function disabled(markup: string, label: string) { return new RegExp(`<button[^>]*disabled=""[^>]*>${label}</button>`).test(markup); }

test('Chain Manager can edit shared catalogue; other unscoped roles cannot', () => {
  const markup = render('CHAIN_MANAGER');
  assert.equal(disabled(markup, 'Add room type'), false);
  assert.equal(disabled(markup, 'Edit room type'), false);
  assert.equal(disabled(markup, 'Deactivate type'), false);
  assert.match(markup, /LKR 12,500.50/);
  assert.doesNotMatch(markup, /Add room<\/button>/);
  for (const role of ['SYSTEM_ADMINISTRATOR', 'AUDITOR'] as StaffRole[]) {
    const denied = render(role);
    assert.equal(disabled(denied, 'Add room type'), true);
    assert.equal(disabled(denied, 'Edit room type'), true);
  }
});

test('branch inventory controls are editable only by Branch Manager; foreign rooms stay hidden', () => {
  for (const role of ['BRANCH_MANAGER', 'FRONT_DESK', 'SERVICE_STAFF'] as StaffRole[]) {
    const markup = render(role);
    assert.match(markup, /Room 101/);
    assert.doesNotMatch(markup, /SECRET-OTHER-BRANCH/);
    assert.equal(disabled(markup, 'Add room'), role !== 'BRANCH_MANAGER');
    assert.equal(disabled(markup, 'Edit room'), role !== 'BRANCH_MANAGER');
    assert.equal(disabled(markup, 'Deactivate room'), role !== 'BRANCH_MANAGER');
    assert.equal(disabled(markup, 'View room &amp; blocks'), false);
    assert.match(markup, /READY/);
  }
});

test('unverified session has disabled writes and a sign-in state', () => {
  const markup = render(null);
  assert.match(markup, /Sign in to load room records/);
  assert.equal(disabled(markup, 'Add room type'), true);
  assert.equal(disabled(markup, 'Edit room type'), true);
});

test('conflict presentation includes booking reference, separate room line, stay dates and guests', () => {
  const markup = renderToStaticMarkup(<Reservations lines={[line]} />);
  for (const value of [line.bookingRef, line.lineId, line.stayStartDate, line.stayEndDate, '3 guests', 'BOOKED']) assert.ok(markup.includes(value), value);
  assert.equal(renderToStaticMarkup(<Reservations lines={[]} />), '');
});

test('responsive cards wrap controls and use the documented one/two/three-column grid', () => {
  const markup = render('BRANCH_MANAGER');
  for (const value of ['grid-cols-1', 'md:grid-cols-2', 'lg:grid-cols-3', 'flex-wrap', 'min-w-0']) assert.ok(markup.includes(value));
});
