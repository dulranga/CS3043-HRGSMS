import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { PageContainer } from "@/components/layout/PageContainer";
import { BoundedContainer } from "@/components/layout/BoundedContainer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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

export default function AdminOperationsPage() {
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

      if (!res.ok) throw new Error("Failed to create branch");

      setStatusMessage({ type: "success", text: `Branch "${newBranchName}" created successfully.` });
      setNewBranchName("");
      setNewBranchCity("");
      setNewBranchAddress("");
      loadBranches();
    } catch {
      setStatusMessage({ type: "error", text: "Failed to create branch." });
    }
  };

  const toggleBranchStatus = async (branch: Branch) => {
    try {
      const res = await fetch(`/api/admin/branches/${branch.branch_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !branch.active }),
      });

      if (!res.ok) throw new Error("Failed to update status");

      setStatusMessage({
        type: "success",
        text: `Branch "${branch.name}" marked as ${!branch.active ? "Active" : "Inactive"}.`,
      });
      loadBranches();
    } catch {
      setStatusMessage({ type: "error", text: "Failed to update branch status." });
    }
  };

  // User Handlers
  const toggleUserStatus = async (user: UserAccount) => {
    try {
      const res = await fetch(`/api/admin/users/${user.user_id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !user.active }),
      });

      if (!res.ok) throw new Error("Failed to update user status");

      setStatusMessage({
        type: "success",
        text: `User "${user.username}" ${!user.active ? "activated" : "deactivated"}.`,
      });
      loadUsers();
    } catch {
      setStatusMessage({ type: "error", text: "Failed to update user status." });
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
                <button
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
                </button>
                <button
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
                </button>
              </div>
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

            {/* TAB 1: BRANCH MANAGEMENT */}
            {activeTab === "branches" && (
              <div className="space-y-6">
                {/* Create Branch Card */}
                <section className="rounded-2xl border-2 border-border bg-card shadow-md p-4 md:p-6">
                  <h2 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground mb-4">
                    Add New Branch
                  </h2>
                  <form onSubmit={handleCreateBranch} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                    <div>
                      <label className="text-xs font-medium block mb-1">Branch Name</label>
                      <Input
                        placeholder="e.g. Colombo Central"
                        value={newBranchName}
                        onChange={(e) => setNewBranchName(e.target.value)}
                        className="h-9"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium block mb-1">City</label>
                      <Input
                        placeholder="e.g. Colombo"
                        value={newBranchCity}
                        onChange={(e) => setNewBranchCity(e.target.value)}
                        className="h-9"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium block mb-1">Address (Optional)</label>
                      <Input
                        placeholder="e.g. Galle Road, Colombo 03"
                        value={newBranchAddress}
                        onChange={(e) => setNewBranchAddress(e.target.value)}
                        className="h-9"
                      />
                    </div>
                    <Button type="submit" className="h-9">
                      Create Branch
                    </Button>
                  </form>
                </section>

                {/* Branches Table */}
                <section className="rounded-2xl border-2 border-border bg-card shadow-md p-4 md:p-6 overflow-x-auto">
                  {branchLoading ? (
                    <p className="text-sm text-muted-foreground py-4">Loading branches...</p>
                  ) : branches.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">No branches configured.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b-2 border-border text-muted-foreground text-left">
                          <th className="py-3 px-3 font-semibold">Branch Name</th>
                          <th className="py-3 px-3 font-semibold">City</th>
                          <th className="py-3 px-3 font-semibold">Address</th>
                          <th className="py-3 px-3 font-semibold">Status</th>
                          <th className="py-3 px-3 font-semibold text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {branches.map((b) => (
                          <tr key={b.branch_id} className="border-b border-border last:border-0 hover:bg-accent/40 transition-colors">
                            <td className="py-3 px-3 font-semibold">{b.name}</td>
                            <td className="py-3 px-3">{b.city}</td>
                            <td className="py-3 px-3 text-muted-foreground text-xs">{b.address || "—"}</td>
                            <td className="py-3 px-3">
                              <span
                                className={`px-2.5 py-0.5 rounded text-xs font-semibold ${
                                  b.active
                                    ? "bg-emerald-500/15 text-emerald-600 border border-emerald-500/30"
                                    : "bg-muted text-muted-foreground border border-border"
                                }`}
                              >
                                {b.active ? "Active" : "Disabled"}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-right">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => toggleBranchStatus(b)}
                              >
                                {b.active ? "Deactivate" : "Activate"}
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>
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

                <section className="rounded-2xl border-2 border-border bg-card shadow-md p-4 md:p-6 overflow-x-auto">
                  {userLoading ? (
                    <p className="text-sm text-muted-foreground py-4">Loading user accounts...</p>
                  ) : users.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">No accounts found.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b-2 border-border text-muted-foreground text-left">
                          <th className="py-3 px-3 font-semibold">Username</th>
                          <th className="py-3 px-3 font-semibold">User ID</th>
                          <th className="py-3 px-3 font-semibold">Last Login</th>
                          <th className="py-3 px-3 font-semibold">Account State</th>
                          <th className="py-3 px-3 font-semibold text-right">Access Control</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((u) => (
                          <tr key={u.user_id} className="border-b border-border last:border-0 hover:bg-accent/40 transition-colors">
                            <td className="py-3 px-3 font-semibold">{u.username}</td>
                            <td className="py-3 px-3 font-mono text-xs text-muted-foreground">{u.user_id}</td>
                            <td className="py-3 px-3 text-xs text-muted-foreground">
                              {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "Never"}
                            </td>
                            <td className="py-3 px-3">
                              <span
                                className={`px-2.5 py-0.5 rounded text-xs font-semibold ${
                                  u.active
                                    ? "bg-emerald-500/15 text-emerald-600 border border-emerald-500/30"
                                    : "bg-rose-500/15 text-rose-600 border border-rose-500/30"
                                }`}
                              >
                                {u.active ? "Enabled" : "Suspended"}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-right">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => toggleUserStatus(u)}
                              >
                                {u.active ? "Suspend" : "Enable"}
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>
              </div>
            )}
          </div>
        </BoundedContainer>
      </PageContainer>
    </AppShell>
  );
}