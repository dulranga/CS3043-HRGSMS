import { useEffect, useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

interface BranchOption {
  branchId: string;
  name: string;
  city: string;
  active: boolean;
}

interface RoleOption {
  roleId: string;
  roleName: string;
}

interface CreatedAccount {
  username: string;
  fullName: string;
  temporaryPassword?: string;
}

const EMPTY_FORM = {
  fullName: "",
  username: "",
  email: "",
  phone: "",
  nic: "",
  branchId: "",
  roleId: "",
  password: "",
};

type FormState = typeof EMPTY_FORM;

const PASSWORD_MIN_LENGTH = 8;

function roleLabel(roleName: string): string {
  return roleName
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function CreateUserAccountDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (username: string) => void;
}) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedAccount | null>(null);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setFormError(null);
    setCreated(null);
    setOptionsError(null);
    let cancelled = false;
    (async () => {
      try {
        const [branchRes, roleRes] = await Promise.all([
          fetch("/api/branches?active=true"),
          fetch("/api/roles"),
        ]);
        if (!branchRes.ok || !roleRes.ok) throw new Error();
        const [branchBody, roleBody] = await Promise.all([branchRes.json(), roleRes.json()]);
        if (cancelled) return;
        setBranches(branchBody.data ?? []);
        setRoles(roleBody.data ?? []);
      } catch {
        if (!cancelled) setOptionsError("Could not load branches and roles. Close and try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const update = (key: keyof FormState) => (value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const validate = (): Record<string, string> => {
    const errors: Record<string, string> = {};
    if (!form.fullName.trim()) errors.fullName = "Full name is required.";
    if (!form.username.trim()) errors.username = "Username is required.";
    if (!form.branchId) errors.branchId = "Select a branch.";
    if (!form.roleId) errors.roleId = "Select a role.";
    if (form.password && form.password.length < PASSWORD_MIN_LENGTH) {
      errors.password = `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
    }
    return errors;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const body: Record<string, string> = {
      fullName: form.fullName.trim(),
      username: form.username.trim(),
      branchId: form.branchId,
      roleId: form.roleId,
    };
    if (form.email.trim()) body.email = form.email.trim();
    if (form.phone.trim()) body.phone = form.phone.trim();
    if (form.nic.trim()) body.nic = form.nic.trim();
    if (form.password) body.password = form.password;

    setSubmitting(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        const error = payload?.error;
        if (error?.fields && typeof error.fields === "object") {
          setFieldErrors(
            Object.fromEntries(
              Object.entries(error.fields as Record<string, string>).map(([key, message]) => [key, `This field ${message}.`])
            )
          );
        }
        if (error?.code === "USERNAME_EXISTS") setFieldErrors((current) => ({ ...current, username: error.message }));
        if (error?.code === "NIC_EXISTS") setFieldErrors((current) => ({ ...current, nic: error.message }));
        setFormError(error?.message ?? "Could not create the account.");
        return;
      }
      const account = payload.data as CreatedAccount;
      setCreated(account);
      onCreated(account.username);
    } catch {
      setFormError("Could not create the account. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const fieldError = (key: keyof FormState) =>
    fieldErrors[key] ? (
      <p id={`create-user-${key}-error`} className="text-xs text-destructive">
        {fieldErrors[key]}
      </p>
    ) : null;

  const errorProps = (key: keyof FormState) =>
    fieldErrors[key]
      ? { "aria-invalid": true as const, "aria-describedby": `create-user-${key}-error` }
      : {};

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Account created</DialogTitle>
              <DialogDescription>
                {created.fullName} can now sign in as <span className="font-semibold">{created.username}</span>.
              </DialogDescription>
            </DialogHeader>
            {created.temporaryPassword && (
              <div className="space-y-2">
                <Label htmlFor="create-user-temporary-password">Temporary password</Label>
                <Input
                  id="create-user-temporary-password"
                  readOnly
                  value={created.temporaryPassword}
                  className="font-mono"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <p className="text-xs text-muted-foreground">
                  This password is shown only once. Share it securely with the staff member.
                </p>
              </div>
            )}
            <DialogFooter>
              {created.temporaryPassword && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void navigator.clipboard?.writeText(created.temporaryPassword ?? "")}
                >
                  Copy password
                </Button>
              )}
              <Button type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-5">
            <DialogHeader>
              <DialogTitle>Create staff account</DialogTitle>
              <DialogDescription>
                Add a staff member and choose their branch and role. Leave the password blank to issue a temporary one.
              </DialogDescription>
            </DialogHeader>

            {(optionsError || formError) && (
              <Alert variant="destructive">
                <AlertDescription>{optionsError ?? formError}</AlertDescription>
              </Alert>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="create-user-fullName">Full name</Label>
                <Input
                  id="create-user-fullName"
                  value={form.fullName}
                  onChange={(e) => update("fullName")(e.target.value)}
                  autoComplete="off"
                  {...errorProps("fullName")}
                />
                {fieldError("fullName")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-user-username">Username</Label>
                <Input
                  id="create-user-username"
                  value={form.username}
                  onChange={(e) => update("username")(e.target.value)}
                  autoComplete="off"
                  {...errorProps("username")}
                />
                {fieldError("username")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-user-password">Password (optional)</Label>
                <Input
                  id="create-user-password"
                  type="password"
                  value={form.password}
                  onChange={(e) => update("password")(e.target.value)}
                  autoComplete="new-password"
                  {...errorProps("password")}
                />
                {fieldError("password")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-user-branchId">Branch</Label>
                <NativeSelect
                  id="create-user-branchId"
                  value={form.branchId}
                  onChange={(e) => update("branchId")(e.target.value)}
                  {...errorProps("branchId")}
                >
                  <NativeSelectOption value="">Select a branch</NativeSelectOption>
                  {branches.map((branch) => (
                    <NativeSelectOption key={branch.branchId} value={branch.branchId}>
                      {branch.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                {fieldError("branchId")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-user-roleId">Role</Label>
                <NativeSelect
                  id="create-user-roleId"
                  value={form.roleId}
                  onChange={(e) => update("roleId")(e.target.value)}
                  {...errorProps("roleId")}
                >
                  <NativeSelectOption value="">Select a role</NativeSelectOption>
                  {roles.map((role) => (
                    <NativeSelectOption key={role.roleId} value={role.roleId}>
                      {roleLabel(role.roleName)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                {fieldError("roleId")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-user-email">Email (optional)</Label>
                <Input
                  id="create-user-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => update("email")(e.target.value)}
                  autoComplete="off"
                  {...errorProps("email")}
                />
                {fieldError("email")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-user-phone">Phone (optional)</Label>
                <Input
                  id="create-user-phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => update("phone")(e.target.value)}
                  autoComplete="off"
                  {...errorProps("phone")}
                />
                {fieldError("phone")}
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="create-user-nic">NIC (optional)</Label>
                <Input
                  id="create-user-nic"
                  value={form.nic}
                  onChange={(e) => update("nic")(e.target.value)}
                  autoComplete="off"
                  {...errorProps("nic")}
                />
                {fieldError("nic")}
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !!optionsError}>
                {submitting ? "Creating…" : "Create account"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
