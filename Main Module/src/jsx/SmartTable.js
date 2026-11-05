// Every <table> in the CRM renders through here (see jsx-runtime.js), so each header gets sort and filter with no
// change to the page that uses it. It reads the cells as shown on screen, so it works whatever a cell renders.
//
// Rows are moved and hidden in the browser's page, not through React. React only inserts next to, or removes, rows it
// knows, and those stay under the same parent, so this is safe; a change to the rows simply re-applies the sort.
//
// Not used for: a table marked data-plain (calendar grids), or one whose rows are mostly text boxes (entry forms),
// where sorting would move rows while someone types.
import { createElement as h, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { jsx, jsxs } from "react/jsx-runtime";
import { cellIndexAt, compareText, distinctValues, filterIsOn, groupRows, labelOf, passesFilter } from "./tableSortLogic.js";

const BUTTON = "crm-th-btn";
const seen = new WeakMap();
let nextSeq = 0;
const seqOf = (row) => { if (!seen.has(row)) { nextSeq += 1; seen.set(row, nextSeq); } return seen.get(row); };

function cellText(cell) {
  if (!cell) return "";
  const field = cell.querySelector("input:not([type=checkbox]):not([type=radio]), textarea");
  if (field && field.value) return field.value;
  return (cell.innerText ?? cell.textContent ?? "").replace(/\s+/g, " ").trim();
}

const headerRow = (table) => {
  const rows = table.tHead?.rows;
  return rows?.length ? rows[rows.length - 1] : null;
};

const shapeOf = (row) => ({ cells: row.cells.length, colSpan: row.cells[0]?.colSpan || 1 });

function textAt(row, column) {
  const index = cellIndexAt([...row.cells].map((c) => c.colSpan), column);
  return index < 0 ? "" : cellText(row.cells[index]);
}

function headerText(th) {
  return [...th.childNodes].filter((n) => !(n.classList?.contains(BUTTON))).map((n) => n.textContent).join("").replace(/\s+/g, " ").trim();
}

function isEntryForm(table) {
  const rows = [...(table.tBodies[0]?.rows || [])];
  if (!rows.length) return false;
  const withBox = rows.filter((r) => r.querySelector('input:not([type=checkbox]):not([type=radio]):not([type=search]), textarea')).length;
  return withBox * 2 >= rows.length;
}

// All body rows that hold data, leaving out wide detail and message rows.
function dataRows(table) {
  const out = [];
  for (const body of table.tBodies) {
    const rows = [...body.rows];
    for (const group of groupRows(rows.map(shapeOf)).groups) out.push(rows[group[0]]);
  }
  return out;
}

function applyToBody(body, sort, filters) {
  const rows = [...body.rows];
  rows.forEach(seqOf);
  const { pinned, groups } = groupRows(rows.map(shapeOf));
  const columns = Object.keys(filters).filter((c) => filterIsOn(filters[c]));
  const entries = groups.map((indexes) => {
    const head = rows[indexes[0]];
    const show = columns.every((c) => passesFilter(textAt(head, Number(c)), filters[c]));
    return { rows: indexes.map((i) => rows[i]), show, seq: seqOf(head), key: sort ? textAt(head, sort.col) : "" };
  });
  entries.sort((a, b) => (sort ? compareText(a.key, b.key, sort.dir) : 0) || a.seq - b.seq);
  for (const e of entries) for (const r of e.rows) { if (r.hidden === e.show) r.hidden = !e.show; }
  const wanted = [...pinned.map((i) => rows[i]), ...entries.flatMap((e) => e.rows)];
  if (wanted.some((r, i) => rows[i] !== r)) for (const r of wanted) body.appendChild(r);
}

export function ColumnMenu({ title, rect, values, filter, sort, canSort = true, onSort, onFilter, onClose, note }) {
  const box = useRef(null);
  useEffect(() => {
    const away = (e) => { if (box.current && !box.current.contains(e.target) && !e.target.closest?.(`.${BUTTON}`)) onClose(); };
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [onClose]);

  const excluded = filter?.excluded || [];
  const text = filter?.text || "";
  const shown = values.filter((v) => v.label.toLowerCase().includes(text.trim().toLowerCase()));
  const set = (patch) => onFilter({ text, excluded, ...patch });
  const toggle = (label) => set({ excluded: excluded.includes(label) ? excluded.filter((x) => x !== label) : [...excluded, label] });
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - 268));
  const top = Math.min(rect.bottom + 4, Math.max(8, window.innerHeight - 400));

  return createPortal(
    h("div", { ref: box, className: "crm-th-menu", role: "dialog", "aria-label": `Sort and filter ${title}`, style: { left, top }, onClick: (e) => e.stopPropagation() },
      h("div", { className: "crm-th-title" }, title),
      canSort && h("div", { className: "crm-th-sorts" },
        h("button", { type: "button", className: sort === "asc" ? "on" : "", onClick: () => onSort(sort === "asc" ? null : "asc") }, "▲ Sort A to Z"),
        h("button", { type: "button", className: sort === "desc" ? "on" : "", onClick: () => onSort(sort === "desc" ? null : "desc") }, "▼ Sort Z to A")),
      h("input", { type: "search", autoFocus: true, placeholder: "Filter this column…", "aria-label": `Filter ${title}`, value: text, onChange: (e) => set({ text: e.target.value }) }),
      h("div", { className: "crm-th-actions" },
        h("button", { type: "button", onClick: () => set({ excluded: excluded.filter((x) => !shown.some((v) => v.label === x)) }) }, "Select all"),
        h("button", { type: "button", onClick: () => set({ excluded: [...new Set([...excluded, ...shown.map((v) => v.label)])] }) }, "Select none")),
      h("div", { className: "crm-th-values" },
        !shown.length && h("div", { className: "crm-th-none" }, "No matching values."),
        shown.map((v) => h("label", { key: v.label },
          h("input", { type: "checkbox", checked: !excluded.includes(v.label), onChange: () => toggle(v.label) }),
          h("span", { title: v.label }, v.label),
          h("em", null, v.count)))),
      h("div", { className: "crm-th-foot" },
        h("span", null, note),
        h("button", { type: "button", disabled: !sort && !filterIsOn(filter), onClick: () => { onFilter({ text: "", excluded: [] }); if (sort) onSort(null); } }, "Clear"))),
    document.body,
  );
}

