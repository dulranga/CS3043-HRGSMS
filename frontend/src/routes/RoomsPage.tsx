import { PageContainer } from "@/components/layout/PageContainer";
import { BoundedContainer } from "@/components/layout/BoundedContainer";
import { AvailabilitySearchScreen } from "@/components/rooms/AvailabilityPanel";

// Room availability search, rendered by two routes: the public `/rooms` page
// (bare, for anonymous visitors and guests) and the staff `/dashboard/rooms`
// page (inside the shared DashboardLayout shell). Keeping it shell-free lets
// the same screen sit correctly in both places.
export default function RoomsPage() {
  return (
    <PageContainer>
      <BoundedContainer>
        <AvailabilitySearchScreen />
      </BoundedContainer>
    </PageContainer>
  );
}
