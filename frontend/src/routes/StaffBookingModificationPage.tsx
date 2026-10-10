import { useFeatureSessions } from '@/components/auth/useFeatureSessions';
import { useNavigate, useParams } from '@tanstack/react-router';
import { PageContainer } from '@/components/layout/PageContainer';
import { BoundedContainer } from '@/components/layout/BoundedContainer';
import { StaffBookingModificationScreen } from '@/components/bookings/StaffBookingModificationPanel';

export default function StaffBookingModificationPage() {
  const session = useFeatureSessions().staff, { bookingId = '' } = useParams({ strict: false }), navigate = useNavigate();
  return <PageContainer><BoundedContainer><StaffBookingModificationScreen session={session} bookingId={bookingId}
    onBack={() => { void navigate({ to: '/dashboard/bookings/$bookingId', params: { bookingId } }); }}
    onCancellation={() => { void navigate({ to: '/dashboard/cancellation' }); }} />
  </BoundedContainer></PageContainer>;
}
