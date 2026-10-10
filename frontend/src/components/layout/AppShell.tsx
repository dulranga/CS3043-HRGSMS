import { ReactNode, useEffect } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { BedDouble, Building2, CalendarCheck, CalendarX, ClipboardList, ConciergeBell, Contact, CreditCard, DoorClosed, DoorOpen, FileBarChart, Landmark, LayoutDashboard, Receipt, Settings, Utensils, Users, XCircle, type LucideIcon } from "lucide-react";
import { SessionPanel } from "@/components/auth/SessionPanel";
import { useAuth } from "@/components/auth/AuthProvider";
import { homePathFor } from "@/lib/auth";
import { useFeatureSessions } from "@/components/auth/useFeatureSessions";
import { canViewStaffPage } from "@/lib/staffNavigation";
import { SidebarProvider } from "@/components/ui/sidebar";
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@/components/ui/sidebar";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  { label: "Overview", items: [{ to: "/dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  {
    label: "Front Desk",
    items: [
      { to: "/rooms", label: "Rooms", icon: BedDouble },
      { to: "/bookings", label: "Reservations", icon: ClipboardList },
      { to: "/bookings/new", label: "New Reservation", icon: CalendarCheck },
      { to: "/check-in", label: "Guest Check-In", icon: CalendarCheck },
      { to: "/stays", label: "Active Stays", icon: DoorOpen },
    ],
  },
  {
    label: "Billing",
    items: [
      { to: "/checkout", label: "Checkout", icon: DoorClosed },
      { to: "/cancellation", label: "Cancellation", icon: XCircle },
      { to: "/no-show", label: "No-Show", icon: CalendarX },
      { to: "/billing/invoice", label: "Invoice Detail", icon: Receipt },
      { to: "/billing/payments", label: "Payments", icon: CreditCard },
    ],
  },
  {
    label: "Services",
    items: [
      { to: "/service-usage", label: "Service Usage", icon: ConciergeBell },
      { to: "/admin/services", label: "Service Catalogue", icon: Utensils },
      { to: "/admin/rooms", label: "Room Administration", icon: Building2 },
    ],
  },
  {
    label: "Management",
    items: [
      { to: "/guests", label: "Guests", icon: Contact },
      { to: "/admin/reports", label: "Reports & CSV", icon: FileBarChart },
      { to: "/admin/branches", label: "Branches", icon: Landmark },
      { to: "/admin/users", label: "User Accounts", icon: Users },
      { to: "/admin/config", label: "System Config", icon: Settings },
      { to: "/admin/audit", label: "Audit Log", icon: ClipboardList },
    ],
  },
];

function StaffNavigation() {
  const { role } = useFeatureSessions();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const groups = NAV_GROUPS.map(group => ({ ...group, items: group.items.filter(item => canViewStaffPage(role, item.to)) })).filter(group => group.items.length > 0);
  return (
    <nav aria-label="Staff navigation" className="space-y-4">
      {groups.map((group) => (
        <SidebarGroup key={group.label}>
          <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
          <SidebarMenu>
            {group.items.map((item) => {
              const active = pathname === item.to;
              return (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton asChild isActive={active}>
                    <Link to={item.to} aria-current={active ? "page" : undefined}>
                      <item.icon className="size-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </nav>
  );
}

interface AppShellProps {
  sidebar?: ReactNode;
  children: ReactNode;
}

export function AppShell({ sidebar, children }: AppShellProps) {
  const { status, user } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: state => state.location.pathname });
  const isSignedInStaff = status === 'authenticated' && user?.kind === 'STAFF';

  // Staff pages are members-only. Instead of rendering an inline "sign-in
  // required" notice, send unauthenticated visitors straight to sign-in and
  // signed-in guests back to their own home page.
  useEffect(() => {
    if (status === 'loading') return;
    if (!user) {
      void navigate({ to: '/login', search: { redirect: pathname }, replace: true });
    } else if (user.kind !== 'STAFF') {
      void navigate({ to: homePathFor(user), replace: true });
    }
  }, [status, user, pathname, navigate]);

  return (
    <SidebarProvider>
      <div className="min-h-[100dvh] flex bg-background text-foreground font-sans antialiased">
        {/* Sidebar — shadcn sidebar primitive */}
        {sidebar || (
          <Sidebar collapsible="icon" variant="sidebar" className="border-r-2 border-border shadow-md bg-card">
            <SidebarHeader className="h-14 px-3 flex items-center gap-2">
              <Link to="/" className="font-bold text-sm tracking-tight">SkyNest</Link>
            </SidebarHeader>
            <SidebarContent className="py-3">
              <StaffNavigation />
            </SidebarContent>
            <SidebarFooter className="px-3 py-3">
              <SessionPanel />
            </SidebarFooter>
          </Sidebar>
        )}

        {/* Main content area */}
        <main className="flex-1 md:ml-[var(--sidebar-width)] transition-all duration-150 ease-soft min-h-[100dvh]">
          {/* Sticky header within scroll pane */}
          <header className="sticky top-0 z-40 flex h-14 items-center gap-3 px-4 md:px-6 border-b-2 border-border bg-background/80 backdrop-blur-sm shadow-sm">
            <SidebarTrigger className="md:hidden" />
            <div className="text-xs text-muted-foreground">Dashboard / Overview</div>
          </header>
          <div className="overflow-y-auto h-[calc(100dvh-3.5rem)]">
            {isSignedInStaff ? children : <p role="status" className="p-6 text-muted-foreground">Checking your session…</p>}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
