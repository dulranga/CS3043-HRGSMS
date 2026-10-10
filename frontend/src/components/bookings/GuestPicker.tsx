import { FormEvent, InputHTMLAttributes, useState } from 'react';
import { CircleAlert, LoaderCircle, Search, UserPlus } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

export function GuestPicker({ value, selectedName, onSelect, disabled = false, client = defaultClient, initialMode = 'search' }: {
  value: string; selectedName: string;
  onSelect(guestId: string, guestName: string): void;
  disabled?: boolean; client?: GuestPickerClient; initialMode?: 'search' | 'new';
}) {
  const [mode, setMode] = useState<'search' | 'new'>(initialMode);
  const [query, setQuery] = useState('');
  const [nic, setNic] = useState('');
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<GuestProfile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [duplicate, setDuplicate] = useState<{ candidates: GuestCandidate[]; nicConflict: boolean } | null>(null);

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
    setError(null);
    onSelect(profile.guestId, profile.fullName);
  }

  async function runSearch(event?: FormEvent) {
    event?.preventDefault();
    if (searching) return;
    const q = query.trim(), n = nic.trim();
    if (!q && !n) { setError('Enter a name, email, phone or full NIC.'); return; }
    if (q && q.length < 2) { setError('Enter at least 2 characters.'); return; }
    setError(null); setSearching(true); setSearched(true);
    try {
      const result = await client.search({ query: q || undefined, nic: n || undefined });
      setResults(result.guests);
    } catch (e) {
      setResults([]);
      setError(e instanceof GuestApiError ? e.message : 'Search failed. Please try again.');
    } finally { setSearching(false); }
  }

  async function submitCreate(confirm = false) {
    if (creating) return;
    const fullName = form.fullName.trim(), email = form.email.trim().toLowerCase(), phone = form.phone.trim();
    const errors: Record<string, string> = {};
    if (!fullName) errors.fullName = "Enter the guest's full name.";
    if (email && !EMAIL_PATTERN.test(email)) errors.email = 'Enter a valid email address.';
    if (phone && !PHONE_PATTERN.test(phone.replace(/[\s().-]/g, ''))) errors.phone = 'Enter 7-15 digits with an optional leading +.';
    if (!email && !phone && !errors.email && !errors.phone) errors.email = 'Enter an email address or a phone number.';
    setFieldErrors(errors); setError(null);
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
      else setError(e instanceof GuestApiError ? e.message : 'Could not create the guest. Please try again.');
    } finally { setCreating(false); }
  }

  const field = (key: keyof typeof emptyForm, label: string, props: InputHTMLAttributes<HTMLInputElement> = {}) => <div className="space-y-1.5">
    <Label htmlFor={`guest-picker-${key}`} className={cn(fieldErrors[key] && 'text-destructive')}>{label}</Label>
    <Input id={`guest-picker-${key}`} value={form[key]} disabled={disabled}
      aria-invalid={!!fieldErrors[key]} aria-describedby={fieldErrors[key] ? `guest-picker-${key}-error` : undefined}
      className={cn(fieldErrors[key] && 'border-destructive')} onChange={event => setForm(prev => ({ ...prev, [key]: event.target.value }))} {...props} />
    {fieldErrors[key] && <p id={`guest-picker-${key}-error`} className="text-xs font-medium text-destructive">{fieldErrors[key]}</p>}
  </div>;

  return <div className="space-y-4">
    <div role="tablist" aria-label="Guest selection" className="inline-flex flex-wrap items-center gap-1 rounded-xl border-2 border-border bg-secondary/40 p-1">
      <Button type="button" size="sm" variant={mode === 'search' ? 'default' : 'ghost'} disabled={disabled} onClick={() => setMode('search')}><Search aria-hidden="true" /> Search existing</Button>
      <Button type="button" size="sm" variant={mode === 'new' ? 'default' : 'ghost'} disabled={disabled} onClick={() => setMode('new')}><UserPlus aria-hidden="true" /> New guest</Button>
    </div>

    {error && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true" /><div><AlertTitle>Guest lookup failed</AlertTitle><AlertDescription>{error}</AlertDescription></div></Alert>}

    {mode === 'search' ? <>
      <form noValidate className="grid grid-cols-1 gap-3 md:grid-cols-12 md:items-end" onSubmit={runSearch}>
        <div className="space-y-1.5 md:col-span-7"><Label htmlFor="guest-picker-query">Name, email or phone</Label>
          <Input id="guest-picker-query" value={query} maxLength={100} disabled={disabled} placeholder="e.g. Kasun or kasun@example.com" onChange={event => setQuery(event.target.value)} /></div>
        <div className="space-y-1.5 md:col-span-3"><Label htmlFor="guest-picker-nic">Full NIC (exact)</Label>
          <Input id="guest-picker-nic" value={nic} maxLength={255} disabled={disabled} spellCheck={false} placeholder="Exact match only" onChange={event => setNic(event.target.value)} /></div>
        <div className="md:col-span-2"><Button type="submit" className="w-full" disabled={disabled || searching}>
          {searching ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Search aria-hidden="true" />}{searching ? 'Searching…' : 'Search'}</Button></div>
      </form>
      <div aria-live="polite">
        {!searched && <p className="py-3 text-center text-sm text-muted-foreground">Search for the guest, or create a new profile if they are not yet registered.</p>}
        {searched && !searching && results.length === 0 && <p className="py-3 text-center text-sm text-muted-foreground">No guest profiles matched. Check the spelling, or create a new guest.</p>}
        {results.length > 0 && <ul className="divide-y divide-border rounded-xl border-2 border-border">
          {results.map(guest => <li key={guest.guestId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 truncate text-sm font-medium">{guest.fullName}{!guest.active && <Badge variant="destructive">Deactivated</Badge>}</p>
              <p className="truncate text-xs text-muted-foreground">{[guest.email || guest.phone || '—', guest.maskedNic].filter(Boolean).join(' · ')}</p>
            </div>
            <Button type="button" size="sm" variant="outline" disabled={disabled || !guest.active} onClick={() => choose(guest)}>Select</Button>
          </li>)}
        </ul>}
      </div>
    </> : <form noValidate className="grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={event => { event.preventDefault(); void submitCreate(); }}>
      <div className="md:col-span-2">{field('fullName', 'Full name', { maxLength: 255, autoComplete: 'name' })}</div>
      {field('email', 'Email (or phone)', { type: 'email', maxLength: 255, autoComplete: 'email' })}
      {field('phone', 'Phone (or email)', { type: 'tel', maxLength: 32, autoComplete: 'tel' })}
      <div className="md:col-span-2">{field('nic', 'Full NIC (optional)', { maxLength: 255, spellCheck: false, autoCapitalize: 'characters' })}</div>
      <div className="md:col-span-2"><Button type="submit" disabled={disabled || creating}>
        {creating ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <UserPlus aria-hidden="true" />}{creating ? 'Creating…' : 'Create guest'}</Button></div>
    </form>}

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
  </div>;
}
