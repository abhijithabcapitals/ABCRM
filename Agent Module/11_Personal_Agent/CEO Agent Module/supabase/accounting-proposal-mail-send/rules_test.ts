// deno test "Agent Module/11_Personal_Agent/CEO Agent Module/supabase/accounting-proposal-mail-send/rules_test.ts"
import { assert, assertEquals } from "jsr:@std/assert@1";
import { attachmentFileName, attachmentsFor, CLAIM_REFUSED, claimRule, refusal } from "./rules.ts";

const ID = "11111111-2222-3333-4444-555555555555";
const PDF = `Accounting/${ID}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/ACC-Q-0001 Sample Trading LLC.pdf`;
const quote = { id: ID, library_template: "AB Capital/Accounting Quote", storage_path: PDF, word_path: PDF.replace(".pdf", ".docx"), approved_at: null, contact_email: "pat@sample.example", mail_subject: "Your quote", mail_sent_at: null };
const agreement = { ...quote, library_template: "AB Capital/Accounting Agreement", approved_at: "2026-11-05T10:00:00Z" };

Deno.test("only the PDF is attached, even when a Word file is set", () => assertEquals(attachmentsFor(quote), [PDF]));
Deno.test("no PDF means nothing to attach", () => assertEquals(attachmentsFor({ ...quote, storage_path: null }), []));

Deno.test("a quote needs no approval", () => assertEquals(refusal(quote, { resend: false }), null));
Deno.test("an approved agreement may be sent", () => assertEquals(refusal(agreement, { resend: false }), null));
Deno.test("an unapproved agreement is refused", () => assert(/approv/i.test(refusal({ ...agreement, approved_at: null }, { resend: false })!)));
Deno.test("another template is refused", () => {
  assert(refusal({ ...quote, library_template: "AB Capital/Other" }, { resend: false }));
  assert(refusal({ ...quote, library_template: null }, { resend: false }));
});
Deno.test("no PDF is refused", () => assert(/PDF/.test(refusal({ ...quote, storage_path: null }, { resend: false })!)));
Deno.test("a path outside Accounting/<id>/ is refused", () => {
  assert(refusal({ ...quote, storage_path: `Accounting/99999999-2222-3333-4444-555555555555/a/x.pdf` }, { resend: false }));
  assert(refusal({ ...quote, storage_path: `ArdentTax (ASP)/${ID}/a/x.pdf` }, { resend: false }));
  assert(refusal({ ...quote, storage_path: `Accounting/${ID}/../../other/x.pdf` }, { resend: false }));
});
Deno.test("no draft subject is refused", () => {
  assert(/subject/i.test(refusal({ ...quote, mail_subject: "  " }, { resend: false })!));
  assert(/subject/i.test(refusal({ ...quote, mail_subject: null }, { resend: false })!));
});
Deno.test("a missing or bad address is refused", () => {
  assert(/contact email/i.test(refusal({ ...quote, contact_email: "" }, { resend: false })!));
  assert(/valid email/i.test(refusal({ ...quote, contact_email: "not-an-address" }, { resend: false })!));
});
Deno.test("already sent needs resend", () => {
  const sent = { ...quote, mail_sent_at: "2026-11-05T11:00:00Z" };
  assert(/already sent/i.test(refusal(sent, { resend: false })!));
  assertEquals(refusal(sent, { resend: true }), null);
});

Deno.test("the file name is built from number and client, and is safe", () => {
  assertEquals(attachmentFileName({ document_number: "ACC-Q-0001", client_name: "Sample Trading LLC" }), "ACC-Q-0001 Sample Trading LLC.pdf");
  assertEquals(attachmentFileName({ document_number: "ACC/Q:1", client_name: 'A"B\r\nC' }), "ACC-Q-1 A-B C.pdf");
  assertEquals(attachmentFileName({ document_number: null, client_name: null }), "Document.pdf");
});

Deno.test("the claim matches only unclaimed or stale rows, and never-sent rows unless resending", () => {
  const now = new Date("2026-11-05T12:00:00.000Z");
  assertEquals(claimRule(now, { resend: false }), { staleBefore: "2026-11-05T11:55:00.000Z", requireUnsent: true });
  assertEquals(claimRule(now, { resend: true }), { staleBefore: "2026-11-05T11:55:00.000Z", requireUnsent: false });
  assert(/in progress/i.test(CLAIM_REFUSED));
});
