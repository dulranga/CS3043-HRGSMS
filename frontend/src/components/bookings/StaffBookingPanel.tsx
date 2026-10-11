import { ReactNode, useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import { CalendarDays, Check, CircleCheck, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GuestPicker } from '@/components/bookings/GuestPicker';
import { AvailabilityPanel } from '@/components/rooms/AvailabilityPanel';
import { AvailabilityApi, AvailabilityClient, AvailabilityModel, AvailabilityState, nights } from '@/lib/availability';
import { formatLkr } from '@/lib/money';
import { formatHotelDateTime, formatStayDate, formatStayRange } from '@/lib/dateFormat';
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
const STAFF_CHANNELS: StaffChannel[] = ['FRONT_DESK', 'PHONE', 'EMAIL'];
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

const FACTS = 'grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl border-2 border-border bg-card p-4 md:grid-cols-4';
const PANEL = 'space-y-3 rounded-xl border-2 border-border p-4';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0 space-y-0.5"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-sm font-medium">{children}</dd></div>;
}
function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">{label}</dt><dd className="shrink-0 font-medium tabular-nums">{children}</dd></div>;
}
function RoomLineCard({ line, capacity, rateLabel, rate, charge }: {
  line: { roomNumber: string; roomTypeName: string; checkIn: string; checkOut: string; guestCount: number };
  capacity?: number; rateLabel: string; rate: string; charge?: string;
}) {
  const count = nights(line);
  return <Card className="min-w-0 shadow-none hover:shadow-none">
    <CardHeader className="space-y-1 pb-3">
      <div className="flex items-start justify-between gap-3">
        <CardTitle className="break-words text-lg">Room {line.roomNumber}</CardTitle>
        <Badge variant="secondary">{count} {count === 1 ? 'night' : 'nights'}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{line.roomTypeName}</p>
    </CardHeader>
    <CardContent className="space-y-3 text-sm">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-background/60 p-3">
        <div className="col-span-2 space-y-0.5"><dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="size-3.5" aria-hidden="true" />Dates</dt>
          <dd className="font-medium">{formatStayRange(line.checkIn, line.checkOut)}</dd></div>
        <div className="space-y-0.5"><dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><Users className="size-3.5" aria-hidden="true" />Guests</dt>
          <dd className="font-medium">{line.guestCount}{capacity ? ` of ${capacity}` : ''}</dd></div>
        <div className="space-y-0.5"><dt className="text-xs text-muted-foreground">{rateLabel}</dt>
          <dd className="font-medium tabular-nums">{formatLkr(rate)} / night</dd></div>
      </dl>
      {charge && <div className="flex items-baseline justify-between gap-3 border-t-2 border-border pt-3">
        <span className="text-muted-foreground">Room charge</span><span className="font-semibold tabular-nums">{formatLkr(charge)}</span>
      </div>}
    </CardContent>
  </Card>;
}

// Full-width terminal view — replaces the tabs once the booking exists so the
// reference and every agreed line are impossible to miss.
export function StaffBookingConfirmation({ created }: { created: CreatedStaffBooking }) {
  return <Card>
    <CardHeader className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><CircleCheck className="size-5" aria-hidden="true" /></span>
        <div className="min-w-0">
          <CardTitle className="text-xl">Booking confirmed</CardTitle>
          <p className="break-all font-mono text-sm text-muted-foreground">{created.bookingRef}</p>
        </div>
      </div>
    </CardHeader>
    <CardContent className="space-y-6">
      <dl className={FACTS}>
        <Fact label="Rooms booked">{created.lines.length}</Fact>
        <Fact label="Channel">{channelLabel(created.bookingChannel)}</Fact>
        <Fact label="Invoice status">Draft</Fact>
        <Fact label="Invoice total">{formatLkr(created.invoice.total)}</Fact>
      </dl>
      <div className={GRID}>{created.lines.map(line => <RoomLineCard key={line.lineId} line={line} rateLabel="Agreed base rate" rate={line.rateSnapshot} />)}</div>
      <p className="text-sm text-muted-foreground">Created one DRAFT invoice; it is provisional, and payment and check-in are separate operations. Keep booking reference {created.bookingRef} for subsequent staff operations.</p>
    </CardContent>
  </Card>;
}

