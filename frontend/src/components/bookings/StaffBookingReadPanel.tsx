import { ReactNode, useEffect, useMemo, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, CalendarDays, Clock, Moon, Pencil, Radio, RefreshCw, Users, type LucideIcon } from 'lucide-react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { formatLkr } from '@/lib/money';
import {
  BookingChannel, BookingRoomLine, LineSummary, RoomLineStatus, RoomLineValues, StaffBookingDetail, StaffBookingListItem, StaffBookingReadApi, StaffBookingReadClient,
  StaffBookingReadModel, StaffBookingReadSession, StaffBookingReadState, canReadStaffBookings,
  summarizeLines,
} from '@/lib/staffBookingRead';
import { nights } from '@/lib/availability';
import { formatHotelDateTime, formatStayRange } from '@/lib/dateFormat';

const GRID = 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3';
const STATUS_LABEL: Record<RoomLineStatus, string> = { BOOKED: 'Booked', CHECKED_IN: 'Checked in', CHECKED_OUT: 'Checked out', CANCELLED: 'Cancelled', NO_SHOW: 'No-show' };
const STATUS_VARIANT: Record<RoomLineStatus, BadgeProps['variant']> = { BOOKED: 'secondary', CHECKED_IN: 'default', CHECKED_OUT: 'outline', CANCELLED: 'muted', NO_SHOW: 'muted' };
const CHANNEL_LABEL: Record<BookingChannel, string> = { DIRECT_ONLINE: 'Online', FRONT_DESK: 'Front desk', PHONE: 'Phone', EMAIL: 'Email' };
function statusCounts(summary: LineSummary): [RoomLineStatus, number][] {
  const counts: [RoomLineStatus, number][] = [['BOOKED', summary.booked], ['CHECKED_IN', summary.checkedIn], ['CHECKED_OUT', summary.checkedOut], ['CANCELLED', summary.cancelled], ['NO_SHOW', summary.noShow]];
  return counts.filter(([, n]) => n > 0);
}

export function BookingLineSummary({ summary }: { summary: LineSummary }) {
  const counts = statusCounts(summary);
  return <div className="flex flex-wrap items-center gap-2 text-sm">
    <span className="font-medium">{summary.total} {summary.total === 1 ? 'room' : 'rooms'}</span>
    {counts.map(([status, n]) => <Badge key={status} variant={STATUS_VARIANT[status]}>{n} {STATUS_LABEL[status]}</Badge>)}
  </div>;
}
function BookingStatusBadge({ summary }: { summary: LineSummary }) {
  const counts = statusCounts(summary);
  if (counts.length !== 1) return <Badge variant="outline">Mixed</Badge>;
  const [status] = counts[0];
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}
function BookingListCard({ booking, onOpen }: { booking: StaffBookingListItem; onOpen(): void }) {
  const { lineSummary: summary } = booking;
  return <Card className="flex min-w-0 flex-col">
    <CardHeader className="space-y-1 pb-4">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 break-words font-display text-lg font-semibold leading-tight tracking-tight">{booking.guest.fullName}</p>
        <BookingStatusBadge summary={summary} />
      </div>
      <CardTitle className="truncate font-mono text-xs font-normal tracking-normal text-muted-foreground" title={booking.bookingRef}>{booking.bookingRef}</CardTitle>
    </CardHeader>
    <CardContent className="flex-1 space-y-4 text-sm">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-background/60 p-3">
        <div className="col-span-2 space-y-0.5"><dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="size-3.5" aria-hidden="true" />Stay</dt>
          <dd className="font-medium">{formatStayRange(summary.firstStayDate, summary.lastStayDate)}</dd></div>
        <div className="space-y-0.5"><dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><Radio className="size-3.5" aria-hidden="true" />Channel</dt>
          <dd className="font-medium">{CHANNEL_LABEL[booking.bookingChannel]}</dd></div>
        <div className="space-y-0.5"><dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="size-3.5" aria-hidden="true" />Created</dt>
          <dd className="font-medium">{formatHotelDateTime(booking.createdAt)}</dd></div>
      </dl>
      <BookingLineSummary summary={summary} />
    </CardContent>
    <CardFooter>
      <Button variant="outline" className="w-full" aria-label={`View booking ${booking.bookingRef}`} onClick={onOpen}>
        View all room lines<ArrowRight aria-hidden="true" />
      </Button>
    </CardFooter>
  </Card>;
}
const when = (value: string | null) => value ? formatHotelDateTime(value) : '—';
const guests = (n: number) => `${n} ${n === 1 ? 'guest' : 'guests'}`;
const lineValues = (v: RoomLineValues) => `${formatStayRange(v.checkIn, v.checkOut)} · ${guests(v.guestCount)} · ${formatLkr(v.rateSnapshot)} / night`;

