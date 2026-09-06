import { Search, Heart, Menu, Globe } from "lucide-react";
import { PropertyCard } from "@/components/project/PropertyCard";
import { SearchWidget } from "@/components/project/SearchWidget";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const properties = [
  {
    title: "Hidden Quill Haven",
    location: "New York, UAE",
    pricePerNight: "$246",
    guests: 3,
    beds: 2,
    baths: 2,
    image: "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&q=80",
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
    image: "https://images.unsplash.com/photo-1522708323590-d24dbb6b0262?w=800&q=80",
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
    image: "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=800&q=80",
    rating: 4.8,
    reviews: 89,
  },
  {
    title: "Golden Willowbrook",
    location: "Florence, Italy",
    pricePerNight: "$189",
    guests: 4,
    beds: 2,
    baths: 2,
    image: "https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=800&q=80",
    rating: 4.6,
    reviews: 204,
  },
  {
    title: "The Verdant Frame",
    location: "Jakarta, Indonesia",
    pricePerNight: "$210",
    guests: 3,
    beds: 2,
    baths: 2,
    image: "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&q=80",
    rating: 4.5,
    reviews: 78,
  },
  {
    title: "Silver Fern Estate",
    location: "Yellowknife, Canada",
    pricePerNight: "$175",
    guests: 4,
    beds: 2,
    baths: 2,
    image: "https://images.unsplash.com/photo-1582610116517-9fa4d6a6e13e?w=800&q=80",
    rating: 4.7,
    reviews: 156,
  },
];

export default function UIRoutePage() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <a href="#" className="flex items-center gap-2.5 group">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shadow-md group-hover:shadow-lg transition-shadow">
              <Globe className="w-5 h-5 text-foreground" />
            </div>
            <span className="font-display text-2xl font-bold tracking-tight">SkyNest</span>
          </a>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-foreground/80">
            <a href="#" className="hover:text-foreground transition-colors">Stays</a>
            <a href="#" className="hover:text-foreground transition-colors">Experiences</a>
            <a href="#" className="hover:text-foreground transition-colors">About</a>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" className="rounded-full border-2 shadow-sm hover:shadow-md hover:-translate-y-0.5">
              Log in
            </Button>
            <Button size="sm" className="rounded-full shadow-md hover:shadow-lg hover:-translate-y-0.5">
              Sign up
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <header className="relative overflow-hidden rounded-b-[3rem] bg-background">
        <div className="max-w-7xl mx-auto px-6 pt-16 pb-32 text-center">
          <h1 className="font-display text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-[0.95] text-foreground mb-4 max-w-4xl mx-auto">
            Unwind in Stunning Resorts,
            <br />
            <span className="text-primary">Direct Hotel Booking & Internal Management.</span>
          </h1>
            <p className="text-base md:text-lg text-muted-foreground max-w-xl mx-auto mb-2 leading-relaxed">
            Internal direct booking and staff management — seamless, secure, and brand-controlled.
          </p>
          <p className="text-xs font-medium text-accent-foreground bg-accent/20 inline-block px-3 py-1 rounded-full mb-10 tracking-wide uppercase">
            Internal Bookings — Staff & Direct Guest
          </p>
        </div>
      </header>

      <SearchWidget />

      {/* Featured Properties */}
      <section className="max-w-7xl mx-auto px-6 py-16">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight text-foreground">Property Management & Direct Booking</h2>
            <p className="text-muted-foreground mt-3">Internal staff allocation, direct reservations, and brand-controlled stays.</p>
          </div>
          <a href="#" className="hidden md:inline-flex items-center gap-2 text-sm font-semibold text-primary hover:text-foreground transition-colors">
            See All <span aria-hidden="true">→</span>
          </a>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {properties.map((p) => (
            <PropertyCard key={p.title} {...p} />
          ))}
        </div>
      </section>

      {/* Showcase: Component Geometry */}
      <section className="max-w-7xl mx-auto px-6 py-16 border-t border-border/30">
        <h2 className="font-display text-2xl md:text-3xl font-bold tracking-tight text-foreground mb-3">Internal System Components</h2>
        <p className="text-muted-foreground max-w-2xl mb-8">Built for dual-purpose use: staff management and direct guest booking.</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-16">
          <div className="rounded-2xl bg-card border-2 border-border p-6 shadow-md hover:shadow-xl transition-all duration-150 hover:-translate-y-1">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 shadow-sm">
              <Heart className="w-6 h-6 text-primary" />
            </div>
            <h3 className="font-display text-xl font-semibold tracking-tight mb-2">Variable Radius</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">Inner elements always match parent radius. Consistent geometry across staff and guest interfaces.</p>
          </div>
          <div className="rounded-2xl bg-card border-2 border-border p-6 shadow-md hover:shadow-xl transition-all duration-150 hover:-translate-y-1">
            <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center mb-4 shadow-sm">
              <Menu className="w-6 h-6 text-accent-foreground" />
            </div>
            <h3 className="font-display text-xl font-semibold tracking-tight mb-2">Direct & Internal Booking</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">Components support both staff management workflows and direct guest reservations.</p>
          </div>
          <div className="rounded-2xl bg-card border-2 border-border p-6 shadow-md hover:shadow-xl transition-all duration-150 hover:-translate-y-1">
            <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center mb-4 shadow-sm">
              <Search className="w-6 h-6 text-foreground" />
            </div>
            <h3 className="font-display text-xl font-semibold tracking-tight mb-2">Quick Gentle Motion</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">150ms transitions for internal actions and direct booking flows.</p>
          </div>
        </div>

        {/* Interactive Form Demo */}
        <div className="rounded-3xl bg-secondary/30 border-2 border-border p-6 md:p-8 shadow-lg">
          <h3 className="font-display text-xl md:text-2xl font-bold tracking-tight mb-2">Interactive Booking Widget</h3>
          <p className="text-muted-foreground mb-6">Try the search inputs with focus ring geometry and button hover dynamics.</p>
          <form className="grid grid-cols-1 md:grid-cols-3 gap-4" onSubmit={(e) => e.preventDefault()}>
            <Input placeholder="Destination" className="h-11 rounded-2xl text-sm bg-background border-2" />
            <Input placeholder="Check in — Check out" className="h-11 rounded-2xl text-sm bg-background border-2" />
            <Button size="sm" className="h-11 rounded-2xl text-sm font-bold shadow-md hover:shadow-xl hover:-translate-y-0.5">Find Stays</Button>
          </form>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/40 bg-card">
        <div className="max-w-7xl mx-auto px-6 py-12 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shadow-md">
              <Globe className="w-4 h-4 text-foreground" />
            </div>
            <span className="font-display text-xl font-bold tracking-tight">SkyNest</span>
          </div>
          <p className="text-xs text-muted-foreground">© 2026 SkyNest HRGSMS — Internal & Direct Hotel Booking System.</p>
        </div>
      </footer>
    </div>
  );
}
