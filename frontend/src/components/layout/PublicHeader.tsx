import { Link, useNavigate } from '@tanstack/react-router';
import { Hotel, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth/AuthProvider';

// Guest-facing destinations only; staff operations live behind /dashboard.
export function GuestReservationNavigation({ activePath = '/guest/bookings/new', showAccountLinks = true }: { activePath?: string; showAccountLinks?: boolean }) {
  const item = (href: string, label: string, active: boolean) => (
    <Button key={href} variant={active ? 'secondary' : 'ghost'} size="sm" asChild>
      <a href={href} aria-current={active ? 'page' : undefined}>{label}</a>
    </Button>
  );
  return <nav className="flex flex-wrap items-center gap-1" aria-label="Direct reservation navigation">
    {item('/', 'Home', activePath === '/')}
    {item('/rooms', 'Browse rooms', activePath === '/rooms')}
    {item('/guest/bookings/new', 'Book directly', activePath === '/guest/bookings/new')}
    {showAccountLinks && item('/guest/my-bookings', 'My Bookings', activePath.startsWith('/guest/my-bookings'))}
    {showAccountLinks && item('/account', 'My account', activePath === '/account')}
  </nav>;
}

const MOTION = 'transition-all duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)]';

// One sticky top bar for every public and guest page (home, rooms, booking,
// My Bookings, account) so branding, navigation and sign-in state match.
export function PublicHeader({ activePath }: { activePath: string }) {
  const { status, user, signOut } = useAuth();
  const navigate = useNavigate();
  const isGuest = user?.kind === 'GUEST';
  const isStaff = user?.kind === 'STAFF';
  const handleSignOut = async () => {
    await signOut();
    await navigate({ to: '/' });
  };

  return <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
    <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 md:px-6">
      <Link to="/" className="group flex shrink-0 items-center gap-2.5">
        <span className={`flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md group-hover:shadow-lg ${MOTION}`}>
          <Hotel className="size-5" aria-hidden="true" />
        </span>
        <span className="font-display text-xl font-semibold tracking-tight">SkyNest</span>
      </Link>

      <div className="hidden min-w-0 lg:block">
        <GuestReservationNavigation activePath={activePath} showAccountLinks={isGuest} />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {status === 'loading' ? null : user ? (
          <>
            {isStaff && <Button asChild size="sm" className={`rounded-full shadow-md hover:shadow-lg ${MOTION}`}><Link to="/dashboard">Staff dashboard</Link></Button>}
            <Button variant="outline" size="sm" className={`rounded-full ${MOTION}`} onClick={() => void handleSignOut()}>
              <LogOut aria-hidden="true" />
              Sign out
            </Button>
          </>
        ) : (
          <>
            <Button asChild variant="outline" size="sm" className={`rounded-full border-2 shadow-sm hover:shadow-md ${MOTION}`}>
              <Link to="/login" search={['/', '/login', '/register'].includes(activePath) ? {} : { redirect: activePath }}>Log in</Link>
            </Button>
            <Button asChild size="sm" className={`rounded-full shadow-md hover:shadow-lg ${MOTION}`}>
              <Link to="/register">Sign up</Link>
            </Button>
          </>
        )}
      </div>
    </div>
    <div className="mx-auto max-w-7xl overflow-x-auto px-4 pb-3 md:px-6 lg:hidden">
      <GuestReservationNavigation activePath={activePath} showAccountLinks={isGuest} />
    </div>
  </header>;
}
