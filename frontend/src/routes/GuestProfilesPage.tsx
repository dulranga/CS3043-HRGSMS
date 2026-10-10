import * as React from "react";
import { Link } from "@tanstack/react-router";
import {
  Check,
  CircleAlert,
  Copy,
  Info,
  KeyRound,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Search,
  ShieldAlert,
  UserCheck,
  UserPlus,
  UserX,
  X,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { PageContainer } from "@/components/layout/PageContainer";
import { BoundedContainer } from "@/components/layout/BoundedContainer";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui";
import {
  GuestApiError,
  createGuest,
  getGuest,
  issueGuestLinkCode,
  searchGuests,
  setGuestActive,
  updateGuest,
  type GuestCandidate,
  type GuestLinkCode,
  type GuestMatchField,
  type GuestProfile,
  type GuestUpdateInput,
} from "@/lib/guests";
import { cn } from "@/lib/utils";

// M1-S16 staff guest-profile UI. FRONT_DESK only (`guest.manage`), chain-wide.

type Tab = "SEARCH" | "NEW";
type FieldErrors = Record<string, string>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;
const MATCH_LABELS: Record<GuestMatchField, string> = {
  email: "email",
  phone: "phone",
  nic: "NIC",
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function normalizeServerFields(
  fields: Record<string, string> | undefined,
): FieldErrors {
  if (!fields) return {};
  const copy = { ...fields };
  if (copy.contact && !copy.email) {
    copy.email = copy.contact;
    delete copy.contact;
  }
  return copy;
}

interface Feedback {
  type: "success" | "error";
  text: string;
}

export default function GuestProfilesPage() {
  const { status, user } = useAuth();
  const canManage = user?.kind === "STAFF" && user.role === "FRONT_DESK";
  const [denied, setDenied] = React.useState(false);
  const restricted = !canManage || denied;

  const [tab, setTab] = React.useState<Tab>("SEARCH");
  const [feedback, setFeedback] = React.useState<Feedback | null>(null);

  // Search
  const [query, setQuery] = React.useState("");
  const [nic, setNic] = React.useState("");
  const [includeInactive, setIncludeInactive] = React.useState(false);
  const [searching, setSearching] = React.useState(false);
  const [searched, setSearched] = React.useState(false);
  const [results, setResults] = React.useState<GuestProfile[]>([]);
  const [truncated, setTruncated] = React.useState(false);
  const [searchError, setSearchError] = React.useState<string | null>(null);
  const [searchFieldErrors, setSearchFieldErrors] = React.useState<FieldErrors>(
    {},
  );
  const queryRef = React.useRef<HTMLInputElement>(null);
  const nicRef = React.useRef<HTMLInputElement>(null);

  // Create
  const [newFullName, setNewFullName] = React.useState("");
  const [newEmail, setNewEmail] = React.useState("");
  const [newPhone, setNewPhone] = React.useState("");
  const [newNic, setNewNic] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);
  const [createFieldErrors, setCreateFieldErrors] = React.useState<FieldErrors>(
    {},
  );
  const newFullNameRef = React.useRef<HTMLInputElement>(null);

  // Duplicate confirmation (shared by create and update)
  const [duplicate, setDuplicate] = React.useState<{
    mode: "create" | "update";
    candidates: GuestCandidate[];
    nicConflict: boolean;
  } | null>(null);

  // Selected profile detail
  const [selected, setSelected] = React.useState<GuestProfile | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [detailError, setDetailError] = React.useState<string | null>(null);

  // Edit
  const [editing, setEditing] = React.useState(false);
  const [editFullName, setEditFullName] = React.useState("");
  const [editEmail, setEditEmail] = React.useState("");
  const [editPhone, setEditPhone] = React.useState("");
  const [editNic, setEditNic] = React.useState("");
  const [editDirty, setEditDirty] = React.useState<Set<string>>(new Set());
  const [saving, setSaving] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);
  const [editFieldErrors, setEditFieldErrors] = React.useState<FieldErrors>({});
  const editFullNameRef = React.useRef<HTMLInputElement>(null);

  // Deactivate
  const [deactivateOpen, setDeactivateOpen] = React.useState(false);
  const [deactivateReason, setDeactivateReason] = React.useState("");
  const [togglingActive, setTogglingActive] = React.useState(false);

  // Link code
  const [linkCode, setLinkCode] = React.useState<GuestLinkCode | null>(null);
  const [issuing, setIssuing] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  function selectGuest(profile: GuestProfile) {
    setSelected(profile);
    setDetailError(null);
    setEditing(false);
    setEditError(null);
    setEditFieldErrors({});
    setEditDirty(new Set());
    setDeactivateOpen(false);
    setDeactivateReason("");
    setLinkCode(null);
    setCopied(false);
  }

  function applyMutation(updated: GuestProfile) {
    setSelected(updated);
    setResults((prev) =>
      prev.map((g) => (g.guestId === updated.guestId ? updated : g)),
    );
  }

  function handleTabChange(value: string) {
    setTab(value as Tab);
    setFeedback(null);
  }

  function markEditDirty(field: string) {
    setEditDirty((prev) => {
      const next = new Set(prev);
      next.add(field);
      return next;
    });
  }

  async function handleSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (searching) return;
    const q = query.trim();
    const n = nic.trim();
    const errors: FieldErrors = {};
    if (!q && !n) errors.query = "Enter a name, email, phone or full NIC.";
    else if (q && q.length < 2) errors.query = "Enter at least 2 characters.";
    setSearchFieldErrors(errors);
    setSearchError(null);
    setFeedback(null);
    if (errors.query) {
      queryRef.current?.focus();
      return;
    }
    setSearching(true);
    try {
      const result = await searchGuests({
        query: q || undefined,
        nic: n || undefined,
        includeInactive,
      });
      setResults(result.guests);
      setTruncated(result.truncated);
      setSearched(true);
    } catch (error) {
      if (
        error instanceof GuestApiError &&
        (error.code === "FORBIDDEN" || error.code === "AUTHENTICATION_REQUIRED")
      ) {
        setDenied(true);
      } else {
        setSearchError(
          error instanceof GuestApiError
            ? error.message
            : "Search failed. Please try again.",
        );
      }
    } finally {
      setSearching(false);
    }
  }

  async function loadGuest(guestId: string) {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const profile = await getGuest(guestId);
      selectGuest(profile);
    } catch (error) {
      setDetailError(
        error instanceof GuestApiError
          ? error.message
          : "Could not load this profile.",
      );
    } finally {
      setDetailLoading(false);
    }
  }

  function validateFields(
    values: { fullName: string; email: string; phone: string; nic: string },
    options: { requireFullName: boolean; requireContact: boolean },
  ): { errors: FieldErrors; fullName: string; email: string; phone: string } {
    const errors: FieldErrors = {};
    const fullName = values.fullName.trim();
    if (options.requireFullName && !fullName)
      errors.fullName = "Enter the guest's full name.";
    else if (fullName.length > 255)
      errors.fullName = "Use at most 255 characters.";
    const email = values.email.trim().toLowerCase();
    const phone = values.phone.trim();
    if (email && !EMAIL_PATTERN.test(email))
      errors.email = "Enter a valid email address.";
    if (phone && !PHONE_PATTERN.test(phone.replace(/[\s().-]/g, ""))) {
      errors.phone = "Enter 7-15 digits with an optional leading +.";
    }
    if (values.nic.trim().length > 255)
      errors.nic = "Use at most 255 characters.";
    if (
      options.requireContact &&
      !email &&
      !phone &&
      !errors.email &&
      !errors.phone
    ) {
      errors.email = "Enter an email address or a phone number.";
    }
    return { errors, fullName, email, phone };
  }

  async function submitCreate(confirm: boolean) {
    if (creating) return;
    const { errors, fullName, email, phone } = validateFields(
      { fullName: newFullName, email: newEmail, phone: newPhone, nic: newNic },
      { requireFullName: true, requireContact: true },
    );
    setCreateFieldErrors(errors);
    setCreateError(null);
    if (!confirm) setDuplicate(null);
    setFeedback(null);
    if (Object.keys(errors).length > 0) {
      newFullNameRef.current?.focus();
      return;
    }
    setCreating(true);
    try {
      const created = await createGuest({
        fullName,
        email: email || undefined,
        phone: phone || undefined,
        nic: newNic.trim() || undefined,
        confirmNotDuplicate: confirm || undefined,
      });
      setNewFullName("");
      setNewEmail("");
      setNewPhone("");
      setNewNic("");
      setDuplicate(null);
      selectGuest(created);
      setResults((prev) => (searched ? [created, ...prev] : prev));
      setFeedback({
        type: "success",
        text: `Profile created for ${created.fullName}.`,
      });
      setTab("SEARCH");
    } catch (error) {
      if (error instanceof GuestApiError) {
        if (
          error.code === "FORBIDDEN" ||
          error.code === "AUTHENTICATION_REQUIRED"
        ) {
          setDenied(true);
        } else if (error.code === "VALIDATION_ERROR") {
          setCreateFieldErrors(normalizeServerFields(error.fields));
          newFullNameRef.current?.focus();
        } else if (
          error.code === "POSSIBLE_DUPLICATE" ||
          error.code === "GUEST_NIC_EXISTS"
        ) {
          setDuplicate({
            mode: "create",
            candidates: error.candidates ?? [],
            nicConflict: error.code === "GUEST_NIC_EXISTS",
          });
        } else {
          setCreateError(error.message);
        }
      } else {
        setCreateError("Could not create the profile. Please try again.");
      }
    } finally {
      setCreating(false);
    }
  }

  function startEdit() {
    if (!selected) return;
    setEditFullName(selected.fullName);
    setEditEmail(selected.email ?? "");
    setEditPhone(selected.phone ?? "");
    setEditNic("");
    setEditDirty(new Set());
    setEditError(null);
    setEditFieldErrors({});
    setEditing(true);
  }

  async function submitUpdate(confirm: boolean) {
    if (!selected || saving) return;
    const input: GuestUpdateInput = {};
    if (editDirty.has("fullName")) input.fullName = editFullName.trim();
    if (editDirty.has("email"))
      input.email = editEmail.trim() ? editEmail.trim().toLowerCase() : null;
    if (editDirty.has("phone"))
      input.phone = editPhone.trim() ? editPhone.trim() : null;
    if (editDirty.has("nic"))
      input.nic = editNic.trim() ? editNic.trim().toUpperCase() : null;

    if (Object.keys(input).length === 0) {
      setEditing(false);
      return;
    }

    // Effective values after the pending edit, for the "one contact" rule.
    const effective = {
      fullName:
        "fullName" in input ? (input.fullName as string) : selected.fullName,
      email: "email" in input ? (input.email ?? "") : (selected.email ?? ""),
      phone: "phone" in input ? (input.phone ?? "") : (selected.phone ?? ""),
      nic: editNic,
    };
    const { errors } = validateFields(effective, {
      requireFullName: true,
      requireContact: true,
    });
    setEditFieldErrors(errors);
    setEditError(null);
    if (!confirm) setDuplicate(null);
    if (Object.keys(errors).length > 0) {
      editFullNameRef.current?.focus();
      return;
    }

    setSaving(true);
    try {
      const updated = await updateGuest(selected.guestId, {
        ...input,
        confirmNotDuplicate: confirm || undefined,
      });
      setDuplicate(null);
      setEditing(false);
      applyMutation(updated);
      setFeedback({
        type: "success",
        text: `Profile updated for ${updated.fullName}.`,
      });
    } catch (error) {
      if (error instanceof GuestApiError) {
        if (
          error.code === "FORBIDDEN" ||
          error.code === "AUTHENTICATION_REQUIRED"
        ) {
          setDenied(true);
        } else if (error.code === "VALIDATION_ERROR") {
          setEditFieldErrors(normalizeServerFields(error.fields));
          editFullNameRef.current?.focus();
        } else if (
          error.code === "POSSIBLE_DUPLICATE" ||
          error.code === "GUEST_NIC_EXISTS"
        ) {
          setDuplicate({
            mode: "update",
            candidates: error.candidates ?? [],
            nicConflict: error.code === "GUEST_NIC_EXISTS",
          });
        } else {
          setEditError(error.message);
        }
      } else {
        setEditError("Could not save the profile. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(nextActive: boolean, reason?: string) {
    if (!selected || togglingActive) return;
    setTogglingActive(true);
    setDetailError(null);
    try {
      const updated = await setGuestActive(
        selected.guestId,
        nextActive,
        reason,
      );
      applyMutation(updated);
      setDeactivateOpen(false);
      setDeactivateReason("");
      setFeedback({
        type: "success",
        text: `${updated.fullName} was ${nextActive ? "reactivated" : "deactivated"}.`,
      });
    } catch (error) {
      if (
        error instanceof GuestApiError &&
        (error.code === "FORBIDDEN" || error.code === "AUTHENTICATION_REQUIRED")
      ) {
        setDenied(true);
      } else if (
        error instanceof GuestApiError &&
        error.code === "GUEST_HAS_OPEN_BOOKINGS"
      ) {
        setDetailError(
          `${error.message}${error.openBookings ? ` (${error.openBookings} open booking${error.openBookings === 1 ? "" : "s"})` : ""}`,
        );
      } else {
        setDetailError(
          error instanceof GuestApiError
            ? error.message
            : "Could not change the profile status.",
        );
      }
    } finally {
      setTogglingActive(false);
    }
  }

  async function requestLinkCode() {
    if (!selected || issuing) return;
    setIssuing(true);
    setDetailError(null);
    setCopied(false);
    try {
      const code = await issueGuestLinkCode(selected.guestId);
      setLinkCode(code);
    } catch (error) {
      if (
        error instanceof GuestApiError &&
        (error.code === "FORBIDDEN" || error.code === "AUTHENTICATION_REQUIRED")
      ) {
        setDenied(true);
      } else {
        setDetailError(
          error instanceof GuestApiError
            ? error.message
            : "Could not issue a link code.",
        );
      }
    } finally {
      setIssuing(false);
    }
  }

  async function copyLinkCode() {
    if (!linkCode) return;
    try {
      await navigator.clipboard.writeText(linkCode.linkCode);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (status === "loading") {
    return (
      <AppShell>
        <PageContainer>
          <BoundedContainer>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="animate-spin" aria-hidden="true" />{" "}
              Loading…
            </p>
          </BoundedContainer>
        </PageContainer>
      </AppShell>
    );
  }

  if (restricted) {
    return (
      <AppShell>
        <PageContainer>
          <BoundedContainer>
            <Card className="max-w-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldAlert
                    className="size-5 text-destructive"
                    aria-hidden="true"
                  />
                  Access restricted
                </CardTitle>
                <CardDescription>
                  Guest profile management is limited to front desk staff. Your
                  account does not have the{" "}
                  <span className="font-mono text-xs">guest.manage</span>{" "}
                  permission.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {status === "anonymous" ? (
                  <Button asChild>
                    <Link to="/login" search={{ redirect: "/guests" }}>
                      Sign in
                    </Link>
                  </Button>
                ) : (
                  <Button asChild variant="outline">
                    <Link to="/dashboard">Back to dashboard</Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          </BoundedContainer>
        </PageContainer>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageContainer>
        <BoundedContainer>
          <Tabs
            value={tab}
            onValueChange={handleTabChange}
            className="space-y-6"
          >
            <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h1 className="font-display text-2xl font-semibold tracking-tight">
                  Guest profiles
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Search existing guests before creating a new profile. Full
                  NICs are only used for exact matches and are never shown in
                  lists.
                </p>
              </div>
              <TabsList
                aria-label="Guest profile action"
                className="self-start"
              >
                <TabsTrigger value="SEARCH">
                  <Search aria-hidden="true" />
                  Search
                </TabsTrigger>
                <TabsTrigger value="NEW">
                  <UserPlus aria-hidden="true" />
                  New guest
                </TabsTrigger>
              </TabsList>
            </header>

            {feedback && (
              <Alert
                variant={feedback.type === "error" ? "destructive" : "default"}
                role="status"
              >
                {feedback.type === "error" ? (
                  <CircleAlert aria-hidden="true" />
                ) : (
                  <Check aria-hidden="true" />
                )}
                <div>
                  <AlertTitle>
                    {feedback.type === "error"
                      ? "Something went wrong"
                      : "Done"}
                  </AlertTitle>
                  <AlertDescription>{feedback.text}</AlertDescription>
                </div>
              </Alert>
            )}

            <TabsContent value="SEARCH">
              <section className="rounded-2xl border-2 border-border bg-card p-4 shadow-md md:p-6">
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Find a guest
                </h2>
                <form
                  noValidate
                  onSubmit={handleSearch}
                  className="grid grid-cols-1 gap-3 md:grid-cols-12 md:items-end"
                >
                  <div className="space-y-1.5 md:col-span-5">
                    <Label
                      htmlFor="guest-query"
                      className={cn(
                        searchFieldErrors.query && "text-destructive",
                      )}
                    >
                      Name, email or phone
                    </Label>
                    <Input
                      ref={queryRef}
                      id="guest-query"
                      value={query}
                      maxLength={100}
                      placeholder="e.g. Kasun or kasun@example.com"
                      aria-invalid={!!searchFieldErrors.query}
                      aria-describedby={
                        searchFieldErrors.query
                          ? "guest-query-error"
                          : undefined
                      }
                      className={cn(
                        searchFieldErrors.query && "border-destructive",
                      )}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setSearchFieldErrors((prev) => ({
                          ...prev,
                          query: "",
                        }));
                      }}
                    />
                    {searchFieldErrors.query && (
                      <p
                        id="guest-query-error"
                        className="text-xs font-medium text-destructive"
                      >
                        {searchFieldErrors.query}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5 md:col-span-4">
                    <Label htmlFor="guest-nic">Full NIC (exact)</Label>
                    <Input
                      ref={nicRef}
                      id="guest-nic"
                      value={nic}
                      maxLength={255}
                      autoCapitalize="characters"
                      spellCheck={false}
                      placeholder="Exact match only"
                      onChange={(event) => setNic(event.target.value)}
                    />
                  </div>
                  <div className="md:col-span-3">
                    <Button
                      type="button"
                      variant={includeInactive ? "default" : "outline"}
                      aria-pressed={includeInactive}
                      className="w-full"
                      onClick={() => setIncludeInactive((value) => !value)}
                    >
                      {includeInactive
                        ? "Including deactivated"
                        : "Include deactivated"}
                    </Button>
                  </div>
                  <div className="md:col-span-12">
                    <Button type="submit" disabled={searching}>
                      {searching ? (
                        <LoaderCircle
                          className="animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <Search aria-hidden="true" />
                      )}
                      {searching ? "Searching…" : "Search"}
                    </Button>
                  </div>
                </form>

                {searchError && (
                  <Alert variant="destructive" className="mt-4">
                    <CircleAlert aria-hidden="true" />
                    <div>
                      <AlertTitle>Search failed</AlertTitle>
                      <AlertDescription>{searchError}</AlertDescription>
                    </div>
                  </Alert>
                )}

                <div className="mt-6" aria-live="polite">
                  {!searched ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      Search by name, email or phone, or enter a full NIC for an
                      exact match.
                    </p>
                  ) : results.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No guest profiles matched. Check the spelling, or create a
                      new profile.
                    </p>
                  ) : (
                    <>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Contact</TableHead>
                            <TableHead>NIC</TableHead>
                            <TableHead>Online</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Action</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {results.map((guest) => (
                            <TableRow
                              key={guest.guestId}
                              data-state={
                                selected?.guestId === guest.guestId
                                  ? "selected"
                                  : undefined
                              }
                            >
                              <TableCell className="font-medium">
                                {guest.fullName}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {guest.email || guest.phone || "—"}
                              </TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">
                                {guest.maskedNic ?? "—"}
                              </TableCell>
                              <TableCell>
                                {guest.hasOnlineAccount ? (
                                  <Badge variant="secondary">Linked</Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">
                                    None
                                  </span>
                                )}
                              </TableCell>
                              <TableCell>
                                {guest.active ? (
                                  <Badge>Active</Badge>
                                ) : (
                                  <Badge variant="destructive">
                                    Deactivated
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => void loadGuest(guest.guestId)}
                                >
                                  View
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {truncated && (
                        <p className="mt-3 text-xs text-muted-foreground">
                          Showing the first {results.length} matches. Refine
                          your search for more specific results.
                        </p>
                      )}
                    </>
                  )}
                </div>
              </section>
            </TabsContent>
            <TabsContent value="NEW">
              <section className="rounded-2xl border-2 border-border bg-card p-4 shadow-md md:p-6">
                <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Create a new guest profile
                </h2>
                <p className="mb-4 text-xs text-muted-foreground">
                  Search first (FR-019). A full name and at least one contact
                  method are required.
                </p>
                <form
                  noValidate
                  className="grid grid-cols-1 gap-4 md:grid-cols-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitCreate(false);
                  }}
                >
                  <div className="space-y-1.5 md:col-span-2">
                    <Label
                      htmlFor="new-fullname"
                      className={cn(
                        createFieldErrors.fullName && "text-destructive",
                      )}
                    >
                      Full name
                    </Label>
                    <Input
                      ref={newFullNameRef}
                      id="new-fullname"
                      value={newFullName}
                      maxLength={255}
                      autoComplete="name"
                      aria-invalid={!!createFieldErrors.fullName}
                      aria-describedby={
                        createFieldErrors.fullName
                          ? "new-fullname-error"
                          : undefined
                      }
                      className={cn(
                        createFieldErrors.fullName && "border-destructive",
                      )}
                      onChange={(event) => setNewFullName(event.target.value)}
                    />
                    {createFieldErrors.fullName && (
                      <p
                        id="new-fullname-error"
                        className="text-xs font-medium text-destructive"
                      >
                        {createFieldErrors.fullName}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="new-email"
                      className={cn(
                        createFieldErrors.email && "text-destructive",
                      )}
                    >
                      Email{" "}
                      <span className="font-normal text-muted-foreground">
                        (or phone)
                      </span>
                    </Label>
                    <Input
                      id="new-email"
                      type="email"
                      value={newEmail}
                      maxLength={255}
                      autoComplete="email"
                      aria-invalid={!!createFieldErrors.email}
                      aria-describedby={
                        createFieldErrors.email ? "new-email-error" : undefined
                      }
                      className={cn(
                        createFieldErrors.email && "border-destructive",
                      )}
                      onChange={(event) => setNewEmail(event.target.value)}
                    />
                    {createFieldErrors.email && (
                      <p
                        id="new-email-error"
                        className="text-xs font-medium text-destructive"
                      >
                        {createFieldErrors.email}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="new-phone"
                      className={cn(
                        createFieldErrors.phone && "text-destructive",
                      )}
                    >
                      Phone{" "}
                      <span className="font-normal text-muted-foreground">
                        (or email)
                      </span>
                    </Label>
                    <Input
                      id="new-phone"
                      type="tel"
                      value={newPhone}
                      maxLength={32}
                      autoComplete="tel"
                      aria-invalid={!!createFieldErrors.phone}
                      aria-describedby={
                        createFieldErrors.phone ? "new-phone-error" : undefined
                      }
                      className={cn(
                        createFieldErrors.phone && "border-destructive",
                      )}
                      onChange={(event) => setNewPhone(event.target.value)}
                    />
                    {createFieldErrors.phone && (
                      <p
                        id="new-phone-error"
                        className="text-xs font-medium text-destructive"
                      >
                        {createFieldErrors.phone}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label
                      htmlFor="new-nic"
                      className={cn(
                        createFieldErrors.nic && "text-destructive",
                      )}
                    >
                      Full NIC{" "}
                      <span className="font-normal text-muted-foreground">
                        (optional)
                      </span>
                    </Label>
                    <Input
                      id="new-nic"
                      value={newNic}
                      maxLength={255}
                      autoCapitalize="characters"
                      spellCheck={false}
                      aria-invalid={!!createFieldErrors.nic}
                      aria-describedby={
                        createFieldErrors.nic ? "new-nic-error" : undefined
                      }
                      className={cn(
                        createFieldErrors.nic && "border-destructive",
                      )}
                      onChange={(event) => setNewNic(event.target.value)}
                    />
                    {createFieldErrors.nic && (
                      <p
                        id="new-nic-error"
                        className="text-xs font-medium text-destructive"
                      >
                        {createFieldErrors.nic}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 md:col-span-2">
                    <Button type="submit" disabled={creating}>
                      {creating && (
                        <LoaderCircle
                          className="animate-spin"
                          aria-hidden="true"
                        />
                      )}
                      {creating ? "Creating…" : "Create profile"}
                    </Button>
                  </div>
                </form>

                {createError && (
                  <Alert variant="destructive" className="mt-4">
                    <CircleAlert aria-hidden="true" />
                    <div>
                      <AlertTitle>Could not create the profile</AlertTitle>
                      <AlertDescription>{createError}</AlertDescription>
                    </div>
                  </Alert>
                )}
              </section>
            </TabsContent>

            {duplicate && (
              <Alert
                variant={duplicate.nicConflict ? "destructive" : "default"}
                role="alert"
              >
                {duplicate.nicConflict ? (
                  <CircleAlert aria-hidden="true" />
                ) : (
                  <Info aria-hidden="true" />
                )}
                <div>
                  <AlertTitle>
                    {duplicate.nicConflict
                      ? "This NIC already belongs to another profile"
                      : "Possible duplicate profile"}
                  </AlertTitle>
                  <AlertDescription>
                    {duplicate.nicConflict
                      ? "A guest profile can have only one record per NIC. Select the existing profile instead."
                      : "These details match an existing guest profile. Use that profile, or confirm this is a different person."}
                  </AlertDescription>
                  {duplicate.candidates.length > 0 && (
                    <ul className="mt-3 space-y-2">
                      {duplicate.candidates.map((candidate) => (
                        <li
                          key={candidate.guestId}
                          className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-border bg-background/60 px-3 py-2"
                        >
                          <span className="text-sm font-medium">
                            {candidate.fullName}
                          </span>
                          {candidate.maskedNic && (
                            <span className="font-mono text-xs text-muted-foreground">
                              {candidate.maskedNic}
                            </span>
                          )}
                          {candidate.matchedOn.length > 0 && (
                            <Badge variant="outline">
                              matches{" "}
                              {candidate.matchedOn
                                .map((field) => MATCH_LABELS[field])
                                .join(", ")}
                            </Badge>
                          )}
                          {!candidate.active && (
                            <Badge variant="destructive">Deactivated</Badge>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="ml-auto"
                            onClick={() => {
                              setDuplicate(null);
                              setTab("SEARCH");
                              void loadGuest(candidate.guestId);
                            }}
                          >
                            Use this profile
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {!duplicate.nicConflict && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={creating || saving}
                        onClick={() =>
                          duplicate.mode === "create"
                            ? void submitCreate(true)
                            : void submitUpdate(true)
                        }
                      >
                        This is a different person — continue
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setDuplicate(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </Alert>
            )}

            {detailLoading && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="animate-spin" aria-hidden="true" />{" "}
                Loading profile…
              </p>
            )}

            {detailError && (
              <Alert variant="destructive">
                <CircleAlert aria-hidden="true" />
                <div>
                  <AlertTitle>Profile action failed</AlertTitle>
                  <AlertDescription>{detailError}</AlertDescription>
                </div>
              </Alert>
            )}

            {selected && !editing && (
              <section className="rounded-2xl border-2 border-border bg-card p-4 shadow-md md:p-6">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h2 className="font-display text-xl font-semibold tracking-tight">
                      {selected.fullName}
                    </h2>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {selected.active ? (
                        <Badge>Active</Badge>
                      ) : (
                        <Badge variant="destructive">Deactivated</Badge>
                      )}
                      {selected.hasOnlineAccount && (
                        <Badge variant="secondary">Online account linked</Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={startEdit}
                      disabled={!selected.active}
                    >
                      <Pencil aria-hidden="true" />
                      Edit
                    </Button>
                    {selected.active ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDeactivateOpen(true)}
                        disabled={togglingActive}
                      >
                        <UserX aria-hidden="true" />
                        Deactivate
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void toggleActive(true)}
                        disabled={togglingActive}
                      >
                        {togglingActive ? (
                          <LoaderCircle
                            className="animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <UserCheck aria-hidden="true" />
                        )}
                        Reactivate
                      </Button>
                    )}
                    {selected.active && !selected.hasOnlineAccount && (
                      <Button
                        size="sm"
                        onClick={() => void requestLinkCode()}
                        disabled={issuing}
                      >
                        {issuing ? (
                          <LoaderCircle
                            className="animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <KeyRound aria-hidden="true" />
                        )}
                        Issue link code
                      </Button>
                    )}
                  </div>
                </div>

                <dl className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Email
                    </dt>
                    <dd className="mt-0.5 text-sm">{selected.email || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Phone
                    </dt>
                    <dd className="mt-0.5 text-sm">{selected.phone || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      NIC
                    </dt>
                    <dd className="mt-0.5 font-mono text-sm">
                      {selected.maskedNic ?? "Not recorded"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Created
                    </dt>
                    <dd className="mt-0.5 text-sm">
                      {formatDate(selected.createdAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Last updated
                    </dt>
                    <dd className="mt-0.5 text-sm">
                      {formatDate(selected.updatedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Reference
                    </dt>
                    <dd className="mt-0.5 break-all font-mono text-xs text-muted-foreground">
                      {selected.guestId}
                    </dd>
                  </div>
                </dl>

                {deactivateOpen && (
                  <form
                    className="mt-5 rounded-xl border-2 border-destructive/40 bg-destructive/5 p-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void toggleActive(false, deactivateReason);
                    }}
                  >
                    <p className="text-sm font-medium">
                      Deactivate {selected.fullName}?
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      The profile and all history are kept (FR-022).
                      Deactivation is refused while the guest has upcoming or
                      in-house bookings, and it disables any linked online
                      login.
                    </p>
                    <div className="mt-3 space-y-1.5">
                      <Label htmlFor="deactivate-reason">
                        Reason (optional)
                      </Label>
                      <Input
                        id="deactivate-reason"
                        value={deactivateReason}
                        maxLength={255}
                        onChange={(event) =>
                          setDeactivateReason(event.target.value)
                        }
                      />
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Button
                        type="submit"
                        variant="destructive"
                        size="sm"
                        disabled={togglingActive}
                      >
                        {togglingActive && (
                          <LoaderCircle
                            className="animate-spin"
                            aria-hidden="true"
                          />
                        )}
                        Confirm deactivation
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setDeactivateOpen(false);
                          setDeactivateReason("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}

                {linkCode && (
                  <Alert className="mt-5" role="status">
                    <KeyRound aria-hidden="true" />
                    <div>
                      <AlertTitle>Link code issued</AlertTitle>
                      <AlertDescription>
                        Share this code with the guest only after checking their
                        identity. It expires {formatDate(linkCode.expiresAt)}.
                      </AlertDescription>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <code className="break-all rounded-lg border-2 border-border bg-background px-3 py-1.5 font-mono text-xs">
                          {linkCode.linkCode}
                        </code>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void copyLinkCode()}
                        >
                          {copied ? (
                            <Check aria-hidden="true" />
                          ) : (
                            <Copy aria-hidden="true" />
                          )}
                          {copied ? "Copied" : "Copy"}
                        </Button>
                      </div>
                    </div>
                  </Alert>
                )}
              </section>
            )}

            {selected && editing && (
              <section className="rounded-2xl border-2 border-border bg-card p-4 shadow-md md:p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-display text-xl font-semibold tracking-tight">
                    Edit {selected.fullName}
                  </h2>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Cancel editing"
                    onClick={() => {
                      setEditing(false);
                      setEditError(null);
                    }}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </div>
                <form
                  noValidate
                  className="grid grid-cols-1 gap-4 md:grid-cols-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitUpdate(false);
                  }}
                >
                  <div className="space-y-1.5 md:col-span-2">
                    <Label
                      htmlFor="edit-fullname"
                      className={cn(
                        editFieldErrors.fullName && "text-destructive",
                      )}
                    >
                      Full name
                    </Label>
                    <Input
                      ref={editFullNameRef}
                      id="edit-fullname"
                      value={editFullName}
                      maxLength={255}
                      aria-invalid={!!editFieldErrors.fullName}
                      aria-describedby={
                        editFieldErrors.fullName
                          ? "edit-fullname-error"
                          : undefined
                      }
                      className={cn(
                        editFieldErrors.fullName && "border-destructive",
                      )}
                      onChange={(event) => {
                        setEditFullName(event.target.value);
                        markEditDirty("fullName");
                      }}
                    />
                    {editFieldErrors.fullName && (
                      <p
                        id="edit-fullname-error"
                        className="text-xs font-medium text-destructive"
                      >
                        {editFieldErrors.fullName}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="edit-email"
                      className={cn(
                        editFieldErrors.email && "text-destructive",
                      )}
                    >
                      Email
                    </Label>
                    <Input
                      id="edit-email"
                      type="email"
                      value={editEmail}
                      maxLength={255}
                      aria-invalid={!!editFieldErrors.email}
                      aria-describedby={
                        editFieldErrors.email ? "edit-email-error" : undefined
                      }
                      className={cn(
                        editFieldErrors.email && "border-destructive",
                      )}
                      onChange={(event) => {
                        setEditEmail(event.target.value);
                        markEditDirty("email");
                      }}
                    />
                    {editFieldErrors.email && (
                      <p
                        id="edit-email-error"
                        className="text-xs font-medium text-destructive"
                      >
                        {editFieldErrors.email}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="edit-phone"
                      className={cn(
                        editFieldErrors.phone && "text-destructive",
                      )}
                    >
                      Phone
                    </Label>
                    <Input
                      id="edit-phone"
                      type="tel"
                      value={editPhone}
                      maxLength={32}
                      aria-invalid={!!editFieldErrors.phone}
                      aria-describedby={
                        editFieldErrors.phone ? "edit-phone-error" : undefined
                      }
                      className={cn(
                        editFieldErrors.phone && "border-destructive",
                      )}
                      onChange={(event) => {
                        setEditPhone(event.target.value);
                        markEditDirty("phone");
                      }}
                    />
                    {editFieldErrors.phone && (
                      <p
                        id="edit-phone-error"
                        className="text-xs font-medium text-destructive"
                      >
                        {editFieldErrors.phone}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label
                      htmlFor="edit-nic"
                      className={cn(editFieldErrors.nic && "text-destructive")}
                    >
                      Replace NIC{" "}
                      <span className="font-normal text-muted-foreground">
                        (leave blank to keep current)
                      </span>
                    </Label>
                    <Input
                      id="edit-nic"
                      value={editNic}
                      maxLength={255}
                      autoCapitalize="characters"
                      spellCheck={false}
                      placeholder={
                        selected.hasNic
                          ? `Current: ${selected.maskedNic}`
                          : "No NIC recorded"
                      }
                      aria-invalid={!!editFieldErrors.nic}
                      aria-describedby={
                        editFieldErrors.nic ? "edit-nic-error" : "edit-nic-help"
                      }
                      className={cn(
                        editFieldErrors.nic && "border-destructive",
                      )}
                      onChange={(event) => {
                        setEditNic(event.target.value);
                        markEditDirty("nic");
                      }}
                    />
                    {editFieldErrors.nic ? (
                      <p
                        id="edit-nic-error"
                        className="text-xs font-medium text-destructive"
                      >
                        {editFieldErrors.nic}
                      </p>
                    ) : (
                      <p
                        id="edit-nic-help"
                        className="text-xs text-muted-foreground"
                      >
                        The current NIC is masked and cannot be read back.
                        Clearing this field removes the stored NIC.
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 md:col-span-2">
                    <Button type="submit" disabled={saving}>
                      {saving && (
                        <LoaderCircle
                          className="animate-spin"
                          aria-hidden="true"
                        />
                      )}
                      {saving ? "Saving…" : "Save changes"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={saving}
                      onClick={() => {
                        setEditing(false);
                        setEditError(null);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
                {editError && (
                  <Alert variant="destructive" className="mt-4">
                    <CircleAlert aria-hidden="true" />
                    <div>
                      <AlertTitle>Could not save changes</AlertTitle>
                      <AlertDescription>{editError}</AlertDescription>
                    </div>
                  </Alert>
                )}
              </section>
            )}

            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <RefreshCw className="size-3" aria-hidden="true" />
              Admins and other staff roles cannot open this page; only front
              desk staff hold guest.manage.
            </p>
          </Tabs>
        </BoundedContainer>
      </PageContainer>
    </AppShell>
  );
}
