// Email or phone typed on the form, against what Client Master holds. A difference is a person's choice.
export function contactChoice(master, form) {
  const m = String(master ?? "").trim();
  const f = String(form ?? "").trim();
  if (!m || !f || m === f) return { conflict: false, value: f || m };
  return { conflict: true, master: m, form: f };
}
