import { renderSigned } from "./signDocx.js";

// Trimming parser so both {{ key }} and {{key}} work (docxtemplater doesn't
// trim tag whitespace by default), with dotted-path + scope-climbing support.
export const trimParser = (tag) => {
  const path = tag.trim().split(".");
  return {
    get(scope, context) {
      const head = path[0];
      let base = scope;
      if (base == null || base[head] === undefined) {
        const list = (context && context.scopeList) || [];
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i] != null && list[i][head] !== undefined) {
            base = list[i];
            break;
          }
        }
      }
      return path.reduce((o, k) => (o == null ? undefined : o[k]), base);
    },
  };
};

// How a Company Library template is read: {{ key }} tags with the parser above. The signatory place, where a template has one, is
// {{@signature_xml}} on a line of its own.
export const LIBRARY_TAGS = { delimiters: { start: "{{", end: "}}" }, parser: trimParser };
export const LIBRARY_NO_PLACE = "This template has no place for the signature. Add {{@signature_xml}} on a line of its own where the signature goes, upload the file again in Template Hub > Settings > Library Templates, and make a new document from it to sign.";

// Fill a template (ArrayBuffer) with a context → docx Blob. Loads pizzip + docxtemplater on demand.
// signature: null (every normal fill) or the company image { bytes, type, width, height } when an approver signs (logic/signDocx.js).
export async function renderDocx(arrayBuffer, data, { signature = null } = {}) {
  const [{ default: PizZip }, { default: Docxtemplater }] = await Promise.all([
    import("pizzip"),
    import("docxtemplater"),
  ]);
  return renderSigned({ PizZip, Docxtemplater }, arrayBuffer, data, signature, "library", { ...LIBRARY_TAGS, missing: LIBRARY_NO_PLACE }).generate({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}
