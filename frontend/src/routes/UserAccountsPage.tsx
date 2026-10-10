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
import { useAuth } from "@/components/auth/AuthProvider";

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

export default function UserAccountsPage() {
  const { user: sessionUser } = useAuth();
  const canWrite = sessionUser?.kind === 'STAFF' && sessionUser.role === 'SYSTEM_ADMINISTRATOR';

  const [users, setUsers] = useState<UserAccount[]>([]);
  const [userLoading, setUserLoading] = useState<boolean>(true);
  const [userSearch, setUserSearch] = useState<string>("");

  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

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
    void loadUsers();
  }, []);

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
            <header>
              <h1 className="text-2xl font-bold tracking-tight">User Accounts</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Review staff user accounts and enable or suspend access.
              </p>
            </header>

            {statusMessage && (
              <Alert variant={statusMessage.type === "error" ? "destructive" : "default"}><AlertDescription>{statusMessage.text}</AlertDescription></Alert>
            )}

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
        </BoundedContainer>
      </PageContainer>
    </AppShell>
  );
}
