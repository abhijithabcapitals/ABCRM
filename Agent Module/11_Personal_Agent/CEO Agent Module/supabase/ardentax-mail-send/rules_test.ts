// deno test "Agent Module/11_Personal_Agent/CEO Agent Module/supabase/ardentax-mail-send/"
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { ardentaxBodies, applyClosing, boldLines, CLOSING_MARK, plainText, chooseLogin, htmlBody, isDocumentPath, parseRecipients, sendRefusal, totalAttachmentBytes, MAX_ATTACHMENT_BYTES } from "./rules.ts";

const ready = { pdf_path: "a.pdf", word_path: "a.docx", mail_to: "pat@sample.example", mail_subject: "S", mail_body: "B", mail_sent_at: null };

Deno.test("a ready draft may be sent", () => assertEquals(sendRefusal(ready, { resend: false }), null));
Deno.test("no PDF yet is refused", () => assert(/PDF/.test(sendRefusal({ ...ready, pdf_path: null }, { resend: false })!)));
Deno.test("no recipient is refused", () => assert(/recipient/i.test(sendRefusal({ ...ready, mail_to: " " }, { resend: false })!)));
Deno.test("no subject is refused", () => assert(/subject/i.test(sendRefusal({ ...ready, mail_subject: "" }, { resend: false })!)));
Deno.test("already sent needs resend", () => {
  const sent = { ...ready, mail_sent_at: "2026-11-05T10:00:00Z" };
  assert(/already sent/i.test(sendRefusal(sent, { resend: false })!));
  assertEquals(sendRefusal(sent, { resend: true }), null);
});

Deno.test("recipients split on commas and semicolons", () => {
  assertEquals(parseRecipients(" a@b.example; c@d.example , e@f.example "), ["a@b.example", "c@d.example", "e@f.example"]);
  assertEquals(parseRecipients(""), []);
  assertEquals(parseRecipients(null), []);
});
Deno.test("invalid or dangerous addresses are refused", () => {
  assertThrows(() => parseRecipients("not-an-address"));
  assertThrows(() => parseRecipients("a@b.example\r\nBcc: evil@bad.example"));
  assertThrows(() => parseRecipients("a b@c.example"));
});

Deno.test("mail text becomes safe HTML with the signature after it", () => {
  const html = htmlBody("Dear <Pat> & team\n\nThanks", "<p>Regards</p>");
  assert(html.includes("Dear &lt;Pat&gt; &amp; team<br>"));
  assert(html.includes("<p>Regards</p>"));
  assert(html.indexOf("Thanks") < html.indexOf("Regards"));
});

Deno.test("attachment size is limited", () => {
  assertEquals(totalAttachmentBytes([{ bytes: new Uint8Array(10) }, { bytes: new Uint8Array(5) }]), 15);
  assert(MAX_ATTACHMENT_BYTES <= 25 * 1024 * 1024);
});

const ID = "11111111-2222-3333-4444-555555555555";
const GOOD = `ArdentTax (ASP)/${ID}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/Ardentax-2026-11-ADTQ001 Sample v2.pdf`;
Deno.test("only this document's own stored files may be mailed", () => {
  assert(isDocumentPath(ID, GOOD));
  assert(!isDocumentPath(ID, `ArdentTax (ASP)/${ID}/../../Accounting/receipts/x.docx`));
  assert(!isDocumentPath(ID, `ArdentTax (ASP)/${ID}/x/%2e%2e/%2e%2e/y.pdf`));
  assert(!isDocumentPath(ID, `ArdentTax (ASP)/${ID}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/../y.pdf`));
  assert(!isDocumentPath("99999999-2222-3333-4444-555555555555", GOOD));
  assert(!isDocumentPath(ID, null));
});

Deno.test("the mailbox login comes from the same places as ceo-mail-reply, in the same order", () => {
  const address = "bharat@ardentaxit.tax";
  assertEquals(chooseLogin({ saved: "a", named: "b", legacyUser: address, legacyPass: "c" }, address), { user: address, pass: "a" });
  assertEquals(chooseLogin({ named: "b", legacyUser: address, legacyPass: "c" }, address), { user: address, pass: "b" });
  assertEquals(chooseLogin({ legacyUser: " Bharat@ArdentaxIT.tax ", legacyPass: "c" }, address), { user: "Bharat@ArdentaxIT.tax", pass: "c" });
  assertEquals(chooseLogin({ saved: "a" }, address, "login@x.example"), { user: "login@x.example", pass: "a" });
  assertEquals(chooseLogin({ legacyUser: "other@x.example", legacyPass: "c" }, address), null);
  assertEquals(chooseLogin({}, address), null);
});

