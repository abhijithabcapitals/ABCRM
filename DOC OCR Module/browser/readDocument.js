// Runs docai in the staff member's browser: no server, no fee, and files never leave the PC.
// PDF text and OCR happen here (PDF.js, Tesseract); docai/browser.py does the rest through Pyodide.
// `assets` is the folder Main Module/scripts/copy-ocr-assets.mjs fills. Everything loads on first use.
const MAX_OCR_PAGES = 10;
const MAX_CHARS = 60000;
const RENDER_SCALE = 2.5;
const IMAGE = /\.(jpe?g|png|bmp|webp|tiff?)$/i;

const lettersIn = (s) => s.replace(/\s/g, "").length;
const importAsset = (url) => import(/* @vite-ignore */ new URL(url, location.href).href); // a full URL keeps Vite's dev server from rewriting it
const once = (make) => { let p; return (...a) => (p ??= make(...a).catch((e) => { p = null; throw e; })); };

const loadPython = once(async (assets) => {
  const { loadPyodide } = await importAsset(`${assets}pyodide/pyodide.mjs`);
  const py = await loadPyodide({ indexURL: `${assets}pyodide/` });
  const names = await (await fetch(`${assets}docai/files.json`)).json();
  py.FS.mkdirTree("/home/pyodide/docai");
  for (const n of names) py.FS.writeFile(`/home/pyodide/docai/${n}`, await (await fetch(`${assets}docai/${n}`)).text());
  py.runPython("import sys; sys.path.insert(0, '/home/pyodide')");
  await py.runPythonAsync("from docai.browser import read_document");
  return py;
});

const loadOcr = once(async (assets) => {
  const { default: Tesseract } = await importAsset(`${assets}tesseract/tesseract.esm.min.js`);
  return Tesseract.createWorker("eng", 1, { workerPath: `${assets}tesseract/worker.min.js`, corePath: `${assets}tesseract/`, langPath: `${assets}tesseract/` });
});

const loadPdf = once(async (assets) => {
  const pdfjs = await importAsset(`${assets}pdf/pdf.min.mjs`);
  pdfjs.GlobalWorkerOptions.workerSrc = `${assets}pdf/pdf.worker.min.mjs`;
  return pdfjs;
});

async function ocr(assets, image) {
  const worker = await loadOcr(assets);
  const { data } = await worker.recognize(image);
  return data.text;
}

// Same rule as docai/readers.py: trust a PDF's own text unless it is too thin, then OCR its pages.
async function readPdf(assets, file) {
  const pdfjs = await loadPdf(assets);
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const pages = [];
    for (let i = 1; i <= Math.min(pdf.numPages, 15); i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      pages.push(content.items.map((t) => t.str + (t.hasEOL ? "\n" : " ")).join(""));
    }
    const text = pages.join("\n").slice(0, MAX_CHARS);
    if (lettersIn(text) >= 80 * Math.max(1, Math.min(pdf.numPages, 3))) return { text, method: "text-layer" };
    const scanned = [];
    for (let i = 1; i <= Math.min(pdf.numPages, MAX_OCR_PAGES); i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport, intent: "print" }).promise; // "print" keeps going in a background tab
      scanned.push(await ocr(assets, canvas));
    }
    const read = scanned.join("\n\f\n");
    if (lettersIn(read) > lettersIn(text)) return { text: read.slice(0, MAX_CHARS), method: "ocr" };
    return { text, method: text.trim() ? "text-layer" : "none" };
  } finally {
    await pdf.destroy();
  }
}

async function readImage(assets, file) {
  const text = await ocr(assets, file);
  return { text: text.slice(0, MAX_CHARS), method: text.trim() ? "ocr" : "none" };
}

// Resolves to one docai result. A file that fails docai's checks, or cannot be read, rejects with a staff-facing message.
export async function readDocument(file, assets) {
  const py = await loadPython(assets);
  let found = {};
  try {
    if (/\.pdf$/i.test(file.name)) found = await readPdf(assets, file);
    else if (IMAGE.test(file.name)) found = await readImage(assets, file);
  } catch {
    found = { text: "", method: "none" }; // unreadable or malformed files are classified by name only, as in docai
  }
  const path = `/tmp/${crypto.randomUUID()}`;
  py.FS.writeFile(path, new Uint8Array(await file.arrayBuffer()));
  const args = py.toPy([path, file.name, found.text ?? null, found.method ?? null]);
  try {
    const read = py.globals.get("read_document");
    const out = read(...args);
    const result = out.toJs({ dict_converter: Object.fromEntries });
    out.destroy(); read.destroy();
    if (result.error) throw new Error(`${file.name}: ${result.error}`);
    return result;
  } finally {
    args.destroy();
    py.FS.unlink(path);
  }
}
