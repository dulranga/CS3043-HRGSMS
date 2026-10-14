import { Fragment, type ReactNode } from "react";
import {
  AlertTriangle,
  BedDouble,
  CheckCircle,
  CreditCard,
  FileText,
  Hotel,
  MinusCircle,
  PlusCircle,
  ReceiptText,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { InvoiceDetailView, InvoiceLineView } from "@/lib/invoiceViewModel";

// ─── Formatting helpers ──────────────────────────────────────────────────────

function formatInvoiceDate(date: Date | null): string | null {
  return date
    ? date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : null;
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function InvoiceStatusBadge({ isProvisional }: { isProvisional: boolean }) {
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
      FINAL
    </Badge>
  );
}

// ─── Document meta entry ──────────────────────────────────────────────────────

function InvoiceMetaItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "break-all text-sm font-medium",
          mono && "font-mono text-xs tracking-wide",
        )}
      >
        {value}
      </p>
    </div>
  );
}

// ─── Line item row ───────────────────────────────────────────────────────────

function InvoiceLineRow({ line }: { line: InvoiceLineView }) {
  return (
    <TableRow>
      <TableCell className="px-5 py-2.5 md:px-6">
        <div className="flex min-w-0 items-center gap-2">
          {line.isDeduction ? (
            <MinusCircle
              className="size-3.5 shrink-0 text-destructive"
              aria-hidden="true"
            />
          ) : (
            <PlusCircle
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          )}
          <span className="min-w-0 truncate text-sm font-medium tracking-tight">
            {line.description}
          </span>
        </div>
      </TableCell>
      <TableCell className="hidden px-4 py-2.5 text-xs text-muted-foreground md:table-cell">
        {line.typeLabel}
      </TableCell>
      <TableCell className="px-5 py-2.5 text-right md:px-6">
        <span
          className={cn(
            "text-sm font-semibold tabular-nums tracking-tight",
            line.isDeduction && "text-destructive",
          )}
        >
          {line.isDeduction ? "−" : ""}
          {line.amountFormatted}
        </span>
      </TableCell>
    </TableRow>
  );
}

// ─── Group header row (per-room / booking-wide) ───────────────────────────────

