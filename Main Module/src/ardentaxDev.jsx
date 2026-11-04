// Development page for the ArdentTax tab. Not part of the production build (only index.html is built).
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { docxToPdf } from "@template-hub/ardentax/logic/docxToPdf";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const FALLBACK_CSS = "section.docx, section.docx * { font-family: Arial, sans-serif !important; }";

async function drawPdf(data, into, label) {
  const doc = await pdfjs.getDocument({ data }).promise;
  const count = doc.numPages;
  for (let i = 1; i <= count; i += 1) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1.15 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.dataset.key = `${label}-${i}`;
    canvas.style.cssText = "border:1px solid #999;display:block";
    await page.render({ canvasContext: canvas.getContext("2d"), viewport, canvas }).promise;
    into.appendChild(canvas);
  }
  return count;
}

function PdfTest() {
  const [status, setStatus] = useState("idle");
  const [fallback, setFallback] = useState(false);
  const left = useRef(null);
  const right = useRef(null);
  const run = async () => {
    setStatus("running");
    try {
      const docx = await (await fetch("/_ardentax_test/test.docx")).blob();
      const host = document.getElementById("pdf-host");
      host.innerHTML = fallback ? `<style>${FALLBACK_CSS}</style>` : "";
      const started = performance.now();
      const pdf = await docxToPdf(docx, { host, foreignObject: new URLSearchParams(location.search).has("fo") });
      const ms = Math.round(performance.now() - started);
      left.current.replaceChildren();
      right.current.replaceChildren();
      const word = await (await fetch("/_ardentax_test/word.pdf")).arrayBuffer();
      const nWord = await drawPdf(new Uint8Array(word), left.current, "word");
      const nMine = await drawPdf(new Uint8Array(await pdf.arrayBuffer()), right.current, "browser");
      setStatus(`done: browser ${nMine} pages, Word ${nWord} pages, ${(pdf.size / 1048576).toFixed(2)} MB, ${ms} ms`);
    } catch (e) { setStatus(`failed: ${e.message}`); }
  };
  return (
    <div style={{ padding: 16, fontFamily: "system-ui" }}>
      <label><input id="fallback" type="checkbox" checked={fallback} onChange={(e) => setFallback(e.target.checked)} /> Force fallback font</label>{" "}
      <button id="run" onClick={run}>Make PDF</button> <span id="status">{status}</span>
      <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
        <div ref={left} id="word" style={{ display: "flex", flexDirection: "column", gap: 8 }} />
        <div ref={right} id="browser" style={{ display: "flex", flexDirection: "column", gap: 8 }} />
      </div>
      <div id="pdf-host" style={{ position: "absolute", left: -20000, top: 0, background: "#fff" }} />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<PdfTest />);
