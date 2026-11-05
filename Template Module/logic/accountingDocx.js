// Fills the Accounting quote and agreement Word templates. Pure apart from the libraries passed in, so it is tested in Node.
// deps = { PizZip, Docxtemplater }. signature = { bytes, type, width, height } | null (width and height in pixels).
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const IMAGE_TYPES = { png: ["png", "image/png"], jpg: ["jpg", "image/jpeg"], jpeg: ["jpeg", "image/jpeg"] };
const REL_ID = "rIdAccountingSignature";
const MAX_W = 2011680; // 2.2 in, in EMU
const MAX_H = 822960; // 0.9 in

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

// Inline picture, scaled to fit the box and keeping the image's own proportions.
export function signatureXml(sig) {
  const scale = Math.min(MAX_W / sig.width, MAX_H / sig.height);
  const cx = Math.round(sig.width * scale);
  const cy = Math.round(sig.height * scale);
  return (
    `<w:p><w:pPr><w:spacing w:before="120" w:after="0"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="9001" name="Approved signature"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="9001" name="signature"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${REL_ID}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
  );
}

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

  if (wantsImage) {
    const file = `signature.${image[0]}`;
    out.file(`word/media/${file}`, signature.bytes);
    const relsPath = "word/_rels/document.xml.rels";
    out.file(relsPath, out.file(relsPath).asText().replace("</Relationships>", `<Relationship Id="${REL_ID}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${file}"/></Relationships>`));
    const ctPath = "[Content_Types].xml";
    let ct = out.file(ctPath).asText();
    if (!new RegExp(`Extension="${image[0]}"`, "i").test(ct)) ct = ct.replace("<Default ", `<Default Extension="${image[0]}" ContentType="${image[1]}"/><Default `);
    out.file(ctPath, ct);
  }
  return out.generate({ type: "blob", mimeType: DOCX });
}