// Stage 2 — the primary guest record and booking channel.
export function StaffBookingGuestStep({ state, actions, disabled = false }: { state: StaffBookingState; actions: Actions; disabled?: boolean }) {
  const channelId = useId();
  return <Card>
    <CardHeader><CardTitle className="text-xl">Primary guest and booking channel</CardTitle></CardHeader>
    <CardContent className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Primary guest</h3>
        <p className="text-sm text-muted-foreground">Search an existing guest profile or create one inline; the booking links to this guest record.</p>
        <GuestPicker value={state.guestId} selectedName={state.guestName} disabled={disabled}
          onSelect={(guestId, guestName) => actions.setGuest(guestId, guestName)} />
      </div>
      <div className="space-y-1.5 sm:max-w-xs">
        <Label htmlFor={channelId}>Booking channel</Label>
        <NativeSelect id={channelId} value={state.channel} disabled={disabled}
          onChange={event => actions.setChannel(event.target.value as StaffChannel)}>
          {STAFF_CHANNELS.map(channel => <NativeSelectOption key={channel} value={channel}>{channelLabel(channel)}</NativeSelectOption>)}
        </NativeSelect>
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
  const policy = quote?.billingPolicy;
  return <section className="min-w-0 space-y-4" aria-label="Staff booking quote and review">
    <dl className={FACTS}>
      <Fact label="Primary guest"><span className="break-all">{state.guestName || state.guestId || 'Not set'}</span></Fact>
      <Fact label="Booking channel">{channelLabel(state.channel)}</Fact>
      <Fact label="Rooms">{state.lines.length}</Fact>
      <Fact label="Guests">{quote ? quote.lines.reduce((sum, line) => sum + line.guestCount, 0) : '—'}</Fact>
    </dl>
    {!quote && !state.quoting && <Card>
      <CardHeader><CardTitle className="text-xl">Get a fresh combined quote</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">Quote your {state.lines.length} selected room line(s) to review per-room rates, the selected policy and the provisional total.</p>
        <Button variant="outline" className={stepButton} disabled={disabled || !state.lines.length} onClick={() => void actions.requestQuote()}>Get fresh combined quote</Button>
      </CardContent>
    </Card>}
    {state.quoting && !quote && <Card><CardContent className="p-4"><p role="status" className="text-sm">Getting your combined quote…</p></CardContent></Card>}
    {quote && totals && policy && <Card>
      <CardHeader>
        <CardTitle className="text-xl">Review the provisional combined quote</CardTitle>
        <CardDescription>Confirmation rechecks every rate, room and the effective policy; the saved invoice is authoritative.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className={GRID}>{quote.lines.map((line, index) => <RoomLineCard key={`${line.roomId}-${line.checkIn}`} line={line} capacity={line.capacity}
          rateLabel="Quoted base rate" rate={line.baseDailyRate} charge={totals.roomAmounts[index]} />)}</div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className={PANEL} aria-label="Price breakdown">
            <h3 className="font-display text-base font-semibold tracking-tight">Price breakdown</h3>
            <dl className="space-y-2 text-sm">
              <Row label="Rooms">{formatLkr(totals.roomSubtotal)}</Row>
              <Row label="Discount (none applied at creation)">{formatLkr('0.00')}</Row>
              <Row label={`Service charge (${policy.serviceChargePercent}%)`}>{formatLkr(totals.serviceCharge)}</Row>
              <Row label={`Tax (${policy.taxPercent}% on rooms plus service charge)`}>{formatLkr(totals.tax)}</Row>
            </dl>
            <div className="flex items-baseline justify-between gap-3 border-t-2 border-border pt-3">
              <span className="text-sm font-medium">Provisional combined total</span>
              <span className="font-display text-xl font-semibold tabular-nums tracking-tight">{formatLkr(totals.total)}</span>
            </div>
            <p className="text-xs text-muted-foreground">Service usage and later flat fees are excluded.</p>
          </section>

          <section className={PANEL} aria-label="Billing policy">
            <h3 className="font-display text-base font-semibold tracking-tight">Billing policy</h3>
            <dl className="space-y-2 text-sm">
              <Row label="Cancellation fee">{formatLkr(policy.cancellationFee)}</Row>
              <Row label="No-show fee">{formatLkr(policy.noShowFee)}</Row>
              <Row label="Late checkout fee">{formatLkr(policy.lateCheckoutFee)}</Row>
              <Row label="No-show grace">{policy.noShowGraceDays} days</Row>
              <Row label="Effective from">{formatStayDate(policy.effectiveFrom)}</Row>
              <Row label="Published (Asia/Colombo)">{formatHotelDateTime(policy.createdAt)}</Row>
            </dl>
            <p className="break-all font-mono text-xs text-muted-foreground">Selected policy: {policy.billingPolicyId}</p>
          </section>
        </div>

        <div className={`${PANEL} bg-background/60`}>
          <div className="flex items-start gap-3">
            <Checkbox id={ackId} checked={state.acknowledged} disabled={disabled || state.quoting} onCheckedChange={() => actions.acknowledge()} />
            <Label htmlFor={ackId} className="cursor-pointer text-sm font-medium leading-normal">I have reviewed these room rates and policy</Label>
          </div>
          <p className="pl-7 text-xs text-muted-foreground">A changed catalogue or policy requires a fresh quote, review and another explicit confirmation.</p>
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
