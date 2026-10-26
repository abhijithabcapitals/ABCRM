# AB Capital Workspace

Internal workspace for AB Capital Services FZC — built with React, Supabase, and Vite. Deployed on Vercel.

🔗 **Live app:** https://ab-capital-crm-dashboard.vercel.app

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

Deployed on Vercel. Every push to `main` branch auto-deploys.

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
5. They log in at https://ab-capital-crm-dashboard.vercel.app

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
