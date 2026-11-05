# Business Setup Module

The CRM's **Business Setup** tab: from a client's form to a finished service handed to Accounts. Design and plan are in `docs/`.

| Path | Purpose |
|---|---|
| `components/BusinessSetup.jsx` | Shell, permissions, navigation |
| `components/{Dashboard,AllLeads,DocumentationPage,Cases,Completion,Clients,FeeMaster,Tasks,Settings}.jsx` | Tabs: Dashboard, All Leads (with the Move to Client Onboarding dialog and the Review screen from `Onboarding.jsx`), Client Onboarding (temporarily `DocumentationPage.jsx`), Pipeline (`Cases.jsx`), Completion, Clients, Services & Fees, Tasks, Settings |
| `components/Documents.jsx`, `components/Import.jsx` | The document register (second view of Documentation) and the old CRM import (inside Settings) |
| `components/Workspace.jsx`, `components/workspace/` | One client, one file per tab. `ClientCases.jsx` is the Cases tab with + New Case |
| `components/NewServiceFlow.jsx` | Services, fees and template, then a quote. Takes a `caseId` and passes `case_id` to `createDocument` |
| `components/ZohoInvoicePanel.jsx` | Reserved for the Zoho invoice step. Also used by Banking |
| `logic/` | Pure rules (`nav.js`, `caseWorkspace.js`, `loginSecret.js`, ...), tested with `node --test "Business Setup Module/tests/"` |
| `services/` | `businessSetupApi.js` for database calls, `documents.js` for Word files |
| `scripts/fix_templates.py` | Makes corrected copies of the quote templates |
| `Resources/` | Git-ignored. Client data, prices and templates. Never commit it |

The client's screens are in `Client Login Module/portal` (`SetupForm.jsx`, `SetupView.jsx`), reached through the `client-portal` Edge Function. The Accounts review is `Accounting Module/components/SetupValidation.jsx`.

The five zone quote templates hold prices, so they are not in the repository. Upload the corrected copies under Settings, Master templates, before quoting.

The Main Module loads this folder through the `@business-setup` alias in `Main Module/vite.config.js`. The database is in `Database Module/Business Setup Base`.
