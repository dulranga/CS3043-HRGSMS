import { useEffect, useState, useCallback } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { PageContainer } from "@/components/layout/PageContainer";
import { BoundedContainer } from "@/components/layout/BoundedContainer";
import { Button } from "@/components/ui/button";

type ReportType =
  | "occupancy"
  | "billing"
  | "revenue"
  | "guest-history"
  | "service-usage"
  | "preference-trends"
  | "audit-logs";

interface BranchOption {
  branch_id: string;
  name: string;
}

export default function ReportsPage() {
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

  const API_BASE = "http://localhost:4000/api";

  // 1. Fetch branches
  useEffect(() => {
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
  }, []);

  // 2. Fetch report data
  const loadReportData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Determine the endpoint path
      const endpoint =
        activeReport === "preference-trends"
          ? "preference/trends"
          : activeReport;
      const url = new URL(`${API_BASE}/reports/${endpoint}`);

      // Query params
      if (activeReport === "occupancy" && selectedBranch) {
        url.searchParams.append("branch_id", selectedBranch);
      }
      if (activeReport === "billing") {
        if (selectedBranch)
          url.searchParams.append("branch_id", selectedBranch);
        if (bookingRef.trim())
          url.searchParams.append("booking_ref", bookingRef.trim());
        if (invoiceStatus)
          url.searchParams.append("invoice_status", invoiceStatus);
        url.searchParams.append("limit", "50");
        url.searchParams.append("offset", "0");
      }
      if (activeReport === "revenue") {
        if (selectedBranch)
          url.searchParams.append("branch_id", selectedBranch);
        if (selectedYear) url.searchParams.append("year", selectedYear);
      }
      if (activeReport === "guest-history") {
        if (guestSearch.trim())
          url.searchParams.append("search", guestSearch.trim());
        if (minStays) url.searchParams.append("min_stays", minStays);
        url.searchParams.append("limit", "50");
        url.searchParams.append("offset", "0");
      }
      if (activeReport === "service-usage") {
        if (serviceCategory.trim())
          url.searchParams.append("category", serviceCategory.trim());
        if (serviceSearch.trim())
          url.searchParams.append("search", serviceSearch.trim());
      }
      if (activeReport === "preference-trends") {
        url.searchParams.append("by", trendsSortBy);
        url.searchParams.append("limit", trendsLimit);
      }
      if (activeReport === "audit-logs") {
        if (auditEntity.trim())
          url.searchParams.append("entity_name", auditEntity.trim());
        if (auditAction) url.searchParams.append("action", auditAction);
        if (auditStaffId.trim())
          url.searchParams.append("staff_id", auditStaffId.trim());
        url.searchParams.append("limit", "25");
        url.searchParams.append("page", String(auditPage));
      }

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
      const reportResponse = await res.json();

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
      console.error("Report loading error:", err);
      setError("Failed to fetch report data. Check server connectivity.");
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [
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
    loadReportData();
  }, [loadReportData]);

  // 3. CSV Export
  const handleExportCsv = () => {
    const exportPath =
      activeReport === "preference-trends"
        ? "trends/export"
        : `${activeReport}/export`;
    const exportUrl = new URL(`${API_BASE}/reports/${exportPath}`);

    if (
      selectedBranch &&
      (activeReport === "occupancy" || activeReport === "revenue")
    ) {
      exportUrl.searchParams.append("branch_id", selectedBranch);
    }
    if (activeReport === "revenue" && selectedYear) {
      exportUrl.searchParams.append("year", selectedYear);
    }
    window.location.href = exportUrl.toString();
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
    setSelectedBranch("");
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
            <div className="flex flex-wrap gap-2 border-b border-border pb-2">
              {reportTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => changeReport(tab.id)}
                  className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${
                    activeReport === tab.id
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Filter Controls */}
            <div className="flex flex-wrap items-end gap-4 p-4 rounded-xl bg-card border border-border">
              {(activeReport === "occupancy" ||
                activeReport === "billing" ||
                activeReport === "revenue") && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-muted-foreground">
                    Branch
                  </label>
                  <select
                    value={selectedBranch}
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
                  <label className="text-xs font-semibold text-muted-foreground">
                    Year
                  </label>
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
                    <label className="text-xs font-semibold text-muted-foreground">
                      Booking Reference
                    </label>
                    <input
                      value={bookingRef}
                      onChange={(e) => setBookingRef(e.target.value)}
                      placeholder="Search booking..."
                      className="h-9 w-48 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-muted-foreground">
                      Invoice Status
                    </label>
                    <select
                      value={invoiceStatus}
                      onChange={(e) => setInvoiceStatus(e.target.value)}
                      className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="">All Statuses</option>
                      {["ISSUED", "PAID", "VOID", "OVERDUE"].map((st) => (
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
                    <label className="text-xs font-semibold text-muted-foreground">
                      Search Guest
                    </label>
                    <input
                      value={guestSearch}
                      onChange={(e) => setGuestSearch(e.target.value)}
                      placeholder="Name, email or phone..."
                      className="h-9 w-56 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-muted-foreground">
                      Minimum Stays
                    </label>
                    <input
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
                    <label className="text-xs font-semibold text-muted-foreground">
                      Category
                    </label>
                    <input
                      value={serviceCategory}
                      onChange={(e) => setServiceCategory(e.target.value)}
                      placeholder="e.g. Food"
                      className="h-9 w-40 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-muted-foreground">
                      Service Name
                    </label>
                    <input
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
                    <label className="text-xs font-semibold text-muted-foreground">
                      Rank By
                    </label>
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
                    <label className="text-xs font-semibold text-muted-foreground">
                      Show Top
                    </label>
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
                    <label className="text-xs font-semibold text-muted-foreground">
                      Entity
                    </label>
                    <input
                      value={auditEntity}
                      onChange={(e) => setAuditEntity(e.target.value)}
                      placeholder="e.g. booking"
                      className="h-9 w-40 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-muted-foreground">
                      Action
                    </label>
                    <select
                      value={auditAction}
                      onChange={(e) => {
                        setAuditAction(e.target.value);
                        setAuditPage(1);
                      }}
                      className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="">All Actions</option>
                      {["INSERT", "UPDATE", "DELETE"].map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-muted-foreground">
                      Staff ID
                    </label>
                    <input
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
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b-2 border-border text-muted-foreground text-left">
                      {Object.keys(data[0] || {}).map((col) => (
                        <th
                          key={col}
                          className="py-3 px-3 font-semibold capitalize whitespace-nowrap"
                        >
                          {formatColumnName(col)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((row, rIdx) => (
                      <tr
                        key={rIdx}
                        className="border-b border-border last:border-0 hover:bg-accent/40 transition-colors"
                      >
                        {Object.entries(row).map(([col, val], cIdx) => (
                          <td
                            key={`${col}-${cIdx}`}
                            className="py-3 px-3 text-xs md:text-sm whitespace-nowrap"
                          >
                            {formatValue(val)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
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
          </div>
        </BoundedContainer>
      </PageContainer>
    </AppShell>
  );
}
