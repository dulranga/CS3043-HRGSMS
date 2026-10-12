import { useNavigate, useRouterState, useSearch } from "@tanstack/react-router";
import { PageContainer } from "@/components/layout/PageContainer";
import { BoundedContainer } from "@/components/layout/BoundedContainer";
import { GuestBookingLayout } from "@/components/layout/GuestBookingLayout";
import { AvailabilitySearchScreen } from "@/components/rooms/AvailabilityPanel";
import { parseRoomsSearchParams, savePendingSelection } from "@/lib/availability";

// Room availability search, rendered by two routes: the public `/rooms` page
// (for anonymous visitors and guests, with the guest reservation navigation)
// and the staff `/dashboard/rooms` page (inside the shared DashboardLayout
// shell). URL criteria (from the home page search) prefill the form and run
// the first search. On the public page a selection can be carried into the
// guest booking flow.
export default function RoomsPage() {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const isStaffShell = pathname.startsWith("/dashboard");

  const screen = (
    <PageContainer>
      <BoundedContainer>
        <AvailabilitySearchScreen
          initialSearch={parseRoomsSearchParams(search)}
          onContinue={
            isStaffShell
              ? undefined
              : (selected) => {
                  savePendingSelection(selected);
                  void navigate({ to: "/guest/bookings/new" });
                }
          }
        />
      </BoundedContainer>
    </PageContainer>
  );

  return isStaffShell ? screen : <GuestBookingLayout activePath="/rooms">{screen}</GuestBookingLayout>;
}