export function SmartTable({ sortFilterAll, children, ...rest }) {
  const table = useRef(null);
  const [sort, setSort] = useState(null);
  const [filters, setFilters] = useState({});
  const [open, setOpen] = useState(null); // { col, title, rect }
  const [, redraw] = useState(0);
  const live = useRef({});
  live.current = { sort, filters, open };

  const anyFilter = Object.values(filters).some(filterIsOn);
  const active = !!sort || anyFilter;

  const decorate = useCallback(() => {
    const el = table.current;
    const head = el && headerRow(el);
    if (!head) return;
    const form = isEntryForm(el);
    let col = 0;
    for (const th of head.cells) {
      const at = col;
      col += th.colSpan;
      const label = headerText(th);
      let button = [...th.children].find((c) => c.classList.contains(BUTTON));
      if (form || !label || th.querySelector("input")) { button?.remove(); th.classList.remove("crm-th"); continue; }
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = BUTTON;
        th.appendChild(button);
      }
      // Set each time, because React rewrites these when a header's own class or style changes.
      th.classList.add("crm-th");
      if (getComputedStyle(th).position === "static") th.style.position = "relative";
      // Set each time, because the column under this header can change when a table's columns change.
      button.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        const current = live.current.open;
        setOpen(current?.col === at ? null : { col: at, title: headerText(th), rect: button.getBoundingClientRect() });
      };
      const { sort: s, filters: f } = live.current;
      const sorted = s?.col === at ? s.dir : null;
      const filtered = filterIsOn(f[at]);
      const mark = sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : "▾";
      if (button.textContent !== mark) button.textContent = mark;
      button.classList.toggle("on", !!sorted || filtered);
      button.classList.toggle("filtered", filtered);
      button.setAttribute("aria-label", `Sort and filter ${label}`);
      button.title = filtered ? "Filtered. Click to change." : "Sort and filter";
    }
  }, []);

  const apply = useCallback(() => {
    const el = table.current;
    if (!el) return;
    const { sort: s, filters: f } = live.current;
    for (const body of el.tBodies) applyToBody(body, s, f);
  }, []);

  const wasActive = useRef(false);
  const observer = useRef(null);
  const rowCount = useRef(0);
  const run = useCallback(() => {
    observer.current?.disconnect();
    decorate();
    const on = !!live.current.sort || Object.values(live.current.filters).some(filterIsOn);
    if (on || wasActive.current) apply();
    wasActive.current = on;
    if (table.current) {
      observer.current?.observe(table.current, { childList: true, subtree: true });
      // The menu reads the rows while drawing, so it draws again when a paged table brings in the rest of its rows.
      const count = dataRows(table.current).length;
      if (live.current.open && count !== rowCount.current) redraw((n) => n + 1);
      rowCount.current = count;
    }
  }, [decorate, apply]);

  // A row can change without this component drawing again, when a component inside the table loads its own rows.
  useEffect(() => {
    let frame = 0;
    observer.current = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { run(); if (live.current.open) redraw((n) => n + 1); });
    });
    if (table.current) observer.current.observe(table.current, { childList: true, subtree: true });
    return () => { cancelAnimationFrame(frame); observer.current?.disconnect(); };
  }, [run]);

  useLayoutEffect(run);

  // A paged table shows every row while its menu is open or a sort or filter is on, so they cover all rows, not one page.
  const wantsAll = active || !!open;
  useEffect(() => { sortFilterAll?.(wantsAll); }, [wantsAll, sortFilterAll]);

  const close = useCallback(() => setOpen(null), []);
  let menu = null;
  if (open && table.current) {
    const rows = dataRows(table.current);
    const on = Object.keys(filters).filter((c) => filterIsOn(filters[c]));
    const visible = rows.filter((r) => on.every((c) => passesFilter(textAt(r, Number(c)), filters[c]))).length;
    menu = jsx(ColumnMenu, {
      title: open.title,
      rect: open.rect,
      values: distinctValues(rows.map((r) => labelOf(textAt(r, open.col)))),
      filter: filters[open.col],
      sort: sort?.col === open.col ? sort.dir : null,
      note: `${visible} of ${rows.length} rows`,
      onSort: (dir) => setSort(dir ? { col: open.col, dir } : null),
      onFilter: (value) => setFilters((all) => ({ ...all, [open.col]: value })),
      onClose: close,
    });
  }
  return jsxs("table", { ...rest, ref: table, children: [children, menu] });
}
