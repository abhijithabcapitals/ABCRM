// node --test "Template Module/ardentax/tests/"
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { computeQuote, defaultDetails } from "../logic/quoteModel.js";
import { fillDocx } from "../logic/fillDocx.js";

const require = createRequire(new URL("../../../Main Module/package.json", import.meta.url));
const JSZip = require("jszip");
const { DOMParser, XMLSerializer } = require("@xmldom/xmldom");
const deps = { JSZip, parse: (s) => new DOMParser().parseFromString(s, "application/xml"), serialize: (d) => new XMLSerializer().serializeToString(d) };

const templateBytes = (name) => readFileSync(new URL(`../templates/${name}`, import.meta.url));
const QUOTE = "Ardentax_QUOTATION_TEMPLATE.docx";
const LETTER = "Ardentax_ENGAGEMENT_LETTER_TEMPLATE.docx";
const REF = "Ardentax/2026/11/ADTQ001";

function details(edit = () => {}) {
  const d = defaultDetails("2026-11-05");
  Object.assign(d.client, { legal: "Sample Trading LLC", poc: "Pat Doe", pocDesig: "Manager", phone: "+971500000000", email: "pat@sample.example", city: "Dubai", address: "Office 1, Sample Tower", erp: "Odoo" });
  d.selected = "Established";
  Object.assign(d.tiers.E, { docs: 500, year: 1499 });
  Object.assign(d.tiers.S, { docs: 3600, year: 4199 });
  Object.assign(d.tiers.C, { docs: 10000, year: 7500 });
  d.rows.ONB.fee = 1500;
  edit(d);
  return d;
}

async function fill(d, name = QUOTE) {
  const out = await fillDocx(templateBytes(name), d, computeQuote(d), REF, deps);
  const zip = await JSZip.loadAsync(out);
  const xml = await zip.file("word/document.xml").async("string");
  return { zip, xml, doc: deps.parse(xml), bytes: out };
}

const list = (nodeList) => { const a = []; for (let i = 0; i < nodeList.length; i += 1) a.push(nodeList.item(i)); return a; };
const tag = (el, name) => list(el.getElementsByTagName(name));
const textOf = (el) => tag(el, "w:t").map((t) => t.textContent).join("");
const tables = (doc) => tag(doc, "w:tbl");
const rowsOf = (tbl) => tag(tbl, "w:tr");
const cellsOf = (row) => tag(row, "w:tc");
const direct = (el, name) => list(el.childNodes).filter((c) => c.nodeName === name);
const runProp = (cell, name) => tag(cell, "w:r").filter((r) => textOf(r).trim()).map((r) => tag(r, name).length > 0);
const colorOf = (cell) => { const r = tag(cell, "w:r").find((x) => textOf(x).trim()); const c = r && tag(r, "w:color")[0]; return c ? c.getAttribute("w:val") : null; };

for (const name of [QUOTE, LETTER]) {
  test(`${name}: every placeholder sits in one text run`, async () => {
    const zip = await JSZip.loadAsync(templateBytes(name));
    const doc = deps.parse(await zip.file("word/document.xml").async("string"));
    const paragraphs = tag(doc, "w:p");
    for (const p of paragraphs) {
      const joined = (textOf(p).match(/\{\{[A-Z0-9_]+\}\}/g) || []).length;
      const inRuns = tag(p, "w:t").reduce((n, t) => n + (t.textContent.match(/\{\{[A-Z0-9_]+\}\}/g) || []).length, 0);
      assert.equal(inRuns, joined);
    }
  });

  test(`${name}: nothing left unfilled, reference written`, async () => {
    const { xml, doc } = await fill(details(), name);
    assert.ok(!textOf(doc).includes("{{"));
    assert.ok(xml.includes(REF));
    assert.ok(textOf(doc).includes("Sample Trading LLC"));
  });

  test(`${name}: special characters stay valid`, async () => {
    const client = `Sample & <Trading> "LLC" شركة`;
    const { doc } = await fill(details((d) => { d.client.legal = client; }), name);
    assert.ok(textOf(doc).includes(client));
  });

  test(`${name}: images and header are untouched`, async () => {
    const before = await JSZip.loadAsync(templateBytes(name));
    const { zip } = await fill(details(), name);
    for (const part of ["word/header1.xml", "word/media/image1.png", "word/media/image2.png"]) {
      assert.deepEqual(await zip.file(part).async("uint8array"), await before.file(part).async("uint8array"), part);
    }
  });
}

