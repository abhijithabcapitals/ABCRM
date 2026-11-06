// node --test "Template Module/tests/accountingGenerate.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { generateQuote, generateAgreement, retryDocument, signAccounting, rebuildDocument, editAgreement, saveToOneDrive, mailText } from "../services/accountingGenerate.js";

const form = { client_name: "Sample Client", contact_name: "Sam", contact_email: "s@example.com", contact_phone: "050" };
const quote = {
  accepted_option: null,
  options: [
    { package_key: null, name: "Basic", description: "", notes: [], services: [{ name: "Bookkeeping", basis: "month", amount: "1,000", subs: [] }, { name: "Audit", basis: "year", amount: "500", subs: [] }] },
    { package_key: null, name: "Plus", description: "", notes: [], services: [{ name: "Bookkeeping", basis: "month", amount: "2,000", subs: [] }] },
  ],
  shared: {},
};
const agreement = {
  address: ["Dubai"], signatory_name: "Sam", signatory_title: "Manager", notices_email: "s@example.com",
  schedule1: [{ name: "Bookkeeping", description: "" }], schedule2: [{ name: "Bookkeeping", fee: "AED 1,000 per month" }], effective_months: 12, notice_days: 30, billing: "monthly",
};
const quoteDoc = { id: "d1", document_number: "ABC/2026/11/ACQ001", client_name: "Sample Client", library_template: "AB Capital/Accounting Quote", created_at: "2026-11-05T08:00:00Z", field_values: { quote }, contact_email: "s@example.com" };
const agrDoc = { id: "d2", document_number: "ABC/2026/11/ACE001", client_name: "Sample Client", library_template: "AB Capital/Accounting Agreement", created_at: "2026-11-05T08:00:00Z", field_values: { agreement }, agreement_changed_at: "2026-11-05T08:00:00.123Z" };
const sig = { bytes: new Uint8Array([1]), type: "png", width: 10, height: 5 };

function fakes(over = {}) {
  const calls = [];
  const note = (name, value) => (...args) => {
    calls.push({ name, args });
    const v = typeof value === "function" ? value(...args) : value;
    if (v instanceof Error) throw v;
    return v;
  };
  const base = {
    check: null, create: quoteDoc, loadTemplate: "TPL", render: "WORD", toPdf: "PDF",
    upload: (doc, blob, ext) => `Accounting/${doc.id}/x.${ext}`, remove: { ok: 1 }, attach: (id) => ({ ...quoteDoc, id, storage_path: "a.pdf", word_path: "a.docx" }),
    sign: async ({ doc, rebuild }) => ({ signature: { id: "sig1", source_id: doc.id }, wordBlob: await rebuild(doc, sig), pdfBlob: "SPDF" }), update: { ...agrDoc }, saveLocal: "C:\\OneDrive\\Proposals", markSaved: { ok: 1 }, createMail: { id: "m1" },
  };
  const deps = { settings: { accounting_proposal_defaults: {}, company: {} } };
  for (const [k, v] of Object.entries({ ...base, ...over })) deps[k] = note(k, v);
  return { calls, deps };
}
const names = (calls) => calls.map((c) => c.name);
const qIn = (over = {}) => ({ form, quote, clientId: "CL000001", ...over });

test("quote order", async () => {
  const { calls, deps } = fakes();
  const r = await generateQuote(qIn(), deps);
  assert.deepEqual(names(calls), ["check", "loadTemplate", "render", "create", "render", "toPdf", "upload", "upload", "attach", "saveLocal", "markSaved", "createMail"]);
  assert.equal(calls.find((c) => c.name === "upload" && c.args[2] === "pdf") !== undefined, true);
  assert.deepEqual(calls.filter((c) => c.name === "upload").map((c) => c.args[2]), ["pdf", "docx"]);
  assert.deepEqual(calls.find((c) => c.name === "attach").args, ["d1", "Accounting/d1/x.pdf", "Accounting/d1/x.docx"]);
  assert.equal(r.onedrive, "C:\\OneDrive\\Proposals");
  assert.equal(r.wordBlob, "WORD");
  assert.equal(r.pdfBlob, "PDF");
  assert.equal(r.error, undefined);
  assert.equal(calls.some((c) => c.name === "sign"), false);
});

