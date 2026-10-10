import { useFeatureSessions } from "@/components/auth/useFeatureSessions";
import { PageContainer } from "@/components/layout/PageContainer";
import { BoundedContainer } from "@/components/layout/BoundedContainer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { canViewStaffPage } from "@/lib/staffNavigation";

const TOOLS = [
  { path: "/dashboard/rooms", label: "Rooms" },
  { path: "/dashboard/bookings", label: "Reservations" },
  { path: "/dashboard/bookings/new", label: "New reservation" },
  { path: "/dashboard/check-in", label: "Guest check-in" },
  { path: "/dashboard/stays", label: "Active stays" },
  { path: "/dashboard/checkout", label: "Checkout" },
  { path: "/dashboard/cancellation", label: "Cancellation" },
  { path: "/dashboard/no-show", label: "No-show" },
  { path: "/dashboard/billing/invoice", label: "Invoice detail" },
  { path: "/dashboard/billing/payments", label: "Payments" },
  { path: "/dashboard/service-usage", label: "Service usage" },
  { path: "/dashboard/admin/rooms", label: "Room administration" },
  { path: "/dashboard/admin/services", label: "Service catalogue" },
  { path: "/dashboard/admin/reports", label: "Reports and CSV" },
  { path: "/dashboard/admin/branches", label: "Branches" },
  { path: "/dashboard/admin/users", label: "User accounts" },
  { path: "/dashboard/admin/config", label: "System configuration" },
  { path: "/dashboard/admin/audit", label: "Audit log" },
];

export default function DashboardPage() {
  const { role } = useFeatureSessions();
  return (
      <PageContainer>
        <BoundedContainer>
          <div className="space-y-6">
            <header>
              <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
              <p className="text-sm text-muted-foreground mt-1">Manage SkyNest reservations and hotel operations with your staff tools.</p>
            </header>
            <Card>
              <CardHeader><CardTitle>Available tools</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                {TOOLS.filter(tool => canViewStaffPage(role, tool.path)).map(tool => (
                  <Button key={tool.path} variant="outline" asChild><a href={tool.path}>{tool.label}</a></Button>
                ))}
              </CardContent>
            </Card>
          </div>
        </BoundedContainer>
      </PageContainer>
  );
}
