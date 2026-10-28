# Template Module

Freezone **quotation templates**: you upload a Word (.docx) template for each freezone, define its fields
(text / number / date / list, with fee rows and remarks), set an AED→USD rate, and keep an edit history. From
the template you can generate a filled .docx from a form or a batch of them from an Excel sheet. Generating can
also file a CRM task.

Extracted on 2026-10-28 from `ABCapitalCRMDashboard` (`src/components/Quotations.jsx`, `db/quotation_maker.sql`,
`db/quotation_templates_access.sql`) at commit `edab9d1`, so it can be integrated into another CRM. The code
is unchanged apart from being split into files, with all database/storage calls moved into
`services/templatesApi.js`.

## Folders

| Folder | Contents |
|---|---|
| `components/` | React UI: `QuotationsPage.jsx` (Generate / Templates tabs), `GenerateTab.jsx`, `TemplatesTab.jsx` (list + download), `TemplateEditor.jsx` (create / edit / save / delete + history), `icons.jsx` |
| `logic/` | Pure functions: `helpers.js` (formatting, slugs, file names, constants), `buildContext.js` (fields → docx data, fee rows, totals, USD), `renderDocx.js` (docxtemplater), `diffTemplateFields.js` (history diff chips) |
| `services/` | Backend access: `templatesApi.js` (fetch / download / save / delete templates, history), `crmTask.js` (files a generated quotation as a CRM task), `supabaseClient.js` |
| `database/` | SQL to run in order: `01_quotation_maker.sql` (table, RLS, storage bucket), `02_quotation_templates_access.sql` (granular access + history table and trigger) |
| `styles/` | `template-module.css`: the `.btn` / `.modal` classes and `--accent` colours the components use |
| `templates/` | Local copies of saved templates, one folder per freezone (`template.docx` + `fields.json`). See its README |
| `docs/` | `placeholder-guide.md`: how to write a .docx template |

`index.js` re-exports everything; `package.json` lists the peer dependencies.

## Integrating into a CRM

1. **Dependencies:** install them in the host app:
   `npm i @supabase/supabase-js docxtemplater pizzip jszip file-saver xlsx` (the module uses React 19
   and lazy-loads the document libraries).
2. **Database:** in the host's Supabase SQL editor, run `database/01_*.sql` and then `02_*.sql`. Both scripts
   are idempotent. They expect a `profiles` table with `id = auth.uid()` and a `role` column (`'admin'` for
   admins).
3. **Supabase client:** replace `services/supabaseClient.js` with a re-export of the host's existing client.
4. **Mount it:** `import { QuotationsPage } from "<path>/Template Module"` and render
   `<QuotationsPage profile={profile} />`. `profile` needs `full_name` and `role`.
5. **CRM task (optional):** `services/crmTask.js` writes to the source app's `spaces / folders / lists / tasks /
   space_fields / space_statuses / task_field_values` tables, and the target list is set in `CRM_TARGET`
   (`logic/helpers.js`: Delivery ▸ Quotation ▸ "Quotations by CRM"). If the host CRM's task schema is
   different, rewrite `createCrmTask` for that schema. If it fails, the error is shown in the status message
   and the .docx still downloads.

## Access model (from the SQL)

- Read templates and history: any signed-in user.
- Edit fields and rate: any signed-in user.
- Create, upload/replace the .docx, and delete: admins only (also enforced in the UI).
- Delete is a soft delete (`deleted_at`). Each new upload goes to a new storage path, so every earlier file
  version stays in the bucket, and every insert/update is recorded in `quotation_template_history`.

## Not included

- The actual freezone .docx files and their field definitions. They are in the source app's Supabase and need
  a signed-in account to download; `templates/README.md` explains how to save them here.
- The sidebar "status templates" (Business / etc. presets in `Sidebar.jsx`). That is a separate feature from
  this module.
