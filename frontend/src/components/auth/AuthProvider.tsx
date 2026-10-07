import * as React from "react";
import { fetchSession, login as loginRequest, logout as logoutRequest, type SessionInfo, type SessionUser } from "@/lib/auth";

type AuthStatus = "loading" | "authenticated" | "anonymous";

interface AuthContextValue {
  status: AuthStatus;
  user: SessionUser | null;
  idleTimeoutMinutes: number | null;
  sessionExpired: boolean;
  signIn: (username: string, password: string) => Promise<SessionInfo>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<AuthStatus>("loading");
  const [session, setSession] = React.useState<SessionInfo | null>(null);
  const [sessionExpired, setSessionExpired] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try {
      const result = await fetchSession();
      setSession(result.session);
      setSessionExpired(result.expired);
      setStatus(result.session ? "authenticated" : "anonymous");
    } catch {
      setSession(null);
      setStatus("anonymous");
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = React.useCallback(async (username: string, password: string) => {
    const info = await loginRequest(username, password);
    setSession(info);
    setSessionExpired(false);
    setStatus("authenticated");
    return info;
  }, []);

  const signOut = React.useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      setSession(null);
      setSessionExpired(false);
      setStatus("anonymous");
    }
  }, []);

  const value = React.useMemo<AuthContextValue>(
    () => ({
      status,
      user: session?.user ?? null,
      idleTimeoutMinutes: session?.idleTimeoutMinutes ?? null,
      sessionExpired,
      signIn,
      signOut,
      refresh,
    }),
    [status, session, sessionExpired, signIn, signOut, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = React.useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within <AuthProvider>");
  return context;
}
