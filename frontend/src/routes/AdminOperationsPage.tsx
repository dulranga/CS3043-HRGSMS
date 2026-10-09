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

interface UserAccount {
  user_id: string;
  username: string;
  active: boolean;
  created_at: string;
  last_login_at: string | null;
}

async function mutationError(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => null);
  return typeof payload?.error === 'string' ? payload.error : payload?.error?.message ?? fallback;
}

export default function AdminOperationsPage() {
  const { user: sessionUser } = useAuth();
  const canWrite = sessionUser?.kind === 'STAFF' && sessionUser.role === 'SYSTEM_ADMINISTRATOR';
  const [activeTab, setActiveTab] = useState<"branches" | "users">("branches");

  // Branches state
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchLoading, setBranchLoading] = useState<boolean>(true);
  const [newBranchName, setNewBranchName] = useState<string>("");
  const [newBranchCity, setNewBranchCity] = useState<string>("");
  const [newBranchAddress, setNewBranchAddress] = useState<string>("");

  // Users state
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [userLoading, setUserLoading] = useState<boolean>(true);
  const [userSearch, setUserSearch] = useState<string>("");

  // Feedback message
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // 1. Fetch Branches
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

  // 2. Fetch Users
  const loadUsers = async () => {
    try {
      setUserLoading(true);
      const url = new URL("/api/admin/users", window.location.origin);
      if (userSearch) url.searchParams.append("search", userSearch);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("Failed to load users");
      const data = await res.json();
      setUsers(data);
    } catch {
      setStatusMessage({ type: "error", text: "Failed to load user accounts." });
    } finally {
      setUserLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "branches") {
      loadBranches();
    } else {
      loadUsers();
    }
  }, [activeTab]);

  // Branch Handlers
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

  // User Handlers
  const toggleUserStatus = async (user: UserAccount) => {
    if (!canWrite || user.user_id === sessionUser?.userId) return;
    try {
      const res = await fetch(`/api/admin/users/${user.user_id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !user.active }),
      });

      if (!res.ok) throw new Error(await mutationError(res, "Failed to update user status."));

      setStatusMessage({
        type: "success",
        text: `User "${user.username}" ${!user.active ? "activated" : "deactivated"}.`,
      });
      loadUsers();
    } catch (error) {
      setStatusMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to update user status." });
    }
  };

  return (
    <AppShell>
      <PageContainer>
        <BoundedContainer>
          <div className="space-y-6">
            <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Admin Operations</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Manage hotel branches and staff user account permissions.
                </p>
              </div>

              {/* Tab Selector */}
              <div className="inline-flex rounded-lg border border-border p-1 bg-muted/40">
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => {
                    setActiveTab("branches");
                    setStatusMessage(null);
                  }}
                  className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    activeTab === "branches" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Branches
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => {
                    setActiveTab("users");
                    setStatusMessage(null);
                  }}
                  className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    activeTab === "users" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  User Accounts
                </Button>
              </div>
            </header>

            {statusMessage && (
              <Alert variant={statusMessage.type === "error" ? "destructive" : "default"}><AlertDescription>{statusMessage.text}</AlertDescription></Alert>
            )}

            {/* TAB 1: BRANCH MANAGEMENT */}
            {activeTab === "branches" && (
              <div className="space-y-6">
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
            )}

            {/* TAB 2: USER ACCOUNT MANAGEMENT */}
            {activeTab === "users" && (
              <div className="space-y-6">
                <div className="flex items-center gap-3">
                  <Input
                    placeholder="Search by username..."
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    className="max-w-xs h-9"
                  />
                  <Button variant="outline" size="sm" onClick={loadUsers} className="h-9">
                    Search
                  </Button>
                </div>

                <Card className="p-4 md:p-6">
                  {userLoading ? (
                    <p className="text-sm text-muted-foreground py-4">Loading user accounts...</p>
                  ) : users.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">No accounts found.</p>
                  ) : (
                    <Table className="w-full text-sm">
                      <TableHeader>
                        <TableRow className="border-b-2 border-border text-muted-foreground text-left">
                          <TableHead className="py-3 px-3 font-semibold">Username</TableHead>
                          <TableHead className="py-3 px-3 font-semibold">User ID</TableHead>
                          <TableHead className="py-3 px-3 font-semibold">Last Login</TableHead>
                          <TableHead className="py-3 px-3 font-semibold">Account State</TableHead>
                          <TableHead className="py-3 px-3 font-semibold text-right">Access Control</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {users.map((u) => (
                          <TableRow key={u.user_id} className="border-b border-border last:border-0 hover:bg-accent/40 transition-colors">
                            <TableCell className="py-3 px-3 font-semibold">{u.username}</TableCell>
                            <TableCell className="py-3 px-3 font-mono text-xs text-muted-foreground">{u.user_id}</TableCell>
                            <TableCell className="py-3 px-3 text-xs text-muted-foreground">
                              {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "Never"}
                            </TableCell>
                            <TableCell className="py-3 px-3">
                              <Badge variant={u.active ? "default" : "destructive"}>{u.active ? "Enabled" : "Suspended"}</Badge>
                            </TableCell>
                            <TableCell className="py-3 px-3 text-right">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => toggleUserStatus(u)}
                                disabled={!canWrite || u.user_id === sessionUser?.userId}
                              >
                                {u.active ? "Suspend" : "Enable"}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </Card>
              </div>
            )}
          </div>
        </BoundedContainer>
      </PageContainer>
    </AppShell>
  );
}
