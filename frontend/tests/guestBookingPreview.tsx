import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '../src/components/ui/button';
import { GuestBookingScreen } from '../src/components/bookings/GuestBookingPanel';
import { createGuestBookingFixture, guestSession } from './guestBookingFixtures';
import '../src/index.css';

function Preview() {
  const [generation, setGeneration] = useState(0), [notice, setNotice] = useState('Sample data only. No database requests or payments.');
  const fixture = useMemo(() => createGuestBookingFixture(), [generation]);
  return <main className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
    <p className="text-sm">M2-S20 development sample. The guest identity, rates, terms and confirmations exist only in this fixture.</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => { fixture.flags.changed = true; setNotice('Sample rates and same-date policy correction changed. Confirmation must require renewed review.'); }}>Change sample rates and terms</Button>
      <Button variant="outline" onClick={() => { fixture.flags.conflict = true; setNotice('The sample Double room is unavailable. Confirmation must reject all rooms together.'); }}>Simulate one-room conflict</Button>
      <Button variant="outline" onClick={() => { fixture.flags.unknown = true; setNotice('The next confirmation has an unknown network outcome.'); }}>Simulate unknown confirmation</Button>
      <Button variant="outline" onClick={() => { fixture.flags.denied = true; setNotice('The next guest request is denied.'); }}>Simulate guest denial</Button>
      <Button variant="outline" onClick={() => { fixture.flags.noPolicy = true; setNotice('Approved booking terms are unavailable in this sample.'); }}>Simulate missing policy</Button>
      <Button variant="outline" onClick={() => { setGeneration(g => g + 1); setNotice('Sample reset. No database requests or payments.'); }}>Reset sample</Button>
    </div>
    <p role="status" className="text-sm">{notice}</p>
    <GuestBookingScreen key={generation} session={guestSession} client={fixture.bookings} availabilityClient={fixture.availability} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Preview /></React.StrictMode>);
