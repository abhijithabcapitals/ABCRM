// node --test "Template Module/tests/proposalModel.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { blankOption, optionFromAuthority, sharedFromAuthority, serviceAmount, optionTotal, toUsd, checkProposal, toPayload, removeOption, needsSharedWarning, printRows, proposalContext } from "../logic/proposalModel.js";

const RATE = 3.6725;
const form = { client: "Client LLC", contact: "Asha", email: "a@b.co", phone: "0501" };
const svc = (name, amount, extra = {}) => ({ name, remarks: "", amount, subs: [], ...extra });
const opt = (over = {}) => ({ ...blankOption(), authority_key: "a1", authority_name: "Authority One", activity: "Consulting", services: [svc("Licence", "200")], ...over });
const two = () => opt({ services: [svc("Package", "", { subs: [{ name: "Fee A", amount: "300" }, { name: "Fee B", amount: "100" }] }), svc("Visa", "200")] });
const prop = (options = [two()], shared = {}) => ({ usd_rate: RATE, accepted_option: null, options, shared: { addons: [], documents: [], payment: [], scope: [], notes: [], ...shared } });

test("toUsd rounds to whole dollars", () => {
  assert.equal(toUsd(40000, RATE), 10892);
  assert.equal(toUsd(2000, RATE), 545);
});

test("serviceAmount and optionTotal", () => {
  assert.equal(serviceAmount(two().services[0]), 400);
  assert.equal(serviceAmount(svc("x", "1,000")), 1000);
  assert.equal(optionTotal(two()), 600);
  assert.equal(serviceAmount(svc("p", "", { subs: [{ name: "a", amount: "0.1" }, { name: "b", amount: "0.2" }] })), 0.3);
});

test("printRows: bold parent with subtotal, sub rows, plain row, zero prints 0", () => {
  const rows = printRows(opt({ services: [...two().services, svc("Free", "0", { remarks: "Complimentary" })] }), RATE);
  assert.deepEqual(rows.map((r) => [r.label, r.aed, r.bold, r.sub]), [["Package", "400", true, false], ["Fee A", "300", false, true], ["Fee B", "100", false, true], ["Visa", "200", false, false], ["Free", "0", false, false]]);
  assert.equal(rows[0].usd, `$ ${toUsd(400, RATE)}`);
  assert.equal(rows[4].remarks, "Complimentary");
  assert.equal(printRows(opt({ services: [svc("Big", "1234567")] }), RATE)[0].aed, "1,234,567");
});

test("printRows: odd flag alternates over printed rows, sub rows included", () => {
  const rows = printRows(opt({ services: [...two().services, svc("Free", "0")] }), RATE);
  assert.deepEqual(rows.map((r) => r.odd), [false, true, false, true, false]);
});

test("optionTotal usd is from the AED total, not rounded rows", () => {
  const o = two();
  const ctx = proposalContext({ document_number: "N1", created_at: "2026-11-01T10:00:00Z", field_values: { proposal: prop([o]) } }, {}, {});
  assert.equal(ctx.options[0].total_aed, "600");
  assert.equal(ctx.options[0].total_usd, `$ ${toUsd(600, RATE)}`);
});

test("checkProposal names each problem", () => {
  const ok = prop();
  assert.equal(checkProposal(form, ok), null);
  assert.match(checkProposal({ ...form, email: "nope" }, ok), /email/i);
  assert.match(checkProposal({ ...form, client: " " }, ok), /client/i);
  assert.match(checkProposal(form, prop([])), /option/i);
  assert.match(checkProposal(form, prop([opt({ activity: " " })])), /activity/i);
  assert.match(checkProposal(form, prop([opt({ authority_key: "" })])), /authority/i);
  assert.match(checkProposal(form, prop([opt({ services: [] })])), /service/i);
  assert.match(checkProposal(form, prop([opt({ services: [svc("", "5")] })])), /name/i);
  assert.match(checkProposal(form, prop([opt({ services: [svc("Licence", "")] })])), /amount/i);
  assert.match(checkProposal(form, prop([opt({ services: [svc("Licence", "-1")] })])), /amount/i);
  assert.match(checkProposal(form, prop([opt({ services: [svc("Licence", "abc")] })])), /amount/i);
  assert.match(checkProposal(form, prop([opt({ services: [svc("P", "50", { subs: [{ name: "a", amount: "1" }] })] })])), /sub/i);
  assert.match(checkProposal(form, prop([opt({ services: [svc("P", "", { subs: [{ name: "a", amount: "" }] })] })])), /amount/i);
  assert.match(checkProposal(form, prop([opt({ services: [svc("P", "", { subs: [{ name: "", amount: "1" }] })] })])), /name/i);
  assert.match(checkProposal(form, { ...ok, usd_rate: 0 }), /rate/i);
  assert.match(checkProposal(form, prop([opt()], { addons: [{ name: "", amount: "5", text: "" }] })), /add-on/i);
  assert.match(checkProposal(form, prop([opt()], { addons: [{ name: "X", amount: "abc", text: "" }] })), /add-on/i);
  assert.equal(checkProposal(form, prop([opt({ services: [svc("Free", "0")] })])), null);
});

