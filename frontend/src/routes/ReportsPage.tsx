import { useEffect, useState, useCallback, useRef } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { PageContainer } from "@/components/layout/PageContainer";
import { BoundedContainer } from "@/components/layout/BoundedContainer";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { reportUrl, hasReportAccess, type ReportType } from "@/lib/reportUrl";
import { useFeatureSessions } from "@/components/auth/useFeatureSessions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

interface BranchOption {
  branch_id: string;
  name: string;
}

export default function ReportsPage() {
  const { role, staff } = useFeatureSessions();
  const latestRequest = useRef(0);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [activeReport, setActiveReport] = useState<ReportType>("occupancy");
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [selectedYear, setSelectedYear] = useState<string>(
    new Date().getFullYear().toString(),
  );
  const [bookingRef, setBookingRef] = useState<string>("");
  const [invoiceStatus, setInvoiceStatus] = useState<string>("");
  const [guestSearch, setGuestSearch] = useState<string>("");
  const [minStays, setMinStays] = useState<string>("");
  const [serviceCategory, setServiceCategory] = useState<string>("");
  const [serviceSearch, setServiceSearch] = useState<string>("");

  // Preference trends filters
  const [trendsSortBy, setTrendsSortBy] = useState<"revenue" | "quantity">(
    "revenue",
  );
  const [trendsLimit, setTrendsLimit] = useState<string>("10");

  // Audit filters
  const [auditEntity, setAuditEntity] = useState<string>("");
  const [auditAction, setAuditAction] = useState<string>("");
  const [auditStaffId, setAuditStaffId] = useState<string>("");
  const [auditPage, setAuditPage] = useState<number>(1);

  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const API_BASE = "/api";
  useEffect(() => {
    if (role === 'BRANCH_MANAGER' && staff?.branchId) setSelectedBranch(staff.branchId);
    if (role === 'SYSTEM_ADMINISTRATOR') setActiveReport('audit-logs');
  }, [role, staff?.branchId]);

  // 1. Fetch branches
  useEffect(() => {
    if (!role) return;
    fetch(`${API_BASE}/admin/branches`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch branches");
        return res.json();
      })
      .then((d) => {
        if (Array.isArray(d)) setBranches(d);
        else if (Array.isArray(d?.branches)) setBranches(d.branches);
      })
      .catch((err) => console.error("Error fetching branches:", err));
  }, [role]);

  // 2. Fetch report data
  const loadReportData = useCallback(async () => {
    const request = ++latestRequest.current;
    if (!hasReportAccess(role, activeReport)) {
      setLoading(false);
      setError('Sign in with permission to view this report.');
      setData([]);
      return;
    }
    try {
      setLoading(true);
      setError(null);

      const url = reportUrl(window.location.origin, activeReport, currentFilters());
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
      const reportResponse = await res.json();
      if (request !== latestRequest.current) return;
      setGeneratedAt(new Date().toISOString());

      if (activeReport === "audit-logs") {
        setData(
          reportResponse?.data && Array.isArray(reportResponse.data)
            ? reportResponse.data
            : [],
        );
      } else {
        setData(
          Array.isArray(reportResponse)
            ? reportResponse
            : reportResponse?.rows || [],
        );
      }
    } catch (err) {
      if (request !== latestRequest.current) return;
      console.error("Report loading error:", err);
      setError("Failed to fetch report data. Check server connectivity.");
      setData([]);
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  }, [
    role,
    activeReport,
    selectedBranch,
    selectedYear,
    bookingRef,
    invoiceStatus,
    guestSearch,
    minStays,
    serviceCategory,
    serviceSearch,
    trendsSortBy,
    trendsLimit,
    auditEntity,
    auditAction,
    auditStaffId,
    auditPage,
  ]);

  useEffect(() => {
    void loadReportData();
    return () => { latestRequest.current++; };
  }, [loadReportData]);

  // Both representations use the same current filters and pagination.
  function currentFilters(): Record<string, string> {
    return {
      branch_id: selectedBranch, year: selectedYear, booking_ref: bookingRef, invoice_status: invoiceStatus,
      search: activeReport === 'guest-history' ? guestSearch : serviceSearch,
      min_stays: minStays, category: serviceCategory, by: trendsSortBy,
      limit: activeReport === 'audit-logs' ? '25' : activeReport === 'preference-trends' ? trendsLimit : '50',
      offset: '0', entity_name: auditEntity, action: auditAction, staff_id: auditStaffId, page: String(auditPage),
    };
  }
  const handleExportCsv = () => {
    window.location.href = reportUrl(window.location.origin, activeReport, currentFilters(), true).toString();
  };

  // 4. Change report
  const changeReport = (report: ReportType) => {
    setActiveReport(report);
    setData([]);
    setError(null);
    if (report !== "audit-logs") setAuditPage(1);
  };

  // 5. Clear filters
  const clearFilters = () => {
    setSelectedBranch(role === 'BRANCH_MANAGER' ? staff?.branchId ?? '' : '');
    setBookingRef("");
    setInvoiceStatus("");
    setGuestSearch("");
    setMinStays("");
    setServiceCategory("");
    setServiceSearch("");
    setTrendsSortBy("revenue");
    setTrendsLimit("10");
    setAuditEntity("");
    setAuditAction("");
    setAuditStaffId("");
    setAuditPage(1);
  };

  // Formatters
  const formatColumnName = (col: string) =>
    col.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const formatValue = (v: any) =>
    v === null || v === undefined
      ? "—"
      : typeof v === "boolean"
        ? v
          ? "Yes"
          : "No"
        : String(v);

  const reportTabs: { id: ReportType; label: string }[] = [
    { id: "occupancy", label: "Occupancy Rate" },
    { id: "billing", label: "Billing Summary" },
    { id: "revenue", label: "Revenue Aggregates" },
    { id: "guest-history", label: "Guest Stay History" },
    { id: "service-usage", label: "Service Usage" },
    { id: "preference-trends", label: "Preference Trends" },
    { id: "audit-logs", label: "Audit Logs" },
  ];

  return (
    <AppShell>
      <PageContainer>
        <BoundedContainer>
          <div className="space-y-6">
            {/* Header */}
            <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">
                  Management Reports
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  View performance metrics, billing, occupancy, revenue, guest
                  history, service trends, and audit trails.
                </p>
              </div>
              <Button
                onClick={handleExportCsv}
                disabled={loading || !!error}
                className="self-start md:self-auto gap-2"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Export CSV
              </Button>
            </header>

            {/* Report Tabs */}
            <Tabs
              value={activeReport}
              onValueChange={(value) => changeReport(value as ReportType)}
              className="space-y-6"
            >
              <TabsList className="flex h-auto flex-wrap gap-2" aria-label="Report type">
                {reportTabs.filter(tab => hasReportAccess(role, tab.id)).map((tab) => (
                  <TabsTrigger key={tab.id} value={tab.id}>
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value={activeReport} className="space-y-6">
            {/* Filter Controls */}
            <div className="flex flex-wrap items-end gap-4 p-4 rounded-xl bg-card border border-border">
              {(activeReport === "occupancy" ||
                activeReport === "billing" ||
                activeReport === "revenue") && (
                <div className="flex flex-col gap-1">
                  <Label className="text-xs font-semibold text-muted-foreground">
                    Branch
                  </Label>
                  <select
                    value={selectedBranch}
                    disabled={role === 'BRANCH_MANAGER'}
                    onChange={(e) => setSelectedBranch(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">All Branches</option>
                    {branches.map((b) => (
                      <option key={b.branch_id} value={b.branch_id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {activeReport === "revenue" && (
                <div className="flex flex-col gap-1">
                  <Label className="text-xs font-semibold text-muted-foreground">
                    Year
                  </Label>
                  <select
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {[2024, 2025, 2026, 2027].map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {activeReport === "billing" && (
                <>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs font-semibold text-muted-foreground">
                      Booking Reference
                    </Label>
                    <Input
                      value={bookingRef}
                      onChange={(e) => setBookingRef(e.target.value)}
                      placeholder="Search booking..."
                      className="h-9 w-48 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs font-semibold text-muted-foreground">
                      Invoice Status
                    </Label>
                    <select
                      value={invoiceStatus}
                      onChange={(e) => setInvoiceStatus(e.target.value)}
                      className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="">All Statuses</option>
                      {["DRAFT", "FINAL"].map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {activeReport === "guest-history" && (
                <>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs font-semibold text-muted-foreground">
                      Search Guest
                    </Label>
                    <Input
                      value={guestSearch}
                      onChange={(e) => setGuestSearch(e.target.value)}
                      placeholder="Name, email or phone..."
                      className="h-9 w-56 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs font-semibold text-muted-foreground">
                      Minimum Stays
                    </Label>
                    <Input
                      type="number"
                      min="0"
                      value={minStays}
                      onChange={(e) => setMinStays(e.target.value)}
                      placeholder="e.g. 2"
                      className="h-9 w-32 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                </>
              )}

              {activeReport === "service-usage" && (
                <>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs font-semibold text-muted-foreground">
                      Category
                    </Label>
                    <Input
                      value={serviceCategory}
                      onChange={(e) => setServiceCategory(e.target.value)}
                      placeholder="e.g. Food"
                      className="h-9 w-40 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs font-semibold text-muted-foreground">
                      Service Name
                    </Label>
                    <Input
                      value={serviceSearch}
                      onChange={(e) => setServiceSearch(e.target.value)}
                      placeholder="Search service..."
                      className="h-9 w-48 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                </>
              )}

              {activeReport === "preference-trends" && (
                <>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs font-semibold text-muted-foreground">
                      Rank By
                    </Label>
                    <select
                      value={trendsSortBy}
                      onChange={(e) =>
                        setTrendsSortBy(
                          e.target.value as "revenue" | "quantity",
                        )
                      }
                      className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="revenue">Highest Revenue Generated</option>
                      <option value="quantity">
                        Highest Quantity Consumed
                      </option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs font-semibold text-muted-foreground">
                      Show Top
                    </Label>
                    <select
                      value={trendsLimit}
                      onChange={(e) => setTrendsLimit(e.target.value)}
                      className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="5">Top 5 Services</option>
                      <option value="10">Top 10 Services</option>
                      <option value="20">Top 20 Services</option>
                    </select>
                  </div>
                </>
              )}

              {activeReport === "audit-logs" && (
                <>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs font-semibold text-muted-foreground">
                      Entity
                    </Label>
                    <Input
                      value={auditEntity}
                      onChange={(e) => setAuditEntity(e.target.value)}
                      placeholder="e.g. booking"
                      className="h-9 w-40 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs font-semibold text-muted-foreground">
                      Action
                    </Label>
                    <select
                      value={auditAction}
                      onChange={(e) => {
                        setAuditAction(e.target.value);
                        setAuditPage(1);
                      }}
                      className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="">All Actions</option>
                      {["CREATE", "UPDATE", "DELETE", "STATUS_CHANGE", "DEACTIVATE", "REACTIVATE", "VOID"].map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs font-semibold text-muted-foreground">
                      Staff ID
                    </Label>
                    <Input
                      value={auditStaffId}
                      onChange={(e) => setAuditStaffId(e.target.value)}
                      placeholder="Staff ID"
                      className="h-9 w-40 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                </>
              )}

              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear Filters
              </Button>
            </div>

            {/* Preference Trends Card Deck View */}
            {activeReport === "preference-trends" &&
              !loading &&
              data.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {data.slice(0, 3).map((item, index) => (
                    <div
                      key={item.service_id || index}
                      className="rounded-xl border border-primary/30 bg-primary/5 p-5 shadow-sm"
                    >
                      <div className="flex items-center justify-between">
                        <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-primary text-primary-foreground">
                          Rank #{index + 1}
                        </span>
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                          {item.category || "Service"}
                        </span>
                      </div>
                      <h3 className="mt-3 text-lg font-bold text-foreground">
                        {item.service_name || item.name}
                      </h3>
                      <div className="mt-4 flex justify-between items-baseline border-t border-border pt-2 text-xs">
                        <span className="text-muted-foreground">
                          Orders:{" "}
                          {item.total_orders || item.usage_orders_count || 0}
                        </span>
                        <span className="font-semibold text-sm">
                          LKR{" "}
                          {Number(
                            item.total_revenue_generated ||
                              item.total_revenue ||
                              0,
                          ).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

            {/* Data Table */}
            {generatedAt && <p className="text-xs text-muted-foreground">Scope: {selectedBranch ? branches.find(branch => branch.branch_id === selectedBranch)?.name ?? 'Assigned branch' : 'All branches'}. {activeReport === 'revenue' ? `Year: ${selectedYear}. ` : activeReport === 'occupancy' ? 'Current occupancy. ' : 'All recorded dates. '}Generated: {new Date(generatedAt).toLocaleString()}.</p>}
            <section className="rounded-2xl border-2 border-border bg-card shadow-md p-4 md:p-6 overflow-x-auto">
              {loading ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  Loading report data...
                </p>
              ) : error ? (
                <p className="text-sm text-destructive py-4 text-center">
                  {error}
                </p>
              ) : data.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No records available for the selected filters.
                </p>
              ) : (
                <Table className="w-full text-sm">
                  <TableHeader>
                    <TableRow className="border-b-2 border-border text-muted-foreground text-left">
                      {Object.keys(data[0] || {}).map((col) => (
                        <TableHead
                          key={col}
                          className="py-3 px-3 font-semibold capitalize whitespace-nowrap"
                        >
                          {formatColumnName(col)}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.map((row, rIdx) => (
                      <TableRow
                        key={rIdx}
                        className="border-b border-border last:border-0 hover:bg-accent/40 transition-colors"
                      >
                        {Object.entries(row).map(([col, val], cIdx) => (
                          <TableCell
                            key={`${col}-${cIdx}`}
                            className="py-3 px-3 text-xs md:text-sm whitespace-nowrap"
                          >
                            {formatValue(val)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>

            {/* Audit Pagination */}
            {activeReport === "audit-logs" && !loading && data.length > 0 && (
              <div className="flex items-center justify-between border-t border-border pt-4">
                <p className="text-sm text-muted-foreground">
                  Page {auditPage}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={auditPage <= 1}
                    onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={data.length < 25}
                    onClick={() => setAuditPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
              </TabsContent>
            </Tabs>
          </div>
        </BoundedContainer>
      </PageContainer>
    </AppShell>
  );
}
