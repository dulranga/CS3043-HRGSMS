import {
  Globe,
  Shield,
  Clock,
  Building2,
  BedDouble,
  Users,
  MapPin,
  Star,
  ArrowRight,
  CalendarCheck,
  Headphones,
  ChevronRight,
} from "lucide-react";
import { PropertyCard } from "@/components/project/PropertyCard";
import { SearchWidget } from "@/components/project/SearchWidget";
import { Button } from "@/components/ui/button";

/* ------------------------------------------------------------------ */
/*  Data                                                               */
/* ------------------------------------------------------------------ */

const featuredProperties = [
  {
    title: "Hidden Quill Haven",
    location: "New York, USA",
    pricePerNight: "$246",
    guests: 3,
    beds: 2,
    baths: 2,
    image:
      "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&q=80",
    rating: 4.9,
    reviews: 128,
    tag: "Trending",
  },
  {
    title: "Coastal Haven Lodge",
    location: "Andalusia, Spain",
    pricePerNight: "$299",
    guests: 5,
    beds: 3,
    baths: 2,
    image:
      "https://images.unsplash.com/photo-1522708323590-d24dbb6b0262?w=800&q=80",
    rating: 4.7,
    reviews: 312,
    tag: "Top Rated",
  },
  {
    title: "Brass Lantern Inn",
    location: "Paris, France",
    pricePerNight: "$325",
    guests: 6,
    beds: 3,
    baths: 2,
    image:
      "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=800&q=80",
    rating: 4.8,
    reviews: 89,
  },
];

const stats = [
  { icon: Building2, value: "12", label: "Branches" },
  { icon: BedDouble, value: "1,200+", label: "Rooms" },
  { icon: Users, value: "50K+", label: "Happy Guests" },
  { icon: MapPin, value: "8", label: "Countries" },
];

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