test("toPayload sends numbers, accepts 1,000, leaves sub-service amounts to the sum", () => {
  const p = toPayload(form, prop([opt({ services: [svc("Licence", "1,000", { remarks: " r " }), ...two().services] })], { addons: [{ name: "Extra", amount: "50", text: "" }, { name: "Custom", amount: "", text: "Rate will be customized" }], notes: ["n", " "] }), "CL1");
  assert.deepEqual(Object.keys(p).sort(), ["client_id", "client_name", "contact_email", "contact_name", "contact_phone", "proposal"]);
  assert.equal(p.client_id, "CL1");
  assert.equal(p.client_name, "Client LLC");
  assert.equal(p.contact_name, "Asha");
  assert.equal(p.proposal.usd_rate, RATE);
  const s = p.proposal.options[0].services;
  assert.equal(s[0].amount, 1000);
  assert.equal(s[0].remarks, "r");
  assert.equal(s[1].amount, null);
  assert.deepEqual(s[1].subs, [{ name: "Fee A", amount: 300 }, { name: "Fee B", amount: 100 }]);
  assert.deepEqual(p.proposal.shared.addons, [{ name: "Extra", amount: 50, text: null }, { name: "Custom", amount: null, text: "Rate will be customized" }]);
  assert.deepEqual(p.proposal.shared.notes, ["n"]);
  assert.equal(toPayload(form, prop(), null).client_id, null);
});

test("removeOption and needsSharedWarning", () => {
  const p = prop([opt({ activity: "First" }), opt({ activity: "Second" })]);
  const q = removeOption(p, 0);
  assert.equal(q.options.length, 1);
  assert.equal(q.options[0].activity, "Second");
  assert.equal(p.options.length, 2);
  assert.equal(toPayload(form, q, null).proposal.options[0].activity, "Second");
  assert.equal(needsSharedWarning(0, true), true);
  assert.equal(needsSharedWarning(1, true), false);
  assert.equal(needsSharedWarning(0, false), false);
});

test("optionFromAuthority and sharedFromAuthority copy the saved set", () => {
  const set = { authority_key: "ifza", name: "IFZA", description: "d", logo_path: "l.png", timeline_path: "t.png", table_title: "Business Formation-IFZA", services: [{ name: "Licence", remarks: "", amount: null, subs: [{ name: "Fee", amount: null }] }], package_includes: ["x"], red_notes: ["y"], addons: [{ name: "A", amount: 5, text: null }], documents: ["doc"], payment: ["pay"], scope: ["sc"], notes: ["nt"] };
  const o = optionFromAuthority(set);
  assert.equal(o.authority_key, "ifza");
  assert.equal(o.authority_name, "IFZA");
  assert.equal(o.title, "Business Formation-IFZA");
  assert.equal(o.activity, "");
  assert.equal(o.logo_path, "l.png");
  assert.deepEqual(o.package_includes, ["x"]);
  o.package_includes.push("z");
  assert.deepEqual(set.package_includes, ["x"]);
  assert.equal(o.services[0].subs[0].name, "Fee");
  const sh = sharedFromAuthority(set);
  assert.deepEqual(sh.addons, [{ name: "A", amount: 5, text: "" }]);
  assert.deepEqual([sh.documents, sh.payment, sh.scope, sh.notes], [["doc"], ["pay"], ["sc"], ["nt"]]);
});

