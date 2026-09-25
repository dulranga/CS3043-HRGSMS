# SkyNest HRGSMS

A professional hotel management and booking system supporting both staff management (room allocation, employee bookings) and direct guest reservations. Built with a modern full-stack architecture.

## 🏗️ Project Structure

```
CS3043-HRGSMS/
├── frontend/           # React + Vite frontend application
├── backend/            # Express.js backend API
├── package.json        # Root workspace configuration
├── DESIGN.md           # Design system reference
├── LAYOUT.md           # Layout architecture reference
├── CONTEXT.md          # Project context and stack overview
├── SkyNest_HRGSMS_SRS_v1.0.md  # Version 1.4 draft SRS (legacy filename)
├── member_summary_table.md    # Draft member ownership and handoffs
├── member_tasks/             # One-commit-sized plans and workflow for each member
├── memory.md                 # Verified cross-task project decisions
└── member_work_log.md         # Shared actual-work log, organized by member
```

## 🛠️ Tech Stack

**Frontend:**
- React 18 with TypeScript
- Vite (fast build tool & dev server)
- Tailwind CSS v4
- shadcn/ui components
- TanStack React Router for routing

**Backend:**
- Express.js with TypeScript
- CORS enabled for cross-origin requests
- Node.js runtime

**Database:**
- PostgreSQL 18 with native UUIDv7 generation (`uuidv7()`)
- Parameterized raw SQL; Member 2's rate fields use exact LKR `numeric(12,2)`

The SRS uses this stack, not Next.js. It covers staff-assisted and direct online guest bookings through linked `guest_account` records. Its amended target permits multiple separately dated/priced room lines under one booking, with room-assignment history; existing migrations still implement the earlier single-room model. Documentation changes alone do not apply migrations.

## 📋 Prerequisites

