import { useCallback, useEffect, useRef, useState } from "react";
import {
  Globe,
  Shield,
  Building2,
  BedDouble,
  LayoutGrid,
  MapPin,
  ArrowRight,
  CalendarCheck,
  Headphones,
  ChevronRight,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { RoomTypeCard } from "@/components/project/RoomTypeCard";
import { SearchWidget } from "@/components/project/SearchWidget";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/AuthProvider";
import { fetchShowcase, ShowcaseError, type Showcase } from "@/lib/showcase";

/* ------------------------------------------------------------------ */
/*  Data                                                               */
/* ------------------------------------------------------------------ */

const FEATURED_LIMIT = 6;

const features = [
  {
    icon: CalendarCheck,
    title: "Instant Reservations",
    description:
      "Book directly with real-time room availability. No middlemen, no markup — just seamless direct reservations.",
  },
  {
    icon: Shield,
    title: "Secure & Private",
    description:
      "Role-based access, encrypted transactions, and full audit trails ensure your data stays protected.",
  },
  {
    icon: Headphones,
    title: "24/7 Concierge",
    description:
      "Staff-assisted guest services from check-in to checkout, with in-stay requests managed in real time.",
  },
];

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

function useShowcase() {
  const [showcase, setShowcase] = useState<Showcase | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  const load = useCallback(() => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true);
    setError("");
    fetchShowcase(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setShowcase(data);
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof ShowcaseError ? reason.message : "Hotel information could not be loaded. Try again.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
  }, []);
  useEffect(() => {
    load();
    return () => abort.current?.abort();
  }, [load]);
  return { showcase, loading, error, reload: load };
}

