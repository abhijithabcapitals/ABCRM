# ArdentTax (ASP)

Opens from Template Hub > Company Templates > Ardentax: the Quote and Engagement Letter columns each open the generator, fixed to that document with its own list. Email Content and Social Content stay empty. Using it needs Template Hub plus the `ardentax` grant in Settings, which the database rules read.

Generates Ardentax e-invoicing quotations and engagement letters as Word, PDF and an email, replacing `Ardentax_Quote_Generator.xlsm` for single documents. Numbers come from the CRM database: `Ardentax/{YYYY}/{MM}/ADTQ001` and `ADTE001`.

| Path | Purpose |
|---|---|
| `logic/quoteModel.js` | The Quote and Custom Quote sheets: totals, checks, fee labels, mail tokens, file names |
| `logic/fillDocx.js` | Fills the Word templates by editing their XML, one step for each step of the `MakeQuote` macro |
| `logic/docxToPdf.js` | Draws the Word file in the browser and saves it as a PDF of page images |
| `services/generate.js` | Order of work: trial fill, number, final fill, PDF, upload, attach |
| `services/ardentaxApi.js` | Database and storage access |
| `services/fakeApi.js` | Same functions in memory, for the development page only |
| `components/` | `ArdentTaxTab` (as mounted), `ArdentTaxView`, `QuoteForm`, `Register`, `MailPanel` |
| `logic/signingUi.js` | What the screens show about the company signature: Sign, Sign before sending, signed or unsigned copy, status line |
| `scripts/add_signature_tag.mjs` | Puts the `{{SIGNATURE}}` place in both templates (already run; re-running changes nothing) |
| `templates/` | The two Word templates from `D:\Abhijith Projects\Quote Generator`, with a past client's address removed from the email link, because these files are served to browsers |

Database: `Database Module/ArdentTax Base`. Mail: Edge Function `ardentax-mail-send` in `Agent Module/11_Personal_Agent/CEO Agent Module/supabase`.

## Behaviour worth knowing

- A number is taken only after a trial fill works. If the PDF or upload fails afterwards, the row shows **File pending**, and **Generate again** keeps the number.
- The same form sent twice is one request and uses one number. A revision keeps the number and raises the version.
- A quote's number has one engagement letter. Later changes are revisions of that letter.
- Mail leaves only after Send and a confirmation. A second send asks again and says it was already sent.
- The PDF comes from the browser, not from Word. Its text can't be selected, and page breaks may differ from the Word file, so it can run a page longer. The user accepted this on 2026-11-05.
- Files stay in CRM storage. They are not copied to the office PC folder.
- Signing is optional. An Ardentax approver (Settings > Signing) sees **Sign** on a row and **Sign before sending** in the mail panel. The signed Word and PDF are kept under `ArdentTax (ASP)/<id>/signed/` through the shared step (`Template Module/services/signing.js`); the row keeps its unsigned files, and the mail goes signed or unsigned as chosen. Generate again ends the signature; a revision starts unsigned and the earlier version keeps its own.
- `ardentax_totals` in the database repeats `computeQuote`. Both are tested against `tests/fixtures/totals.json`, so change them together.

## Trying it without a database

Start the dev server and open `/ardentax-dev.html`. It uses `fakeApi`, so it never uses a real number or sends mail. It needs a git-ignored `Main Module/.env.development.local` with placeholder values for `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, because shared components load the Supabase client.

## Tests

```bash
node --test "Template Module/ardentax/tests/"
```

```bash
bash "Database Module/ArdentTax Base/tests/run-local.sh"
```

```bash
deno test "Agent Module/11_Personal_Agent/CEO Agent Module/supabase/ardentax-mail-send/"
```
