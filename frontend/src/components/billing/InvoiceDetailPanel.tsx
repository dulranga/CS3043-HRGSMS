import {
  AlertTriangle,
  BedDouble,
  CheckCircle,
  CreditCard,
  FileText,
  MinusCircle,
  PlusCircle,
  ReceiptText,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  InvoiceDetailView,
  InvoiceLineView,
} from "@/lib/invoiceViewModel";

// ─── Status badge helper ─────────────────────────────────────────────────────

function InvoiceStatusBadge({ isProvisional, invoiceNumber }: { isProvisional: boolean; invoiceNumber: string | null }) {
  if (isProvisional) {
    return (
      <Badge variant="secondary" className="gap-1.5">
        <FileText className="size-3" aria-hidden="true" />
        PROVISIONAL
      </Badge>
    );
  }
  return (
    <Badge variant="default" className="gap-1.5">
      <CheckCircle className="size-3" aria-hidden="true" />
      {invoiceNumber ?? "FINAL"}
    </Badge>
  );
}

// ─── Single line row ─────────────────────────────────────────────────────────

function InvoiceLineRow({ line }: { line: InvoiceLineView }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-border last:border-0">
      <div className="flex items-center gap-2 min-w-0">
        {line.isDeduction ? (
          <MinusCircle className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <PlusCircle className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium tracking-tight truncate">{line.description}</p>
          <p className="text-xs text-muted-foreground">{line.typeLabel}</p>
        </div>
      </div>
      <span
        className={[
          "text-sm font-semibold tabular-nums shrink-0 tracking-tight",
          line.isDeduction ? "text-destructive" : "text-foreground",
        ].join(" ")}
      >
        {line.isDeduction ? "−" : ""}{line.amountFormatted}
      </span>
    </div>
  );
}

// ─── Per-room section ────────────────────────────────────────────────────────

function RoomLinesSection({
  roomLineId,
  lines,
  subtotalFormatted,
  index,
}: {
  roomLineId: string;
  lines: InvoiceLineView[];
  subtotalFormatted: string;
  index: number;
}) {
  return (
    <Card className="shadow-md">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-base tracking-tight flex items-center gap-2">
          <BedDouble className="size-4" aria-hidden="true" />
          Room Line {index + 1}
          <span className="text-xs font-normal text-muted-foreground font-mono">
            {roomLineId.slice(0, 8)}…
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="space-y-0">
          {lines.map((line) => (
            <InvoiceLineRow key={line.id} line={line} />
          ))}
        </div>
        {lines.length > 1 && (
          <div className="flex justify-between items-center pt-2 mt-1 border-t-2 border-border">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
              Room subtotal
            </span>
            <span className="text-sm font-bold tabular-nums tracking-tight">{subtotalFormatted}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Booking-wide charges section ────────────────────────────────────────────

function BookingWideLinesSection({ lines }: { lines: InvoiceLineView[] }) {
  if (lines.length === 0) return null;
  return (
    <Card className="shadow-md">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-base tracking-tight flex items-center gap-2">
          <ReceiptText className="size-4" aria-hidden="true" />
          Booking-Wide Charges
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="space-y-0">
          {lines.map((line) => (
            <InvoiceLineRow key={line.id} line={line} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Totals summary card ─────────────────────────────────────────────────────

function InvoiceSummaryCard({ invoice }: { invoice: InvoiceDetailView }) {
  const { summary, isProvisional, invoiceNumber, issuedAt } = invoice;

  return (
    <Card className="shadow-md border-2">
      <CardHeader className="p-4 pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base tracking-tight flex items-center gap-2">
            <CreditCard className="size-4" aria-hidden="true" />
            Consolidated Totals
          </CardTitle>
          <InvoiceStatusBadge isProvisional={isProvisional} invoiceNumber={invoiceNumber} />
        </div>
        {issuedAt && (
          <p className="text-xs text-muted-foreground mt-1">
            Issued {new Date(issuedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
          </p>
        )}
        {isProvisional && (
          <p className="text-xs text-muted-foreground mt-1">
            Provisional — will be finalized once all room lines are settled.
          </p>
        )}
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="space-y-2">
          {/* Invoice total */}
          <div className="flex justify-between items-center py-1.5 border-b border-border">
            <span className="text-sm text-muted-foreground">Invoice total</span>
            <span className="text-sm font-semibold tabular-nums">{summary.totalAmountFormatted}</span>
          </div>

          {/* Net payments made */}
          <div className="flex justify-between items-center py-1.5 border-b border-border">
            <span className="text-sm text-muted-foreground">
              Net payments ({summary.successfulPayments} payment{summary.successfulPayments !== 1 ? "s" : ""}
              {summary.successfulRefunds > 0 ? `, ${summary.successfulRefunds} refund${summary.successfulRefunds !== 1 ? "s" : ""}` : ""})
            </span>
            <span className="text-sm font-semibold tabular-nums text-foreground">
              {summary.netPaymentsFormatted}
            </span>
          </div>

          {/* Balance or credit */}
          <div className="flex justify-between items-center py-2">
            {summary.isCredit ? (
              <>
                <span className="text-sm font-semibold text-destructive flex items-center gap-1.5">
                  <AlertTriangle className="size-3.5" aria-hidden="true" />
                  Unrefunded credit
                </span>
                <span className="text-base font-bold tabular-nums text-destructive">
                  {summary.creditAmountFormatted}
                </span>
              </>
            ) : summary.isSettled ? (
              <>
                <span className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                  <CheckCircle className="size-3.5" aria-hidden="true" />
                  Settled — balance due
                </span>
                <span className="text-base font-bold tabular-nums">LKR 0.00</span>
              </>
            ) : (
              <>
                <span className="text-sm font-semibold text-foreground">Outstanding balance</span>
                <span className="text-base font-bold tabular-nums">
                  {summary.outstandingBalanceFormatted}
                </span>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export interface InvoiceDetailPanelProps {
  invoice: InvoiceDetailView;
}

export function InvoiceDetailPanel({ invoice }: InvoiceDetailPanelProps) {
  const hasRoomLines = invoice.roomLines.length > 0;
  const hasBookingWide = invoice.bookingWideLines.length > 0;
  const isEmpty = !hasRoomLines && !hasBookingWide;

  return (
    <div className="space-y-4">
      {/* Invoice meta header */}
      <div className="flex flex-wrap items-center gap-2">
        <InvoiceStatusBadge isProvisional={invoice.isProvisional} invoiceNumber={invoice.invoiceNumber} />
        <span className="text-xs text-muted-foreground font-mono">
          {invoice.invoiceId.slice(0, 8)}…
        </span>
        <span className="text-xs text-muted-foreground">
          Created {new Date(invoice.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
        </span>
      </div>

      {isEmpty && (
        <Card className="shadow-md">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            No invoice lines yet. Invoice will be populated once a checkout or cancellation occurs.
          </CardContent>
        </Card>
      )}

      {/* Per-room line sections */}
      {invoice.roomLines.map((group, idx) => (
        <RoomLinesSection
          key={group.roomLineId}
          roomLineId={group.roomLineId}
          lines={group.lines}
          subtotalFormatted={group.subtotalFormatted}
          index={idx}
        />
      ))}

      {/* Booking-wide charges (fees, discounts, tax, adjustments) */}
      {hasBookingWide && <BookingWideLinesSection lines={invoice.bookingWideLines} />}

      {/* Consolidated totals */}
      <InvoiceSummaryCard invoice={invoice} />
    </div>
  );
}