function Fact({ label, icon: Icon, children, className = '' }: { label: string; icon?: LucideIcon; children: ReactNode; className?: string }) {
  return <div className={`min-w-0 space-y-0.5 ${className}`}>
    <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">{Icon && <Icon className="size-3.5" aria-hidden="true" />}{label}</dt>
    <dd className="text-sm font-medium">{children}</dd>
  </div>;
}
function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-medium">{children}</dd></div>;
}
function HistorySection({ title, count, label, children }: { title: string; count: number; label: string; children: ReactNode }) {
  return <section className="min-w-0 space-y-3" aria-label={label}>
    <h4 className="flex items-center gap-2 text-sm font-semibold">{title}<Badge variant="muted">{count}</Badge></h4>
    <ol className="space-y-3 border-l-2 border-border pl-4">{children}</ol>
  </section>;
}
function HistoryItem({ children }: { children: ReactNode }) {
  return <li className="relative space-y-1.5 text-sm before:absolute before:-left-[1.3rem] before:top-1.5 before:size-2 before:rounded-full before:bg-accent">{children}</li>;
}

function RoomLineHistory({ line }: { line: BookingRoomLine }) {
  const current = line.assignments.find(a => a.current);
  const shown = current ?? line.assignments[line.assignments.length - 1];
  const occupied = line.status === 'CHECKED_IN' && !!current?.occupiedFrom && !current.occupiedTo;
  const count = nights(line);
  return <Card className="min-w-0">
    <CardHeader className="space-y-1 pb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="break-words text-xl">Room {shown.roomNumber}</CardTitle>
          <p className="text-sm text-muted-foreground">{shown.roomType.name}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant={STATUS_VARIANT[line.status]}>{STATUS_LABEL[line.status]}</Badge>
          <span className="text-xs text-muted-foreground">{occupied ? 'Currently occupied' : current ? 'Assigned; not currently checked in' : 'No open room assignment'}</span>
        </div>
      </div>
    </CardHeader>
    <CardContent className="space-y-6">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-background/60 p-3 md:grid-cols-4">
        <Fact label="Dates" icon={CalendarDays}>{formatStayRange(line.checkIn, line.checkOut)}</Fact>
        <Fact label="Reserved nights" icon={Moon}>{count}</Fact>
        <Fact label="Guests" icon={Users}>{line.guestCount}</Fact>
        <Fact label="Agreed base rate">{formatLkr(line.rateSnapshot)} / night</Fact>
      </dl>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <HistorySection title="Room assignments" count={line.assignments.length} label={`Assignments for line ${line.lineId}`}>
          {line.assignments.map(a => <HistoryItem key={a.assignmentId}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="break-words font-medium">Room {a.roomNumber} · {a.roomType.name}</p>
              <Badge variant={a.current ? 'default' : 'muted'}>{a.current ? 'Current assignment' : 'Closed assignment'}</Badge>
            </div>
            <dl className="space-y-1 text-xs">
              <Row label="Assigned">{when(a.assignedAt)}</Row>
              <Row label="Released">{a.unassignedAt ? when(a.unassignedAt) : 'Still assigned'}</Row>
              <Row label="Actual occupancy began">{when(a.occupiedFrom)}</Row>
              <Row label="Actual occupancy ended">{when(a.occupiedTo)}</Row>
            </dl>
            <p className="text-xs text-muted-foreground">Now: capacity {a.roomType.capacity} · {a.roomActive ? 'active' : 'inactive'} · physical condition {a.operationalStatus}</p>
          </HistoryItem>)}
        </HistorySection>

        <HistorySection title="Status changes" count={line.statusHistory.length} label={`Status changes for line ${line.lineId}`}>
          {!line.statusHistory.length && <li className="text-sm text-muted-foreground">No status history returned.</li>}
          {line.statusHistory.map(h => <HistoryItem key={h.historyId}>
            <p className="font-medium">{h.oldStatus ? STATUS_LABEL[h.oldStatus] : 'Created'} → {STATUS_LABEL[h.newStatus]}</p>
            <p className="text-xs text-muted-foreground">{when(h.changedAt)}</p>
            <p className="break-words text-xs">{h.reason ?? 'No reason recorded'}</p>
            <p className="break-all font-mono text-[0.65rem] text-muted-foreground">by {h.changedBy}</p>
          </HistoryItem>)}
        </HistorySection>

        <HistorySection title="Date, guest and rate revisions" count={line.revisions.length} label={`Revisions for line ${line.lineId}`}>
          {!line.revisions.length && <li className="text-sm text-muted-foreground">No value revisions.</li>}
          {line.revisions.map(r => <HistoryItem key={r.revisionId}>
            <p className="text-xs text-muted-foreground">{when(r.changedAt)}</p>
            <dl className="space-y-1 text-xs">
              <div><dt className="inline text-muted-foreground">Before: </dt><dd className="inline line-through decoration-muted-foreground/60">{lineValues(r.oldValues)}</dd></div>
              <div><dt className="inline text-muted-foreground">After: </dt><dd className="inline font-medium">{lineValues(r.newValues)}</dd></div>
            </dl>
            <p className="break-words text-xs">{r.reason}</p>
            <p className="break-all font-mono text-[0.65rem] text-muted-foreground">by {r.changedBy}</p>
          </HistoryItem>)}
        </HistorySection>
      </div>

      <p className="break-all border-t-2 border-border pt-3 font-mono text-[0.65rem] text-muted-foreground">
        Line {line.lineId} · created {when(line.createdAt)} · updated {when(line.updatedAt)}
      </p>
    </CardContent>
  </Card>;
}
export function StaffBookingDetailPanel({ booking }: { booking: StaffBookingDetail }) {
  const summary = summarizeLines(booking.lines);
  return <section className="min-w-0 space-y-6" aria-label={`Booking ${booking.bookingRef}`}>
    <Card>
      <CardHeader className="space-y-1 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="break-words font-display text-2xl font-semibold leading-tight tracking-tight">{booking.guest.fullName}</p>
            <CardTitle className="break-all font-mono text-sm font-normal tracking-normal text-muted-foreground">{booking.bookingRef}</CardTitle>
          </div>
          <BookingStatusBadge summary={summary} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-background/60 p-4 md:grid-cols-3 lg:grid-cols-6">
          <Fact label="Stay" icon={CalendarDays} className="col-span-2">{formatStayRange(summary.firstStayDate, summary.lastStayDate)}</Fact>
          <Fact label="Guests" icon={Users}>{booking.lines.reduce((sum, line) => sum + line.guestCount, 0)}</Fact>
          <Fact label="Channel" icon={Radio}>{CHANNEL_LABEL[booking.bookingChannel]}</Fact>
          <Fact label="Created" icon={Clock}>{when(booking.createdAt)}</Fact>
          <Fact label="Updated" icon={Clock}>{when(booking.updatedAt)}</Fact>
        </dl>
        <BookingLineSummary summary={summary} />
        <p className="text-xs text-muted-foreground">Times are in Asia/Colombo. Dates and agreed rates belong to each room line; room type, capacity and condition show current catalogue values.</p>
        <p className="break-all font-mono text-[0.65rem] text-muted-foreground">Booking {booking.bookingId} · created by {booking.createdBy}</p>
      </CardContent>
    </Card>
    <div className="space-y-4">
      <h2 className="flex items-center gap-2 font-display text-xl font-semibold tracking-tight">Room lines<Badge variant="muted">{booking.lines.length}</Badge></h2>
      <div className="space-y-4">{booking.lines.map(line => <RoomLineHistory key={line.lineId} line={line} />)}</div>
    </div>
  </section>;
}
type Actions = Pick<StaffBookingReadModel, 'loadList' | 'open' | 'back' | 'next' | 'previous'>;
export function StaffBookingReadPanel({ state, actions, onModify }: { state: StaffBookingReadState; actions: Actions; onModify?(id: string): void }) {
  return <div className="min-w-0 space-y-6 @container">
    <header className="space-y-2"><h1 className="text-2xl font-bold tracking-tight">Staff booking records</h1>
      <p className="text-sm text-muted-foreground">View bookings in your assigned branch, with every room line and its preserved history.</p></header>
    {state.selectedId ? <>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => actions.back()}><ArrowLeft aria-hidden="true" />Back to booking list</Button>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={state.loadingDetail} onClick={() => void actions.open(state.selectedId!)}><RefreshCw aria-hidden="true" />Reload booking</Button>
          {state.detail && onModify && <Button size="sm" onClick={() => onModify(state.detail!.bookingId)}><Pencil aria-hidden="true" />Manage room lines</Button>}
        </div>
      </div>
      {state.loadingDetail && <p role="status">Loading booking and room-line histories…</p>}
      {state.detailFailure && <Card className="border-destructive"><CardContent className="p-4"><p role="alert" className="text-sm text-destructive">{state.detailFailure.message}</p></CardContent></Card>}
      {state.detail && <StaffBookingDetailPanel booking={state.detail} />}
    </> : <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {state.page ? <p className="text-sm text-muted-foreground">{state.page.items.length ? `Bookings ${state.offset + 1}–${state.offset + state.page.items.length}` : 'No bookings on this page'} · page size {state.limit} · times in Asia/Colombo</p> : <span />}
        <Button variant="outline" size="sm" disabled={state.loadingList} onClick={() => void actions.loadList()}><RefreshCw aria-hidden="true" />Reload bookings</Button></div>
      {state.loadingList && <p role="status">Loading branch bookings…</p>}
      {state.listFailure && <Card className="border-destructive"><CardContent className="p-4"><p role="alert" className="text-sm text-destructive">{state.listFailure.message}</p></CardContent></Card>}
      {state.page && !state.page.items.length && <Card><CardContent className="space-y-2 p-4"><p role="status">{state.offset === 0 ? 'No bookings found in your assigned branch.' : 'No more bookings on this page. Return to the previous page.'}</p></CardContent></Card>}
      <div className={GRID}>{state.page?.items.map(booking => <BookingListCard key={booking.bookingId} booking={booking} onOpen={() => void actions.open(booking.bookingId)} />)}</div>
      <div className="flex flex-wrap justify-end gap-2" aria-label="Booking pages">
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
  return <StaffBookingReadPanel state={view} onModify={onModify} actions={{ loadList: model.loadList.bind(model), next: model.next.bind(model), previous: model.previous.bind(model),
    open: async id => { if (onOpen && id !== state.selectedId) onOpen(id); else await model.open(id); },
    back: () => { if (onBack) onBack(); else model.back(); },
  }} />;
}
