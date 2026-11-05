// Fills the Ardentax Word templates by editing their XML, one step for each step of the workbook's MakeQuote macro.
// deps: { JSZip, parse(string) -> document, serialize(document) -> string }, so this runs in the browser and in tests.
import { ROW_KEYS, TIERS, feeLabel, money, num as toNum } from "./quoteModel.js";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const RPR_ORDER = ["w:rStyle", "w:rFonts", "w:b", "w:bCs", "w:i", "w:iCs", "w:caps", "w:smallCaps", "w:strike", "w:dstrike", "w:outline", "w:shadow", "w:emboss", "w:imprint", "w:noProof", "w:snapToGrid", "w:vanish", "w:webHidden", "w:color", "w:spacing", "w:w", "w:kern", "w:position", "w:sz", "w:szCs", "w:highlight", "w:u", "w:effect", "w:bdr", "w:shd", "w:fitText", "w:vertAlign", "w:rtl", "w:cs", "w:em", "w:lang", "w:eastAsianLayout", "w:specVanish", "w:oMath"];
const COMPANY = "Ardentax IT Solutions – FZCO";
const QUOTED = "quoted separately based on the actual requirements and prevailing charges at the time of request";
const EXCLUSIONS = [
  ["Annual Maintenance Charges (AMC)", ["maintenance", "amc"]],
  ["ERP integration", ["integration"]],
  ["onboarding and setup", ["onboarding"]],
  ["e-invoicing gap assessment", ["gap assessment"]],
  ["user training", ["training"]],
  ["custom development", ["custom development", "customisation", "customization"]],
];

const list = (nodes) => { const out = []; for (let i = 0; i < nodes.length; i += 1) out.push(nodes.item(i)); return out; };
const tags = (el, name) => list(el.getElementsByTagName(name));
const kids = (el, name) => list(el.childNodes).filter((c) => c.nodeType === 1 && (!name || c.nodeName === name));
const textOf = (el) => tags(el, "w:t").map((t) => t.textContent).join("");
const remove = (el) => el.parentNode.removeChild(el);
const up = (el, name) => { let n = el.parentNode; while (n && n.nodeName !== name) n = n.parentNode; return n; };
const dmy = (iso) => { const [y, m, d] = String(iso || "").slice(0, 10).split("-"); return d ? `${d}/${m}/${y}` : ""; };
// Characters XML cannot hold. Pasted text can carry them, and Word rejects the whole file if one gets in.
const clean = (s) => String(s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, "");
const dubaiToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());

function setText(t, raw) {
  const value = clean(raw);
  t.textContent = value;
  if (/^\s|\s$/.test(value)) t.setAttribute("xml:space", "preserve");
}

function rPrOf(doc, run) {
  let rPr = kids(run, "w:rPr")[0];
  if (!rPr) { rPr = doc.createElementNS(W, "w:rPr"); run.insertBefore(rPr, run.firstChild); }
  return rPr;
}

function removeProp(rPr, name) { kids(rPr, name).forEach(remove); }

// Puts a property in the place the Word schema expects.
function setProp(doc, rPr, node) {
  removeProp(rPr, node.nodeName);
  const at = RPR_ORDER.indexOf(node.nodeName);
  const next = kids(rPr).find((c) => { const i = RPR_ORDER.indexOf(c.nodeName); return i > at || i === -1; });
  rPr.insertBefore(node, next || null);
}

function prop(doc, name, val) {
  const el = doc.createElementNS(W, name);
  if (val !== undefined) el.setAttributeNS(W, "w:val", val);
  return el;
}

function replaceAll(doc, find, value) {
  for (const t of tags(doc, "w:t")) if (t.textContent.includes(find)) setText(t, t.textContent.split(find).join(value));
}

function dropParagraphs(doc, find) {
  for (const t of tags(doc, "w:t")) {
    if (!t.textContent.includes(find)) continue;
    const p = up(t, "w:p");
    if (p?.parentNode) remove(p);
  }
}

const fillOrDrop = (doc, find, value) => (value ? replaceAll(doc, find, value) : dropParagraphs(doc, find));

// Keeps the first paragraph's first text run with this text; everything else in the cell goes.
function setCellText(cell, value) {
  const paragraphs = kids(cell, "w:p");
  paragraphs.slice(1).forEach(remove);
  const runs = tags(paragraphs[0], "w:r");
  const keep = runs.find((r) => tags(r, "w:t").length) || runs[0];
  runs.filter((r) => r !== keep).forEach((r) => remove(r));
  setText(tags(keep, "w:t")[0], value);
}

