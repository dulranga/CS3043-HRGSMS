import { PageContainer } from '@/components/layout/PageContainer';
import { BoundedContainer } from '@/components/layout/BoundedContainer';
import { GuestBookingScreen } from '@/components/bookings/GuestBookingPanel';
import { GuestBookingSession } from '@/lib/guestBooking';

// Member 1 supplies verified online-guest identity and the session/CSRF adapter.
function useVerifiedGuestBookingSession(): GuestBookingSession | null { return null; }
export default function GuestBookingCreatePage() {
  const session = useVerifiedGuestBookingSession();
  return <PageContainer><BoundedContainer><GuestBookingScreen session={session} /></BoundedContainer></PageContainer>;
}
