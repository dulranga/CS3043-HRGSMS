import { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useFeatureSessions } from '@/components/auth/useFeatureSessions';
import { canViewStaffPage } from '@/lib/staffNavigation';

// Room/booking quick links rendered inside the shared `/dashboard` shell. The
// shell itself comes from `DashboardLayout`, so this only adds the sub-nav and
// must never wrap its own AppShell (that would nest two sidebars).
export function StaffBookingLayout({ children }: { children: ReactNode }) {
  const { role } = useFeatureSessions();
  const links = [
    ['/dashboard/rooms', 'Room availability'], ['/dashboard/bookings/new', 'Create staff booking'],
    ['/dashboard/bookings', 'Staff booking records'], ['/dashboard/admin/rooms', 'Room administration'],
  ];
  return <><nav aria-label="Room and booking navigation" className="flex flex-wrap gap-2 px-4 pt-4 md:px-6">
    {links.filter(([path]) => canViewStaffPage(role, path)).map(([path, label]) => <Button key={path} variant="ghost" asChild><a href={path}>{label}</a></Button>)}
  </nav>{children}</>;
}
