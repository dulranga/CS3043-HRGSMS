import { useMemo } from 'react';
import { PageContainer } from '@/components/layout/PageContainer';
import { BoundedContainer } from '@/components/layout/BoundedContainer';
import { RoomAdministrationPanel } from '@/components/rooms/RoomAdministrationPanel';
import { RoomAdminApi, RoomAdminSession } from '@/lib/roomAdministration';

// Integration seam for M1-S08/S09: replace this with verified session context.
// A user-selected role or branch cannot authorize this screen or its requests.
function useVerifiedRoomAdminSession(): RoomAdminSession | null { return null; }

export default function RoomAdministrationPage() {
  const session = useVerifiedRoomAdminSession();
  const api = useMemo(() => new RoomAdminApi(session), [session]);
  return <PageContainer><BoundedContainer><RoomAdministrationPanel session={session} api={api} /></BoundedContainer></PageContainer>;
}
