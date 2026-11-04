// The Zoho panel's rules, and checks that the screens use it without ever blocking Send to Accounts.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  NOT_CONNECTED, POPUP_BLOCKED, callZoho, contactLinkable, linkContact, makeGuard, openPdf, readInvokeError, safeZohoUrl, contactLine, createRights, formatAmount, panelMode, panelNotes, pdfReply, replaceQuestion, rowActions, rowNotes,
} from "../logic/zohoPanel.js";

const file = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const read = (rel) => readFileSync(file(rel), "utf8");

test("panelMode covers every state", () => {
  assert.equal(panelMode({ connected: false }), "not_connected");
  assert.equal(panelMode({ connected: true, linked: false }), "needs_contact");
  assert.equal(panelMode({ connected: true }), "needs_contact");
  assert.equal(panelMode({ connected: true, linked: true }), "ready");
  assert.equal(panelMode({ connected: true, linked: true, row: { state: "created" } }), "created");
  assert.equal(panelMode({ connected: true, linked: true, row: { state: "failed" } }), "failed");
  assert.equal(panelMode({ connected: true, linked: true, row: { state: "unknown" } }), "unknown");
  assert.equal(panelMode({ connected: true, linked: true, row: { state: "creating" } }), "unknown");
  assert.equal(panelMode({ connected: true, linked: true, row: { state: "gone" } }), "gone");
  assert.equal(panelMode(), "needs_contact");
});

test("a saved row still shows when Zoho is not connected", () => {
  assert.equal(panelMode({ connected: false, row: { state: "created" } }), "created");
  assert.equal(panelMode({ connected: false, row: { state: "failed" } }), "failed");
});

test("create shows only for people allowed, when connected and linked", () => {
  const ok = { canCreate: true, connected: true, linked: true };
  assert.equal(rowActions("ready", ok).create, "Create draft");
  assert.equal(rowActions("failed", ok).create, "Try again");
  assert.equal(rowActions("gone", ok).create, "Create again");
  assert.equal(rowActions("unknown", ok).create, "Check and try again");
  assert.equal(rowActions("ready", { ...ok, canCreate: false }).create, null);
  assert.equal(rowActions("failed", { ...ok, connected: false }).create, null);
  assert.equal(rowActions("needs_contact", ok).create, null);
  assert.equal(rowActions("not_connected", ok).create, null);
  assert.equal(rowActions("created", ok).create, null);
});

test("View PDF and Open in Zoho show only for a created row", () => {
  assert.deepEqual(rowActions("created", { hasUrl: true }), { create: null, viewPdf: true, openZoho: true });
  assert.equal(rowActions("created", { hasUrl: false }).openZoho, false);
  for (const m of ["ready", "failed", "unknown", "gone", "needs_contact", "not_connected"]) {
    const a = rowActions(m, { canCreate: true, connected: true, linked: true, hasUrl: true });
    assert.equal(a.viewPdf, false, m);
    assert.equal(a.openZoho, false, m);
  }
});

test("rights can be one flag or one per kind", () => {
  assert.deepEqual(createRights(true), { estimate: true, invoice: true });
  assert.deepEqual(createRights(undefined), { estimate: false, invoice: false });
  assert.deepEqual(createRights({ estimate: true, invoice: false }), { estimate: true, invoice: false });
});

test("not connected keeps the current notice, and hides the missing-credentials echo", () => {
  assert.deepEqual(panelNotes({ connected: false, readError: "Zoho credentials are missing." }), [{ tone: "warn", text: NOT_CONNECTED }]);
  assert.equal(NOT_CONNECTED, "Invoice: Zoho is not connected yet. You can still send this to Accounts.");
  const stopped = panelNotes({ connected: false, readError: "Zoho access has stopped. An admin must reconnect." });
  assert.equal(stopped.length, 2);
  assert.deepEqual(panelNotes({ connected: true, readError: "Zoho is busy, try again shortly." }), []);
});

test("row notes: total and earlier draft are warnings, read errors stay on their row", () => {
  const notes = rowNotes({ state: "created", total_warning: true, earlier_draft: "EST-0007", read_error: "Zoho is busy, try again shortly." }, "created");
  assert.equal(notes.length, 3);
  assert.ok(notes.every((n) => n.tone === "warn"));
  assert.match(notes[1].text, /EST-0007/);
  assert.equal(rowNotes({ state: "failed", error: "Zoho refused the request." }, "failed")[0].tone, "error");
  assert.equal(rowNotes({ state: "unknown", error: "Wait 2 minutes." }, "unknown")[0].tone, "warn");
  assert.equal(rowNotes({ state: "created", error: "Same", read_error: "Same" }, "created").length, 1);
  assert.deepEqual(rowNotes(null, "ready"), []);
});

