import { useEffect, useId, useMemo, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { FormField } from '@/components/ui/form-field';
import { formatLkr } from '@/lib/money';
import {
  AvailabilityApi, AvailabilityClient, AvailabilityModel, AvailabilityState,
  SearchDraft, nights, selectionIssue,
} from '@/lib/availability';

const GRID = 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3';
type Actions = Pick<AvailabilityModel, 'setDraft' | 'search' | 'add' | 'remove' | 'clear' | 'recheck' | 'loadOptions'>;

function SearchField({ label, value, type = 'text', error, disabled, onChange }: {
  label: string; value: string; type?: string; error?: string;
  disabled: boolean; onChange(value: string): void;
}) {
  const id = useId();
  return <div className="min-w-0 space-y-2">
    <Label htmlFor={id}>{label}</Label>
    <Input id={id} type={type} value={value} disabled={disabled}
      onChange={event => onChange(event.target.value)}
      min={type === 'number' ? 1 : undefined} max={type === 'number' ? 32767 : undefined}
      step={type === 'number' ? 1 : undefined}
      aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} />
    {error && <p id={`${id}-error`} className="text-sm text-destructive">{error}</p>}
  </div>;
}

// Rendering is shared by staff and direct guests. Search contains only public
// inventory; staff/guest identity is required by the later booking workflows.
export function AvailabilityPanel({ state, actions, locked = false, title = 'Find rooms at SkyNest',
  description = 'Search for a direct guest reservation or a staff-assisted booking. Add rooms individually with their own dates and guest counts.'
}: { state: AvailabilityState; actions: Actions; locked?: boolean; title?: string; description?: string }) {
  const { draft, options, results, selected, failure } = state;
  const disabled = locked || state.loadingOptions || !options || state.rechecking;
  const fields = failure?.fields ?? {};
  const set = <K extends keyof SearchDraft>(field: K, value: SearchDraft[K]) => actions.setDraft({ [field]: value });
  const branchName = (id: string) => options?.branches.find(branch => branch.branchId === id)?.name ?? 'Selected branch';

  return <div className="min-w-0 space-y-6 @container">
    <header className="space-y-2">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
    </header>

    {failure && <Card className="border-destructive"><CardContent className="p-4">
      <p role="alert" className="text-sm text-destructive">{failure.message}</p>
    </CardContent></Card>}
    {state.notice && <p role="status" className="text-sm">{state.notice}</p>}

    <Card>
      <CardHeader><CardTitle className="text-xl">Search one room line</CardTitle></CardHeader>
      <CardContent>
        {state.loadingOptions && <p role="status" className="mb-4 text-sm">Loading branches and room types…</p>}
        {!options && !state.loadingOptions && <Button variant="outline" onClick={() => void actions.loadOptions()}>Reload search choices</Button>}
        {options && !options.branches.length && <p role="status" className="text-sm">No active branches are available. Try again later.</p>}
        <FormField className="space-y-4" noValidate onSubmit={event => { event.preventDefault(); void actions.search(); }}>
          <div className="space-y-2" role="group" aria-label="SkyNest branch">
            <p className="text-sm font-medium">Branch</p>
            <div className="flex flex-wrap gap-2">
              {options?.branches.map(branch => <Button key={branch.branchId} type="button" size="sm"
                className="h-auto min-h-9 whitespace-normal text-left"
                variant={draft.branchId === branch.branchId ? 'default' : 'outline'}
                aria-pressed={draft.branchId === branch.branchId}
                disabled={disabled || (selected.length > 0 && draft.branchId !== branch.branchId)}
                onClick={() => set('branchId', branch.branchId)}>{branch.name} · {branch.city}</Button>)}
            </div>
            {fields.branchId && <p className="text-sm text-destructive">{fields.branchId}</p>}
            {!!selected.length && <p className="text-xs text-muted-foreground">All selected rooms stay in one branch. Remove your selection before changing branches.</p>}
          </div>
          <div className={GRID}>
            <SearchField label="Arrival date" type="date" value={draft.checkIn} disabled={disabled}
              error={fields.checkIn} onChange={value => set('checkIn', value)} />
            <SearchField label="Departure date" type="date" value={draft.checkOut} disabled={disabled}
              error={fields.checkOut} onChange={value => set('checkOut', value)} />
            <SearchField label="Guests for this room" type="number" value={draft.guestCount} disabled={disabled}
              error={fields.guestCount} onChange={value => set('guestCount', value)} />
          </div>
          <p className="text-xs text-muted-foreground">Arrival is inclusive; departure is exclusive. A room can be selected for another stay starting on its previous departure date.</p>
          <div className="space-y-2" role="group" aria-label="Room type filter">
            <p className="text-sm font-medium">Room type</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" disabled={disabled} variant={!draft.roomTypeId ? 'default' : 'outline'}
                aria-pressed={!draft.roomTypeId} onClick={() => set('roomTypeId', '')}>Any type</Button>
              {options?.roomTypes.map(type => <Button key={type.roomTypeId} type="button" size="sm"
                className="h-auto min-h-9 whitespace-normal text-left" disabled={disabled}
                variant={draft.roomTypeId === type.roomTypeId ? 'default' : 'outline'}
                aria-pressed={draft.roomTypeId === type.roomTypeId}
                onClick={() => set('roomTypeId', type.roomTypeId)}>{type.name}</Button>)}
            </div>
            {fields.roomTypeId && <p className="text-sm text-destructive">{fields.roomTypeId}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" size="sm" className="h-auto min-h-9 whitespace-normal" disabled={disabled} variant={draft.immediateCheckIn ? 'default' : 'outline'}
              aria-pressed={draft.immediateCheckIn} onClick={() => set('immediateCheckIn', !draft.immediateCheckIn)}>Require READY for immediate check-in</Button>
            <Button type="submit" className="h-auto min-h-11 whitespace-normal" disabled={disabled || state.searching || !options?.branches.length}>{state.searching ? 'Searching…' : 'Search available rooms'}</Button>
          </div>
        </FormField>
      </CardContent>
    </Card>

    <section className="space-y-4" aria-label="Selected room lines">
      <Card>
        <CardHeader><CardTitle className="text-xl">Your room selection</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p role="status" className="text-sm">{selected.length} room lines · {selected.reduce((sum, line) => sum + line.search.guestCount, 0)} guests across lines · {selected.reduce((sum, line) => sum + nights(line.search), 0)} room nights</p>
          <p className="text-sm text-muted-foreground">Selections are not reservations. Displayed rates are current catalogue rates; final prices and availability are checked when you confirm a booking.</p>
          {!selected.length && <p className="text-sm">No rooms selected. Search and add each room you need.</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-auto min-h-11 whitespace-normal" disabled={locked || !selected.length || state.rechecking} onClick={() => void actions.recheck()}>{state.rechecking ? 'Rechecking…' : 'Recheck selected rooms'}</Button>
            <Button variant="ghost" disabled={locked || !selected.length || state.rechecking} onClick={() => actions.clear()}>Clear selection</Button>
          </div>
          <div className={GRID}>
            {selected.map(line => <Card key={line.selectionId} className="min-w-0 shadow-none">
              <CardHeader><CardTitle className="break-words text-lg">Room {line.room.roomNumber} · {line.room.roomType.name}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm">{branchName(line.room.branchId)}</p>
                <p className="text-sm">{line.search.checkIn} to {line.search.checkOut}</p>
                <p className="text-sm">{line.search.guestCount} guests · {nights(line.search)} nights</p>
                <p className="text-sm">{formatLkr(line.room.roomType.baseDailyRate)} / night</p>
                <Badge variant={line.check === 'available' ? 'secondary' : 'destructive'}>{line.check === 'available' ? 'Available when checked' : 'Needs attention'}</Badge>
                {line.issue && <p role="alert" className="text-sm text-destructive">{line.issue}</p>}
                <Button variant="outline" size="sm" disabled={locked || state.rechecking}
                  aria-label={`Remove room ${line.room.roomNumber} for ${line.search.checkIn}`}
                  onClick={() => actions.remove(line.selectionId)}>Remove selection</Button>
              </CardContent>
            </Card>)}
          </div>
        </CardContent>
      </Card>
    </section>

    <section className="space-y-4" aria-label="Availability results">
      <h2 className="text-xl font-semibold">Available rooms</h2>
      {state.searching && <p role="status">Searching current inventory…</p>}
      {!results && !state.searching && <p className="text-sm text-muted-foreground">Choose dates and guests, then search. Changing the search fields keeps your selected room lines.</p>}
      {results && <>
        <p className="text-sm">{branchName(results.search.branchId)} · {results.search.checkIn} to {results.search.checkOut} · {results.search.guestCount} guests per room · {results.rooms.length} matching rooms</p>
        {!results.rooms.length && <Card><CardContent className="space-y-2 p-4">
          <p role="status">No rooms match these dates, capacity and room-type choices.</p>
          <p className="text-sm text-muted-foreground">Try different dates or Any type. Your existing selection is retained.</p>
        </CardContent></Card>}
        <div className={GRID}>
          {results.rooms.map(room => {
            const issue = selectionIssue(room, results.search, selected);
            return <Card key={room.roomId} className="min-w-0">
              <CardHeader><CardTitle className="break-words text-lg">Room {room.roomNumber} · {room.roomType.name}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <p>{formatLkr(room.roomType.baseDailyRate)} / night</p>
                <p className="text-sm">Up to {room.roomType.capacity} guests</p>
                <p className="break-words text-sm text-muted-foreground">{room.roomType.amenities.map(amenity => amenity.name).join(', ') || 'No amenities listed'}</p>
                <Badge variant="secondary">{room.operationalStatus === 'READY' ? 'Physically READY' : 'Cleaning now'}</Badge>
                {room.operationalStatus === 'CLEANING' && <p className="text-xs text-muted-foreground">Available for the requested stay; immediate check-in requires READY.</p>}
                {issue && <p className="text-xs text-muted-foreground">{issue}</p>}
                <Button disabled={locked || !!issue || state.rechecking} aria-label={`Add room ${room.roomNumber}`}
                  onClick={() => actions.add(room.roomId)}>Add to selection</Button>
              </CardContent>
            </Card>;
          })}
        </div>
      </>}
    </section>
  </div>;
}

export function AvailabilitySearchScreen({ client }: { client?: AvailabilityClient }) {
  const api = useMemo(() => client ?? new AvailabilityApi(), [client]);
  const model = useMemo(() => new AvailabilityModel(api), [api]);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  useEffect(() => { void model.loadOptions(); return model.cancelPending; }, [model]);
  return <AvailabilityPanel state={state} actions={model} />;
}
