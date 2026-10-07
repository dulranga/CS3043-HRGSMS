import { useNavigate, useParams } from '@tanstack/react-router';
import { PageContainer } from '@/components/layout/PageContainer';
import { StaffBookingLayout } from '@/components/layout/StaffBookingLayout';
import { BoundedContainer } from '@/components/layout/BoundedContainer';
import { StaffBookingModificationScreen } from '@/components/bookings/StaffBookingModificationPanel';
import { StaffBookingSession } from '@/lib/staffBooking';

// Member 1 supplies the verified Front Desk session and CSRF adapter.
function useVerifiedModificationSession(): StaffBookingSession | null { return null; }
export default function StaffBookingModificationPage() {
  const session = useVerifiedModificationSession(), { bookingId = '' } = useParams({ strict: false }), navigate = useNavigate();
  return <StaffBookingLayout><PageContainer><BoundedContainer><StaffBookingModificationScreen session={session} bookingId={bookingId}
    onBack={() => { void navigate({ to: '/bookings/$bookingId', params: { bookingId } }); }}
    onCancellation={() => { void navigate({ to: '/cancellation' }); }} />
  </BoundedContainer></PageContainer></StaffBookingLayout>;
}