test("contacts: only AED contacts can be linked, and the line shows name, TRN and currency", () => {
  assert.equal(contactLinkable({ currency_code: "AED" }), true);
  assert.equal(contactLinkable({ currency_code: "usd" }), false);
  assert.equal(contactLine({ name: "Acme", tax_reg_no: "100", currency_code: "AED" }), "Acme · TRN 100 · AED");
  assert.equal(contactLine({ name: "Acme", tax_reg_no: null, currency_code: "" }), "Acme · No TRN · No currency");
  assert.equal(replaceQuestion("Acme LLC"), "This client is linked to Acme LLC. Replace it?");
});

test("a PDF reply is a PDF blob; JSON or anything else is an error", () => {
  assert.deepEqual(pdfReply(new Blob(["%PDF"], { type: "application/pdf" })), { ok: true });
  assert.deepEqual(pdfReply({ error: "Zoho access has stopped. An admin must reconnect." }), { ok: false, message: "Zoho access has stopped. An admin must reconnect." });
  assert.equal(pdfReply(new Blob(["{}"], { type: "application/json" })).ok, false);
  assert.equal(pdfReply(null).ok, false);
  assert.equal(pdfReply("text").ok, false);
});

test("amounts show two places", () => {
  assert.equal(formatAmount(1234.5), "1,234.50");
  assert.equal(formatAmount(null), "0.00");
  assert.equal(formatAmount("x"), "");
});

test("the panel never disables Send to Accounts, and calls only the named actions", () => {
  const panel = read("../components/ZohoPanel.jsx");
  assert.doesNotMatch(panel, /Send to Accounts|bk-complete/);
  const code = panel + read("../logic/zohoPanel.js");
  for (const a of ["contact_get", "contacts_search", "contact_link", "document_create", "document_state", "document_pdf"]) assert.ok(code.includes(a), a);
  assert.doesNotMatch(panel, /client_secret|refresh_token/i);
  assert.match(panel, /rel="noopener noreferrer"/);
  assert.match(panel, /target="_blank"/);
});

test("both screens use the panel and keep their handover buttons", () => {
  const quotes = read("../../Business Setup Module/components/workspace/Quotes.jsx");
  const bank = read("../../Banking Module/components/BankProcess.jsx");
  assert.match(quotes, /import ZohoPanel from "@integrations\/components\/ZohoPanel"/);
  assert.match(bank, /import ZohoPanel from "@integrations\/components\/ZohoPanel"/);
  assert.match(quotes, /<ZohoPanel[^>]*sourceTable="hub_documents"/);
  assert.match(bank, /<ZohoPanel[^>]*sourceTable="banking_quotations"/);
  assert.ok(quotes.includes("Send to Accounts"));
  assert.ok(bank.includes('id="bk-complete"'));
  assert.ok(bank.indexOf("<ZohoPanel") < bank.indexOf('id="bk-complete"'));
  assert.doesNotMatch(quotes + bank, /ZohoInvoicePanel/);
});

test("the old placeholder is gone and the module exports the panel", () => {
  assert.equal(existsSync(file("../../Business Setup Module/components/ZohoInvoicePanel.jsx")), false);
  assert.match(read("../index.js"), /ZohoPanel/);
});

const pdfBlob = () => new Blob(["%PDF"], { type: "application/pdf" });
const fakeTab = () => ({ closed: false, opener: {}, location: { href: "" }, close() { this.closed = true; } });

test("a failed call gives the function's own message, else the library's", async () => {
  assert.equal(await readInvokeError({ message: "Edge Function returned a non-2xx status code", context: { json: async () => ({ error: "Choose a client first." }) } }), "Choose a client first.");
  assert.equal(await readInvokeError({ message: "plain", context: { json: async () => { throw new Error("not json"); } } }), "plain");
  assert.equal(await readInvokeError({ message: "plain" }), "plain");
  const supabase = (result) => ({ functions: { invoke: async () => result } });
  await assert.rejects(callZoho(supabase({ data: null, error: { message: "x", context: { json: async () => ({ error: "Zoho is busy, try again shortly." }) } } }), {}), /Zoho is busy/);
  await assert.rejects(callZoho(supabase({ data: { error: "Unknown action." }, error: null }), {}), /Unknown action/);
  const blob = pdfBlob();
  assert.equal(await callZoho(supabase({ data: blob, error: null }), {}), blob);
});