const testimonials = [
  {
    quote:
      "SkyNest transformed our booking operations. Staff efficiency improved by 40% in the first quarter.",
    author: "Sarah Chen",
    role: "Operations Director",
    rating: 5,
  },
  {
    quote:
      "The direct booking experience is seamless. Our guests love the instant confirmation and transparent pricing.",
    author: "Marcus Rivera",
    role: "General Manager",
    rating: 5,
  },
  {
    quote:
      "Finally, a system that handles both internal management and guest reservations under one roof.",
    author: "Amara Osei",
    role: "Branch Manager",
    rating: 5,
  },
];

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function IndexPage() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased">
      {/* ── Navigation ── */}
      <nav className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2.5 group">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shadow-md group-hover:shadow-lg transition-shadow duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)]">
              <Globe className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-display text-2xl font-bold tracking-tight">
              SkyNest
            </span>
          </a>

          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-foreground/80">
            <a
              href="#properties"
              className="hover:text-foreground transition-colors duration-150"
            >
              Stays
            </a>
            <a
              href="#features"
              className="hover:text-foreground transition-colors duration-150"
            >
              Features
            </a>
            <a
              href="#testimonials"
              className="hover:text-foreground transition-colors duration-150"
            >
              Reviews
            </a>
            <a
              href="/dashboard"
              className="hover:text-foreground transition-colors duration-150"
            >
              Dashboard
            </a>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              className="rounded-full border-2 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)]"
            >
              Log in
            </Button>
            <Button
              size="sm"
              className="rounded-full shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)]"
            >
              Sign up
            </Button>
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
              size="lg"
              className="rounded-full shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)] px-8"
            >
              Book a Stay
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="rounded-full border-2 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)] px-8"
            >
              Explore Rooms
            </Button>
          </div>
        </div>
      </header>

      {/* ── Search Widget ── */}
      <SearchWidget />

      {/* ── Stats Bar ── */}
      <section className="max-w-5xl mx-auto px-6 mt-20 mb-8">
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
                {stat.value}
              </span>
              <span className="text-xs text-muted-foreground font-medium tracking-wide uppercase">
                {stat.label}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Featured Properties ── */}
      <section id="properties" className="max-w-7xl mx-auto px-6 py-16">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight text-foreground">
              Featured Stays
            </h2>
            <p className="text-muted-foreground mt-2">
              Handpicked rooms across our branches — book directly at the best
              rates.
            </p>
          </div>
          <a
            href="/rooms"
            className="hidden md:inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:text-foreground transition-colors duration-150"
          >
            View All
            <ChevronRight className="w-4 h-4" />
          </a>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {featuredProperties.map((p) => (
            <PropertyCard key={p.title} {...p} />
          ))}
        </div>

        <div className="mt-8 text-center md:hidden">
          <a
            href="/rooms"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:text-foreground transition-colors"
          >
            View All Rooms
            <ChevronRight className="w-4 h-4" />
          </a>
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

      {/* ── Testimonials ── */}
      <section
        id="testimonials"
        className="max-w-7xl mx-auto px-6 py-16 border-t border-border/30"
      >
        <div className="text-center mb-12">
          <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight text-foreground">
            Trusted by Hotel Teams
          </h2>
          <p className="text-muted-foreground mt-2 max-w-xl mx-auto">
            Hear from the professionals who run their operations on SkyNest
            every day.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {testimonials.map((t) => (
            <div
              key={t.author}
              className="rounded-2xl bg-card border-2 border-border p-6 shadow-md hover:shadow-xl transition-all duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)] hover:-translate-y-1 flex flex-col"
            >
              <div className="flex gap-0.5 mb-4">
                {Array.from({ length: t.rating }).map((_, i) => (
                  <Star
                    key={i}
                    className="w-4 h-4 fill-amber-400 text-amber-400"
                  />
                ))}
              </div>
              <blockquote className="text-sm text-foreground leading-relaxed mb-6 flex-1">
                "{t.quote}"
              </blockquote>
              <div className="flex items-center gap-3 pt-4 border-t border-border">
                <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center">
                  <span className="text-sm font-bold text-foreground">
                    {t.author
                      .split(" ")
                      .map((n) => n[0])
                      .join("")}
                  </span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {t.author}
                  </p>
                  <p className="text-xs text-muted-foreground">{t.role}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="max-w-7xl mx-auto px-6 py-16">
        <div className="rounded-3xl bg-primary p-10 md:p-16 text-center shadow-xl">
          <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight text-primary-foreground mb-4">
            Ready to Streamline Your Hotel?
          </h2>
          <p className="text-primary-foreground/70 max-w-xl mx-auto mb-8 leading-relaxed">
            Join hotels worldwide using SkyNest for direct bookings, staff
            management, and guest services — all from one platform.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Button
              size="lg"
              variant="secondary"
              className="rounded-full shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)] px-8 font-semibold"
            >
              Get Started
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="rounded-full border-2 border-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/10 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)] px-8"
            >
              <Clock className="w-4 h-4 mr-2" />
              Book a Demo
            </Button>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border/40 bg-card">
        <div className="max-w-7xl mx-auto px-6 py-12">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-10">
            {/* Brand */}
            <div className="md:col-span-1">
              <a href="/" className="flex items-center gap-2.5 mb-4">
                <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shadow-md">
                  <Globe className="w-4 h-4 text-primary-foreground" />
                </div>
                <span className="font-display text-xl font-bold tracking-tight">
                  SkyNest
                </span>
              </a>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Internal &amp; direct hotel reservation and guest services
                management system.
              </p>
            </div>

            {/* Quick Links */}
            <div>
              <h4 className="text-xs font-semibold text-foreground tracking-wide uppercase mb-3">
                Platform
              </h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  <a
                    href="/rooms"
                    className="hover:text-foreground transition-colors"
                  >
                    Browse Rooms
                  </a>
                </li>
                <li>
                  <a
                    href="/dashboard"
                    className="hover:text-foreground transition-colors"
                  >
                    Dashboard
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-foreground transition-colors">
                    Reservations
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-foreground transition-colors">
                    Guest Services
                  </a>
                </li>
              </ul>
            </div>

            {/* Company */}
            <div>
              <h4 className="text-xs font-semibold text-foreground tracking-wide uppercase mb-3">
                Company
              </h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  <a href="#" className="hover:text-foreground transition-colors">
                    About
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-foreground transition-colors">
                    Careers
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-foreground transition-colors">
                    Press
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-foreground transition-colors">
                    Contact
                  </a>
                </li>
              </ul>
            </div>

            {/* Legal */}
            <div>
              <h4 className="text-xs font-semibold text-foreground tracking-wide uppercase mb-3">
                Legal
              </h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  <a href="#" className="hover:text-foreground transition-colors">
                    Privacy Policy
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-foreground transition-colors">
                    Terms of Service
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-foreground transition-colors">
                    Cookie Policy
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="flex flex-col md:flex-row items-center justify-between gap-4 pt-8 border-t border-border/40">
            <p className="text-xs text-muted-foreground">
              &copy; 2026 SkyNest HRGSMS. All rights reserved.
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
