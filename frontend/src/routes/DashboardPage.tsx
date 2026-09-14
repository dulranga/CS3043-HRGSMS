import { AppShell } from "@/components/layout/AppShell";
import { PageContainer } from "@/components/layout/PageContainer";
import { BoundedContainer } from "@/components/layout/BoundedContainer";

export default function DashboardPage() {
  return (
    <AppShell>
      <PageContainer>
        <BoundedContainer>
          <div className="space-y-6">
            <header>
              <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
              <p className="text-sm text-muted-foreground mt-1">Overview of room allocations and bookings.</p>
            </header>
            <section className="rounded-2xl border-2 border-border bg-card shadow-md p-4 md:p-6 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-border">
                    <th className="text-left py-2 px-3 font-semibold tracking-tight">Room</th>
                    <th className="text-left py-2 px-3 font-semibold tracking-tight">Status</th>
                    <th className="text-left py-2 px-3 font-semibold tracking-tight">Guest</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border hover:bg-accent/40 transition-colors">
                    <td className="py-2 px-3">101</td>
                    <td className="py-2 px-3"><span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" /> Occupied</td>
                    <td className="py-2 px-3">A. Patel</td>
                  </tr>
                  <tr className="border-b border-border hover:bg-accent/40 transition-colors">
                    <td className="py-2 px-3">102</td>
                    <td className="py-2 px-3"><span className="inline-flex h-2 w-2 rounded-full bg-amber-400" /> Reserved</td>
                    <td className="py-2 px-3">J. Doe</td>
                  </tr>
                  <tr className="hover:bg-accent/40 transition-colors">
                    <td className="py-2 px-3">103</td>
                    <td className="py-2 px-3"><span className="inline-flex h-2 w-2 rounded-full bg-muted-foreground" /> Vacant</td>
                    <td className="py-2 px-3">—</td>
                  </tr>
                </tbody>
              </table>
            </section>
          </div>
        </BoundedContainer>
      </PageContainer>
    </AppShell>
  );
}
