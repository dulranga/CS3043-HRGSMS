# SkyNest Layout Architecture

## Macro Shell
- `AppShell` — persistent sidebar (`SidebarProvider` + shadcn `Sidebar`), sticky header, fluid content pane
- Mobile: hidden drawer (`-translate-x-full` to `translate-x-0`) with backdrop blur overlay
- Desktop: collapsible sidebar (`expanded` → `icon` rail), sticky footer pinned to sidebar bottom

## Responsive Strategy
- Container-first: component-level `@container` preferred; viewport media (`md:`) only for sidebar state and grid breakpoints
- Sidebar width: `var(--sidebar-width)` (18rem) expanded / `w-16` collapsed
- Mobile drawer width: `var(--sidebar-width-mobile)` (20rem)

## Containers
- `PageContainer`: fluid full-width (`px-4 md:px-6`, `py-6 md:py-8`)
- `BoundedContainer`: centered `max-w-7xl` for dense pages

## Grid & Sectioning
- `BentoGrid`: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`, `gap-4`, compact rhythm
- `SectionWrapper`: `py-8 md:py-12` vertical rhythm, dynamic section spacing
- Tables (dominant): tanstack tables + shadcn primitives, sticky header only (`sticky top-0`), full-width fluid

## Interactive Spatial Behaviors
- Collapsible sidebar (`collapsible="icon"`) via `SidebarProvider` context
- Drawer slide: 150ms `ease-[cubic-bezier(0.45,0.15,0.55,0.85)]`
- Sticky content header (`sticky top-0`) within independent scroll pane (`overflow-y-auto`)
- Dynamic viewport height: `min-h-[100dvh]`, scroll area `h-[calc(100dvh-3.5rem)]`

## Component References
- Source: `~/DESIGN.md` (Mono palette, compact spacing, rounded-2xl geometry, 150ms motion)
- Components: `frontend/src/components/layout/AppShell.tsx`, `PageContainer.tsx`, `BoundedContainer.tsx`, `BentoGrid.tsx`, `SectionWrapper.tsx`
- Sidebar base: shadcn `Sidebar` (`frontend/src/components/ui/sidebar.tsx`)
