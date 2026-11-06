import { assertEquals } from "jsr:@std/assert@1";
import { taxItemsToStore } from "./rules.ts";

const now = new Date("2026-11-05T22:00:00Z"); // Already 6 November in Dubai.

Deno.test("a dated item is stored with its Dubai due date", () => {
  assertEquals(taxItemsToStore([{ clientId: "C1", category: "VAT", title: "VAT return & payment", period: "Period ending 31/10/2026", daysLeft: 22, status: "due_30" }], now), [
    { item_key: "C1:VAT:VAT return & payment:Period ending 31/10/2026", client_id: "C1", title: "VAT return & payment (Period ending 31/10/2026)", due_date: "2026-11-28" },
  ]);
});
Deno.test("an overdue item keeps its past date", () => {
  assertEquals(taxItemsToStore([{ clientId: "C1", category: "VAT", title: "T", daysLeft: -2, status: "overdue" }], now)[0].due_date, "2026-11-04");
});
Deno.test("items asking for data are left out", () => {
  assertEquals(taxItemsToStore([
    { clientId: "C1", category: "VAT", title: "VAT TRN missing", daysLeft: null, status: "missing" },
    { clientId: "C1", category: "CT", title: "Done", daysLeft: 3, status: "done" },
    { clientId: "", category: "CT", title: "No client", daysLeft: 3, status: "due_14" },
  ], now), []);
});
Deno.test("only VAT and Corporate Tax items raise tax alerts", () => {
  const stored = taxItemsToStore([
    { clientId: "C1", category: "Trade Licence", title: "Trade licence renewal", daysLeft: 10, status: "due_14" },
    { clientId: "C1", category: "Engagement", title: "Engagement renewal", daysLeft: 10, status: "due_14" },
    { clientId: "C1", category: "VAT", title: "VAT return & payment", daysLeft: 10, status: "due_14" },
    { clientId: "C1", category: "Corporate Tax", title: "Corporate Tax return & payment", daysLeft: 10, status: "due_14" },
  ], now);
  assertEquals(stored.map((i) => i.title), ["VAT return & payment", "Corporate Tax return & payment"]);
});
