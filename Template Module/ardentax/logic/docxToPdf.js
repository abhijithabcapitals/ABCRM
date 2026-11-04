// Draws a Word file in the browser and saves it as an A4 PDF, one image per page. Libraries load only when used.
// docx-preview does not calculate page breaks, so long sections are split here, following Word's rules:
// a paragraph marked "keep with next" stays with what follows, and a table moves whole unless it is taller than a page.
const A4_MM = { w: 210, h: 297 };

function hostElement(given) {
  if (given) return { host: given, remove: () => {} };
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-20000px;top:0;background:#fff";
  document.body.appendChild(host);
  return { host, remove: () => host.remove() };
}

// One flag per top-level body element of the Word file, in order.
async function keepNextFlags(docxBlob) {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(docxBlob);
  const xml = new DOMParser().parseFromString(await zip.file("word/document.xml").async("string"), "application/xml");
  const body = xml.getElementsByTagName("w:body")[0];
  return [...body.children].filter((el) => el.tagName === "w:p" || el.tagName === "w:tbl").map((el) => {
    if (el.tagName !== "w:p") return false;
    const pPr = [...el.children].find((c) => c.tagName === "w:pPr");
    return !!pPr && [...pPr.children].some((c) => c.tagName === "w:keepNext" && c.getAttribute("w:val") !== "0");
  });
}

const bodyLimit = (section) => {
  const style = getComputedStyle(section);
  const pageHeight = parseFloat(style.minHeight);
  return pageHeight - parseFloat(style.paddingBottom);
};

function newPage(section) {
  const page = section.cloneNode(true);
  page.querySelectorAll("article").forEach((a, i) => { if (i) a.remove(); else a.replaceChildren(); });
  section.parentNode.insertBefore(page, section.nextSibling);
  return page;
}

function splitTable(table, room, full) {
  const rows = [...table.rows];
  const header = rows[0];
  const parts = [];
  let current = table.cloneNode(false);
  const tbodyOf = () => { const b = table.tBodies[0].cloneNode(false); current.appendChild(b); return b; };
  let tbody = tbodyOf();
  let used = 0;
  let limit = room;
  rows.forEach((row, i) => {
    const h = row.getBoundingClientRect().height;
    if (i > 0 && used + h > limit && tbody.rows.length > 0) {
      parts.push(current);
      current = table.cloneNode(false);
      tbody = tbodyOf();
      tbody.appendChild(header.cloneNode(true));
      used = header.getBoundingClientRect().height;
      limit = full;
    }
    tbody.appendChild(row.cloneNode(true));
    used += h;
  });
  parts.push(current);
  return parts;
}

