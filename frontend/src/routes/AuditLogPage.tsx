import { useEffect, useState, useCallback } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { PageContainer } from "@/components/layout/PageContainer";
import { BoundedContainer } from "@/components/layout/BoundedContainer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AuditRecord {
  audit_id: string;
  user_id: string | null;
  username: string | null;
  entity_name: string;
  entity_id: string;
  action: string;
  before_value: string | null;
  after_value: string | null;
  changed_at: string;
  ip_address: string | null;
}

interface AuditResponse {
  page: number;
  limit: number;
  count: number;
  data: AuditRecord[];
}

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [page, setPage] = useState<number>(1);
  const [hasMore, setHasMore] = useState<boolean>(true);

  // Filters
  const [selectedEntity, setSelectedEntity] = useState<string>("");
  const [selectedAction, setSelectedAction] = useState<string>("");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      const url = new URL("http://localhost:4000/api/admin/audit-logs");
      url.searchParams.append("page", String(page));
      url.searchParams.append("limit", "15");
      if (selectedEntity) url.searchParams.append("entity_name", selectedEntity);
      if (selectedAction) url.searchParams.append("action", selectedAction);

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("Failed to load audit logs");
      const result: AuditResponse = await res.json();

      setLogs(result.data);
      setHasMore(result.data.length === 15);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, selectedEntity, selectedAction]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const getActionBadgeColor = (action: string) => {
    switch (action.toUpperCase()) {
      case "INSERT":
        return "bg-emerald-500/15 text-emerald-600 border border-emerald-500/30";
      case "UPDATE":
        return "bg-blue-500/15 text-blue-600 border border-blue-500/30";
      case "DELETE":
        return "bg-rose-500/15 text-rose-600 border border-rose-500/30";
      default:
        return "bg-muted text-foreground border border-border";
    }
  };

  const formatJson = (val: string | null) => {
    if (!val) return "None";
    try {
      const parsed = JSON.parse(val);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return val;
    }
  };

  return (
    <AppShell>
      <PageContainer>
        <BoundedContainer>
          <div className="space-y-6">
            <header>
              <h1 className="text-2xl font-bold tracking-tight">System Audit Trail</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Track modifications, record history, and inspect user activity logs.
              </p>
            </header>

            {/* Filter Bar */}
            <div className="flex flex-wrap items-center gap-3 bg-card p-4 rounded-xl border border-border">
              <div className="w-48">
                <Input
                  placeholder="Filter by entity..."
                  value={selectedEntity}
                  onChange={(e) => {
                    setSelectedEntity(e.target.value);
                    setPage(1);
                  }}
                  className="h-9"
                />
              </div>

              <select
                value={selectedAction}
                onChange={(e) => {
                  setSelectedAction(e.target.value);
                  setPage(1);
                }}
                className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">All Actions</option>
                <option value="INSERT">INSERT</option>
                <option value="UPDATE">UPDATE</option>
                <option value="DELETE">DELETE</option>
              </select>

              {(selectedEntity || selectedAction) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedEntity("");
                    setSelectedAction("");
                    setPage(1);
                  }}
                >
                  Reset Filters
                </Button>
              )}
            </div>

            {/* Audit Log Table */}
            <section className="rounded-2xl border-2 border-border bg-card shadow-md p-4 md:p-6 overflow-x-auto">
              {loading ? (
                <p className="text-sm text-muted-foreground py-4">Loading audit logs...</p>
              ) : logs.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No audit records found.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b-2 border-border text-muted-foreground text-left">
                      <th className="py-3 px-3 font-semibold">Timestamp</th>
                      <th className="py-3 px-3 font-semibold">User</th>
                      <th className="py-3 px-3 font-semibold">Action</th>
                      <th className="py-3 px-3 font-semibold">Entity</th>
                      <th className="py-3 px-3 font-semibold">Entity ID</th>
                      <th className="py-3 px-3 font-semibold text-right">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => {
                      const isExpanded = expandedRow === log.audit_id;
                      return (
                        <tr key={log.audit_id} className="border-b border-border last:border-0 hover:bg-accent/30 transition-colors">
                          <td className="py-3 px-3 text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(log.changed_at).toLocaleString()}
                          </td>
                          <td className="py-3 px-3 font-medium">
                            {log.username || log.user_id ? (
                              <span className="font-mono text-xs">{log.username || log.user_id?.slice(0, 8)}</span>
                            ) : (
                              <span className="text-muted-foreground italic">System</span>
                            )}
                          </td>
                          <td className="py-3 px-3">
                            <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${getActionBadgeColor(log.action)}`}>
                              {log.action}
                            </span>
                          </td>
                          <td className="py-3 px-3 font-mono text-xs font-semibold">{log.entity_name}</td>
                          <td className="py-3 px-3 font-mono text-xs text-muted-foreground truncate max-w-[120px]">
                            {log.entity_id}
                          </td>
                          <td className="py-3 px-3 text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs h-7 px-2"
                              onClick={() => setExpandedRow(isExpanded ? null : log.audit_id)}
                            >
                              {isExpanded ? "Hide" : "Diff"}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {/* Expansion Drawer / Diff View */}
              {expandedRow && (() => {
                const activeRecord = logs.find((l) => l.audit_id === expandedRow);
                if (!activeRecord) return null;
                return (
                  <div className="mt-4 p-4 rounded-xl bg-muted/60 border border-border space-y-3">
                    <div className="flex justify-between items-center text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      <span>Change Snapshot ({activeRecord.action})</span>
                      <span>IP: {activeRecord.ip_address || "N/A"}</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="font-semibold block mb-1 text-rose-500">Before Value</span>
                        <pre className="p-2.5 rounded bg-background border border-border overflow-x-auto max-h-48 font-mono">
                          {formatJson(activeRecord.before_value)}
                        </pre>
                      </div>
                      <div>
                        <span className="font-semibold block mb-1 text-emerald-500">After Value</span>
                        <pre className="p-2.5 rounded bg-background border border-border overflow-x-auto max-h-48 font-mono">
                          {formatJson(activeRecord.after_value)}
                        </pre>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Pagination Controls */}
              <div className="flex items-center justify-between pt-4 mt-2 border-t border-border">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                >
                  Previous
                </Button>
                <span className="text-xs text-muted-foreground">Page {page}</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!hasMore || loading}
                  onClick={() => setPage((prev) => prev + 1)}
                >
                  Next
                </Button>
              </div>
            </section>
          </div>
        </BoundedContainer>
      </PageContainer>
    </AppShell>
  );
}