test("blank contact lines drop out", async () => {
  const { doc } = await fill(details((d) => { Object.assign(d.client, { poc: "", pocDesig: "", phone: "", email: "", address: "" }); }));
  const t = textOf(doc);
  for (const gone of ["POC:", "Phone Number:", "Email:", "Address:"]) assert.ok(!t.includes(gone), gone);
});

test("poc line carries the designation", async () => {
  const { doc } = await fill(details());
  assert.ok(textOf(doc).includes("POC: Pat Doe, Manager"));
});

test("blank city and ERP use the macro's defaults", async () => {
  const { doc } = await fill(details((d) => { d.client.city = ""; d.client.erp = ""; }));
  const t = textOf(doc);
  assert.ok(t.includes("Dubai, UAE"));
  assert.ok(t.includes("Ardentax web application"));
});

test("zero overage drops its sentence, small overage shows fils", async () => {
  const none = await fill(details((d) => { d.options.overage = 0; }));
  assert.ok(!textOf(none.doc).includes("per additional invoice"));
  const small = await fill(details((d) => { d.options.overage = 0.25; }));
  assert.ok(textOf(small.doc).includes("AED 0.25 (25 fils) per additional invoice"));
});

test("blank one-time note drops its paragraph, a note is written", async () => {
  const none = await fill(details());
  assert.ok(!textOf(none.doc).includes("one-time fees"));
  const typed = await fill(details((d) => { d.options.oneTimeNote = "A typed note."; }));
  assert.ok(textOf(typed.doc).includes("A typed note."));
});

test("selected card is highlighted, the others struck, with the template's own colours", async () => {
  const template = deps.parse(await (await JSZip.loadAsync(templateBytes(QUOTE))).file("word/document.xml").async("string"));
  const tplRows = rowsOf(tables(template)[1]);
  const { doc } = await fill(details((d) => { d.selected = "Emerging"; }));
  const cards = rowsOf(tables(doc)[1]);
  assert.equal(cards.length, 12);
  const selected = cellsOf(cards[1])[0];
  const other = cellsOf(cards[1])[2];
  assert.ok(runProp(selected, "w:strike").every((x) => !x));
  assert.ok(runProp(selected, "w:highlight").every(Boolean));
  assert.ok(runProp(other, "w:strike").every(Boolean));
  assert.ok(runProp(other, "w:highlight").every((x) => !x));
  assert.ok(runProp(selected, "w:strike").length > 0);
  assert.equal(colorOf(selected), colorOf(cellsOf(tplRows[1])[2]));
  assert.equal(colorOf(other), colorOf(cellsOf(tplRows[1])[0]));
  // The template's selected column has no colour on this row, so the selected card must not keep the grey.
  assert.equal(tag(cellsOf(cards[2])[0], "w:color").length, 0);
  assert.ok(textOf(cellsOf(cards[0])[0]).includes("(Most Popular & Selected Package)"));
  assert.ok(!textOf(cellsOf(cards[0])[1]).includes("Most Popular"));
  assert.ok(textOf(cellsOf(cards[1])[1]).includes("3,600 documents / year"));
});

test("selected label is italic and not bold, and rPr children stay in schema order", async () => {
  const { doc } = await fill(details());
  const cell = cellsOf(rowsOf(tables(doc)[1])[0])[1];
  const label = tag(cell, "w:r").find((r) => textOf(r).includes("Most Popular"));
  assert.equal(tag(label, "w:i").length, 1);
  assert.equal(tag(label, "w:b").length, 0);
  const order = ["w:rStyle", "w:rFonts", "w:b", "w:bCs", "w:i", "w:iCs", "w:caps", "w:smallCaps", "w:strike", "w:dstrike", "w:outline", "w:shadow", "w:emboss", "w:imprint", "w:noProof", "w:snapToGrid", "w:vanish", "w:webHidden", "w:color", "w:spacing", "w:w", "w:kern", "w:position", "w:sz", "w:szCs", "w:highlight", "w:u", "w:effect", "w:bdr", "w:shd", "w:fitText", "w:vertAlign", "w:rtl", "w:cs", "w:em", "w:lang"];
  for (const rPr of tag(tables(doc)[1], "w:rPr")) {
    const idx = direct(rPr, "*").length ? [] : list(rPr.childNodes).filter((c) => c.nodeType === 1).map((c) => order.indexOf(c.nodeName)).filter((n) => n >= 0);
    assert.deepEqual(idx, [...idx].sort((a, b) => a - b));
  }
});

