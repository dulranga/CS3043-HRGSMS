import { useEffect, useState } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { BoundedContainer } from "@/components/layout/BoundedContainer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useFeatureSessions } from "@/components/auth/useFeatureSessions";
import { formatLkr } from "@/lib/money";
import { ROLE_GRANTS } from "@/lib/rolePermissions.generated";

interface BillingPolicy {
  billingPolicyId: string;
  effectiveFrom: string;
  taxPercent: string;
  serviceChargePercent: string;
  maxDiscountPercent: string;
  cancellationFee: string;
  noShowFee: string;
  lateCheckoutFee: string;
  noShowGraceDays: number;
  isDemo: boolean;
  createdAt: string;
}

type PolicyField = "taxPercent" | "serviceChargePercent" | "maxDiscountPercent" | "cancellationFee" | "noShowFee" | "lateCheckoutFee" | "noShowGraceDays";
type PolicyDraft = Record<PolicyField, string>;

// Bounds mirror billing_policy's CHECK constraints (m1_005).
const PERCENT = { kind: "percent", unit: "%", pattern: /^(100(\.0{1,2})?|[0-9]{1,2}(\.[0-9]{1,2})?)$/, hint: "a percentage from 0 to 100 with at most two decimals", input: { step: "0.01", min: "0", max: "100" } } as const;
const FEE = { kind: "fee", unit: "LKR", pattern: /^[0-9]{1,10}(\.[0-9]{1,2})?$/, hint: "a non-negative LKR amount with at most two decimals", input: { step: "0.01", min: "0", max: undefined } } as const;
const POLICY_FIELDS: ReadonlyArray<{ field: PolicyField; label: string; key: string; kind: "percent" | "fee" | "days"; unit: string; pattern: RegExp; hint: string; input: { step: string; min: string; max?: string } }> = [
  { field: "taxPercent", label: "Tax", key: "tax_percent", ...PERCENT },
  { field: "serviceChargePercent", label: "Service charge", key: "service_charge_percent", ...PERCENT },
  { field: "maxDiscountPercent", label: "Maximum discount", key: "max_discount_percent", ...PERCENT },
  { field: "cancellationFee", label: "Cancellation fee", key: "cancellation_fee", ...FEE },
  { field: "noShowFee", label: "No-show fee", key: "no_show_fee", ...FEE },
  { field: "lateCheckoutFee", label: "Late checkout fee", key: "late_checkout_fee", ...FEE },
  { field: "noShowGraceDays", label: "No-show grace period", key: "no_show_grace_days", kind: "days", unit: "days", pattern: /^[1-7]$/, hint: "a whole number of days from 1 to 7", input: { step: "1", min: "1", max: "7" } },
];

function formatPolicyValue(policy: BillingPolicy, field: (typeof POLICY_FIELDS)[number]): string {
  const value = policy[field.field];
  if (field.kind === "percent") return `${value}%`;
  if (field.kind === "fee") return formatLkr(String(value));
  return `${value} ${value === 1 ? "day" : "days"}`;
}

