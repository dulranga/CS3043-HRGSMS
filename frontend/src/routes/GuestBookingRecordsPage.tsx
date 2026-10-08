import { useFeatureSessions } from '@/components/auth/useFeatureSessions';
import { useNavigate, useParams } from '@tanstack/react-router';
import { PageContainer } from '@/components/layout/PageContainer';
import { GuestBookingLayout } from '@/components/layout/GuestBookingLayout';
import { BoundedContainer } from '@/components/layout/BoundedContainer';
import { GuestBookingReadScreen } from '@/components/bookings/GuestBookingReadPanel';

export default function GuestBookingRecordsPage() {
  const session = useFeatureSessions().guest, params = useParams({ strict: false }) as { bookingId?: string }, navigate = useNavigate();
  return <GuestBookingLayout activePath="/guest/my-bookings"><PageContainer><BoundedContainer><GuestBookingReadScreen session={session} bookingId={params.bookingId}
    onOpen={bookingId => void navigate({ to: '/guest/my-bookings/$bookingId', params: { bookingId } })}
    onBack={() => void navigate({ to: '/guest/my-bookings' })} />
  </BoundedContainer></PageContainer></GuestBookingLayout>;
}
