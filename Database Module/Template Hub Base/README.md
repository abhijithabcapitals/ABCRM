# Template Hub Base

`migrations/004_hub_admin.sql` gives managers (data role MANAGER, or active HR designation Manager) Template Hub admin rights; undo with `rollback/004_rollback.sql`.

`migrations/002_master_templates.sql` records the master Word file uploaded in Settings for each generated document, keeping every earlier upload.

Database for the CRM's **Template Hub** tab (`Template Module` folder, formerly Document Generator), in the CRM Supabase project.

Its existing tables and storage keep their names, because live data and other code use them. Their SQL is in `Template Module/database` (`quotation_templates`, its access and history). New Template Hub SQL goes in `migrations/` here.

| Path | Purpose |
|---|---|
| `migrations/001_generated_documents.sql` | Every quotation, engagement letter and mail draft with its number, serial and locations (services come from `Services Base`). Numbers follow the format per department and type set under Template Hub > Settings, by default `ABC/YYYY/MM/<BS, AC or TC><Q or E>001`; Business Banking shares its own `BBQ`/`BBE` series. A mail keeps its document's number |

Run it after Banking Base and Services Base.
