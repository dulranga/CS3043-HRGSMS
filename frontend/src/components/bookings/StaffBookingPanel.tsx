import { ReactNode, useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import { Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GuestPicker } from '@/components/bookings/GuestPicker';
import { AvailabilityPanel } from '@/components/rooms/AvailabilityPanel';
import { AvailabilityApi, AvailabilityClient, AvailabilityModel, AvailabilityState, nights } from '@/lib/availability';
import { formatLkr } from '@/lib/money';
import {
  CreatedStaffBooking, StaffBookingApi, StaffBookingClient, StaffBookingModel, StaffBookingSession, StaffBookingState,
  StaffChannel, canCreateStaffBooking, provisionalBookingTotal,
} from '@/lib/staffBooking';

type Actions = Pick<StaffBookingModel, 'setGuest' | 'setChannel' | 'requestQuote' | 'acknowledge' | 'confirm'>;
type AvailabilityActions = Pick<AvailabilityModel, 'setDraft' | 'search' | 'add' | 'remove' | 'clear' | 'recheck' | 'loadOptions'>;
type WizardStage = 'rooms' | 'guest' | 'review';

const GRID = 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3';
const STAGES: { id: WizardStage; label: string }[] = [
  { id: 'rooms', label: 'Select rooms' },
  { id: 'guest', label: 'Guest details' },
  { id: 'review', label: 'Review and confirm' },
];
const channelLabel = (channel: StaffChannel) => channel === 'FRONT_DESK' ? 'Front desk' : channel === 'PHONE' ? 'Phone' : 'Email';
const stepButton = 'h-auto min-h-11 whitespace-normal';

// Pinned to the bottom of the scroll pane so the stage's next/back actions stay
// reachable without scrolling through the whole stage. The primary action is
// pushed to the right with `ml-auto` so it never shifts when the left slot
// (a summary or the Back button) appears or disappears.
function StageFooter({ children }: { children: ReactNode }) {
  return <div className="sticky bottom-0 z-20 flex flex-wrap items-center gap-3 border-t-2 border-border bg-background/95 py-3 backdrop-blur-sm">{children}</div>;
}

export function StaffBookingAlerts({ state }: { state: StaffBookingState }) {
  return <>
    {state.failure && <Card className="border-destructive"><CardContent className="p-4"><p role="alert" className="text-sm text-destructive">{state.failure.message}</p></CardContent></Card>}
    {state.notice && <p role="status" className="text-sm">{state.notice}</p>}
  </>;
}

// Full-width terminal view — replaces the tabs once the booking exists so the
// reference and every agreed line are impossible to miss.
export function StaffBookingConfirmation({ created }: { created: CreatedStaffBooking }) {
  return <Card>
    <CardHeader><CardTitle>Booking confirmed · {created.bookingRef}</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <Badge variant="secondary">{created.lines.length} BOOKED room lines · one DRAFT invoice</Badge>
      <p className="text-sm">Invoice total: {formatLkr(created.invoice.total)}. This is a provisional DRAFT invoice; payment and check-in are separate operations.</p>
      <div className={GRID}>{created.lines.map(line => <Card key={line.lineId} className="min-w-0 shadow-none">
        <CardHeader><CardTitle className="break-words text-lg">Room {line.roomNumber} · {line.roomTypeName}</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm"><p>{line.checkIn} to {line.checkOut}</p><p>{line.guestCount} guests · {nights(line)} reserved nights</p><p>Agreed base rate: {formatLkr(line.rateSnapshot)} / night</p></CardContent>
      </Card>)}</div>
      <p className="text-sm">Keep booking reference {created.bookingRef} for subsequent staff operations.</p>
    </CardContent>
  </Card>;
}

// Stage 2 — the primary guest record and booking channel.
export function StaffBookingGuestStep({ state, actions, disabled = false }: { state: StaffBookingState; actions: Actions; disabled?: boolean }) {
  return <Card>
    <CardHeader><CardTitle className="text-xl">Primary guest and booking channel</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium">Primary guest</p>
        <GuestPicker value={state.guestId} selectedName={state.guestName} disabled={disabled}
          onSelect={(guestId, guestName) => actions.setGuest(guestId, guestName)} />
        <p className="text-sm text-muted-foreground">Search an existing guest profile or create one inline; the booking links to this guest record.</p>
      </div>
      <div role="group" aria-label="Staff booking channel" className="flex flex-wrap gap-2">
        {(['FRONT_DESK', 'PHONE', 'EMAIL'] as const).map(channel => <Button key={channel} type="button" size="sm" disabled={disabled}
          aria-pressed={state.channel === channel} variant={state.channel === channel ? 'default' : 'outline'}
          onClick={() => actions.setChannel(channel)}>{channelLabel(channel)}</Button>)}
      </div>
      <p className="text-sm text-muted-foreground">Continue to fetch a fresh combined quote for the selected rooms, then review every rate and the policy before confirming.</p>
    </CardContent>
  </Card>;
}

// Stage 3 — guest/channel recap, the provisional combined quote and acknowledgement.
// The terminal confirm action lives in the wizard's sticky footer.
export function StaffBookingReviewStep({ state, actions, disabled = false }: { state: StaffBookingState; actions: Actions; disabled?: boolean }) {
  const ackId = useId();
  const quote = state.quote, totals = quote ? provisionalBookingTotal(quote) : null;
  return <section className="min-w-0 space-y-4" aria-label="Staff booking quote and review">
    <Card><CardContent className="space-y-1 p-4 text-sm">
      <p className="break-all">Primary guest: {state.guestName || state.guestId || 'Not set'}</p>
      <p>Booking channel: {channelLabel(state.channel)}</p>
    </CardContent></Card>
    {!quote && !state.quoting && <Card>
      <CardHeader><CardTitle className="text-xl">Get a fresh combined quote</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">Quote your {state.lines.length} selected room line(s) to review per-room rates, the selected policy and the provisional total.</p>
        <Button variant="outline" className={stepButton} disabled={disabled || !state.lines.length} onClick={() => void actions.requestQuote()}>Get fresh combined quote</Button>
      </CardContent>
    </Card>}
    {state.quoting && !quote && <Card><CardContent className="p-4"><p role="status" className="text-sm">Getting your combined quote…</p></CardContent></Card>}
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
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <Checkbox id={ackId} checked={state.acknowledged} disabled={disabled || state.quoting} onCheckedChange={() => actions.acknowledge()} />
            <Label htmlFor={ackId} className="cursor-pointer text-sm font-medium leading-normal">I have reviewed these room rates and policy</Label>
          </div>
          <p className="text-sm text-muted-foreground">A changed catalogue or policy requires a fresh quote, review and another explicit confirmation.</p>
        </div>
      </CardContent>
    </Card>}
  </section>;
}

