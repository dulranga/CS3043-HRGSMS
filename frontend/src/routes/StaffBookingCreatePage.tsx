import { useFeatureSessions } from '@/components/auth/useFeatureSessions';
import { PageContainer } from '@/components/layout/PageContainer';
import { StaffBookingLayout } from '@/components/layout/StaffBookingLayout';
import { BoundedContainer } from '@/components/layout/BoundedContainer';
import { StaffBookingScreen } from '@/components/bookings/StaffBookingPanel';

export default function StaffBookingCreatePage() {
  const session = useFeatureSessions().staff;
  return <StaffBookingLayout><PageContainer><BoundedContainer><StaffBookingScreen session={session} /></BoundedContainer></PageContainer></StaffBookingLayout>;
}
