// Sort and filter rules for table headers. Pure logic, no imports, so it can be tested on its own.

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const NUMBER = /^(?:AED|USD|EUR|GBP|INR|Rs\.?|\$|₹)?\s*(-?[\d,]*\.?\d+)\s*%?$/i;
const SLASH_DATE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ ,T]+(\d{1,2}):(\d{2}))?/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/;
const NAMED_DATE = /^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ -](\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?/;

export const BLANK_LABEL = "(Blank)";

export const isBlank = (text) => {
  const t = String(text ?? "").trim();
  return t === "" || t === "-" || t === "–" || t === "—";
};

// Dates in this CRM read DD/MM/YYYY, so 05/11/2026 is 5 November.
export function sortValue(text) {
  if (isBlank(text)) return { kind: "blank", value: 0 };
  const t = String(text).trim();
  const number = t.match(NUMBER);
  if (number) return { kind: "number", value: Number(number[1].replace(/,/g, "")) };
  let m = t.match(SLASH_DATE);
  if (m) return { kind: "number", value: Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)) };
  m = t.match(ISO_DATE);
  if (m) return { kind: "number", value: Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) };
  m = t.match(NAMED_DATE);
  if (m && MONTHS[m[2].toLowerCase()] !== undefined) return { kind: "number", value: Date.UTC(+m[3], MONTHS[m[2].toLowerCase()], +m[1], +(m[4] || 0), +(m[5] || 0)) };
  return { kind: "text", value: t };
}

// Blanks go last in both directions.
export function compareText(a, b, dir = "asc") {
  const x = sortValue(a);
  const y = sortValue(b);
  if (x.kind === "blank" || y.kind === "blank") return x.kind === y.kind ? 0 : x.kind === "blank" ? 1 : -1;
  const sign = dir === "desc" ? -1 : 1;
  if (x.kind === "number" && y.kind === "number") return sign * (x.value - y.value);
  return sign * String(a).trim().localeCompare(String(b).trim(), undefined, { numeric: true, sensitivity: "base" });
}

export const filterIsOn = (filter) => !!filter && (!!filter.text?.trim() || (filter.excluded?.length ?? 0) > 0);

export const labelOf = (text) => (isBlank(text) ? BLANK_LABEL : String(text).trim());

export function passesFilter(text, filter) {
  if (!filterIsOn(filter)) return true;
  const label = labelOf(text);
  if (filter.excluded?.includes(label)) return false;
  const typed = filter.text?.trim().toLowerCase();
  return !typed || label.toLowerCase().includes(typed);
}

// Each different value once, A to Z, with how many rows hold it. Blank comes last.
export function distinctValues(texts, limit = 300) {
  const counts = new Map();
  for (const text of texts) {
    const label = labelOf(text);
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => (a === BLANK_LABEL ? 1 : b === BLANK_LABEL ? -1 : compareText(a, b)))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

// A row with one wide cell belongs to the row above, such as an expanded detail row. With no row above, as with a
// "No records" message, it stays in place. Takes each row's cell count and first colSpan; returns groups of row indexes.
export function groupRows(shapes) {
  const pinned = [];
  const groups = [];
  shapes.forEach((shape, index) => {
    const wide = shape.cells === 1 && shape.colSpan > 1;
    if (!wide) groups.push([index]);
    else if (groups.length) groups[groups.length - 1].push(index);
    else pinned.push(index);
  });
  return { pinned, groups };
}

// The column under a header, allowing for cells that span several columns. Returns the cell index or -1.
export function cellIndexAt(colSpans, column) {
  let at = 0;
  for (let i = 0; i < colSpans.length; i += 1) {
    at += colSpans[i] || 1;
    if (column < at) return i;
  }
  return -1;
}
