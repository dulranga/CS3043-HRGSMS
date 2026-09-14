import * as React from "react";
import { cn } from "@/lib/utils";
import { PanelLeft } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

type SidebarState = "expanded" | "collapsed";

interface SidebarContextValue {
  state: SidebarState;
  open: boolean;
  setOpen: (v: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (v: boolean) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

export function SidebarProvider({
  children,
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  ...props
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}) {
  const [openState, setOpenState] = React.useState(defaultOpen);
  const open = openProp !== undefined ? openProp : openState;
  const setOpen = React.useCallback(
    (v: boolean) => {
      if (openProp === undefined) setOpenState(v);
      onOpenChange?.(v);
    },
    [openProp, onOpenChange]
  );

  const [openMobile, setOpenMobile] = React.useState(false);

  const isMobile = React.useSyncExternalStore(
    () => {
      const mql = window.matchMedia("(max-width: 768px)");
      return () => mql.matches;
    },
    () => typeof window !== "undefined" ? window.matchMedia("(max-width: 768px)").matches : false
  );

  const toggleSidebar = React.useCallback(() => {
    if (isMobile) {
      setOpenMobile((prev) => !prev);
    } else {
      setOpen(!open);
    }
  }, [isMobile, setOpen, open]);

  return (
    <SidebarContext.Provider
      value={{
        state: open ? "expanded" : "collapsed",
        open,
        setOpen,
        openMobile,
        setOpenMobile,
        isMobile,
        toggleSidebar,
      }}
    >
      <div {...props}>{children}</div>
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const ctx = React.useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within SidebarProvider");
  return ctx;
}

/* ------------------------------------------------------------------ */
/*  Components                                                         */
/* ------------------------------------------------------------------ */

export interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  side?: "left" | "right";
  variant?: "sidebar" | "floating" | "inset";
  collapsible?: "offcanvas" | "icon" | "none";
}

export function Sidebar({
  side = "left",
  variant = "sidebar",
  collapsible = "icon",
  className,
  children,
  ...props
}: SidebarProps) {
  const { open, openMobile, isMobile } = useSidebar();

  return (
    <>
      {/* Mobile overlay */}
      <div
        data-sidebar="sidebar-mobile"
        className={cn(
          "fixed inset-0 z-40 bg-foreground/10 backdrop-blur-sm transition-opacity duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)] md:hidden",
          openMobile ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={() => useSidebar().setOpenMobile(false)}
      />
      <aside
        data-slot="sidebar"
        data-side={side}
        data-variant={variant}
        data-collapsible={collapsible}
        className={cn(
          "fixed inset-y-0 z-50 hidden h-[100dvh] w-[var(--sidebar-width)] flex-col overflow-hidden border-r-2 border-border bg-[var(--sidebar-background)] shadow-md transition-all duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)] md:flex",
          collapsible === "icon" && !open ? "w-16" : "",
          collapsible === "offcanvas" && !open ? "-translate-x-full md:-translate-x-full" : "",
          variant === "floating" && "m-2 rounded-2xl shadow-xl",
          variant === "inset" && "m-0 rounded-none border-0 shadow-none",
          side === "right" && "right-0 border-r-0 border-l-2",
          side === "left" && "left-0",
          isMobile && "fixed",
          className
        )}
        {...props}
      >
        {children}
      </aside>
      {/* Mobile sheet */}
      <div
        data-sidebar="sidebar-mobile"
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-[var(--sidebar-width-mobile)] flex-col overflow-hidden border-r-2 border-border bg-[var(--sidebar-background)] shadow-xl transition-transform duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)] md:hidden",
          openMobile ? "translate-x-0" : "-translate-x-full",
          className
        )}
      >
        {children}
      </div>
    </>
  );
}

export function SidebarHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="sidebar-header"
      className={cn("sticky top-0 z-10 flex h-16 shrink-0 items-center gap-3 px-4 border-b-2 border-border bg-[var(--sidebar-background)]/80 backdrop-blur-sm", className)}
      {...props}
    />
  );
}

export function SidebarContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="sidebar-content"
      className={cn("flex-1 overflow-y-auto overflow-x-hidden py-3", className)}
      {...props}
    />
  );
}

export function SidebarFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="sidebar-footer"
      className={cn("sticky bottom-0 z-10 flex shrink-0 items-center gap-3 border-t-2 border-border px-4 py-4 bg-[var(--sidebar-background)]", className)}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Group / Menu                                                       */
/* ------------------------------------------------------------------ */

export function SidebarGroup({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="sidebar-group"
      className={cn("relative flex w-full min-w-0 flex-col gap-1 px-3", className)}
      {...props}
    />
  );
}

export function SidebarGroupLabel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="sidebar-group-label"
      className={cn("text-xs font-semibold tracking-tight text-muted-foreground uppercase mb-1 px-2", className)}
      {...props}
    />
  );
}

export function SidebarMenu({ className, ...props }: React.HTMLAttributes<HTMLUListElement>) {
  return (
    <ul
      data-slot="sidebar-menu"
      className={cn("flex w-full min-w-0 flex-col gap-0.5", className)}
      {...props}
    />
  );
}

export function SidebarMenuItem({ className, ...props }: React.HTMLAttributes<HTMLLIElement>) {
  return <li data-slot="sidebar-menu-item" className={cn("group/menu-item", className)} {...props} />;
}

export interface SidebarMenuButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  isActive?: boolean;
}

export function SidebarMenuButton({ className, isActive, ...props }: SidebarMenuButtonProps) {
  return (
    <button
      data-slot="sidebar-menu-button"
      data-active={isActive}
      className={cn(
        "flex h-9 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium transition-all duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)] hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-accent-foreground)] hover:shadow-sm active:scale-[0.98]",
        isActive && "bg-[var(--sidebar-primary)] text-[var(--sidebar-primary-foreground)] shadow-md",
        className
      )}
      {...props}
    />
  );
}

export function SidebarTrigger({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { toggleSidebar } = useSidebar();
  return (
    <button
      data-slot="sidebar-trigger"
      onClick={toggleSidebar}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-xl border-2 border-border bg-card text-foreground shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)]",
        className
      )}
      {...props}
    >
      <PanelLeft className="w-4 h-4" />
      <span className="sr-only">Toggle Sidebar</span>
    </button>
  );
}
