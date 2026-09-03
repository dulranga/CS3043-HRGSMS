import { Outlet } from '@tanstack/react-router';

export default function RootLayout() {
  return (
    <div>
      <header>Hotel Management System</header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
