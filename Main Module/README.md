# AB Capital Workspace

Internal workspace for AB Capital Services FZC — built with React, Supabase, and Vite. Temporarily hosted on GitHub Pages; Vercel remains configured for the custom domain.

🔗 **GitHub Pages app:** https://abhijithabcapitals.github.io/ABCRM/

---

## What this is

A custom-built internal tool replacing ClickUp and Notion for the AB Capital team. It includes:

- **Task tracker** — create and manage tasks across spaces, folders, and subfolders with list and board views
- **Wiki** — internal knowledge base for document checklists, process guides, and SOPs
- **Team login** — each team member has their own account and sees only their assigned tasks
- **Custom fields** — each space can have its own fields (e.g. TRN, Passport No., Trade License)
- **Custom statuses** — each space can have its own workflow statuses (e.g. Client Discontinued)
- **My Tasks** — personal view showing all tasks assigned to the logged-in user
- **Dashboard** — overview of all tasks, spaces, and completion metrics
- **Business Development** — lead capture, a deal pipeline, discussion history, follow-ups, service budgets, and won-lead handovers

---

## Tech stack

| Layer           | Technology               |
| --------------- | ------------------------ |
| Frontend        | React 18 + Vite          |
| Database        | Supabase (PostgreSQL)    |
| Auth            | Supabase Auth            |
| Hosting         | Vercel                   |
| Styling         | Plain CSS (no framework) |
| Version control | GitHub                   |

---

## Project structure

abcapital-workspace/
├── public/
├── src/
│ ├── components/
│ │ ├── Dashboard.jsx # Metrics, kanban overview, spaces summary
│ │ ├── Login.jsx # Email + password login page
│ │ ├── MyTasks.jsx # Personal task view for each team member
│ │ ├── Settings.jsx # Team member management (admin only)
│ │ ├── Sidebar.jsx # Navigation, spaces tree, user profile
│ │ ├── Tasks.jsx # Task list/board, custom fields, statuses
│ │ └── Wiki.jsx # Knowledge base articles
│ ├── App.jsx # Root component, routing, auth state
│ ├── App.css # Global styles
│ ├── supabase.js # Supabase client initialisation
│ └── main.jsx # React entry point
├── .env # Local env variables (never committed)
├── vercel.json # Vercel SPA routing config
├── index.html # App entry HTML
└── package.json

---

## Database schema

| Table               | Purpose                                                  |
| ------------------- | -------------------------------------------------------- |
| `spaces`            | Top-level workspaces (e.g. VAT & Corporate Tax)          |
| `folders`           | Folders inside spaces, supports subfolders via parent_id |
| `tasks`             | All tasks with status, priority, assignee, due date      |
| `task_field_values` | Custom field values per task                             |
| `space_fields`      | Custom field definitions per space                       |
| `space_statuses`    | Custom status definitions per space                      |
| `wiki_articles`     | Wiki articles linked to spaces                           |
| `profiles`          | Team member profiles linked to Supabase auth             |

---

## Business Development module

The **Business Development** sidebar page is a Supabase-backed lead workspace. It
includes a dashboard, stage pipeline, lead lists, quick capture, service-level
budgets, discussion timelines, follow-up queue, source reporting, and won/lost
workflows.

Its database lives in the Database Module. To enable it, run
`../Database Module/migrations/bd/001_bd_schema.sql`, `002_bd_seed.sql` and
`003_bd_ui_api.sql`, in that order, in the Supabase SQL Editor
(`db/business_development.sql` is retired). Existing CRM admins are assigned the `super_admin` BD role and other
profiles default to `sales_executive`; a CRM admin can change module roles in
`bd_user_roles`. Lead rows are restricted by BD role and ownership in row-level
security. Do not assign broader roles without approval.

Won leads create a pending onboarding handover. This integration does not create
or update a Client Master record; complete duplicate checks and client creation
through the approved Client Module workflow. The module displays a setup message
until its database migration has been applied.

## Accounting client directory

The accounting database lives in the separate `acct` schema of the existing
CRM Supabase project. The CRM directory is visible only to signed-in CRM
admins. Database access is read-only from the browser; Supabase row-level
security also blocks anonymous users and CRM members.

To install the accounting database, run the source files from
`D:\Abhijith Projects\DataBase\Accounting\database` in the Supabase SQL Editor
in the order documented in that folder's README. Then run
[`db/accounting_clients_security.sql`](./db/accounting_clients_security.sql)
in the same SQL Editor. Do not expose the `acct` schema until that security
script has completed successfully. In Supabase API settings, add `acct` to
the exposed schemas; the migration grants schema access only to authenticated
users and row access only to CRM admins. Re-run the security script after any
later schema changes that add accounting tables or views.

