import { useEffect, useId, useMemo, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { FormField } from '@/components/ui/form-field';
import { AvailabilityPanel } from '@/components/rooms/AvailabilityPanel';
import { AvailabilityApi, AvailabilityClient, AvailabilityModel, nights } from '@/lib/availability';
import { formatLkr } from '@/lib/money';
import {
  StaffBookingApi, StaffBookingClient, StaffBookingModel, StaffBookingSession, StaffBookingState,
  canCreateStaffBooking, provisionalBookingTotal,
} from '@/lib/staffBooking';

type Actions = Pick<StaffBookingModel, 'setGuest' | 'setChannel' | 'requestQuote' | 'acknowledge' | 'confirm'>;
const GRID = 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3';
export function StaffBookingPanel({ state, actions, disabled = false }: { state: StaffBookingState; actions: Actions; disabled?: boolean }) {
  const guestId = useId();
  const locked = disabled || state.creating || !!state.created || state.uncertain;
  const quote = state.quote, totals = quote ? provisionalBookingTotal(quote) : null;
  if (state.created) return <Card>
    <CardHeader><CardTitle>Booking confirmed · {state.created.bookingRef}</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <Badge variant="secondary">{state.created.lines.length} BOOKED room lines · one DRAFT invoice</Badge>
      <p className="text-sm">Invoice total: {formatLkr(state.created.invoice.total)}. This is a provisional DRAFT invoice; payment and check-in are separate operations.</p>
      <div className={GRID}>{state.created.lines.map(line => <Card key={line.lineId} className="min-w-0 shadow-none">
        <CardHeader><CardTitle className="break-words text-lg">Room {line.roomNumber} · {line.roomTypeName}</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm"><p>{line.checkIn} to {line.checkOut}</p><p>{line.guestCount} guests · {nights(line)} reserved nights</p><p>Agreed base rate: {formatLkr(line.rateSnapshot)} / night</p></CardContent>
      </Card>)}</div>
      <p className="text-sm">Keep booking reference {state.created.bookingRef} for subsequent staff operations.</p>
    </CardContent>
  </Card>;
  return <section className="min-w-0 space-y-4" aria-label="Staff booking quote and confirmation">
    {state.failure && <Card className="border-destructive"><CardContent className="p-4"><p role="alert" className="text-sm text-destructive">{state.failure.message}</p></CardContent></Card>}
    {state.notice && <p role="status" className="text-sm">{state.notice}</p>}
    <Card>
      <CardHeader><CardTitle className="text-xl">Primary guest and booking channel</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2"><Label htmlFor={guestId}>Primary guest record ID</Label>
          <Input id={guestId} value={state.guestId} disabled={locked} autoComplete="off" spellCheck={false}
            aria-describedby={`${guestId}-help`} onChange={event => actions.setGuest(event.target.value.trim())} />
          <p id={`${guestId}-help`} className="text-sm text-muted-foreground">Use the ID from the existing guest record. The server verifies the guest; this field does not create a guest or an account.</p>
        </div>
        <div role="group" aria-label="Staff booking channel" className="flex flex-wrap gap-2">
          {(['FRONT_DESK', 'PHONE', 'EMAIL'] as const).map(channel => <Button key={channel} type="button" size="sm" disabled={locked}
            aria-pressed={state.channel === channel} variant={state.channel === channel ? 'default' : 'outline'}
            onClick={() => actions.setChannel(channel)}>{channel === 'FRONT_DESK' ? 'Front desk' : channel === 'PHONE' ? 'Phone' : 'Email'}</Button>)}
        </div>
        <Button className="h-auto min-h-11 whitespace-normal" disabled={locked || state.quoting || !state.lines.length} onClick={() => void actions.requestQuote()}>{state.quoting ? 'Getting quote…' : 'Get fresh combined quote'}</Button>
        <p className="text-sm text-muted-foreground">Removing a room here only edits this unconfirmed draft. Booking cancellation and checkout use their separate staff workflows.</p>
      </CardContent>
    </Card>
    {quote && totals && <Card>
      <CardHeader><CardTitle className="text-xl">Review the provisional combined quote</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm">{quote.lines.length} room lines · {quote.lines.reduce((sum, line) => sum + line.guestCount, 0)} guests across lines</p>
        <div className={GRID}>{quote.lines.map((line, index) => <Card key={`${line.roomId}-${line.checkIn}`} className="min-w-0 shadow-none">
          <CardHeader><CardTitle className="break-words text-lg">Room {line.roomNumber} · {line.roomTypeName}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm"><p>{line.checkIn} to {line.checkOut}</p><p>{line.guestCount} guests · capacity {line.capacity} · {nights(line)} reserved nights</p>
            <p>Quoted base rate: {formatLkr(line.baseDailyRate)} / night</p><p>Provisional room charge: {formatLkr(totals.roomAmounts[index])}</p>
          </CardContent>
        </Card>)}</div>
        <div className="space-y-2 text-sm">
          <p className="break-all">Selected policy: {quote.billingPolicy.billingPolicyId}</p>
          <p>Effective from {quote.billingPolicy.effectiveFrom} · published {new Date(quote.billingPolicy.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Colombo' })} (Asia/Colombo)</p>
          <p>Rooms: {formatLkr(totals.roomSubtotal)}</p><p>Discount: {formatLkr('0.00')} (none applied at creation)</p>
          <p>Service charge ({quote.billingPolicy.serviceChargePercent}%): {formatLkr(totals.serviceCharge)}</p>
          <p>Tax ({quote.billingPolicy.taxPercent}% on rooms plus service charge): {formatLkr(totals.tax)}</p>
          <p className="text-lg font-semibold">Provisional combined total: {formatLkr(totals.total)}</p>
          <p className="text-muted-foreground">Service usage and later flat fees are excluded. Confirmation rechecks every rate, room and the effective policy; the saved invoice is authoritative.</p>
          <p>Policy terms: cancellation {formatLkr(quote.billingPolicy.cancellationFee)} · no-show {formatLkr(quote.billingPolicy.noShowFee)} · late checkout {formatLkr(quote.billingPolicy.lateCheckoutFee)} · no-show grace {quote.billingPolicy.noShowGraceDays} days.</p>
        </div>
        <FormField className="space-y-3" noValidate onSubmit={event => { event.preventDefault(); void actions.confirm(); }}>
          <Button type="button" variant={state.acknowledged ? 'default' : 'outline'} aria-pressed={state.acknowledged}
            className="h-auto min-h-11 whitespace-normal" disabled={locked || state.quoting} onClick={() => actions.acknowledge()}>
            {state.acknowledged ? 'Room rates and policy reviewed' : 'I have reviewed these room rates and policy'}
          </Button>
          <p className="text-sm text-muted-foreground">A changed catalogue or policy requires a fresh quote, review and another explicit confirmation.</p>
          <Button type="submit" className="h-auto min-h-11 whitespace-normal" disabled={locked || state.quoting || !state.acknowledged || !state.guestId}>
            {state.creating ? 'Confirming booking…' : 'Confirm staff booking'}
          </Button>
        </FormField>
      </CardContent>
    </Card>}
  </section>;
}

export function StaffBookingScreen({ session, client, availabilityClient }: {
  session: StaffBookingSession | null; client?: StaffBookingClient; availabilityClient?: AvailabilityClient;
}) {
  const allowed = canCreateStaffBooking(session);
  const api = useMemo(() => client ?? new StaffBookingApi(session), [client, session]);
  const availability = useMemo(() => {
    const source = availabilityClient ?? new AvailabilityApi();
    return new AvailabilityModel({
      options: async signal => {
        const options = await source.options(signal);
        return { ...options, branches: options.branches.filter(branch => branch.branchId === session?.branchId) };
      },
      search: (search, signal) => {
        if (!canCreateStaffBooking(session) || search.branchId !== session.branchId) return Promise.reject(new Error('Assigned branch required.'));
        return source.search(search, signal);
      },
    });
  }, [availabilityClient, session]);
  const model = useMemo(() => new StaffBookingModel(session, api), [session, api]);
  const searchState = useSyncExternalStore(availability.subscribe, availability.getSnapshot, availability.getSnapshot);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  useEffect(() => {
    if (!allowed) return;
    const sync = () => model.setLines(availability.getSnapshot().selected);
    const unsubscribe = availability.subscribe(sync); sync();
    availability.setDraft({ branchId: session!.branchId }); void availability.loadOptions();
    return () => { unsubscribe(); availability.cancelPending(); model.cancelPending(); };
  }, [allowed, availability, model, session]);
  if (!allowed) return <Card><CardHeader><CardTitle>Create a staff booking</CardTitle></CardHeader><CardContent>
    <p role="status" className="text-sm">Sign in as Front Desk staff to create bookings for your assigned branch.</p>
  </CardContent></Card>;
  return <div className="min-w-0 space-y-6 @container">
    {!state.created && <AvailabilityPanel state={searchState} actions={availability} locked={state.quoting || state.creating || state.uncertain}
      title="Create a staff booking" description="Search your assigned branch and add each room with its own dates and guests. Then review a combined quote and confirm one booking." />}
    <StaffBookingPanel state={state} disabled={searchState.rechecking} actions={{
      setGuest: model.setGuest.bind(model), setChannel: model.setChannel.bind(model), acknowledge: model.acknowledge.bind(model),
      requestQuote: async () => { if (searchState.rechecking) return; model.setLines(availability.getSnapshot().selected); await model.requestQuote(); },
      confirm: async () => {
        if (availability.getSnapshot().rechecking) return;
        model.setLines(availability.getSnapshot().selected); await model.confirm();
        if (['INVENTORY_CONFLICT', 'RETRY_TRANSACTION', 'BOOKING_CONFLICT'].includes(model.getSnapshot().failure?.code ?? '')) {
          // Refresh the failed draft against current inventory; never retry creation.
          await availability.recheck(); await availability.search();
        }
      },
    }} />
  </div>;
}
