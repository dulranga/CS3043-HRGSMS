import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { PageContainer } from "@/components/layout/PageContainer";
import { BoundedContainer } from "@/components/layout/BoundedContainer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/components/auth/AuthProvider";

interface Branch {
  branch_id: string;
  name: string;
  city: string;
  address: string | null;
  active: boolean;
}

async function mutationError(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => null);
  return typeof payload?.error === 'string' ? payload.error : payload?.error?.message ?? fallback;
}

export default function BranchManagementPage() {
  const { user: sessionUser } = useAuth();
  const canWrite = sessionUser?.kind === 'STAFF' && sessionUser.role === 'SYSTEM_ADMINISTRATOR';

  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchLoading, setBranchLoading] = useState<boolean>(true);
  const [newBranchName, setNewBranchName] = useState<string>("");
  const [newBranchCity, setNewBranchCity] = useState<string>("");
  const [newBranchAddress, setNewBranchAddress] = useState<string>("");

  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadBranches = async () => {
    try {
      setBranchLoading(true);
      const res = await fetch("/api/admin/branches");
      if (!res.ok) throw new Error("Failed to load branches");
      const data = await res.json();
      setBranches(data);
    } catch {
      setStatusMessage({ type: "error", text: "Failed to load branches." });
    } finally {
      setBranchLoading(false);
    }
  };

  useEffect(() => {
    void loadBranches();
  }, []);

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite) return;
    if (!newBranchName || !newBranchCity) {
      setStatusMessage({ type: "error", text: "Branch name and city are required." });
      return;
    }

    try {
      const res = await fetch("/api/admin/branches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newBranchName,
          city: newBranchCity,
          address: newBranchAddress || undefined,
          active: true,
        }),
      });

      if (!res.ok) throw new Error(await mutationError(res, "Failed to create branch."));

      setStatusMessage({ type: "success", text: `Branch "${newBranchName}" created successfully.` });
      setNewBranchName("");
      setNewBranchCity("");
      setNewBranchAddress("");
      loadBranches();
    } catch (error) {
      setStatusMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to create branch." });
    }
  };

  const toggleBranchStatus = async (branch: Branch) => {
    if (!canWrite) return;
    try {
      const res = await fetch(`/api/admin/branches/${branch.branch_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !branch.active }),
      });

      if (!res.ok) throw new Error(await mutationError(res, "Failed to update branch status."));

      setStatusMessage({
        type: "success",
        text: `Branch "${branch.name}" marked as ${!branch.active ? "Active" : "Inactive"}.`,
      });
      loadBranches();
    } catch (error) {
      setStatusMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to update branch status." });
    }
  };

  return (
    <AppShell>
      <PageContainer>
        <BoundedContainer>
          <div className="space-y-6">
            <header>
              <h1 className="text-2xl font-bold tracking-tight">Branches</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Create hotel branches and control which ones are active.
              </p>
            </header>

            {statusMessage && (
              <Alert variant={statusMessage.type === "error" ? "destructive" : "default"}><AlertDescription>{statusMessage.text}</AlertDescription></Alert>
            )}

            {/* Create Branch Card */}
            <Card className="p-4 md:p-6">
              <h2 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground mb-4">
                Add New Branch
              </h2>
              <form onSubmit={handleCreateBranch} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                <div>
                  <Label htmlFor="branch-name" className="text-xs font-medium block mb-1">Branch Name</Label>
                  <Input
                    placeholder="e.g. Colombo Central"
                    id="branch-name"
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div>
                  <Label htmlFor="branch-city" className="text-xs font-medium block mb-1">City</Label>
                  <Input
                    placeholder="e.g. Colombo"
                    id="branch-city"
                    value={newBranchCity}
                    onChange={(e) => setNewBranchCity(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div>
                  <Label htmlFor="branch-address" className="text-xs font-medium block mb-1">Address (Optional)</Label>
                  <Input
                    placeholder="e.g. Galle Road, Colombo 03"
                    id="branch-address"
                    value={newBranchAddress}
                    onChange={(e) => setNewBranchAddress(e.target.value)}
                    className="h-9"
                  />
                </div>
                <Button type="submit" className="h-9" disabled={!canWrite}>
                  Create Branch
                </Button>
              </form>
            </Card>

            {/* Branches Table */}
            <Card className="p-4 md:p-6">
              {branchLoading ? (
                <p className="text-sm text-muted-foreground py-4">Loading branches...</p>
              ) : branches.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No branches configured.</p>
              ) : (
                <Table className="w-full text-sm">
                  <TableHeader>
                    <TableRow className="border-b-2 border-border text-muted-foreground text-left">
                      <TableHead className="py-3 px-3 font-semibold">Branch Name</TableHead>
                      <TableHead className="py-3 px-3 font-semibold">City</TableHead>
                      <TableHead className="py-3 px-3 font-semibold">Address</TableHead>
                      <TableHead className="py-3 px-3 font-semibold">Status</TableHead>
                      <TableHead className="py-3 px-3 font-semibold text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {branches.map((b) => (
                      <TableRow key={b.branch_id} className="border-b border-border last:border-0 hover:bg-accent/40 transition-colors">
                        <TableCell className="py-3 px-3 font-semibold">{b.name}</TableCell>
                        <TableCell className="py-3 px-3">{b.city}</TableCell>
                        <TableCell className="py-3 px-3 text-muted-foreground text-xs">{b.address || "—"}</TableCell>
                        <TableCell className="py-3 px-3">
                          <Badge variant={b.active ? "default" : "secondary"}>{b.active ? "Active" : "Disabled"}</Badge>
                        </TableCell>
                        <TableCell className="py-3 px-3 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => toggleBranchStatus(b)}
                            disabled={!canWrite}
                          >
                            {b.active ? "Deactivate" : "Activate"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          </div>
        </BoundedContainer>
      </PageContainer>
    </AppShell>
  );
}
