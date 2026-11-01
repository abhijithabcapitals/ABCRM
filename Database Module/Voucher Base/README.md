# Voucher Base

The register of every receipt, quotation and engagement letter number the CRM generates, in the CRM Supabase project.

| Path | Purpose |
|---|---|
| `migrations/001_voucher_register.sql` | `voucher_register`, filled by triggers from Business Banking and Template Hub, and a copy of existing documents |

Each row holds the type, number, version, serial, company, department, client, date, amount, status and where the file is saved. Nobody writes to it directly. Run this migration after Banking Base, Services Base and Template Hub Base.

`migrations/002_voucher_files.sql` records documents generated from Word templates (under their file name, since they carry no CRM number) and adds the PC location of a file saved after the document was created. `storage_path` is the private online copy, `local_path` the file in `Database Module/Generated Documents`.
