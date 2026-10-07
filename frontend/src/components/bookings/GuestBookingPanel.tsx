import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FormField } from '@/components/ui/form-field';
import { AvailabilityPanel } from '@/components/rooms/AvailabilityPanel';
import { AvailabilityApi, AvailabilityClient, AvailabilityModel, nights } from '@/lib/availability';
import { formatLkr } from '@/lib/money';
import { provisionalBookingTotal } from '@/lib/staffBooking';
import { GuestBookingApi, GuestBookingClient, GuestBookingModel, GuestBookingSession, GuestBookingState, canCreateGuestBooking } from '@/lib/guestBooking';

const GRID = 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3';
export const PAYMENT_MESSAGE = 'Online payment is not available. Arrange cash or verified bank-transfer payment with the hotel. No payment is taken when you confirm here.';
type Actions = Pick<GuestBookingModel, 'requestQuote' | 'acknowledge' | 'confirm'>;
function GuestBookingGate({ message = 'Sign in to your SkyNest guest account to book rooms directly.' }: { message?: string }) {
  return <Card><CardHeader><CardTitle>Book directly with SkyNest</CardTitle></CardHeader><CardContent className="space-y-4">
    <p role="status" className="text-sm">{message}</p><p className="text-sm text-muted-foreground">Your reservation belongs to your signed-in guest account.</p>
    <Button variant="outline" asChild><a href="/rooms">Browse room availability</a></Button>
  </CardContent></Card>;
}
export function GuestBookingPanel({ state, actions, disabled = false, branchName }: {
  state: GuestBookingState; actions: Actions; disabled?: boolean; branchName?: string;
}) {
  if (state.denied) return <GuestBookingGate message={state.failure?.message} />;
  const locked = disabled || state.creating || state.uncertain || !!state.created;
  const quote = state.quote, totals = quote ? provisionalBookingTotal(quote) : null;
  if (state.created) return <Card><CardHeader><CardTitle className="break-words">Reservation confirmed · {state.created.bookingRef}</CardTitle></CardHeader>
    <CardContent className="space-y-4 text-sm">
      <Badge variant="secondary">{state.created.lines.length} rooms · one booking reference</Badge>
      <p>Your reservation was created for your signed-in guest account. Keep reference {state.created.bookingRef} when contacting SkyNest.</p>
      <p className="text-lg font-semibold">Provisional bill: {formatLkr(state.created.invoice.total)}</p>
      <p className="text-muted-foreground">This is a provisional bill. Services and eligible later fees may change the final amount.</p>
      <p>{PAYMENT_MESSAGE}</p>
      <div className={GRID}>{state.created.lines.map(line => <Card key={line.lineId} className="min-w-0 shadow-none">
        <CardHeader><CardTitle className="break-words text-lg">Room {line.roomNumber} · {line.roomTypeName}</CardTitle></CardHeader>
        <CardContent className="space-y-2"><Badge variant="secondary">Reserved</Badge><p>{line.checkIn} to {line.checkOut}</p>
          <p>{line.guestCount} guests · {nights(line)} reserved nights</p><p>Agreed base rate: {formatLkr(line.rateSnapshot)} / night</p>
        </CardContent></Card>)}</div>
    </CardContent></Card>;
  return <section className="min-w-0 space-y-4" aria-label="Direct guest booking quote and confirmation">
    {state.failure && <Card className="border-destructive"><CardContent className="p-4"><p role="alert" className="text-sm text-destructive">{state.failure.message}</p></CardContent></Card>}
    {state.notice && <p role="status" className="text-sm">{state.notice}</p>}
    {state.uncertain && <p role="alert" className="text-sm text-destructive">Another confirmation is blocked. Contact the hotel to check whether your reservation was created before starting another booking.</p>}
    <Card><CardHeader><CardTitle>Your direct reservation</CardTitle></CardHeader><CardContent className="space-y-4 text-sm">
      <p>The hotel links your reservation to your signed-in guest account. Choose all rooms from one SkyNest branch.</p>
      <p>{PAYMENT_MESSAGE}</p>
      <p className="text-muted-foreground">Removing a room from this selection edits only your unconfirmed draft. Selected rooms are reserved together when confirmation succeeds.</p>
      <Button className="h-auto min-h-11 whitespace-normal" disabled={locked || state.quoting || !state.lines.length} onClick={() => void actions.requestQuote()}>{state.quoting ? 'Getting your quote…' : 'Get fresh combined quote'}</Button>
    </CardContent></Card>
    {quote && totals && <Card><CardHeader><CardTitle>Review your rooms and booking terms</CardTitle></CardHeader><CardContent className="space-y-4 text-sm">
      <p>{branchName ?? 'Selected SkyNest branch'} · {quote.lines.length} rooms · {quote.lines.reduce((sum, l) => sum + l.guestCount, 0)} guests across rooms</p>
      <div className={GRID}>{quote.lines.map((line, index) => <Card key={`${line.roomId}-${line.checkIn}`} className="min-w-0 shadow-none">
        <CardHeader><CardTitle className="break-words text-lg">Room {line.roomNumber} · {line.roomTypeName}</CardTitle></CardHeader>
        <CardContent className="space-y-2"><p>{line.checkIn} to {line.checkOut}</p><p>{line.guestCount} guests · capacity {line.capacity} · {nights(line)} reserved nights</p>
          <p>Quoted base rate: {formatLkr(line.baseDailyRate)} / night</p><p>Room charge: {formatLkr(totals.roomAmounts[index])}</p>
        </CardContent></Card>)}</div>
      <div className="space-y-2">
        <p>Rooms: {formatLkr(totals.roomSubtotal)}</p><p>Discount: {formatLkr('0.00')} (none applied at confirmation)</p>
        <p>Service charge ({quote.billingPolicy.serviceChargePercent}%): {formatLkr(totals.serviceCharge)}</p>
        <p>Tax ({quote.billingPolicy.taxPercent}% on rooms plus service charge): {formatLkr(totals.tax)}</p>
        <p className="text-lg font-semibold">Provisional combined total: {formatLkr(totals.total)}</p>
        <p>Booking terms effective from {quote.billingPolicy.effectiveFrom}, published {new Date(quote.billingPolicy.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Colombo' })} (Asia/Colombo).</p>
        <p>Cancellation fee: {formatLkr(quote.billingPolicy.cancellationFee)} · no-show fee: {formatLkr(quote.billingPolicy.noShowFee)} · late checkout fee: {formatLkr(quote.billingPolicy.lateCheckoutFee)} · no-show grace: {quote.billingPolicy.noShowGraceDays} days.</p>
        <p className="text-muted-foreground">Service usage and later flat fees are excluded from this quote. The hotel rechecks each room, rate and current booking terms when you confirm; the saved provisional bill is authoritative.</p>
      </div>
      <FormField noValidate className="space-y-3" onSubmit={event => { event.preventDefault(); void actions.confirm(); }}>
        <Button type="button" className="h-auto min-h-11 whitespace-normal" variant={state.acknowledged ? 'default' : 'outline'} aria-pressed={state.acknowledged}
          disabled={locked || state.quoting} onClick={() => actions.acknowledge()}>{state.acknowledged ? 'Room rates and terms reviewed' : 'I reviewed these room rates and booking terms'}</Button>
        <p className="text-muted-foreground">If prices or terms change before confirmation, you must request a fresh quote, review it and explicitly confirm again.</p>
        <Button type="submit" className="h-auto min-h-11 whitespace-normal" disabled={locked || state.quoting || !state.acknowledged}>{state.creating ? 'Confirming your reservation…' : 'Confirm my reservation'}</Button>
      </FormField>
    </CardContent></Card>}
  </section>;
}
export function GuestBookingScreen({ session, client, availabilityClient }: {
  session: GuestBookingSession | null; client?: GuestBookingClient; availabilityClient?: AvailabilityClient;
}) {
  const allowed = canCreateGuestBooking(session);
  const api = useMemo(() => client ?? new GuestBookingApi(session), [session, client]);
  const availability = useMemo(() => new AvailabilityModel(availabilityClient ?? new AvailabilityApi()), [availabilityClient, session]);
  const model = useMemo(() => new GuestBookingModel(session, api), [session, api]);
  const searchState = useSyncExternalStore(availability.subscribe, availability.getSnapshot, availability.getSnapshot);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  useEffect(() => {
    if (!allowed) return;
    const sync = () => model.setLines(availability.getSnapshot().selected), unsubscribe = availability.subscribe(sync);
    sync(); void availability.loadOptions();
    return () => { unsubscribe(); availability.cancelPending(); model.cancelPending(); };
  }, [allowed, availability, model]);
  if (!allowed) return <GuestBookingGate />;
  return <div className="min-w-0 space-y-6 @container">
    {!state.created && !state.denied && <AvailabilityPanel state={searchState} actions={availability} locked={state.quoting || state.creating || state.uncertain}
      allowImmediateCheckIn={false} title="Book directly with SkyNest" description="Choose a SkyNest branch and add each room with its own dates and guest count. Review one combined quote and reserve all rooms under one reference." />}
    <GuestBookingPanel state={state} disabled={searchState.rechecking} branchName={searchState.options?.branches.find(b => b.branchId === state.quote?.branchId)?.name}
      actions={{ acknowledge: model.acknowledge.bind(model), requestQuote: async () => {
        if (availability.getSnapshot().rechecking) return; model.setLines(availability.getSnapshot().selected); await model.requestQuote();
      }, confirm: async () => {
        if (availability.getSnapshot().rechecking) return; model.setLines(availability.getSnapshot().selected); await model.confirm();
        if (['INVENTORY_CONFLICT', 'RETRY_TRANSACTION', 'BOOKING_CONFLICT', 'NOT_FOUND'].includes(model.getSnapshot().failure?.code ?? '')) {
          // Refresh every failed selection, never replay the booking write.
          await availability.recheck(); await availability.search();
        }
      } }} />
  </div>;
}
