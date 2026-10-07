import {
  CheckCircle2,
  CircleAlert,
  CircleSlash,
  DoorOpen,
  Hourglass,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CheckInLine,
  LineCheckInState,
  RoomLineStatus,
} from "@/lib/checkInViewModel";

const LINE_STATUS_BADGE: Record<RoomLineStatus, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  BOOKED: { label: "BOOKED", variant: "secondary" },
  CHECKED_IN: { label: "CHECKED IN", variant: "default" },
  CHECKED_OUT: { label: "CHECKED OUT", variant: "outline" },
  CANCELLED: { label: "CANCELLED", variant: "outline" },
  NO_SHOW: { label: "NO SHOW", variant: "outline" },
};

const ROOM_CONDITION_BADGE = {
  READY: { label: "READY", variant: "default" as const },
  CLEANING: { label: "CLEANING", variant: "secondary" as const },
  OUT_OF_SERVICE: { label: "OUT OF SERVICE", variant: "destructive" as const },
};

interface LineCheckInCardProps {
  line: CheckInLine;
  state: LineCheckInState;
  isPending: boolean;
  rejection?: string;
  onCheckIn: (line: CheckInLine) => void;
}

function LineCheckInCard({ line, state, isPending, rejection, onCheckIn }: LineCheckInCardProps) {
  const statusBadge = LINE_STATUS_BADGE[line.status];
  const condition = state.roomCondition;
  const conditionBadge = condition ? ROOM_CONDITION_BADGE[condition] : null;
  const checkedInAssignment = line.assignments.find(
    (assignment) => assignment.assignmentId !== undefined && assignment.occupiedFrom !== null
  );

  return (
    <Card className="shadow-md">
      <CardHeader className="p-4 md:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-lg tracking-tight flex items-center gap-2">
            <DoorOpen className="size-5" aria-hidden="true" />
            Room {state.roomNumber ?? "unassigned"}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
            {conditionBadge ? (
              <Badge variant={conditionBadge.variant}>{conditionBadge.label}</Badge>
            ) : null}
          </div>
        </div>
        <p className="text-xs text-muted-foreground tracking-tight">
          Stay {line.checkIn} to {line.checkOut} · {line.guestCount} guest
          {line.guestCount === 1 ? "" : "s"} · Line {line.lineId.slice(0, 8)}
        </p>
      </CardHeader>

      <CardContent className="p-4 md:p-5 pt-0 space-y-3">
        <p className="text-sm text-muted-foreground leading-relaxed">{state.summary}</p>

        {checkedInAssignment ? (
          <p className="text-xs text-muted-foreground tracking-tight">
            Occupancy started {new Date(checkedInAssignment.occupiedFrom as string).toLocaleString()}
          </p>
        ) : null}

        {rejection ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border-2 border-destructive bg-card p-3 text-sm text-destructive"
          >
            <CircleAlert className="size-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{rejection}</span>
          </div>
        ) : null}

        {line.status === 'CHECKED_IN' ? (
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Guest checked in to this room only.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={!state.checkInAllowed || isPending}
            onClick={() => onCheckIn(line)}
            aria-label={`Check in room ${state.roomNumber ?? line.lineId}`}
          >
            {isPending ? "Checking in…" : "Check in this room"}
          </Button>
          {!state.checkInAllowed ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground tracking-tight">
              {state.availability === 'ROOM_NOT_READY' ? (
                <Hourglass className="size-4" aria-hidden="true" />
              ) : (
                <CircleSlash className="size-4" aria-hidden="true" />
              )}
              {state.detail}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

interface LineCheckInPanelProps {
  lines: CheckInLine[];
  states: LineCheckInState[];
  pendingLineId?: string | null;
  rejections?: Record<string, string>;
  onCheckIn: (line: CheckInLine) => void;
}

export function LineCheckInPanel({
  lines,
  states,
  pendingLineId,
  rejections = {},
  onCheckIn,
}: LineCheckInPanelProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {lines.map((line) => {
        const state = states.find((candidate) => candidate.lineId === line.lineId);
        if (!state) return null;
        return (
          <LineCheckInCard
            key={line.lineId}
            line={line}
            state={state}
            isPending={pendingLineId === line.lineId}
            rejection={rejections[line.lineId]}
            onCheckIn={onCheckIn}
          />
        );
      })}
    </div>
  );
}