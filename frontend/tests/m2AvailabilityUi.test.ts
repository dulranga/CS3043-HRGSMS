import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AvailabilityApi, AvailabilityClient, AvailabilityError, AvailabilityModel,
  AvailableRoom, nights, parseOptions, parseRooms, selectionIssue, validateSearch,
} from '../src/lib/availability.ts';
import { double, draft, envelope, id, options, search, single } from './availabilityFixtures.ts';

function client(rows: AvailableRoom[] = [single, double]): AvailabilityClient {
  return { options: async () => options, search: async criteria => rows.filter(r => r.roomType.capacity >= criteria.guestCount && (!criteria.immediateCheckIn || r.operationalStatus === 'READY')) };
}
async function ready(api = client()) {
  const model = new AvailabilityModel(api);
  await model.loadOptions(); model.setDraft(draft); await model.search();
  return model;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('per-room criteria validate calendar boundaries, branch/type choices and smallint capacity', () => {
  assert.deepEqual(validateSearch(draft, options), search);
  for (const checkIn of ['2027-02-29', '0000-01-01', '2027-13-01', '']) assert.throws(() => validateSearch({ ...draft, checkIn }), /Correct/);
  for (const checkOut of ['2027-06-01', '2027-05-31', '2027-04-31']) assert.throws(() => validateSearch({ ...draft, checkOut }), /Correct/);
  for (const guestCount of ['0', '-1', '1.5', '32768', '01', 'NaN']) assert.throws(() => validateSearch({ ...draft, guestCount }), /Correct/);
  assert.throws(() => validateSearch({ ...draft, branchId: id(99) }, options));
  assert.throws(() => validateSearch({ ...draft, roomTypeId: id(99) }, options));
  assert.equal(nights(search), 3);
  assert.equal(nights({ checkIn: '2028-02-28', checkOut: '2028-03-01' }), 2);
});

test('public API uses the mounted GET contract without actor identity or write requests', async () => {
  const calls: { path: string; init?: RequestInit }[] = [];
  const api = new AvailabilityApi(async (input, init) => {
    calls.push({ path: String(input), init });
    return new Response(JSON.stringify(String(input).endsWith('/options') ? { data: options } : envelope([single], { ...search, roomTypeId: single.roomType.roomTypeId })));
  });
  assert.deepEqual(await api.options(), options);
  const rows = await api.search({ ...search, roomTypeId: single.roomType.roomTypeId });
  assert.equal(rows[0].roomType.baseDailyRate, '10000.50');
  const query = new URL(calls[1].path, 'http://localhost').searchParams;
  assert.equal(query.get('branchId'), id(1)); assert.equal(query.get('roomTypeId'), id(3));
  assert.equal(query.get('guestCount'), '1'); assert.equal(query.get('immediateCheckIn'), 'false');
  for (const call of calls) { assert.equal(call.init?.method, 'GET'); assert.equal(call.init?.body, undefined); assert.equal(call.init?.headers, undefined); }
});

test('default browser fetch is invoked without the API instance as its receiver', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async function (this: unknown) {
      assert.equal(this, undefined);
      return new Response(JSON.stringify({ data: options }));
    };
    assert.deepEqual(await new AvailabilityApi().options(), options);
  } finally { globalThis.fetch = original; }
});

test('unreadable, stale-meta, cross-branch, undersized and immediate CLEANING responses are refused', () => {
  assert.deepEqual(parseRooms(envelope([], search), search), []);
  assert.throws(() => parseRooms(envelope([single], { ...search, checkOut: '2027-06-05' }), search));
  assert.throws(() => parseRooms(envelope([{ ...single, branchId: id(2) }]), search));
  assert.throws(() => parseRooms(envelope([single], { ...search, guestCount: 2 }), { ...search, guestCount: 2 }));
  assert.throws(() => parseRooms(envelope([double], { ...search, immediateCheckIn: true }), { ...search, immediateCheckIn: true }));
  assert.throws(() => parseRooms(envelope([single, single]), search));
  assert.throws(() => parseRooms({ data: [] }, search));
  assert.throws(() => parseOptions({ data: { branches: [{}], roomTypes: [] } }));
});

test('two rooms retain independently dated lines, capacities and exact type rates as criteria change', async () => {
  const model = await ready();
  model.add(single.roomId);
  model.setDraft({ checkIn: '2027-06-02', checkOut: '2027-06-06', guestCount: '2' });
  assert.equal(model.getSnapshot().results, null);
  await model.search(); model.add(double.roomId);
  const state = model.getSnapshot();
  assert.equal(state.selected.length, 2);
  assert.deepEqual(state.selected.map(line => [line.search.checkIn, line.search.checkOut, line.search.guestCount, line.room.roomType.baseDailyRate]), [
    ['2027-06-01', '2027-06-04', 1, '10000.50'], ['2027-06-02', '2027-06-06', 2, '18000.00'],
  ]);
  assert.equal(state.selected.reduce((sum, line) => sum + nights(line.search), 0), 7);
  model.remove(state.selected[0].selectionId);
  assert.equal(model.getSnapshot().selected.length, 1);
  model.clear(); assert.equal(model.getSnapshot().selected.length, 0);
});

