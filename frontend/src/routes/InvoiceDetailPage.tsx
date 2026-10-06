import { useCallback, useState } from "react";

import { InvoiceDetailPanel } from "@/components/billing/InvoiceDetailPanel";
import { AppShell } from "@/components/layout/AppShell";
import { BoundedContainer } from "@/components/layout/BoundedContainer";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  InvoiceDetailView,
  buildInvoiceDetailView,
  describeInvoiceError,
  fetchInvoiceDetail,
} from "@/lib/invoiceViewModel";

const API_BASE = "http://localhost:4000/api";

/**
 * M4-S13: Invoice detail page.
 *
 * Staff look up a booking by UUID and view the DRAFT or FINAL invoice,
 * with per-room line breakdown, booking-wide charges and consolidated totals.
 * Role-scope enforcement is performed by the backend (M4-S06); this page
 * forwards the staff identity headers so the API can apply branch guards.
 */
export default function InvoiceDetailPage() {
  const [bookingId, setBookingId] = useState<string>("");
  const [invoice, setInvoice] = useState<InvoiceDetailView | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const loadInvoice = useCallback(async () => {
    const trimmed = bookingId.trim();
    if (!trimmed) {
      setError("Enter a booking UUID to load the invoice.");
      setInvoice(null);
      return;
    }

    setLoading(true);
    setError(null);
    setInvoice(null);

    /**
     * In the real integration, the staff identity is provided via
     * authentication middleware (e.g. JWT) and forwarded automatically.
     * For the current demo setup, headers can be added here when a session
     * context is available. See M1-S08 for the auth implementation.
     *
     * For role-scope testing, pass x-user-id / x-role / x-branch-id headers
     * as the backend verifyBookingAccess enforces branch tenancy (M4-S06).
     */
    const result = await fetchInvoiceDetail({ bookingId: trimmed, apiBase: API_BASE });

    setLoading(false);

    if (!result.ok) {
      setError(describeInvoiceError(result));
      return;
    }

    setInvoice(buildInvoiceDetailView(result.data));
  }, [bookingId]);

  return (
    <AppShell>
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

            {/* Booking lookup form */}
            <Card className="shadow-md" id="invoice-lookup-card">
              <CardHeader className="p-4 md:p-5">
                <CardTitle className="text-lg tracking-tight">Look up booking invoice</CardTitle>
              </CardHeader>
              <CardContent className="p-4 md:p-5 pt-0 space-y-3">
                <div className="flex flex-col md:flex-row md:items-end gap-3">
                  <div className="flex-1 space-y-1.5">
                    <Label htmlFor="invoice-booking-id">Booking UUID</Label>
                    <Input
                      id="invoice-booking-id"
                      value={bookingId}
                      placeholder="e.g. 01930000-0000-0000-0000-000000000001"
                      onChange={(e) => setBookingId(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") loadInvoice();
                      }}
                    />
                  </div>
                  <Button
                    id="invoice-load-btn"
                    onClick={loadInvoice}
                    disabled={loading}
                  >
                    {loading ? "Loading…" : "Load invoice"}
                  </Button>
                </div>
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
          </div>
        </BoundedContainer>
      </PageContainer>
    </AppShell>
  );
}
