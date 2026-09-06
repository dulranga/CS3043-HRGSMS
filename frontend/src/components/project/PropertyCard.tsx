import { Heart, Users, BedDouble, Waves, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface PropertyCardProps {
  title: string;
  location: string;
  pricePerNight: string;
  guests: number;
  beds: number;
  baths: number;
  image: string;
  rating?: number;
  reviews?: number;
  tag?: string;
  className?: string;
}

export function PropertyCard({
  title,
  location,
  pricePerNight,
  guests,
  beds,
  baths,
  image,
  rating = 4.8,
  reviews = 124,
  tag,
  className,
}: PropertyCardProps) {
  return (
    <article
      className={cn(
        "group relative rounded-2xl overflow-hidden bg-card border-2 border-border shadow-md hover:shadow-xl transition-all duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)] hover:-translate-y-1",
        className
      )}
    >
      <a href="#" className="block relative h-60 overflow-hidden rounded-t-2xl">
        <img
          src={image}
          alt={title}
          className="w-full h-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.45,0.15,0.55,0.85)] group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
        {tag && (
          <span className="absolute top-4 left-4 rounded-full bg-accent/95 text-accent-foreground text-xs font-bold px-3 py-1 shadow-md backdrop-blur-sm">
            {tag}
          </span>
        )}
        <button
          aria-label="Save to favorites"
          className="absolute top-4 right-4 h-9 w-9 rounded-full bg-white/90 text-foreground shadow-md hover:bg-white hover:shadow-lg transition-all duration-150 flex items-center justify-center backdrop-blur-sm"
          onClick={(e) => {
            e.preventDefault();
            e.currentTarget.classList.toggle("text-red-600");
            e.currentTarget.classList.toggle("fill-red-600");
          }}
        >
          <Heart className="w-4 h-4" />
        </button>
        <div className="absolute bottom-4 left-4 flex items-center gap-2 bg-white/90 backdrop-blur-sm rounded-full px-3 py-1 shadow-md">
          <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
          <span className="text-xs font-bold text-foreground">{rating}</span>
          <span className="text-xs text-muted-foreground">({reviews})</span>
        </div>
      </a>
      <div className="p-4 space-y-2">
        <div>
          <h3 className="font-display text-lg font-semibold leading-tight tracking-tight text-foreground group-hover:text-primary transition-colors">
            <a href="#" className="focus:outline-none">{title}</a>
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">{location}</p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
          <span className="inline-flex items-center gap-1 bg-secondary px-2 py-0.5 rounded-md font-medium text-[11px]">
            <Users className="w-3 h-3" /> {guests} Guests
          </span>
          <span className="inline-flex items-center gap-1 bg-secondary px-2 py-0.5 rounded-md font-medium text-[11px]">
            <BedDouble className="w-3 h-3" /> {beds} Beds
          </span>
          <span className="inline-flex items-center gap-1 bg-secondary px-2 py-0.5 rounded-md font-medium text-[11px]">
            <Waves className="w-3 h-3" /> {baths} Baths
          </span>
        </div>
        <div className="flex items-end justify-between pt-2 border-t border-border">
          <div>
            <span className="text-xl font-bold text-foreground tracking-tight">{pricePerNight}</span>
            <span className="text-xs text-muted-foreground ml-1">/night</span>
          </div>
          <Button size="sm" variant="default" className="rounded-full shadow-md hover:shadow-lg hover:-translate-y-0.5">
            Book Now
          </Button>
        </div>
      </div>
    </article>
  );
}
