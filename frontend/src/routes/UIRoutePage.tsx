import {
  Globe,
  Heart,
  Search,
  Mail,
  Lock,
  User,
  ArrowRight,
  Star,
  MousePointerClick,
  Move,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { FormItem, FormLabel, FormDescription, FormMessage } from "@/components/ui/form";
import { PropertyCard } from "@/components/project/PropertyCard";
import { SearchWidget } from "@/components/project/SearchWidget";
import { BentoGrid } from "@/components/layout/BentoGrid";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function SectionHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mb-8">
      <h2 className="font-display text-2xl md:text-3xl font-bold tracking-tight text-foreground">
        {title}
      </h2>
      <p className="text-muted-foreground mt-1 max-w-2xl text-sm leading-relaxed">
        {description}
      </p>
    </div>
  );
}

function ShowcaseBox({
  label,
  children,
  className = "",
}: {
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {label && (
        <span className="text-xs font-medium text-muted-foreground tracking-wide uppercase">
          {label}
        </span>
      )}
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Data                                                               */
/* ------------------------------------------------------------------ */

const colors: { token: string; variable: string; bg: string; ring?: boolean }[] = [
  { token: "background", variable: "--color-background", bg: "bg-background" },
  { token: "foreground", variable: "--color-foreground", bg: "bg-foreground" },
  { token: "card", variable: "--color-card", bg: "bg-card" },
  { token: "primary", variable: "--color-primary", bg: "bg-primary" },
  { token: "primary-fg", variable: "--color-primary-foreground", bg: "bg-primary-foreground" },
  { token: "secondary", variable: "--color-secondary", bg: "bg-secondary" },
  { token: "muted", variable: "--color-muted", bg: "bg-muted" },
  { token: "muted-fg", variable: "--color-muted-foreground", bg: "bg-muted-foreground" },
  { token: "accent", variable: "--color-accent", bg: "bg-accent" },
  { token: "border", variable: "--color-border", bg: "bg-border" },
  { token: "ring", variable: "--color-ring", bg: "bg-ring" },
  { token: "destructive", variable: "--color-destructive", bg: "bg-destructive" },
];

const typeSamples: { label: string; className: string }[] = [
  { label: "text-xs", className: "text-xs" },
  { label: "text-sm", className: "text-sm" },
  { label: "text-base", className: "text-base" },
  { label: "text-lg", className: "text-lg" },
  { label: "text-xl", className: "text-xl" },
  { label: "text-2xl", className: "text-2xl font-display font-bold tracking-tight" },
  { label: "text-3xl", className: "text-3xl font-display font-bold tracking-tight" },
  { label: "text-4xl", className: "text-4xl font-display font-bold tracking-tight" },
];

const radii: { label: string; className: string; size: string }[] = [
  { label: "xs", className: "rounded-xs", size: "0.375rem" },
  { label: "sm", className: "rounded-sm", size: "0.5rem" },
  { label: "md", className: "rounded-md", size: "0.75rem" },
  { label: "lg", className: "rounded-lg", size: "1rem" },
  { label: "xl", className: "rounded-xl", size: "1.5rem" },
  { label: "2xl", className: "rounded-2xl", size: "2rem" },
  { label: "3xl", className: "rounded-3xl", size: "3rem" },
  { label: "full", className: "rounded-full", size: "9999px" },
];

const shadows: { label: string; className: string }[] = [
  { label: "shadow-sm", className: "shadow-sm" },
  { label: "shadow-md", className: "shadow-md" },
  { label: "shadow-lg", className: "shadow-lg" },
  { label: "shadow-xl", className: "shadow-xl" },
  { label: "shadow-2xl", className: "shadow-2xl" },
];

const spacingScale = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32];

const buttonVariants = ["default", "destructive", "outline", "secondary", "ghost", "link"] as const;

const sampleProperty = {
  title: "Coastal Haven Lodge",
  location: "Andalusia, Spain",
  pricePerNight: "$299",
  guests: 5,
  beds: 3,
  baths: 2,
  image: "https://images.unsplash.com/photo-1522708323590-d24dbb6b0262?w=800&q=80",
  rating: 4.7,
  reviews: 312,
  tag: "Top Rated",
};

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function UIRoutePage() {
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
            <a href="#colors" className="hover:text-foreground transition-colors duration-150">Colors</a>
            <a href="#typography" className="hover:text-foreground transition-colors duration-150">Type</a>
            <a href="#components" className="hover:text-foreground transition-colors duration-150">Components</a>
            <a href="#composed" className="hover:text-foreground transition-colors duration-150">Composed</a>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" className="rounded-full border-2 shadow-sm hover:shadow-md hover:-translate-y-0.5">
              <a href="/">Home</a>
            </Button>
          </div>
        </div>
      </nav>

      {/* ── Page Header ── */}
      <header className="max-w-7xl mx-auto px-6 pt-16 pb-10 text-center">
        <p className="text-xs font-semibold text-muted-foreground bg-secondary/60 inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-6 tracking-wide uppercase">
          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          Design System Showcase
        </p>
        <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight leading-tight text-foreground mb-3">
          SkyNest UI Kit
        </h1>
        <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">
          Every design token, primitive, and composed component used in the
          SkyNest HRGSMS — rendered live with the Mono theme.
        </p>
      </header>

      <div className="max-w-7xl mx-auto px-6 pb-20 space-y-20">

        {/* ══════════════════════════════════════════════════════════ */}
        {/*  SECTION: Color Palette                                   */}
        {/* ══════════════════════════════════════════════════════════ */}
        <section id="colors">
          <SectionHeading
            title="Color Palette"
            description="Mono theme (locked). All 12 semantic tokens mapped to Tailwind v4 CSS variables. No alternate palettes."
          />
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {colors.map((c) => (
              <div
                key={c.token}
                className="rounded-2xl border-2 border-border overflow-hidden bg-card shadow-sm hover:shadow-md transition-all duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)]"
              >
                <div className={`${c.bg} h-16 w-full`} />
                <div className="p-3">
                  <p className="text-xs font-semibold text-foreground tracking-tight">{c.token}</p>
                  <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{c.variable}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════ */}
        {/*  SECTION: Typography                                      */}
        {/* ══════════════════════════════════════════════════════════ */}
        <section id="typography">
          <SectionHeading
            title="Typography"
            description="DM Sans geometric sans-serif. Fluid clamp() scale from text-xs to text-4xl. Font-display for headlines."
          />

          <div className="rounded-2xl border-2 border-border bg-card p-6 shadow-md space-y-6">
            {typeSamples.map((t) => (
              <div key={t.label} className="flex items-baseline gap-4 border-b border-border/40 pb-4 last:border-0 last:pb-0">
                <span className="text-[10px] font-mono text-muted-foreground w-20 shrink-0 uppercase tracking-wider">
                  {t.label}
                </span>
                <p className={t.className}>The quick brown fox jumps over the lazy dog</p>
              </div>
            ))}
          </div>

          {/* Tracking */}
          <div className="mt-8">
            <h3 className="font-display text-lg font-semibold tracking-tight mb-4">Letter Spacing</h3>
            <div className="rounded-2xl border-2 border-border bg-card p-6 shadow-sm space-y-3">
              {[
                { label: "tighter", cls: "tracking-tighter", val: "-0.04em" },
                { label: "tight", cls: "tracking-tight", val: "-0.025em" },
                { label: "normal", cls: "tracking-normal", val: "0em" },
                { label: "wide", cls: "tracking-wide", val: "0.03em" },
                { label: "wider", cls: "tracking-wider", val: "0.06em" },
                { label: "widest", cls: "tracking-widest", val: "0.12em" },
              ].map((t) => (
                <div key={t.label} className="flex items-center gap-4">
                  <span className="text-[10px] font-mono text-muted-foreground w-24 shrink-0">
                    {t.label} ({t.val})
                  </span>
                  <span className={`text-base font-medium ${t.cls}`}>SkyNest Hotel Reservation System</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════ */}
        {/*  SECTION: Border Radius                                   */}
        {/* ══════════════════════════════════════════════════════════ */}
        <section id="geometry">
          <SectionHeading
            title="Border Radius"
            description="Variable radius scale from xs (0.375rem) to full (9999px). Inner-match rule: children always match parent radius."
          />
          <div className="flex flex-wrap gap-4 items-end">
            {radii.map((r) => (
              <div key={r.label} className="flex flex-col items-center gap-2">
                <div
                  className={`w-16 h-16 ${r.className} bg-primary border-2 border-border shadow-md`}
                />
                <span className="text-[10px] font-mono text-muted-foreground">{r.label}</span>
                <span className="text-[9px] text-muted-foreground/60">{r.size}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════ */}
        {/*  SECTION: Shadows                                         */}
        {/* ══════════════════════════════════════════════════════════ */}
        <section>
          <SectionHeading
            title="Elevation / Shadows"
            description="Soft diffused shadows using oklch derived from --card color. 5-step scale from sm to 2xl."
          />
          <div className="flex flex-wrap gap-6 items-end">
            {shadows.map((s) => (
              <div key={s.label} className="flex flex-col items-center gap-3">
                <div
                  className={`w-24 h-24 rounded-2xl bg-card border-2 border-border ${s.className}`}
                />
                <span className="text-[10px] font-mono text-muted-foreground">{s.label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════ */}
        {/*  SECTION: Spacing                                         */}
        {/* ══════════════════════════════════════════════════════════ */}
        <section>
          <SectionHeading
            title="Spacing Scale"
            description="Modular 4px base unit. Reduced luxury spacing for compact layout rhythm."
          />
          <div className="rounded-2xl border-2 border-border bg-card p-6 shadow-sm space-y-2">
            {spacingScale.map((s) => (
              <div key={s} className="flex items-center gap-4">
                <span className="text-[10px] font-mono text-muted-foreground w-8 text-right shrink-0">
                  {s}
                </span>
                <div
                  className="h-3 rounded-xs bg-primary/80"
                  style={{ width: `${s * 0.25}rem` }}
                />
                <span className="text-[10px] text-muted-foreground/60">
                  {s * 4}px
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════ */}
        {/*  SECTION: Buttons                                         */}
        {/* ══════════════════════════════════════════════════════════ */}
        <section id="components">
          <SectionHeading
            title="Button"
            description="6 variants (default, destructive, outline, secondary, ghost, link) x 4 sizes (sm, default, lg, icon). CVA-based with Radix Slot support."
          />

          {/* Variants */}
          <div className="space-y-6">
            <ShowcaseBox label="Variants — default size">
              {buttonVariants.map((v) => (
                <Button key={v} variant={v}>
                  {v === "link" ? "Link Text" : v.charAt(0).toUpperCase() + v.slice(1)}
                </Button>
              ))}
            </ShowcaseBox>

            <ShowcaseBox label="Sizes — default variant">
              <Button size="sm">Small</Button>
              <Button size="default">Default</Button>
              <Button size="lg">Large</Button>
              <Button size="icon">
                <Heart className="w-4 h-4" />
              </Button>
            </ShowcaseBox>

            <ShowcaseBox label="With icons">
              <Button>
                <Search className="w-4 h-4 mr-2" />
                Search
              </Button>
              <Button variant="outline">
                <Mail className="w-4 h-4 mr-2" />
                Email
              </Button>
              <Button variant="secondary">
                Next
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </ShowcaseBox>

            <ShowcaseBox label="Rounded full (pill)">
              <Button className="rounded-full">Default Pill</Button>
              <Button variant="outline" className="rounded-full border-2">Outline Pill</Button>
              <Button variant="destructive" className="rounded-full">Destructive Pill</Button>
            </ShowcaseBox>

            <ShowcaseBox label="Disabled state">
              <Button disabled>Disabled</Button>
              <Button variant="outline" disabled>Outline Disabled</Button>
              <Button variant="secondary" disabled>Secondary Disabled</Button>
            </ShowcaseBox>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════ */}
        {/*  SECTION: Input                                           */}
        {/* ══════════════════════════════════════════════════════════ */}
        <section>
          <SectionHeading
            title="Input"
            description="Rounded-xl, border-2, shadow-sm. Focus ring with ring-ring/50. Supports all native input types."
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <ShowcaseBox label="Default">
                <Input placeholder="Enter your name..." className="max-w-sm" />
              </ShowcaseBox>
              <ShowcaseBox label="Disabled">
                <Input placeholder="Disabled input" disabled className="max-w-sm" />
              </ShowcaseBox>
              <ShowcaseBox label="With type">
                <Input type="email" placeholder="Email address" className="max-w-sm" />
              </ShowcaseBox>
              <ShowcaseBox label="Password">
                <Input type="password" placeholder="Password" className="max-w-sm" />
              </ShowcaseBox>
            </div>

            <div className="space-y-4">
              <ShowcaseBox label="With icon prefix">
                <div className="relative max-w-sm w-full">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input placeholder="Search..." className="pl-10" />
                </div>
              </ShowcaseBox>
              <ShowcaseBox label="With icon prefix (user)">
                <div className="relative max-w-sm w-full">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input placeholder="Username" className="pl-10" />
                </div>
              </ShowcaseBox>
              <ShowcaseBox label="With icon prefix (lock)">
                <div className="relative max-w-sm w-full">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input type="password" placeholder="Password" className="pl-10" />
                </div>
              </ShowcaseBox>
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════ */}
        {/*  SECTION: Label                                           */}
        {/* ══════════════════════════════════════════════════════════ */}
        <section>
          <SectionHeading
            title="Label"
            description="Radix Label primitive. tracking-tight, medium weight. Muted disabled state via peer-disabled."
          />
          <div className="rounded-2xl border-2 border-border bg-card p-6 shadow-sm space-y-4 max-w-md">
            <div className="space-y-2">
              <Label htmlFor="label-demo">Full Name</Label>
              <Input id="label-demo" placeholder="John Doe" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="label-demo-email">Email</Label>
              <Input id="label-demo-email" type="email" placeholder="john@example.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="label-disabled">Disabled Field</Label>
              <Input id="label-disabled" placeholder="Can't edit" disabled />
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════ */}
        {/*  SECTION: Form                                            */}
        {/* ══════════════════════════════════════════════════════════ */}
        <section>
          <SectionHeading
            title="Form Components"
            description="FormItem, FormLabel, FormDescription, FormMessage — context-driven error handling and accessible markup."
          />
          <div className="rounded-2xl border-2 border-border bg-card p-6 shadow-md max-w-lg space-y-6">
            {/* Normal field */}
            <FormItem>
              <FormLabel>Guest Name</FormLabel>
              <Input placeholder="Enter guest name" />
              <FormDescription>Full legal name as it appears on ID.</FormDescription>
            </FormItem>

            {/* Field with error message */}
            <FormItem>
              <FormLabel className="text-destructive">Check-in Date</FormLabel>
              <Input placeholder="Select date" className="border-destructive" />
              <FormMessage>Check-in date is required.</FormMessage>
            </FormItem>

            {/* Normal field */}
            <FormItem>
              <FormLabel>Special Requests</FormLabel>
              <Input placeholder="e.g. Late check-in, extra pillows" />
              <FormDescription>Optional. We'll do our best to accommodate.</FormDescription>
            </FormItem>

            <Button className="w-full">Submit Reservation</Button>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════ */}
        {/*  SECTION: Card                                            */}
        {/* ══════════════════════════════════════════════════════════ */}
        <section>
          <SectionHeading
            title="Card"
            description="rounded-2xl, border-2, shadow-md, hover:shadow-xl. 6 subcomponents: Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter."
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Basic card */}
            <Card>
              <CardHeader>
                <CardTitle>Basic Card</CardTitle>
                <CardDescription>Card with header, content, and footer subcomponents.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  This card demonstrates the default styling — rounded-2xl corners, border-2,
                  shadow-md with hover:shadow-xl elevation shift.
                </p>
              </CardContent>
              <CardFooter>
                <Button size="sm">Action</Button>
                <Button size="sm" variant="outline">Cancel</Button>
              </CardFooter>
            </Card>

            {/* Stat card */}
            <Card>
              <CardHeader>
                <CardDescription>Total Bookings</CardDescription>
                <CardTitle className="text-4xl">2,847</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  +12.5% from last month
                </p>
              </CardContent>
            </Card>

            {/* Image card */}
            <Card className="overflow-hidden">
              <div className="h-40 overflow-hidden">
                <img
                  src="https://images.unsplash.com/photo-1566073771259-6a8506099945?w=600&q=80"
                  alt="Hotel"
                  className="w-full h-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.45,0.15,0.55,0.85)] hover:scale-105"
                />
              </div>
              <CardHeader>
                <CardTitle className="text-lg">With Image</CardTitle>
                <CardDescription>Card with a top image and rounded-2xl overflow hidden.</CardDescription>
              </CardHeader>
              <CardFooter>
                <Button size="sm" className="rounded-full">Book Now</Button>
              </CardFooter>
            </Card>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════ */}
        {/*  SECTION: Motion                                          */}
        {/* ══════════════════════════════════════════════════════════ */}
        <section>
          <SectionHeading
            title="Motion & Interactions"
            description="150ms duration, cubic-bezier(0.45, 0.15, 0.55, 0.85). Hover lift, shadow depth increase, image zoom. No spring bounce."
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-2xl bg-card border-2 border-border p-6 shadow-md hover:shadow-xl transition-all duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)] hover:-translate-y-1 cursor-pointer">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                <Move className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-display text-lg font-semibold tracking-tight mb-1">Hover Lift</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                -translate-y-1 + shadow-md to shadow-xl on hover. Hover over this card.
              </p>
            </div>

            <div className="rounded-2xl bg-card border-2 border-border p-6 shadow-md hover:shadow-xl transition-all duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)] hover:-translate-y-0.5 cursor-pointer group">
              <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center mb-3 group-hover:bg-primary/10 transition-colors duration-150">
                <Star className="w-5 h-5 text-foreground group-hover:text-primary transition-colors duration-150" />
              </div>
              <h3 className="font-display text-lg font-semibold tracking-tight mb-1">Color Transition</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Icon and background transition colors on group hover. Subtle state shift.
              </p>
            </div>

            <div className="rounded-2xl border-2 border-border overflow-hidden shadow-md hover:shadow-xl transition-all duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)] cursor-pointer group">
              <div className="h-32 overflow-hidden">
                <img
                  src="https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=600&q=80"
                  alt="Hotel room"
                  className="w-full h-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.45,0.15,0.55,0.85)] group-hover:scale-105"
                />
              </div>
              <div className="p-4 bg-card">
                <div className="flex items-center gap-2 mb-1">
                  <MousePointerClick className="w-4 h-4 text-primary" />
                  <h3 className="font-display text-lg font-semibold tracking-tight">Image Zoom</h3>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  scale-105 on 500ms ease. Hover over the image area above.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════ */}
        {/*  SECTION: Layout Components                               */}
        {/* ══════════════════════════════════════════════════════════ */}
        <section>
          <SectionHeading
            title="Layout Components"
            description="Reusable layout primitives: BentoGrid, PageContainer, BoundedContainer, SectionWrapper. Used across dashboard and public pages."
          />

          <h3 className="font-display text-lg font-semibold tracking-tight mb-4">BentoGrid</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Responsive 1 / 2 / 3 column grid with gap-4 and auto-rows minmax(12rem, auto).
          </p>
          <BentoGrid>
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="rounded-2xl bg-card border-2 border-border p-6 shadow-sm flex items-center justify-center"
              >
                <span className="text-2xl font-display font-bold text-muted-foreground/40">{i}</span>
              </div>
            ))}
          </BentoGrid>

          <div className="mt-10">
            <h3 className="font-display text-lg font-semibold tracking-tight mb-2">Container Classes</h3>
            <div className="rounded-2xl border-2 border-border bg-card p-6 shadow-sm space-y-3">
              {[
                { name: "PageContainer", desc: "Fluid full-width padding: px-4 md:px-6, py-6 md:py-8" },
                { name: "BoundedContainer", desc: "Centered max-w-7xl with horizontal padding" },
                { name: "SectionWrapper", desc: "Vertical rhythm spacer: py-8 md:py-12" },
                { name: "BentoGrid", desc: "Responsive grid: 1 / 2 / 3 cols, gap-4, auto-rows" },
                { name: "AppShell", desc: "Sidebar + sticky header + scrollable content pane" },
              ].map((c) => (
                <div key={c.name} className="flex items-baseline gap-3 border-b border-border/30 pb-3 last:border-0 last:pb-0">
                  <code className="text-xs font-mono bg-secondary px-2 py-0.5 rounded-md font-semibold text-foreground shrink-0">
                    {c.name}
                  </code>
                  <span className="text-xs text-muted-foreground">{c.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════ */}
        {/*  SECTION: Composed — SearchWidget                        */}
        {/* ══════════════════════════════════════════════════════════ */}
        <section id="composed">
          <SectionHeading
            title="SearchWidget"
            description="Floating search bar with icon-prefixed inputs, backdrop-blur glass card, and responsive 4-column grid. Composed from Input + Button."
          />
          <div className="rounded-3xl bg-secondary/20 border-2 border-border p-8 shadow-sm">
            <div className="relative">
              <SearchWidget />
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════ */}
        {/*  SECTION: Composed — PropertyCard                        */}
        {/* ══════════════════════════════════════════════════════════ */}
        <section>
          <SectionHeading
            title="PropertyCard"
            description="Luxury hotel property card. Image with hover zoom, tag badge, favorite button, rating pill, amenity badges, price, and book action."
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <PropertyCard {...sampleProperty} />
            <PropertyCard
              title="Hidden Quill Haven"
              location="New York, USA"
              pricePerNight="$246"
              guests={3}
              beds={2}
              baths={2}
              image="https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&q=80"
              rating={4.9}
              reviews={128}
              tag="Trending"
            />
            <PropertyCard
              title="Brass Lantern Inn"
              location="Paris, France"
              pricePerNight="$325"
              guests={6}
              beds={3}
              baths={2}
              image="https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=800&q=80"
              rating={4.8}
              reviews={89}
            />
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════ */}
        {/*  SECTION: Iconography                                     */}
        {/* ══════════════════════════════════════════════════════════ */}
        <section>
          <SectionHeading
            title="Iconography"
            description="Lucide React icons. Two standard sizes: w-4 h-4 (inline) and w-6 h-6 (feature). Uniform stroke width."
          />
          <div className="flex flex-wrap gap-4">
            {(
              [
                ["Globe", Globe],
                ["Heart", Heart],
                ["Search", Search],
                ["Mail", Mail],
                ["Lock", Lock],
                ["User", User],
                ["Star", Star],
                ["ArrowRight", ArrowRight],
                ["MousePointerClick", MousePointerClick],
                ["Move", Move],
              ] as [string, LucideIcon][]
            ).map(([name, Icon]) => (
              <div
                key={name}
                className="flex flex-col items-center gap-2 rounded-xl border-2 border-border bg-card p-4 shadow-sm hover:shadow-md transition-all duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)]"
              >
                <Icon className="w-6 h-6 text-foreground" />
                <span className="text-[10px] font-mono text-muted-foreground">{name}</span>
              </div>
            ))}
          </div>
        </section>

      </div>

      {/* ── Footer ── */}
      <footer className="border-t border-border/40 bg-card">
        <div className="max-w-7xl mx-auto px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shadow-md">
              <Globe className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-display text-xl font-bold tracking-tight">SkyNest</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Design System Showcase — SkyNest HRGSMS Mono Theme
          </p>
        </div>
      </footer>
    </div>
  );
}
