import { useCallback, useEffect, useState } from "react";

import { BookingFinder } from "@/components/bookings/BookingFinder";
import { BillingFlowNav } from "@/components/billing/BillingFlowNav";
import { InvoiceDetailPanel } from "@/components/billing/InvoiceDetailPanel";
import { NextStepCard } from "@/components/billing/NextStepCard";
import { BoundedContainer } from "@/components/layout/BoundedContainer";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useBillingBooking } from "@/lib/billingFlow";
import {
  InvoiceDetailView,
  buildInvoiceDetailView,
  describeInvoiceError,
  fetchInvoiceDetail,
} from "@/lib/invoiceViewModel";

const API_BASE = "/api";
const FLOW_PATH = "/dashboard/billing/invoice" as const;

/**
 * M4-S13: Invoice detail page.
 *
 * Staff find a booking through the shared booking finder (branch list for
 * FRONT_DESK, booking reference otherwise) and view the DRAFT or FINAL invoice,
 * with per-room line breakdown, booking-wide charges and consolidated totals.
 * The selected booking travels in the URL, so the page auto-loads when staff
 * move here from check-in, payments or checkout, and the totals card offers the
 * logical next step instead of a dead end.
 * Role-scope enforcement is performed by the backend (M4-S06); this page sends
 * the same-origin session cookie so the API can apply branch guards.
 */
export default function InvoiceDetailPage() {
  const { booking, label, select } = useBillingBooking(FLOW_PATH);
  const [invoice, setInvoice] = useState<InvoiceDetailView | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const loadInvoice = useCallback(async (identifier: string) => {
    const trimmed = identifier.trim();
    if (!trimmed) {
      setError("Select or enter a booking to load its invoice.");
      setInvoice(null);
      return;
    }

    setLoading(true);
    setError(null);
    setInvoice(null);

    // The verified HTTP-only session supplies identity and branch scope.
    const result = await fetchInvoiceDetail({ bookingId: trimmed, apiBase: API_BASE });

    setLoading(false);

    if (!result.ok) {
      setError(describeInvoiceError(result));
      return;
    }

    setInvoice(buildInvoiceDetailView(result.data));
  }, []);

  useEffect(() => {
    if (booking) void loadInvoice(booking);
  }, [booking, loadInvoice]);

  const handleSelect = useCallback(
    (identifier: string, nextLabel: string) => {
      select(identifier, nextLabel);
    },
    [select],
  );

  return (
      <PageContainer>
        <BoundedContainer>
          <div className="space-y-6">
            {/* Page header */}
            <header>
              <h1 className="text-2xl font-bold tracking-tight">Invoice Detail</h1>
              <p className="text-sm text-muted-foreground mt-1">
                View a booking's DRAFT provisional invoice or finalized FINAL invoice, including
                per-room line charges, booking-wide fees, and consolidated payment totals.
              </p>
            </header>

            <BillingFlowNav current={FLOW_PATH} booking={booking} label={label} />

            {/* Booking lookup form */}
            <Card className="shadow-md" id="invoice-lookup-card">
              <CardHeader className="p-4 md:p-5">
                <CardTitle className="text-lg tracking-tight">Find a booking</CardTitle>
              </CardHeader>
              <CardContent className="p-4 md:p-5 pt-0 space-y-3">
                <BookingFinder
                  onSelect={handleSelect}
                  selectedLabel={label ?? null}
                  busy={loading}
                  searchLabel="Search bookings by reference or guest name"
                />
                <p className="text-xs text-muted-foreground tracking-tight">
                  The backend enforces branch-scoped access. Front desk and branch managers
                  may only view invoices for their own branch. Chain-wide roles (Chain Manager,
                  System Administrator, Auditor) have universal read access.
                </p>
              </CardContent>
            </Card>

            {/* Error state */}
            {error && (
              <Card className="shadow-md border-destructive" id="invoice-error-card">
                <CardContent className="p-4 text-sm text-destructive">
                  {error}
                </CardContent>
              </Card>
            )}

            {/* Invoice detail panel */}
            {invoice && (
              <section id="invoice-detail-section">
                <InvoiceDetailPanel invoice={invoice} />
              </section>
            )}

            {/* Guided next step */}
            {invoice ? (
              invoice.summary.isCredit ? (
                <NextStepCard
                  tone="warning"
                  title={`Unrefunded credit ${invoice.summary.creditAmountFormatted}`}
                  description="A credit must be refunded before any room can be checked out."
                  actions={[
                    { label: 'Refund the credit', to: '/dashboard/billing/payments' },
                    { label: 'Go to checkout', to: '/dashboard/billing/checkout', variant: 'outline' },
                  ]}
                  booking={booking}
                  label={label}
                />
              ) : invoice.summary.isSettled ? (
                <NextStepCard
                  tone={invoice.isProvisional ? 'success' : 'info'}
                  title={
                    invoice.isProvisional
                      ? 'Balance settled — ready to check out'
                      : 'Invoice finalized'
                  }
                  description={
                    invoice.isProvisional
                      ? 'No outstanding balance. The rooms can now be released.'
                      : 'Every line is terminal and the balance is zero. No further changes are accepted.'
                  }
                  actions={[
                    { label: 'Go to checkout', to: '/dashboard/billing/checkout' },
                    { label: 'View payments', to: '/dashboard/billing/payments', variant: 'outline' },
                  ]}
                  booking={booking}
                  label={label}
                />
              ) : (
                <NextStepCard
                  tone="warning"
                  title={`Outstanding balance ${invoice.summary.outstandingBalanceFormatted}`}
                  description="Record a payment to clear the balance before the rooms can be checked out."
                  actions={[
                    { label: 'Record a payment', to: '/dashboard/billing/payments' },
                    { label: 'Go to checkout', to: '/dashboard/billing/checkout', variant: 'outline' },
                  ]}
                  booking={booking}
                  label={label}
                />
              )
            ) : null}
          </div>
        </BoundedContainer>
      </PageContainer>
  );
}
