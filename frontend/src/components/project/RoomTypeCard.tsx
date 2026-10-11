import { Link } from "@tanstack/react-router";
import { BedDouble, MapPin, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { formatLkr } from "@/lib/money";
import type { ShowcaseRoomType } from "@/lib/showcase";

const MAX_AMENITIES = 4;

export function RoomTypeCard({ roomType }: { roomType: ShowcaseRoomType }) {
  const { name, capacity, baseDailyRate, roomCount, amenities, branches } = roomType;
  const cities = [...new Set(branches.map((branch) => branch.city))];
  const singleBranch = branches.length === 1 ? branches[0] : null;
  return (
    <Card className="flex h-full flex-col rounded-2xl border-2 shadow-md transition-all duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)] hover:-translate-y-1 hover:shadow-xl">
      <CardHeader className="space-y-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 shadow-sm">
          <BedDouble className="h-6 w-6 text-primary" />
        </div>
        <CardTitle className="font-display text-xl tracking-tight">{name}</CardTitle>
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {branches.length} {branches.length === 1 ? "branch" : "branches"} · {cities.join(", ")}
        </p>
      </CardHeader>
      <CardContent className="flex-1 space-y-3">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary" className="gap-1">
            <Users className="h-3 w-3" /> Up to {capacity} {capacity === 1 ? "guest" : "guests"}
          </Badge>
          <Badge variant="secondary">
            {roomCount} {roomCount === 1 ? "room" : "rooms"}
          </Badge>
        </div>
        {amenities.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label={`${name} amenities`}>
            {amenities.slice(0, MAX_AMENITIES).map((amenity) => (
              <li key={amenity}>
                <Badge variant="outline">{amenity}</Badge>
              </li>
            ))}
            {amenities.length > MAX_AMENITIES && (
              <li>
                <Badge variant="outline">+{amenities.length - MAX_AMENITIES} more</Badge>
              </li>
            )}
          </ul>
        )}
      </CardContent>
      <CardFooter className="flex items-end justify-between gap-3 border-t pt-4">
        <div>
          <span className="text-xs text-muted-foreground">From</span>
          <p className="text-lg font-bold tracking-tight text-foreground">
            {formatLkr(baseDailyRate)}
            <span className="ml-1 text-xs font-normal text-muted-foreground">/night</span>
          </p>
        </div>
        <Button asChild size="sm" className="rounded-full shadow-md hover:-translate-y-0.5 hover:shadow-lg">
          <Link
            to="/rooms"
            search={{
              roomTypeId: roomType.roomTypeId,
              ...(singleBranch ? { branchId: singleBranch.branchId } : {}),
            }}
          >
            Check availability
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
