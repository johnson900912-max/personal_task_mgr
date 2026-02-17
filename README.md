# Mission Control

Local-first dashboard for project execution, task tracking, and attached project/task content.

## Stack
- Next.js 14 + React + TypeScript
- Persistent local SQLite store at `data/mission-control.db`

## Run locally
1. Install dependencies:
   npm install
2. Start dev server:
   npm run dev
3. Open:
   http://localhost:3000

## Implemented
- Dark-only dashboard + planner UI
- Dashboard-first Kanban board with drag/drop lane ordering
- Mandatory task ownership:
  - Every task belongs to a project
  - Unassigned tasks auto-map to system `Inbox` project
- Unified content feed on projects and tasks:
  - Text entries
  - URL entries
  - Image entries (local upload + metadata)
- Planner upgrades:
  - Workload cards (`overdue`, `due today`, `scheduled 7d`, `recurring`)
  - Recurrence controls (`none`, `daily`, `weekly`)
  - Quick “View Feed” links for tasks
- Import center with dedupe actions:
  - `create` / `update` / `skip`
  - Apple Notes imports now become content feed entries

## Data model highlights
- `projects` (top-level containers)
- `tasks` (must reference a project)
- `content_entries` (parent_type `project|task`, entry_type `text|url|image`)
- `content_assets` (local file metadata for images)
- legacy `notes` endpoints are deprecated (`410`)

## Content + upload APIs
- `GET /api/content?parentType=project|task&parentId=...`
- `POST /api/content`
- `PATCH /api/content/:id`
- `DELETE /api/content/:id`
- `POST /api/content/upload` (image upload, max 10MB)
- `GET /api/content/assets/:id` (serve image data)

## Core APIs
- `GET /api/dashboard/summary`
- `GET/POST /api/projects`
- `PATCH/DELETE /api/projects/:id`
- `GET/POST /api/tasks`
- `PATCH/DELETE /api/tasks/:id`
- `POST /api/tasks/reorder`
- `POST /api/imports/preview`
- `POST /api/imports/commit`

## Notes
- Node's built-in SQLite API is currently marked experimental; runtime may show `ExperimentalWarning`.
