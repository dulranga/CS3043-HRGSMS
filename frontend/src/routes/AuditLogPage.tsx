import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { PageContainer } from "@/components/layout/PageContainer";
import { BoundedContainer } from "@/components/layout/BoundedContainer";

interface AuditEntry {
  log_id?: string;
  id?: string;
  entity_name: string;
  entity_id: string;
  action: string;
  before_value?: string | null;
  after_value?: string | null;
  changed_at: string;
  user_id?: string | null;
}

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAuditLogs = async () => {
    try {
      setLoading(true);
      const res = await fetch("http://localhost:4000/api/admin/audit");
      if (!res.ok) throw new Error("Failed to load audit entries");
      const data = await res.json();
      setLogs(data);
    } catch {
      setError("Unable to load audit history.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuditLogs();
  }, []);

  return (
    <AppShell>
      <PageContainer>
        <BoundedContainer>
          <div className="space-y-6">
            <header>
              <h1 className="text-2xl font-bold tracking-tight">Audit Log History</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Immutable record of administrative actions, entity modifications, and parameter updates.
              </p>
            </header>

            {error && (
              <div className="p-3 rounded-lg text-sm bg-destructive/10 text-destructive border border-destructive/20">
                {error}
              </div>
            )}

            <section className="rounded-2xl border-2 border-border bg-card shadow-md p-4 md:p-6 overflow-x-auto">
              {loading ? (
                <p className="text-sm text-muted-foreground py-4">Loading audit logs...</p>
              ) : logs.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">No audit activity recorded yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b-2 border-border">
                      <th className="text-left py-2 px-3 font-semibold tracking-tight">Timestamp</th>
                      <th className="text-left py-2 px-3 font-semibold tracking-tight">Entity</th>
                      <th className="text-left py-2 px-3 font-semibold tracking-tight">Action</th>
                      <th className="text-left py-2 px-3 font-semibold tracking-tight">Key / ID</th>
                      <th className="text-left py-2 px-3 font-semibold tracking-tight">New Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log, index) => (
                      <tr
                        key={log.log_id || log.id || index}
                        className="border-b border-border last:border-0 hover:bg-accent/40 transition-colors"
                      >
                        <td className="py-2.5 px-3 text-xs text-muted-foreground font-mono">
                          {new Date(log.changed_at).toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-xs font-semibold">
                          {log.entity_name}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="font-semibold text-[11px] uppercase tracking-wide bg-muted px-2 py-0.5 rounded text-foreground">
                            {log.action}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground">
                          {log.entity_id}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-xs">
                          {log.after_value || "—"}
                        </td>
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