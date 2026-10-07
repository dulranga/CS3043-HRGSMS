// Development sample only. Both clients use this in-memory transport, never a database.
import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StaffBookingScreen } from '../src/components/bookings/StaffBookingPanel';
import { Button } from '../src/components/ui/button';
import { AvailabilityApi, AvailabilitySearch } from '../src/lib/availability';
import { BookingSelection, StaffBookingApi, StaffBookingInput, provisionalBookingTotal } from '../src/lib/staffBooking';
import { double, envelope, id, options, single } from './availabilityFixtures';
import { createdFor, quoteFor, session } from './staffBookingFixtures';
import '../src/index.css';

function Preview() {
  const flags = useRef({ rates: false, policy: false, blocked: false, policyMissing: false, lost: false });
  const [notice, setNotice] = useState('Sample primary guest record ID: ' + id(25));
  const [generation, setGeneration] = useState(0);
  const clients = useMemo(() => {
    const transport: typeof fetch = async (input, init) => {
      const url = new URL(String(input), 'http://fixture.local');
      const response = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status });
      const conflict = (code: string) => new Response(JSON.stringify({ error: { code } }), { status: 409 });
      const inventory = [single, double].map(room => ({ ...room, roomType: { ...room.roomType,
        baseDailyRate: flags.current.rates ? (room.roomId === single.roomId ? '11000.00' : '19000.00') : room.roomType.baseDailyRate } }));
      if (url.pathname.endsWith('/availability/options')) return response(options);
      if (url.pathname.endsWith('/availability')) {
        const p = url.searchParams;
        const criteria: AvailabilitySearch = { branchId: p.get('branchId')!, checkIn: p.get('checkIn')!, checkOut: p.get('checkOut')!,
          guestCount: Number(p.get('guestCount')), roomTypeId: p.get('roomTypeId'), immediateCheckIn: p.get('immediateCheckIn') === 'true' };
        const rooms = inventory.filter(room => room.branchId === criteria.branchId && room.roomType.capacity >= criteria.guestCount
          && (!criteria.roomTypeId || room.roomType.roomTypeId === criteria.roomTypeId)
          && (!criteria.immediateCheckIn || room.operationalStatus === 'READY') && !(flags.current.blocked && room.roomId === single.roomId));
        return new Response(JSON.stringify(envelope(rooms, criteria)));
      }
      const body = JSON.parse(init!.body as string) as StaffBookingInput;
      if (flags.current.policyMissing) return conflict('POLICY_UNAVAILABLE');
      if (body.lines.some(line => flags.current.blocked && line.roomId === single.roomId)) return conflict('INVENTORY_CONFLICT');
      const makeQuote = (lines: BookingSelection[]) => {
        const quote = quoteFor(lines, flags.current.policy ? { billingPolicyId: id(21), taxPercent: '15.00', createdAt: '2026-10-06T00:00:00Z' } : {});
        quote.lines = quote.lines.map(line => ({ ...line, baseDailyRate: inventory.find(room => room.roomId === line.roomId)!.roomType.baseDailyRate }));
        return quote;
      };
      const quote = makeQuote(body.lines);
      if (url.pathname.endsWith('/quote')) return response(quote);
      if (body.quotedBillingPolicyId !== quote.billingPolicy.billingPolicyId || body.lines.some((line, index) => line.quotedRoomTypeId !== quote.lines[index].roomTypeId || line.quotedBaseDailyRate !== quote.lines[index].baseDailyRate)) return conflict('REQUOTE_REQUIRED');
      if (flags.current.lost) throw new TypeError('Simulated lost response');
      const created = createdFor(body); created.invoice.total = provisionalBookingTotal(quote).total;
      return response(created, 201);
    };
    return { booking: new StaffBookingApi(session, transport), availability: new AvailabilityApi(transport) };
  }, []);
  return <main className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
    <p className="text-sm">M2-S17 local sample: no database requests. This Front Desk identity exists only in this development fixture.</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={() => { flags.current.rates = true; setNotice('Sample catalogue rates changed. Confirm an old quote to test reconfirmation.'); }}>Change sample rates</Button>
      <Button variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={() => { flags.current.policy = true; setNotice('Sample policy changed. Confirm an old quote to test reconfirmation.'); }}>Change sample policy</Button>
      <Button variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={() => { flags.current.blocked = true; setNotice('Sample room 101 is unavailable.'); }}>Make room 101 unavailable</Button>
      <Button variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={() => { flags.current.policyMissing = true; setNotice('No approved sample policy.'); }}>Remove sample policy</Button>
      <Button variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={() => { flags.current.lost = true; setNotice('Next sample confirmation loses its response.'); }}>Lose confirmation response</Button>
      <Button variant="outline" onClick={() => { flags.current = { rates: false, policy: false, blocked: false, policyMissing: false, lost: false }; setGeneration(value => value + 1); setNotice('Sample primary guest record ID: ' + id(25)); }}>Reset sample</Button>
    </div>
    <p role="status" className="break-words text-sm">{notice}</p>
    <StaffBookingScreen key={generation} session={session} client={clients.booking} availabilityClient={clients.availability} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Preview /></React.StrictMode>);
