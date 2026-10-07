import { PageContainer } from '@/components/layout/PageContainer';
import { BoundedContainer } from '@/components/layout/BoundedContainer';
import { StaffBookingScreen } from '@/components/bookings/StaffBookingPanel';
import { StaffBookingSession } from '@/lib/staffBooking';

// M1-S08/S09 must supply verified role/branch and its mutation/CSRF adapter.
// Browser-selected identities and request actor headers are not authorization.
function useVerifiedStaffBookingSession(): StaffBookingSession | null { return null; }
export default function StaffBookingCreatePage() {
  const session = useVerifiedStaffBookingSession();
  return <PageContainer><BoundedContainer><StaffBookingScreen session={session} /></BoundedContainer></PageContainer>;
}
