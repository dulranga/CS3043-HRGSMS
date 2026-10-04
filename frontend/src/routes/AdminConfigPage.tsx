import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { PageContainer } from "@/components/layout/PageContainer";
import { BoundedContainer } from "@/components/layout/BoundedContainer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ConfigItem {
  config_key: string;
  config_value: string;
  effective_from?: string;
  updated_at?: string;
}

const FRIENDLY_NAMES: Record<string, { label: string; unit: string; description: string }> = {
  tax_rate: { label: "Tax Rate", unit: "%", description: "Government tax rate applied across bookings" },
  cancellation_fee_rate: { label: "Cancellation Fee", unit: "%", description: "Deduction percentage on canceled bookings" },
  service_charge_rate: { label: "Service Charge", unit: "%", description: "Standard service charge added to orders" },
  late_checkout_amount: { label: "Late Checkout Fee", unit: "LKR", description: "Fixed penalty for departures after designated checkout time" },
  discount_rate: { label: "Default Discount Rate", unit: "%", description: "Base promotional discount applied to standard tariffs" },
};

export default function AdminConfigPage() {
  const [configs, setConfigs] = useState<ConfigItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchConfigs = async () => {
    try {
      setLoading(true);
      const res = await fetch("http://localhost:4000/api/admin/configs");
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
    if (isNaN(Number(editValue)) || Number(editValue) < 0) {
      setStatusMessage({ type: "error", text: "Please enter a valid non-negative number." });
      return;
    }

    try {
      setSavingKey(key);
      const res = await fetch(`http://localhost:4000/api/admin/configs/${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config_value: editValue.trim(),
        }),
      });

      if (!res.ok) throw new Error("Update failed");

      setStatusMessage({ type: "success", text: `Successfully updated ${FRIENDLY_NAMES[key]?.label || key}.` });
      setEditingKey(null);
      await fetchConfigs();
    } catch {
      setStatusMessage({ type: "error", text: `Failed to update ${key}.` });
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <AppShell>
      <PageContainer>
        <BoundedContainer>
          <div className="space-y-6">
            <header>
              <h1 className="text-2xl font-bold tracking-tight">System & Billing Policies</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Manage global tax rates, fee percentages, and system-wide operational parameters.
              </p>
            </header>

            {statusMessage && (
              <div
                className={`p-3 rounded-lg text-sm transition-all ${
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
                    <tr className="border-b-2 border-border text-muted-foreground">
                      <th className="text-left py-3 px-3 font-semibold">Policy Name & Description</th>
                      <th className="text-left py-3 px-3 font-semibold">System Key</th>
                      <th className="text-left py-3 px-3 font-semibold">Current Value</th>
                      <th className="text-right py-3 px-3 font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {configs.map((cfg) => {
                      const isEditing = editingKey === cfg.config_key;
                      const isSaving = savingKey === cfg.config_key;
                      const meta = FRIENDLY_NAMES[cfg.config_key];

                      return (
                        <tr
                          key={cfg.config_key}
                          className="border-b border-border last:border-0 hover:bg-accent/40 transition-colors"
                        >
                          <td className="py-3 px-3">
                            <div className="font-semibold text-foreground">
                              {meta?.label || cfg.config_key}
                            </div>
                            {meta?.description && (
                              <div className="text-xs text-muted-foreground">{meta.description}</div>
                            )}
                          </td>
                          <td className="py-3 px-3 font-mono text-xs text-muted-foreground">
                            {cfg.config_key}
                          </td>
                          <td className="py-3 px-3">
                            {isEditing ? (
                              <div className="flex items-center gap-1.5">
                                <Input
                                  type="number"
                                  step="any"
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  className="h-8 w-28"
                                  autoFocus
                                />
                                {meta?.unit && (
                                  <span className="text-xs text-muted-foreground font-semibold">
                                    {meta.unit}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="inline-flex items-center gap-1 font-semibold text-foreground bg-muted px-2.5 py-1 rounded-md text-xs">
                                {cfg.config_value}
                                {meta?.unit && <span className="text-muted-foreground font-normal">{meta.unit}</span>}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right">
                            {isEditing ? (
                              <div className="flex justify-end gap-2">
                                <Button
                                  size="sm"
                                  disabled={isSaving}
                                  onClick={() => handleSave(cfg.config_key)}
                                >
                                  {isSaving ? "Saving..." : "Save"}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={isSaving}
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
                                  setStatusMessage(null);
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