test('local selection rejects overlaps and mixed branches while permitting adjacent stays of the same room', async () => {
  const model = await ready(); model.add(single.roomId); model.add(single.roomId);
  assert.equal(model.getSnapshot().selected.length, 1);
  assert.match(model.getSnapshot().failure!.message, /overlapping/);
  model.setDraft({ branchId: id(2) });
  assert.equal(model.getSnapshot().draft.branchId, id(1));
  assert.match(model.getSnapshot().failure!.message, /different branch/);
  assert.match(selectionIssue({ ...single, branchId: id(2) }, { ...search, branchId: id(2) }, model.getSnapshot().selected)!, /one branch/);
  assert.match(selectionIssue(single, { ...search, guestCount: 2 }, [])!, /accommodate/);
  model.setDraft({ checkIn: '2027-06-04', checkOut: '2027-06-06' });
  await model.search(); model.add(single.roomId);
  assert.equal(model.getSnapshot().selected.length, 2);
});

test('late search responses cannot restore results after fields change or overwrite a newer search', async () => {
  const old = deferred<AvailableRoom[]>(), newer = deferred<AvailableRoom[]>();
  let call = 0;
  const model = new AvailabilityModel({ options: async () => options, search: () => (++call === 1 ? old.promise : newer.promise) });
  await model.loadOptions(); model.setDraft(draft);
  const first = model.search();
  model.setDraft({ guestCount: '2' });
  const second = model.search();
  newer.resolve([double]); await second;
  old.resolve([single]); await first;
  assert.deepEqual(model.getSnapshot().results?.rooms, [double]);
  assert.equal(model.getSnapshot().results?.search.guestCount, 2);
  const afterEdit = deferred<AvailableRoom[]>();
  const edited = new AvailabilityModel({ options: async () => options, search: () => afterEdit.promise });
  await edited.loadOptions(); edited.setDraft(draft);
  const pending = edited.search(); edited.setDraft({ checkOut: '2027-06-05' });
  afterEdit.resolve([single]); await pending;
  assert.equal(edited.getSnapshot().results, null);
  edited.add(single.roomId); assert.equal(edited.getSnapshot().selected.length, 0);
});

test('empty and server-conflict searches retain prior selected lines with a recoverable state', async () => {
  let mode = 'normal';
  const model = await ready({ options: async () => options, search: async () => {
    if (mode === 'conflict') throw new AvailabilityError('Availability changed. Search again.', 'CONFLICT', 409);
    return mode === 'empty' ? [] : [single];
  } });
  model.add(single.roomId); mode = 'empty'; await model.search();
  assert.deepEqual(model.getSnapshot().results?.rooms, []);
  assert.equal(model.getSnapshot().selected.length, 1);
  mode = 'conflict'; await model.search();
  assert.equal(model.getSnapshot().failure?.status, 409);
  assert.equal(model.getSnapshot().results, null);
  assert.equal(model.getSnapshot().selected.length, 1);
});

test('recheck searches every line with its original dates/guest count and flags conflicts without deleting it', async () => {
  const calls: unknown[] = []; let checking = false;
  const model = await ready({ options: async () => options, search: async criteria => {
    calls.push(criteria);
    return checking ? [] : [single, double];
  } });
  model.add(single.roomId); model.setDraft({ checkIn: '2027-06-05', checkOut: '2027-06-08' });
  await model.search(); model.add(double.roomId);
  checking = true; calls.length = 0; await model.recheck();
  assert.deepEqual(calls, model.getSnapshot().selected.map(line => line.search));
  assert.equal(model.getSnapshot().selected.length, 2);
  assert.ok(model.getSnapshot().selected.every(line => line.check === 'unavailable'));
});

test('recheck detects catalogue changes and network failure; removing a draft is never a persisted cancellation', async () => {
  let mode = 'initial';
  const model = await ready({ options: async () => options, search: async () => {
    if (mode === 'offline') throw new AvailabilityError('Unable to reach availability search.');
    return [{ ...single, roomType: { ...single.roomType, baseDailyRate: mode === 'changed' ? '11000.00' : '10000.50' } }];
  } });
  model.add(single.roomId); mode = 'changed'; await model.recheck();
  assert.equal(model.getSnapshot().selected[0].check, 'changed');
  assert.equal(model.getSnapshot().selected[0].room.roomType.baseDailyRate, '10000.50');
  mode = 'offline'; await model.recheck();
  assert.equal(model.getSnapshot().selected[0].check, 'unverified');
  mode = 'initial'; await model.recheck();
  assert.equal(model.getSnapshot().selected[0].check, 'available');
  model.remove(model.getSnapshot().selected[0].selectionId);
  assert.equal(model.getSnapshot().selected.length, 0);
});

test('public failures do not expose internal server messages and choices can be retried', async () => {
  const api = new AvailabilityApi(async () => new Response(JSON.stringify({ error: { message: 'SQL secret' } }), { status: 500 }));
  await assert.rejects(api.search(search), error => error instanceof AvailabilityError && !error.message.includes('secret'));
  const offline = new AvailabilityApi(async () => { throw new Error('socket'); });
  await assert.rejects(offline.options(), /Unable to reach/);
  let attempts = 0;
  const model = new AvailabilityModel({ options: async () => { if (++attempts === 1) throw new Error('offline'); return options; }, search: async () => [] });
  await model.loadOptions(); assert.ok(model.getSnapshot().failure);
  await model.loadOptions(); assert.deepEqual(model.getSnapshot().options, options);
  assert.equal(model.getSnapshot().failure, null);
});
