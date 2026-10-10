import { useFeatureSessions } from "@/components/auth/useFeatureSessions";
import { AppShell } from "@/components/layout/AppShell";
import { PageContainer } from "@/components/layout/PageContainer";
import { BoundedContainer } from "@/components/layout/BoundedContainer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { canViewStaffPage } from "@/lib/staffNavigation";

const TOOLS = [
  { path: "/bookings", label: "Reservations" },
  { path: "/bookings/new", label: "New reservation" },
  { path: "/check-in", label: "Guest check-in" },
  { path: "/stays", label: "Active stays" },
  { path: "/service-usage", label: "Service usage" },
  { path: "/admin/rooms", label: "Room administration" },
  { path: "/admin/services", label: "Service catalogue" },
  { path: "/billing/invoice", label: "Invoice Detail" },
  { path: "/admin/reports", label: "Reports and CSV" },
  { path: "/admin/operations", label: "Branches and staff accounts" },
  { path: "/admin/config", label: "System configuration" },
  { path: "/admin/audit", label: "Audit log" },
];

export default function DashboardPage() {
  const { role } = useFeatureSessions();
  return (
    <AppShell>
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
    </AppShell>
  );
}
