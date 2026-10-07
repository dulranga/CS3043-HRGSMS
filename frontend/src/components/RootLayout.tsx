import { Outlet } from "@tanstack/react-router";

// Public pages render bare; staff pages wrap themselves in AppShell (sidebar).
export default function RootLayout() {
  return <Outlet />;
}