function draftFrom(policy: BillingPolicy | null): PolicyDraft {
  return Object.fromEntries(POLICY_FIELDS.map(({ field }) => [field, policy ? String(policy[field]) : ""])) as PolicyDraft;
}

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
  const role = useFeatureSessions().role;
  const canWrite = role === 'SYSTEM_ADMINISTRATOR';
  const canPublishPolicy = role !== null && ROLE_GRANTS[role]?.["billing_policy.publish"] !== undefined;
  const [configs, setConfigs] = useState<ConfigItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [policy, setPolicy] = useState<BillingPolicy | null>(null);
  const [policyState, setPolicyState] = useState<"loading" | "ready" | "error">("loading");
  const [policyDraft, setPolicyDraft] = useState<PolicyDraft | null>(null);
  const [policyErrors, setPolicyErrors] = useState<Partial<Record<PolicyField, string>>>({});
  const [policySaving, setPolicySaving] = useState(false);
  const [policyMessage, setPolicyMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handlePublishPolicy = async () => {
    if (!policyDraft || !canPublishPolicy) return;
    const errors: Partial<Record<PolicyField, string>> = {};
    for (const { field, label, pattern, hint } of POLICY_FIELDS) {
      if (!pattern.test(policyDraft[field].trim())) errors[field] = `${label} must be ${hint}.`;
    }
    setPolicyErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const body = Object.fromEntries(POLICY_FIELDS.map(({ field }) => [
      field,
      field === "noShowGraceDays" ? Number(policyDraft[field].trim()) : policyDraft[field].trim(),
    ]));
    try {
      setPolicySaving(true);
      const res = await fetch("/api/admin/billing-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (payload?.fieldErrors) setPolicyErrors(payload.fieldErrors);
        throw new Error(res.status === 403 ? "You are not allowed to publish billing policies." : payload?.error ?? "Update failed");
      }
      setPolicy(payload.data);
      setPolicyDraft(null);
      setPolicyMessage({ type: "success", text: "Published a new billing policy. It applies to bookings confirmed from now on." });
    } catch (error) {
      setPolicyMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to publish the billing policy." });
    } finally {
      setPolicySaving(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/billing-policy");
        if (!res.ok) throw new Error("Failed to load");
        const body = await res.json();
        if (!cancelled) {
          setPolicy(body.data ?? null);
          setPolicyState("ready");
        }
      } catch {
        if (!cancelled) setPolicyState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

            <section className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight">Billing policy</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    The chain-wide policy applied to new bookings. Updating it publishes a new version effective today; existing bookings keep the policy they were confirmed under.
                  </p>
                </div>
                {canPublishPolicy && policyState === "ready" && !policyDraft && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setPolicyDraft(draftFrom(policy));
                      setPolicyErrors({});
                      setPolicyMessage(null);
                    }}
                  >
                    Update
                  </Button>
                )}
              </div>

              {policyMessage && (
                <Alert variant={policyMessage.type === "error" ? "destructive" : "default"}><AlertDescription>{policyMessage.text}</AlertDescription></Alert>
              )}

              <Card className="p-4 md:p-6">
                {policyState === "loading" ? (
                  <p className="text-sm text-muted-foreground py-4">Loading billing policy...</p>
                ) : policyState === "error" ? (
                  <Alert variant="destructive"><AlertDescription>Failed to load the billing policy.</AlertDescription></Alert>
                ) : !policy && !policyDraft ? (
                  <p className="text-sm text-muted-foreground py-4">No billing policy is in effect, so new bookings cannot be confirmed.</p>
                ) : (
                  <div className="space-y-4">
                    {policy && (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>Effective from {policy.effectiveFrom}</span>
                        <span>Published {new Date(policy.createdAt).toLocaleString("en-GB", { timeZone: "Asia/Colombo" })} (Asia/Colombo)</span>
                        {policy.isDemo && <Badge variant="secondary">Demo policy</Badge>}
                      </div>
                    )}
                    <Table className="w-full text-sm">
                      <TableHeader>
                        <TableRow className="border-b-2 border-border text-muted-foreground">
                          <TableHead className="text-left py-3 px-3 font-semibold">Setting</TableHead>
                          <TableHead className="text-left py-3 px-3 font-semibold">Policy Field</TableHead>
                          <TableHead className="text-left py-3 px-3 font-semibold">Value</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {POLICY_FIELDS.map((row) => (
                          <TableRow key={row.key} className="border-b border-border last:border-0">
                            <TableCell className="py-3 px-3 font-semibold text-foreground">{row.label}</TableCell>
                            <TableCell className="py-3 px-3 font-mono text-xs text-muted-foreground">{row.key}</TableCell>
                            <TableCell className="py-3 px-3">
                              {policyDraft ? (
                                <div className="space-y-1">
                                  <div className="flex items-center gap-1.5">
                                    <Input
                                      type="number"
                                      step={row.input.step}
                                      min={row.input.min}
                                      max={row.input.max}
                                      aria-label={row.label}
                                      aria-invalid={policyErrors[row.field] ? true : undefined}
                                      value={policyDraft[row.field]}
                                      onChange={(e) => setPolicyDraft({ ...policyDraft, [row.field]: e.target.value })}
                                      className="h-8 w-36"
                                    />
                                    <span className="text-xs text-muted-foreground font-semibold">{row.unit}</span>
                                  </div>
                                  {policyErrors[row.field] && (
                                    <p className="text-xs text-destructive">{policyErrors[row.field]}</p>
                                  )}
                                </div>
                              ) : policy ? (
                                <span className="inline-flex items-center font-semibold text-foreground bg-muted px-2.5 py-1 rounded-md text-xs">
                                  {formatPolicyValue(policy, row)}
                                </span>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {policyDraft && (
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" disabled={policySaving} onClick={() => { setPolicyDraft(null); setPolicyErrors({}); }}>
                          Cancel
                        </Button>
                        <Button size="sm" disabled={policySaving} onClick={handlePublishPolicy}>
                          {policySaving ? "Publishing..." : "Publish new version"}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            </section>
          </div>
        </BoundedContainer>
      </PageContainer>
  );
}
