// Development-only read fixture. This transport never reaches a database.
import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StaffBookingReadScreen } from '../src/components/bookings/StaffBookingReadPanel';
import { Button } from '../src/components/ui/button';
import { StaffBookingReadApi } from '../src/lib/staffBookingRead';
import { bookingDetail, listItem, page, readSession, terminalDetail } from './staffBookingReadFixtures';
import { id } from './availabilityFixtures';
import '../src/index.css';

function Preview() {
  const flags = useRef({ denied: false, offline: false, many: false, empty: false, foreign: false });
  const [generation, setGeneration] = useState(0);
  const [bookingId, setBookingId] = useState<string | undefined>();
  const [notice, setNotice] = useState('Sample data only. No database requests.');
  const api = useMemo(() => new StaffBookingReadApi(readSession, async input => {
    const url = new URL(String(input), 'http://fixture.local');
    if (flags.current.denied) return new Response(JSON.stringify({ error: { code: 'FORBIDDEN' } }), { status: 403 });
    if (flags.current.offline) throw new TypeError('Sample offline');
    const extra = flags.current.many ? Array.from({ length: 19 }, (_, i) => ({ ...terminalDetail, bookingId: id(50 + i), bookingRef: `SN-SAMPLE-HISTORY-${i + 1}` })) : [];
    const details = [bookingDetail, terminalDetail, ...extra];
    if (url.searchParams.has('limit')) {
      const limit = Number(url.searchParams.get('limit')), offset = Number(url.searchParams.get('offset'));
      return new Response(JSON.stringify({ data: page(flags.current.empty ? [] : details.slice(offset, offset + limit).map(detail => listItem(detail)), limit, offset) }));
    }
    const detail = details.find(d => d.bookingId === url.pathname.split('/').at(-1));
    if (!detail) return new Response(JSON.stringify({ error: { code: 'BOOKING_NOT_FOUND' } }), { status: 404 });
    const data = structuredClone(detail);
    if (flags.current.foreign) data.lines[0].assignments[0].branchId = id(2);
    return new Response(JSON.stringify({ data: { ...data, guest: { ...data.guest, nic: 'DO-NOT-DISPLAY-SAMPLE-NIC' } } }));
  }), []);
  return <main className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
    <p className="text-sm">M2-S18 development sample. Front Desk identity and booking histories exist only in this fixture.</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => { flags.current.denied = true; setNotice('The next sample read is denied. Reload to verify records are cleared.'); }}>Simulate branch denial</Button>
      <Button variant="outline" onClick={() => { flags.current.offline = true; setNotice('The next sample read fails.'); }}>Simulate read failure</Button>
      <Button variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={() => { flags.current.foreign = true; setNotice('The next sample detail contains a foreign-branch assignment.'); }}>Simulate foreign assignment</Button>
      <Button variant="outline" onClick={() => { flags.current.many = true; setBookingId(undefined); setGeneration(g => g + 1); }}>Show 21 sample bookings</Button>
      <Button variant="outline" onClick={() => { flags.current.empty = true; setBookingId(undefined); setGeneration(g => g + 1); }}>Show empty list</Button>
      <Button variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={() => { setBookingId(id(99)); }}>Open missing sample booking</Button>
      <Button variant="outline" onClick={() => { flags.current = { denied: false, offline: false, many: false, empty: false, foreign: false }; setBookingId(undefined); setGeneration(g => g + 1); setNotice('Sample data only. No database requests.'); }}>Reset sample</Button>
    </div>
    <p role="status" className="text-sm">{notice}</p>
    <StaffBookingReadScreen key={generation} session={readSession} client={api} bookingId={bookingId}
      onOpen={setBookingId} onBack={() => setBookingId(undefined)} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Preview /></React.StrictMode>);