function setFee(doc, cell, oldPrice, feeText, note) {
  const lines = [...(oldPrice > 0 ? [[`${money(oldPrice)} AED`, true]] : []), [feeText, false], ...(note ? [[note, false]] : [])];
  setCellText(cell, lines[0][0]);
  const first = kids(cell, "w:p")[0];
  const clones = lines.slice(1).map(([text]) => {
    const p = first.cloneNode(true);
    setText(tags(p, "w:t")[0], text);
    return p;
  });
  clones.forEach((p) => cell.appendChild(p));
  if (lines[0][1]) tags(first, "w:r").forEach((r) => setProp(doc, rPrOf(doc, r), prop(doc, "w:strike")));
}

const firstColor = (cell) => {
  const run = tags(cell, "w:r").find((r) => textOf(r).trim());
  // An empty cell has no text run: its colour is on the paragraph mark.
  const rPr = run ? kids(run, "w:rPr")[0] : tags(cell, "w:pPr").flatMap((p) => kids(p, "w:rPr"))[0];
  const color = rPr && kids(rPr, "w:color")[0];
  return color ? color.cloneNode(true) : null;
};
const shadingOf = (cell) => { const tcPr = kids(cell, "w:tcPr")[0]; const shd = tcPr && kids(tcPr, "w:shd")[0]; return shd ? shd.cloneNode(true) : null; };

function styleCell(doc, cell, { selected, color, shade }) {
  const rPrs = [...tags(cell, "w:r").map((r) => rPrOf(doc, r)), ...tags(cell, "w:pPr").flatMap((p) => kids(p, "w:rPr"))];
  for (const rPr of rPrs) {
    if (selected) { removeProp(rPr, "w:strike"); setProp(doc, rPr, prop(doc, "w:highlight", "yellow")); }
    else { setProp(doc, rPr, prop(doc, "w:strike")); removeProp(rPr, "w:highlight"); }
    if (color) setProp(doc, rPr, color.cloneNode(true));
    else removeProp(rPr, "w:color");
  }
  if (shade) {
    const tcPr = kids(cell, "w:tcPr")[0];
    const old = kids(tcPr, "w:shd")[0];
    if (old) tcPr.replaceChild(shade.cloneNode(true), old);
    else tcPr.appendChild(shade.cloneNode(true));
  }
}

function addSelectedLabel(doc, cell) {
  const p = kids(cell, "w:p")[0];
  const runs = kids(p, "w:r");
  const last = runs[runs.length - 1];
  const run = last.cloneNode(true);
  kids(run).filter((c) => c.nodeName !== "w:rPr" && c.nodeName !== "w:t").forEach(remove);
  const t = tags(run, "w:t")[0] || run.appendChild(doc.createElementNS(W, "w:t"));
  setText(t, " (Most Popular & Selected Package)");
  const rPr = rPrOf(doc, run);
  removeProp(rPr, "w:b");
  removeProp(rPr, "w:bCs");
  setProp(doc, rPr, prop(doc, "w:i"));
  setProp(doc, rPr, prop(doc, "w:iCs"));
  last.parentNode.insertBefore(run, last.nextSibling);
}

function removeColumn(table, column) {
  const grid = kids(table, "w:tblGrid")[0];
  const cols = kids(grid, "w:gridCol");
  const width = Number(cols[column].getAttribute("w:w")) || 0;
  remove(cols[column]);
  kids(table, "w:tr").forEach((row) => remove(kids(row, "w:tc")[column]));
  const tblPr = kids(table, "w:tblPr")[0];
  const tblW = tblPr && kids(tblPr, "w:tblW")[0];
  if (tblW && tblW.getAttribute("w:type") === "dxa") tblW.setAttributeNS(W, "w:w", String(Number(tblW.getAttribute("w:w")) - width));
}

