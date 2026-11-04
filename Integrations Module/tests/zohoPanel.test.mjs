// The Zoho panel's rules, and checks that the screens use it without ever blocking Send to Accounts.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  NOT_CONNECTED, contactLinkable, contactLine, createRights, formatAmount, panelMode, panelNotes, pdfReply, replaceQuestion, rowActions, rowNotes,
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
  for (const a of ["contact_get", "contacts_search", "contact_link", "document_create", "document_state", "document_pdf"]) assert.ok(panel.includes(a), a);
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
