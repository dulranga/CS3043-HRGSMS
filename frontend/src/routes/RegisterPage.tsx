import * as React from "react";
import { Link, useSearch } from "@tanstack/react-router";
import { CheckCircle2, CircleAlert, Clock, Eye, EyeOff, Info, KeyRound, LoaderCircle } from "lucide-react";
import { AuthLayout } from "@/components/layout/AuthLayout";
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
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui";
import {
  EMAIL_PATTERN,
  PHONE_PATTERN,
  PASSWORD_MIN_LENGTH,
  RegistrationError,
  USERNAME_PATTERN,
  registerGuest,
  validatePassword,
  type RegistrationResult,
} from "@/lib/registration";
import { safeRedirectPath } from "@/lib/auth";
import { cn } from "@/lib/utils";

type Mode = "NEW" | "LINK";
type FieldErrors = Record<string, string>;

interface FormAlert {
  variant: "default" | "destructive";
  icon: "alert" | "clock" | "key" | "info";
  title: string;
  description: string;
  action?: "switch-to-link";
}

function AlertIcon({ icon }: { icon: FormAlert["icon"] }) {
  if (icon === "clock") return <Clock aria-hidden="true" />;
  if (icon === "key") return <KeyRound aria-hidden="true" />;
  if (icon === "info") return <Info aria-hidden="true" />;
  return <CircleAlert aria-hidden="true" />;
}

function nextFocusKey(errors: FieldErrors, mode: Mode): string | undefined {
  const order =
    mode === "NEW"
      ? ["fullName", "email", "phone", "nic", "username", "password", "confirmPassword"]
      : ["linkCode", "username", "password", "confirmPassword"];
  return order.find((key) => Boolean(errors[key]));
}

