import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { PageContainer } from "@/components/layout/PageContainer";
import { BoundedContainer } from "@/components/layout/BoundedContainer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ConfigItem {
  config_key: string;
  config_value: string;
  description?: string;
  updated_at?: string;
}

export default function AdminConfigPage() {
  const [configs, setConfigs] = useState<ConfigItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchConfigs = async () => {
    try {
      setLoading(true);
      const res = await fetch("http://localhost:4000/api/admin/config");
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setConfigs(data);
    } catch {
      setStatusMessage({ type: "error", text: "Failed to load system configurations." });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfigs();
  }, []);

  const handleSave = async (key: string) => {
    try {
      const res = await fetch("http://localhost:4000/api/admin/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key,
          value: editValue,
          userId: null,
        }),
      });

      if (!res.ok) throw new Error("Update failed");

      setStatusMessage({ type: "success", text: `Successfully updated ${key}.` });
      setEditingKey(null);
      fetchConfigs();
    } catch {
      setStatusMessage({ type: "error", text: `Failed to update ${key}.` });
    }
  };

  return (
    <AppShell>
      <PageContainer>
        <BoundedContainer>
          <div className="space-y-6">
            <header>
              <h1 className="text-2xl font-bold tracking-tight">System Configurations</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Manage global rates, tax percentages, and operational parameters.
              </p>
            </header>

            {statusMessage && (
              <div
                className={`p-3 rounded-lg text-sm ${
                  statusMessage.type === "success"
                    ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20"
                    : "bg-destructive/10 text-destructive border border-destructive/20"
                }`}
              >
                {statusMessage.text}
              </div>
            )}

            <section className="rounded-2xl border-2 border-border bg-card shadow-md p-4 md:p-6 overflow-x-auto">
              {loading ? (
                <p className="text-sm text-muted-foreground py-4">Loading system settings...</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b-2 border-border">
                      <th className="text-left py-2 px-3 font-semibold tracking-tight">Setting Key</th>
                      <th className="text-left py-2 px-3 font-semibold tracking-tight">Value</th>
                      <th className="text-right py-2 px-3 font-semibold tracking-tight">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {configs.map((cfg) => {
                      const isEditing = editingKey === cfg.config_key;
                      return (
                        <tr
                          key={cfg.config_key}
                          className="border-b border-border last:border-0 hover:bg-accent/40 transition-colors"
                        >
                          <td className="py-2.5 px-3 font-medium font-mono text-xs md:text-sm">
                            {cfg.config_key}
                          </td>
                          <td className="py-2.5 px-3">
                            {isEditing ? (
                              <Input
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                className="h-8 w-32"
                              />
                            ) : (
                              <span className="font-semibold text-foreground bg-muted px-2 py-0.5 rounded text-xs">
                                {cfg.config_value}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            {isEditing ? (
                              <div className="flex justify-end gap-2">
                                <Button size="sm" onClick={() => handleSave(cfg.config_key)}>
                                  Save
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setEditingKey(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setEditingKey(cfg.config_key);
                                  setEditValue(cfg.config_value);
                                }}
                              >
                                Edit
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
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