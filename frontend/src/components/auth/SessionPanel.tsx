import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { LogIn, LogOut, UserRound } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { Button } from "@/components/ui";
import { describePrincipal } from "@/lib/auth";

// Signed-in identity and sign-out control for the staff sidebar (M1-S14).
export function SessionPanel() {
  const { status, user, signOut } = useAuth();
  const navigate = useNavigate();
  const branchId = user?.kind === "STAFF" ? user.branchId : undefined;
  const branchKey = user && branchId ? `${user.userId}:${branchId}` : null;
  const [branch, setBranch] = useState<{ key: string; name: string | null } | null>(null);

  useEffect(() => {
    if (!branchId || !branchKey) return;
    const controller = new AbortController();
    async function loadBranch() {
      let name: string | null = null;
      try {
        const response = await fetch(`/api/branches/${encodeURIComponent(branchId!)}`, {
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (response.ok) {
          const { data } = await response.json();
          if (data?.branchId === branchId && typeof data.name === "string" && data.name.trim()) {
            name = data.name.trim();
          }
        }
      } catch { /* Keep the role visible if branch metadata cannot be loaded. */ }
      if (!controller.signal.aborted) setBranch({ key: branchKey!, name });
    }
    void loadBranch();
    return () => controller.abort();
  }, [branchId, branchKey]);

  if (status === "loading") return null;
  if (!user) {
    return (
      <Button asChild variant="outline" size="sm" className="w-full">
        <Link to="/login">
          <LogIn aria-hidden="true" />
          Sign in
        </Link>
      </Button>
    );
  }
  const branchLabel = user.kind !== "STAFF" ? null
    : !branchId ? "No branch assigned"
    : branch?.key !== branchKey ? "Loading branch…"
    : branch.name ?? "Branch unavailable";
  const identityLabel = [describePrincipal(user), branchLabel].filter(Boolean).join(" · ");
  return (
    <div className="flex w-full min-w-0 items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-secondary">
        <UserRound className="size-4 text-accent" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{user.username}</p>
        <p className="break-words text-xs text-muted-foreground" title={identityLabel}>{identityLabel}</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-9 shrink-0 rounded-xl"
        aria-label="Sign out"
        title="Sign out"
        onClick={async () => {
          await signOut();
          await navigate({ to: "/login" });
        }}
      >
        <LogOut aria-hidden="true" />
      </Button>
    </div>
  );
}
