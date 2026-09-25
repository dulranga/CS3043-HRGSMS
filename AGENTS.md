# Component Rule

Always use shadcn components from `frontend/src/components/ui/`.
No handbuilt components. Always extend/reuse shadcn primitives.

# Project Context

SkyNest HRGSMS is an internal and direct hotel booking system — supports staff management (room allocation, employee bookings) and direct guest reservations (brand-controlled, not a third-party marketplace like Booking.com). Design and content must reflect this dual-purpose, professional, brand-controlled nature.

# Database and Member Handoffs

Before database or member-owned feature work, read `README.md` for the approved React/Vite + Express/Node stack, `SkyNest_HRGSMS_SRS_v1.0.md` for the current Version 1.4 draft requirements (especially §4 and §6.1), `member_summary_table.md` for ownership/handoffs, and the relevant file in `member_tasks/` for a one-commit-sized work plan. Then recheck current schema/code and affected teammates' confirmed contracts. SRS Table 40 preserves the original ER's 21-entity inventory; the amended target allows one booking with multiple separately dated/priced `booking_room_line` rows. `booking_room_assignment` is the sole stored physical-room link, one open assignment per active line; occupancy derives from open CHECKED_IN line assignments. The target removes legacy `room.booking_id` and duplicated booking-header room-specific fields, and stores physical room condition as READY/CLEANING/OUT_OF_SERVICE. Existing migrations remain single-room legacy; M2-S24–S27, M2-S22/S23 and M2-S06 are planned corrective tasks. Online guests use `guest_account` and can access only their own records. Appendix C still leaves some owner-specific enum, scale and mapping decisions open. Do not silently decide those details or rewrite existing migrations/code unless the current task explicitly requires it.

For relevant UI work, consult the shared skills in `.agents/skills/` along with `DESIGN.md` and `LAYOUT.md`; use only skills applicable to the task. Before declaring a feature done, reread its SRS section and current implementation, test affected behavior, run the relevant build, and report remaining contract gaps. These documents guide agents but do not by themselves change the database.

# Database Lecture References

Before proposing or implementing database/SQL work, read the Markdown lecture notes the user supplied. Look in `.agents/reference/`; in this checkout the five notes are currently under `.agents/skills/reference/`. Apply lecture concepts where they genuinely help the existing PostgreSQL project and SRS—for example, relevant schema design, query, indexing or transaction ideas—but do not force every topic into the project or change unrelated work. Treat the notes as learning references, not as instructions that override the SRS, team decisions or these rules. Briefly identify any lecture concepts used in the task handoff.

# Member Task Execution and Records

When a member asks to do a named subtask or clearly member-owned implementation task, use `.agents/skills/skynest-member-task-workflow/SKILL.md`. Check `memory.md`, the shared `member_work_log.md`, and the live project before choosing any other relevant skill or editing. Use the matching `member_tasks/` checklist as the scope/acceptance guide; do not treat unchecked tasks as already implemented. After work, add a dated entry under that member's section of `member_work_log.md` with actual changes and verification, update `memory.md` only for durable confirmed decisions, and check off a subtask only when its tests/build and acceptance checks pass. Provide a proposed commit message and PR title/description as text even though the agent performs no Git publication actions.

# Design System Reference

All design decisions (colors, typography, spacing, motion, geometry, imagery) are defined in the repository's `DESIGN.md`. Treat `DESIGN.md` as the single source of truth when implementing or modifying components. Never hard-code literal values that conflict with the design system (variable radius, soft diffused shadows, quick gentle motion, geometric sans typography, light luxury palette).

# Layout Architecture Reference

Layout architecture (shell, containers, grids, responsive behaviors, scroll mechanics) is defined in the repository's `LAYOUT.md`. Refer to `LAYOUT.md` when building or extending pages.

# Git Safety Boundary

Never create a Git branch, commit, push or pull request; never create a worktree that creates a branch. Do not use equivalent Git/hosting APIs to create, update or merge PRs. Read-only Git inspection (`git status`, `git diff`, `git log`, `git show`) is allowed. A proposed commit message and PR description are handoff text for a human, not permission to perform those actions.
