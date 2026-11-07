# Improvements Module

The **Improvement** tab in the CRM sidebar. Every signed-in member can share ideas, problems and feature requests with the admin, with screenshots attached. No tab grant is needed.

- **Members** write an improvement (type, title, details, up to 10 screenshots or PDFs, 10 MB each). They can click, drag files in, or paste screenshots with Ctrl+V. A member sees only their own improvements and the admin's replies, and can withdraw one while it is still *New*.
- **Admins** see everyone's improvements, filter them by status (*New, Seen, Planned, Done, Declined*, or *Open*), set a status, write a reply, or delete one.

| Path | Purpose |
|---|---|
| `components/Improvements.jsx` | The page |
| `services/improvementsApi.js` | The only file that talks to Supabase |
| `logic/improvements.js` | File checks, storage paths, filters (no database) |
| `tests/logic.test.mjs` | `node --test "Impovements Module/tests"` |
| `../Database Module/Improvements Base/migrations/001_improvements.sql` | Table `improvement_requests`, row-level security and the private `improvements` bucket. Applied to Supabase on 2026-11-07 |
| `../Database Module/Improvements Base/rollback/001_rollback.sql` | Undo |

Screenshots are stored at `<user id>/<improvement id>/<uuid>-<file name>` and open only through signed links that last one hour. The app imports this folder as `@improvements` (see `Main Module/vite.config.js`). The folder name keeps its original spelling.