export interface StaffBookingWizardProps {
  state: StaffBookingState;
  actions: Actions;
  searchState: AvailabilityState;
  availability: AvailabilityActions;
  disabled?: boolean;
  initialStage?: WizardStage;
}

// Three-stage wizard: each action advances to the next tab instead of stacking
// the whole flow in one long scroll. Data, gating and re-quote behaviour are the
// same as the previous single-column layout; only the presentation changes.
export function StaffBookingWizard({ state, actions, searchState, availability, disabled = false, initialStage = 'rooms' }: StaffBookingWizardProps) {
  const [stage, setStage] = useState<WizardStage>(initialStage);
  const locked = disabled || state.creating || state.uncertain;
  if (state.created) return <StaffBookingConfirmation created={state.created} />;
  const roomsDone = state.lines.length > 0;
  const done: Record<WizardStage, boolean> = { rooms: roomsDone, guest: state.guestId.trim().length > 0, review: !!state.quote && state.acknowledged };
  const continueToReview = () => { setStage('review'); if (!state.quote) void actions.requestQuote(); };

  return <div className="min-w-0 space-y-4 @container">
    <header className="space-y-2">
      <h1 className="text-2xl font-bold tracking-tight">Create a staff booking</h1>
      <p className="text-sm text-muted-foreground">Search your assigned branch and add each room with its own dates and guests. Then review a combined quote and confirm one booking.</p>
    </header>
    <StaffBookingAlerts state={state} />
    <Tabs value={stage} onValueChange={value => setStage(value as WizardStage)}>
      <TabsList className="w-full">
        {STAGES.map((item, index) => <TabsTrigger key={item.id} value={item.id} className="flex-1"
          disabled={locked || (item.id !== 'rooms' && !roomsDone)}>
          {done[item.id] ? <Check aria-hidden="true" /> : <span className="tabular-nums">{index + 1}</span>}
          <span className="truncate">{item.label}</span>
        </TabsTrigger>)}
      </TabsList>

      <TabsContent value="rooms" className="mt-4 space-y-4">
        <AvailabilityPanel state={searchState} actions={availability} showHeader={false} variant="date-first"
          locked={disabled || state.quoting || state.creating || state.uncertain} />
        <p className="text-sm text-muted-foreground">Removing a room here only edits this unconfirmed draft. Booking cancellation and checkout use their separate staff workflows.</p>
        <StageFooter>
          {roomsDone && <p className="text-sm font-medium">{state.lines.length} room line{state.lines.length === 1 ? '' : 's'} selected</p>}
          <Button className={`${stepButton} ml-auto`} disabled={!roomsDone || locked || state.quoting} onClick={() => setStage('guest')}>Continue to guest details</Button>
        </StageFooter>
      </TabsContent>

      <TabsContent value="guest" className="mt-4 space-y-4">
        <StaffBookingGuestStep state={state} actions={actions} disabled={locked} />
        <StageFooter>
          <Button variant="outline" disabled={locked} onClick={() => setStage('rooms')}>Back to rooms</Button>
          <Button className={`${stepButton} ml-auto`} disabled={locked || !done.guest} onClick={continueToReview}>Get quote and review</Button>
        </StageFooter>
      </TabsContent>

      <TabsContent value="review" className="mt-4 space-y-4">
        <StaffBookingReviewStep state={state} actions={actions} disabled={locked} />
        <StageFooter>
          <Button variant="outline" disabled={locked} onClick={() => setStage('guest')}>Back to guest</Button>
          <Button className={`${stepButton} ml-auto`} disabled={locked || state.quoting || !state.acknowledged || !state.guestId} onClick={() => void actions.confirm()}>
            {state.creating ? 'Confirming booking…' : 'Confirm staff booking'}
          </Button>
        </StageFooter>
      </TabsContent>
    </Tabs>
  </div>;
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
  return <StaffBookingWizard state={state} searchState={searchState} availability={availability} disabled={searchState.rechecking} actions={{
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
  }} />;
}
