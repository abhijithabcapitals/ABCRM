// deno test "Agent Module/11_Personal_Agent/CEO Agent Module/supabase/ardentax-mail-send/"
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { htmlBody, parseRecipients, sendRefusal, totalAttachmentBytes, MAX_ATTACHMENT_BYTES } from "./rules.ts";

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