export default function RegisterPage() {
  const search = useSearch({ from: "/register" });
  const redirectTo = safeRedirectPath(search.redirect);

  const [mode, setMode] = React.useState<Mode>(search.mode === "LINK" ? "LINK" : "NEW");
  const [fullName, setFullName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [nic, setNic] = React.useState("");
  const [linkCode, setLinkCode] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);

  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [formAlert, setFormAlert] = React.useState<FormAlert | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [success, setSuccess] = React.useState<RegistrationResult | null>(null);

  const fullNameRef = React.useRef<HTMLInputElement>(null);
  const emailRef = React.useRef<HTMLInputElement>(null);
  const phoneRef = React.useRef<HTMLInputElement>(null);
  const nicRef = React.useRef<HTMLInputElement>(null);
  const linkCodeRef = React.useRef<HTMLInputElement>(null);
  const usernameRef = React.useRef<HTMLInputElement>(null);
  const passwordRef = React.useRef<HTMLInputElement>(null);
  const confirmRef = React.useRef<HTMLInputElement>(null);

  const fieldRefs: Record<string, React.RefObject<HTMLInputElement>> = {
    fullName: fullNameRef,
    email: emailRef,
    phone: phoneRef,
    nic: nicRef,
    linkCode: linkCodeRef,
    username: usernameRef,
    password: passwordRef,
    confirmPassword: confirmRef,
  };

  function clearError(field: string) {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function switchMode(next: Mode) {
    if (next === mode || submitting || success) return;
    setMode(next);
    setFieldErrors({});
    setFormAlert(null);
  }

  function applyRegistrationError(error: unknown) {
    if (!(error instanceof RegistrationError)) {
      setFormAlert({
        variant: "destructive",
        icon: "alert",
        title: "Registration failed",
        description: "Something went wrong. Please try again.",
      });
      return;
    }

    switch (error.code) {
      case "VALIDATION_ERROR": {
        const fields = { ...(error.fields ?? {}) };
        // The server reports the combined "need an email or phone" rule under
        // `contact`; surface it on the email field so focus and messaging work.
        if (fields.contact && !fields.email && mode === "NEW") {
          fields.email = fields.contact;
          delete fields.contact;
        }
        if (Object.keys(fields).length > 0) {
          setFieldErrors(fields);
          const focusKey = nextFocusKey(fields, mode);
          if (focusKey) fieldRefs[focusKey]?.current?.focus();
          setFormAlert({
            variant: "destructive",
            icon: "alert",
            title: "Check the highlighted fields",
            description: "Please correct the highlighted fields and try again.",
          });
        } else {
          setFormAlert({
            variant: "destructive",
            icon: "alert",
            title: "Registration failed",
            description: error.message,
          });
        }
        return;
      }
      case "USERNAME_TAKEN":
        setFieldErrors((prev) => ({ ...prev, username: error.message }));
        setFormAlert({
          variant: "destructive",
          icon: "alert",
          title: "Username already taken",
          description: "Choose a different username and try again.",
        });
        usernameRef.current?.focus();
        return;
      case "PROFILE_EXISTS":
        // Never reveal which detail matched; point the guest at the safe path.
        setFormAlert({
          variant: "default",
          icon: "info",
          title: "An existing guest profile matches",
          description: error.message,
          action: "switch-to-link",
        });
        return;
      case "LINK_CODE_USED":
        setFormAlert({
          variant: "destructive",
          icon: "key",
          title: "This profile is already connected",
          description: error.message,
        });
        return;
      case "INVALID_LINK_CODE":
        setFormAlert({
          variant: "destructive",
          icon: "key",
          title: "Link code not accepted",
          description: error.message,
        });
        return;
      case "TOO_MANY_ATTEMPTS": {
        const minutes = Math.max(1, Math.ceil((error.retryAfterSeconds ?? 900) / 60));
        setFormAlert({
          variant: "destructive",
          icon: "clock",
          title: "Too many unsuccessful attempts",
          description: `Please try again in about ${minutes} minutes, or ask the front desk for a new link code.`,
        });
        return;
      }
      case "NETWORK_ERROR":
        setFormAlert({
          variant: "destructive",
          icon: "alert",
          title: "Connection problem",
          description: error.message,
        });
        return;
      default:
        setFormAlert({
          variant: "destructive",
          icon: "alert",
          title: "Registration failed",
          description: "The service is temporarily unavailable. Please try again shortly.",
        });
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || success) return;

    const errors: FieldErrors = {};
    if (mode === "NEW") {
      if (!fullName.trim()) errors.fullName = "Enter the guest's full name.";
      const trimmedEmail = email.trim();
      const trimmedPhone = phone.trim();
      if (!trimmedEmail && !trimmedPhone) {
        errors.email = "Enter an email address or a phone number.";
      } else {
        if (trimmedEmail && !EMAIL_PATTERN.test(trimmedEmail)) {
          errors.email = "Enter a valid email address.";
        }
        if (trimmedPhone && !PHONE_PATTERN.test(trimmedPhone.replace(/[\s().-]/g, ""))) {
          errors.phone = "Enter 7-15 digits with an optional leading +.";
        }
      }
      if (nic.trim().length > 255) errors.nic = "Use at most 255 characters.";
    } else if (!linkCode.trim()) {
      errors.linkCode = "Enter the link code from the front desk.";
    }

    const trimmedUsername = username.trim();
    if (!trimmedUsername) errors.username = "Choose a username.";
    else if (!USERNAME_PATTERN.test(trimmedUsername)) {
      errors.username = "Use 3-64 characters: letters, digits, . _ @ or -.";
    }

    if (!password) errors.password = "Choose a password.";
    else {
      const passwordError = validatePassword(password);
      if (passwordError) errors.password = passwordError;
    }
    if (confirmPassword !== password) errors.confirmPassword = "The passwords do not match.";

    setFieldErrors(errors);
    setFormAlert(null);
    const focusKey = nextFocusKey(errors, mode);
    if (focusKey) {
      fieldRefs[focusKey]?.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const result = await registerGuest(
        mode === "NEW"
          ? {
              mode: "NEW",
              fullName: fullName.trim(),
              email: email.trim() || undefined,
              phone: phone.trim() || undefined,
              nic: nic.trim() || undefined,
              username: trimmedUsername,
              password,
            }
          : {
              mode: "LINK",
              linkCode: linkCode.trim(),
              username: trimmedUsername,
              password,
            },
      );
      setSuccess(result);
    } catch (error) {
      applyRegistrationError(error);
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <AuthLayout activePath="/register" title="You're all set">
        <Card className="hover:shadow-md">
          <CardHeader className="items-center text-center">
            <span className="mx-auto mb-2 flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <CheckCircle2 className="size-6" aria-hidden="true" />
            </span>
            <CardTitle>
              {success.linkedExistingProfile ? "Profile connected" : "Account created"}
            </CardTitle>
            <CardDescription>
              {success.linkedExistingProfile
                ? "Your SkyNest guest profile is now linked to this online account. Sign in to manage your stays."
                : "Your SkyNest guest account is ready. Sign in with the username you just chose."}
            </CardDescription>
          </CardHeader>
          <CardFooter className="flex-col items-stretch gap-3">
            <Button asChild size="lg" className="rounded-full shadow-md hover:shadow-lg">
              <Link to="/login" search={redirectTo ? { redirect: redirectTo } : {}}>
                Go to sign in
              </Link>
            </Button>
          </CardFooter>
        </Card>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      activePath="/register"
      title="Create your account"
      description="Book directly with SkyNest and manage your stays online."
    >
      <Card className="hover:shadow-md">
        <form noValidate onSubmit={handleSubmit} aria-busy={submitting}>
          <CardContent className="space-y-5 pt-6">
            <Tabs
              value={mode}
              onValueChange={(value) => switchMode(value as Mode)}
              className="space-y-5"
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="NEW" disabled={submitting}>
                  New guest
                </TabsTrigger>
                <TabsTrigger value="LINK" disabled={submitting}>
                  I have a link code
                </TabsTrigger>
              </TabsList>

            {formAlert && (
              <Alert variant={formAlert.variant}>
                <AlertIcon icon={formAlert.icon} />
                <div>
                  <AlertTitle>{formAlert.title}</AlertTitle>
                  <AlertDescription>{formAlert.description}</AlertDescription>
                  {formAlert.action === "switch-to-link" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() => switchMode("LINK")}
                    >
                      <KeyRound aria-hidden="true" />
                      Enter a link code instead
                    </Button>
                  )}
                </div>
              </Alert>
            )}

              <TabsContent value="NEW" className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="register-fullname" className={cn(fieldErrors.fullName && "text-destructive")}>
                    Full name
                  </Label>
                  <Input
                    ref={fullNameRef}
                    id="register-fullname"
                    name="fullName"
                    autoComplete="name"
                    autoFocus
                    maxLength={255}
                    value={fullName}
                    disabled={submitting}
                    aria-invalid={!!fieldErrors.fullName}
                    aria-describedby={fieldErrors.fullName ? "register-fullname-error" : undefined}
                    className={cn(fieldErrors.fullName && "border-destructive")}
                    onChange={(event) => {
                      setFullName(event.target.value);
                      clearError("fullName");
                    }}
                  />
                  {fieldErrors.fullName && (
                    <p id="register-fullname-error" className="text-xs font-medium text-destructive">
                      {fieldErrors.fullName}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="register-email" className={cn(fieldErrors.email && "text-destructive")}>
                    Email <span className="font-normal text-muted-foreground">(or phone)</span>
                  </Label>
                  <Input
                    ref={emailRef}
                    id="register-email"
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    maxLength={255}
                    value={email}
                    disabled={submitting}
                    aria-invalid={!!fieldErrors.email}
                    aria-describedby={fieldErrors.email ? "register-email-error" : undefined}
                    className={cn(fieldErrors.email && "border-destructive")}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      clearError("email");
                    }}
                  />
                  {fieldErrors.email && (
                    <p id="register-email-error" className="text-xs font-medium text-destructive">
                      {fieldErrors.email}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="register-phone" className={cn(fieldErrors.phone && "text-destructive")}>
                    Phone <span className="font-normal text-muted-foreground">(or email)</span>
                  </Label>
                  <Input
                    ref={phoneRef}
                    id="register-phone"
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    maxLength={32}
                    value={phone}
                    disabled={submitting}
                    aria-invalid={!!fieldErrors.phone}
                    aria-describedby={fieldErrors.phone ? "register-phone-error" : undefined}
                    className={cn(fieldErrors.phone && "border-destructive")}
                    onChange={(event) => {
                      setPhone(event.target.value);
                      clearError("phone");
                    }}
                  />
                  {fieldErrors.phone && (
                    <p id="register-phone-error" className="text-xs font-medium text-destructive">
                      {fieldErrors.phone}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="register-nic" className={cn(fieldErrors.nic && "text-destructive")}>
                    NIC / identity reference{" "}
                    <span className="font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    ref={nicRef}
                    id="register-nic"
                    name="nic"
                    autoCapitalize="characters"
                    spellCheck={false}
                    maxLength={255}
                    value={nic}
                    disabled={submitting}
                    aria-invalid={!!fieldErrors.nic}
                    aria-describedby={fieldErrors.nic ? "register-nic-error" : "register-nic-help"}
                    className={cn(fieldErrors.nic && "border-destructive")}
                    onChange={(event) => {
                      setNic(event.target.value);
                      clearError("nic");
                    }}
                  />
                  {fieldErrors.nic ? (
                    <p id="register-nic-error" className="text-xs font-medium text-destructive">
                      {fieldErrors.nic}
                    </p>
                  ) : (
                    <p id="register-nic-help" className="text-xs text-muted-foreground">
                      Keep this private. Only the last four characters are shown to staff later.
                    </p>
                  )}
                </div>
              </TabsContent>
              <TabsContent value="LINK" className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="register-linkcode" className={cn(fieldErrors.linkCode && "text-destructive")}>
                  Link code
                </Label>
                <Input
                  ref={linkCodeRef}
                  id="register-linkcode"
                  name="linkCode"
                  autoComplete="one-time-code"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus
                  value={linkCode}
                  disabled={submitting}
                  aria-invalid={!!fieldErrors.linkCode}
                  aria-describedby={fieldErrors.linkCode ? "register-linkcode-error" : "register-linkcode-help"}
                  className={cn(fieldErrors.linkCode && "border-destructive")}
                  onChange={(event) => {
                    setLinkCode(event.target.value);
                    clearError("linkCode");
                  }}
                />
                {fieldErrors.linkCode ? (
                  <p id="register-linkcode-error" className="text-xs font-medium text-destructive">
                    {fieldErrors.linkCode}
                  </p>
                ) : (
                  <p id="register-linkcode-help" className="text-xs text-muted-foreground">
                    Issued by the front desk after an identity check. It expires after 24 hours.
                  </p>
                )}
              </div>
              </TabsContent>
            </Tabs>

            <div className="space-y-2">
              <Label htmlFor="register-username" className={cn(fieldErrors.username && "text-destructive")}>
                Username
              </Label>
              <Input
                ref={usernameRef}
                id="register-username"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={64}
                value={username}
                disabled={submitting}
                aria-invalid={!!fieldErrors.username}
                aria-describedby={fieldErrors.username ? "register-username-error" : undefined}
                className={cn(fieldErrors.username && "border-destructive")}
                onChange={(event) => {
                  setUsername(event.target.value);
                  clearError("username");
                }}
              />
              {fieldErrors.username ? (
                <p id="register-username-error" className="text-xs font-medium text-destructive">
                  {fieldErrors.username}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Used to sign in. Usernames are matched without regard to letter case.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="register-password" className={cn(fieldErrors.password && "text-destructive")}>
                Password
              </Label>
              <div className="relative">
                <Input
                  ref={passwordRef}
                  id="register-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  maxLength={1024}
                  value={password}
                  disabled={submitting}
                  aria-invalid={!!fieldErrors.password}
                  aria-describedby={fieldErrors.password ? "register-password-error" : "register-password-help"}
                  className={cn("pr-12", fieldErrors.password && "border-destructive")}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    clearError("password");
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 rounded-xl"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  aria-controls="register-password"
                  disabled={submitting}
                >
                  {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                </Button>
              </div>
              {fieldErrors.password ? (
                <p id="register-password-error" className="text-xs font-medium text-destructive">
                  {fieldErrors.password}
                </p>
              ) : (
                <p id="register-password-help" className="text-xs text-muted-foreground">
                  At least {PASSWORD_MIN_LENGTH} characters.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="register-confirm" className={cn(fieldErrors.confirmPassword && "text-destructive")}>
                Confirm password
              </Label>
              <Input
                ref={confirmRef}
                id="register-confirm"
                name="confirmPassword"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                maxLength={1024}
                value={confirmPassword}
                disabled={submitting}
                aria-invalid={!!fieldErrors.confirmPassword}
                aria-describedby={fieldErrors.confirmPassword ? "register-confirm-error" : undefined}
                className={cn(fieldErrors.confirmPassword && "border-destructive")}
                onChange={(event) => {
                  setConfirmPassword(event.target.value);
                  clearError("confirmPassword");
                }}
              />
              {fieldErrors.confirmPassword && (
                <p id="register-confirm-error" className="text-xs font-medium text-destructive">
                  {fieldErrors.confirmPassword}
                </p>
              )}
            </div>
          </CardContent>

          <CardFooter className="flex-col items-stretch gap-4">
            <Button
              type="submit"
              size="lg"
              className="rounded-full shadow-md hover:shadow-lg"
              disabled={submitting}
            >
              {submitting && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              {submitting ? "Creating account…" : "Create account"}
            </Button>
          </CardFooter>
        </form>
      </Card>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          to="/login"
          search={redirectTo ? { redirect: redirectTo } : {}}
          className="font-semibold text-primary underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
