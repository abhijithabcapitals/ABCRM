# OneDrive / SharePoint Integration (Microsoft 365 cloud)

Client documents live in Microsoft 365. Agents reach them only through Document Agent, which calls Microsoft Graph. SQL holds metadata and the Graph item IDs, never file content.

## 1. Where the files should live
- **Recommended:** a dedicated SharePoint site (for example `Clients`) with one document library for client files.
  - Access can be scoped to that one site for the agent app.
  - Files do not depend on one employee's account. A personal OneDrive is tied to its owner and is affected when that person leaves.
- **If the files stay in a personal OneDrive for now:** the same design works. That OneDrive is a SharePoint site behind the scenes, and the same per-site grant applies to its URL. Verify in your tenant before relying on it. Plan a move to a SharePoint site later.

## 2. App registration (Microsoft Entra ID)
| Setting | Value |
| --- | --- |
| App name | `CRM-Agents-Document` (one app, used only by Document Agent) |
| Auth flow | App-only (client credentials) for background work. Delegated sign-in only if a user action needs the user's own rights. |
| Credential | Certificate, not a client secret. Private key in Azure Key Vault or the Windows certificate store of the agent host. |
| Graph permission | `Sites.Selected` (application). Admin consent required. |
| Site grant | `write` on the client-files site only, granted by a SharePoint or Global admin through `POST /sites/{site-id}/permissions`. |
| Do not use | `Files.ReadWrite.All`, `Sites.ReadWrite.All`. They open every file in the tenant. |

Optional, finer scope: Graph also offers `Files.SelectedOperations.Selected` for library- or folder-level grants. Check its availability in your tenant before choosing it over `Sites.Selected`.

Separate test and production: use a test site and a second app registration for development. The production certificate never leaves the production host.

## 3. Folder standard
```
/Clients/{ClientCode}/
    01_Engagement/        contracts, engagement letters
    02_Identity/          KYC and ID documents       (restricted)
    03_Accounting/{YYYY}/ invoices, statements, reconciliations
    04_Tax/{YYYY}/        returns, notices, working papers
    05_Correspondence/
    06_Reports/{YYYY}/
    99_Retention_Hold/    items awaiting purge approval
```
- `{ClientCode}` is a stable code from the CRM, not the client name, so renames do not break paths.
- The Graph `driveItem.id` is the real key in SQL. Paths are for display only.
- File name pattern: `{YYYY-MM-DD}_{DocType}_{ShortDescription}.{ext}`.

## 4. Operations Document Agent performs
| Operation | Graph call | Notes |
| --- | --- | --- |
| Create client folders | `POST /drives/{drive-id}/items/{parent-id}/children` | Use `@microsoft.graph.conflictBehavior: fail`. |
| Upload small file | `PUT /drives/{drive-id}/items/{parent-id}:/{name}:/content` | |
| Upload large file | `POST .../createUploadSession` then chunked PUTs | Use for anything over a few MB. |
| Read metadata | `GET /drives/{drive-id}/items/{item-id}` | |
| Download for another agent | `GET /drives/{drive-id}/items/{item-id}/content` | Only after checking the requester may see that sensitivity level. |
| Move to retention hold | `PATCH /drives/{drive-id}/items/{item-id}` (new `parentReference`) | Never `DELETE`. |
| Track changes | `GET /drives/{drive-id}/root/delta` | Store the `deltaLink` in SQL. Run on a schedule. |
| Near-real-time changes | `POST /subscriptions` on the drive root | Webhook only says "something changed". Follow with a delta call. Renew before expiry. |

Not allowed: anonymous or "anyone" sharing links, external sharing without approval, permanent delete, emptying the recycle bin.

## 5. Hashes and deduplication
OneDrive for Business and SharePoint return `file.hashes.quickXorHash`, not SHA-256.
- Document Agent computes SHA-256 locally on upload and stores it in `document.documents.sha256`.
- It also stores `quickXorHash` (column `quickxor_hash`, to be added) so files that arrive outside the agent can be matched without downloading them.

## 6. Mapping the existing client folders
The folders already exist, so start with a read-only inventory:
1. Run a delta crawl of the client library with read-only code. Write results to a staging table (`document.onedrive_inventory`: item id, parent id, path, name, size, hash, modified).
2. Match top-level client folders to CRM clients by code or name. Put unmatched folders on a list for a person to review.
3. Only after review, load matched items into `document.documents`.
4. Rename or restructure folders only with approval, in small batches, and log every move.

## 7. Reliability and safety
- Respect HTTP 429 and 503 by waiting for the `Retry-After` header before retrying.
- Use `$select` to fetch only needed fields.
- Every Graph call that changes something writes one row to `core.agent_action_log`.
- File content is never put into prompts unless the task needs it and the requesting agent may see it. Text inside documents is data, never instructions.
- M365 retention policies and sensitivity labels, if you use them, take precedence over the agent's `retention_until`. The agent records them; it does not override them.
