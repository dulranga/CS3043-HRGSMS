import * as React from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { CircleAlert, Clock, Eye, EyeOff, Hotel, LoaderCircle, Lock } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@/components/ui";
import { AuthError, homePathFor, safeRedirectPath } from "@/lib/auth";
import { cn } from "@/lib/utils";

type FieldErrors = { username?: string; password?: string };

interface FormAlert {
  variant: "default" | "destructive";
  title: string;
  description: string;
  icon: "alert" | "lock" | "clock";
}

function alertFor(error: unknown): FormAlert {
  if (!(error instanceof AuthError)) {
    return { variant: "destructive", icon: "alert", title: "Sign-in failed", description: "Something went wrong. Please try again." };
  }
  switch (error.code) {
    case "INVALID_CREDENTIALS":
      return {
        variant: "destructive",
        icon: "alert",
        title: "Incorrect username or password",
        description: "Check your details and try again. Usernames are case-sensitive.",
      };
    case "ACCOUNT_DISABLED":
      return {
        variant: "destructive",
        icon: "lock",
        title: "Account disabled",
        description:
          "This account has been disabled. Staff should contact their branch manager or a system administrator; guests should contact the hotel.",
      };
    case "TOO_MANY_ATTEMPTS": {
      const minutes = Math.max(1, Math.ceil((error.retryAfterSeconds ?? 900) / 60));
      return {
        variant: "destructive",
        icon: "clock",
        title: "Too many failed attempts",
        description: `Sign-in is paused for this account. Try again in about ${minutes} minutes.`,
      };
    }
    case "NETWORK_ERROR":
      return { variant: "destructive", icon: "alert", title: "Connection problem", description: error.message };
    default:
      return {
        variant: "destructive",
        icon: "alert",
        title: "Sign-in failed",
        description: "The service is temporarily unavailable. Please try again shortly.",
      };
  }
}

function AlertIcon({ icon }: { icon: FormAlert["icon"] }) {
  if (icon === "lock") return <Lock aria-hidden="true" />;
  if (icon === "clock") return <Clock aria-hidden="true" />;
  return <CircleAlert aria-hidden="true" />;
}

