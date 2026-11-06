// node --test "Template Module/tests/proposalGenerate.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { checkProposal } from "../logic/proposalModel.js";
import { generateProposal, retryProposal, saveToOneDrive, proposalMail } from "../services/proposalGenerate.js";

const form = { client: "Sample Client", contact: "Sam", email: "s@example.com", phone: "050" };
const option = (key, name, amount) => ({ authority_key: key, authority_name: name, activity: "Consulting", title: "", description: "", logo_path: `logos/${key}.png`, timeline_path: null, package_includes: [], red_notes: [], services: [{ name: "Licence", remarks: "", amount, subs: [] }] });
const proposal = { usd_rate: 3.6725, options: [option("a", "Authority A", "1,000"), option("b", "Authority B", "2,500")], shared: {} };
const created = { id: "d1", document_number: "ABC/2026/11/BSQ009", client_name: "Sample Client", contact_name: "Sam", contact_email: "s@example.com", department: "Business Setup", services: ["Licence"], lines: [{ description: "Licence", amount: 1000 }], vat_mode: "none", vat_rate: 0, created_at: "2026-11-05T08:00:00Z", field_values: { proposal: { usd_rate: 3.6725, options: [option("a", "Authority A", 1000), option("b", "Authority B", 2500)], shared: {} } } };
const input = (over = {}) => ({ form, proposal, clientId: "CL000001", settings: { company: {} }, guard: { busy: false }, ...over });

function fakes(over = {}) {
  const calls = [];
  const note = (name, value) => async (...args) => {
    calls.push({ name, args });
    const v = typeof value === "function" ? value(...args) : value;
    if (v instanceof Error) throw v;
    return v;
  };
  const base = {
    checkFirst: checkProposal, create: created, loadTemplate: "BUFFER", loadImages: {}, render: "WORD", toPdf: "PDF",
    upload: (doc, blob, ext) => `Business Setup/${doc.id}/x.${ext}`, attach: { ...created, storage_path: "p.pdf", word_path: "p.docx" }, saveLocal: "C:/Office/Prop", markSaved: { ok: 1 }, createMail: { id: "m1" },
  };
  return { calls, deps: Object.fromEntries(Object.entries({ ...base, ...over }).map(([k, v]) => [k, note(k, v)])) };
}
const names = (calls) => calls.map((c) => c.name);

test("order: check, template, images, trial render, create, render, pdf, uploads, attach, save, mark, mail", async () => {
  const { calls, deps } = fakes();
  const out = await generateProposal(input(), deps);
  assert.deepEqual(names(calls), ["checkFirst", "loadTemplate", "loadImages", "render", "create", "render", "toPdf", "upload", "upload", "attach", "saveLocal", "markSaved", "createMail"]);
  assert.deepEqual(calls.filter((c) => c.name === "upload").map((c) => c.args[2]), ["pdf", "docx"]);
  assert.equal(out.onedrive, "C:/Office/Prop");
  assert.equal(out.doc.id, "d1");
  assert.ok(out.wordBlob && out.pdfBlob);
  const attach = calls.find((c) => c.name === "attach");
  assert.deepEqual(attach.args, ["d1", "Business Setup/d1/x.pdf", "Business Setup/d1/x.docx"]);
  assert.equal(calls.find((c) => c.name === "markSaved").args[1], "C:/Office/Prop");
});

test("trial render has no number; the real render has it", async () => {
  const { calls, deps } = fakes();
  await generateProposal(input(), deps);
  const renders = calls.filter((c) => c.name === "render");
  assert.equal(renders[0].args[1].ref_no, "");
  assert.equal(renders[1].args[1].ref_no, created.document_number);
});

test("bad template takes no number", async () => {
  const { calls, deps } = fakes({ render: new Error("template broken") });
  const out = await generateProposal(input(), deps);
  assert.match(out.error, /template broken/);
  assert.equal(out.doc, undefined);
  assert.ok(!names(calls).includes("create"));
});

test("check fails: create not called", async () => {
  const { calls, deps } = fakes();
  const out = await generateProposal(input({ form: { ...form, client: "" } }), deps);
  assert.match(out.error, /client name/i);
  assert.deepEqual(names(calls), ["checkFirst"]);
});

