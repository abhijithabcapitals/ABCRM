// Fills public/ocr with what DOC OCR Module/browser/readDocument.js loads, so OCR is served from this site.
// Runs before `npm run dev` and `npm run build`. The folder is generated and not committed.
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const from = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url))
const out = from('public/ocr')
const docai = from('../DOC OCR Module/docai')

const copy = (dir, sourceDir, names) => {
  mkdirSync(`${out}/${dir}`, { recursive: true })
  for (const name of names) cpSync(`${sourceDir}/${name}`, `${out}/${dir}/${name}`)
}

rmSync(out, { recursive: true, force: true })
copy('pyodide', from('node_modules/pyodide'), ['pyodide.mjs', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'])
copy('pdf', from('node_modules/pdfjs-dist/build'), ['pdf.min.mjs', 'pdf.worker.min.mjs'])
copy('tesseract', from('node_modules/tesseract.js/dist'), ['tesseract.esm.min.js', 'worker.min.js'])
copy('tesseract', from('node_modules/tesseract.js-core'), ['tesseract-core-lstm.js', 'tesseract-core-lstm.wasm', 'tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.js', 'tesseract-core-simd-lstm.wasm', 'tesseract-core-simd-lstm.wasm.js'])
copy('tesseract', from('node_modules/@tesseract.js-data/eng/4.0.0_best_int'), ['eng.traineddata.gz'])
const sources = readdirSync(docai).filter((name) => name.endsWith('.py'))
copy('docai', docai, sources)
writeFileSync(`${out}/docai/files.json`, JSON.stringify(sources))