test("a card with no documents and no price loses its column", async () => {
  const { doc } = await fill(details((d) => { d.tiers.E = { entity: "", docs: "", year: "", month: "", legal: "" }; }));
  const tbl = tables(doc)[1];
  for (const row of rowsOf(tbl)) assert.equal(cellsOf(row).length, 2);
  assert.equal(tag(direct(tbl, "w:tblGrid")[0], "w:gridCol").length, 2);
  assert.ok(!textOf(tbl).includes("Newer and smaller"));
});

test("pricing keeps only included rows, with Total last", async () => {
  const { doc } = await fill(details((d) => {
    d.rows.GAP.inc = true; d.rows.GAP.fee = 3000;
    d.rows.CMP.inc = true;
    d.rows.X1.inc = true; // no fee, so left out
  }));
  const rows = rowsOf(tables(doc)[2]);
  assert.deepEqual(rows.map((r) => textOf(cellsOf(r)[0])), ["Service Component", "Onboarding & Setup", "E-Invoicing Gap Assessment", "Annual E-Invoicing Package (Renewed Annually)", "Complementary Scope", "Total"]);
  assert.equal(textOf(cellsOf(rows[4])[2]), "Included");
  assert.equal(textOf(cellsOf(rows[5])[2]), "8,699 AED");
});

test("old price is struck through above the fee and its note", async () => {
  const { doc } = await fill(details((d) => { d.rows.ONB.old = 2500; }));
  const fee = cellsOf(rowsOf(tables(doc)[2])[1])[2];
  const paras = tag(fee, "w:p");
  assert.deepEqual(paras.map(textOf), ["2,500 AED", "1,500 AED", "(One-Time)"]);
  assert.equal(tag(paras[0], "w:strike").length > 0, true);
  assert.equal(tag(paras[1], "w:strike").length, 0);
});

test("custom quote drops the cards and long rows, and writes the items", async () => {
  const { doc } = await fill(details((d) => {
    d.quoteType = "Custom";
    d.custom.volume = 48000;
    d.custom.items[1].fee = 2000;
    d.custom.items[2].fee = 0.25;
    d.custom.items[3].fee = 12000;
  }));
  const t = textOf(doc);
  assert.ok(t.includes("The service is UAE FTA compliant"));
  assert.ok(!t.includes("Every plan is"));
  assert.ok(!t.includes("Newer and smaller"));
  const pricing = tables(doc).find((x) => textOf(x).includes("Service Component"));
  const rows = rowsOf(pricing);
  assert.deepEqual(rows.map((r) => textOf(cellsOf(r)[0])), ["Service Component", "Training and Demo", "E-Invoicing Gap Assessment", "Additional Invoices", "Scope", "Total"]);
  assert.equal(textOf(cellsOf(rows[1])[2]), "Free(One-Time)");
  assert.ok(textOf(cellsOf(rows[3])[1]).includes("48,000"));
  assert.equal(textOf(cellsOf(rows[5])[2]), "14,000 AED");
  assert.ok(t.includes("AED 0.25 (25 fils) per additional invoice"));
});

test("custom quote takes at most 7 items", async () => {
  const { doc } = await fill(details((d) => {
    d.quoteType = "Custom";
    d.custom.volume = 1000;
    d.custom.items = Array.from({ length: 9 }, (_, i) => ({ title: `Item ${i + 1}`, desc: "x", fee: 100, note: "", type: "One-time" }));
  }));
  const pricing = tables(doc).find((x) => textOf(x).includes("Service Component"));
  assert.equal(rowsOf(pricing).length, 9);
  assert.ok(!textOf(pricing).includes("Item 8"));
});

