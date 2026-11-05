// Business Formation Proposal: calculations, form rules and the data for the Word template. Pure, so it is tested.
// Options are alternatives: nothing here adds one option to another.
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const plain = (n) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
const dmy = (d) => { if (!d) return ""; const [y, m, day] = String(d).slice(0, 10).split("-"); return `${day}/${m}/${y}`; };
const dubaiDate = (iso) => (iso ? dmy(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date(iso))) : "");
const str = (v) => String(v ?? "").trim();
const texts = (list) => (Array.isArray(list) ? list : []).map(str).filter(Boolean);
const blank = (v) => v === null || v === undefined || str(v) === "";
// A typed amount: "1,000" is 1000. Returns null for blank, NaN for anything that is not zero or more (the server takes the same).
const parseAmount = (v) => {
  if (blank(v)) return null;
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : NaN;
  const s = str(v).replace(/,/g, "");
  return /^[0-9]+(\.[0-9]+)?$/.test(s) ? Number(s) : NaN;
};

export const toUsd = (aed, rate) => Math.round(Number(aed || 0) / Number(rate));
const usdText = (aed, rate) => `$ ${plain(toUsd(aed, rate))}`;

export const blankService = () => ({ name: "", remarks: "", amount: "", subs: [] });
export const blankOption = () => ({ authority_key: "", authority_name: "", activity: "", title: "", description: "", logo_path: null, timeline_path: null, package_includes: [], red_notes: [], services: [] });

const copyService = (s) => ({ name: s.name || "", remarks: s.remarks || "", amount: s.amount ?? "", subs: (s.subs || []).map((b) => ({ name: b.name || "", amount: b.amount ?? "" })) });

// The staff-editable option, filled from a saved authority set. The activity is always typed.
export function optionFromAuthority(set) {
  return {
    ...blankOption(), authority_key: set.authority_key || "", authority_name: set.name || "", title: set.table_title || "", description: set.description || "",
    logo_path: set.logo_path || null, timeline_path: set.timeline_path || null, package_includes: texts(set.package_includes), red_notes: texts(set.red_notes), services: (set.services || []).map(copyService),
  };
}
export function sharedFromAuthority(set) {
  return {
    addons: (set.addons || []).map((a) => ({ name: a.name || "", amount: a.amount ?? null, text: a.text || "" })),
    documents: texts(set.documents), payment: texts(set.payment), scope: texts(set.scope), notes: texts(set.notes),
  };
}

// A service with sub services takes the sum of them; its own amount is not used.
export function serviceAmount(service) {
  if (service.subs?.length) return round2(service.subs.reduce((s, b) => s + (parseAmount(b.amount) || 0), 0));
  return parseAmount(service.amount) || 0;
}
export const optionTotal = (option) => round2((option.services || []).reduce((s, x) => s + serviceAmount(x), 0));

// The first problem, or null. form: { client, contact, email, phone }.
export function checkProposal(form, proposal) {
  if (!str(form.client)) return "Enter the client name.";
  if (!str(form.contact)) return "Enter the contact person.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(form.email))) return "Enter a valid email.";
  const rate = Number(proposal.usd_rate);
  if (!Number.isFinite(rate) || rate <= 0) return "The USD rate must be more than zero.";
  const options = proposal.options || [];
  if (!options.length) return "Add at least one option.";
  for (let i = 0; i < options.length; i++) {
    const o = options[i], n = i + 1;
    if (!str(o.authority_key)) return `Option ${n} needs a licence authority.`;
    if (!str(o.activity)) return `Option ${n} needs a business activity.`;
    if (!(o.services || []).length) return `Option ${n} needs at least one service.`;
    for (const s of o.services) {
      if (!str(s.name)) return `Each service in option ${n} needs a name.`;
      if (s.subs?.length) {
        if (!blank(s.amount)) return `${s.name} has sub services, so its amount cannot also be typed.`;
        for (const b of s.subs) {
          if (!str(b.name)) return `Each sub service of ${s.name} needs a name.`;
          if (Number.isNaN(parseAmount(b.amount)) || blank(b.amount)) return `Enter an amount of zero or more for ${b.name}.`;
        }
      } else if (Number.isNaN(parseAmount(s.amount)) || blank(s.amount)) return `Enter an amount of zero or more for ${s.name}.`;
    }
  }
  for (const a of proposal.shared?.addons || []) {
    if (!str(a.name)) return "Each add-on needs a name.";
    if (Number.isNaN(parseAmount(a.amount))) return `Enter an amount of zero or more for the add-on ${a.name}.`;
  }
  return null;
}

