// Fixes from the phase 2 whole-branch review that need no database.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { caseInvoiceFilter, caseRowFor } from "../logic/caseWorkspace.js";
import { leadActions } from "../logic/leads.js";
import { lineVatData, quoteContext, withLineVat } from "../logic/quoteData.js";
import { paymentLinkError, quoteMessage } from "../logic/quoteMessage.js";

const here = fileURLToPath(new URL("..", import.meta.url));
const rd = (f) => readFileSync(join(here, f), "utf8");

test("every screen action shows its error: useAction's error is never dropped", () => {
  for (const d of ["components", "components/workspace"]) {
    for (const f of readdirSync(join(here, d)).filter((x) => x.endsWith(".jsx"))) {
      const src = rd(join(d, f));
      for (const m of src.matchAll(/const \{([^}]*)\} = useAction\(/g)) assert.match(m[1], /\berror\b/, `${f}: useAction drops error`);
    }
  }
  const signed = rd("components/workspace/Quotes.jsx").split("function SignedCopy")[1];
  assert.match(signed, /<ErrorNote message=\{list\.error \|\| error\}/, "Confirm and accept and Add signed copy must show their error");
});

test("the Documentation page keeps the last known row of a case that left its list", () => {
  const last = { id: "c1", case_number: "BSC1", client_id: "CL1", stage: "Documentation" };
  assert.deepEqual(caseRowFor([last], "c1", null, false), { row: last, moved: false });
  assert.deepEqual(caseRowFor([], "c1", last, false), { row: last, moved: true });
  // Still loading, or a list that has not arrived: not moved.
  assert.deepEqual(caseRowFor([], "c1", last, true), { row: last, moved: false });
  assert.deepEqual(caseRowFor(null, "c1", last, false), { row: last, moved: false });
  assert.deepEqual(caseRowFor(null, "c1", null, true), { row: { id: "c1" }, moved: false });
});

test("lead actions: Finance records a payment and gets no assign, move or lost", () => {
  const finance = (p) => ["setup.access", "setup.payments.manage"].includes(p);
  const open = { id: "c", stage: "Lead" };
  assert.deepEqual(leadActions(finance, open, "me"), { pay: true, assign: false, move: false, lost: false, reassign: false });
  const sales = (p) => ["setup.access", "setup.leads.manage"].includes(p);
  assert.deepEqual(leadActions(sales, open, "me"), { pay: false, assign: true, move: false, lost: true, reassign: false });
  assert.equal(leadActions(finance, { id: "c", stage: "Lost" }, "me").pay, false);
  const leads = rd("components/AllLeads.jsx");
  assert.match(leads, /<Payments /); assert.match(leads, /Record payment/);
});

test("a case's invoices also match those carrying only a quote of the case", () => {
  assert.equal(caseInvoiceFilter("c1", ["q1", "q2"]), "case_id.eq.c1,quote_id.in.(q1,q2)");
  assert.equal(caseInvoiceFilter("c1", []), "case_id.eq.c1");
  assert.match(rd("services/businessSetupApi.js"), /caseInvoiceFilter\(/);
});

test("Finance is told to ask, not to link, when the client already exists", () => {
  const dup = "A client like this already exists: CL1 Acme (same email). Link that client, or confirm this is a new one.";
  assert.equal(paymentLinkError(dup, false), "This client already exists. Ask a manager or Sales to link it.");
  assert.equal(paymentLinkError(dup, true), dup);
  assert.equal(paymentLinkError("Something else", false), "Something else");
  assert.match(rd("components/workspace/Payments.jsx"), /paymentLinkError\(/);
});

test("an old inclusive quote's net is the total less its VAT; no-VAT and exclusive stay as they were", () => {
  const lines = [{ service_name: "A", amount: 1050 }];
  const at = "2026-10-19T08:00:00Z";
  assert.equal(quoteContext({ created_at: at, vat_mode: "inclusive", vat_amount: 50, total_amount: 1050, lines }, null, 3.6725).net, "1,000");
  assert.equal(quoteContext({ created_at: at, vat_mode: "none", vat_amount: 0, total_amount: 1050, lines }, null, 3.6725).net, "1,050");
  assert.equal(quoteContext({ created_at: at, vat_mode: "exclusive", vat_amount: 50, total_amount: 1050, lines: [{ service_name: "A", amount: 1000 }] }, null, 3.6725).net, "1,000");
});

test("scope of work reaches the zone template items and the built-in rows, and falls back to the service name", () => {
  const lines = [{ service_name: "Visa", description: "Visa", amount: 100, scope: "Two investor visas" }, { service_name: "Licence", description: "Renewal Licence", amount: 200, scope: "" }];
  const items = quoteContext({ created_at: "2026-10-19T08:00:00Z", vat_mode: "exclusive", lines }, null, 3.6725).items;
  assert.equal(items[0].scope, "Two investor visas"); assert.equal(items[1].scope, "Licence");
  const rows = lineVatData({ total_amount: 315, vat_amount: 15, lines }).lines;
  assert.equal(rows[0].scope, "Two investor visas"); assert.equal(rows[1].scope, "Renewal Licence");
  // The Word row prints the scope beside the name only when it says something the name does not.
  assert.equal(rows[0].scope_note, "Two investor visas"); assert.equal(rows[1].scope_note, "");
});

test("the quote panel shows the scope of work", () => {
  assert.match(rd("components/workspace/Quotes.jsx").split("function Quote(")[1], /l\.scope/);
});

test("withLineVat adds the breakdown to an exclusive quote only", () => {
  const data = { lines: [], total: "1" };
  assert.equal(withLineVat({ vat_mode: "inclusive" }, data), data);
  assert.equal(withLineVat({ vat_mode: "exclusive", total_amount: 105, vat_amount: 5, lines: [] }, data).show_breakdown, true);
});

test("the quote message names the company as the rebrand does", () => {
  const m = quoteMessage({ contact: "Sara", number: "Q1", url: "https://p/", username: "u" });
  assert.match(m, /the AB Capital Services FZE client portal/); assert.match(m, /contact AB Capital Services FZE\./); assert.match(m, /Regards,\nAB Capital Services FZE$/);
  assert.match(quoteMessage({ contact: "S", number: "Q", url: "u", username: "u", company: "Stored Co" }), /Regards,\nStored Co$/);
});
