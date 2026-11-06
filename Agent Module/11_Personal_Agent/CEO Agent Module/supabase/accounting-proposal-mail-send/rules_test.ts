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
Deno.test("an unapproved, unsigned agreement may be sent too: signing is optional", () => assertEquals(refusal({ ...agreement, approved_at: null }, { resend: false }), null));
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
  assertEquals(claimRule(now, { resend: false }), { staleBefore: "2026-11-05T11:55:00.000Z", requireUnsent: true, storagePath: null });
  assertEquals(claimRule(now, { resend: true }), { staleBefore: "2026-11-05T11:55:00.000Z", requireUnsent: false, storagePath: null });
  assert(/in progress/i.test(CLAIM_REFUSED));
});

Deno.test("the claim must still match the PDF that was read; no approval is asked for", () => {
  const now = new Date("2026-11-05T12:00:00.000Z");
  assertEquals(claimRule(now, { resend: false }, quote), { staleBefore: "2026-11-05T11:55:00.000Z", requireUnsent: true, storagePath: PDF });
  assertEquals(claimRule(now, { resend: true }, { ...agreement, approved_at: null }), { staleBefore: "2026-11-05T11:55:00.000Z", requireUnsent: false, storagePath: PDF });
});

// ---- Signed or unsigned copy (Review Focus 4) ----
import { attachmentChoice, isSignedAccountingPath, NOT_SIGNED, parseSigned } from "./rules.ts";
const SIGNED = `Accounting/${ID}/signed/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf`;
const live = { id: "s1", source_table: "hub_documents", source_id: ID, pdf_path: SIGNED, superseded_at: null };

Deno.test("signed missing, null or false sends the unsigned PDF exactly as before", () => {
  for (const v of [undefined, null, false]) assertEquals(attachmentChoice(quote, parseSigned(v) as boolean, live), { path: PDF, signatureId: null });
  assertEquals(attachmentChoice({ ...agreement, approved_at: null }, false, null), { path: PDF, signatureId: null });
});
Deno.test("signed true sends the live signature's PDF", () => assertEquals(attachmentChoice(agreement, true, live), { path: SIGNED, signatureId: "s1" }));
Deno.test("signed true with no live signature is refused, and the unsigned send still works", () => {
  assertEquals(attachmentChoice(agreement, true, null), { error: NOT_SIGNED });
  assertEquals(NOT_SIGNED, "This document is not signed. Sign it first or send unsigned.");
  assertEquals(attachmentChoice(agreement, false, null), { path: PDF, signatureId: null });
});
Deno.test("signed true with a superseded signature is refused, and the unsigned send still works", () => {
  assertEquals(attachmentChoice(agreement, true, { ...live, superseded_at: "2026-11-06T10:00:00Z" }), { error: NOT_SIGNED });
  assertEquals(attachmentChoice(agreement, false, { ...live, superseded_at: "2026-11-06T10:00:00Z" }), { path: PDF, signatureId: null });
});
Deno.test("a signature of another document is refused", () => {
  assertEquals(attachmentChoice(agreement, true, { ...live, source_id: "99999999-2222-3333-4444-555555555555" }), { error: NOT_SIGNED });
  assertEquals(attachmentChoice(agreement, true, { ...live, source_table: "ardentax_documents" }), { error: NOT_SIGNED });
});
Deno.test("a signed PDF outside Accounting/<id>/signed/ is refused", () => {
  for (const p of [PDF, `Accounting/${ID}/signed/x.docx`, `Accounting/${ID}/signed/a/x.pdf`, `Accounting/99999999-2222-3333-4444-555555555555/signed/x.pdf`,
                   `Accounting/${ID}/signed/../x.pdf`, `Accounting/${ID}/signed/`, `ArdentTax (ASP)/${ID}/signed/x.pdf`, null]) {
    assert(!isSignedAccountingPath(ID, p), String(p));
    assert("error" in attachmentChoice(agreement, true, { ...live, pdf_path: p }), String(p));
  }
  assert(isSignedAccountingPath(ID, SIGNED));
});
Deno.test("signed must be true, false or missing", () => {
  assertEquals(parseSigned(true), true);
  assertEquals(parseSigned(false), false);
  assertEquals(parseSigned(undefined), false);
  assertEquals(parseSigned(null), false);
  for (const v of ["true", 1, "yes", {}]) assert(typeof parseSigned(v) === "object");
});
Deno.test("the mail function no longer asks for approval anywhere", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(!/approved_at|requireApproved/.test(src));
  assert(src.includes("attachmentChoice("));
  assert(/document_signatures/.test(src));
});

// ---- From mailbox and signature ----
import { htmlBody, plainText } from "../ardentax-mail-send/rules.ts";
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
Deno.test("marked closing is dropped under a signature and the asterisks vanish from plain text", () => {
  const body = "Dear X\n\n-- closing --\nKind regards,\nAB Capital Services FZE";
  const sig = { body_text: "*Regards,*\nBharat Bajaj" };
  const text = composeText(body, sig);
  assertEquals(text, "Dear X\n\n*Regards,*\nBharat Bajaj");
  assertEquals(plainText(text), "Dear X\n\nRegards,\nBharat Bajaj");
  assert(htmlBody(text, "").includes("<b>Regards,</b>"));
});
Deno.test("no signature keeps the closing and drops only the mark", () => {
  assertEquals(composeText("Dear X\n\n-- closing --\nKind regards,\nAB", null), "Dear X\n\nKind regards,\nAB");
});
Deno.test("a saved draft without the mark sends as before", () => {
  assertEquals(composeText("Hello\nKind regards", { body_text: "Sig" }), "Hello\nKind regards\n\nSig");
});
