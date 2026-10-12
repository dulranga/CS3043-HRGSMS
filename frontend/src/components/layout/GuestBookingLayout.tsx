import { ReactNode } from 'react';
import { PublicHeader } from './PublicHeader';

export { GuestReservationNavigation } from './PublicHeader';

// Guest booking pages own their layout; RootLayout remains a bare outlet so
// public and Member 1 account pages do not inherit a staff sidebar.
export function GuestBookingLayout({ activePath, children }: { activePath: string; children: ReactNode }) {
  return <div className="flex min-h-screen flex-col bg-background text-foreground antialiased">
    <PublicHeader activePath={activePath} />
    <main className="min-w-0 flex-1">{children}</main>
  </div>;
}
