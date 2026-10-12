import { useEffect, useId, useMemo, useState } from 'react';
import { Check, ChevronsUpDown, LoaderCircle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  BookingOption,
  bookingOptionLabel,
  canSearchBookings,
  fetchBookingOptions,
  filterBookingOptions,
} from '@/lib/bookingLookup';
import { cn } from '@/lib/utils';
import { useFeatureSessions } from '@/components/auth/useFeatureSessions';

export interface BookingFinderProps {
  /**
   * Receives either a booking UUID (picked from the branch list) or a typed
   * booking reference. Every resource endpoint resolves both forms, so pages
   * pass this straight through to their existing fetchers.
   */
  onSelect: (identifier: string, label: string) => void;
  /** Human-readable label of the currently loaded booking, for confirmation. */
  selectedLabel?: string | null;
  /** True while the page is loading the selected booking. */
  busy?: boolean;
  /** Search input label; defaults to a billing-neutral wording. */
  searchLabel?: string;
  /**
   * Whether a typed booking reference can reach this page's loader. Set false
   * for pages whose loader depends on the UUID-only staff booking-detail
   * endpoint, so the finder never offers an input the backend would reject.
   */
  allowReference?: boolean;
  className?: string;
}

/**
 * Replaces the free-text "Booking UUID" box on the billing, check-in,
 * active-stay and service-usage screens.
 *
 * FRONT_DESK staff get a searchable combobox of their branch's bookings
 * (matched by reference or guest name). Other staff roles, who cannot list
 * bookings, get the booking-reference field where the page's loader accepts
 * one. Neither path ever asks for a raw UUID.
 */
export function BookingFinder({
  onSelect,
  selectedLabel,
  busy = false,
  searchLabel = 'Find a booking',
  allowReference = true,
  className,
}: BookingFinderProps) {
  const { role } = useFeatureSessions();
  const searchable = canSearchBookings(role);
  const searchId = useId();
  const referenceId = useId();

  const [options, setOptions] = useState<BookingOption[]>([]);
  const [loading, setLoading] = useState<boolean>(searchable);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState<boolean>(false);
  const [query, setQuery] = useState<string>('');
  const [reference, setReference] = useState<string>('');

  useEffect(() => {
    if (!searchable) {
      setOptions([]);
      setLoading(false);
      setLoadError(null);
      return;
    }
    let active = true;
    setLoading(true);
    setLoadError(null);
    void fetchBookingOptions().then((result) => {
      if (!active) return;
      setLoading(false);
      if (result.ok) {
        setOptions(result.items);
      } else {
        setOptions([]);
        setLoadError(result.message);
      }
    });
    return () => {
      active = false;
    };
  }, [searchable]);

  const filtered = useMemo(() => filterBookingOptions(options, query), [options, query]);

  const submitReference = () => {
    const value = reference.trim();
    if (!value || busy) return;
    onSelect(value, value);
  };

  return (
    <div className={className ?? 'space-y-3'}>
      {searchable ? (
        <div className="space-y-2">
          <Label htmlFor={searchId}>{searchLabel}</Label>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                id={searchId}
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={open}
                disabled={busy}
                className="w-full justify-between font-normal"
              >
                <span className={cn('truncate', !selectedLabel && 'text-muted-foreground')}>
                  {selectedLabel ?? 'Select a booking…'}
                </span>
                {busy ? (
                  <LoaderCircle className="ml-2 h-4 w-4 shrink-0 animate-spin opacity-60" aria-hidden="true" />
                ) : (
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-[var(--radix-popover-trigger-width)] min-w-72 p-0"
            >
              <Command shouldFilter={false}>
                <CommandInput
                  value={query}
                  onValueChange={setQuery}
                  placeholder="Search by booking reference or guest name"
                />
                <CommandList>
                  {loading ? (
                    <p role="status" className="py-6 text-center text-sm text-muted-foreground">
                      Loading branch bookings…
                    </p>
                  ) : loadError ? (
                    <p role="alert" className="px-4 py-6 text-center text-sm text-destructive">
                      {loadError}
                    </p>
                  ) : (
                    <>
                      <CommandEmpty>
                        {options.length === 0
                          ? 'No bookings found in your branch.'
                          : 'No bookings match that search.'}
                      </CommandEmpty>
                      <CommandGroup>
                        {filtered.map((option) => {
                          const label = bookingOptionLabel(option);
                          const active = selectedLabel === label;
                          return (
                            <CommandItem
                              key={option.bookingId}
                              value={option.bookingId}
                              disabled={busy}
                              onSelect={() => {
                                onSelect(option.bookingId, label);
                                setOpen(false);
                              }}
                              className="items-start"
                            >
                              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span className="truncate font-medium">{option.bookingRef}</span>
                                <span className="truncate text-xs text-muted-foreground">
                                  {option.guestName}
                                  {option.firstStayDate && option.lastStayDate
                                    ? ` · ${option.firstStayDate} → ${option.lastStayDate}`
                                    : ''}
                                </span>
                              </span>
                              {option.statusLabel ? (
                                <Badge variant="secondary" className="shrink-0">
                                  {option.statusLabel}
                                </Badge>
                              ) : null}
                              <Check
                                className={cn('mt-0.5 h-4 w-4 shrink-0', active ? 'opacity-100' : 'opacity-0')}
                                aria-hidden="true"
                              />
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        {allowReference ? (
          <>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor={referenceId}>
                {searchable ? 'Or enter a booking reference' : 'Booking reference'}
              </Label>
              <Input
                id={referenceId}
                value={reference}
                placeholder="e.g. BK-2026-0001"
                onChange={(event) => setReference(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submitReference();
                }}
              />
            </div>
            <Button type="button" onClick={submitReference} disabled={busy || reference.trim() === ''}>
              {busy ? 'Loading…' : 'Find booking'}
            </Button>
          </>
        ) : !searchable ? (
          <p role="status" className="text-sm text-muted-foreground">
            Booking search is available to front desk staff, who can open this page from their
            branch booking list.
          </p>
        ) : null}
      </div>

      {selectedLabel ? (
        <p role="status" className="text-xs text-muted-foreground tracking-tight">
          Showing: <span className="font-medium text-foreground">{selectedLabel}</span>
        </p>
      ) : null}
    </div>
  );
}