test("exclusions list what the table does not cover, in bold", async () => {
  const { doc } = await fill(details());
  const p = tag(doc, "w:p").find((x) => textOf(x).includes("not listed in the table above"));
  assert.ok(p);
  const t = textOf(p);
  assert.ok(t.startsWith("Any Annual Maintenance Charges (AMC), ERP integration, e-invoicing gap assessment, user training, custom development, or other requirements"));
  assert.ok(!t.includes("onboarding and setup"));
  assert.ok(t.includes("quoted separately based on the actual requirements and prevailing charges at the time of request"));
  const bold = tag(p, "w:r").filter((r) => tag(r, "w:b").length).map(textOf);
  assert.ok(bold.includes("ERP integration"));
  assert.ok(bold.includes("quoted separately based on the actual requirements and prevailing charges at the time of request"));
  assert.equal(tag(p, "w:keepLines").length, 1);
});

test("exclusions with everything covered use the short wording", async () => {
  const { doc } = await fill(details((d) => {
    for (const [k, title] of [["FULL", null], ["GAP", null], ["X1", null], ["X2", null]]) { d.rows[k].inc = true; d.rows[k].fee = 100; if (title) d.rows[k].title = title; }
    d.rows.CMP.inc = true;
    d.rows.CMP.desc = "Custom development and onboarding";
  }));
  const p = tag(doc, "w:p").find((x) => textOf(x).includes("not listed in the table above"));
  assert.ok(textOf(p).startsWith("Any requirements or services requested by the client that are not listed in the table above will be quoted"));
});

test("mail link follows the POC email", async () => {
  const { zip } = await fill(details());
  const rels = await zip.file("word/_rels/document.xml.rels").async("string");
  assert.ok(rels.includes("mailto:pat@sample.example"));
  const xml = await zip.file("word/document.xml").async("string");
  assert.ok(!(rels + xml).includes("maktechnology"), "no past client's address is left behind");
});

test("file properties name Ardentax, with no comments", async () => {
  const { zip } = await fill(details());
  const core = deps.parse(await zip.file("docProps/core.xml").async("string"));
  assert.equal(tag(core, "dc:creator")[0].textContent, "Ardentax IT Solutions – FZCO");
  assert.equal(tag(core, "dc:title")[0].textContent, "Ardentax E-Invoicing Proposal – Sample Trading LLC");
  const desc = tag(core, "dc:description")[0];
  assert.equal(desc ? desc.textContent : "", "");
  const all = await zip.file("docProps/core.xml").async("string");
  assert.ok(!/claude|anthropic|\bAI\b/i.test(all));
});

test("a placeholder that cannot be filled stops the document", async () => {
  const zip = await JSZip.loadAsync(templateBytes(QUOTE));
  const x = await zip.file("word/document.xml").async("string");
  zip.file("word/document.xml", x.replace("Dear Sir/Madam", "Dear {{UNKNOWN_FIELD}}"));
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const d = details();
  await assert.rejects(fillDocx(bytes, d, computeQuote(d), REF, deps), /Template fields not filled: \{\{UNKNOWN_FIELD\}\}/);
});

test("a control character in pasted text does not corrupt the Word file", async () => {
  const { doc, xml, zip } = await fill(details((d) => { d.client.legal = "Sample\x0B Trading\x01 LLC"; }));
  assert.ok(textOf(doc).includes("Sample Trading LLC"));
  assert.ok(!/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(xml));
  assert.ok(!/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(await zip.file("docProps/core.xml").async("string")));
});

test("a cleared date prints today, as in the macro", async () => {
  const { doc } = await fill(details((d) => { d.date = ""; }));
  const [y, m, day] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date()).split("-");
  assert.ok(textOf(doc).includes(`[${day}/${m}/${y}]`));
});

for (const name of [QUOTE, LETTER]) {
  test(`${name}: the file served to browsers holds no past client's address`, async () => {
    const zip = await JSZip.loadAsync(templateBytes(name));
    for (const part of Object.keys(zip.files)) {
      if (/\.(xml|rels)$/.test(part)) assert.ok(!(await zip.file(part).async("string")).includes("maktechnology"), part);
    }
  });
}

