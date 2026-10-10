// Development-only fixture. All requests use an in-memory transport.
import React, { useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { AvailabilitySearchScreen } from '../src/components/rooms/AvailabilityPanel';
import { Button } from '../src/components/ui/button';
import { AvailabilityApi, AvailabilitySearch } from '../src/lib/availability';
import { double, envelope, options, single } from './availabilityFixtures';
import '../src/index.css';

function Preview() {
  const inventory = useRef({ blocked: false, changedRate: false, offline: false });
  const api = useMemo(() => new AvailabilityApi(async (input, init) => {
    if (init?.signal?.aborted) throw new Error('aborted');
    if (inventory.current.offline) return new Response(JSON.stringify({ error: { code: 'UNAVAILABLE' } }), { status: 503 });
    const url = new URL(String(input), 'http://fixture.local');
    if (url.pathname.endsWith('/options')) return new Response(JSON.stringify({ data: options }));
    const query = url.searchParams;
    const criteria: AvailabilitySearch = {
      branchId: query.get('branchId')!, checkIn: query.get('checkIn')!, checkOut: query.get('checkOut')!,
      guestCount: Number(query.get('guestCount')), immediateCheckIn: query.get('immediateCheckIn') === 'true', roomTypeId: query.get('roomTypeId'),
    };
    const rooms = [single, double].filter(room => room.branchId === criteria.branchId
      && room.roomType.capacity >= criteria.guestCount
      && (!criteria.roomTypeId || room.roomType.roomTypeId === criteria.roomTypeId)
      && (!criteria.immediateCheckIn || room.operationalStatus === 'READY')
      && !(inventory.current.blocked && room.roomId === single.roomId))
      .map(room => ({ ...room, roomType: { ...room.roomType, baseDailyRate: inventory.current.changedRate ? (room.roomId === single.roomId ? '11000.00' : '19000.00') : room.roomType.baseDailyRate } }));
    return new Response(JSON.stringify(envelope(rooms, criteria)));
  }), []);
  return <main className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
    <p className="text-sm">Local fixture: sample rooms only. No database access.</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={() => { inventory.current.blocked = true; }}>Simulate room 101 unavailable</Button>
      <Button variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={() => { inventory.current.changedRate = true; }}>Simulate changed rates</Button>
      <Button variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={() => { inventory.current.offline = true; }}>Simulate search failure</Button>
      <Button variant="outline" onClick={() => { inventory.current = { blocked: false, changedRate: false, offline: false }; }}>Reset sample inventory</Button>
    </div>
    <AvailabilitySearchScreen client={api} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Preview /></React.StrictMode>);
