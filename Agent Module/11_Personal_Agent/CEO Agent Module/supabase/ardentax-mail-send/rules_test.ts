// deno test "Agent Module/11_Personal_Agent/CEO Agent Module/supabase/ardentax-mail-send/"
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { chooseLogin, htmlBody, isDocumentPath, parseRecipients, sendRefusal, totalAttachmentBytes, MAX_ATTACHMENT_BYTES } from "./rules.ts";

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
