# Component Rule

Always use shadcn components from `frontend/src/components/ui/`.
No handbuilt components. Always extend/reuse shadcn primitives.

# Project Context

SkyNest HRGSMS is an internal and direct hotel booking system — supports staff management (room allocation, employee bookings) and direct guest reservations (brand-controlled, not a third-party marketplace like Booking.com). Design and content must reflect this dual-purpose, professional, brand-controlled nature.

# Design System Reference

All design decisions (colors, typography, spacing, motion, geometry, imagery) are defined in `~/DESIGN.md`. Treat `~/DESIGN.md` as the single source of truth when implementing or modifying components. Never hard-code literal values that conflict with the design system (variable radius, soft diffused shadows, quick gentle motion, geometric sans typography, light luxury palette).

# Layout Architecture Reference

Layout architecture (shell, containers, grids, responsive behaviors, scroll mechanics) is defined in `~/LAYOUT.md`. Refer to `~/LAYOUT.md` when building or extending pages.

# Commit Rule

NEVER make a commit.
