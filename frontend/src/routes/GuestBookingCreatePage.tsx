import { useAuth } from '@/components/auth/AuthProvider';
import { useFeatureSessions } from '@/components/auth/useFeatureSessions';
import { PageContainer } from '@/components/layout/PageContainer';
import { GuestBookingLayout } from '@/components/layout/GuestBookingLayout';
import { BoundedContainer } from '@/components/layout/BoundedContainer';
import { GuestBookingScreen } from '@/components/bookings/GuestBookingPanel';

export default function GuestBookingCreatePage() {
  const { status } = useAuth();
  const session = useFeatureSessions().guest;
  return <GuestBookingLayout activePath="/guest/bookings/new"><PageContainer><BoundedContainer>
    {status === 'loading'
      ? <p role="status" className="text-sm text-muted-foreground">Checking your sign-in…</p>
      : <GuestBookingScreen session={session} signedIn={status === 'authenticated'} />}
  </BoundedContainer></PageContainer></GuestBookingLayout>;
}