test("check fails calls no create", async () => {
  const { calls, deps } = fakes({ check: "Enter the client name." });
  const r = await generateQuote(qIn(), deps);
  assert.equal(r.error, "Enter the client name.");
  assert.equal(names(calls).includes("create"), false);
  assert.equal(names(calls).includes("loadTemplate"), false);
});

test("bad template takes no number", async () => {
  const bad = fakes({ loadTemplate: new Error("no template") });
  assert.equal((await generateQuote(qIn(), bad.deps)).error, "no template");
  assert.equal(names(bad.calls).includes("create"), false);
  let n = 0;
  const trial = fakes({ render: () => { n += 1; return new Error("bad tag"); } });
  assert.equal((await generateQuote(qIn(), trial.deps)).error, "bad tag");
  assert.equal(names(trial.calls).includes("create"), false);
});

test("pdf fails after number, retry rebuilds from field_values and takes no number", async () => {
  const first = fakes({ toPdf: new Error("pdf broke") });
  const r = await generateQuote(qIn(), first.deps);
  assert.equal(r.error, "pdf broke");
  assert.equal(r.doc.id, "d1");
  const second = fakes();
  const again = await retryDocument(r.doc, second.deps);
  assert.equal(again.error, undefined);
  assert.equal(names(second.calls).includes("create"), false);
  assert.equal(names(second.calls).includes("sign"), false);
  assert.deepEqual(names(second.calls).slice(0, 3), ["loadTemplate", "render", "toPdf"]);
});

test("client module off succeeds with onedrive null", async () => {
  const { calls, deps } = fakes({ saveLocal: null });
  const r = await generateQuote(qIn(), deps);
  assert.equal(r.error, undefined);
  assert.equal(r.onedrive, null);
  assert.equal(names(calls).includes("markSaved"), false);
  assert.equal(names(calls).includes("createMail"), true);
});

test("double click makes one create", async () => {
  let release;
  const gate = new Promise((res) => { release = res; });
  const { calls, deps } = fakes({ loadTemplate: () => gate.then(() => "TPL") });
  const guard = {};
  const a = generateQuote(qIn({ guard }), deps);
  const b = generateQuote(qIn({ guard }), deps);
  release();
  await Promise.all([a, b]);
  assert.equal(calls.filter((c) => c.name === "create").length, 1);
  assert.ok((await b).error);
  const c = await generateQuote(qIn({ guard }), fakes().deps);
  assert.equal(c.error, undefined); // guard released
});

test("agreement draft never loads the signature", async () => {
  const { calls, deps } = fakes({ create: agrDoc, attach: (id) => ({ ...agrDoc, id }) });
  const r = await generateAgreement({ quoteId: "d1", agreement }, deps);
  assert.equal(r.error, undefined);
  assert.equal(names(calls).includes("sign"), false);
  assert.deepEqual(calls.find((c) => c.name === "create").args[0], { quote_id: "d1", agreement });
  const renders = calls.filter((c) => c.name === "render");
  assert.equal(renders.at(-1).args[1].has_signature, false);
  assert.equal(renders.at(-1).args[1].draft_mark, false);
  assert.equal(renders.at(-1).args[2], null);
});

test("sign goes through the shared step with the row's change stamp, then copies the signed files to OneDrive", async () => {
  const { calls, deps } = fakes();
  const doc = { ...agrDoc, content_changed_at: "2026-11-05T09:00:00.456789+00:00" };
  const r = await signAccounting(doc, deps);
  assert.deepEqual(names(calls), ["sign", "loadTemplate", "render", "saveLocal", "markSaved"]);
  const args = calls.find((c) => c.name === "sign").args[0];
  assert.equal(args.table, "hub_documents");
  assert.equal(args.doc, doc);
  assert.equal(args.seen, "2026-11-05T09:00:00.456789+00:00");
  assert.equal(typeof args.rebuild, "function");
  assert.equal(r.signature.id, "sig1");
  assert.equal(r.wordBlob, "WORD");
  assert.equal(r.pdfBlob, "SPDF");
  assert.equal(r.onedrive, "C:\\OneDrive\\Proposals");
  assert.deepEqual(calls.find((c) => c.name === "saveLocal").args.slice(1), ["WORD", "SPDF"]);
});

