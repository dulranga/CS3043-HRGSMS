import { ReactNode } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';

// Use the shared staff shell once per page. Member 1's session-aware shell can
// replace its implementation without introducing a second root sidebar.
export function StaffBookingLayout({ children }: { children: ReactNode }) {
  return <AppShell><nav aria-label="Room and booking navigation" className="flex flex-wrap gap-2 px-4 pt-4 md:px-6">
    <Button variant="ghost" asChild><a href="/rooms">Room availability</a></Button>
    <Button variant="ghost" asChild><a href="/bookings/new">Create staff booking</a></Button>
    <Button variant="ghost" asChild><a href="/bookings">Staff booking records</a></Button>
    <Button variant="ghost" asChild><a href="/admin/rooms">Room administration</a></Button>
  </nav>{children}</AppShell>;
}