Deno.test("a whole line in asterisks is bold in HTML and bare in plain text", () => {
  const r = boldLines("Hi\n*Regards,*\nBharat");
  assertEquals(r.html, "Hi\n<b>Regards,</b>\nBharat");
  assertEquals(r.plain, "Hi\nRegards,\nBharat");
});
Deno.test("asterisks inside a sentence stay, empty lines are kept", () => {
  const t = "a * b *c* d\n\n\n2*3*4";
  assertEquals(boldLines(t), { html: t, plain: t });
});
Deno.test("the closing goes only when a signature is chosen; the mark never stays", () => {
  const t = `Body\n\n${CLOSING_MARK}\nKind regards,\nAB Capital`;
  assertEquals(applyClosing(t, true), "Body");
  assertEquals(applyClosing(t, false), "Body\n\nKind regards,\nAB Capital");
  assert(!plainText(t, true).includes("-- closing"));
  assert(!plainText(t, false).includes("-- closing"));
  assert(!htmlBody(t, "").includes("-- closing"));
  assert(htmlBody(t, "").includes("Kind regards,"));
});
Deno.test("text without the mark is unchanged", () => {
  const t = "Dear X\n\nKind regards,\nAB Capital";
  assertEquals(applyClosing(t, true), t);
  assertEquals(plainText(t, true), t);
});
Deno.test("htmlBody makes bold lines bold and keeps escaping", () => {
  const h = htmlBody("<a>\n*Regards,*", "");
  assert(h.includes("&lt;a&gt;<br><b>Regards,</b>"));
});

Deno.test("text typed after the closing block survives under a signature", () => {
  const t = "Body\n\n-- closing --\nKind regards,\nAB\n\nP.S. Call me";
  assertEquals(applyClosing(t, true), "Body\n\nP.S. Call me");
  assertEquals(applyClosing(t, false), "Body\n\nKind regards,\nAB\n\nP.S. Call me");
});
Deno.test("every mark is removed, with and without a signature", () => {
  const t = "A\n\n-- closing --\nRegards\n\nB\n\n-- closing --\nThanks";
  assertEquals(applyClosing(t, true), "A\n\nB");
  assertEquals(applyClosing(t, false), "A\n\nRegards\n\nB\n\nThanks");
  assert(!plainText(t).includes("closing --"));
});
Deno.test("a mark with trailing spaces and CRLF is still a mark", () => {
  assertEquals(applyClosing("A\r\n\r\n-- closing --  \r\nRegards", true), "A");
  assertEquals(applyClosing("A\n-- closing --  \nRegards", false), "A\nRegards");
});
Deno.test("lines that are not bold stay as typed", () => {
  for (const t of ["**", "* *", "* item *", "* item", "*a* and *b*", "*a*b"]) assertEquals(boldLines(t), { html: t, plain: t });
});
Deno.test("escaped text can still be bolded", () => {
  assertEquals(boldLines("*<b>*").html, "<b>&lt;b&gt;</b>");
  assertEquals(boldLines("*a*").plain, "a");
});
Deno.test("CRLF stays on bold lines", () => {
  assertEquals(boldLines("Hi\r\n*Regards,*\r\nB").plain, "Hi\r\nRegards,\r\nB");
  assertEquals(boldLines("*Regards,*\r\nB").html, "<b>Regards,</b>\r\nB");
});
Deno.test("Ardentax mail: plain keeps the closing, HTML drops it only under a signature", () => {
  const body = "Dear X\n\n-- closing --\nKind regards";
  const withSig = ardentaxBodies(body, "<p>Sig</p>");
  assertEquals(withSig.text, "Dear X\n\nKind regards");
  assert(!withSig.html.includes("Kind regards") && withSig.html.includes("<p>Sig</p>") && !withSig.html.includes("closing --"));
  const none = ardentaxBodies(body, "  ");
  assertEquals(none.text, "Dear X\n\nKind regards");
  assert(none.html.includes("Kind regards") && !none.html.includes("closing --"));
  assertEquals(ardentaxBodies("*Hi*", "").text, "Hi");
});

// ---- Signed copy (shared signing, Template Hub 011) ----
import { attachmentPlan, isSignedArdentaxPath, NOT_SIGNED, parseSigned } from "./rules.ts";

type Plan = { word: unknown; signatureId: unknown };
const SID = "11111111-2222-4333-8444-555555555555";
const UNSIGNED = { id: SID, pdf_path: `ArdentTax (ASP)/${SID}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/Ardentax-2026-11-ADTQ001 Sample.pdf`, word_path: `ArdentTax (ASP)/${SID}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/Ardentax-2026-11-ADTQ001 Sample.docx`, mail_attach_word: false };
const LIVE = { id: "sig-1", source_table: "ardentax_documents", source_id: SID, superseded_at: null,
  pdf_path: `ArdentTax (ASP)/${SID}/signed/0b0c0d0e-1111-4222-8333-444455556666.pdf`, word_path: `ArdentTax (ASP)/${SID}/signed/0b0c0d0e-1111-4222-8333-444455556666.docx` };

