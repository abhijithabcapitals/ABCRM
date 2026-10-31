# Accounting Module

The CRM's **Accounting** page. Today it holds Banking Case Validation.

When the business team finishes an approved banking case and sends it to Accounts, the case leaves their lists and cannot be changed by anyone. Accounts reviews it here, then:

- **Validate and close:** the case is Closed, read-only and greyed out in a collapsed section under the business team's lists.
- **Revert:** the case returns to the business team with Accounts' remarks. They fix it and send it again.

| Path | Purpose |
|---|---|
| `components/BankingValidation.jsx` | Queue and review page |
| `Database Module/Accounting Base` | Review records, ACCOUNTS role, handover functions |
| `Database Module/Banking Base/migrations/011_banking_handover_accounts.sql` | Case lock and access rules |

The page needs the `accounts.review` permission: assign the ACCOUNTS role in Business Banking settings. It reuses the Banking Module's components and client through the `@banking` alias.
