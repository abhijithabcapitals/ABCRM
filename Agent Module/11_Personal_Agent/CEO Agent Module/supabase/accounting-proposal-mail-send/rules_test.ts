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
  assertEquals(claimRule(now, { resend: false }), { staleBefore: "2026-11-05T11:55:00.000Z", requireUnsent: true, storagePath: null, requireApproved: false });
  assertEquals(claimRule(now, { resend: true }), { staleBefore: "2026-11-05T11:55:00.000Z", requireUnsent: false, storagePath: null, requireApproved: false });
  assert(/in progress/i.test(CLAIM_REFUSED));
});

Deno.test("the claim must still match the PDF that was read, and an agreement must still be approved", () => {
  const now = new Date("2026-11-05T12:00:00.000Z");
  assertEquals(claimRule(now, { resend: false }, quote), { staleBefore: "2026-11-05T11:55:00.000Z", requireUnsent: true, storagePath: PDF, requireApproved: false });
  assertEquals(claimRule(now, { resend: true }, agreement), { staleBefore: "2026-11-05T11:55:00.000Z", requireUnsent: false, storagePath: PDF, requireApproved: true });
});

// ---- From mailbox and signature ----
import { htmlBody } from "../ardentax-mail-send/rules.ts";
import { chooseSender, composeText, DEFAULT_SENDER, DEFAULT_SENDER_NAME, senderName, signatureFits, signatureHtml } from "./rules.ts";

Deno.test("no from means info@abcapital.ae", () => assertEquals(chooseSender({ from: undefined, owned: false }), { address: DEFAULT_SENDER, needsOwnership: false }));
Deno.test("info@ is allowed without ownership, in any case", () => assertEquals(chooseSender({ from: " Info@ABCapital.ae ", owned: false }), { address: DEFAULT_SENDER, needsOwnership: false }));
Deno.test("an unowned mailbox is refused with the 403 text", () => {
  const r = chooseSender({ from: "ceo@abcapital.ae", owned: false });
  assertEquals(r, { error: "You can only send from info@abcapital.ae or a mailbox you own.", status: 403 });
});
Deno.test("an owned mailbox is allowed", () => assertEquals(chooseSender({ from: "ceo@abcapital.ae", owned: true }), { address: "ceo@abcapital.ae", needsOwnership: true }));
Deno.test("a non-address from is refused", () => assertEquals((chooseSender({ from: "x\r\nBcc: a@b.c", owned: true }) as { status: number }).status, 400));

Deno.test("a signature with no mailbox fits any sender", () => assert(signatureFits({ sender_mailbox_address: null }, "info@abcapital.ae")));
Deno.test("a signature tied to the sender fits, ignoring case", () => assert(signatureFits({ sender_mailbox_address: "CEO@abcapital.ae" }, "ceo@abcapital.ae")));
Deno.test("a signature tied to another mailbox is refused", () => assert(!signatureFits({ sender_mailbox_address: "ceo@abcapital.ae" }, "info@abcapital.ae")));

Deno.test("signature text follows the body after one blank line", () => assertEquals(composeText("Hello\n\n", { body_text: "  Regards\nAB  " }), "Hello\n\nRegards\nAB"));
Deno.test("no signature leaves the body as it is", () => assertEquals(composeText("Hello", null), "Hello"));
Deno.test("signature text is escaped in the HTML actually sent", () => {
  const sig = { body_text: '<b>&"', logo_url: null };
  const html = htmlBody(composeText("Hello", sig), signatureHtml(sig));
  assert(html.includes("&lt;b&gt;&amp;&quot;"));
  assert(!html.includes('<b>&"'));
});
Deno.test("a whitespace-only signature mailbox counts as no mailbox", () => assert(signatureFits({ sender_mailbox_address: "   " }, "info@abcapital.ae")));
Deno.test("the logo is optional and escaped", () => {
  assertEquals(signatureHtml({ body_text: "x", logo_url: null }).includes("<img"), false);
  const h = signatureHtml({ body_text: "x", logo_url: 'https://e.example/l.png"onerror="a' });
  assert(h.includes("<img") && !h.includes('"onerror'));
});
Deno.test("sender name is the display name, else the company", () => {
  assertEquals(senderName({ display_name: "Info Desk" }), "Info Desk");
  assertEquals(senderName({ display_name: " " }), DEFAULT_SENDER_NAME);
  assertEquals(senderName(null), DEFAULT_SENDER_NAME);
});
