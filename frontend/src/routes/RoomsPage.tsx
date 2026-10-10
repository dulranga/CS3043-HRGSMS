import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useFeatureSessions } from '@/components/auth/useFeatureSessions';
import { PageContainer } from '@/components/layout/PageContainer';
import { BoundedContainer } from '@/components/layout/BoundedContainer';
import { AvailabilitySearchScreen } from '@/components/rooms/AvailabilityPanel';
import { Button } from '@/components/ui/button';
import { canViewStaffPage } from '@/lib/staffNavigation';

export default function RoomsPage() {
  const { role } = useFeatureSessions();
  return <PageContainer><BoundedContainer>
    {canViewStaffPage(role, '/dashboard') && <nav aria-label="Room availability navigation" className="mb-4">
      <Button variant="outline" asChild><Link to="/dashboard"><ArrowLeft aria-hidden="true" />Back to dashboard</Link></Button>
    </nav>}
    <AvailabilitySearchScreen />
  </BoundedContainer></PageContainer>;
}