test("pdf fails after the number: keeps doc, no attach, retry takes no new number", async () => {
  const { calls, deps } = fakes({ toPdf: new Error("pdf failed") });
  const out = await generateProposal(input(), deps);
  assert.equal(out.doc.id, "d1");
  assert.match(out.error, /pdf failed/);
  assert.ok(!names(calls).includes("attach"));
  const retry = fakes();
  const again = await retryProposal(out.doc, retry.deps);
  assert.ok(!names(retry.calls).includes("create"));
  assert.ok(names(retry.calls).includes("attach"));
  assert.equal(again.error, undefined);
  const real = retry.calls.find((c) => c.name === "render");
  assert.equal(real.args[1].ref_no, created.document_number);
  assert.equal(real.args[1].options.length, 2);
});

test("client module off: succeeds with onedrive null, markSaved not called", async () => {
  const { calls, deps } = fakes({ saveLocal: null });
  const out = await generateProposal(input(), deps);
  assert.equal(out.error, undefined);
  assert.equal(out.onedrive, null);
  assert.ok(!names(calls).includes("markSaved"));
  assert.ok(names(calls).includes("createMail"));
});

test("double click makes one create", async () => {
  const { calls, deps } = fakes();
  const guard = { busy: false };
  const [a, b] = await Promise.all([generateProposal(input({ guard }), deps), generateProposal(input({ guard }), deps)]);
  assert.equal(calls.filter((c) => c.name === "create").length, 1);
  assert.deepEqual([a.error, b.error].filter(Boolean), ["Already generating."]);
  assert.equal(guard.busy, false);
});

test("an image that is gone does not stop generation", async () => {
  const { deps } = fakes({ loadImages: {} });
  const out = await generateProposal(input(), deps);
  assert.equal(out.error, undefined);
});

test("mail draft has the Ref and each option's authority and total, no sum", async () => {
  const { calls, deps } = fakes();
  await generateProposal(input(), deps);
  const [doc, mail] = calls.find((c) => c.name === "createMail").args;
  assert.equal(doc.id, "d1");
  assert.match(mail.subject, /BSQ009/);
  assert.match(mail.body, /BSQ009/);
  assert.match(mail.body, /Authority A/);
  assert.match(mail.body, /1,000/);
  assert.match(mail.body, /Authority B/);
  assert.match(mail.body, /2,500/);
  assert.doesNotMatch(mail.body, /3,500/);
  assert.equal(proposalMail(created).body, mail.body);
});

test("mail draft ends with the proposal contact from Settings as its signature", () => {
  const contact = { name: "Sam Signer", phone: "+971-500000000", email: "sam@example.com", website: "www.example.com" };
  const body = proposalMail(created, { proposal_defaults: { contact }, company: { short_name: "Example Co FZE" } }).body;
  assert.match(body, /Kind regards\nSam Signer\nExample Co FZE\n\+971-500000000\nsam@example\.com\nwww\.example\.com$/);
});

test("mail draft without a contact in Settings ends at Kind regards", () => {
  assert.match(proposalMail(created).body, /Kind regards$/);
  assert.match(proposalMail(created, { proposal_defaults: { contact: { name: "", phone: "" } } }).body, /Kind regards$/);
});

test("a mail failure keeps the files and reports the error with the doc", async () => {
  const { deps } = fakes({ createMail: new Error("mail row failed") });
  const out = await generateProposal(input(), deps);
  assert.equal(out.doc.id, "d1");
  assert.match(out.error, /mail row failed/);
});

test("saveToOneDrive reloads the stored files and records the path", async () => {
  const calls = [];
  const deps = {
    loadStored: async (p) => { calls.push(["load", p]); return `BLOB:${p}`; },
    saveLocal: async (doc, w, p) => { calls.push(["save", w, p]); return "C:/Office/Prop"; },
    markSaved: async (id, path) => { calls.push(["mark", id, path]); },
  };
  const path = await saveToOneDrive({ id: "d1", storage_path: "a.pdf", word_path: "a.docx" }, deps);
  assert.equal(path, "C:/Office/Prop");
  assert.deepEqual(calls.at(-1), ["mark", "d1", "C:/Office/Prop"]);
  assert.deepEqual(calls.find((c) => c[0] === "save"), ["save", "BLOB:a.docx", "BLOB:a.pdf"]);
  const off = await saveToOneDrive({ id: "d1", storage_path: "a.pdf", word_path: "a.docx" }, { ...deps, saveLocal: async () => null });
  assert.equal(off, null);
});
