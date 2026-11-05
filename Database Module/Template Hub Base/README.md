# Template Hub Base

`migrations/004_hub_admin.sql` gives managers (data role MANAGER, or active HR designation Manager) Template Hub admin rights; undo with `rollback/004_rollback.sql`.

`migrations/002_master_templates.sql` records the master Word file uploaded in Settings for each generated document, keeping every earlier upload.

Database for the CRM's **Template Hub** tab (`Template Module` folder, formerly Document Generator), in the CRM Supabase project.

Its existing tables and storage keep their names, because live data and other code use them. Their SQL is in `Template Module/database` (`quotation_templates`, its access and history). New Template Hub SQL goes in `migrations/` here.

| Path | Purpose |
|---|---|
| `migrations/001_generated_documents.sql` | Every quotation, engagement letter and mail draft with its number, serial and locations (services come from `Services Base`). Numbers follow the format per department and type set under Template Hub > Settings, by default `ABC/YYYY/MM/<BS, AC or TC><Q or E>001`; Business Banking shares its own `BBQ`/`BBE` series. A mail keeps its document's number |

Run it after Banking Base and Services Base.

| `migrations/007_work_types.sql` | AB Capital work types: saved wording on `hub_library_templates.sections`; AB Capital documents need no file |
| `migrations/006_library_letter.sql` | `hub_library_letter_create`: AB Capital engagement letters made from Company Templates, directly or from a quote not in a case. Business Setup's own flow keeps its accepted quote rule |
| `migrations/005_library_fill.sql` | Company Library: `hub_library_templates` and `hub_library_template_files`, `hub_library_create` (AB Capital through `hub_document_create` as a Business Setup quote, Ardentax as `doc_type = library` in department `Ardentax Documents`, numbers `Ardentax/YYYY/MM/ADTD001`), `hub_numbering_status` and `hub_numbering_save` accept the `document` kind, `hub_doc_read` hides library rows from people without the ArdentTax tab. Run after Business Setup 001-014, ArdentTax 001 and 003 above. Undo with `rollback/004_rollback.sql`, which refuses while library documents exist unless `library.rollback_force` is `yes` |

Test it on a throwaway local PostgreSQL: `bash "Database Module/Template Hub Base/tests/run-local.sh"`. Nothing touches Supabase.
