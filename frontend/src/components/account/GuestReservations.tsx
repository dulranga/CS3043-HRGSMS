import * as React from "react";
import { ChevronDown, ChevronUp, CircleAlert, LoaderCircle, ReceiptText } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import {
  GuestBookingError,
  getOwnBookingDetail,
  getOwnInvoice,
  getOwnPayments,
  listOwnBookings,
  type BookingChannel,
  type BookingInvoice,
  type BookingLineStatus,
  type BookingPayments,
  type GuestBookingDetail,
  type GuestBookingSummary,
  type Numeric,
  type RoomLineSummary,
} from "@/lib/guestBookings";

// M1-S18 guest account reservations summary. It links Member 2's own-booking
// reads and Member 4's invoice/payment reads into the profile page without
// duplicating their screens. The server derives the guest from the session, so
// this component only ever requests bookings from the guest's own list.

type BadgeVariant = "default" | "secondary" | "outline" | "muted" | "destructive";

const CHANNEL_LABELS: Record<BookingChannel, string> = {
  DIRECT_ONLINE: "Online",
  FRONT_DESK: "Front desk",
  PHONE: "Phone",
  EMAIL: "Email",
};

const STATUS_LABELS: Record<BookingLineStatus, string> = {
  BOOKED: "Booked",
  CHECKED_IN: "Checked in",
  CHECKED_OUT: "Checked out",
  CANCELLED: "Cancelled",
  NO_SHOW: "No-show",
};

