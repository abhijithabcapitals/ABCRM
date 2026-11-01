# Template Hub Base

Database for the CRM's **Template Hub** tab (`Template Module` folder, formerly Document Generator), in the CRM Supabase project.

Its existing tables and storage keep their names, because live data and other code use them. Their SQL is in `Template Module/database` (`quotation_templates`, its access and history). New Template Hub SQL goes in `migrations/` here.

| Path | Purpose |
|---|---|
| `migrations/001_generated_documents.sql` | Every quotation, engagement letter and mail draft with its number, serial and locations (services come from `Services Base`). Numbers: `ABC/YYYY/MM/<BS, AC or TC><Q or E>001`; Business Banking shares its own `BBQ`/`BBE` series |

Run it after Banking Base and Services Base.
