import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomAdminApi, RoomAdminError, StaffRole, amenityPayload, blockPayload, conditionPayload, permissions, roomPayload, typePayload } from '../src/lib/roomAdministration.ts';
import { room, roomType, amenity, block, line, branchId, otherBranchId } from './roomAdministrationFixtures.ts';

const typeDraft = { name: ' Deluxe ', capacity: '3', baseDailyRate: '12500.50', amenityIds: [amenity.amenityId] };
const roomDraft = { roomNumber: ' 101 ', roomTypeId: roomType.roomTypeId };
const blockDraft = { startDate: '2027-12-01', endDate: '2027-12-03', reason: ' Maintenance ' };
function harness(role: StaffRole, payload: unknown = { data: room }, status = 200) {
  const calls: { path: string; options?: RequestInit }[] = [];
  const api = new RoomAdminApi({ role, branchId }, async (input, options) => {
    calls.push({ path: String(input), options });
    return new Response(status === 204 ? null : JSON.stringify(payload), { status });
  });
  return { api, calls };
}

test('default browser fetch preserves its receiver for catalogue reads and writes', async () => {
  const original = globalThis.fetch;
  const calls: { path: string; options?: RequestInit }[] = [];
  try {
    globalThis.fetch = async function (this: unknown, input, options) {
      assert.equal(this, undefined);
      calls.push({ path: String(input), options });
      return new Response(JSON.stringify({ data: options?.method === 'POST' ? amenity : [] }));
    };
    const api = new RoomAdminApi({ role: 'CHAIN_MANAGER', branchId });
    assert.deepEqual(await api.types(), []);
    assert.deepEqual(await api.amenities(), []);
    assert.deepEqual(await api.saveAmenity({ name: 'WiFi', description: '' }), amenity);
    assert.deepEqual(calls.map(call => [call.path, call.options?.method]), [
      ['/api/room-types?active=all', 'GET'], ['/api/amenities?active=all', 'GET'], ['/api/amenities', 'POST'],
    ]);
    assert.ok(calls.every(call => call.options?.credentials === 'include'));
  } finally { globalThis.fetch = original; }
});

test('AT-24 shared catalogue mutations admit only Chain Manager, before transport', async () => {
  for (const role of ['BRANCH_MANAGER', 'FRONT_DESK', 'SERVICE_STAFF', 'SYSTEM_ADMINISTRATOR', 'AUDITOR'] as StaffRole[]) {
    const { api, calls } = harness(role);
    for (const work of [() => api.saveType(typeDraft), () => api.toggleType(roomType), () => api.saveAmenity({ name: 'WiFi', description: '' }), () => api.toggleAmenity(amenity)]) {
      assert.throws(work, error => error instanceof RoomAdminError && error.status === 403);
    }
    assert.equal(calls.length, 0);
  }
  const { api, calls } = harness('CHAIN_MANAGER', { data: roomType });
  await api.saveType(typeDraft, roomType.roomTypeId);
  assert.equal(calls[0].path, `/api/room-types/${roomType.roomTypeId}`);
  assert.equal(calls[0].options?.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[0].options?.body as string), { name: 'Deluxe', capacity: 3, baseDailyRate: '12500.50', amenityIds: [amenity.amenityId] });
});

test('AT-24 room and block writes admit only own-branch Branch Manager', async () => {
  for (const role of ['CHAIN_MANAGER', 'FRONT_DESK', 'SERVICE_STAFF', 'SYSTEM_ADMINISTRATOR', 'AUDITOR'] as StaffRole[]) {
    const { api, calls } = harness(role);
    for (const work of [() => api.saveRoom(roomDraft), () => api.toggleRoom(room), () => api.saveBlock(room, blockDraft), () => api.removeBlock(room, block)]) assert.throws(work, /permission/);
    assert.equal(calls.length, 0);
  }
  const { api, calls } = harness('BRANCH_MANAGER');
  const other = { ...room, branchId: otherBranchId };
  for (const work of [() => api.saveRoom(roomDraft, other), () => api.toggleRoom(other), () => api.saveBlock(other, blockDraft), () => api.removeBlock(other, block), () => api.detail(other), () => api.blocks(other)]) assert.throws(work, /another branch/);
  assert.throws(() => api.removeBlock(room, { ...block, roomId: otherBranchId }), /does not belong/);
  await api.saveRoom(roomDraft);
  await api.saveRoom(roomDraft, room);
  await api.toggleRoom(room);
  await api.saveBlock(room, blockDraft);
  await api.saveBlock(room, blockDraft, block);
  assert.deepEqual(calls.map(call => [call.path, call.options?.method]), [
    ['/api/rooms', 'POST'], [`/api/rooms/${room.roomId}`, 'PATCH'], [`/api/rooms/${room.roomId}`, 'PATCH'],
    [`/api/rooms/${room.roomId}/blocks`, 'POST'], [`/api/room-blocks/${block.blockId}`, 'PATCH'],
  ]);
  for (const call of calls) {
    assert.equal(call.options?.credentials, 'include');
    assert.deepEqual(call.options?.headers, { 'Content-Type': 'application/json' });
    assert.doesNotMatch(call.options?.body as string, /branchId|userId|role|operationalStatus/);
  }
  const removal = harness('BRANCH_MANAGER', null, 204);
  await removal.api.removeBlock(room, block);
  assert.equal(removal.calls[0].options?.method, 'DELETE');
});