// Moves what does not fit onto new pages. flags lines up with the blocks of all sections, in order.
export function paginate(host, flags) {
  const sections = [...host.querySelectorAll("section.docx")];
  const allBlocks = sections.flatMap((s) => [...s.querySelectorAll(":scope > article > *")]);
  const flagOf = new Map(allBlocks.map((b, i) => [b, allBlocks.length === flags.length ? flags[i] : false]));
  for (const section of sections) {
    const articles = section.querySelectorAll(":scope > article");
    if (articles.length !== 1 || section.scrollHeight <= parseFloat(getComputedStyle(section).minHeight) + 1) continue;
    const article = articles[0];
    const blocks = [...article.children];
    const top0 = article.getBoundingClientRect().top;
    const full = bodyLimit(section) - (top0 - section.getBoundingClientRect().top);
    const tops = blocks.map((b) => b.getBoundingClientRect().top - top0);
    const end = article.getBoundingClientRect().bottom - top0;
    const heightOf = (i) => (i + 1 < blocks.length ? tops[i + 1] : end) - tops[i];
    // A unit is what must stay together: keep-with-next paragraphs and the block they lead to.
    const units = [];
    for (let i = 0; i < blocks.length; i += 1) {
      const unit = [i];
      while (flagOf.get(blocks[unit[unit.length - 1]]) && unit[unit.length - 1] + 1 < blocks.length) unit.push(unit[unit.length - 1] + 1);
      units.push(unit);
      i = unit[unit.length - 1];
    }
    const measured = blocks.map((b, i) => ({ el: b, h: heightOf(i), rows: b.tagName === "TABLE" ? [...b.rows].map((r) => r.getBoundingClientRect().height) : null }));
    let page = section;
    let target = article;
    let used = 0;
    const startPage = () => {
      page = newPage(page);
      target = page.querySelector("article");
      used = 0;
    };
    // Tables are split from a copy while the original is still laid out, so row heights are real.
    const splits = new Map();
    for (const unit of units) {
      unit.forEach((i) => { if (measured[i].rows && measured[i].h > full) splits.set(i, measured[i].el); });
    }
    const splitParts = new Map([...splits].map(([i, table]) => [i, splitTable(table, full, full)]));
    article.replaceChildren();
    for (const unit of units) {
      const h = unit.reduce((s, i) => s + measured[i].h, 0);
      if (used > 0 && used + h > full && h <= full) startPage();
      for (const i of unit) {
        const parts = splitParts.get(i);
        if (parts) {
          parts.forEach((part, n) => {
            if (n > 0 || used > 0) startPage();
            target.appendChild(part);
          });
          used = full;
          continue;
        }
        if (used > 0 && used + measured[i].h > full) startPage();
        target.appendChild(measured[i].el);
        used += measured[i].h;
      }
    }
  }
  const pages = [...host.querySelectorAll("section.docx")];
  pages.forEach((p, i) => {
    const footer = p.querySelector("footer");
    if (!footer) return;
    const spans = [...footer.querySelectorAll("span")];
    const bar = spans.findIndex((s) => s.textContent.trim() === "|");
    if (bar > 0 && spans[bar + 1]) { spans[bar - 1].textContent = String(i + 1); spans[bar + 1].textContent = String(pages.length); }
  });
  return pages;
}

export async function docxToPdf(docxBlob, opts = {}) {
  const [{ renderAsync }, { default: html2canvas }, { jsPDF }] = await Promise.all([
    import("docx-preview"), import("html2canvas"), import("jspdf"),
  ]);
  const { host, remove } = hostElement(opts.host);
  try {
    await renderAsync(docxBlob, host, undefined, {
      inWrapper: false, ignoreWidth: false, ignoreHeight: false, breakPages: true, ignoreLastRenderedPageBreak: true,
      renderHeaders: true, renderFooters: true, experimental: true, useBase64URL: true,
    });
    await document.fonts?.ready;
    // Word sizes a thin coloured row by its set height; an empty paragraph would stretch it in the browser.
    host.querySelectorAll("tr[style*='height']").forEach((row) => {
      if (row.textContent.trim() || row.querySelector("img")) return;
      row.querySelectorAll("p").forEach((para) => { para.style.cssText += ";margin:0;font-size:0;line-height:0;min-height:0"; });
      row.querySelectorAll("td").forEach((cell) => { cell.style.padding = "0"; });
    });
    // Aptos is not installed on most PCs, and without a fallback the browser would use a serif font.
    host.querySelectorAll("[style*='font-family']").forEach((el) => {
      const family = el.style.fontFamily.replace(/"/g, "");
      if (/^(Aptos|Calibri)$/i.test(family)) el.style.fontFamily = `${family}, Calibri, Carlito, "Segoe UI", Arial, sans-serif`;
    });
    // Word aligns a cell's paragraph on its own, while a centred table would pass its alignment on in the browser.
    host.querySelectorAll("td").forEach((cell) => { if (!cell.style.textAlign) cell.style.textAlign = "left"; });
    // The capture paints a wrapped span's background over its whole box, hiding text beside it. One span per word avoids that.
    host.querySelectorAll("span[style*='background-color']").forEach((span) => {
      if (span.children.length || !/\s/.test(span.textContent.trim())) return;
      const words = span.textContent.split(/(\s+)/).filter(Boolean);
      span.replaceWith(...words.map((word) => { const part = span.cloneNode(false); part.textContent = word; return part; }));
    });
    const pages = paginate(host, await keepNextFlags(docxBlob));
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
    for (let i = 0; i < pages.length; i += 1) {
      const canvas = await html2canvas(pages[i], { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false, foreignObjectRendering: !!opts.foreignObject });
      if (i > 0) pdf.addPage("a4", "portrait");
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, A4_MM.w, A4_MM.h, undefined, "FAST");
    }
    return pdf.output("blob");
  } finally {
    remove();
  }
}
