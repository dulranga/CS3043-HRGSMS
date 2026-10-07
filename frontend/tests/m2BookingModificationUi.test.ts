import assert from 'node:assert/strict';
import test from 'node:test';
import { BookingModificationApi, BookingModificationError, BookingModificationModel, parseModificationResult, parseTypeQuote } from '../src/lib/staffBookingModification.ts';
import { StaffBookingReadError } from '../src/lib/staffBookingRead.ts';
import { bookingDetail } from './staffBookingReadFixtures.ts';
import { createModificationFixture, modificationSession, mutationResult, targetSingle, targetDouble } from './staffBookingModificationFixtures.ts';
import { id } from './availabilityFixtures.ts';

async function setup() {
  const fixture = createModificationFixture(), model = new BookingModificationModel(modificationSession, fixture.read, fixture.availability, fixture.modifications);
  await model.load(bookingDetail.bookingId); return { fixture, model };
}
async function prepareAdd(model: BookingModificationModel) {
  model.start('add'); model.setDraft({ checkIn: '2027-06-03', checkOut: '2027-06-07', guestCount: '2', reason: 'Guest requested another room' });
  await model.search(); model.select(targetDouble.roomId); await model.prepare();
}
test('add reviews separate dates and rate, needs explicit acknowledgement, then refreshes all lines and histories', async () => {
  const { fixture, model } = await setup(), original = fixture.snapshot(); await prepareAdd(model);
  assert.equal(model.getSnapshot().review?.agreedRate, '18000.00');
  await model.confirm(); assert.equal(fixture.snapshot().lines.length, 2);
  model.acknowledge(); await model.confirm();
  assert.equal(model.getSnapshot().booking?.lines.length, 3); assert.ok(model.getSnapshot().result);
  assert.deepEqual(model.getSnapshot().booking?.lines.slice(0, 2), original.lines);
  assert.equal(model.getSnapshot().booking?.lines[2].checkOut, '2027-06-07');
});
test('BOOKED change uses fresh catalogue rate without availability excluding its own assignment; checked-in edits are refused', async () => {
  const { model, fixture } = await setup(), original = fixture.snapshot().lines[0];
  model.start('change', id(10)); assert.equal(model.getSnapshot().editor, null);
  model.start('change', id(11)); model.setDraft({ checkOut: '2027-06-05', guestCount: '1', reason: 'Guest shortened this room stay' });
  await model.prepare(); assert.equal(model.getSnapshot().review?.agreedRate, '18000.00');
  fixture.flags.credit = true; model.acknowledge(); await model.confirm();
  assert.deepEqual(model.getSnapshot().booking?.lines[0], original);
  assert.equal(model.getSnapshot().booking?.lines[1].revisions.length, 1);
  assert.equal(model.getSnapshot().result?.invoice.creditAmount, '1234.50');
});
test('checked-in move keeps dates, guests and agreed rate while closing occupancy and preserving every assignment', async () => {
  const { model, fixture } = await setup(); model.start('move', id(10));
  model.setDraft({ checkIn: '2099-01-01', guestCount: '20', reason: 'Guest requested quieter room' });
  assert.equal(model.getSnapshot().draft.checkIn, '2027-06-01'); assert.equal(model.getSnapshot().draft.guestCount, '1');
  await model.search(); model.select(targetSingle.roomId); await model.prepare();
  assert.equal(model.getSnapshot().review?.agreedRate, '11000.00'); assert.equal(model.getSnapshot().review?.catalogueRate, '10000.50');
  assert.equal((model.getSnapshot().review?.input as any).approvedPriceAdjustment, null);
  const other = fixture.snapshot().lines[1]; model.acknowledge(); await model.confirm();
  assert.equal(model.getSnapshot().booking?.lines[0].assignments.length, 3); assert.equal(model.getSnapshot().booking?.lines[0].rateSnapshot, '11000.00');
  assert.ok(model.getSnapshot().booking?.lines[0].assignments[1].occupiedTo); assert.deepEqual(model.getSnapshot().booking?.lines[1], other);
});
test('BOOKED move snapshots target rate and preserves assignment and rate revisions', async () => {
  const { model, fixture } = await setup(); fixture.flags.changedRate = true; model.start('move', id(11)); model.setDraft({ reason: 'Move to another Double room' });
  await model.search(); model.select(targetDouble.roomId); await model.prepare(); model.acknowledge(); await model.confirm();
  assert.equal(model.getSnapshot().booking?.lines[1].assignments.length, 2); assert.equal(model.getSnapshot().booking?.lines[1].status, 'BOOKED');
  assert.equal(model.getSnapshot().booking?.lines[1].rateSnapshot, '19000.50'); assert.equal(model.getSnapshot().booking?.lines[1].revisions[0].oldValues.rateSnapshot, '18000.00');
});
test('rejected state, inventory, re-quote and concurrency changes preserve every line and draft and require a new review', async () => {
  for (const code of ['REQUOTE_REQUIRED', 'INVENTORY_CONFLICT', 'RETRY_TRANSACTION', 'INVALID_STATE']) {
    const { fixture, model } = await setup(), original = fixture.snapshot(); await prepareAdd(model);
    fixture.flags.error = code; model.acknowledge(); await model.confirm();
    assert.deepEqual(model.getSnapshot().booking, original); assert.equal(model.getSnapshot().review, null); assert.equal(model.getSnapshot().acknowledged, false);
    assert.equal(model.getSnapshot().draft.reason, 'Guest requested another room'); assert.equal(model.getSnapshot().uncertain, false);
    assert.match(model.getSnapshot().failure!.message, /rolled back/); assert.doesNotMatch(model.getSnapshot().failure!.message, /RAW-ERROR/);
  }
});
test('unknown mutation blocks retries through reload failures until explicit booking/invoice reconciliation', async () => {
  const { model, fixture } = await setup(); await prepareAdd(model); fixture.flags.unknown = true; model.acknowledge(); await model.confirm();
  assert.equal(model.getSnapshot().uncertain, true); model.start('add'); await model.confirm();
  model.reconciled(); assert.equal(model.getSnapshot().uncertain, true);
  fixture.flags.refreshFailure = true; await model.load(bookingDetail.bookingId); assert.equal(model.getSnapshot().uncertain, true);
  model.reconciled(); assert.equal(model.getSnapshot().uncertain, true);
  fixture.flags.refreshFailure = false; await model.load(bookingDetail.bookingId); assert.equal(model.getSnapshot().uncertain, true);
  model.reconciled(); assert.equal(model.getSnapshot().uncertain, false); assert.equal(model.getSnapshot().editor, null);
});
test('one confirmation is sent while pending; editor and reload actions cannot replay or replace it', async () => {
  const fixture = createModificationFixture(); let calls = 0, resolve!: () => void;
  const pending = new Promise<void>(r => { resolve = r; });
  const model = new BookingModificationModel(modificationSession, fixture.read, fixture.availability, {
    typeQuote: fixture.modifications.typeQuote.bind(fixture.modifications),
    async modify(review) { calls++; await pending; return fixture.modifications.modify(review); },
  });
  await model.load(bookingDetail.bookingId); await prepareAdd(model); model.acknowledge();
  const saving = model.confirm(); await model.confirm(); model.start('move', id(10)); model.setDraft({ reason: 'Changed while saving' }); await model.load(bookingDetail.bookingId);
  assert.equal(calls, 1); assert.equal(model.getSnapshot().editor?.kind, 'add'); assert.equal(model.getSnapshot().draft.reason, 'Guest requested another room');
  resolve(); await saving; assert.equal(model.getSnapshot().booking?.lines.length, 3); assert.equal(calls, 1);
});
test('known success with failed history reload retains committed invoice proof and blocks further edits', async () => {
  const { model, fixture } = await setup(); await prepareAdd(model); fixture.flags.refreshFailure = true; model.acknowledge(); await model.confirm();
  assert.ok(model.getSnapshot().result); assert.equal(model.getSnapshot().needsRefresh, true); assert.equal(model.getSnapshot().booking, null);
  model.start('add'); assert.equal(model.getSnapshot().editor, null);
  fixture.flags.refreshFailure = false; await model.load(bookingDetail.bookingId); assert.equal(model.getSnapshot().needsRefresh, false); assert.ok(model.getSnapshot().result);
});
test('dates, capacity, reason and terminal states prevent invalid reviews and local overlaps cannot select another assigned line', async () => {
  const { model } = await setup(); model.start('add'); model.setDraft({ checkIn: '2027-02-30', checkOut: '2027-03-04' }); await model.search();
  assert.match(model.getSnapshot().failure!.message, /valid stay dates/);
  model.setDraft({ checkIn: '2027-06-03', checkOut: '2027-06-06', guestCount: '2' }); await model.search(); model.select(targetDouble.roomId); await model.prepare();
  assert.match(model.getSnapshot().failure!.message, /reason/); assert.equal(model.getSnapshot().review, null);
  const custom = new BookingModificationModel(modificationSession, { async detail() { return structuredClone(bookingDetail); }, async list() { throw new Error(); } },
    { async options() { throw new Error(); }, async search() { return [{ ...targetDouble, roomId: id(7) }, { ...targetDouble, branchId: id(2) }]; } }, createModificationFixture().modifications);
  await custom.load(bookingDetail.bookingId); custom.start('add'); custom.setDraft({ checkIn: '2027-06-03', checkOut: '2027-06-05', guestCount: '2', reason: 'Duplicate attempt' }); await custom.search();
  assert.deepEqual(custom.getSnapshot().rooms, []);
});
test('changed search/draft clears selection and reviewed acknowledgement; fresh target rates are reviewed explicitly', async () => {
  const { model, fixture } = await setup(); await prepareAdd(model); model.acknowledge(); model.setDraft({ checkOut: '2027-06-08' });
  assert.equal(model.getSnapshot().review, null); assert.equal(model.getSnapshot().selected, null); assert.equal(model.getSnapshot().acknowledged, false);
  await model.search(); model.select(targetDouble.roomId); fixture.flags.changedRate = true; await model.prepare();
  assert.equal(model.getSnapshot().review?.agreedRate, '19000.50'); assert.equal(model.getSnapshot().acknowledged, false);
});
test('late search and catalogue responses cannot restore an old selection or review', async () => {
  const { fixture } = await setup(); let resolve!: (value: any) => void;
  const wait = new Promise<any>(r => { resolve = r; });
  const model = new BookingModificationModel(modificationSession, fixture.read, { ...fixture.availability, async options() { throw new Error(); }, async search() { return wait; } }, fixture.modifications);
  await model.load(bookingDetail.bookingId); model.start('add'); model.setDraft({ checkIn: '2027-06-03', checkOut: '2027-06-07', guestCount: '2', reason: 'New room' });
  const pending = model.search(); model.setDraft({ checkOut: '2027-06-08' }); resolve([targetDouble]); await pending; assert.equal(model.getSnapshot().rooms, null);
  let resolveType!: (value: any) => void; const typeWait = new Promise<any>(r => { resolveType = r; });
  const changing = new BookingModificationModel(modificationSession, fixture.read, fixture.availability, { async typeQuote() { return typeWait; }, modify: fixture.modifications.modify.bind(fixture.modifications) });
  await changing.load(bookingDetail.bookingId); changing.start('change', id(11)); changing.setDraft({ reason: 'Shorter stay' });
  const preparing = changing.prepare(); changing.close(); resolveType({ ...targetDouble.roomType, active: true }); await preparing;
  assert.equal(changing.getSnapshot().review, null); assert.equal(changing.getSnapshot().reviewing, false);
});
test('missing/wrong identity makes no read or write requests; branch denial clears records and draft', async () => {
  let calls = 0; const transport = async () => { calls++; return new Response(); };
  for (const session of [null, { ...modificationSession, role: 'BRANCH_MANAGER' }, { ...modificationSession, branchId: 'bad' }]) {
    const api = new BookingModificationApi(session, transport); await assert.rejects(api.typeQuote(id(3)), BookingModificationError);
  }
  assert.equal(calls, 0);
  const { model, fixture } = await setup(); await prepareAdd(model); fixture.flags.error = 'FORBIDDEN'; model.acknowledge(); await model.confirm();
  assert.equal(model.getSnapshot().booking, null); assert.equal(model.getSnapshot().editor, null); assert.equal(model.getSnapshot().draft.reason, '');
  const blocked = new BookingModificationModel(null, { async detail() { calls++; throw new StaffBookingReadError('Denied', 'FORBIDDEN', 403); }, async list() { throw new Error(); } }, fixture.availability, fixture.modifications);
  await blocked.load(bookingDetail.bookingId); assert.equal(calls, 0);
});
test('API sends only precise add/PATCH/move contracts with verified mutation headers and same-origin credentials', async () => {
  const { model } = await setup(); await prepareAdd(model); const review = model.getSnapshot().review!;
  const requests: any[] = [];
  const api = new BookingModificationApi(modificationSession, async (url, init) => { requests.push({ url, init }); return new Response(JSON.stringify({ data: mutationResult(review) })); });
  await api.modify(review);
  assert.equal(requests[0].url, `/api/bookings/${bookingDetail.bookingId}/lines`); assert.equal(requests[0].init.method, 'POST'); assert.equal(requests[0].init.credentials, 'same-origin');
  assert.equal(new Headers(requests[0].init.headers).get('X-Fixture-CSRF'), 'sample-only');
  assert.deepEqual(Object.keys(JSON.parse(requests[0].init.body)).sort(), ['roomId', 'checkIn', 'checkOut', 'guestCount', 'quotedRoomTypeId', 'quotedBaseDailyRate', 'reason'].sort());
  for (const kind of ['change', 'move'] as const) {
    const changed = { ...review, kind, lineId: id(11) }; const sent: any[] = [];
    const client = new BookingModificationApi(modificationSession, async (url, init) => { sent.push({ url, init }); return new Response(JSON.stringify({ data: mutationResult(changed) })); });
    await client.modify(changed); const body = JSON.parse(sent[0].init.body);
    assert.equal(sent[0].init.method, kind === 'change' ? 'PATCH' : 'POST');
    assert.equal(sent[0].url, `/api/bookings/${bookingDetail.bookingId}/lines/${id(11)}${kind === 'move' ? '/move' : ''}`);
    assert.equal('roomId' in body, kind === 'move'); assert.equal('checkIn' in body, kind === 'change');
    assert.equal('actorId' in body || 'branchId' in body || 'rateSnapshot' in body, false);
    if (kind === 'move') assert.equal(body.approvedPriceAdjustment, null);
  }
});
test('response projection rejects wrong IDs, rates and inconsistent credit; mutation server/network/malformed responses are uncertain', async () => {
  const { model } = await setup(); await prepareAdd(model); const review = model.getSnapshot().review!, result = mutationResult(review, true);
  assert.equal(parseModificationResult({ data: result }, review).invoice.balance, '-1234.50');
  for (const mutate of [(r: any) => { r.bookingId = id(99); }, (r: any) => { r.line.rateSnapshot = '0'; }, (r: any) => { r.invoice.creditAmount = '0.00'; }, (r: any) => { r.line.currentAssignment.occupiedFrom = 'bad'; }]) {
    const bad = structuredClone(result); mutate(bad); assert.throws(() => parseModificationResult({ data: bad }, review), BookingModificationError);
  }
  assert.throws(() => parseTypeQuote({ data: { ...targetSingle.roomType, active: true } }, id(4)), BookingModificationError);
  for (const transport of [async () => new Response('bad'), async () => new Response('{}', { status: 500 }), async () => { throw new TypeError(); }]) {
    const api = new BookingModificationApi(modificationSession, transport); await assert.rejects(api.modify(review), (e: BookingModificationError) => e.uncertain);
  }
});
