# SkyNest HRGSMS - Project Context

## Stack

- Backend: (not covered here)
- Frontend: Vite + React 18 + TypeScript
- Styling: Tailwind CSS v4 (`@tailwindcss/vite`)
- Components: shadcn/ui (pre-built from `src/components/ui/`)
- Routing: `@tanstack/react-router`

## Key Files

- `frontend/src/index.css` — Tailwind v4 theme (dark tokens, radius, fonts)
- `frontend/src/lib/utils.ts` — `cn()` (clsx + tailwind-merge)
- `frontend/src/components/ui/` — shadcn components (button, card, input, label, form, form-field context)
- `frontend/vite.config.ts` — tailwind plugin + `@/` alias
- `frontend/tsconfig.json` — `baseUrl`, `paths` for `@/*`

## Component Policy

- Use shadcn components from `src/components/ui/`
- No handbuilt components. Always extend/reuse shadcn primitives.
