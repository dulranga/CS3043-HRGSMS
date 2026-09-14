import { ReactNode } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { Sidebar, SidebarHeader, SidebarContent, SidebarFooter, SidebarTrigger } from "@/components/ui/sidebar";

interface AppShellProps {
  sidebar?: ReactNode;
  children: ReactNode;
}

export function AppShell({ sidebar, children }: AppShellProps) {
  return (
    <SidebarProvider>
      <div className="min-h-[100dvh] flex bg-background text-foreground font-sans antialiased">
        {/* Sidebar — shadcn sidebar primitive */}
        {sidebar || (
          <Sidebar collapsible="icon" variant="sidebar" className="border-r-2 border-border shadow-md bg-card">
            <SidebarHeader className="h-14 px-3 flex items-center gap-2">
              <span className="font-bold text-sm tracking-tight">SkyNest</span>
            </SidebarHeader>
            <SidebarContent className="py-2">
              <div className="text-xs text-muted-foreground px-3 mb-1">Dashboard</div>
            </SidebarContent>
            <SidebarFooter className="h-14 px-3 flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">SN</div>
              <span className="text-xs font-medium">Staff</span>
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
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