export default function IndexPage() {
  const { user } = useAuth();
  const isGuest = user?.kind === "GUEST";
  const isStaff = user?.kind === "STAFF";
  const { showcase, loading, error, reload } = useShowcase();
  const branches = showcase
    ? [
        ...new Map(
          showcase.roomTypes.flatMap((type) => type.branches).map((branch) => [branch.branchId, branch]),
        ).values(),
      ].sort((a, b) => a.name.localeCompare(b.name))
    : [];
  const featured = showcase?.roomTypes.slice(0, FEATURED_LIMIT) ?? [];
  const stats = [
    { icon: Building2, value: showcase?.stats.branchCount, label: "Branches" },
    { icon: MapPin, value: showcase?.stats.cityCount, label: "Cities" },
    { icon: BedDouble, value: showcase?.stats.roomCount, label: "Rooms" },
    { icon: LayoutGrid, value: showcase?.stats.roomTypeCount, label: "Room Types" },
  ];
  const navLink = "hover:text-foreground transition-colors duration-150";

  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased">
      {/* ── Navigation ── */}
      <nav className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shadow-md group-hover:shadow-lg transition-shadow duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)]">
              <Globe className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-display text-2xl font-bold tracking-tight">
              SkyNest
            </span>
          </Link>

          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-foreground/80">
            <a href="#properties" className={navLink}>
              Stays
            </a>
            <a href="#features" className={navLink}>
              Features
            </a>
            <Link to="/rooms" className={navLink}>
              Availability
            </Link>
            {isGuest && (
              <Link to="/guest/my-bookings" className={navLink}>
                My bookings
              </Link>
            )}
            {isStaff && (
              <Link to="/dashboard" className={navLink}>
                Dashboard
              </Link>
            )}
          </div>

          <div className="flex items-center gap-3">
            {user ? (
              <Button
                asChild
                size="sm"
                className="rounded-full shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)]"
              >
                <Link to={isStaff ? "/dashboard" : "/account"}>
                  {isStaff ? "Open dashboard" : "My account"}
                </Link>
              </Button>
            ) : (
              <>
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="rounded-full border-2 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)]"
                >
                  <Link to="/login">Log in</Link>
                </Button>
                <Button
                  asChild
                  size="sm"
                  className="rounded-full shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)]"
                >
                  <Link to="/register">Sign up</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <header className="relative overflow-hidden">
        {/* Decorative shapes */}
        <div className="absolute top-20 -left-32 w-96 h-96 rounded-full bg-secondary/40 blur-3xl" />
        <div className="absolute bottom-0 -right-32 w-80 h-80 rounded-full bg-muted/30 blur-3xl" />

        <div className="relative max-w-7xl mx-auto px-6 pt-20 pb-36 text-center">
          <p className="text-xs font-semibold text-muted-foreground bg-secondary/60 inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-6 tracking-wide uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            Direct Hotel Booking & Staff Management
          </p>

          <h1 className="font-display text-4xl md:text-5xl lg:text-7xl font-bold tracking-tight leading-[0.95] text-foreground mb-6 max-w-5xl mx-auto">
            Your Stay, Simplified.
            <br />
            <span className="text-muted-foreground">
              Book Direct. Manage Smart.
            </span>
          </h1>

          <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
            SkyNest is the all-in-one hotel reservation and guest services
            platform — powering direct bookings for guests and streamlined
            operations for staff, across every branch.
          </p>

          <div className="flex items-center justify-center gap-4">
            <Button
              asChild
              size="lg"
              className="rounded-full shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)] px-8"
            >
              <Link to="/guest/bookings/new">
                Book a Stay
                <ArrowRight className="w-4 h-4 ml-2" />
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="rounded-full border-2 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)] px-8"
            >
              <Link to="/rooms">
                Explore Rooms
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* ── Search Widget ── */}
      <SearchWidget branches={branches} loading={loading} />

      {error && (
        <section className="max-w-5xl mx-auto px-6 mt-8">
          <Alert variant="destructive">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>{error}</span>
              <Button size="sm" variant="outline" onClick={reload}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        </section>
      )}

      {/* ── Stats Bar ── */}
      <section className="max-w-5xl mx-auto px-6 mt-20 mb-8" aria-busy={loading}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="flex flex-col items-center gap-2 rounded-2xl bg-card border-2 border-border p-6 shadow-sm hover:shadow-md transition-all duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)]"
            >
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <stat.icon className="w-5 h-5 text-primary" />
              </div>
              <span className="font-display text-2xl font-bold tracking-tight text-foreground">
                {stat.value === undefined ? "—" : stat.value.toLocaleString()}
              </span>
              <span className="text-xs text-muted-foreground font-medium tracking-wide uppercase">
                {stat.label}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Room Types ── */}
      <section id="properties" className="max-w-7xl mx-auto px-6 py-16">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight text-foreground">
              Our Rooms
            </h2>
            <p className="text-muted-foreground mt-2">
              Room types available across SkyNest branches — book directly at
              our published rates.
            </p>
          </div>
          <Link
            to="/rooms"
            className="hidden md:inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:text-foreground transition-colors duration-150"
          >
            Check availability
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>

        {loading && !showcase && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading room types…
          </p>
        )}
        {showcase && !featured.length && (
          <p role="status" className="text-sm text-muted-foreground">
            No rooms are open for booking right now. Please check back soon.
          </p>
        )}
        {featured.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {featured.map((roomType) => (
              <RoomTypeCard key={roomType.roomTypeId} roomType={roomType} />
            ))}
          </div>
        )}

        <div className="mt-8 text-center md:hidden">
          <Link
            to="/rooms"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:text-foreground transition-colors"
          >
            Check availability
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      {/* ── Features ── */}
      <section
        id="features"
        className="max-w-7xl mx-auto px-6 py-16 border-t border-border/30"
      >
        <div className="text-center mb-12">
          <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight text-foreground">
            Why SkyNest?
          </h2>
          <p className="text-muted-foreground mt-2 max-w-xl mx-auto">
            A purpose-built platform for hotels that want full control over
            reservations and operations.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-2xl bg-card border-2 border-border p-6 shadow-md hover:shadow-xl transition-all duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)] hover:-translate-y-1"
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 shadow-sm">
                <feature.icon className="w-6 h-6 text-primary" />
              </div>
              <h3 className="font-display text-xl font-semibold tracking-tight mb-2">
                {feature.title}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="max-w-7xl mx-auto px-6 py-16">
        <div className="rounded-3xl bg-primary p-10 md:p-16 text-center shadow-xl">
          <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight text-primary-foreground mb-4">
            Ready for Your Next Stay?
          </h2>
          <p className="text-primary-foreground/70 max-w-xl mx-auto mb-8 leading-relaxed">
            {isGuest
              ? "Reserve rooms directly with SkyNest and manage every booking from your account."
              : "Create a SkyNest guest account to book directly, track your reservations and view your invoices."}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Button
              asChild
              size="lg"
              variant="secondary"
              className="rounded-full shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)] px-8 font-semibold"
            >
              {isGuest ? (
                <Link to="/guest/bookings/new">
                  Book a Stay
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              ) : (
                <Link to="/register">
                  Create an Account
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              )}
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="rounded-full border-2 border-primary-foreground/20 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)] px-8"
            >
              <Link to="/rooms">
                <CalendarCheck className="w-4 h-4 mr-2" />
                Check Availability
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border/40 bg-card">
        <div className="max-w-7xl mx-auto px-6 py-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-10">
            {/* Brand */}
            <div>
              <Link to="/" className="flex items-center gap-2.5 mb-4">
                <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shadow-md">
                  <Globe className="w-4 h-4 text-primary-foreground" />
                </div>
                <span className="font-display text-xl font-bold tracking-tight">
                  SkyNest
                </span>
              </Link>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Internal &amp; direct hotel reservation and guest services
                management system.
              </p>
            </div>

            {/* Guests */}
            <div>
              <h4 className="text-xs font-semibold text-foreground tracking-wide uppercase mb-3">
                Guests
              </h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  <Link to="/rooms" className="hover:text-foreground transition-colors">
                    Room Availability
                  </Link>
                </li>
                <li>
                  <Link to="/guest/bookings/new" className="hover:text-foreground transition-colors">
                    Book a Stay
                  </Link>
                </li>
                <li>
                  <Link to="/guest/my-bookings" className="hover:text-foreground transition-colors">
                    My Bookings
                  </Link>
                </li>
                <li>
                  <Link to="/account" className="hover:text-foreground transition-colors">
                    My Account
                  </Link>
                </li>
              </ul>
            </div>

            {/* Staff */}
            <div>
              <h4 className="text-xs font-semibold text-foreground tracking-wide uppercase mb-3">
                Staff
              </h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  <Link to="/dashboard" className="hover:text-foreground transition-colors">
                    Staff Dashboard
                  </Link>
                </li>
                <li>
                  <Link to="/login" className="hover:text-foreground transition-colors">
                    Staff Log In
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          <div className="flex flex-col md:flex-row items-center justify-between gap-4 pt-8 border-t border-border/40">
            <p className="text-xs text-muted-foreground">
              &copy; {new Date().getFullYear()} SkyNest HRGSMS. All rights reserved.
            </p>
            <p className="text-xs text-muted-foreground">
              Internal &amp; Direct Hotel Booking System
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