// The argument of hub_proposal_create. Amounts are numbers; a service with sub services sends none, the server sums them.
export function toPayload(form, proposal, clientId) {
  const shared = proposal.shared || {};
  return {
    client_id: clientId || null, client_name: str(form.client), contact_name: str(form.contact), contact_email: str(form.email), contact_phone: str(form.phone),
    proposal: {
      usd_rate: Number(proposal.usd_rate), accepted_option: null,
      options: (proposal.options || []).map((o) => ({
        authority_key: str(o.authority_key), authority_name: str(o.authority_name) || null, activity: str(o.activity), title: str(o.title) || null, description: str(o.description) || null,
        logo_path: o.logo_path || null, timeline_path: o.timeline_path || null, package_includes: texts(o.package_includes), red_notes: texts(o.red_notes),
        services: (o.services || []).map((s) => ({
          name: str(s.name), remarks: str(s.remarks) || null,
          amount: s.subs?.length ? null : parseAmount(s.amount),
          subs: (s.subs || []).map((b) => ({ name: str(b.name), amount: parseAmount(b.amount) })),
        })),
      })),
      shared: {
        addons: (shared.addons || []).map((a) => ({ name: str(a.name), amount: parseAmount(a.amount), text: str(a.text) || null })),
        documents: texts(shared.documents), payment: texts(shared.payment), scope: texts(shared.scope), notes: texts(shared.notes),
      },
    },
  };
}

export const removeOption = (proposal, index) => ({ ...proposal, accepted_option: null, options: (proposal.options || []).filter((_, i) => i !== index) });
// The shared sections follow Option 1's authority; changing it would lose staff edits.
export const needsSharedWarning = (index, sharedDirty) => index === 0 && !!sharedDirty;

// Table rows of one option as printed: a service with sub services is a bold row with its subtotal, its subs indented below.
export function printRows(option, rate) {
  const rows = [];
  const row = (label, aed, remarks, bold, sub) => rows.push({ label, aed: plain(aed), usd: usdText(aed, rate), remarks: remarks || "", bold, sub, odd: rows.length % 2 === 1 });
  for (const s of option.services || []) {
    row(s.name, serviceAmount(s), str(s.remarks), !!s.subs?.length, false);
    for (const b of s.subs || []) row(b.name, parseAmount(b.amount) || 0, "", false, true);
  }
  return rows;
}

const lines = (list) => texts(list).map((text) => ({ text }));

// The data of the Word template. images (looked up by the caller) is not needed here: each option names its image paths as tokens.
export function proposalContext(doc, settings, images) {
  const p = doc.field_values?.proposal || doc.proposal || {};
  const rate = Number(p.usd_rate) || Number(settings?.proposal_defaults?.usd_rate) || 0;
  const bank = settings?.company?.bank || {};
  const contact = settings?.proposal_defaults?.contact || {};
  const shared = p.shared || {};
  const options = p.options || [];
  return {
    ref_no: doc.document_number || "", date: dubaiDate(doc.created_at), usd_rate: String(rate),
    options: options.map((o, i) => {
      const total = optionTotal(o);
      return {
        no: i + 1, first: i === 0, show_option_heading: options.length > 1, activity: str(o.activity), authority_name: str(o.authority_name), title: str(o.title), description: str(o.description),
        has_remarks: (o.services || []).some((s) => str(s.remarks)), rows: printRows(o, rate), total_aed: plain(total), total_usd: usdText(total, rate),
        package_includes: lines(o.package_includes), has_package: texts(o.package_includes).length > 0, red_notes: lines(o.red_notes),
        logo_token: o.logo_path || null, timeline_token: o.timeline_path || null,
      };
    }),
    addons: (shared.addons || []).map((a) => {
      const t = str(a.text), amt = parseAmount(a.amount);
      if (t) return { name: str(a.name), aed: t, usd: t };
      return amt === null || Number.isNaN(amt) ? { name: str(a.name), aed: "", usd: "" } : { name: str(a.name), aed: plain(amt), usd: usdText(amt, rate) };
    }),
    has_addons: (shared.addons || []).length > 0,
    documents: lines(shared.documents), payment: lines(shared.payment), scope: lines(shared.scope), notes: lines(shared.notes),
    ba_name: bank.account_name || "", ba_bank: bank.bank || "", ba_no: bank.account_no || "", ba_iban: bank.iban || "", ba_swift: bank.swift || "", ba_ccy: bank.currency || "",
    contact_name: contact.name || "", contact_phone: contact.phone || "", contact_email: contact.email || "", contact_website: contact.website || "",
  };
}
