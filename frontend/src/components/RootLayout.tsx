import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';

export default function RootLayout() {
  const guestPath = useRouterState({ select: state => state.location.pathname });
  const directBooking = guestPath === '/guest/bookings/new' || guestPath === '/guest/my-bookings' || guestPath.startsWith('/guest/my-bookings/');
  if (directBooking) return <div className="flex min-h-screen flex-col">
    <header className="space-y-3 border-b border-border bg-card p-4 md:px-6"><h2 className="text-lg font-semibold tracking-tight">SkyNest</h2>
      <GuestReservationNavigation activePath={guestPath} />
    </header>
    <main className="min-w-0 flex-1"><Outlet /></main>
  </div>;
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="w-full shrink-0 border-b md:w-64 md:border-b-0 md:border-r border-border p-4 space-y-4 bg-card">
        <h2 className="font-semibold text-lg tracking-tight">Hotel System</h2>
        <nav className="flex flex-col gap-1 text-sm">
          <Link
            to="/"
            activeProps={{ className: 'font-semibold bg-accent text-accent-foreground' }}
            className="px-3 py-2 rounded-md hover:bg-muted transition-colors"
          >
            Home
          </Link>
          <Link
            to="/rooms"
            activeProps={{ className: 'font-semibold bg-accent text-accent-foreground' }}
            className="px-3 py-2 rounded-md hover:bg-muted transition-colors"
          >
            Rooms
          </Link>
          <Link
            to="/check-in"
            activeProps={{ className: 'font-semibold bg-accent text-accent-foreground' }}
            className="px-3 py-2 rounded-md hover:bg-muted transition-colors"
          >
            Guest Check-In
          </Link>

          <Button variant="ghost" className="justify-start" asChild>
            <Link to="/bookings/new">Create staff booking</Link>
          </Button>

          <Button variant="ghost" className="justify-start" asChild>
            <Link to="/bookings">Staff booking records</Link>
          </Button>
          <Button variant="ghost" className="justify-start" asChild>
            <Link to="/guest/bookings/new">Book directly with SkyNest</Link>
          </Button>

          <Link
            to="/stays"
            activeProps={{ className: 'font-semibold bg-accent text-accent-foreground' }}
            className="px-3 py-2 rounded-md hover:bg-muted transition-colors"
          >
            Active Stays
          </Link>

          <Link
            to="/dashboard"
            activeProps={{ className: 'font-semibold bg-accent text-accent-foreground' }}
            className="px-3 py-2 rounded-md hover:bg-muted transition-colors"
          >
            Dashboard
          </Link>

          <div className="pt-4 pb-1 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Management
          </div>

          <Link
            to="/service-usage"
            activeProps={{ className: 'font-semibold bg-accent text-accent-foreground' }}
            className="px-3 py-2 rounded-md hover:bg-muted transition-colors"
          >
            Service Usage
          </Link>

          <Link
            to="/admin/services"
            activeProps={{ className: 'font-semibold bg-accent text-accent-foreground' }}
            className="px-3 py-2 rounded-md hover:bg-muted transition-colors"
          >
            Service Catalogue
          </Link>

          <Button variant="ghost" className="justify-start" asChild>
            <Link to="/admin/rooms">Room administration</Link>
          </Button>

          <Link
            to="/admin/reports"
            activeProps={{ className: 'font-semibold bg-accent text-accent-foreground' }}
            className="px-3 py-2 rounded-md hover:bg-muted transition-colors"
          >
            Reports & CSV
          </Link>
          <Link
            to="/admin/operations"
            activeProps={{ className: 'font-semibold bg-accent text-accent-foreground' }}
            className="px-3 py-2 rounded-md hover:bg-muted transition-colors"
          >
            Branches & Users
          </Link>
          <Link
            to="/admin/config"
            activeProps={{ className: 'font-semibold bg-accent text-accent-foreground' }}
            className="px-3 py-2 rounded-md hover:bg-muted transition-colors"
          >
            System Config
          </Link>
          <Link
            to="/admin/audit"
            activeProps={{ className: 'font-semibold bg-accent text-accent-foreground' }}
            className="px-3 py-2 rounded-md hover:bg-muted transition-colors"
          >
            Audit Log
          </Link>
        </nav>
      </aside>

      <main className="min-w-0 flex-1 p-4 md:p-6 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

// Route-specific guest navigation has no staff operation links. Global verified
// role navigation remains Member 1's session integration contract.
export function GuestReservationNavigation({ activePath = '/guest/bookings/new' }: { activePath?: string }) {
  return <nav className="flex flex-wrap gap-2" aria-label="Direct reservation navigation">
    <Button variant="ghost" asChild><a href="/">SkyNest home</a></Button>
    <Button variant="ghost" asChild><a href="/rooms">Browse rooms</a></Button>
    <Button variant={activePath === '/guest/bookings/new' ? 'secondary' : 'ghost'} asChild><a href="/guest/bookings/new" aria-current={activePath === '/guest/bookings/new' ? 'page' : undefined}>Book directly</a></Button>
    <Button variant={activePath.startsWith('/guest/my-bookings') ? 'secondary' : 'ghost'} asChild><a href="/guest/my-bookings" aria-current={activePath.startsWith('/guest/my-bookings') ? 'page' : undefined}>My Bookings</a></Button>
  </nav>;
}
