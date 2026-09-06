import { Search, MapPin, Calendar, User } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function SearchWidget() {
  return (
    <section className="w-full max-w-5xl mx-auto -mt-16 relative z-10 px-6">
      <div className="bg-card/95 backdrop-blur-md rounded-3xl border-2 border-border shadow-2xl p-6 md:p-8">
        <form
          className="grid grid-cols-1 md:grid-cols-4 gap-4 md:gap-3"
          onSubmit={(e) => e.preventDefault()}
        >
          <div className="relative md:col-span-1">
            <label htmlFor="where" className="sr-only">Where</label>
            <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              id="where"
              placeholder="Where to?"
              className="pl-10 h-12 rounded-xl bg-background border-border text-base shadow-sm focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:border-primary"
            />
          </div>
          <div className="relative md:col-span-1">
            <label htmlFor="date" className="sr-only">Dates</label>
            <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              id="date"
              placeholder="Nov 01 — Dec 05"
              className="pl-10 h-12 rounded-xl bg-background border-border text-base shadow-sm focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:border-primary"
            />
          </div>
          <div className="relative md:col-span-1">
            <label htmlFor="guests" className="sr-only">Guests</label>
            <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              id="guests"
              placeholder="2 Adults, 1 Child"
              className="pl-10 h-12 rounded-xl bg-background border-border text-base shadow-sm focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:border-primary"
            />
          </div>
          <Button
            type="submit"
            className="h-12 rounded-xl text-base font-semibold shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)]"
          >
            <Search className="w-4 h-4 mr-2" />
            Search
          </Button>
        </form>
      </div>
    </section>
  );
}
