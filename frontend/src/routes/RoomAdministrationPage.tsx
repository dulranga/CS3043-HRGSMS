import { useFeatureSessions } from '@/components/auth/useFeatureSessions';
import { useMemo } from 'react';
import { PageContainer } from '@/components/layout/PageContainer';
import { BoundedContainer } from '@/components/layout/BoundedContainer';
import { RoomAdministrationPanel } from '@/components/rooms/RoomAdministrationPanel';
import { RoomAdminApi } from '@/lib/roomAdministration';


export default function RoomAdministrationPage() {
  const session = useFeatureSessions().roomAdmin;
  const api = useMemo(() => new RoomAdminApi(session), [session]);
  return <PageContainer><BoundedContainer><RoomAdministrationPanel session={session} api={api} /></BoundedContainer></PageContainer>;
}
