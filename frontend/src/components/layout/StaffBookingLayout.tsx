import { ReactNode } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { useFeatureSessions } from '@/components/auth/useFeatureSessions';
import { canViewStaffPage } from '@/lib/staffNavigation';

// Use the shared staff shell once per page. Member 1's session-aware shell can
// replace its implementation without introducing a second root sidebar.
export function StaffBookingLayout({ children }: { children: ReactNode }) {
  const { role } = useFeatureSessions();
  const links = [
    ['/rooms', 'Room availability'], ['/bookings/new', 'Create staff booking'],
    ['/bookings', 'Staff booking records'], ['/admin/rooms', 'Room administration'],
  ];
  return <AppShell><nav aria-label="Room and booking navigation" className="flex flex-wrap gap-2 px-4 pt-4 md:px-6">
    {links.filter(([path]) => canViewStaffPage(role, path)).map(([path, label]) => <Button key={path} variant="ghost" asChild><a href={path}>{label}</a></Button>)}
  </nav>{children}</AppShell>;
}
