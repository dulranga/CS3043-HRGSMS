import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '../src/components/ui/button';
import { StaffBookingModificationScreen } from '../src/components/bookings/StaffBookingModificationPanel';
import { bookingDetail } from './staffBookingReadFixtures';
import { createModificationFixture, modificationSession } from './staffBookingModificationFixtures';
import '../src/index.css';

function Preview() {
  const [generation, setGeneration] = useState(0), [notice, setNotice] = useState('Sample data only. No database requests.');
  const fixture = useMemo(() => createModificationFixture(), [generation]);
  return <main className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
    <p className="text-sm">M2-S19 development sample. All changes affect memory in this tab only.</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => { fixture.flags.error = 'INVENTORY_CONFLICT'; setNotice('The next confirmation will return a rolled-back inventory conflict.'); }}>Simulate inventory conflict</Button>
      <Button variant="outline" onClick={() => { fixture.flags.error = 'REQUOTE_REQUIRED'; setNotice('The next confirmation requires a fresh rate review.'); }}>Simulate stale rate</Button>
      <Button variant="outline" onClick={() => { fixture.flags.unknown = true; setNotice('The next confirmation has an unknown network outcome.'); }}>Simulate unknown outcome</Button>
      <Button variant="outline" onClick={() => { fixture.flags.error = 'FORBIDDEN'; setNotice('The next request is denied.'); }}>Simulate branch denial</Button>
      <Button variant="outline" onClick={() => { fixture.flags.credit = true; setNotice('The next successful change returns a sample invoice credit.'); }}>Show credit on success</Button>
      <Button variant="outline" onClick={() => { fixture.flags.refreshFailure = true; setNotice('The next history reload fails; successful mutation proof remains visible.'); }}>Simulate reload failure</Button>
      <Button variant="outline" onClick={() => { fixture.flags.error = ''; fixture.flags.unknown = false; fixture.flags.refreshFailure = false; setNotice('Sample transport restored. Reload records before another review.'); }}>Restore sample requests</Button>
      <Button variant="outline" onClick={() => { setGeneration(g => g + 1); setNotice('Sample data reset. No database requests.'); }}>Reset sample</Button>
    </div>
    <p role="status" className="text-sm">{notice}</p>
    <StaffBookingModificationScreen key={generation} session={modificationSession} bookingId={bookingDetail.bookingId}
      readClient={fixture.read} availabilityClient={fixture.availability} modificationClient={fixture.modifications}
      onCancellation={() => setNotice('Cancellation belongs to Member 4’s billing workflow. This sample performs no cancellation.')} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Preview /></React.StrictMode>);