test("openPdf: blocked tab, non-PDF reply, failed call and good reply", async () => {
  const base = { makeUrl: () => "blob:x", revoke: () => {}, later: () => {} };
  assert.deepEqual(await openPdf({ ...base, openTab: () => null, fetchPdf: async () => { throw new Error("must not be called"); } }), { ok: false, message: POPUP_BLOCKED });

  let tab = fakeTab();
  let res = await openPdf({ ...base, openTab: () => tab, fetchPdf: async () => ({ error: "No longer in Zoho." }) });
  assert.equal(res.ok, false);
  assert.equal(tab.closed, true);
  assert.equal(tab.location.href, "");

  tab = fakeTab();
  res = await openPdf({ ...base, openTab: () => tab, fetchPdf: async () => { throw new Error("Zoho refused the request."); } });
  assert.deepEqual(res, { ok: false, message: "Zoho refused the request." });
  assert.equal(tab.closed, true);

  tab = fakeTab();
  const later = [];
  const revoked = [];
  res = await openPdf({ openTab: () => tab, fetchPdf: async () => pdfBlob(), makeUrl: () => "blob:abc", revoke: (u) => revoked.push(u), later: (fn, ms) => later.push([fn, ms]) });
  assert.deepEqual(res, { ok: true });
  assert.equal(tab.location.href, "blob:abc");
  assert.equal(tab.closed, false);
  assert.equal(tab.opener, null);
  assert.equal(later[0][1], 60000);
  later[0][0]();
  assert.deepEqual(revoked, ["blob:abc"]);
});

test("openPdf: a reply for a quote that is no longer shown is dropped and the tab closed", async () => {
  const tab = fakeTab();
  const res = await openPdf({ openTab: () => tab, fetchPdf: async () => pdfBlob(), makeUrl: () => { throw new Error("no url"); }, revoke: () => {}, later: () => {}, isStale: () => true });
  assert.deepEqual(res, { ok: false, stale: true });
  assert.equal(tab.closed, true);
});

test("link: a saved link, and a client that already has another contact", async () => {
  const sent = [];
  const call = (reply) => async (body) => { sent.push(body); return reply; };
  const contact = { id: "c1", name: "Acme" };
  const first = await linkContact({ call: call({ needs_replace: true, current_name: "Old Co" }), clientId: "k1", department: "banking", contact });
  assert.deepEqual(first, { status: "needs_replace", currentName: "Old Co" });
  assert.equal("replace" in sent[0], false);
  const second = await linkContact({ call: call({ ok: true, zoho_contact_id: "c1", zoho_contact_name: "Acme LLC" }), clientId: "k1", department: "banking", contact, replace: true });
  assert.deepEqual(second, { status: "linked", name: "Acme LLC" });
  assert.equal(sent[1].replace, true);
  assert.equal(sent[1].zoho_contact_id, "c1");
});

test("guard: a reply that started before the source changed is no longer valid", () => {
  const g = makeGuard();
  const t = g.token();
  assert.equal(g.valid(t), true);
  g.next();
  assert.equal(g.valid(t), false);
  assert.equal(g.valid(g.token()), true);
});

test("Open in Zoho only for Zoho Books links", () => {
  assert.equal(safeZohoUrl("https://books.zoho.ae/app/1#/invoices/2"), "https://books.zoho.ae/app/1#/invoices/2");
  assert.equal(safeZohoUrl("https://evil.example/books.zoho."), null);
  assert.equal(safeZohoUrl("javascript:alert(1)"), null);
  assert.equal(safeZohoUrl(null), null);
});

test("the panel waits for a press before reading, and a new quote starts it fresh", () => {
  const panel = read("../components/ZohoPanel.jsx");
  assert.match(panel, /Show Zoho details/);
  assert.equal((panel.match(/action: "document_state"/g) || []).length, 1);
  assert.doesNotMatch(panel, /useEffect\([^)]*load\(/);
  assert.match(read("../../Business Setup Module/components/workspace/Quotes.jsx"), /<ZohoPanel key=\{`\$\{q\.id\}:\$\{clientId\}`\}/);
  assert.match(read("../../Banking Module/components/BankProcess.jsx"), /<ZohoPanel key=\{`\$\{quoteId\}:\$\{client\.client_master_id\}`\}/);
});

test("Banking: the quotation read is guarded and cannot fail the step", () => {
  const bank = read("../../Banking Module/components/BankProcess.jsx");
  assert.match(bank, /can\("quotes\.view"\) \? run\(table\("banking_quotations"\)[^\n]*\.catch\(\(\) => "error"\) : "denied"/);
});
