import { useEffect, useId, useMemo, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { FormField } from '@/components/ui/form-field';
import { StaffBookingDetailPanel } from './StaffBookingReadPanel';
import { AvailabilityApi, AvailabilityClient } from '@/lib/availability';
import { StaffBookingSession } from '@/lib/staffBooking';
import { StaffBookingReadApi, StaffBookingReadClient } from '@/lib/staffBookingRead';
import { formatLkr } from '@/lib/money';
import { BookingModificationApi, BookingModificationClient, BookingModificationModel, ModificationDraft, ModificationState, canModifyStaffBooking } from '@/lib/staffBookingModification';

const GRID = 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3';
type Actions = Pick<BookingModificationModel, 'load' | 'start' | 'close' | 'setDraft' | 'search' | 'select' | 'prepare' | 'acknowledge' | 'confirm' | 'reconciled'>;
const operation = { add: 'Add room line', change: 'Change BOOKED line', move: 'Move assigned room' };
function DraftField({ label, field, draft, type = 'text', disabled, set }: { label: string; field: keyof ModificationDraft; draft: ModificationDraft;
  type?: string; disabled: boolean; set: Actions['setDraft'] }) {
  const id = useId();
  return <div className="min-w-0 space-y-2"><Label htmlFor={id}>{label}</Label>
    <Input id={id} type={type} value={draft[field]} disabled={disabled} maxLength={field === 'reason' ? 200 : undefined}
      min={type === 'number' ? 1 : undefined} max={type === 'number' ? 32767 : undefined} step={type === 'number' ? 1 : undefined}
      onInput={type === 'date' ? event => set({ [field]: event.currentTarget.value }) : undefined}
      onChange={event => set({ [field]: event.target.value })} />
  </div>;
}
export function StaffBookingModificationPanel({ state, actions, bookingId, onBack, onCancellation }: {
  state: ModificationState; actions: Actions; bookingId: string; onBack?(): void; onCancellation?(): void;
}) {
  const locked = state.saving || state.loading || state.uncertain || state.needsRefresh;
  const editor = state.editor, line = state.booking?.lines.find(l => l.lineId === editor?.lineId), review = state.review;
  return <section className="min-w-0 space-y-6 @container" aria-label="Staff room-line changes">
    <header className="space-y-2"><h1 className="text-2xl font-bold tracking-tight">Manage booking room lines</h1>
      <p className="text-sm text-muted-foreground">Add a room, revise a pending line or move its assigned room in your branch. Each confirmed change preserves history and refreshes the existing DRAFT invoice under its saved billing policy.</p></header>
    <div className="flex flex-wrap gap-2">
      {onBack && <Button variant="outline" disabled={state.saving} onClick={onBack}>Back to booking records</Button>}
      <Button variant="outline" disabled={state.saving || state.loading} onClick={() => void actions.load(bookingId)}>Reload booking records</Button>
      {onCancellation && <Button variant="outline" disabled={state.saving} onClick={onCancellation}>Open billing cancellation workflow</Button>}
    </div>
    <p className="text-sm text-muted-foreground">Cancelling or removing a line uses Member 4’s controlled cancellation workflow. Lines and histories are never deleted here.</p>
    {state.loading && <p role="status">Loading all room lines and histories…</p>}
    {state.failure && <Card className="border-destructive"><CardContent className="p-4"><p role="alert" className="text-sm text-destructive">{state.failure.message}</p></CardContent></Card>}
    {state.notice && <p role="status" className="text-sm">{state.notice}</p>}
    {state.uncertain && <Card className="border-destructive"><CardContent className="space-y-3 p-4">
      <p role="alert" className="text-sm">Another submission is blocked because the previous outcome is unknown. Reload and check every line, assignment history and the invoice in billing before continuing.</p>
      <Button className="h-auto min-h-11 whitespace-normal" variant="outline" disabled={!state.booking || state.loading || state.needsRefresh}
        onClick={() => actions.reconciled()}>I checked the booking and invoice outcome</Button>
    </CardContent></Card>}
    {state.result && <Card><CardHeader><CardTitle>Change committed · Room {state.result.line.currentAssignment.roomNumber}</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm"><p>DRAFT invoice total: {formatLkr(state.result.invoice.total)}</p>
        {state.result.invoice.isCredit ? <p role="status">Credit: {formatLkr(state.result.invoice.creditAmount)}. Use Member 4’s manual refund workflow before finalization.</p>
          : <p>Outstanding balance: {formatLkr(state.result.invoice.balance)}</p>}
        <p className="break-all text-xs text-muted-foreground">Invoice ID: {state.result.invoice.invoiceId}</p>
        {state.needsRefresh && <p role="alert">The change succeeded, but booking history has not refreshed. Reload records before another change.</p>}
      </CardContent></Card>}
    {state.booking && <>
      <Card><CardHeader><CardTitle>Select one operation</CardTitle></CardHeader><CardContent className="space-y-4">
        <Button disabled={locked} onClick={() => actions.start('add')}>Add another room line</Button>
        <div className={GRID}>{state.booking.lines.map(item => <Card key={item.lineId} className="min-w-0 shadow-none">
          <CardHeader><CardTitle className="text-lg">Room {item.assignments.find(a => a.current)?.roomNumber ?? 'line history'}</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm"><Badge variant="secondary">{item.status}</Badge><p>{item.checkIn} to {item.checkOut} · {item.guestCount} guests</p>
            <div className="flex flex-wrap gap-2">
              {item.status === 'BOOKED' && <Button size="sm" variant="outline" disabled={locked} aria-label={`Change room line ${item.assignments.find(a => a.current)?.roomNumber}`} onClick={() => actions.start('change', item.lineId)}>Change dates, guests or rate</Button>}
              {['BOOKED', 'CHECKED_IN'].includes(item.status) && <Button size="sm" variant="outline" disabled={locked} aria-label={`Move room line ${item.assignments.find(a => a.current)?.roomNumber}`} onClick={() => actions.start('move', item.lineId)}>Move assigned room</Button>}
            </div>
            {!['BOOKED', 'CHECKED_IN'].includes(item.status) && <p className="text-muted-foreground">Terminal line: preserved for history.</p>}
          </CardContent></Card>)}</div>
      </CardContent></Card>
    </>}
    {editor && <Card><CardHeader><CardTitle>{operation[editor.kind]}</CardTitle></CardHeader><CardContent className="space-y-4">
      {line && <p className="text-sm">Current room {line.assignments.find(a => a.current)?.roomNumber} · agreed {formatLkr(line.rateSnapshot)} / night · {line.status}</p>}
      {editor.kind === 'move' && <p className="text-sm text-muted-foreground">A move keeps this line’s dates and guest count. A BOOKED move uses the current target type rate; a CHECKED_IN move keeps the agreed rate and occupancy history. This Front Desk operation adds no price adjustment; an approved non-zero difference requires a Branch Manager.</p>}
      <FormField noValidate className="space-y-4" onSubmit={event => { event.preventDefault(); void actions.prepare(); }}>
        <div className={GRID}>
          <DraftField label="Arrival date" field="checkIn" type="date" draft={state.draft} disabled={locked || editor.kind === 'move'} set={actions.setDraft.bind(actions)} />
          <DraftField label="Departure date" field="checkOut" type="date" draft={state.draft} disabled={locked || editor.kind === 'move'} set={actions.setDraft.bind(actions)} />
          <DraftField label="Guests for this room" field="guestCount" type="number" draft={state.draft} disabled={locked || editor.kind === 'move'} set={actions.setDraft.bind(actions)} />
        </div>
        <DraftField label="Reason for this change" field="reason" draft={state.draft} disabled={locked} set={actions.setDraft.bind(actions)} />
        {editor.kind !== 'change' && <>
          <Button type="button" variant="outline" disabled={locked || state.searching || state.reviewing} onClick={() => void actions.search()}>{state.searching ? 'Searching…' : 'Search target rooms'}</Button>
          {state.rooms && !state.rooms.length && <p role="status" className="text-sm">No target rooms match this line. Try different dates or guests for an added line.</p>}
          <div className={GRID}>{state.rooms?.map(room => <Card key={room.roomId} className="min-w-0 shadow-none"><CardContent className="space-y-3 p-4 text-sm">
            <p className="font-medium">Room {room.roomNumber} · {room.roomType.name}</p><p>{formatLkr(room.roomType.baseDailyRate)} / night · capacity {room.roomType.capacity}</p>
            <Badge variant="secondary">Physical condition {room.operationalStatus}</Badge>
            <Button type="button" size="sm" variant={state.selected?.roomId === room.roomId ? 'default' : 'outline'} aria-pressed={state.selected?.roomId === room.roomId}
              disabled={locked || state.reviewing} aria-label={`Choose target room ${room.roomNumber}`} onClick={() => actions.select(room.roomId)}>Choose this room</Button>
          </CardContent></Card>)}</div>
        </>}
        <div className="flex flex-wrap gap-2"><Button type="submit" disabled={locked || state.reviewing || state.searching}>{state.reviewing ? 'Checking current rate…' : 'Review change'}</Button>
          <Button type="button" variant="ghost" disabled={locked} onClick={() => actions.close()}>Discard draft</Button></div>
      </FormField>
      {review && <Card className="shadow-none"><CardHeader><CardTitle>Review before confirming</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
        {line && <p>Before: {line.checkIn} to {line.checkOut} · {line.guestCount} guests · {formatLkr(line.rateSnapshot)} / night · Room {line.assignments.find(a => a.current)?.roomNumber}</p>}
        <p>After: {review.checkIn} to {review.checkOut} · {review.guestCount} guests · Room {review.roomNumber}</p>
        <p>Current target catalogue rate: {formatLkr(review.catalogueRate)} / night</p>
        <p>Agreed line rate after change: {formatLkr(review.agreedRate)} / night</p><p className="break-words">Reason: {review.input.reason}</p>
        <p className="text-muted-foreground">The server rechecks inventory, line state and catalogue rate at confirmation. The consolidated total, payments and any credit are recalculated by the saved invoice policy; the final result is shown after success.</p>
        <Button className="h-auto min-h-11 whitespace-normal" variant={state.acknowledged ? 'default' : 'outline'} disabled={locked} aria-pressed={state.acknowledged} onClick={() => actions.acknowledge()}>I reviewed this line and its billing effect</Button>
        <Button className="h-auto min-h-11 whitespace-normal" disabled={locked || !state.acknowledged} onClick={() => void actions.confirm()}>{state.saving ? 'Saving change…' : 'Confirm room-line change'}</Button>
      </CardContent></Card>}
    </CardContent></Card>}
    {state.booking && <StaffBookingDetailPanel booking={state.booking} />}
  </section>;
}
export function StaffBookingModificationScreen({ session, bookingId, readClient, availabilityClient, modificationClient, onBack, onCancellation }: {
  session: StaffBookingSession | null; bookingId: string; readClient?: StaffBookingReadClient; availabilityClient?: AvailabilityClient;
  modificationClient?: BookingModificationClient; onBack?(): void; onCancellation?(): void;
}) {
  const read = useMemo(() => readClient ?? new StaffBookingReadApi(session), [session, readClient]);
  const availability = useMemo(() => availabilityClient ?? new AvailabilityApi(), [availabilityClient]);
  const api = useMemo(() => modificationClient ?? new BookingModificationApi(session), [session, modificationClient]);
  const model = useMemo(() => new BookingModificationModel(session, read, availability, api), [session, read, availability, api, bookingId]);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const allowed = canModifyStaffBooking(session);
  useEffect(() => { if (allowed) void model.load(bookingId); return model.cancelPending; }, [allowed, model, bookingId]);
  if (!allowed) return <Card><CardHeader><CardTitle>Manage booking room lines</CardTitle></CardHeader><CardContent>
    <p role="status" className="text-sm">Sign in as Front Desk staff to change booking lines in your assigned branch.</p>
  </CardContent></Card>;
  // Hide old records during the render before the effect loads another route ID.
  const view = state.booking && state.booking.bookingId !== bookingId ? initialView() : state;
  return <StaffBookingModificationPanel state={view} actions={model} bookingId={bookingId} onBack={onBack} onCancellation={onCancellation} />;
}
function initialView(): ModificationState {
  return { booking: null, loading: true, editor: null, draft: { checkIn: '', checkOut: '', guestCount: '1', reason: '' }, searching: false,
    rooms: null, selected: null, reviewing: false, review: null, acknowledged: false, saving: false, failure: null, notice: '', result: null, uncertain: false, needsRefresh: false };
}