// ---- Company signature (shared signing step) ----
// Invented image bytes; the real Ardentax image is set in Settings > Signing.
const SIG = { bytes: new Uint8Array([137, 80, 78, 71, 1, 2, 3]), type: "png", width: 300, height: 120 };
const signedFill = async (d, name, signature) => {
  const out = await fillDocx(templateBytes(name), d, computeQuote(d), REF, deps, signature);
  const zip = await JSZip.loadAsync(out);
  const xml = await zip.file("word/document.xml").async("string");
  return { zip, xml, doc: deps.parse(xml) };
};
// The Ardentax cell of the signatory table: the first cell with a "Signature:" line (the client's is the second).
const ardentaxCell = (doc) => tag(doc, "w:tc").filter((c) => textOf(c).includes("Signature:"))[0];
const kidsOf = (el, name) => list(el.childNodes).filter((c) => c.nodeType === 1 && c.nodeName === name);

for (const name of [QUOTE, LETTER]) {
  test(`${name}: the template holds the signature tag in the Ardentax cell, above its Signature line`, async () => {
    const zip = await JSZip.loadAsync(templateBytes(name));
    const doc = deps.parse(await zip.file("word/document.xml").async("string"));
    const tagged = tag(doc, "w:p").filter((p) => textOf(p) === "{{SIGNATURE}}");
    assert.equal(tagged.length, 1);
    const cell = tagged[0].parentNode;
    assert.equal(cell.nodeName, "w:tc");
    const paras = kidsOf(cell, "w:p");
    assert.equal(textOf(paras[paras.indexOf(tagged[0]) + 1]), "Signature: ____________________");
    assert.equal(kidsOf(cell.parentNode, "w:tc")[0], cell, "the left cell: Ardentax's side, not the client's");
  });

  test(`${name}: unsigned, the signature line is blank and there is no image`, async () => {
    const { zip, xml, doc } = await signedFill(details(), name, null);
    assert.ok(!xml.includes("{{SIGNATURE}}"));
    assert.ok(!xml.includes("rIdAccountingSignature"));
    assert.equal(zip.file("word/media/signature.png"), null);
    const paras = kidsOf(ardentaxCell(doc), "w:p");
    const line = paras.findIndex((p) => textOf(p).startsWith("Signature:"));
    assert.equal(textOf(paras[line - 1]), "", "a blank line where the signature goes");
    assert.equal(tag(ardentaxCell(doc), "w:drawing").length, 0);
  });

  test(`${name}: signed, the image sits in the Ardentax cell with its relationship and content type`, async () => {
    const { zip, xml, doc } = await signedFill(details(), name, SIG);
    assert.ok(!xml.includes("{{SIGNATURE}}"));
    const cell = ardentaxCell(doc);
    assert.equal(tag(cell, "w:drawing").length, 1);
    assert.equal((xml.match(/r:embed="rIdAccountingSignature"/g) || []).length, 1);
    assert.deepEqual([...(await zip.file("word/media/signature.png").async("uint8array"))], [...SIG.bytes]);
    const rels = await zip.file("word/_rels/document.xml.rels").async("string");
    assert.ok(rels.includes('Id="rIdAccountingSignature"') && rels.includes('Target="media/signature.png"'));
    assert.ok(rels.includes("mailto:pat@sample.example"), "the mail link fix is kept");
    assert.match(await zip.file("[Content_Types].xml").async("string"), /Extension="png"/i);
    assert.equal(tag(kidsOf(cell.parentNode, "w:tc")[1], "w:drawing").length, 0, "the client's side stays empty");
  });
}

test("a template without the signature tag refuses a signature, and still fills unsigned", async () => {
  const zip = await JSZip.loadAsync(templateBytes(QUOTE));
  const x = await zip.file("word/document.xml").async("string");
  zip.file("word/document.xml", x.replace("{{SIGNATURE}}", ""));
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const d = details();
  await assert.rejects(fillDocx(bytes, d, computeQuote(d), REF, deps, SIG), /no place for the signature/);
  await fillDocx(bytes, d, computeQuote(d), REF, deps, null);
});
