import { Outlet } from '@tanstack/react-router';
import { AppShell } from '@/components/layout/AppShell';

// Single staff shell for every internal page. The `/dashboard` parent route
// renders this once, so children stay shell-free and cannot drift out of sync
// (the previous per-page AppShell wrappers let pages like `/rooms` drop it).
export default function DashboardLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
