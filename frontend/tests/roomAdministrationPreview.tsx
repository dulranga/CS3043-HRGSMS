// Vite-only fixture: mock transport, no credentials or database access.
// It is deliberately excluded from the production router and build.
import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '../src/components/ui/button';
import { RoomAdministrationPanel } from '../src/components/rooms/RoomAdministrationPanel';
import { RoomAdminApi, StaffRole } from '../src/lib/roomAdministration';
import { initialData, block, branchId, line } from './roomAdministrationFixtures';
import '../src/index.css';

function transport() {
  const data = structuredClone(initialData);
  const blocks = [structuredClone(block)];
  let nextId = 20;
  const uuid = () => `0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5d${String(nextId++).padStart(2, '0')}`;
  const conflict = (message: string) => new Response(JSON.stringify({ error: { code: 'INVENTORY_CONFLICT', message, affectedLines: [line] } }), { status: 409 });
  return async (input: RequestInfo | URL, options?: RequestInit) => {
    const path = String(input).split('?')[0].replace('/api/', '').split('/');
    const body = options?.body ? JSON.parse(String(options.body)) : {};
    const method = options?.method ?? 'GET';
    let value: unknown;
    if (path[0] === 'room-types') {
      if (method === 'GET') value = data.types;
      if (method === 'POST') { const type = { ...body, roomTypeId: uuid(), active: true, amenities: data.amenities.filter(a => body.amenityIds.includes(a.amenityId)) }; data.types.push(type); value = type; }
      if (method === 'PATCH') {
        const type = data.types.find(t => t.roomTypeId === path[1])!;
        if (body.capacity < 3 || body.active === false) return conflict('The room type change conflicts with SKY-EXAMPLE.');
        Object.assign(type, body, body.amenityIds ? { amenities: data.amenities.filter(a => body.amenityIds.includes(a.amenityId)) } : {}); value = type;
      }
    } else if (path[0] === 'amenities') {
      if (method === 'GET') value = data.amenities;
      if (method === 'POST') { const a = { ...body, amenityId: uuid(), active: true }; data.amenities.push(a); value = a; }
      if (method === 'PATCH') { const a = data.amenities.find(a => a.amenityId === path[1])!; Object.assign(a, body); value = a; }
    } else if (path[0] === 'rooms') {
      if (method === 'GET') value = !path[1] ? data.rooms : path[2] === 'blocks' ? blocks : data.rooms.find(r => r.roomId === path[1]);
      if (method === 'POST' && !path[1]) {
        const type = data.types.find(t => t.roomTypeId === body.roomTypeId)!;
        const room = { ...body, roomId: uuid(), branchId, active: true, operationalStatus: 'READY' as const, roomType: type, activeAssignmentCount: 0, blockCount: 0, affectedLines: [] };
        data.rooms.push(room); value = room;
      } else if (method === 'POST' || path[2] === 'condition') {
        const room = data.rooms.find(r => r.roomId === path[1])!;
        if (body.condition === 'OUT_OF_SERVICE' || (body.startDate < line.stayEndDate && body.endDate > line.stayStartDate)) return conflict('Maintenance conflicts with SKY-EXAMPLE.');
        if (path[2] === 'condition') { room.operationalStatus = body.condition; return new Response(JSON.stringify({ room_id: room.roomId, condition: body.condition, changed: true })); }
        const b = { ...body, blockId: uuid(), roomId: room.roomId }; blocks.push(b); value = b;
      } else if (method === 'PATCH') {
        const room = data.rooms.find(r => r.roomId === path[1])!;
        if (room.activeAssignmentCount && (body.active === false || (body.roomTypeId && body.roomTypeId !== room.roomType.roomTypeId))) return conflict('This room has an active reservation.');
        Object.assign(room, body); if (body.roomTypeId) room.roomType = data.types.find(t => t.roomTypeId === body.roomTypeId)!; value = room;
      }
    } else if (path[0] === 'room-blocks') {
      const index = blocks.findIndex(b => b.blockId === path[1]);
      if (method === 'DELETE') { blocks.splice(index, 1); return new Response(null, { status: 204 }); }
      if (body.startDate < line.stayEndDate && body.endDate > line.stayStartDate) return conflict('Maintenance conflicts with SKY-EXAMPLE.');
      Object.assign(blocks[index], body); value = blocks[index];
    }
    return new Response(JSON.stringify({ data: value }));
  };
}
function Preview() {
  const [role, setRole] = useState<StaffRole | null>('CHAIN_MANAGER');
  const mock = useMemo(transport, []);
  const session = useMemo(() => role ? { role, branchId } : null, [role]);
  const api = useMemo(() => new RoomAdminApi(session, mock), [session, mock]);
  return <main className="mx-auto max-w-7xl space-y-6 p-4 md:p-8"><p className="text-sm">Local fixture — sample records only. No database requests.</p><div className="flex flex-wrap gap-2">{(['CHAIN_MANAGER', 'BRANCH_MANAGER', 'FRONT_DESK', 'SERVICE_STAFF', 'AUDITOR', null] as const).map(value => <Button key={value ?? 'anonymous'} variant={role === value ? 'default' : 'outline'} onClick={() => setRole(value)}>{value ?? 'Anonymous'}</Button>)}</div><RoomAdministrationPanel key={role ?? 'anonymous'} session={session} api={api} /></main>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
