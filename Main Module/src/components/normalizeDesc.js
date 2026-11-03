// Normalize stored description: plain text → HTML paragraph
export function normalizeDesc(val) {
  if (!val) return "";
  if (val.trimStart().startsWith("<")) return val;
  return val.split("\n").map((l) => `<p>${l || "<br/>"}</p>`).join("");
}