function GroupHeaderRow({
  icon,
  title,
  detail,
}: {
  icon: ReactNode;
  title: string;
  detail?: string;
}) {
  return (
    <TableRow className="bg-muted/50 hover:bg-muted/50">
      <TableCell colSpan={3} className="px-5 py-2 md:px-6">
        <div className="flex flex-wrap items-center gap-2">
          {icon}
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {title}
          </span>
          {detail && (
            <span className="break-all font-mono text-[10px] tracking-wide text-muted-foreground/70">
              {detail}
            </span>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

// ─── Group subtotal row ───────────────────────────────────────────────────────

function SubtotalRow({ label, amount }: { label: string; amount: string }) {
  return (
    <TableRow>
      <TableCell colSpan={2} className="px-5 py-2 text-right md:px-6">
        <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
      </TableCell>
      <TableCell className="px-5 py-2 text-right md:px-6">
        <span className="text-sm font-bold tabular-nums tracking-tight">{amount}</span>
      </TableCell>
    </TableRow>
  );
}

// ─── Balance box ──────────────────────────────────────────────────────────────

function BalanceBox({ invoice }: { invoice: InvoiceDetailView }) {
  const { summary } = invoice;

  if (summary.isCredit) {
    return (
      <div className="mt-3 flex items-center justify-between gap-4 rounded-lg border-2 border-destructive/40 bg-destructive/10 px-4 py-3">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
          <AlertTriangle className="size-3.5" aria-hidden="true" />
          Unrefunded credit
        </span>
        <span className="text-base font-bold tabular-nums text-destructive">
          {summary.creditAmountFormatted}
        </span>
      </div>
    );
  }

  if (summary.isSettled) {
    return (
      <div className="mt-3 flex items-center justify-between gap-4 rounded-lg border-2 border-border bg-secondary px-4 py-3">
        <span className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
          <CheckCircle className="size-3.5 text-muted-foreground" aria-hidden="true" />
          Balance due — settled
        </span>
        <span className="text-base font-bold tabular-nums">
          {summary.outstandingBalanceFormatted}
        </span>
      </div>
    );
  }

  return (
    <div className="mt-3 flex items-center justify-between gap-4 rounded-lg border-2 border-border bg-secondary px-4 py-3">
      <span className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
        <CreditCard className="size-3.5 text-muted-foreground" aria-hidden="true" />
        Balance due
      </span>
      <span className="text-base font-bold tabular-nums">
        {summary.outstandingBalanceFormatted}
      </span>
    </div>
  );
}

// ─── Main panel: a single invoice document ───────────────────────────────────

export interface InvoiceDetailPanelProps {
  invoice: InvoiceDetailView;
}

export function InvoiceDetailPanel({ invoice }: InvoiceDetailPanelProps) {
  const { summary, isProvisional, invoiceNumber, issuedAt, createdAt, bookingId, invoiceId, status } =
    invoice;
  const hasBookingWide = invoice.bookingWideLines.length > 0;
  const isEmpty = invoice.roomLines.length === 0 && !hasBookingWide;
  const created = formatInvoiceDate(createdAt);
  const issued = formatInvoiceDate(issuedAt);

  return (
    <Card id="invoice-document" className="shadow-lg">
      <CardContent className="p-0">
        {/* Document header — SkyNest brand left, document identity right */}
        <div className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-border p-5 md:p-6">
          <div className="flex items-center gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Hotel className="size-6" aria-hidden="true" />
            </div>
            <div>
              <p className="font-display text-lg font-semibold leading-tight tracking-tight">
                SkyNest Hotels
              </p>
              <p className="text-xs text-muted-foreground">Direct hotel booking &amp; reservations</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {isProvisional ? "Provisional statement" : "Invoice"}
            </p>
            <p className="font-display text-2xl font-bold leading-tight tracking-tight">
              {invoiceNumber ?? (isProvisional ? "DRAFT" : status)}
            </p>
            <div className="mt-2 flex justify-end">
              <InvoiceStatusBadge isProvisional={isProvisional} />
            </div>
          </div>
        </div>

        {/* Document meta — booking, invoice ID and dates */}
        <div className="grid grid-cols-2 gap-4 border-b-2 border-border bg-muted/50 p-5 md:grid-cols-4 md:p-6">
          <InvoiceMetaItem label="Booking reference" value={bookingId} mono />
          <InvoiceMetaItem label="Invoice ID" value={invoiceId} mono />
          <InvoiceMetaItem label="Created" value={created ?? "—"} />
          <InvoiceMetaItem label="Issued" value={issued ?? "Pending finalization"} />
        </div>

        {/* Line items table */}
        <Table aria-label="Invoice line items">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-10 px-5 md:px-6">Description</TableHead>
              <TableHead className="hidden h-10 px-4 md:table-cell">Type</TableHead>
              <TableHead className="h-10 px-5 text-right md:px-6">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isEmpty && (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="px-5 py-8 text-center text-sm text-muted-foreground md:px-6"
                >
                  No invoice lines yet. The invoice will be populated once a checkout or
                  cancellation occurs.
                </TableCell>
              </TableRow>
            )}

            {invoice.roomLines.map((group, index) => (
              <Fragment key={group.roomLineId}>
                <GroupHeaderRow
                  icon={<BedDouble className="size-3.5" aria-hidden="true" />}
                  title={`Room line ${index + 1}`}
                  detail={`${group.roomLineId.slice(0, 8)}…`}
                />
                {group.lines.map((line) => (
                  <InvoiceLineRow key={line.id} line={line} />
                ))}
                {group.lines.length > 1 && (
                  <SubtotalRow label="Room subtotal" amount={group.subtotalFormatted} />
                )}
              </Fragment>
            ))}

            {hasBookingWide && (
              <Fragment>
                <GroupHeaderRow
                  icon={<ReceiptText className="size-3.5" aria-hidden="true" />}
                  title="Booking-wide charges"
                />
                {invoice.bookingWideLines.map((line) => (
                  <InvoiceLineRow key={line.id} line={line} />
                ))}
              </Fragment>
            )}
          </TableBody>
        </Table>

        {/* Totals — right-aligned like a paper invoice */}
        <div className="border-t-2 border-border p-5 md:p-6">
          <div className="ml-auto w-full max-w-sm space-y-1">
            <div className="flex items-center justify-between gap-4 border-b border-border py-1.5 text-sm">
              <span className="text-muted-foreground">Invoice total</span>
              <span className="font-semibold tabular-nums">{summary.totalAmountFormatted}</span>
            </div>
            <div className="flex items-center justify-between gap-4 border-b border-border py-1.5 text-sm">
              <span className="min-w-0 text-muted-foreground">
                Net payments ({summary.successfulPayments} payment
                {summary.successfulPayments !== 1 ? "s" : ""}
                {summary.successfulRefunds > 0
                  ? `, ${summary.successfulRefunds} refund${summary.successfulRefunds !== 1 ? "s" : ""}`
                  : ""}
                )
              </span>
              <span className="font-semibold tabular-nums">{summary.netPaymentsFormatted}</span>
            </div>
            <BalanceBox invoice={invoice} />
          </div>
        </div>

        {/* Document footer */}
        <div className="border-t-2 border-border bg-muted/50 p-5 md:p-6">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {isProvisional
              ? "This provisional statement is not a final bill. It becomes the final invoice once every room line is terminal and the consolidated balance is settled."
              : "This invoice is final. Issued invoices are immutable and accept no further changes."}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            SkyNest Hotels · direct guest booking system · all amounts in Sri Lankan rupees (LKR).
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
