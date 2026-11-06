// Fills the Accounting quote and agreement Word templates. Pure apart from the libraries passed in, so it is tested in Node.
// deps = { PizZip, Docxtemplater }. signature = { bytes, type, width, height } | null (width and height in pixels).
import { IMAGE_TYPES, signatureXml, addSignature } from "./signDocx.js";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// A raw tag replaces its whole paragraph, so both values are paragraphs. The break paragraph is one pixel tall: no blank line at the top of the next page.
const PAGE_BREAK = '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr><w:r><w:br w:type="page"/></w:r></w:p>';

// Dotted tags such as {bank.iban}, and {.} for the current item, with lookup in the outer scopes.
const parser = (tag) => {
  const name = tag.trim();
  const path = name.split(".");
  return {
    get(scope, context) {
      if (name === ".") return scope;
      let base = scope;
      if (base == null || base[path[0]] === undefined) {
        const list = context?.scopeList || [];
        for (let i = list.length - 1; i >= 0; i--) if (list[i] != null && list[i][path[0]] !== undefined) { base = list[i]; break; }
      }
      return path.reduce((o, k) => (o == null ? undefined : o[k]), base);
    },
  };
};

export async function renderAccountingDoc(templateBuffer, context, signature, deps) {
  const { PizZip, Docxtemplater } = deps;
  const wantsImage = !!context?.has_signature;
  if (wantsImage && !(signature?.bytes?.length > 0 && signature.width > 0 && signature.height > 0)) throw new Error("Signature image is missing");
  const image = wantsImage ? IMAGE_TYPES[String(signature.type || "").toLowerCase()] : null;
  if (wantsImage && !image) throw new Error("Signature image type must be png or jpg");

  const zip = new PizZip(templateBuffer);
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, parser, nullGetter: () => "" });
  const options = Array.isArray(context.options) ? context.options.map((o) => ({ ...o, page_break: o.new_page ? PAGE_BREAK : "" })) : undefined;
  doc.render({ ...context, ...(options ? { options } : {}), signature_xml: wantsImage ? signatureXml(signature) : "", page_break: "" });
  const out = doc.getZip();

  if (wantsImage) addSignature(out, null, signature);
  return out.generate({ type: "blob", mimeType: DOCX });
}
