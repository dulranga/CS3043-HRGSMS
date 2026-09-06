# SkyNest Design System — Mono (Locked)

## Meta
- **Project:** SkyNest HRGSMS (Travel / Hotel Booking)
- **Theme:** Mono (locked) — no toggle, no alternate palettes
- **Geometry:** Rounded & Organic, variable radius with inner-match rule
- **Motion:** Gentle fade/float (150ms, soft cubic-bezier `0.45,0.15,0.55,0.85`)
- **Layout:** Uniform grid, centered 1440px max-width, reduced airy spacing (4px base)
- **No gradients** — solid fills only; no gradient backgrounds, no gradient text, no gradient icons

## Design Language

### Color Palette — Mono (Locked)
Mapped to Tailwind v4 semantic variables in `frontend/src/index.css`.

| Token | Value | Role |
|---|---|---|
| `--color-background` | `#f5f5f0` | Warm off-white base |
| `--color-foreground` | `#111111` | Near-black text |
| `--color-card` | `#eae8e3` | Elevated surface |
| `--color-card-foreground` | `#111111` | Text on card |
| `--color-primary` | `#2a2a2a` | Dark gray primary |
| `--color-primary-foreground` | `#f5f5f0` | Light contrast on primary |
| `--color-secondary` | `#ddd9ce` | Subtle warm gray |
| `--color-secondary-foreground` | `#111111` | Text on secondary |
| `--color-muted` | `#ddd9ce` | Muted backgrounds |
| `--color-muted-foreground` | `#5c5750` | Subdued text |
| `--color-accent` | `#8a8480` | Neutral accent |
| `--color-accent-foreground` | `#111111` | Contrast on accent |
| `--color-border` | `#cfcbc2` | Soft warm borders |
| `--color-ring` | `#2a2a2a` | Focus ring |
| `--color-destructive` | `#d9774e` | Warning / destructive |
| `--color-destructive-foreground` | `#f5f5f0` | Contrast on destructive |

### Typography
- **Family:** DM Sans (geometric sans, loaded via Google Fonts)
- **Scale:** Reduced modular `clamp()` scale (tighter than original)
- **Sizes:**
  - `text-xs` → `clamp(0.65rem, ...)`
  - `text-base` → `clamp(0.85rem, ...)`
  - `text-xl` → `clamp(1.25rem, ...)`
  - `text-2xl` → `clamp(1.5rem, ...)`
  - `text-4xl` → `clamp(2.75rem, ...)`
- **Line-Heights:** `tight` (1.1), `normal` (1.35), `relaxed` (1.6), `loose` (1.85)
- **Tracking:** `tighter` (`-0.04em`) to `widest` (`0.12em`)

### Spacing System (Modular 4px Base)
- Base unit: `0.25rem` (4px)
- Scale: 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32 spacing units.
- Usage: Reduced padding (`p-4`, `gap-2`), tighter margins, compact layout rhythm.

### Component Geometry

#### Border Radius (Variable Scale)
| Token | Value | Usage |
|---|---|---|
| `radius-xs` | `0.375rem` | Small tags |
| `radius-sm` | `0.5rem` | Small buttons |
| `radius-md` | `0.75rem` | Inputs |
| `radius-lg` | `1rem` | Cards |
| `radius-xl` | `1.5rem` | Sections |
| `radius-2xl` | `2rem` | Cards / images |
| `radius-3xl` | `3rem` | Hero corners |
| `radius-full` | `9999px` | Pills |

**Rule:** Inner elements always match parent radius (e.g., `rounded-t-2xl` inside `rounded-2xl` parent).

#### Border Width
- Standard: `2px` (`border-2`) for all component borders.
- Focus ring: `2px` (`focus-visible:ring-2`).

#### Elevation / Shadows (Soft Diffused — Container Colors)
Using `oklch` derived from `--card` color.

| Token | Value |
|---|---|
| `shadow-sm` | `0 2px 8px 0 oklch(from var(--card) l c h / 0.08)` |
| `shadow-md` | `0 4px 20px 0 oklch(from var(--card) l c h / 0.12)` |
| `shadow-lg` | `0 8px 40px -4px oklch(from var(--card) l c h / 0.15)` |
| `shadow-xl` | `0 20px 60px -8px oklch(from var(--card) l c h / 0.2)` |

Components use `shadow-md` by default, `shadow-xl` on hover with gentle `-translate-y-0.5` lift.

### Motion Design Principles
- **Duration:** Quick = `150ms`
- **Easing:** `cubic-bezier(0.45, 0.15, 0.55, 0.85)` (soft custom)
- **Physics:** Gentle fade/float — no spring bounce
- **Transitions:** All interactive elements use `transition-all duration-150 ease-[...]`
- **Hover States:** Image scale (`scale-105`), card lift (`-translate-y-0.5`), shadow depth increase

### Iconography
- Style: **Duotone with accent color**
- Library: `lucide-react`
- Usage: Consistent `w-4 h-4` or `w-6 h-6` with uniform stroke width.

### Imagery
- Style: **Rounded-corner cards** — no gradient overlays
- Treatment: `rounded-t-2xl`, `object-cover`, hover zoom (`scale-105`, 500ms ease)
- Aspect: Consistent `h-60` for property cards

### Layout System
- **Container:** `max-w-7xl` (~1440px), centered `mx-auto`
- **Grid:** Uniform (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3`)
- **Responsive:** 3-col desktop → 2-col tablet → 1-col mobile
- **No dense packing** — compact but not cramped (`gap-4`, `p-4`)

## Component Modifications (shadcn/ui Extended)

- `frontend/src/components/ui/button.tsx` — Variable radius (`rounded-lg` / `rounded-xl` / `rounded-full`), shadow dynamics, hover lift, custom ease, solid fills only
- `frontend/src/components/ui/card.tsx` — `rounded-2xl`, `border-2`, `shadow-md`, `hover:shadow-xl`, inner-match rule
- `frontend/src/components/ui/input.tsx` — `rounded-xl`, `border-2`, `shadow-sm`, focus ring `ring-ring/50`
- `frontend/src/components/ui/label.tsx` — `tracking-tight`, medium weight, muted disabled state
- `frontend/src/index.css` — Mono theme locked, DM Sans font, reduced fluid typography, custom shadows, motion variables, no gradient definitions

## Showcase Route
- Path: `/ui`
- Page: `frontend/src/routes/UIRoutePage.tsx`
- Includes: Navigation, hero section (solid colors, no gradient), property card grid, design system feature cards, interactive booking form demo, footer
- Theme toggle removed — Mono is the single locked palette

## Project-Specific Components
- `PropertyCard` (`frontend/src/components/project/PropertyCard.tsx`): Luxury travel card (image `h-60`, reduced padding `p-4`, smaller typography, no gradients)
- `SearchWidget` (`frontend/src/components/project/SearchWidget.tsx`): Floating search bar with icon-prefixed inputs, compact layout

## Reference
Source of truth: `~/DESIGN.md` (this file). Referenced by `~/AGENTS.md`.
