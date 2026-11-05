import { assertEquals } from "jsr:@std/assert@1";
import { attachmentsFor, refusal } from "./rules.ts";

const ID = "11111111-2222-3333-4444-555555555555";
const good = {
  id: ID, library_template: "AB Capital/Proposal", storage_path: `Business Setup/${ID}/Proposal-Q001.pdf`,
  word_path: `Business Setup/${ID}/Proposal-Q001.docx`, contact_email: "client@example.com",
  mail_subject: "Your business setup proposal", mail_sent_at: null as string | null,
};

Deno.test("attachmentsFor returns only the PDF, even with a Word file", () => {
  assertEquals(attachmentsFor(good), [good.storage_path]);
  assertEquals(attachmentsFor({ ...good, word_path: null }), [good.storage_path]);
  assertEquals(attachmentsFor({ ...good, storage_path: null }), []);
});

Deno.test("a complete, unsent proposal passes", () => {
  assertEquals(refusal(good, { resend: false }), null);
});

Deno.test("refusals are named", () => {
  assertEquals(refusal({ ...good, library_template: "AB Capital/Letter" }, {}), "This document is not a proposal.");
  assertEquals(refusal({ ...good, storage_path: null }, {}), "This proposal has no PDF yet. Generate it first.");
  assertEquals(refusal({ ...good, mail_subject: "  " }, {}), "Write the mail draft with a subject first.");
  assertEquals(refusal({ ...good, mail_subject: null }, {}), "Write the mail draft with a subject first.");
  assertEquals(refusal({ ...good, storage_path: "Business Setup/other/x.pdf" }, {}), "This proposal's file path is not valid.");
  assertEquals(refusal({ ...good, storage_path: `Business Setup/${ID}/../x.pdf` }, {}), "This proposal's file path is not valid.");
  assertEquals(refusal({ ...good, contact_email: "not-an-address" }, {}), "The client email address is not valid.");
  assertEquals(refusal({ ...good, contact_email: "a@example.com, b@example.com" }, {}), "The client email address is not valid.");
  assertEquals(refusal({ ...good, contact_email: "" }, {}), "The client email address is not valid.");
  assertEquals(refusal({ ...good, mail_sent_at: "2026-11-05T08:00:00Z" }, {}), "This proposal was already mailed. Confirm to send it again.");
});

Deno.test("resend passes for an already sent proposal", () => {
  assertEquals(refusal({ ...good, mail_sent_at: "2026-11-05T08:00:00Z" }, { resend: true }), null);
});