const settings = { company: { bank: { account_name: "AN", bank: "BK", account_no: "123", iban: "IB", swift: "SW", currency: "AED" } }, proposal_defaults: { usd_rate: 4, contact: { name: "Sam", phone: "p", email: "e@x.co", website: "w.co" } } };

test("proposalContext: flat keys, heading flag, remarks flag, no cross-option sum", () => {
  const o1 = opt({ activity: "A1", logo_path: "logo1.png", timeline_path: null, package_includes: ["Visa"], red_notes: ["Note"], services: [svc("S", "100", { remarks: "r" })] });
  const o2 = opt({ activity: "A2", authority_name: "Two", services: [svc("S", "300")] });
  const doc = { document_number: "ABC/2026/11/BSQ006", created_at: "2026-10-31T21:30:00Z", field_values: { proposal: prop([o1, o2]) } };
  const c = proposalContext(doc, settings, undefined);
  assert.equal(c.ref_no, "ABC/2026/11/BSQ006");
  assert.equal(c.date, "01/11/2026");
  assert.equal(c.options.length, 2);
  const [a, b] = c.options;
  assert.deepEqual([a.no, a.first, b.no, b.first], [1, true, 2, false]);
  assert.equal(a.show_option_heading, true);
  assert.deepEqual([a.has_remarks, b.has_remarks], [true, false]);
  assert.equal(a.logo_token, "logo1.png");
  assert.equal(a.timeline_token, null);
  assert.equal(a.has_package, true);
  assert.equal(b.has_package, false);
  assert.deepEqual(a.package_includes, [{ text: "Visa" }]);
  assert.deepEqual(a.red_notes, [{ text: "Note" }]);
  assert.equal(a.total_aed, "100");
  assert.equal(b.total_aed, "300");
  assert.equal(b.total_usd, `$ ${toUsd(300, RATE)}`);
  assert.equal(c.ba_iban, "IB");
  assert.deepEqual([c.ba_name, c.ba_bank, c.ba_no, c.ba_swift, c.ba_ccy], ["AN", "BK", "123", "SW", "AED"]);
  assert.deepEqual([c.contact_name, c.contact_phone, c.contact_email, c.contact_website], ["Sam", "p", "e@x.co", "w.co"]);
  for (const k of Object.keys(c)) assert.doesNotMatch(k, /grand|^total/);
  const one = proposalContext({ ...doc, field_values: { proposal: prop([o1]) } }, settings, {});
  assert.equal(one.options[0].show_option_heading, false);
});

test("proposalContext: add-ons print text in both columns, or amount and USD", () => {
  const sh = { addons: [{ name: "Custom", amount: null, text: "Rate will be customized" }, { name: "Extra", amount: 1500, text: null }], documents: ["d"], payment: ["p"], scope: ["s"], notes: ["n"] };
  const c = proposalContext({ document_number: "N", created_at: "2026-11-01T10:00:00Z", field_values: { proposal: prop([opt()], sh) } }, settings, {});
  assert.deepEqual(c.addons[0], { name: "Custom", aed: "Rate will be customized", usd: "Rate will be customized" });
  assert.deepEqual(c.addons[1], { name: "Extra", aed: "1,500", usd: `$ ${toUsd(1500, RATE)}` });
  assert.deepEqual([c.documents, c.payment, c.scope, c.notes], [[{ text: "d" }], [{ text: "p" }], [{ text: "s" }], [{ text: "n" }]]);
  assert.equal(c.has_addons, true);
});

test("proposalContext flags empty sections", () => {
  const empty = { addons: [], documents: [], payment: [], scope: [], notes: [] };
  const flags = (sh) => { const c = proposalContext({ document_number: "X", field_values: { proposal: prop([two()], sh) } }, {}); return [c.has_documents, c.has_payment, c.has_scope, c.has_notes, c.has_terms]; };
  assert.deepEqual(flags(empty), [false, false, false, false, false]);
  assert.deepEqual(flags({ ...empty, documents: ["d", "  "] }), [true, false, false, false, true]);
  assert.deepEqual(flags({ ...empty, payment: ["p"] }), [false, true, false, false, true]);
  assert.deepEqual(flags({ ...empty, scope: ["s"], notes: ["n"] }), [false, false, true, true, false]);
  const c = proposalContext({ document_number: "X", field_values: { proposal: prop([two(), two()]) } }, {});
  assert.deepEqual(c.options.map((o) => o.brk), [false, true]);
});
