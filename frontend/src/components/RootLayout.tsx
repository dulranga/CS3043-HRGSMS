import { Link, Outlet } from '@tanstack/react-router';

export default function RootLayout() {
  return (
    <div className="flex min-h-screen">
      <aside className="w-64 border-r border-border p-4 space-y-4 bg-card">
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
            to="/admin/services"
            activeProps={{ className: 'font-semibold bg-accent text-accent-foreground' }}
            className="px-3 py-2 rounded-md hover:bg-muted transition-colors"
          >
            Service Catalogue
          </Link>

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

      <main className="flex-1 p-6 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}