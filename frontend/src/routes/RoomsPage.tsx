import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useFeatureSessions } from "@/components/auth/useFeatureSessions";
import { AppShell } from "@/components/layout/AppShell";
import { PageContainer } from "@/components/layout/PageContainer";
import { BoundedContainer } from "@/components/layout/BoundedContainer";
import { AvailabilitySearchScreen } from "@/components/rooms/AvailabilityPanel";
import { Button } from "@/components/ui/button";
import { canViewStaffPage } from "@/lib/staffNavigation";

export default function RoomsPage() {
  const { status, user } = useAuth();
  const { role } = useFeatureSessions();
  const isStaff = status === "authenticated" && user?.kind === "STAFF";
  const content = (
    <PageContainer>
      <BoundedContainer>
        {canViewStaffPage(role, "/dashboard") && (
          <nav aria-label="Room availability navigation" className="mb-4">
            <Button variant="outline" asChild>
              <Link to="/dashboard">
                <ArrowLeft aria-hidden="true" />
                Back to dashboard
              </Link>
            </Button>
          </nav>
        )}
        <AvailabilitySearchScreen />
      </BoundedContainer>
    </PageContainer>
  );
  // Availability search is public so guests and anonymous visitors can browse
  // inventory, but /rooms is also a staff dashboard tool, so signed-in staff
  // keep the AppShell sidebar instead of dropping into a bare, dead-end page.
  return isStaff ? <AppShell>{content}</AppShell> : content;
}