export default function LoginPage() {
  const search = useSearch({ from: "/login" });
  const navigate = useNavigate();
  const { status, user, sessionExpired, signIn } = useAuth();

  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [formAlert, setFormAlert] = React.useState<FormAlert | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const usernameRef = React.useRef<HTMLInputElement>(null);
  const passwordRef = React.useRef<HTMLInputElement>(null);
  const redirectTo = safeRedirectPath(search.redirect);

  React.useEffect(() => {
    if (status === "authenticated" && user) {
      void navigate({ to: redirectTo ?? homePathFor(user), replace: true });
    }
  }, [status, user, redirectTo, navigate]);

  const showExpiredNotice = !formAlert && (search.reason === "expired" || sessionExpired);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const errors: FieldErrors = {};
    if (!username.trim()) errors.username = "Enter your username.";
    if (!password) errors.password = "Enter your password.";
    setFieldErrors(errors);
    setFormAlert(null);
    if (errors.username) {
      usernameRef.current?.focus();
      return;
    }
    if (errors.password) {
      passwordRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const info = await signIn(username.trim(), password);
      await navigate({ to: redirectTo ?? homePathFor(info.user), replace: true });
    } catch (error) {
      setFormAlert(alertFor(error));
      setPassword("");
      passwordRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="mx-auto grid min-h-[100dvh] w-full max-w-7xl grid-cols-1 items-center gap-8 px-4 py-8 md:px-6 lg:grid-cols-2">
        <section className="hidden h-full max-h-[40rem] flex-col justify-between rounded-3xl bg-primary p-10 text-primary-foreground shadow-lg lg:flex">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary-foreground/10">
              <Hotel className="size-6" aria-hidden="true" />
            </span>
            <span className="font-display text-xl font-semibold tracking-tight">SkyNest Hotels</span>
          </div>
          <div className="space-y-4">
            <h1 className="font-display text-4xl font-semibold leading-tight tracking-tight">
              One sign-in for our team and our guests.
            </h1>
            <p className="max-w-md text-base leading-relaxed text-primary-foreground/75">
              Staff manage reservations, rooms and billing for their branch. Registered guests book directly with
              SkyNest and manage their own stays.
            </p>
          </div>
          <p className="text-xs tracking-wide text-primary-foreground/60">
            Colombo · Kandy · Galle
          </p>
        </section>

        <div className="mx-auto w-full max-w-md">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Hotel className="size-5" aria-hidden="true" />
            </span>
            <span className="font-display text-lg font-semibold tracking-tight">SkyNest Hotels</span>
          </div>

          <Card className="hover:shadow-md">
            <CardHeader>
              <CardTitle>Sign in</CardTitle>
              <CardDescription>Use the username and password for your staff or guest account.</CardDescription>
            </CardHeader>

            <form noValidate onSubmit={handleSubmit} aria-busy={submitting}>
              <CardContent className="space-y-5">
                {formAlert && (
                  <Alert variant={formAlert.variant}>
                    <AlertIcon icon={formAlert.icon} />
                    <div>
                      <AlertTitle>{formAlert.title}</AlertTitle>
                      <AlertDescription>{formAlert.description}</AlertDescription>
                    </div>
                  </Alert>
                )}
                {showExpiredNotice && (
                  <Alert>
                    <Clock aria-hidden="true" />
                    <div>
                      <AlertTitle>Session expired</AlertTitle>
                      <AlertDescription>You were signed out after a period of inactivity. Sign in again to continue.</AlertDescription>
                    </div>
                  </Alert>
                )}

                <div className="space-y-2">
                  <Label htmlFor="login-username" className={cn(fieldErrors.username && "text-destructive")}>
                    Username
                  </Label>
                  <Input
                    ref={usernameRef}
                    id="login-username"
                    name="username"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    autoFocus
                    maxLength={255}
                    value={username}
                    disabled={submitting}
                    onChange={(event) => {
                      setUsername(event.target.value);
                      if (fieldErrors.username) setFieldErrors((prev) => ({ ...prev, username: undefined }));
                    }}
                    aria-invalid={!!fieldErrors.username}
                    aria-describedby={fieldErrors.username ? "login-username-error" : undefined}
                    className={cn(fieldErrors.username && "border-destructive")}
                  />
                  {fieldErrors.username && (
                    <p id="login-username-error" className="text-xs font-medium text-destructive">
                      {fieldErrors.username}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="login-password" className={cn(fieldErrors.password && "text-destructive")}>
                    Password
                  </Label>
                  <div className="relative">
                    <Input
                      ref={passwordRef}
                      id="login-password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      maxLength={1024}
                      value={password}
                      disabled={submitting}
                      onChange={(event) => {
                        setPassword(event.target.value);
                        if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: undefined }));
                      }}
                      aria-invalid={!!fieldErrors.password}
                      aria-describedby={fieldErrors.password ? "login-password-error" : undefined}
                      className={cn("pr-12", fieldErrors.password && "border-destructive")}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 rounded-xl"
                      onClick={() => setShowPassword((value) => !value)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                      aria-controls="login-password"
                      disabled={submitting}
                    >
                      {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                    </Button>
                  </div>
                  {fieldErrors.password && (
                    <p id="login-password-error" className="text-xs font-medium text-destructive">
                      {fieldErrors.password}
                    </p>
                  )}
                </div>
              </CardContent>

              <CardFooter className="flex-col items-stretch gap-4">
                <Button type="submit" size="lg" disabled={submitting || status === "loading"}>
                  {submitting && <LoaderCircle className="animate-spin" aria-hidden="true" />}
                  {submitting ? "Signing in…" : "Sign in"}
                </Button>
                <p className="text-center text-xs leading-relaxed text-muted-foreground">
                  New guest?{" "}
                  <Link
                    to="/register"
                    search={redirectTo ? { redirect: redirectTo } : {}}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Create an account
                  </Link>
                </p>
                <p className="text-center text-xs leading-relaxed text-muted-foreground">
                  Forgotten your password? Staff should contact a system administrator; guests should contact the hotel
                  front desk.
                </p>
              </CardFooter>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
