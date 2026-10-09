import { PageContainer } from '@/components/layout/PageContainer';
import { BoundedContainer } from '@/components/layout/BoundedContainer';
import { AvailabilitySearchScreen } from '@/components/rooms/AvailabilityPanel';

export default function RoomsPage() {
  return <PageContainer><BoundedContainer><AvailabilitySearchScreen /></BoundedContainer></PageContainer>;
}