const STATUS_VARIANTS: Record<BookingLineStatus, BadgeVariant> = {
  BOOKED: "default",
  CHECKED_IN: "secondary",
  CHECKED_OUT: "outline",
  CANCELLED: "muted",
  NO_SHOW: "destructive",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function formatMoney(value: Numeric): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return `LKR ${amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function detailErrorMessage(error: unknown): string {
  if (error instanceof GuestBookingError) {
    if (error.code === "AUTHENTICATION_REQUIRED") return "Your session has ended. Please sign in again.";
    if (error.code === "FORBIDDEN") return "You do not have access to this booking.";
    if (error.code === "BOOKING_NOT_FOUND") return "This booking could not be found.";
    return error.message;
  }
  return "Could not load this booking. Please try again.";
}

function StatusBadges({ summary }: { summary: RoomLineSummary }) {
  const badges: Array<{ key: string; label: string; variant: BadgeVariant }> = [];
  if (summary.booked > 0) badges.push({ key: "booked", label: `${summary.booked} booked`, variant: "default" });
  if (summary.checkedIn > 0)
    badges.push({ key: "checkedIn", label: `${summary.checkedIn} checked in`, variant: "secondary" });
  if (summary.checkedOut > 0)
    badges.push({ key: "checkedOut", label: `${summary.checkedOut} checked out`, variant: "outline" });
  if (summary.cancelled > 0)
    badges.push({ key: "cancelled", label: `${summary.cancelled} cancelled`, variant: "muted" });
  if (summary.noShow > 0)
    badges.push({ key: "noShow", label: `${summary.noShow} no-show`, variant: "destructive" });

  if (badges.length === 0) return <span className="text-sm text-muted-foreground">—</span>;
  return (
    <>
      {badges.map((badge) => (
        <Badge key={badge.key} variant={badge.variant}>
          {badge.label}
        </Badge>
      ))}
    </>
  );
}

function BillingSummary({
  invoice,
  payments,
}: {
  invoice: BookingInvoice | null;
  payments: BookingPayments | null;
}) {
  const paymentRows = payments?.payments ?? [];
  if (!invoice && paymentRows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No invoice or payments have been recorded for this booking yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Billing</h3>
      {invoice && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Invoice total</dt>
            <dd className="mt-0.5 text-sm">{formatMoney(invoice.summary.total_amount)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Paid</dt>
            <dd className="mt-0.5 text-sm">{formatMoney(invoice.summary.net_payments)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Balance</dt>
            <dd className="mt-0.5 text-sm font-semibold">{formatMoney(invoice.summary.outstanding_balance)}</dd>
          </div>
        </dl>
      )}
      {invoice?.is_provisional && (
        <p className="text-xs text-muted-foreground">
          This invoice is provisional and may change until your stay is complete.
        </p>
      )}
      {paymentRows.length > 0 && (
        <ul className="space-y-2">
          {paymentRows.map((payment) => (
            <li
              key={payment.payment_id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 border-border/70 p-3"
            >
              <div>
                <p className="text-sm font-medium">
                  {payment.kind === "REFUND" ? "Refund" : "Payment"} ·{" "}
                  {payment.method === "CASH" ? "Cash" : "Bank transfer"}
                  {payment.status !== "SUCCESSFUL" && ` · ${payment.status.toLowerCase()}`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(payment.paid_at)} · Ref {payment.reference}
                </p>
              </div>
              <span className="text-sm font-semibold">{formatMoney(payment.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BookingDetail({
  detail,
  invoice,
  payments,
}: {
  detail: GuestBookingDetail;
  invoice: BookingInvoice | null;
  payments: BookingPayments | null;
}) {
  return (
    <div className="space-y-4 border-t border-border pt-4">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Rooms</h3>
        <ul className="space-y-2">
          {detail.lines.map((line) => {
            const current =
              line.assignments.find((assignment) => assignment.current) ??
              line.assignments[line.assignments.length - 1];
            return (
              <li key={line.lineId} className="rounded-xl border-2 border-border/70 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">
                      {current ? `${current.roomType.name} · Room ${current.roomNumber}` : "Room not assigned"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(line.checkIn)} → {formatDate(line.checkOut)} · {line.guestCount}{" "}
                      {line.guestCount === 1 ? "guest" : "guests"} · {formatMoney(line.rateSnapshot)}/night
                    </p>
                  </div>
                  <Badge variant={STATUS_VARIANTS[line.status]}>{STATUS_LABELS[line.status]}</Badge>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      <BillingSummary invoice={invoice} payments={payments} />
    </div>
  );
}

export function GuestReservations() {
  const [bookings, setBookings] = React.useState<GuestBookingSummary[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [listError, setListError] = React.useState<string | null>(null);

  const [openId, setOpenId] = React.useState<string | null>(null);
  const [detailById, setDetailById] = React.useState<Record<string, GuestBookingDetail>>({});
  const [invoiceById, setInvoiceById] = React.useState<Record<string, BookingInvoice | null>>({});
  const [paymentsById, setPaymentsById] = React.useState<Record<string, BookingPayments>>({});
  const [detailLoadingId, setDetailLoadingId] = React.useState<string | null>(null);
  const [detailErrorById, setDetailErrorById] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setListError(null);
    listOwnBookings()
      .then((items) => {
        if (!cancelled) setBookings(items);
      })
      .catch((error) => {
        if (!cancelled) {
          setListError(
            error instanceof GuestBookingError && error.code !== "NETWORK_ERROR"
              ? error.message
              : "Could not load your reservations. Please try again.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(bookingId: string) {
    if (openId === bookingId) {
      setOpenId(null);
      return;
    }
    setOpenId(bookingId);
    if (detailById[bookingId]) return;

    setDetailLoadingId(bookingId);
    setDetailErrorById((prev) => {
      const next = { ...prev };
      delete next[bookingId];
      return next;
    });
    try {
      const [detail, invoice, payments] = await Promise.all([
        getOwnBookingDetail(bookingId),
        getOwnInvoice(bookingId).catch((error) => {
          if (error instanceof GuestBookingError && error.code === "INVOICE_NOT_FOUND") return null;
          throw error;
        }),
        getOwnPayments(bookingId),
      ]);
      setDetailById((prev) => ({ ...prev, [bookingId]: detail }));
      setInvoiceById((prev) => ({ ...prev, [bookingId]: invoice }));
      setPaymentsById((prev) => ({ ...prev, [bookingId]: payments }));
    } catch (error) {
      setDetailErrorById((prev) => ({ ...prev, [bookingId]: detailErrorMessage(error) }));
    } finally {
      setDetailLoadingId(null);
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="animate-spin" aria-hidden="true" /> Loading your reservations…
      </p>
    );
  }

  if (listError) {
    return (
      <Alert variant="destructive" className="max-w-lg">
        <CircleAlert aria-hidden="true" />
        <div>
          <AlertTitle>Could not load your reservations</AlertTitle>
          <AlertDescription>{listError}</AlertDescription>
        </div>
      </Alert>
    );
  }

  if (!bookings || bookings.length === 0) {
    return (
      <Card className="hover:shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ReceiptText className="size-4 text-accent" aria-hidden="true" />
            No reservations yet
          </CardTitle>
          <CardDescription>
            Bookings made with your guest account will appear here with their room lines and payment history.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {bookings.map((booking) => {
        const open = openId === booking.bookingId;
        const detail = detailById[booking.bookingId];
        const invoice = invoiceById[booking.bookingId];
        const payments = paymentsById[booking.bookingId];
        const detailError = detailErrorById[booking.bookingId];
        return (
          <Card key={booking.bookingId} className="hover:shadow-md">
            <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle className="text-base">{booking.bookingRef}</CardTitle>
                <CardDescription>
                  {CHANNEL_LABELS[booking.bookingChannel]} booking · {formatDate(booking.createdAt)}
                </CardDescription>
              </div>
              <Badge variant="outline">
                {booking.lineSummary.total} {booking.lineSummary.total === 1 ? "room" : "rooms"}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stay</dt>
                  <dd className="mt-0.5 text-sm">
                    {formatDate(booking.lineSummary.firstStayDate)} → {formatDate(booking.lineSummary.lastStayDate)}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</dt>
                  <dd className="mt-1 flex flex-wrap gap-1.5">
                    <StatusBadges summary={booking.lineSummary} />
                  </dd>
                </div>
              </dl>

              {open &&
                (detailLoadingId === booking.bookingId ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <LoaderCircle className="animate-spin" aria-hidden="true" /> Loading booking details…
                  </p>
                ) : detailError ? (
                  <Alert variant="destructive">
                    <CircleAlert aria-hidden="true" />
                    <div>
                      <AlertTitle>Could not load this booking</AlertTitle>
                      <AlertDescription>{detailError}</AlertDescription>
                    </div>
                  </Alert>
                ) : detail ? (
                  <BookingDetail detail={detail} invoice={invoice ?? null} payments={payments ?? null} />
                ) : null)}
            </CardContent>
            <CardFooter className="justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-expanded={open}
                onClick={() => void toggle(booking.bookingId)}
              >
                {open ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                {open ? "Hide details" : "View details"}
              </Button>
              {open && invoice && (
                <span className="text-sm text-muted-foreground">
                  Balance{" "}
                  <span className="font-semibold text-foreground">
                    {formatMoney(invoice.summary.outstanding_balance)}
                  </span>
                </span>
              )}
            </CardFooter>
          </Card>
        );
      })}
    </div>
  );
}
