import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatLkr } from '@/lib/money';
import { nights } from '@/lib/availability';
import { hotelTime, LineSummary, RoomLineStatus } from '@/lib/staffBookingRead';
import { GuestBookingDetail, GuestBookingReadApi, GuestBookingReadClient, GuestBookingReadModel,
  GuestBookingReadSession, GuestBookingReadState, GuestRoomLine, canReadGuestBookings } from '@/lib/guestBookingRead';

const GRID = 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3';
export const GUEST_LINE_LABEL: Record<RoomLineStatus, string> = { BOOKED: 'Reserved', CHECKED_IN: 'Checked in', CHECKED_OUT: 'Checked out', CANCELLED: 'Cancelled', NO_SHOW: 'No-show' };
function GuestBookingReadGate({ message = 'Sign in to your SkyNest guest account to view your bookings.' }: { message?: string }) {
  return <Card><CardHeader><CardTitle>My Bookings</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
    <p role="status">{message}</p><p>Your booking history belongs to your signed-in guest account.</p>
    <Button variant="outline" asChild><a href="/rooms">Browse room availability</a></Button>
  </CardContent></Card>;
}
export function GuestLineSummary({ summary }: { summary: LineSummary }) {
  const groups = [summary.booked, summary.checkedIn, summary.checkedOut, summary.cancelled, summary.noShow].filter(c => c > 0).length;
  return <div className="space-y-2 text-sm"><Badge variant="secondary">{groups > 1 ? 'Mixed room states' : 'One room state across this booking'}</Badge>
    <p>{summary.total} room lines · {summary.booked} reserved · {summary.checkedIn} checked in · {summary.checkedOut} checked out · {summary.cancelled} cancelled · {summary.noShow} no-show</p>
  </div>;
}
function GuestRoomLinePanel({ line, index }: { line: GuestRoomLine; index: number }) {
  const current = line.assignments.find(a => a.current);
  const occupied = line.status === 'CHECKED_IN' && !!current?.occupiedFrom && !current.occupiedTo;
  return <Card className="min-w-0"><CardHeader><CardTitle className="break-words text-xl">Room line {index + 1}{current ? ` · Room ${current.roomNumber} · ${current.roomType.name}` : ''}</CardTitle>
    <Badge className="w-fit" variant="secondary">{GUEST_LINE_LABEL[line.status]}</Badge></CardHeader>
    <CardContent className="space-y-4 text-sm">
      <p>{line.checkIn} to {line.checkOut} · {nights(line)} reserved nights</p>
      <p>{line.guestCount} guests · agreed base rate {formatLkr(line.rateSnapshot)} / night</p>
      <p>{occupied ? 'Currently checked in to this room' : current ? 'Reserved room assignment; not checked in' : 'This room line has ended; no current room assignment'}</p>
      <section className="space-y-3" aria-label={`Room assignments for room line ${index + 1}`}>
        <h3 className="font-semibold">Room assignment history</h3>
        {line.assignments.map(a => <Card key={a.assignmentId} className="min-w-0 shadow-none"><CardContent className="space-y-2 p-4">
          <p className="break-words font-medium">Room {a.roomNumber} · {a.roomType.name}</p>
          <Badge variant={a.current ? 'default' : 'secondary'}>{a.current ? 'Current room' : 'Previous room'}</Badge>
          <p>Assigned {hotelTime(a.assignedAt)}</p><p>{a.unassignedAt ? `Released ${hotelTime(a.unassignedAt)}` : 'Still assigned'}</p>
          {a.occupiedFrom && <p>Checked in {hotelTime(a.occupiedFrom)}</p>}{a.occupiedTo && <p>Occupancy ended {hotelTime(a.occupiedTo)}</p>}
        </CardContent></Card>)}
      </section>
      <section className="space-y-2" aria-label={`State history for room line ${index + 1}`}><h3 className="font-semibold">Room state history</h3>
        {!line.statusHistory.length && <p>No state history returned.</p>}
        {line.statusHistory.map(s => <p key={s.historyId}>{s.oldStatus === null ? 'Created' : GUEST_LINE_LABEL[s.oldStatus]} → {GUEST_LINE_LABEL[s.newStatus]} · {hotelTime(s.changedAt)}</p>)}
      </section>
      <section className="space-y-3" aria-label={`Changes for room line ${index + 1}`}><h3 className="font-semibold">Date, guest and rate changes</h3>
        {!line.revisions.length && <p>No date, guest or rate changes.</p>}
        {line.revisions.map(r => <Card key={r.revisionId} className="min-w-0 shadow-none"><CardContent className="space-y-2 p-4">
          <p>Before: {r.oldValues.checkIn} to {r.oldValues.checkOut} · {r.oldValues.guestCount} guests · {formatLkr(r.oldValues.rateSnapshot)} / night</p>
          <p>After: {r.newValues.checkIn} to {r.newValues.checkOut} · {r.newValues.guestCount} guests · {formatLkr(r.newValues.rateSnapshot)} / night</p>
          <p>{hotelTime(r.changedAt)}</p>
        </CardContent></Card>)}
      </section>
    </CardContent></Card>;
}
export function GuestBookingDetailPanel({ booking }: { booking: GuestBookingDetail }) {
  const tally = (status: RoomLineStatus) => booking.lines.filter(l => l.status === status).length;
  const summary: LineSummary = { total: booking.lines.length, booked: tally('BOOKED'), checkedIn: tally('CHECKED_IN'), checkedOut: tally('CHECKED_OUT'), cancelled: tally('CANCELLED'), noShow: tally('NO_SHOW'),
    firstStayDate: booking.lines.map(l => l.checkIn).sort()[0], lastStayDate: booking.lines.map(l => l.checkOut).sort().at(-1)! };
  return <section className="min-w-0 space-y-4" aria-label={`Your booking ${booking.bookingRef}`}>
    <Card><CardHeader><CardTitle className="break-words">{booking.bookingRef}</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
      <GuestLineSummary summary={summary} /><p>Created {hotelTime(booking.createdAt)} · updated {hotelTime(booking.updatedAt)} (Asia/Colombo)</p>
      <p>All rooms are shown, including cancelled and completed stays. Dates and agreed rates belong to each room line.</p>
      <p className="text-muted-foreground">Assignment times preserve previous room moves. Room type names describe the current catalogue, not a historical type snapshot.</p>
      <p>For room changes or cancellation, contact SkyNest with this booking reference. Eligibility and fees depend on your booking terms; refunds are arranged manually with the hotel.</p>
      <p className="text-muted-foreground">These room rates are not a final bill or proof of payment. No online payment is collected on this screen.</p>
    </CardContent></Card>
    <h2 className="text-xl font-semibold">All your room lines</h2>
    <div className={GRID}>{booking.lines.map((line, index) => <GuestRoomLinePanel key={line.lineId} line={line} index={index} />)}</div>
  </section>;
}
type Actions = Pick<GuestBookingReadModel, 'loadList' | 'open' | 'back' | 'next' | 'previous'>;
export function GuestBookingReadPanel({ state, actions }: { state: GuestBookingReadState; actions: Actions }) {
  if (state.denied) return <GuestBookingReadGate message={state.listFailure?.message ?? state.detailFailure?.message} />;
  return <div className="min-w-0 space-y-6 @container"><header className="space-y-2"><h1 className="text-2xl font-bold tracking-tight">My Bookings</h1>
    <p className="text-sm text-muted-foreground">Your SkyNest reservations, including bookings arranged with hotel staff. View every room under one booking reference.</p></header>
    {state.selectedId ? <>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => actions.back()}>Back to my bookings</Button>
        <Button variant="outline" disabled={state.loadingDetail} onClick={() => void actions.open(state.selectedId!)}>Reload booking</Button></div>
      {state.loadingDetail && <p role="status">Loading your room lines…</p>}
      {state.detailFailure && <Card className="border-destructive"><CardContent className="p-4"><p role="alert" className="text-sm text-destructive">{state.detailFailure.message}</p></CardContent></Card>}
      {state.detail && <GuestBookingDetailPanel booking={state.detail} />}
    </> : <>
      <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={state.loadingList} onClick={() => void actions.loadList()}>Reload my bookings</Button>
        <Button variant="outline" asChild><a href="/guest/bookings/new">Book another stay</a></Button>
        {state.page && <p className="text-sm">{state.page.items.length ? `Bookings ${state.offset + 1}–${state.offset + state.page.items.length}` : 'No bookings on this page'}</p>}</div>
      {state.loadingList && <p role="status">Loading your bookings…</p>}
      {state.listFailure && <Card className="border-destructive"><CardContent className="p-4"><p role="alert" className="text-sm text-destructive">{state.listFailure.message}</p></CardContent></Card>}
      {state.page && !state.page.items.length && <Card><CardContent className="space-y-2 p-4"><p role="status">{state.offset === 0 ? 'You have no bookings yet.' : 'No more bookings on this page. Return to the previous page.'}</p></CardContent></Card>}
      <div className={GRID}>{state.page?.items.map(b => <Card key={b.bookingId} className="min-w-0"><CardHeader><CardTitle className="break-words text-xl">{b.bookingRef}</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm"><GuestLineSummary summary={b.lineSummary} />
          <p>Earliest arrival {b.lineSummary.firstStayDate} · latest departure {b.lineSummary.lastStayDate}</p>
          <p className="text-muted-foreground">Each room may have different dates.</p><p>Created {hotelTime(b.createdAt)} (Asia/Colombo)</p>
          <Button className="h-auto min-h-11 whitespace-normal" aria-label={`View my booking ${b.bookingRef}`} onClick={() => void actions.open(b.bookingId)}>View all room lines</Button>
        </CardContent></Card>)}</div>
      <div className="flex flex-wrap gap-2" aria-label="My booking pages"><Button variant="outline" disabled={state.loadingList || state.offset === 0} onClick={() => void actions.previous()}>Previous page</Button>
        <Button variant="outline" disabled={state.loadingList || state.page?.pagination.returned !== state.limit} onClick={() => void actions.next()}>Next page</Button></div>
    </>}
  </div>;
}
export function GuestBookingReadScreen({ session, client, bookingId, onOpen, onBack }: {
  session: GuestBookingReadSession | null; client?: GuestBookingReadClient; bookingId?: string; onOpen?(id: string): void; onBack?(): void;
}) {
  const api = useMemo(() => client ?? new GuestBookingReadApi(session), [session, client]);
  const model = useMemo(() => new GuestBookingReadModel(session, api), [session, api]);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot), allowed = canReadGuestBookings(session);
  useEffect(() => {
    if (!allowed) return;
    if (bookingId) void model.open(bookingId); else { model.back(); void model.loadList(); }
    return model.cancelPending;
  }, [allowed, model, bookingId]);
  if (!allowed) return <GuestBookingReadGate />;
  const view = bookingId && bookingId !== state.selectedId && !state.denied
    ? { ...state, selectedId: bookingId, detail: null, detailFailure: null, loadingDetail: true } : state;
  return <GuestBookingReadPanel state={view} actions={{ loadList: model.loadList.bind(model), next: model.next.bind(model), previous: model.previous.bind(model),
    open: async id => { if (onOpen && id !== state.selectedId) onOpen(id); else await model.open(id); }, back: () => { if (onBack) onBack(); else model.back(); } }} />;
}
