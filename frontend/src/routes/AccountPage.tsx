import * as React from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Check,
  CircleAlert,
  Hotel,
  Info,
  LoaderCircle,
  LogOut,
  Pencil,
  ShieldAlert,
  X,
} from "lucide-react";
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
import {
  GuestAccountError,
  getOwnProfile,
  updateOwnProfile,
  type GuestAccountProfile,
  type GuestAccountUpdateInput,
} from "@/lib/guestAccount";
import { GuestReservations } from "@/components/account/GuestReservations";
import { cn } from "@/lib/utils";

// M1-S17 online guest own-profile UI. Guest-only and free of staff search or
// navigation. The server derives the guest from the session, so no guest ID is
// ever sent or accepted by this page.

type FieldErrors = Record<string, string>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function normalizeServerFields(fields: Record<string, string> | undefined): FieldErrors {
  if (!fields) return {};
  const copy = { ...fields };
  if (copy.contact && !copy.email) {
    copy.email = copy.contact;
    delete copy.contact;
  }
  return copy;
}

export default function AccountPage() {
  const { status, user, signOut } = useAuth();
  const navigate = useNavigate();
  const isGuest = user?.kind === "GUEST" && Boolean(user.guestId);

  const [profile, setProfile] = React.useState<GuestAccountProfile | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [forbidden, setForbidden] = React.useState(false);
  const [sessionEnded, setSessionEnded] = React.useState(false);

  const [editing, setEditing] = React.useState(false);
  const [editFullName, setEditFullName] = React.useState("");
  const [editEmail, setEditEmail] = React.useState("");
  const [editPhone, setEditPhone] = React.useState("");
  const [editNic, setEditNic] = React.useState("");
  const [editDirty, setEditDirty] = React.useState<Set<string>>(new Set());
  const [saving, setSaving] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);
  const [editFieldErrors, setEditFieldErrors] = React.useState<FieldErrors>({});
  const [duplicate, setDuplicate] = React.useState<{ nicConflict: boolean } | null>(null);
  const [feedback, setFeedback] = React.useState<string | null>(null);
  const fullNameRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (status !== "authenticated" || !isGuest) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    getOwnProfile()
      .then((data) => {
        if (!cancelled) setProfile(data);
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof GuestAccountError) {
          if (error.code === "FORBIDDEN") setForbidden(true);
          else if (error.code === "AUTHENTICATION_REQUIRED" || error.code === "GUEST_INACTIVE" || error.code === "GUEST_NOT_FOUND") {
            setSessionEnded(true);
          } else {
            setLoadError(error.message);
          }
        } else {
          setLoadError("Could not load your profile. Please try again.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status, isGuest, user?.guestId]);

  function markDirty(field: string) {
    setEditDirty((prev) => {
      const next = new Set(prev);
      next.add(field);
      return next;
    });
  }

  function startEdit() {
    if (!profile) return;
    setEditFullName(profile.fullName);
    setEditEmail(profile.email ?? "");
    setEditPhone(profile.phone ?? "");
    setEditNic("");
    setEditDirty(new Set());
    setEditError(null);
    setEditFieldErrors({});
    setDuplicate(null);
    setFeedback(null);
    setEditing(true);
  }

  function validate(
    values: { fullName: string; email: string; phone: string },
  ): { errors: FieldErrors; fullName: string; email: string; phone: string } {
    const errors: FieldErrors = {};
    const fullName = values.fullName.trim();
    if (!fullName) errors.fullName = "Enter your full name.";
    else if (fullName.length > 255) errors.fullName = "Use at most 255 characters.";
    const email = values.email.trim().toLowerCase();
    const phone = values.phone.trim();
    if (email && !EMAIL_PATTERN.test(email)) errors.email = "Enter a valid email address.";
    if (phone && !PHONE_PATTERN.test(phone.replace(/[\s().-]/g, ""))) {
      errors.phone = "Enter 7-15 digits with an optional leading +.";
    }
    if (!email && !phone && !errors.email && !errors.phone) {
      errors.email = "Keep at least one contact method: an email address or phone number.";
    }
    return { errors, fullName, email, phone };
  }

  async function submitUpdate(confirm: boolean) {
    if (!profile || saving) return;
    const input: GuestAccountUpdateInput = {};
    if (editDirty.has("fullName")) input.fullName = editFullName.trim();
    if (editDirty.has("email")) input.email = editEmail.trim() ? editEmail.trim().toLowerCase() : null;
    if (editDirty.has("phone")) input.phone = editPhone.trim() ? editPhone.trim() : null;
    if (editDirty.has("nic")) input.nic = editNic.trim() ? editNic.trim().toUpperCase() : null;

    if (Object.keys(input).length === 0) {
      setEditing(false);
      return;
    }

    const effective = {
      fullName: "fullName" in input ? (input.fullName as string) : profile.fullName,
      email: "email" in input ? (input.email ?? "") : (profile.email ?? ""),
      phone: "phone" in input ? (input.phone ?? "") : (profile.phone ?? ""),
    };
    const { errors } = validate(effective);
    setEditFieldErrors(errors);
    setEditError(null);
    if (!confirm) setDuplicate(null);
    if (Object.keys(errors).length > 0) {
      fullNameRef.current?.focus();
      return;
    }

    setSaving(true);
    try {
      const updated = await updateOwnProfile({ ...input, confirmNotDuplicate: confirm || undefined });
      setProfile(updated);
      setEditing(false);
      setDuplicate(null);
      setFeedback("Your profile was updated.");
    } catch (error) {
      if (error instanceof GuestAccountError) {
        if (error.code === "FORBIDDEN") {
          setForbidden(true);
        } else if (error.code === "AUTHENTICATION_REQUIRED" || error.code === "GUEST_INACTIVE") {
          setSessionEnded(true);
        } else if (error.code === "INVALID_INPUT") {
          setEditFieldErrors(normalizeServerFields(error.fields));
          fullNameRef.current?.focus();
        } else if (error.code === "GUEST_NIC_EXISTS" || error.code === "POSSIBLE_DUPLICATE") {
          setDuplicate({ nicConflict: error.code === "GUEST_NIC_EXISTS" });
        } else {
          setEditError(error.message);
        }
      } else {
        setEditError("Could not save your changes. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    await navigate({ to: "/" });
  }

  function GuestTopBar() {
    return (
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md">
              <Hotel className="size-5" aria-hidden="true" />
            </span>
            <span className="font-display text-xl font-semibold tracking-tight">SkyNest</span>
          </Link>
          {isGuest && (
            <Button variant="outline" size="sm" onClick={() => void handleSignOut()}>
              <LogOut aria-hidden="true" />
              Sign out
            </Button>
          )}
        </div>
      </header>
    );
  }

  function StateCard({
    icon,
    title,
    description,
    action,
  }: {
    icon: React.ReactNode;
    title: string;
    description: React.ReactNode;
    action: React.ReactNode;
  }) {
    return (
      <Card className="w-full max-w-lg hover:shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {icon}
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">{action}</CardContent>
      </Card>
    );
  }

  function renderContent() {
    if (status === "loading" || (loading && isGuest)) {
      return (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="animate-spin" aria-hidden="true" /> Loading your account…
        </p>
      );
    }

    if (status === "anonymous") {
      return (
        <StateCard
          icon={<Hotel className="size-5 text-accent" aria-hidden="true" />}
          title="Sign in to view your account"
          description="Your SkyNest profile and reservations are available to signed-in guests."
          action={
            <Button asChild>
              <Link to="/login" search={{ redirect: "/account" }}>
                Sign in
              </Link>
            </Button>
          }
        />
      );
    }

    if (forbidden || (status === "authenticated" && !isGuest)) {
      return (
        <StateCard
          icon={<ShieldAlert className="size-5 text-destructive" aria-hidden="true" />}
          title="This area is for guest accounts"
          description="Staff accounts manage guests from the staff tools. Sign in with a guest account to view your own profile here."
          action={
            <Button asChild variant="outline">
              <Link to={user?.kind === "STAFF" ? "/dashboard" : "/"}>Back to SkyNest</Link>
            </Button>
          }
        />
      );
    }

    if (sessionEnded) {
      return (
        <StateCard
          icon={<ShieldAlert className="size-5 text-destructive" aria-hidden="true" />}
          title="Your account is not available"
          description="This account may have been deactivated or the session has ended. Please sign in again or contact the hotel."
          action={
            <Button asChild>
              <Link to="/login" search={{ redirect: "/account" }}>
                Sign in again
              </Link>
            </Button>
          }
        />
      );
    }

    if (loadError) {
      return (
        <Alert variant="destructive" className="max-w-lg">
          <CircleAlert aria-hidden="true" />
          <div>
            <AlertTitle>Could not load your profile</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </div>
        </Alert>
      );
    }

    if (!profile) return null;

    return (
      <div className="w-full max-w-3xl space-y-6">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Welcome back, {profile.fullName.split(" ")[0]}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            View and update your SkyNest guest profile. Your NIC stays protected and is only ever shown masked.
          </p>
        </div>

        {feedback && (
          <Alert role="status">
            <Check aria-hidden="true" />
            <div>
              <AlertTitle>Saved</AlertTitle>
              <AlertDescription>{feedback}</AlertDescription>
            </div>
          </Alert>
        )}

        {duplicate && (
          <Alert variant={duplicate.nicConflict ? "destructive" : "default"} role="alert">
            {duplicate.nicConflict ? <CircleAlert aria-hidden="true" /> : <Info aria-hidden="true" />}
            <div>
              <AlertTitle>{duplicate.nicConflict ? "That NIC is already registered" : "These details already exist"}</AlertTitle>
              <AlertDescription>
                {duplicate.nicConflict
                  ? "Another guest profile already uses that NIC. Enter a different one, or leave the field blank to keep your current NIC."
                  : "A guest profile with these contact details may already exist. If these are your details, confirm to save them."}
              </AlertDescription>
              {!duplicate.nicConflict && (
                <div className="mt-3 flex gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => void submitUpdate(true)}>
                    These are my details — save
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setDuplicate(null)}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          </Alert>
        )}

        {!editing ? (
          <Card className="hover:shadow-md">
            <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle>{profile.fullName}</CardTitle>
                <CardDescription>Guest profile</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={startEdit}>
                <Pencil aria-hidden="true" />
                Edit profile
              </Button>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email</dt>
                  <dd className="mt-0.5 text-sm">{profile.email || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Phone</dt>
                  <dd className="mt-0.5 text-sm">{profile.phone || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">NIC</dt>
                  <dd className="mt-0.5 font-mono text-sm">{profile.maskedNic ?? "Not recorded"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Member since</dt>
                  <dd className="mt-0.5 text-sm">{formatDate(profile.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Last updated</dt>
                  <dd className="mt-0.5 text-sm">{formatDate(profile.updatedAt)}</dd>
                </div>
              </dl>
            </CardContent>
            <CardFooter className="text-xs text-muted-foreground">
              Your profile details are used for your reservations and billing. Keep them up to date.
            </CardFooter>
          </Card>
        ) : (
          <Card className="hover:shadow-md">
            <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle>Edit profile</CardTitle>
                <CardDescription>Changes are saved to your guest record.</CardDescription>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Cancel editing"
                onClick={() => {
                  setEditing(false);
                  setEditError(null);
                  setDuplicate(null);
                }}
              >
                <X aria-hidden="true" />
              </Button>
            </CardHeader>
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void submitUpdate(false);
              }}
            >
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="account-fullname" className={cn(editFieldErrors.fullName && "text-destructive")}>
                    Full name
                  </Label>
                  <Input
                    ref={fullNameRef}
                    id="account-fullname"
                    value={editFullName}
                    maxLength={255}
                    autoComplete="name"
                    aria-invalid={!!editFieldErrors.fullName}
                    aria-describedby={editFieldErrors.fullName ? "account-fullname-error" : undefined}
                    className={cn(editFieldErrors.fullName && "border-destructive")}
                    onChange={(event) => {
                      setEditFullName(event.target.value);
                      markDirty("fullName");
                    }}
                  />
                  {editFieldErrors.fullName && (
                    <p id="account-fullname-error" className="text-xs font-medium text-destructive">
                      {editFieldErrors.fullName}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="account-email" className={cn(editFieldErrors.email && "text-destructive")}>
                      Email
                    </Label>
                    <Input
                      id="account-email"
                      type="email"
                      value={editEmail}
                      maxLength={255}
                      autoComplete="email"
                      aria-invalid={!!editFieldErrors.email}
                      aria-describedby={editFieldErrors.email ? "account-email-error" : undefined}
                      className={cn(editFieldErrors.email && "border-destructive")}
                      onChange={(event) => {
                        setEditEmail(event.target.value);
                        markDirty("email");
                      }}
                    />
                    {editFieldErrors.email && (
                      <p id="account-email-error" className="text-xs font-medium text-destructive">
                        {editFieldErrors.email}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="account-phone" className={cn(editFieldErrors.phone && "text-destructive")}>
                      Phone
                    </Label>
                    <Input
                      id="account-phone"
                      type="tel"
                      value={editPhone}
                      maxLength={32}
                      autoComplete="tel"
                      aria-invalid={!!editFieldErrors.phone}
                      aria-describedby={editFieldErrors.phone ? "account-phone-error" : undefined}
                      className={cn(editFieldErrors.phone && "border-destructive")}
                      onChange={(event) => {
                        setEditPhone(event.target.value);
                        markDirty("phone");
                      }}
                    />
                    {editFieldErrors.phone && (
                      <p id="account-phone-error" className="text-xs font-medium text-destructive">
                        {editFieldErrors.phone}
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="account-nic" className={cn(editFieldErrors.nic && "text-destructive")}>
                    Replace NIC <span className="font-normal text-muted-foreground">(leave blank to keep current)</span>
                  </Label>
                  <Input
                    id="account-nic"
                    value={editNic}
                    maxLength={255}
                    autoCapitalize="characters"
                    spellCheck={false}
                    placeholder={profile.hasNic ? `Current: ${profile.maskedNic}` : "No NIC recorded"}
                    aria-invalid={!!editFieldErrors.nic}
                    aria-describedby={editFieldErrors.nic ? "account-nic-error" : "account-nic-help"}
                    className={cn(editFieldErrors.nic && "border-destructive")}
                    onChange={(event) => {
                      setEditNic(event.target.value);
                      markDirty("nic");
                    }}
                  />
                  {editFieldErrors.nic ? (
                    <p id="account-nic-error" className="text-xs font-medium text-destructive">
                      {editFieldErrors.nic}
                    </p>
                  ) : (
                    <p id="account-nic-help" className="text-xs text-muted-foreground">
                      Your current NIC is masked and cannot be read back. Clearing this field removes the stored NIC.
                    </p>
                  )}
                </div>

                {editError && (
                  <Alert variant="destructive">
                    <CircleAlert aria-hidden="true" />
                    <div>
                      <AlertTitle>Could not save your changes</AlertTitle>
                      <AlertDescription>{editError}</AlertDescription>
                    </div>
                  </Alert>
                )}
              </CardContent>
              <CardFooter className="gap-3">
                <Button type="submit" disabled={saving}>
                  {saving && <LoaderCircle className="animate-spin" aria-hidden="true" />}
                  {saving ? "Saving…" : "Save changes"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => {
                    setEditing(false);
                    setEditError(null);
                    setDuplicate(null);
                  }}
                >
                  Cancel
                </Button>
              </CardFooter>
            </form>
          </Card>
        )}

        <section aria-labelledby="account-reservations-heading" className="space-y-3">
          <div>
            <h2 id="account-reservations-heading" className="font-display text-lg font-semibold tracking-tight">
              Your reservations
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Only bookings linked to your guest account are shown. Each booking lists all of its room lines, and
              payments are shown once per booking.
            </p>
          </div>
          <GuestReservations />
        </section>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background text-foreground antialiased">
      <GuestTopBar />
      <main className="mx-auto flex max-w-7xl justify-center px-4 py-8 md:px-6 md:py-12">{renderContent()}</main>
    </div>
  );
}