function fillCards(doc, table, d, t) {
  const rows = kids(table, "w:tr");
  const cell = (r, c) => kids(rows[r], "w:tc")[c];
  // The template's column 3 is styled as selected and column 1 as not selected.
  const source = rows.map((_, r) => ({
    selColor: firstColor(cell(r, 2)),
    selShade: shadingOf(cell(r, 2)),
    unColor: firstColor(cell(r === 9 ? 8 : r, 0)),
    unShade: shadingOf(cell(r, 0)),
  }));
  ["E", "S", "C"].forEach((k) => {
    const tier = d.tiers[k] || {};
    replaceAll(doc, `{{${k}_DOCS}}`, `${Math.round(toNum(tier.docs)).toLocaleString("en-US")} documents / year`);
    replaceAll(doc, `{{${k}_ENTITY}}`, tier.entity || "");
    replaceAll(doc, `{{${k}_LEGAL}}`, tier.legal || "");
    replaceAll(doc, `{{${k}_MONTH}}`, money(t.tierMonth[k]));
    replaceAll(doc, `{{${k}_YEAR}}`, money(toNum(tier.year)));
  });
  const keys = ["E", "S", "C"];
  const sel = keys.indexOf(TIERS[d.selected]);
  rows.forEach((_, r) => {
    keys.forEach((_k, c) => {
      const s = source[r];
      styleCell(doc, cell(r, c), c === sel ? { selected: true, color: s.selColor, shade: s.selShade } : { selected: false, color: s.unColor, shade: s.unShade });
    });
  });
  addSelectedLabel(doc, cell(0, sel));
  for (let c = 2; c >= 0; c -= 1) {
    const tier = d.tiers[keys[c]] || {};
    if (c !== sel && toNum(tier.docs) <= 0 && toNum(tier.year) <= 0) removeColumn(table, c);
  }
}

function fillPricing(doc, table, d, t) {
  const rows = kids(table, "w:tr");
  ROW_KEYS.forEach((key, k) => {
    const row = rows[k + 1];
    const r = t.rows[key];
    const fee = feeLabel(r.fee, r.type);
    if (!(r.inc && String(r.title || "").trim() && fee)) { remove(row); return; }
    replaceAll(doc, `{{${key}_TITLE}}`, r.title);
    if (!["ONB", "SUP", "FULL"].includes(key)) replaceAll(doc, `{{${key}_DESC}}`, r.desc || "");
    const cell = kids(row, "w:tc")[2];
    if (fee === "Included") setFee(doc, cell, 0, fee, "");
    else setFee(doc, cell, toNum(r.old), fee, r.note || "");
  });
}

function fillCustom(doc, table, t) {
  const rows = kids(table, "w:tr");
  rows.slice(1, 4).forEach(remove); // these hold the long standard wording
  const plain = rows.slice(4, -1);
  const items = t.items.filter((i) => String(i.title || "").trim() && feeLabel(i.fee, i.type)).slice(0, plain.length);
  items.forEach((item, n) => {
    const cells = kids(plain[n], "w:tc");
    const fee = feeLabel(item.fee, item.type);
    setCellText(cells[0], item.title);
    setCellText(cells[1], item.desc || "");
    setFee(doc, cells[2], 0, fee, fee === "Included" ? "" : item.note || "");
  });
  plain.slice(items.length).forEach(remove);
}

function setExclusions(doc, pricing) {
  const covered = textOf(pricing).toLowerCase();
  const extra = EXCLUSIONS.filter(([, words]) => !words.some((w) => covered.includes(w))).map(([label]) => label);
  const paragraph = tags(doc, "w:p").find((p) => textOf(p).toLowerCase().includes("requested by the client will be") && !up(p, "w:tc"));
  if (!paragraph) return;
  const lead = extra.length
    ? `Any ${extra.join(", ")}, or other requirements or services requested by the client that are not listed in the table above, will be `
    : "Any requirements or services requested by the client that are not listed in the table above will be ";
  const whole = `${lead}${QUOTED}. Such charges will be communicated and agreed upon with the client prior to proceeding with any additional services.`;
  const bold = [...extra, QUOTED];
  const pieces = [];
  let at = 0;
  while (at < whole.length) {
    const hits = bold.map((b) => [whole.indexOf(b, at), b]).filter(([i]) => i >= 0).sort((a, b) => a[0] - b[0]);
    if (!hits.length) { pieces.push([whole.slice(at), false]); break; }
    const [i, word] = hits[0];
    if (i > at) pieces.push([whole.slice(at, i), false]);
    pieces.push([word, true]);
    at = i + word.length;
  }
  const runs = kids(paragraph, "w:r");
  const model = runs.find((r) => !tags(r, "w:b").length && tags(r, "w:t").length) || runs[0];
  const proto = model.cloneNode(true);
  runs.forEach(remove);
  for (const [text, isBold] of pieces) {
    const run = proto.cloneNode(true);
    setText(tags(run, "w:t")[0], text);
    const rPr = rPrOf(doc, run);
    removeProp(rPr, "w:b");
    if (isBold) setProp(doc, rPr, prop(doc, "w:b"));
    paragraph.appendChild(run);
  }
  const pPr = kids(paragraph, "w:pPr")[0];
  if (pPr && !kids(pPr, "w:keepLines").length) {
    const after = kids(pPr).filter((c) => ["w:pStyle", "w:keepNext"].includes(c.nodeName)).pop();
    pPr.insertBefore(doc.createElementNS(W, "w:keepLines"), after ? after.nextSibling : pPr.firstChild);
  }
}

