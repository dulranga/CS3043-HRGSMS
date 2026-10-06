import { BedDouble, CircleSlash, DoorClosed, LogIn, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  RoomLineStatus,
  STAY_LINE_GRID_CLASS,
  STAY_TABLE_WRAPPER_CLASS,
  StayBookingGroup,
  StayLineView,
  StayOccupancy,
} from "@/lib/activeStayViewModel";

const LINE_STATUS_BADGE: Record<
  RoomLineStatus,
  { label: string; variant: "default" | "secondary" | "outline" }
> = {
  BOOKED: { label: "BOOKED", variant: "secondary" },
  CHECKED_IN: { label: "CHECKED IN", variant: "default" },
  CHECKED_OUT: { label: "CHECKED OUT", variant: "outline" },
  CANCELLED: { label: "CANCELLED", variant: "outline" },
  NO_SHOW: { label: "NO SHOW", variant: "outline" },
};

const OCCUPANCY_BADGE: Record<
  StayOccupancy,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  OCCUPIED: { label: "OCCUPIED", variant: "default" },
  PENDING_CHECK_IN: { label: "AWAITING CHECK-IN", variant: "secondary" },
  DEPARTED: { label: "DEPARTED", variant: "outline" },
  NOT_STAYING: { label: "NOT STAYING", variant: "outline" },
};

function StayLineCard({ line }: { line: StayLineView }) {
  const statusBadge = LINE_STATUS_BADGE[line.status];
  const occupancyBadge = OCCUPANCY_BADGE[line.occupancy];

  return (
    <Card className="shadow-md">
      <CardHeader className="p-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-lg tracking-tight flex items-center gap-2">
            <BedDouble className="size-5" aria-hidden="true" />
            Room {line.roomNumber ?? "unassigned"}
          </CardTitle>
          <Badge variant={occupancyBadge.variant}>{occupancyBadge.label}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
          {line.occupiedFrom ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground tracking-tight">
              <LogIn className="size-4" aria-hidden="true" />
              Occupied from {new Date(line.occupiedFrom).toLocaleString()}
            </span>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <p className="text-xs text-muted-foreground tracking-tight">
          Stay {line.stayStart} to {line.stayEnd} · {line.guestCount} guest
          {line.guestCount === 1 ? "" : "s"} · Line {line.lineId.slice(0, 8)}
        </p>
      </CardContent>
    </Card>
  );
}

function StayBookingSection({ group }: { group: StayBookingGroup }) {
  return (
    <section className="space-y-4">
      <Card className="shadow-md">
        <CardHeader className="p-4 md:p-5 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-xl tracking-tight">
              {group.guestName ?? "Booking"} · {group.bookingRef}
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              {group.isPartiallyOccupied ? (
                <Badge variant="secondary">PARTIALLY OCCUPIED</Badge>
              ) : null}
              <span className="text-xs text-muted-foreground tracking-tight">
                {group.occupiedRoomCount} occupied · {group.pendingRoomCount} awaiting check-in
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 md:p-5 pt-0">
          <div className={STAY_TABLE_WRAPPER_CLASS}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-border text-left">
                  <th className="py-2 px-3 font-semibold tracking-tight">Room</th>
                  <th className="py-2 px-3 font-semibold tracking-tight">Line status</th>
                  <th className="py-2 px-3 font-semibold tracking-tight">Occupancy</th>
                  <th className="py-2 px-3 font-semibold tracking-tight">Stay</th>
                  <th className="py-2 px-3 font-semibold tracking-tight text-right">Guests</th>
                </tr>
              </thead>
              <tbody>
                {group.lines.map((line) => (
                  <tr
                    key={line.lineId}
                    className="border-b border-border last:border-0 hover:bg-accent/40 transition-colors"
                  >
                    <td className="py-2 px-3 font-medium whitespace-nowrap">
                      {line.roomNumber ?? "—"}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">{line.status}</td>
                    <td className="py-2 px-3 whitespace-nowrap">{line.occupancy}</td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      {line.stayStart} to {line.stayEnd}
                    </td>
                    <td className="py-2 px-3 text-right">{line.guestCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className={STAY_LINE_GRID_CLASS}>
        {group.lines.map((line) => (
          <StayLineCard key={`card-${line.lineId}`} line={line} />
        ))}
      </div>
    </section>
  );
}

export function ActiveStayEmptyState() {
  return (
    <Card className="shadow-md">
      <CardContent className="p-6 flex items-start gap-3">
        <DoorClosed className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-sm font-medium">No active stay for this booking.</p>
          <p className="text-sm text-muted-foreground">
            Check a room line in from the check-in screen to see its occupancy here.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function ActiveStayBranchDenial({ message }: { message: string }) {
  return (
    <Card className="shadow-md">
      <CardContent className="p-6 flex items-start gap-3">
        <TriangleAlert className="size-5 shrink-0 text-destructive" aria-hidden="true" />
        <div className="space-y-1">
          <p role="alert" className="text-sm font-medium text-destructive">
            Active stay unavailable
          </p>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function ActiveStayLoadFailure({ message }: { message: string }) {
  return (
    <Card className="shadow-md">
      <CardContent className="p-6 flex items-start gap-3">
        <CircleSlash className="size-5 shrink-0 text-destructive" aria-hidden="true" />
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      </CardContent>
    </Card>
  );
}

interface ActiveStayPanelProps {
  groups: StayBookingGroup[];
}

export function ActiveStayPanel({ groups }: ActiveStayPanelProps) {
  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <StayBookingSection key={group.bookingId} group={group} />
      ))}
    </div>
  );
}