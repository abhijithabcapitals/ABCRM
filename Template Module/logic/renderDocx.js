// Trimming parser so both {{ key }} and {{key}} work (docxtemplater doesn't
// trim tag whitespace by default), with dotted-path + scope-climbing support.
const trimParser = (tag) => {
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

// Fill a template (ArrayBuffer) with a context → docx Blob. Loads pizzip +
// docxtemplater on demand.
export async function renderDocx(arrayBuffer, data) {
  const [{ default: PizZip }, { default: Docxtemplater }] = await Promise.all([
    import("pizzip"),
    import("docxtemplater"),
  ]);
  const zip = new PizZip(arrayBuffer);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "{{", end: "}}" },
    parser: trimParser,
    nullGetter: () => "",
  });
  doc.render(data);
  return doc.getZip().generate({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}
