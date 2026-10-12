import { useEffect, useState } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { BoundedContainer } from "@/components/layout/BoundedContainer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useFeatureSessions } from "@/components/auth/useFeatureSessions";

interface ConfigItem {
  config_key: string;
  config_value: string | null;
  effective_from?: string;
  updated_at?: string;
}

const FRIENDLY_NAMES: Record<string, { label: string; unit: string; description: string }> = {
  session_idle_timeout_minutes: { label: "Session idle timeout", unit: "minutes", description: "Whole minutes from 1 to 999. Uses 30 minutes until set. Changes take effect immediately." },
};

export default function AdminConfigPage() {
  const canWrite = useFeatureSessions().role === 'SYSTEM_ADMINISTRATOR';
  const [configs, setConfigs] = useState<ConfigItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchConfigs = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/configs");
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
    if (!canWrite) return;
    if (!editValue.trim() || (key === 'session_idle_timeout_minutes' && !/^[1-9][0-9]{0,2}$/.test(editValue.trim()))) {
      setStatusMessage({ type: "error", text: "Enter a valid value; session timeout must be a whole number from 1 to 999." });
      return;
    }

    try {
      setSavingKey(key);
      const res = await fetch(`/api/admin/configs/${encodeURIComponent(key)}`, {
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
      <PageContainer>
        <BoundedContainer>
          <div className="space-y-6">
            <header>
              <h1 className="text-2xl font-bold tracking-tight">System Configuration</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Manage registered operational settings. Financial policy versions are published separately by authorized management.
              </p>
            </header>

            {statusMessage && (
              <Alert variant={statusMessage.type === "error" ? "destructive" : "default"}><AlertDescription>{statusMessage.text}</AlertDescription></Alert>
            )}

            <Card className="p-4 md:p-6">
              {loading ? (
                <p className="text-sm text-muted-foreground py-4">Loading system settings...</p>
              ) : (
                <Table className="w-full text-sm">
                  <TableHeader>
                    <TableRow className="border-b-2 border-border text-muted-foreground">
                      <TableHead className="text-left py-3 px-3 font-semibold">Policy Name & Description</TableHead>
                      <TableHead className="text-left py-3 px-3 font-semibold">System Key</TableHead>
                      <TableHead className="text-left py-3 px-3 font-semibold">Current Value</TableHead>
                      <TableHead className="text-right py-3 px-3 font-semibold">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {configs.map((cfg) => {
                      const isEditing = editingKey === cfg.config_key;
                      const isSaving = savingKey === cfg.config_key;
                      const meta = FRIENDLY_NAMES[cfg.config_key];

                      return (
                        <TableRow
                          key={cfg.config_key}
                          className="border-b border-border last:border-0 hover:bg-accent/40 transition-colors"
                        >
                          <TableCell className="py-3 px-3">
                            <div className="font-semibold text-foreground">
                              {meta?.label || cfg.config_key}
                            </div>
                            {meta?.description && (
                              <div className="text-xs text-muted-foreground">{meta.description}</div>
                            )}
                          </TableCell>
                          <TableCell className="py-3 px-3 font-mono text-xs text-muted-foreground">
                            {cfg.config_key}
                          </TableCell>
                          <TableCell className="py-3 px-3">
                            {isEditing ? (
                              <div className="flex items-center gap-1.5">
                                <Input
                                  type="number"
                                  step="1"
                                  min="1"
                                  max="999"
                                  aria-label={meta?.label || cfg.config_key}
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
                                {cfg.config_value ?? "Not set"}
                                {meta?.unit && <span className="text-muted-foreground font-normal">{meta.unit}</span>}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="py-3 px-3 text-right">
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
                                disabled={!canWrite}
                                onClick={() => {
                                  setEditingKey(cfg.config_key);
                                  setEditValue(cfg.config_value ?? '');
                                  setStatusMessage(null);
                                }}
                              >
                                Edit
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </Card>
          </div>
        </BoundedContainer>
      </PageContainer>
  );
}
