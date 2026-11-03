// Escapes the characters that LIKE and ILIKE treat as wildcards. Commas stay as they are.
export const escapeLike = (query) => String(query).replace(/[\\%_]/g, (c) => "\\" + c);

// Groups price lines by template, then by line_group, keeping the order they first appear in.
export function groupPriceLines(lines) {
  const templates = new Map();
  for (const l of lines) {
    if (!templates.has(l.template)) templates.set(l.template, new Map());
    const groups = templates.get(l.template);
    if (!groups.has(l.line_group)) groups.set(l.line_group, []);
    groups.get(l.line_group).push(l);
  }
  return [...templates].map(([template, groups]) => ({
    template,
    groups: [...groups].map(([line_group, items]) => ({ line_group, lines: items })),
  }));
}
