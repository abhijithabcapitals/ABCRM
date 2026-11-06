// Adds the company signature place to both Ardentax Word templates, in place. The templates have no builder (they came from
// D:\Abhijith Projects\Quote Generator), so this edits their XML once and the result is committed; re-running changes nothing.
//   node "Template Module/ardentax/scripts/add_signature_tag.mjs"
// The tag {{SIGNATURE}} is its own paragraph in the Ardentax (left) cell of the signatory table, just above "Signature: ____".
// fillDocx leaves it as a blank line when unsigned and puts the signature picture there when an approver signs (signing.js).
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";

const require = createRequire(new URL("../../../Main Module/package.json", import.meta.url));
const JSZip = require("jszip");
const TAG = "{{SIGNATURE}}";
const LINE = "<w:t>Signature: ____________________</w:t>";
const FILES = ["Ardentax_QUOTATION_TEMPLATE.docx", "Ardentax_ENGAGEMENT_LETTER_TEMPLATE.docx"];

// The paragraph that holds index i: from the last <w:p> or <w:p ...> before it to the next </w:p>.
function paragraphAt(xml, i) {
  const start = Math.max(xml.lastIndexOf("<w:p>", i), xml.lastIndexOf("<w:p ", i));
  const end = xml.indexOf("</w:p>", i) + "</w:p>".length;
  if (start < 0 || end < i) throw new Error("No paragraph around the Signature line");
  return [start, end];
}

export function addTag(xml) {
  if (xml.includes(TAG)) return xml;
  const at = xml.indexOf(LINE); // the first one is the Ardentax cell; the client's comes after it
  if (at < 0) throw new Error("The Signature line was not found");
  const [start, end] = paragraphAt(xml, at);
  // Same paragraph and run style, the tag as its text, without Word's paragraph ids (they must stay unique).
  const copy = xml.slice(start, end).replace(LINE, `<w:t>${TAG}</w:t>`).replace(/ w14:(paraId|textId)="[^"]*"/g, "");
  return xml.slice(0, start) + copy + xml.slice(start);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  for (const name of FILES) {
    const path = new URL(`../templates/${name}`, import.meta.url);
    const zip = await JSZip.loadAsync(readFileSync(path));
    const xml = await zip.file("word/document.xml").async("string");
    const next = addTag(xml);
    if (next === xml) { console.log(`${name}: already has the signature tag`); continue; }
    zip.file("word/document.xml", next);
    writeFileSync(path, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
    console.log(`${name}: signature tag added`);
  }
}
