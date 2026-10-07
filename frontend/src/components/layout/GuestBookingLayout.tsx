import { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

// Guest booking pages own their layout; RootLayout remains a bare outlet so
// public and Member 1 account pages do not inherit a staff sidebar.
export function GuestBookingLayout({ activePath, children }: { activePath: string; children: ReactNode }) {
  return <div className="flex min-h-screen flex-col">
    <header className="space-y-3 border-b border-border bg-card p-4 md:px-6"><h2 className="text-lg font-semibold tracking-tight">SkyNest</h2>
      <GuestReservationNavigation activePath={activePath} />
    </header>
    <main className="min-w-0 flex-1">{children}</main>
  </div>;
}
export function GuestReservationNavigation({ activePath = '/guest/bookings/new' }: { activePath?: string }) {
  return <nav className="flex flex-wrap gap-2" aria-label="Direct reservation navigation">
    <Button variant="ghost" asChild><a href="/">SkyNest home</a></Button>
    <Button variant="ghost" asChild><a href="/rooms">Browse rooms</a></Button>
    <Button variant={activePath === '/guest/bookings/new' ? 'secondary' : 'ghost'} asChild><a href="/guest/bookings/new" aria-current={activePath === '/guest/bookings/new' ? 'page' : undefined}>Book directly</a></Button>
    <Button variant={activePath.startsWith('/guest/my-bookings') ? 'secondary' : 'ghost'} asChild><a href="/guest/my-bookings" aria-current={activePath.startsWith('/guest/my-bookings') ? 'page' : undefined}>My Bookings</a></Button>
  </nav>;
}
