import { useFeatureSessions } from '@/components/auth/useFeatureSessions';
import { PageContainer } from '@/components/layout/PageContainer';
import { GuestBookingLayout } from '@/components/layout/GuestBookingLayout';
import { BoundedContainer } from '@/components/layout/BoundedContainer';
import { GuestBookingScreen } from '@/components/bookings/GuestBookingPanel';

export default function GuestBookingCreatePage() {
  const session = useFeatureSessions().guest;
  return <GuestBookingLayout activePath="/guest/bookings/new"><PageContainer><BoundedContainer><GuestBookingScreen session={session} /></BoundedContainer></PageContainer></GuestBookingLayout>;
}
