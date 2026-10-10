import { useFeatureSessions } from '@/components/auth/useFeatureSessions';
import { useNavigate, useParams } from '@tanstack/react-router';
import { PageContainer } from '@/components/layout/PageContainer';
import { StaffBookingLayout } from '@/components/layout/StaffBookingLayout';
import { BoundedContainer } from '@/components/layout/BoundedContainer';
import { StaffBookingReadScreen } from '@/components/bookings/StaffBookingReadPanel';

export default function StaffBookingRecordsPage() {
  const session = useFeatureSessions().staff;
  const params = useParams({ strict: false });
  const navigate = useNavigate();
  return <StaffBookingLayout><PageContainer><BoundedContainer><StaffBookingReadScreen session={session} bookingId={params.bookingId}
    onOpen={bookingId => { void navigate({ to: '/dashboard/bookings/$bookingId', params: { bookingId } }); }}
    onModify={bookingId => { void navigate({ to: '/dashboard/bookings/$bookingId/edit', params: { bookingId } }); }}
    onBack={() => { void navigate({ to: '/dashboard/bookings' }); }} />
  </BoundedContainer></PageContainer></StaffBookingLayout>;
}
