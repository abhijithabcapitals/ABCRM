# Business Setup Module

The CRM's **Business Setup** tab: from a client's form to a finished service handed to Accounts. Design and plan are in `docs/`.

| Path | Purpose |
|---|---|
| `components/BusinessSetup.jsx` | Shell, permissions, navigation |
| `components/{Dashboard,Onboarding,Clients,FeeMaster,Documents,Tasks,Import,Settings}.jsx` | Pages |
| `components/Workspace.jsx`, `components/workspace/` | One client, one file per tab |
| `components/NewServiceFlow.jsx` | Services, fees and template, then a quote |
| `components/ZohoInvoicePanel.jsx` | Reserved for the Zoho invoice step. Also used by Banking |
| `logic/` | Pure rules, tested with `node --test "Business Setup Module/tests/"` |
| `services/` | `businessSetupApi.js` for database calls, `documents.js` for Word files |
| `scripts/fix_templates.py` | Makes corrected copies of the quote templates |
| `Resources/` | Git-ignored. Client data, prices and templates. Never commit it |

The client's screens are in `Client Login Module/portal` (`SetupForm.jsx`, `SetupView.jsx`), reached through the `client-portal` Edge Function. The Accounts review is `Accounting Module/components/SetupValidation.jsx`.

The five zone quote templates hold prices, so they are not in the repository. Upload the corrected copies under Settings, Master templates, before quoting.

The Main Module loads this folder through the `@business-setup` alias in `Main Module/vite.config.js`. The database is in `Database Module/Business Setup Base`.
