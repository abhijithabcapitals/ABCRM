# Services Base

AB Capital's services and the departments that handle them, in the CRM Supabase project. To move a service group to another department, change `department` on its `service_categories` row.

| Table | Holds |
|---|---|
| `service_departments` | Departments and their CRM tabs |
| `service_categories` | Service groups, each mapped to one department |
| `service_items` | The services in each group |

| No. | Department | Main focus | Service group |
|---|---|---|---|
| 1 | Business Setup | Mainland, Free Zone and Offshore Company Formation | Company Formation & Business Setup |
| 2 | Business Banking | Corporate Bank Accounts, Business Loans and Banking Solutions | Corporate Banking & Financial Services |
| 3 | Accounting | Accounting, Bookkeeping, MIS and Financial Statements | Accounting & Bookkeeping |
| 4 | Tax Compliance | Corporate Tax Registration, Filing and Advisory | UAE Corporate Tax Services |
| 5 | Tax Compliance | VAT Registration, Filing and Compliance | UAE VAT Services |
| 6 | Accounting | Internal Audit, External Audit and Assurance | Audit & Assurance Services |
| 7 | Tax Compliance | E-Invoicing, ASP Services and Implementation | UAE E-Invoicing Services |
| 8 | Business Setup | PRO, Visas, Immigration and Government Services | PRO, Visa & Immigration Services |
| 9 | Business Setup | AML/CFT, UBO and Corporate Governance | Corporate Secretarial & Compliance Services |
| 10 | Business Setup | Company Liquidation, Closure and Amendments | Company Liquidation & Corporate Changes |
| 11 | Accounting | Business Plans, Feasibility Studies and CFO Services | Business Advisory & Consultancy |
| 12 | Tax Compliance | Tax Residency Certificates and International Tax Advisory | Tax Residency & International Business Services |

Run `migrations/001_services_and_departments.sql` before Template Hub Base.
