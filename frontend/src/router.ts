import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import RootLayout from './components/RootLayout';
import IndexPage from './routes/IndexPage';
import RoomsPage from './routes/RoomsPage';
import UIRoutePage from './routes/UIRoutePage';

const rootRoute = createRootRoute({
  component: RootLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: IndexPage,
});

const roomsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/rooms',
  component: RoomsPage,
});

const uiRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ui',
  component: UIRoutePage,
});

const routeTree = rootRoute.addChildren([indexRoute, roomsRoute, uiRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
