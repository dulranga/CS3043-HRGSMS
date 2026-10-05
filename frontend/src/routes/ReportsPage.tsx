import { useEffect, useState, useCallback } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { PageContainer } from "@/components/layout/PageContainer";
import { BoundedContainer } from "@/components/layout/BoundedContainer";
import { Button } from "@/components/ui/button";

type ReportType = "occupancy" | "revenue" | "guest-history" | "service-usage";

interface BranchOption {
  branch_id: string;
  name: string;
}

export default function ReportsPage() {
  const [activeReport, setActiveReport] = useState<ReportType>("occupancy");
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString());
  
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // 1. Fetch Branches for the Filter Dropdown
  useEffect(() => {
    fetch("/api/admin/branches")
      .then((res) => res.json())
      .then((branchesData) => {
        if (Array.isArray(branchesData)) {
          setBranches(branchesData);
        }
      })
      .catch((err) => console.error("Error fetching branches:", err));
  }, []);

  // 2. Fetch Active Report Data
  const loadReportData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const url = new URL(`/api/reports/${activeReport}`, window.location.origin);
      if (selectedBranch) {
        url.searchParams.append("branch_id", selectedBranch);
      }
      if (activeReport === "revenue" && selectedYear) {
        url.searchParams.append("year", selectedYear);
      }

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("Failed to load report data");
      const reportRows = await res.json();
      setData(Array.isArray(reportRows) ? reportRows : []);
    } catch (err) {
      console.error(err);
      setError("Failed to fetch report data. Check server connectivity.");
    } finally {
      setLoading(false);
    }
  }, [activeReport, selectedBranch, selectedYear]);

  useEffect(() => {
    loadReportData();
  }, [loadReportData]);

  // 3. Handle Live CSV Export
  const handleExportCsv = () => {
    const exportUrl = new URL(`/api/reports/${activeReport}/export`, window.location.origin);
    if (selectedBranch) {
      exportUrl.searchParams.append("branch_id", selectedBranch);
    }
    if (activeReport === "revenue" && selectedYear) {
      exportUrl.searchParams.append("year", selectedYear);
    }

    // Direct browser download
    window.location.href = exportUrl.toString();
  };

  return (
    <AppShell>
      <PageContainer>
        <BoundedContainer>
          <div className="space-y-6">
            {/* Header & Export CTA */}
            <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Management Reports</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  View performance metrics, occupancy, revenue aggregates, and export CSV logs.
                </p>
              </div>

              <Button onClick={handleExportCsv} className="self-start md:self-auto gap-2">
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

            {/* Navigation Tabs */}
            <div className="flex flex-wrap gap-2 border-b border-border pb-2">
              {[
                { id: "occupancy", label: "Occupancy Rate" },
                { id: "revenue", label: "Revenue Aggregates" },
                { id: "guest-history", label: "Guest Stay History" },
                { id: "service-usage", label: "Service Usage" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveReport(tab.id as ReportType);
                    setData([]);
                  }}
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

            {/* Filter Controls Bar */}
            <div className="flex flex-wrap items-center gap-4 p-4 rounded-xl bg-card border border-border">
              {/* Branch Selector */}
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-muted-foreground">Branch:</label>
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

              {/* Year Selector for Revenue */}
              {activeReport === "revenue" && (
                <div className="flex items-center gap-2">
                  <label className="text-xs font-semibold text-muted-foreground">Year:</label>
                  <select
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {[2024, 2025, 2026, 2027].map((yr) => (
                      <option key={yr} value={yr}>
                        {yr}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {selectedBranch && (
                <Button variant="ghost" size="sm" onClick={() => setSelectedBranch("")}>
                  Clear Filter
                </Button>
              )}
            </div>

            {/* Data Table */}
            <section className="rounded-2xl border-2 border-border bg-card shadow-md p-4 md:p-6 overflow-x-auto">
              {loading ? (
                <p className="text-sm text-muted-foreground py-6 text-center">Loading report data...</p>
              ) : error ? (
                <p className="text-sm text-destructive py-4 text-center">{error}</p>
              ) : data.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No records available for the selected filters.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b-2 border-border text-muted-foreground text-left">
                      {Object.keys(data[0] || {}).map((col) => (
                        <th key={col} className="py-3 px-3 font-semibold capitalize whitespace-nowrap">
                          {col.replace(/_/g, " ")}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((row, idx) => (
                      <tr key={idx} className="border-b border-border last:border-0 hover:bg-accent/40 transition-colors">
                        {Object.values(row).map((val: any, cIdx) => (
                          <td key={cIdx} className="py-3 px-3 text-xs md:text-sm whitespace-nowrap">
                            {typeof val === "boolean"
                              ? val ? "Yes" : "No"
                              : val !== null && val !== undefined
                              ? String(val)
                              : "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        </BoundedContainer>
      </PageContainer>
    </AppShell>
  );
}