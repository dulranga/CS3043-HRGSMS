import { FormEvent, InputHTMLAttributes, useEffect, useId, useRef, useState } from 'react';
import { ChevronsUpDown, CircleAlert, LoaderCircle, Search, UserPlus } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  GuestApiError, createGuest, searchGuests,
  type GuestCandidate, type GuestCreateInput, type GuestProfile, type GuestSearchInput, type GuestSearchResult,
} from '@/lib/guests';

// Front desk selects the booking's primary guest here: search an existing
// profile or create one inline through Member 1's guest API. Requiring a pasted
// guest UUID beforehand made staff bookings impossible to complete (FR-019/
// FR-020). The chosen guest's id is what the booking create payload needs.

export interface GuestPickerClient {
  search(input: GuestSearchInput): Promise<GuestSearchResult>;
  create(input: GuestCreateInput): Promise<GuestProfile>;
}
const defaultClient: GuestPickerClient = { search: searchGuests, create: createGuest };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;
const emptyForm = { fullName: '', email: '', phone: '', nic: '' };
const SEARCH_DELAY_MS = 300;

export function GuestPicker({ value, selectedName, onSelect, disabled = false, client = defaultClient, initialMode = 'search' }: {
  value: string; selectedName: string;
  onSelect(guestId: string, guestName: string): void;
  disabled?: boolean; client?: GuestPickerClient; initialMode?: 'search' | 'new';
}) {
  const comboboxId = useId();
  const [mode, setMode] = useState<'search' | 'new'>(initialMode);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [nic, setNic] = useState('');
  const [nicSearched, setNicSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<GuestProfile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [duplicate, setDuplicate] = useState<{ candidates: GuestCandidate[]; nicConflict: boolean } | null>(null);
  const requestRef = useRef(0);

  async function runSearch(input: GuestSearchInput) {
    const request = ++requestRef.current;
    setError(null); setSearching(true);
    try {
      const result = await client.search(input);
      if (request === requestRef.current) setResults(result.guests);
    } catch (e) {
      if (request !== requestRef.current) return;
      setResults([]);
      setError(e instanceof GuestApiError ? e.message : 'Search failed. Please try again.');
    } finally { if (request === requestRef.current) setSearching(false); }
  }

  // Search-as-you-type: debounce typed queries so each keystroke does not hit the guest API.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      if (!nicSearched) { requestRef.current++; setResults([]); setSearching(false); setError(null); }
      return;
    }
    setNicSearched(false);
    const timer = setTimeout(() => void runSearch({ query: q }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);

  if (value) {
    return <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-border bg-background/60 px-4 py-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Primary guest</p>
        <p className="truncate text-sm font-medium">{selectedName || 'Selected guest'}</p>
        <p className="truncate font-mono text-xs text-muted-foreground">{value}</p>
      </div>
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onSelect('', '')}>Change guest</Button>
    </div>;
  }

  function choose(profile: { guestId: string; fullName: string }) {
    setDuplicate(null);
    setError(null); setCreateError(null);
    onSelect(profile.guestId, profile.fullName);
  }

  function runNicSearch(event: FormEvent) {
    event.preventDefault();
    const n = nic.trim();
    if (!n || searching) return;
    setQuery(''); setNicSearched(true); setOpen(true);
    void runSearch({ nic: n });
  }

  async function submitCreate(confirm = false) {
    if (creating) return;
    const fullName = form.fullName.trim(), email = form.email.trim().toLowerCase(), phone = form.phone.trim();
    const errors: Record<string, string> = {};
    if (!fullName) errors.fullName = "Enter the guest's full name.";
    if (email && !EMAIL_PATTERN.test(email)) errors.email = 'Enter a valid email address.';
    if (phone && !PHONE_PATTERN.test(phone.replace(/[\s().-]/g, ''))) errors.phone = 'Enter 7-15 digits with an optional leading +.';
    if (!email && !phone && !errors.email && !errors.phone) errors.email = 'Enter an email address or a phone number.';
    setFieldErrors(errors); setCreateError(null);
    if (!confirm) setDuplicate(null);
    if (Object.keys(errors).length) return;
    setCreating(true);
    try {
      const created = await client.create({ fullName, email: email || undefined, phone: phone || undefined, nic: form.nic.trim() || undefined, confirmNotDuplicate: confirm || undefined });
      setForm(emptyForm);
      setMode('search');
      choose(created);
    } catch (e) {
      if (e instanceof GuestApiError && e.code === 'VALIDATION_ERROR') setFieldErrors(e.fields ?? {});
      else if (e instanceof GuestApiError && (e.code === 'POSSIBLE_DUPLICATE' || e.code === 'GUEST_NIC_EXISTS')) setDuplicate({ candidates: e.candidates ?? [], nicConflict: e.code === 'GUEST_NIC_EXISTS' });
      else setCreateError(e instanceof GuestApiError ? e.message : 'Could not create the guest. Please try again.');
    } finally { setCreating(false); }
  }

  const field = (key: keyof typeof emptyForm, label: string, props: InputHTMLAttributes<HTMLInputElement> = {}) => <div className="space-y-1.5">
    <Label htmlFor={`guest-picker-${key}`} className={cn(fieldErrors[key] && 'text-destructive')}>{label}</Label>
    <Input id={`guest-picker-${key}`} value={form[key]} disabled={disabled}
      aria-invalid={!!fieldErrors[key]} aria-describedby={fieldErrors[key] ? `guest-picker-${key}-error` : undefined}
      className={cn(fieldErrors[key] && 'border-destructive')} onChange={event => setForm(prev => ({ ...prev, [key]: event.target.value }))} {...props} />
    {fieldErrors[key] && <p id={`guest-picker-${key}-error`} className="text-xs font-medium text-destructive">{fieldErrors[key]}</p>}
  </div>;

  function startCreate() {
    const typed = query.trim();
    if (typed && !form.fullName && !/[@\d]/.test(typed)) setForm(prev => ({ ...prev, fullName: typed }));
    setOpen(false);
    setMode('new');
  }

  const queryTooShort = query.trim().length < 2;

  return <Tabs value={mode} onValueChange={value => setMode(value as 'search' | 'new')} className="space-y-4">
    <TabsList aria-label="Guest selection" className="grid w-full grid-cols-2 sm:inline-grid sm:w-auto">
      <TabsTrigger value="search" disabled={disabled}><Search aria-hidden="true" /> Search existing</TabsTrigger>
      <TabsTrigger value="new" disabled={disabled}><UserPlus aria-hidden="true" /> New guest</TabsTrigger>
    </TabsList>

    <TabsContent value="search" className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={comboboxId}>Name, email or phone</Label>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button id={comboboxId} type="button" variant="outline" role="combobox" aria-expanded={open} disabled={disabled}
              className="h-11 w-full justify-between font-normal">
              <span className="flex min-w-0 items-center gap-2 text-muted-foreground"><Search aria-hidden="true" /><span className="truncate">{query.trim() || 'Search guests by name, email or phone…'}</span></span>
              <ChevronsUpDown className="opacity-50" aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-72 p-0">
            <Command shouldFilter={false}>
              <CommandInput value={query} onValueChange={setQuery} maxLength={100} placeholder="e.g. Kasun or kasun@example.com" />
              <CommandList aria-live="polite">
                {searching ? <p role="status" className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> Searching guests…</p>
                  : error ? <p role="alert" className="px-4 py-6 text-center text-sm text-destructive">{error}</p>
                  : results.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                    {queryTooShort && !nicSearched ? 'Type at least 2 characters to search guest profiles.' : 'No guest profiles matched. Check the spelling, or create a new guest.'}</p>
                  : <CommandGroup heading={nicSearched && queryTooShort ? 'NIC match' : `${results.length} matching guest${results.length === 1 ? '' : 's'}`}>
                    {results.map(guest => <CommandItem key={guest.guestId} value={guest.guestId} disabled={!guest.active} onSelect={() => { choose(guest); setOpen(false); }}>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate font-medium">{guest.fullName}</span>
                        <span className="truncate text-xs text-muted-foreground">{[guest.email || guest.phone || '—', guest.maskedNic].filter(Boolean).join(' · ')}</span>
                      </span>
                      {!guest.active && <Badge variant="destructive" className="shrink-0">Deactivated</Badge>}
                    </CommandItem>)}
                  </CommandGroup>}
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem value="__create-guest" onSelect={startCreate}><UserPlus aria-hidden="true" /> Create a new guest profile</CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      <form noValidate className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={runNicSearch}>
        <div className="flex-1 space-y-1.5"><Label htmlFor="guest-picker-nic">Full NIC (exact)</Label>
          <Input id="guest-picker-nic" value={nic} maxLength={255} disabled={disabled} spellCheck={false} placeholder="Exact match only" onChange={event => setNic(event.target.value)} /></div>
        <Button type="submit" variant="outline" disabled={disabled || searching || !nic.trim()}>
          {searching && nicSearched ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Search aria-hidden="true" />}Find by NIC</Button>
      </form>
    </TabsContent>

    <TabsContent value="new">
      {createError && <Alert variant="destructive" role="alert" className="mb-4"><CircleAlert aria-hidden="true" /><div><AlertTitle>Could not create guest</AlertTitle><AlertDescription>{createError}</AlertDescription></div></Alert>}
      <form noValidate className="grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={event => { event.preventDefault(); void submitCreate(); }}>
        <div className="md:col-span-2">{field('fullName', 'Full name', { maxLength: 255, autoComplete: 'name' })}</div>
        {field('email', 'Email (or phone)', { type: 'email', maxLength: 255, autoComplete: 'email' })}
        {field('phone', 'Phone (or email)', { type: 'tel', maxLength: 32, autoComplete: 'tel' })}
        <div className="md:col-span-2">{field('nic', 'Full NIC (optional)', { maxLength: 255, spellCheck: false, autoCapitalize: 'characters' })}</div>
        <div className="md:col-span-2"><Button type="submit" disabled={disabled || creating}>
          {creating ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <UserPlus aria-hidden="true" />}{creating ? 'Creating…' : 'Create guest'}</Button></div>
      </form>
    </TabsContent>

    {duplicate && <Alert variant={duplicate.nicConflict ? 'destructive' : 'default'} role="alert">
      {duplicate.nicConflict ? <CircleAlert aria-hidden="true" /> : <Search aria-hidden="true" />}
      <div>
        <AlertTitle>{duplicate.nicConflict ? 'This NIC already belongs to another profile' : 'Possible duplicate guest'}</AlertTitle>
        <AlertDescription>{duplicate.nicConflict ? 'A guest can have only one record per NIC. Select the existing profile instead.' : 'These details match an existing guest. Use that profile, or confirm this is a different person.'}</AlertDescription>
        {duplicate.candidates.length > 0 && <ul className="mt-3 space-y-2">
          {duplicate.candidates.map(candidate => <li key={candidate.guestId} className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-border bg-background/60 px-3 py-2">
            <span className="text-sm font-medium">{candidate.fullName}</span>
            {candidate.maskedNic && <span className="font-mono text-xs text-muted-foreground">{candidate.maskedNic}</span>}
            <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => choose(candidate)}>Use this profile</Button>
          </li>)}
        </ul>}
        <div className="mt-3 flex flex-wrap gap-2">
          {!duplicate.nicConflict && <Button type="button" variant="outline" size="sm" disabled={creating} onClick={() => void submitCreate(true)}>This is a different person — continue</Button>}
          <Button type="button" variant="ghost" size="sm" onClick={() => setDuplicate(null)}>Cancel</Button>
        </div>
      </div>
    </Alert>}
  </Tabs>;
}