test("sign: the rebuild renders the stored document with the signature, for quotes and agreements", async () => {
  for (const [doc, kind] of [[agrDoc, "agreement"], [quoteDoc, "quote"]]) {
    const { calls, deps } = fakes();
    assert.equal(await rebuildDocument(doc, sig, deps), "WORD");
    assert.deepEqual(calls.find((c) => c.name === "loadTemplate").args, [kind]);
    const render = calls.find((c) => c.name === "render");
    assert.equal(render.args[0], "TPL");
    assert.equal(render.args[1].has_signature, true);
    assert.equal(render.args[1].document_number, doc.document_number);
    assert.equal(render.args[2], sig);
  }
});

test("sign: a refusal returns the error and copies nothing", async () => {
  const { calls, deps } = fakes({ sign: { error: "The document changed. Open it again and sign." } });
  assert.deepEqual(await signAccounting(agrDoc, deps), { error: "The document changed. Open it again and sign." });
  assert.equal(names(calls).includes("saveLocal"), false);
  const thrown = fakes({ sign: new Error("network down") });
  assert.deepEqual(await signAccounting(agrDoc, thrown.deps), { error: "network down" });
});

test("sign never calls the retired approval", async () => {
  const { deps } = fakes();
  assert.equal("approve" in deps, false);
  const src = (await import("node:fs")).readFileSync(new URL("../services/accountingGenerate.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /approve\(|approveAgreement|loadSignature/);
});

test("edit: update then rebuild unsigned then attach", async () => {
  const { calls, deps } = fakes({ attach: (id) => ({ ...agrDoc, id }) });
  const r = await editAgreement(agrDoc, agreement, deps);
  assert.equal(r.error, undefined);
  assert.deepEqual(names(calls), ["check", "loadTemplate", "update", "render", "toPdf", "upload", "upload", "attach"]);
  assert.equal(calls.find((c) => c.name === "render").args[1].has_signature, false);
  assert.equal(names(calls).includes("sign"), false);
});

test("mail draft: Ref, option names and totals, no sums", async () => {
  const { calls, deps } = fakes();
  await generateQuote(qIn(), deps);
  const m = calls.find((c) => c.name === "createMail").args;
  const text = `${m[1].subject}\n${m[1].body}`;
  assert.equal(m[0].id, "d1");
  assert.match(text, /ABC\/2026\/11\/ACQ001/);
  assert.match(text, /Basic/);
  assert.match(text, /Plus/);
  assert.match(text, /AED 1,000 per month/);
  assert.match(text, /AED 500 per year/);
  assert.match(text, /AED 2,000 per month/);
  assert.doesNotMatch(text, /1,500|3,000|3,500|2,500/);
});

test("save now copies stored files and records the path", async () => {
  const { calls, deps } = fakes({ loadBlobs: { wordBlob: "W", pdfBlob: "P" } });
  const r = await saveToOneDrive(quoteDoc, deps);
  assert.equal(r.onedrive, "C:\\OneDrive\\Proposals");
  assert.deepEqual(names(calls), ["loadBlobs", "saveLocal", "markSaved"]);
  const off = fakes({ loadBlobs: { wordBlob: "W", pdfBlob: "P" }, saveLocal: null });
  assert.ok((await saveToOneDrive(quoteDoc, off.deps)).error);
  assert.equal(names(off.calls).includes("markSaved"), false);
});

test("retry with mail false creates no second mail draft", async () => {
  const first = fakes({ toPdf: new Error("pdf broke") });
  const r = await generateQuote(qIn(), first.deps);
  const second = fakes();
  await retryDocument(r.doc, second.deps, { mail: false });
  assert.equal(names(second.calls).includes("createMail"), false);
  const third = fakes();
  await retryDocument(r.doc, third.deps);
  assert.equal(names(third.calls).includes("createMail"), true);
});

test("mail drafts place the closing mark above the closing block", () => {
  const agreement = mailText({ document_number: "ABA001", client_name: "C", contact_name: "Sam", library_template: "AB Capital/Accounting Agreement" }, {});
  assert.match(agreement.body, /\n\n-- closing --\nKind regards,\nAB Capital Services FZE$/);
  assert.equal(agreement.body.split("-- closing --").length, 2);
});
test("quote drafts also carry the closing mark", () => {
  const q = mailText({ document_number: "ABA002", client_name: "C", contact_name: "Sam", field_values: { quote } }, {});
  assert.match(q.body, /\n\n-- closing --\nKind regards,\nAB Capital Services FZE$/);
});
