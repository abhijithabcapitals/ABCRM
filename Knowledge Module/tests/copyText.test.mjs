import test from "node:test";
import assert from "node:assert/strict";
import { canCopy, needsConfirm, htmlToText, priceLinesToText, bankingPriceToText, entryToText } from "../logic/copyText.js";

const line = (o = {}) => ({
  template: "Mainland", line_group: "Visa", item: "Visa stamp", amount_aed: 1250, status: "Approved", visibility: "Shareable",
  payee: "Test Payee", basis: "Test basis", confidence: "High", ...o,
});

test("canCopy is false for Internal, true for Shareable Draft and Approved", () => {
  assert.equal(canCopy({ visibility: "Internal", status: "Approved" }), false);
  assert.equal(canCopy({ visibility: "Shareable", status: "Draft" }), true);
  assert.equal(canCopy({ visibility: "Shareable", status: "Approved" }), true);
});
test("needsConfirm is true only for Draft", () => {
  assert.equal(needsConfirm({ status: "Draft" }), true);
  assert.equal(needsConfirm({ status: "Approved" }), false);
});
test("priceLinesToText leaves out Internal lines even when given a mixed group", () => {
  const text = priceLinesToText([line(), line({ item: "Secret fee", amount_aed: 99, visibility: "Internal" })], "Visa costs");
  assert.ok(text.includes("Visa stamp"));
  assert.ok(!text.includes("Secret fee"));
});
test("priceLinesToText never contains basis, confidence, payee or the word Draft", () => {
  const text = priceLinesToText([line({ status: "Draft" })], "Visa costs");
  for (const word of ["Test basis", "Test Payee", "High", "Draft", "confidence", "basis", "payee"]) assert.ok(!text.includes(word), word);
});
test("priceLinesToText formats amounts", () => {
  assert.match(priceLinesToText([line()], "Visa costs"), /Visa stamp: AED 1,250/);
  assert.match(priceLinesToText([line({ amount_aed: 1250.5 })], "T"), /AED 1,250\.50/);
});
test("price text ends with the VAT sentence", () => {
  assert.ok(priceLinesToText([line()], "Visa costs").endsWith("Prices exclude VAT unless stated otherwise."));
});
test("a group with only Internal lines gives empty text", () => {
  assert.equal(priceLinesToText([line({ visibility: "Internal" })], "Visa costs"), "");
  assert.equal(priceLinesToText([], "Visa costs"), "");
});
test("bankingPriceToText lists the customer-facing amounts and the VAT sentence", () => {
  const text = bankingPriceToText({ bank_name: "Test Bank", scheme_name: "Gold", account_opening_fee: 500, initial_deposit: 10000, minimum_balance: null, other_bank_charges: 0, service_fee: 75.5 });
  assert.ok(text.startsWith("Test Bank - Gold"));
  assert.match(text, /Account opening fee: AED 500/);
  assert.match(text, /Initial deposit: AED 10,000/);
  assert.match(text, /Service fee: AED 75\.50/);
  assert.ok(!text.includes("Minimum balance"));
  assert.ok(text.endsWith("Prices exclude VAT unless stated otherwise."));
});
test("entryToText gives the title then the body as plain text", () => {
  assert.equal(entryToText({ title: "Visa steps", body: "<p>Step one</p><p>Step two</p>" }), "Visa steps\n\nStep one\nStep two");
});
test("htmlToText keeps table rows as lines, cells split by ' | ', and decodes &nbsp; and &amp;", () => {
  const html = "<table><tr><th>Item</th><th>Cost</th></tr><tr><td>Visa&nbsp;stamp</td><td>AED 1,250</td></tr><tr><td>R &amp; D</td><td>10</td></tr></table>";
  assert.equal(htmlToText(html), "Item | Cost\nVisa stamp | AED 1,250\nR & D | 10");
});
test("htmlToText drops script and style content", () => {
  assert.equal(htmlToText("<style>p{color:red}</style><p>Hello</p><script>alert(1)</script>"), "Hello");
});
test("htmlToText turns list items and line breaks into lines", () => {
  assert.equal(htmlToText("<ul><li>One</li><li>Two<br>three</li></ul>"), "- One\n- Two\nthree");
});
