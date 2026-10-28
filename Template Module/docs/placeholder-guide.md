# Writing a .docx template

Templates are ordinary Word files that contain `{{ key }}` placeholders. They are filled in the browser with
docxtemplater, using `{{ }}` delimiters. Whitespace inside the braces is ignored, so `{{key}}` works the same.

## Placeholders

| Placeholder | Value |
|---|---|
| `{{ <field key> }}` | any field defined on the template (date fields are formatted as `02 Oct 2026`) |
| `{{ <fee key>_usd }}` | the fee converted to USD (amount ÷ `usd_rate`, rounded half-up to whole dollars) |
| `{{ total }}` | AED total of all fee rows plus any ad-hoc rows |
| `{{ total_usd }}` | sum of the rounded USD line values, so the column adds up |
| `{{ date }}` | today's date, unless a field with key `date` is provided |
| `{{ quotation_no }}` | `QT-<year>-001` …, unless provided |
| `{{ usd_rate }}` | the rate used |

## Fee table that grows with extra rows

Put this loop in **one table row** of the .docx:

```
{{#items}} {{sl}} | {{label}} | {{amount}} | {{amount_usd}} | {{remarks}} {{/items}}
```

The row repeats once for every fee field that has a value, and once for every ad-hoc row added at generation
time. `{{ sl }}` is the serial number 1, 2, 3 …. Leave out any column you don't need. Fee fields left blank
get no row; a fee of `0` still gets one.

## Batch (Excel) generation

The first sheet is read, and each non-empty row becomes one document; all of them are downloaded together as a
zip. Column headers can be either the field **key** or its **label**.

## Output file name

`<business activity / business name / first text field> - YYYY-MM-DD_HHMMSS.docx`