Before you begin, ensure you have installed:
- **Node.js** (v18 or higher) — [Download](https://nodejs.org/)
- **npm** (comes with Node.js)
- **PostgreSQL 18** for database migrations and integration tests
- A code editor (VS Code recommended)

Verify installation:
```bash
node --version
npm --version
```

## 🚀 Quick Start

### 1. Install Dependencies

Install all dependencies for both frontend and backend from the root directory:

```bash
npm install
```

This uses npm workspaces to install dependencies in both `frontend/` and `backend/` directories.

### 2. Start Development Servers

Run both frontend and backend in parallel:

**Terminal 1 - Backend:**
```bash
npm run dev:backend
```
Backend will start on `http://localhost:4000`

**Terminal 2 - Frontend:**
```bash
npm run dev:frontend
```
Frontend will start on `http://localhost:5173` (Vite default)

Both should be running to ensure full functionality.

## 📝 Available Commands

### Root Level Commands

```bash
# Install dependencies
npm install

# Run both servers in separate terminals
npm run dev:backend     # Start Express backend (port 4000)
npm run dev:frontend    # Start Vite frontend (port 5173)

# Build for production
npm run build:backend   # Compile backend TypeScript
npm run build:frontend  # Build frontend for production
```

### Frontend Commands

```bash
cd frontend

npm run dev      # Start Vite dev server
npm run build    # Build for production (TS check + Vite bundle)
npm run preview  # Preview production build
```

### Backend Commands

```bash
cd backend

npm run dev      # Start with tsx watch (auto-reload on file changes)
npm run build    # Compile TypeScript to dist/
npm run start    # Run compiled JavaScript (use after build)
```

For the Member 2 room catalogue migration, run `npm run test:m2-catalogue --workspace backend` from the repository root with `backend/.env` configured. The test applies `backend/migrations/m2_001_room_catalogue.sql` inside an isolated PostgreSQL schema and rolls it back. The shared ordered migration runner is tracked under M1-S02; this test does not install catalogue tables into the application schema.

For the Member 2 legacy booking schema, run `npm run test:m2-booking --workspace backend`. The test creates minimal `guest` and `user_account` prerequisite tables, applies `backend/migrations/m2_002_booking.sql` in an isolated transaction, verifies the old booking/history contract, and rolls everything back. The real migration depends on Member 1's parent tables; application booking writes remain gated by the new room-line, assignment and overlap/lifecycle work, not this legacy test alone.

For the Member 2 legacy room inventory schema, run `npm run test:m2-rooms --workspace backend`. The test applies the first three Member 2 migrations with minimal rolled-back Member 1 parent fixtures, then verifies the existing five room states, branch-scoped room numbers, nullable pointer, foreign keys and dated room blocks. The Version 1.4 SRS target requires M2-S22/S23 corrective migrations and updated tests before this schema is accepted.

For the Member 2 legacy booking-room assignment history, run `npm run test:m2-assignments --workspace backend`. It applies M2-S02 through M2-S05 with minimal Member 1 parent fixtures and verifies the old one-open-assignment-per-booking rule. The new SRS target requires M2-S24–S27 to backfill room lines and replace that rule with one open assignment per active line, plus M2-S22/S23 room corrections and M2-S06 overlap/lifecycle guards. This existing test is not evidence that multi-room booking works.

## 🔌 API Endpoints

The backend runs on `http://localhost:4000` and exposes:

- `GET /` — Home endpoint
- `GET /rooms` — Get all rooms
- Additional endpoints as per SRS requirements

## 📖 Design & Layout References

- **DESIGN.md** — Complete design system (colors, typography, spacing, shadows, motion)
- **LAYOUT.md** — Layout architecture and responsive design guidelines
- **CONTEXT.md** — Project context and technology stack details
- **SkyNest_HRGSMS_SRS_v1.0.md** — ER-aligned SRS draft; unresolved design decisions are in Appendix C
- **member_summary_table.md** — Proposed member tasks, table ownership and cross-team handoffs
- **member_tasks/** — Five member-specific subtask checklists and completion workflows
- **memory.md** — Durable verified project decisions; recheck against current files before use
- **member_work_log.md** — Shared record of what each member's completed or partial tasks changed and verified

Always refer to these documents when making design or layout decisions.

## 🎨 Component Library

All UI components use shadcn/ui primitives located in `frontend/src/components/ui/`. Always extend existing shadcn components rather than building custom ones.

Key utilities:
- `cn()` helper in `frontend/src/lib/utils.ts` — Combines clsx + tailwind-merge for className management

## 🔧 Development Tips

### Frontend
- Hot Module Replacement (HMR) is enabled — changes reflect instantly
- TypeScript strict mode is enabled
- Path alias `@/` maps to `frontend/src/`

### Backend
- Uses `tsx watch` for automatic restart on file changes
- Environment variables can be set in a `.env` file (default PORT=4000)
- CORS is enabled for frontend requests

### TypeScript
Both frontend and backend use TypeScript. Run type checking:

```bash
# Frontend
cd frontend && npx tsc --noEmit

# Backend
cd backend && npx tsc --noEmit
```

## 📦 Building for Production

### Frontend
```bash
npm run build:frontend
```
Creates optimized static files in `frontend/dist/`

### Backend
```bash
npm run build:backend
```
Compiles TypeScript to JavaScript in `backend/dist/`

Then run with:
```bash
cd backend && npm start
```

## 🤝 Project Guidelines

- **Component Rule:** Use only shadcn components from `frontend/src/components/ui/`
- **Design System:** All visual decisions must align with `DESIGN.md`
- **Layout Architecture:** Reference `LAYOUT.md` for page structure and responsiveness
- **Git:** Never commit directly (use PR workflow as defined in project guidelines)

## 📞 Need Help?

Refer to the project documentation:
- **Architecture Questions** → Check `LAYOUT.md` and `CONTEXT.md`
- **Design Questions** → Check `DESIGN.md`
- **Requirements & Specifications** → Check `SkyNest_HRGSMS_SRS_v1.0.md`
- **Agent Guidelines** → Check `AGENTS.md`

## 📄 License

This is a university project (CS3043 - Hotel Room Group Staff Management System).
