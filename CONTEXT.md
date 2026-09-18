# SkyNest HRGSMS - Project Context

SkyNest is an internal and direct hotel booking system — supports staff management (room allocation, employee bookings) and direct guest reservations (brand-controlled, professional, not a third-party marketplace like Booking.com).

## Stack

- Backend: Express.js + TypeScript on Node.js, with PostgreSQL accessed through raw parameterized SQL (see `README.md` and the SRS for requirements)
- Frontend: Vite + React 18 + TypeScript
- Styling: Tailwind CSS v4 (`@tailwindcss/vite`)
- Components: shadcn/ui (pre-built from `src/components/ui/`)
- Routing: `@tanstack/react-router`

The final-ER SRS includes online guest accounts and direct reservations alongside staff workflows. Its separate `booking_room_assignment` extension preserves booking/room history; `room.booking_id` is only a nullable current checked-in stay pointer. Consult the SRS and `member_summary_table.md` before database or member-owned feature work.

## Key Files

- `frontend/src/index.css` — Tailwind v4 theme (dark tokens, radius, fonts)
- `frontend/src/lib/utils.ts` — `cn()` (clsx + tailwind-merge)
- `frontend/src/components/ui/` — shadcn components (button, card, input, label, form, form-field context)
- `frontend/vite.config.ts` — tailwind plugin + `@/` alias
- `frontend/tsconfig.json` — `baseUrl`, `paths` for `@/*`

## Component Policy

- Use shadcn components from `src/components/ui/`
- No handbuilt components. Always extend/reuse shadcn primitives.
