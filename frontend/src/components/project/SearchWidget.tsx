import { useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, MapPin, Calendar, User } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export interface SearchWidgetBranch {
  branchId: string;
  name: string;
  city: string;
}

const FIELD =
  "pl-10 h-12 rounded-xl bg-background border-border text-base shadow-sm focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:border-primary";

function isoDate(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

// Home-page quick search. Hands the criteria to /rooms, which prefills the
// full availability search and runs it against live inventory.
export function SearchWidget({
  branches = [],
  loading = false,
}: {
  branches?: SearchWidgetBranch[];
  loading?: boolean;
}) {
  const navigate = useNavigate();
  const today = isoDate(0);
  const [branchId, setBranchId] = useState("");
  const [checkIn, setCheckIn] = useState(today);
  const [checkOut, setCheckOut] = useState(isoDate(1));
  const [guestCount, setGuestCount] = useState("2");
  const [error, setError] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!branchId) return setError("Choose a branch.");
    if (!checkIn || !checkOut) return setError("Choose arrival and departure dates.");
    if (checkOut <= checkIn) return setError("Departure must be after arrival.");
    if (!/^[1-9]\d*$/.test(guestCount)) return setError("Enter at least 1 guest.");
    setError("");
    void navigate({ to: "/rooms", search: { branchId, checkIn, checkOut, guestCount } });
  };

  return (
    <section className="w-full max-w-5xl mx-auto -mt-16 relative z-10 px-6">
      <div className="bg-card/95 backdrop-blur-md rounded-3xl border-2 border-border shadow-2xl p-6 md:p-8">
        <form className="grid grid-cols-1 md:grid-cols-5 gap-4 md:gap-3" noValidate onSubmit={submit}>
          <div className="relative md:col-span-1">
            <label htmlFor="search-branch" className="sr-only">Branch</label>
            <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground z-10 pointer-events-none" />
            <NativeSelect
              id="search-branch"
              value={branchId}
              disabled={loading || !branches.length}
              onChange={(event) => setBranchId(event.target.value)}
              className={FIELD}
              aria-invalid={error === "Choose a branch."}
            >
              <NativeSelectOption value="">
                {loading ? "Loading branches…" : branches.length ? "Where to?" : "No branches available"}
              </NativeSelectOption>
              {branches.map((branch) => (
                <NativeSelectOption key={branch.branchId} value={branch.branchId}>
                  {branch.name} · {branch.city}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="relative md:col-span-1">
            <label htmlFor="search-check-in" className="sr-only">Arrival date</label>
            <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              id="search-check-in"
              type="date"
              min={today}
              value={checkIn}
              onChange={(event) => {
                const value = event.target.value;
                setCheckIn(value);
                if (value && checkOut <= value) {
                  const next = new Date(`${value}T00:00:00Z`);
                  next.setUTCDate(next.getUTCDate() + 1);
                  setCheckOut(next.toISOString().slice(0, 10));
                }
              }}
              className={FIELD}
            />
          </div>
          <div className="relative md:col-span-1">
            <label htmlFor="search-check-out" className="sr-only">Departure date</label>
            <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              id="search-check-out"
              type="date"
              min={checkIn || today}
              value={checkOut}
              onChange={(event) => setCheckOut(event.target.value)}
              className={FIELD}
            />
          </div>
          <div className="relative md:col-span-1">
            <label htmlFor="search-guests" className="sr-only">Guests</label>
            <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              id="search-guests"
              type="number"
              min={1}
              max={32767}
              step={1}
              value={guestCount}
              onChange={(event) => setGuestCount(event.target.value)}
              className={FIELD}
              aria-label="Guests"
            />
          </div>
          <Button
            type="submit"
            disabled={loading || !branches.length}
            className="h-12 rounded-xl text-base font-semibold shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)]"
          >
            <Search className="w-4 h-4 mr-2" />
            Search
          </Button>
        </form>
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