const withDeclaration = (xml) => (xml.startsWith("<?xml") ? xml : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${xml}`);
const attr = (s) => clean(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function fillDocx(templateBytes, d, t, reference, deps) {
  const zip = await deps.JSZip.loadAsync(templateBytes);
  const doc = deps.parse(await zip.file("word/document.xml").async("string"));
  const c = d.client || {};
  const email = String(c.email || "").trim();

  replaceAll(doc, "{{CLIENT_NAME_LETTER}}", c.letterName || c.legal);
  replaceAll(doc, "{{CLIENT_NAME}}", c.legal);
  fillOrDrop(doc, "{{POC_PHONE}}", c.phone);
  fillOrDrop(doc, "{{POC_EMAIL}}", email);
  fillOrDrop(doc, "{{POC}}", [c.poc, c.pocDesig].filter(Boolean).join(", "));
  fillOrDrop(doc, "{{ADDRESS}}", String(c.address || "").replace(/\r?\n|\r/g, ", "));
  replaceAll(doc, "{{CITY}}", c.city || "Dubai");
  replaceAll(doc, "{{REF}}", reference);
  replaceAll(doc, "{{DATE}}", dmy(d.date) || dmy(dubaiToday()));
  replaceAll(doc, "{{ERP}}", c.erp || "Ardentax web application");
  replaceAll(doc, "{{SIGNATORY_NAME}}", c.signName || "");
  replaceAll(doc, "{{SIGNATORY_DESIGNATION}}", c.signDesig || "");
  if (t.overage > 0) {
    replaceAll(doc, "{{VOLUME}}", Math.round(t.volume).toLocaleString("en-US"));
    const fils = Math.round(t.overage * 10000) / 100;
    replaceAll(doc, "{{OVERAGE}}", t.overage < 1 ? `${money(t.overage)} (${money(fils)} fils)` : money(t.overage));
  } else {
    dropParagraphs(doc, "{{OVERAGE}}");
  }
  replaceAll(doc, "{{BUYOUT}}", String(d.options?.buyout ?? ""));

  // The template's link still holds a past client's address in its tooltip.
  for (const link of tags(doc, "w:hyperlink")) if ((link.getAttribute("w:tooltip") || "").startsWith("mailto:")) link.setAttributeNS(W, "w:tooltip", `mailto:${email}`);
  const relsPath = "word/_rels/document.xml.rels";
  const rels = await zip.file(relsPath).async("string");
  zip.file(relsPath, rels.replace(/Target="mailto:[^"]*"/g, `Target="mailto:${attr(email)}"`));

  const all = tags(doc, "w:tbl");
  const cards = all[1];
  const pricing = all[2];
  if (t.custom) {
    replaceAll(doc, "Every plan is UAE FTA compliant", "The service is UAE FTA compliant");
    remove(cards);
    fillCustom(doc, pricing, t);
  } else {
    fillCards(doc, cards, d, t);
    fillPricing(doc, pricing, d, t);
  }
  replaceAll(doc, "{{TOTAL_DESC}}", t.totalDesc);
  replaceAll(doc, "{{TOTAL}}", t.totalText);
  fillOrDrop(doc, "{{ONE_TIME_NOTE}}", t.oneTimeNote);
  setExclusions(doc, pricing);

  const left = [...new Set(tags(doc, "w:t").flatMap((x) => x.textContent.match(/\{\{[^}]*\}\}/g) || []))];
  if (left.length) throw new Error(`Template fields not filled: ${left.join(", ")}`);

  zip.file("word/document.xml", withDeclaration(deps.serialize(doc)));

  const core = deps.parse(await zip.file("docProps/core.xml").async("string"));
  const setCore = (name, value) => { const el = tags(core, name)[0]; if (el) el.textContent = clean(value); };
  setCore("dc:creator", COMPANY);
  setCore("cp:lastModifiedBy", COMPANY);
  setCore("dc:title", `Ardentax E-Invoicing Proposal – ${c.legal}`);
  setCore("dc:description", "");
  zip.file("docProps/core.xml", withDeclaration(deps.serialize(core)));

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