test('physical condition uses M3 audited endpoint and its distinct response shape', async () => {
  for (const role of ['BRANCH_MANAGER', 'SERVICE_STAFF'] as StaffRole[]) {
    const { api, calls } = harness(role, { room_id: room.roomId, condition: 'CLEANING', changed: true });
    await api.changeCondition(room, 'CLEANING', 'Inspection');
    assert.equal(calls[0].path, `/api/rooms/${room.roomId}/condition`);
    assert.deepEqual(JSON.parse(calls[0].options?.body as string), { condition: 'CLEANING', reason: 'Inspection' });
  }
  await assert.rejects(harness('FRONT_DESK').api.changeCondition(room, 'READY', 'Reason'), /permission/);
});

test('unknown/missing-branch sessions cannot send writes and anonymous reads stop locally', async () => {
  assert.equal(permissions({ role: 'BRANCH_MANAGER', branchId: null }).inventory, false);
  assert.equal(permissions({ role: 'BRANCH_MANAGER', branchId: 'invalid' }).branchRead, false);
  let calls = 0;
  const api = new RoomAdminApi(null, async () => { calls++; return new Response('{}'); });
  await assert.rejects(api.types(), error => error instanceof RoomAdminError && error.status === 401);
  assert.throws(() => api.saveType(typeDraft), /permission/);
  assert.equal(calls, 0);
});

test('validation mirrors backend decimal, capacity, name, UUID and half-open calendar contracts', () => {
  for (const capacity of ['0', '32768', '1.5', '-1', 'NaN']) assert.throws(() => typePayload({ ...typeDraft, capacity }), /Capacity/);
  for (const baseDailyRate of ['-1', '1.001', '1e3', '10000000000', '']) assert.throws(() => typePayload({ ...typeDraft, baseDailyRate }), /Rate/);
  assert.equal(typePayload({ ...typeDraft, baseDailyRate: '0' }).baseDailyRate, '0');
  assert.throws(() => typePayload({ ...typeDraft, name: ' ' }), /Name/);
  assert.throws(() => typePayload({ ...typeDraft, amenityIds: ['invalid'] }), /amenity/);
  assert.throws(() => roomPayload({ ...roomDraft, roomNumber: ' ' }), /Room number/);
  assert.throws(() => amenityPayload({ name: 'WiFi', description: 'x'.repeat(256) }), /255/);
  for (const dates of [['2027-02-29', '2027-03-01'], ['2027-12-02', '2027-12-02'], ['2027-12-03', '2027-12-02']]) assert.throws(() => blockPayload({ ...blockDraft, startDate: dates[0], endDate: dates[1] }));
  assert.deepEqual(blockPayload(blockDraft), { ...blockDraft, reason: 'Maintenance' });
  assert.throws(() => conditionPayload('READY', ' '), /Reason/);
});

test('AT-23/27 conflict responses retain affected reservations and reject the update', async () => {
  const { api } = harness('CHAIN_MANAGER', { error: { code: 'CATALOGUE_CONFLICT', message: 'Capacity too small.', affectedLines: [line] } }, 409);
  await assert.rejects(api.saveType({ ...typeDraft, capacity: '1' }, roomType.roomTypeId), error => {
    assert.ok(error instanceof RoomAdminError);
    assert.equal(error.status, 409);
    assert.deepEqual(error.affectedLines, [line]);
    return true;
  });
  const blockConflict = harness('BRANCH_MANAGER', { error: { code: 'INVENTORY_CONFLICT', message: 'Overlapping reservation.', affectedLines: [line] } }, 409);
  await assert.rejects(blockConflict.api.saveBlock(room, blockDraft), error => error instanceof RoomAdminError && error.affectedLines[0].bookingRef === line.bookingRef);
  const paths: string[] = [];
  const conditionApi = new RoomAdminApi({ role: 'BRANCH_MANAGER', branchId }, async input => {
    paths.push(String(input));
    return String(input).endsWith('/condition')
      ? new Response(JSON.stringify({ error: { code: 'ROOM_CONDITION_CONFLICT', message: 'An active reservation prevents maintenance.' } }), { status: 409 })
      : new Response(JSON.stringify({ data: room }));
  });
  await assert.rejects(conditionApi.changeCondition(room, 'OUT_OF_SERVICE', 'Repair'), error => error instanceof RoomAdminError && error.affectedLines[0].lineId === line.lineId);
  assert.deepEqual(paths, [`/api/rooms/${room.roomId}/condition`, `/api/rooms/${room.roomId}`]);
});

test('reads, forbidden server responses and transport failures are handled without exposing internals', async () => {
  const read = harness('BRANCH_MANAGER', { data: [] });
  await read.api.types(); await read.api.amenities(); await read.api.rooms(); await read.api.detail(room); await read.api.blocks(room);
  assert.deepEqual(read.calls.map(call => call.path), ['/api/room-types?active=all', '/api/amenities?active=all', '/api/rooms?active=all', `/api/rooms/${room.roomId}`, `/api/rooms/${room.roomId}/blocks`]);
  await assert.rejects(harness('BRANCH_MANAGER', { error: { message: 'SQL secret' } }, 403).api.saveRoom(roomDraft), /permission/);
  await assert.rejects(harness('BRANCH_MANAGER', { error: { message: 'SQL secret' } }, 500).api.saveRoom(roomDraft), error => error instanceof RoomAdminError && !error.message.includes('secret'));
  const offline = new RoomAdminApi({ role: 'BRANCH_MANAGER', branchId }, async () => { throw new Error('offline'); });
  await assert.rejects(offline.types(), /Unable to reach/);
});
