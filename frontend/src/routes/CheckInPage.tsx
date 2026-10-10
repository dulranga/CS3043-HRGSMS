import { useCallback, useEffect, useState } from "react";

import { BookingFinder } from "@/components/bookings/BookingFinder";
import { BillingFlowNav } from "@/components/billing/BillingFlowNav";
import { NextStepCard } from "@/components/billing/NextStepCard";
import { LineCheckInPanel } from "@/components/checkin/LineCheckInPanel";
import { BoundedContainer } from "@/components/layout/BoundedContainer";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useBillingBooking } from "@/lib/billingFlow";
import {
  CheckInLine,
  CheckInSuccess,
  applyCheckInSuccess,
  checkInRequestPath,
  describeCheckInRejection,
  evaluateLineForCheckIn,
  lineStatusCounts,
  parseCheckInFailure,
} from "@/lib/checkInViewModel";

const API_BASE = "/api";
const FLOW_PATH = "/dashboard/check-in" as const;

interface BookingDetailLine extends CheckInLine {}

interface BookingDetailPayload {
  bookingId: string;
  bookingRef: string;
  guest: { fullName: string };
  lines: BookingDetailLine[];
}

function currentStayDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default function CheckInPage() {
  const { booking, label, select } = useBillingBooking(FLOW_PATH);
  const [loadedBooking, setLoadedBooking] = useState<BookingDetailPayload | null>(null);
  const [lines, setLines] = useState<CheckInLine[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingLineId, setPendingLineId] = useState<string | null>(null);
  const [rejections, setRejections] = useState<Record<string, string>>({});
  const [lastSuccess, setLastSuccess] = useState<CheckInSuccess | null>(null);

  const stayDate = currentStayDate();

  const loadBooking = useCallback(async (identifier: string) => {
    const trimmed = identifier.trim();
    if (!trimmed) {
      setLoadError("Select or enter the booking for the stay you are checking in.");
      setLoadedBooking(null);
      setLines([]);
      return;
    }

    setLoading(true);
    setLoadError(null);
    setRejections({});
    setLastSuccess(null);

    try {
      const response = await fetch(`${API_BASE}/bookings/${encodeURIComponent(trimmed)}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const failure = parseCheckInFailure(response.status, payload);
        setLoadError(describeCheckInRejection(failure));
        setLoadedBooking(null);
        setLines([]);
        return;
      }
      const detail = (payload as { data?: BookingDetailPayload }).data;
      if (!detail) {
        setLoadError("Booking detail could not be read.");
        setLoadedBooking(null);
        setLines([]);
        return;
      }
      setLoadedBooking(detail);
      setLines(detail.lines ?? []);
    } catch {
      setLoadError("Unable to reach the booking service.");
      setLoadedBooking(null);
      setLines([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSelect = useCallback(
    (identifier: string, nextLabel: string) => {
      select(identifier, nextLabel);
    },
    [select],
  );

  useEffect(() => {
    if (booking) void loadBooking(booking);
  }, [booking, loadBooking]);

  // Clear stale per-line rejections and the previous success banner only when a
  // different booking is loaded — not after a check-in, so the success message
  // and its next step stay on screen (they used to be wiped by a `lines` effect).
  useEffect(() => {
    setRejections({});
    setLastSuccess(null);
  }, [loadedBooking?.bookingId]);

  const handleCheckIn = useCallback(
    async (line: CheckInLine) => {
      if (!loadedBooking) return;

      setPendingLineId(line.lineId);
      setRejections((previous) => {
        const next = { ...previous };
        delete next[line.lineId];
        return next;
      });

      try {
        const response = await fetch(
          `${API_BASE}${checkInRequestPath(loadedBooking.bookingRef || loadedBooking.bookingId, line.lineId)}`,
          { method: "POST", headers: { "Content-Type": "application/json" } }
        );
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          const failure = parseCheckInFailure(response.status, payload);
          setRejections((previous) => ({
            ...previous,
            [line.lineId]: describeCheckInRejection(failure),
          }));
          return;
        }

        const success = payload as CheckInSuccess;
        setLines((previous) => applyCheckInSuccess(previous, success));
        setLastSuccess(success);
      } catch {
        setRejections((previous) => ({
          ...previous,
          [line.lineId]: "Check-in could not reach the server. Retry the request.",
        }));
      } finally {
        setPendingLineId(null);
      }
    },
    [loadedBooking]
  );

  const states = lines.map((line) => evaluateLineForCheckIn(line, stayDate));
  const counts = lineStatusCounts(lines);

  return (
      <PageContainer>
        <BoundedContainer>
          <div className="space-y-6">
            <header>
              <h1 className="text-2xl font-bold tracking-tight">Guest Check-In</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Check in one room at a time. Other rooms of the same booking stay BOOKED until their own
                check-in.
              </p>
            </header>

            <BillingFlowNav current={FLOW_PATH} booking={booking} label={label} />

            <Card className="shadow-md">
              <CardHeader className="p-4 md:p-5">
                <CardTitle className="text-lg tracking-tight">Booking</CardTitle>
              </CardHeader>
              <CardContent className="p-4 md:p-5 pt-0 space-y-3">
                <BookingFinder
                  onSelect={handleSelect}
                  selectedLabel={label ?? null}
                  busy={loading}
                  searchLabel="Search bookings by reference or guest name"
                  allowReference={false}
                />
                {loadError ? (
                  <p role="alert" className="text-sm text-destructive">
                    {loadError}
                  </p>
                ) : null}
              </CardContent>
            </Card>

            {loadedBooking ? (
              <>
                <section className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {loadedBooking.guest?.fullName ?? "Guest"}
                  </span>
                  <span>Reference {loadedBooking.bookingRef}</span>
                  <span>{counts.BOOKED} booked</span>
                  <span>{counts.CHECKED_IN} checked in</span>
                  <span>{counts.CHECKED_OUT} checked out</span>
                </section>

                {lastSuccess ? (
                  <NextStepCard
                    tone="success"
                    title="Room checked in"
                    description="The guest is admitted. Continue to the invoice when the stay is ready to settle."
                    actions={[
                      { label: "View invoice", to: "/dashboard/billing/invoice" },
                      { label: "Go to checkout", to: "/dashboard/billing/checkout", variant: "outline" },
                    ]}
                    booking={booking}
                    label={label}
                  />
                ) : null}

                <LineCheckInPanel
                  lines={lines}
                  states={states}
                  pendingLineId={pendingLineId}
                  rejections={rejections}
                  onCheckIn={handleCheckIn}
                />
              </>
            ) : null}
          </div>
        </BoundedContainer>
      </PageContainer>
  );
}