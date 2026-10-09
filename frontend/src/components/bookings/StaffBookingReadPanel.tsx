import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatLkr } from '@/lib/money';
import {
  BookingRoomLine, LineSummary, StaffBookingDetail, StaffBookingReadApi, StaffBookingReadClient,
  StaffBookingReadModel, StaffBookingReadSession, StaffBookingReadState, canReadStaffBookings,
  hotelTime, progressLabel, summarizeLines,
} from '@/lib/staffBookingRead';
import { nights } from '@/lib/availability';

const GRID = 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3';
export function BookingLineSummary({ summary }: { summary: LineSummary }) {
  return <div className="space-y-2 text-sm">
    <Badge variant="secondary">{progressLabel(summary)}</Badge>
    <p>{summary.total} room lines · {summary.booked} BOOKED · {summary.checkedIn} CHECKED_IN · {summary.checkedOut} CHECKED_OUT · {summary.cancelled} CANCELLED · {summary.noShow} NO_SHOW</p>
  </div>;
}
function RoomLineHistory({ line }: { line: BookingRoomLine }) {
  const current = line.assignments.find(a => a.current);
  const occupied = line.status === 'CHECKED_IN' && !!current?.occupiedFrom && !current.occupiedTo;
  return <Card className="min-w-0">
    <CardHeader><CardTitle className="break-words text-xl">{current ? `Room ${current.roomNumber} · ${current.roomType.name}` : 'Room line with closed assignments'}</CardTitle>
      <Badge className="w-fit" variant="secondary">{line.status}</Badge></CardHeader>
    <CardContent className="space-y-4 text-sm">
      <p className="break-all text-xs text-muted-foreground">Line ID: {line.lineId}</p>
      <p>{line.checkIn} to {line.checkOut} · {nights(line)} reserved nights</p>
      <p>{line.guestCount} guests · agreed base rate {formatLkr(line.rateSnapshot)} / night</p>
      <p>{occupied ? 'Currently occupied through this checked-in line' : current ? 'Assigned; not currently checked in' : 'No open room assignment'}</p>
      <p>Line created {hotelTime(line.createdAt)} · updated {hotelTime(line.updatedAt)}</p>
      <section className="space-y-3" aria-label={`Assignments for line ${line.lineId}`}>
        <h4 className="font-semibold">Room assignment history ({line.assignments.length})</h4>
        {line.assignments.map(a => <Card key={a.assignmentId} className="min-w-0 shadow-none"><CardContent className="space-y-2 p-4">
          <p className="break-words font-medium">Room {a.roomNumber} · {a.roomType.name}</p>
          <Badge variant={a.current ? 'default' : 'secondary'}>{a.current ? 'Current assignment' : 'Closed assignment'}</Badge>
          <p>Assigned: {hotelTime(a.assignedAt)}</p><p>Released: {a.unassignedAt ? hotelTime(a.unassignedAt) : 'Still assigned'}</p>
          <p>Actual occupancy began: {hotelTime(a.occupiedFrom)}</p><p>Actual occupancy ended: {hotelTime(a.occupiedTo)}</p>
          <p className="text-muted-foreground">Current room catalogue: capacity {a.roomType.capacity} · {a.roomActive ? 'active' : 'inactive'} · physical condition {a.operationalStatus}</p>
        </CardContent></Card>)}
      </section>
      <section className="space-y-3" aria-label={`Status changes for line ${line.lineId}`}>
        <h4 className="font-semibold">Line status history ({line.statusHistory.length})</h4>
        {!line.statusHistory.length && <p>No status history returned.</p>}
        {line.statusHistory.map(s => <Card key={s.historyId} className="min-w-0 shadow-none"><CardContent className="space-y-2 p-4">
          <p>{s.oldStatus ?? 'Created'} → {s.newStatus}</p><p>{hotelTime(s.changedAt)}</p>
          <p className="break-all text-xs">Actor: {s.changedBy}</p><p className="break-words">Reason: {s.reason ?? 'Not recorded'}</p>
        </CardContent></Card>)}
      </section>
      <section className="space-y-3" aria-label={`Revisions for line ${line.lineId}`}>
        <h4 className="font-semibold">Date, guest and rate revisions ({line.revisions.length})</h4>
        {!line.revisions.length && <p>No value revisions.</p>}
        {line.revisions.map(r => <Card key={r.revisionId} className="min-w-0 shadow-none"><CardContent className="space-y-2 p-4">
          <p>Before: {r.oldValues.checkIn} to {r.oldValues.checkOut} · {r.oldValues.guestCount} guests · {formatLkr(r.oldValues.rateSnapshot)} / night</p>
          <p>After: {r.newValues.checkIn} to {r.newValues.checkOut} · {r.newValues.guestCount} guests · {formatLkr(r.newValues.rateSnapshot)} / night</p>
          <p>{hotelTime(r.changedAt)}</p><p className="break-all text-xs">Actor: {r.changedBy}</p><p className="break-words">Reason: {r.reason}</p>
        </CardContent></Card>)}
      </section>
    </CardContent>
  </Card>;
}
export function StaffBookingDetailPanel({ booking }: { booking: StaffBookingDetail }) {
  return <section className="min-w-0 space-y-4" aria-label={`Booking ${booking.bookingRef}`}>
    <Card><CardHeader><CardTitle className="break-words">{booking.bookingRef} · {booking.guest.fullName}</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <BookingLineSummary summary={summarizeLines(booking.lines)} />
        <p>{booking.lines.reduce((sum, line) => sum + line.guestCount, 0)} guests across all room lines, including terminal lines</p>
        <p>Channel: {booking.bookingChannel} · created {hotelTime(booking.createdAt)} · updated {hotelTime(booking.updatedAt)}</p>
        <p className="break-all text-xs text-muted-foreground">Booking ID: {booking.bookingId} · created by {booking.createdBy}</p>
        <p className="text-muted-foreground">All times use Asia/Colombo. Stay dates and agreed rates belong to each room line. Assignment timestamps preserve room moves and actual occupancy; room type, capacity and physical condition reflect current catalogue values.</p>
      </CardContent>
    </Card>
    <h2 className="text-xl font-semibold">All room lines and their histories</h2>
    <div className={GRID}>{booking.lines.map(line => <RoomLineHistory key={line.lineId} line={line} />)}</div>
  </section>;
}
type Actions = Pick<StaffBookingReadModel, 'loadList' | 'open' | 'back' | 'next' | 'previous'>;
export function StaffBookingReadPanel({ state, actions }: { state: StaffBookingReadState; actions: Actions }) {
  return <div className="min-w-0 space-y-6 @container">
    <header className="space-y-2"><h1 className="text-2xl font-bold tracking-tight">Staff booking records</h1>
      <p className="text-sm text-muted-foreground">View bookings in your assigned branch, with every room line and its preserved history.</p></header>
    {state.selectedId ? <>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => actions.back()}>Back to booking list</Button>
        <Button variant="outline" disabled={state.loadingDetail} onClick={() => void actions.open(state.selectedId!)}>Reload booking</Button></div>
      {state.loadingDetail && <p role="status">Loading booking and room-line histories…</p>}
      {state.detailFailure && <Card className="border-destructive"><CardContent className="p-4"><p role="alert" className="text-sm text-destructive">{state.detailFailure.message}</p></CardContent></Card>}
      {state.detail && <StaffBookingDetailPanel booking={state.detail} />}
    </> : <>
      <div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={state.loadingList} onClick={() => void actions.loadList()}>Reload bookings</Button>
        {state.page && <p className="text-sm">{state.page.items.length ? `Bookings ${state.offset + 1}–${state.offset + state.page.items.length}` : 'No bookings on this page'} · page size {state.limit}</p>}</div>
      {state.loadingList && <p role="status">Loading branch bookings…</p>}
      {state.listFailure && <Card className="border-destructive"><CardContent className="p-4"><p role="alert" className="text-sm text-destructive">{state.listFailure.message}</p></CardContent></Card>}
      {state.page && !state.page.items.length && <Card><CardContent className="space-y-2 p-4"><p role="status">{state.offset === 0 ? 'No bookings found in your assigned branch.' : 'No more bookings on this page. Return to the previous page.'}</p></CardContent></Card>}
      <div className={GRID}>{state.page?.items.map(booking => <Card key={booking.bookingId} className="min-w-0">
        <CardHeader><CardTitle className="break-words text-xl">{booking.bookingRef}</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm"><p className="break-words font-medium">{booking.guest.fullName}</p><BookingLineSummary summary={booking.lineSummary} />
          <p>Stay bounds: {booking.lineSummary.firstStayDate} to {booking.lineSummary.lastStayDate}</p>
          <p>Channel: {booking.bookingChannel}</p><p>Created: {hotelTime(booking.createdAt)} (Asia/Colombo)</p>
          <Button className="h-auto min-h-11 whitespace-normal" aria-label={`View booking ${booking.bookingRef}`} onClick={() => void actions.open(booking.bookingId)}>View all room lines</Button>
        </CardContent>
      </Card>)}</div>
      <div className="flex flex-wrap gap-2" aria-label="Booking pages">
        <Button variant="outline" disabled={state.loadingList || state.offset === 0} onClick={() => void actions.previous()}>Previous page</Button>
        <Button variant="outline" disabled={state.loadingList || state.page?.pagination.returned !== state.limit} onClick={() => void actions.next()}>Next page</Button>
      </div>
    </>}
  </div>;
}
export function StaffBookingReadScreen({ session, client, bookingId, onOpen, onBack, onModify }: {
  session: StaffBookingReadSession | null; client?: StaffBookingReadClient; bookingId?: string;
  onOpen?(id: string): void; onBack?(): void; onModify?(id: string): void;
}) {
  const api = useMemo(() => client ?? new StaffBookingReadApi(session), [client, session]);
  const model = useMemo(() => new StaffBookingReadModel(session, api), [session, api]);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const allowed = canReadStaffBookings(session);
  useEffect(() => {
    if (!allowed) return;
    if (bookingId) void model.open(bookingId); else { model.back(); void model.loadList(); }
    return model.cancelPending;
  }, [allowed, model, bookingId]);
  if (!allowed) return <Card><CardHeader><CardTitle>Staff booking records</CardTitle></CardHeader><CardContent>
    <p role="status" className="text-sm">Sign in as Front Desk staff to view bookings in your assigned branch.</p>
  </CardContent></Card>;
  const view = bookingId && bookingId !== state.selectedId
    ? { ...state, selectedId: bookingId, detail: null, detailFailure: null, loadingDetail: true } : state;
  return <div className="space-y-4">{view.detail && onModify && <Button variant="outline" onClick={() => onModify(view.detail!.bookingId)}>Manage room lines</Button>}
  <StaffBookingReadPanel state={view} actions={{ loadList: model.loadList.bind(model), next: model.next.bind(model), previous: model.previous.bind(model),
    open: async id => { if (onOpen && id !== state.selectedId) onOpen(id); else await model.open(id); },
    back: () => { if (onBack) onBack(); else model.back(); },
  }} /></div>;
}
