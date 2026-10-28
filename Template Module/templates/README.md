# Saved templates

This folder holds a local copy of each freezone template, with one folder per template:

```
templates/
  <freezone-slug>/          e.g. ifza/, dmcc/, rakez/
    template.docx           the Word file with {{ placeholders }}
    fields.json             freezone, usd_rate, file_name, fields[] (same shape as quotation_templates.fields)
    versions/               optional: older .docx files, named <YYYY-MM-DD>_<name>.docx
```

`_example/fields.json` shows the format. It's an illustration, not a real template.

In the source app the live templates are stored in Supabase: the `.docx` is in the private `quotation-templates`
storage bucket at `<freezone-slug>/<timestamp>_<file>.docx`, and the field definitions are in the
`quotation_templates` table. Nothing was downloaded from that Supabase project, because it needs a signed-in
account. To fill this folder, download each template from the app (Quotations → Templates → **Download**),
save it here as `template.docx`, and copy its fields into `fields.json`.

## Field shape

| key | meaning |
|---|---|
| `key` | placeholder name used in the .docx as `{{ key }}` (lowercase, `a-z0-9_`) |
| `label` | form label and fee-table row label |
| `type` | `text` · `number` · `date` · `list` (multi-line, one item per line) |
| `fee` | `true` → the field becomes a fee row in `{{#items}}` and counts toward `{{ total }}` |
| `remarks` | fee rows only: the text in the Remarks column |
