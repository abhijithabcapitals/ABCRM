// Fills the Business Formation Proposal Word template. docxtemplater's free version has no image module,
// so logos and timelines go in as raw XML tags and this file adds the media files, relationships and content types.
// deps = { PizZip, Docxtemplater } is passed in so this stays testable outside the browser.
const EMU = 914400;
const LOGO_BOX = { w: 2.2, h: 1.0 };       // inches
const TIMELINE_BOX = { w: 7.2, h: 5.0 };
const MIME = { png: "image/png", jpeg: "image/jpeg" };
const REL_IMAGE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";

const PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

// Scales a picture to fit the box, never up past its pixel size at 96 dpi, keeping the aspect ratio.
export function fitEmu(width, height, box) {
  const w = Number(width), h = Number(height);
  if (!(w > 0) || !(h > 0)) return null;
  const scale = Math.min(box.w * 96 / w, box.h * 96 / h, 1);
  return { cx: Math.round(w * scale * EMU / 96), cy: Math.round(h * scale * EMU / 96) };
}

function drawingParagraph(rid, docPrId, name, size) {
  return `<w:p><w:pPr><w:spacing w:before="60" w:after="60"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${size.cx}" cy="${size.cy}"/><wp:docPr id="${docPrId}" name="${name}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${docPrId}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${size.cx}" cy="${size.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

export async function renderProposal(templateBuffer, context, images, deps) {
  const { PizZip, Docxtemplater } = deps;
  const known = images || {};
  const media = new Map();   // token -> { rid, file, type, bytes }
  let drawingId = 1000;

  // A token with no matching image gives an empty value and no relationship.
  const imageXml = (token, box, label) => {
    const img = token ? known[token] : null;
    if (!img || !img.bytes || !MIME[img.type]) return "";
    const size = fitEmu(img.width, img.height, box);
    if (!size) return "";
    if (!media.has(token)) {
      const n = media.size + 1;
      media.set(token, { rid: `rIdProposalImg${n}`, file: `proposal_${n}.${img.type}`, type: img.type, bytes: img.bytes });
    }
    return drawingParagraph(media.get(token).rid, drawingId++, `${label} ${drawingId}`, size);
  };

  const data = {
    ...context,
    options: (context.options || []).map((o, i) => ({
      ...o,
      logo_xml: imageXml(o.logo_token, LOGO_BOX, "Logo"),
      timeline_xml: imageXml(o.timeline_token, TIMELINE_BOX, "Timeline"),
      page_break: i === 0 ? "" : PAGE_BREAK,
    })),
  };

  const zip = new PizZip(templateBuffer);
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => "" });
  doc.render(data);
  const out = doc.getZip();

  if (media.size) {
    for (const m of media.values()) out.file(`word/media/${m.file}`, m.bytes);
    const relsName = "word/_rels/document.xml.rels";
    const rels = media.size ? [...media.values()].map((m) => `<Relationship Id="${m.rid}" Type="${REL_IMAGE}" Target="media/${m.file}"/>`).join("") : "";
    out.file(relsName, out.file(relsName).asText().replace("</Relationships>", `${rels}</Relationships>`));
    let types = out.file("[Content_Types].xml").asText();
    for (const t of new Set([...media.values()].map((m) => m.type))) {
      if (!new RegExp(`<Default Extension="${t}"`, "i").test(types)) types = types.replace("<Default ", `<Default Extension="${t}" ContentType="${MIME[t]}"/><Default `);
    }
    out.file("[Content_Types].xml", types);
  }

  const bytes = out.generate({ type: "uint8array", compression: "DEFLATE" });
  return new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}