Deno.test("signed is true or false; missing means false", () => {
  assertEquals(parseSigned(undefined), false);
  assertEquals(parseSigned(null), false);
  assertEquals(parseSigned(true), true);
  assertEquals(parseSigned(false), false);
  assertEquals(parseSigned("true"), { error: "signed must be true or false." });
  assertEquals(parseSigned(1), { error: "signed must be true or false." });
});

Deno.test("a signed file must sit directly under ArdentTax (ASP)/<id>/signed/, with the right kind", () => {
  assert(isSignedArdentaxPath(SID, LIVE.pdf_path, "pdf"));
  assert(isSignedArdentaxPath(SID, LIVE.word_path, "docx"));
  assert(!isSignedArdentaxPath(SID, LIVE.word_path, "pdf"));
  assert(!isSignedArdentaxPath(SID, LIVE.pdf_path, "docx"));
  assert(!isSignedArdentaxPath("99999999-2222-4333-8444-555555555555", LIVE.pdf_path, "pdf"), "another document's folder");
  assert(!isSignedArdentaxPath(SID, `ArdentTax (ASP)/${SID}/signed/sub/x.pdf`, "pdf"));
  assert(!isSignedArdentaxPath(SID, `ArdentTax (ASP)/${SID}/signed/../../x.pdf`, "pdf"));
  assert(!isSignedArdentaxPath(SID, `ArdentTax (ASP)/${SID}/signed/..pdf`, "pdf"));
  assert(!isSignedArdentaxPath(SID, `Accounting/${SID}/signed/x.pdf`, "pdf"));
  assert(!isSignedArdentaxPath(SID, UNSIGNED.pdf_path, "pdf"), "the unsigned folder is not the signed one");
  assert(!isSignedArdentaxPath(SID, null, "pdf"));
  assert(!isSignedArdentaxPath(null, LIVE.pdf_path, "pdf"));
});

Deno.test("unsigned send is unchanged: the row's own PDF, and its Word file when ticked", () => {
  assertEquals(attachmentPlan(UNSIGNED, false, null), { pdf: { path: UNSIGNED.pdf_path, name: "Ardentax-2026-11-ADTQ001 Sample.pdf" }, word: null, signatureId: null });
  assertEquals((attachmentPlan({ ...UNSIGNED, mail_attach_word: true }, false, LIVE) as Plan).word, { path: UNSIGNED.word_path, name: "Ardentax-2026-11-ADTQ001 Sample.docx" });
  assertEquals((attachmentPlan(UNSIGNED, false, LIVE) as Plan).signatureId, null, "a live signature does not change an unsigned send");
});

Deno.test("signed send takes the live signature's files, under the document's own names", () => {
  assertEquals(attachmentPlan(UNSIGNED, true, LIVE), { pdf: { path: LIVE.pdf_path, name: "Ardentax-2026-11-ADTQ001 Sample.pdf" }, word: null, signatureId: "sig-1" });
  assertEquals((attachmentPlan({ ...UNSIGNED, mail_attach_word: true }, true, LIVE) as Plan).word, { path: LIVE.word_path, name: "Ardentax-2026-11-ADTQ001 Sample.docx" });
});

Deno.test("signed send with no live signature, a withdrawn one or another document's is refused", () => {
  assertEquals(NOT_SIGNED, "This document is not signed. Sign it first or send unsigned.");
  assertEquals(attachmentPlan(UNSIGNED, true, null), { error: NOT_SIGNED });
  assertEquals(attachmentPlan(UNSIGNED, true, { ...LIVE, superseded_at: "2026-11-06T10:00:00Z" }), { error: NOT_SIGNED });
  assertEquals(attachmentPlan(UNSIGNED, true, { ...LIVE, source_id: "99999999-2222-4333-8444-555555555555" }), { error: NOT_SIGNED });
  assertEquals(attachmentPlan(UNSIGNED, true, { ...LIVE, source_table: "hub_documents" }), { error: NOT_SIGNED });
  assertEquals(attachmentPlan(UNSIGNED, true, { ...LIVE, id: "" }), { error: NOT_SIGNED });
});

Deno.test("a signed file outside the signed folder is refused", () => {
  assertEquals(attachmentPlan(UNSIGNED, true, { ...LIVE, pdf_path: UNSIGNED.pdf_path }), { error: "The signed PDF's path is not valid." });
  assertEquals(attachmentPlan({ ...UNSIGNED, mail_attach_word: true }, true, { ...LIVE, word_path: null }), { error: "The signed Word file's path is not valid." });
  assertEquals(attachmentPlan({ ...UNSIGNED, mail_attach_word: true }, true, { ...LIVE, word_path: `Accounting/${SID}/signed/x.docx` }), { error: "The signed Word file's path is not valid." });
});
