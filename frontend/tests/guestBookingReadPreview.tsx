// Development-only read transport. No database requests, identity overrides or writes.
import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '../src/components/ui/button';
import { GuestBookingReadScreen } from '../src/components/bookings/GuestBookingReadPanel';
import { GuestBookingReadApi } from '../src/lib/guestBookingRead';
import { createGuestReadFixture, guestReadSession, guestUnknownId, guestOtherOwnerId } from './guestBookingReadFixtures';
import '../src/index.css';

function Preview() {
  const fixture = useRef(createGuestReadFixture()), [generation, setGeneration] = useState(0), [bookingId, setBookingId] = useState<string | undefined>();
  const [notice, setNotice] = useState('Sample data only. No database requests or writes.');
  const api = useMemo(() => new GuestBookingReadApi(guestReadSession, fixture.current.transport), [generation]);
  const reset = () => { fixture.current = createGuestReadFixture(); setBookingId(undefined); setGeneration(g => g + 1); setNotice('Sample reset. No database requests or writes.'); };
  const show = (flag: 'empty' | 'many' | 'allStates') => { fixture.current.flags[flag] = true; setBookingId(undefined); setGeneration(g => g + 1); };
  return <main className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
    <p className="text-sm">M2-S21 development sample. Guest identity and owned histories exist only in this in-memory fixture.</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => { fixture.current.flags.denied = true; setNotice('The next read is denied. Reload to check that private records are cleared.'); }}>Simulate guest denial</Button>
      <Button variant="outline" onClick={() => { fixture.current.flags.offline = true; setNotice('The next read fails.'); }}>Simulate read failure</Button>
      <Button variant="outline" onClick={() => show('many')}>Show 21 sample bookings</Button>
      <Button variant="outline" onClick={() => show('empty')}>Show empty list</Button>
      <Button variant="outline" onClick={() => show('allStates')}>Show all five room states</Button>
      <Button variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={() => setBookingId(guestUnknownId)}>Open missing sample booking</Button>
      <Button variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={() => setBookingId(guestOtherOwnerId)}>Open another guest’s sample booking</Button>
      <Button variant="outline" onClick={reset}>Reset sample</Button>
    </div><p role="status" className="text-sm">{notice}</p>
    <GuestBookingReadScreen key={generation} session={guestReadSession} client={api} bookingId={bookingId} onOpen={setBookingId} onBack={() => setBookingId(undefined)} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Preview /></React.StrictMode>);
