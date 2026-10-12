import { useCallback, useState } from "react";

import { BookingFinder } from "@/components/bookings/BookingFinder";
import {
  ActiveStayBranchDenial,
  ActiveStayEmptyState,
  ActiveStayLoadFailure,
  ActiveStayPanel,
} from "@/components/stay/ActiveStayPanel";
import { BoundedContainer } from "@/components/layout/BoundedContainer";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BookingStaySummary,
  StayBookingGroup,
  buildStayGroup,
  describeStayFailure,
  isBranchDenial,
  mergeStayLines,
  parseActiveStays,
  parseStayFailure,
  stayRequestPath,
  summarizeStay,
} from "@/lib/activeStayViewModel";

const API_BASE = "/api";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ActiveStayPage() {
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [booking, setBooking] = useState<BookingStaySummary | null>(null);
  const [groups, setGroups] = useState<StayBookingGroup[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState<string | null>(null);

  const reset = useCallback(() => {
    setBooking(null);
    setGroups([]);
    setError(null);
    setDenied(null);
  }, []);

  const loadStay = useCallback(async (identifier: string) => {
    const trimmed = identifier.trim();
    if (!trimmed) {
      setError("Select or enter a booking reference.");
      reset();
      return;
    }

    setLoading(true);
    setError(null);
    setDenied(null);

    try {
      const response = await fetch(`${API_BASE}${stayRequestPath(trimmed)}`);
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const failure = parseStayFailure(response.status, payload);
        setBooking(null);
        setGroups([]);
        if (isBranchDenial(failure)) {
          setDenied(describeStayFailure(failure));
        } else {
          setError(describeStayFailure(failure));
        }
        return;
      }

      const activeStays = parseActiveStays(payload);
      const stayBooking: BookingStaySummary = {
        bookingId: (payload as { booking_id?: string }).booking_id ?? trimmed,
        bookingRef: (payload as { booking_ref?: string }).booking_ref ?? trimmed,
        guest: null,
        lines: [],
      };

      let lines = mergeStayLines([], activeStays);

      if (UUID_PATTERN.test(trimmed)) {
        const detail = await fetch(`${API_BASE}/bookings/${encodeURIComponent(trimmed)}`)
          .then((result) => (result.ok ? result.json() : null))
          .catch(() => null);
        const summary = (detail as { data?: BookingStaySummary } | null)?.data;
        if (summary) {
          stayBooking.guest = summary.guest ?? null;
          stayBooking.bookingRef = summary.bookingRef ?? stayBooking.bookingRef;
          stayBooking.bookingId = summary.bookingId ?? stayBooking.bookingId;
          lines = mergeStayLines(summary.lines ?? [], activeStays);
        }
      }

      setBooking(stayBooking);
      setGroups([
        buildStayGroup(
          {
            bookingId: stayBooking.bookingId,
            bookingRef: stayBooking.bookingRef,
            guestName: stayBooking.guest?.fullName ?? null,
          },
          lines,
        ),
      ]);
    } catch {
      reset();
      setError("Unable to reach the active-stay service.");
    } finally {
      setLoading(false);
    }
  }, [reset]);

  const handleSelect = useCallback(
    (identifier: string, label: string) => {
      setSelectedLabel(label);
      void loadStay(identifier);
    },
    [loadStay],
  );

  const totals = summarizeStay(groups);

  return (
      <PageContainer>
        <BoundedContainer>
          <div className="space-y-6">
            <header>
              <h1 className="text-2xl font-bold tracking-tight">Active Stays</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Occupancy grouped by booking. Each room line shows its own room, status and occupancy
                segment, so a partially checked-in booking stays readable.
              </p>
            </header>

            <Card className="shadow-md">
              <CardHeader className="p-4 md:p-5">
                <CardTitle className="text-lg tracking-tight">Find a stay</CardTitle>
              </CardHeader>
              <CardContent className="p-4 md:p-5 pt-0 space-y-3">
                <BookingFinder
                  onSelect={handleSelect}
                  selectedLabel={selectedLabel}
                  busy={loading}
                  searchLabel="Search bookings by reference or guest name"
                />
                <p className="text-xs text-muted-foreground tracking-tight">
                  Choosing a booking also loads every remaining line, so rooms still awaiting check-in
                  appear alongside occupied rooms.
                </p>
              </CardContent>
            </Card>

            {denied ? <ActiveStayBranchDenial message={denied} /> : null}
            {!denied && error ? <ActiveStayLoadFailure message={error} /> : null}

            {booking && !denied ? (
              <section className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {booking.guest?.fullName ? `${booking.guest.fullName} · ` : ''}
                  {booking.bookingRef}
                </span>
                <span>
                  {totals.occupiedRooms} occupied · {totals.pendingRooms} awaiting check-in
                </span>
              </section>
            ) : null}

            {booking && groups.length === 0 && !loading && !denied ? <ActiveStayEmptyState /> : null}

            {groups.length > 0 ? <ActiveStayPanel groups={groups} /> : null}
          </div>
        </BoundedContainer>
      </PageContainer>
  );
}