After enabling the schema, sign in as a CRM admin and open **Accounting** in
the sidebar. The browser reads only the client directory fields needed for
that list. Do not put a Supabase service-role key or database password in
`.env`, frontend code, or chat. The file registry scan is not part of this
setup: it would upload file names and paths, so review and authorize that
separately before running it against Supabase.

---

## Roles

| Role     | Access                                             |
| -------- | -------------------------------------------------- |
| `admin`  | Full access — all spaces, all tasks, settings page |
| `member` | Sees only tasks assigned to them via My Tasks view |

---

## Local development

**Prerequisites:** Node.js 18+, npm, Git

**Step 1 — Clone the repo:**

```bash
git clone https://github.com/rahulbajaj460/ABCapitalCRMDashboard.git
cd abcapital-workspace
```

**Step 2 — Install dependencies:**

```bash
npm install
```

**Step 3 — Create `.env` file in project root:**
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key

**Step 4 — Run locally:**

```bash
npm run dev
```

Open `http://localhost:5173`

---

## Deployment

### GitHub Pages (temporary)

The `Deploy to GitHub Pages` workflow publishes the Vite app whenever changes
are pushed to `main`. In GitHub, add these repository Actions secrets under
**Settings → Secrets and variables → Actions**:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (the public anon/publishable key, never a service-role key)

The workflow builds the app at `/ABCRM/` and deploys the `dist` directory. Set
the Supabase Auth **Site URL** to `https://abhijithabcapitals.github.io/ABCRM/`
and add that URL to **Redirect URLs**. The workflow enables GitHub Pages using
the Actions deployment source. The first deployment is available at the URL
above once the Actions run succeeds. When moving to the custom domain, update
the Supabase Site URL and redirect list as described below.

GitHub Pages serves a public website. The CRM still requires login, and
Supabase Row Level Security must remain enabled and correctly configured.

### Vercel (custom domain)

The project is also configured for Vercel. Every push to `main` can auto-deploy there.

**Manual deploy:**

```bash
git add .
git commit -m "your message"
git push
```

Vercel picks it up automatically within 60 seconds.

**Environment variables required in Vercel dashboard:**
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY

### Connect the CRM domain

The CRM frontend is a static Vite app and can be served by Vercel; Supabase
continues to provide the database, authentication, and file storage.

1. In Vercel, open this project’s **Settings → Domains** and add
   `crm.abcapital.ae`.
2. At the DNS provider for `abcapital.ae`, add or update only the `crm`
   record using the exact record type and target Vercel shows for this project.
   Do not change the domain’s MX records or other email-related DNS records.
3. In Supabase **Authentication → URL Configuration**, set the Site URL to
   `https://crm.abcapital.ae` and ensure it is included in the allowed redirect
   URLs.
4. Redeploy the `send-automation-emails` Supabase Edge Function so its email
   links use the custom domain.
5. Wait for Vercel to confirm the domain is configured and test sign-in,
   navigation, and file access on the custom domain.
6. Only after the custom domain works, remove the old CRM site files from
   Hostinger. Keep any unrelated website, email, and DNS configuration there.

---

## Adding a new team member

1. Go to **Supabase → Authentication → Users → Add user**
2. Enter their email and a temporary password, tick **Auto Confirm User**
3. Run in Supabase SQL Editor:

```sql
update profiles
set full_name = 'Their Name', role = 'member'
where email = 'their@email.com';
```

4. Share login credentials with them on WhatsApp
5. They log in at https://abhijithabcapitals.github.io/ABCRM/

---

## Adding a new space

1. Log in as admin
2. Click **+ Add space** in the sidebar
3. Enter space name and pick a colour
4. Click **+ Status** to add workflow statuses for that space
5. Click **+ Custom field** to add fields specific to that space
6. Click **+ Add folder** to create folders inside the space

---

## Security & Access Control

Row Level Security (RLS) is enabled on all Supabase tables.

| Table         | Members can                      | Admins can                     |
| ------------- | -------------------------------- | ------------------------------ |
| Tasks         | Read only their assigned tasks   | Read, create, edit, delete all |
| Wiki          | Read all articles                | Read, create, edit, delete all |
| Spaces        | Read all spaces                  | Create, edit, delete           |
| Profiles      | Read all (for assignee dropdown) | Read all, change roles         |
| Custom fields | Read only                        | Full control                   |
| Field values  | Read own task values only        | Full control                   |

> All sessions are authenticated via Supabase Auth. Unauthenticated users cannot access any data.

---

## Built by

AB Capital Services FZC  
www.abcapital.ae
