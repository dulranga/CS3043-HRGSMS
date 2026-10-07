import { Link, useNavigate } from "@tanstack/react-router";
import { LogIn, LogOut, UserRound } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { Button } from "@/components/ui";
import { describePrincipal } from "@/lib/auth";

// Signed-in identity and sign-out control for the staff sidebar (M1-S14).
export function SessionPanel() {
  const { status, user, signOut } = useAuth();
  const navigate = useNavigate();

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
  return (
    <div className="flex w-full min-w-0 items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-secondary">
        <UserRound className="size-4 text-accent" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{user.username}</p>
        <p className="truncate text-xs text-muted-foreground">{describePrincipal(user)}</p>
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
