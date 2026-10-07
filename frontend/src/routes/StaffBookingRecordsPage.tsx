import { useNavigate, useParams } from '@tanstack/react-router';
import { PageContainer } from '@/components/layout/PageContainer';
import { BoundedContainer } from '@/components/layout/BoundedContainer';
import { StaffBookingReadScreen } from '@/components/bookings/StaffBookingReadPanel';
import { StaffBookingReadSession } from '@/lib/staffBookingRead';

// Member 1 supplies real session role/branch context after M1-S08/S09.
function useVerifiedStaffBookingReadSession(): StaffBookingReadSession | null { return null; }
export default function StaffBookingRecordsPage() {
  const session = useVerifiedStaffBookingReadSession();
  const params = useParams({ strict: false });
  const navigate = useNavigate();
  return <PageContainer><BoundedContainer><StaffBookingReadScreen session={session} bookingId={params.bookingId}
    onOpen={bookingId => { void navigate({ to: '/bookings/$bookingId', params: { bookingId } }); }}
    onModify={bookingId => { void navigate({ to: '/bookings/$bookingId/edit', params: { bookingId } }); }}
    onBack={() => { void navigate({ to: '/bookings' }); }} />
  </BoundedContainer></PageContainer>;
}
