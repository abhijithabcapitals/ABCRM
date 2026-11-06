// Shared by every document family: the signature picture inside a Word file. Pure apart from the zip passed in (a PizZip).
// signature = { bytes, type, width, height } (width and height in pixels).
export const IMAGE_TYPES = { png: ["png", "image/png"], jpg: ["jpg", "image/jpeg"], jpeg: ["jpeg", "image/jpeg"] };
export const REL_ID = "rIdAccountingSignature";
const MAX_W = 2011680; // 2.2 in, in EMU
const MAX_H = 822960; // 0.9 in

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

// Adds the picture file, its relationship and its content type to the zip. xmlBefore (the document xml before the picture tag is filled) is not needed: the tag is placed by the template.
export function addSignature(zip, xmlBefore, signature) {
  const image = IMAGE_TYPES[String(signature.type || "").toLowerCase()];
  const file = `signature.${image[0]}`;
  zip.file(`word/media/${file}`, signature.bytes);
  const relsPath = "word/_rels/document.xml.rels";
  zip.file(relsPath, zip.file(relsPath).asText().replace("</Relationships>", `<Relationship Id="${REL_ID}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${file}"/></Relationships>`));
  const ctPath = "[Content_Types].xml";
  let ct = zip.file(ctPath).asText();
  if (!new RegExp(`Extension="${image[0]}"`, "i").test(ct)) ct = ct.replace("<Default ", `<Default Extension="${image[0]}" ContentType="${image[1]}"/><Default `);
  zip.file(ctPath, ct);
  return zip;
}
