// deno test "Agent Module/11_Personal_Agent/CEO Agent Module/supabase/ardentax-mail-send/"
import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildMail } from "./mime.ts";

const dec = new TextDecoder();
const pdf = new TextEncoder().encode("%PDF-1.7 sample");
const mail = (over = {}) => ({
  from: "bharat@ardentaxit.tax", fromName: "Bharat Bajaj", to: ["pat@sample.example"], cc: ["cc@sample.example"],
  subject: "Proposal - Sample", html: "<p>Dear Pat</p><img src=\"cid:ardentax-banner\">", text: "Dear Pat",
  inline: [{ cid: "ardentax-banner", name: "banner.png", type: "image/png", bytes: new Uint8Array([1, 2, 3]) }],
  attachments: [{ name: "Ardentax-2026-11-ADTQ001 Sample.pdf", type: "application/pdf", bytes: pdf }],
  ...over,
});
const headerPart = (raw: string) => raw.split("\r\n\r\n")[0];

Deno.test("mixed holds related, which holds alternative", () => {
  const raw = dec.decode(buildMail(mail()).raw);
  const mixed = raw.indexOf("multipart/mixed");
  const related = raw.indexOf("multipart/related");
  const alternative = raw.indexOf("multipart/alternative");
  assert(mixed > 0 && related > mixed && alternative > related);
  assert(raw.indexOf("text/plain") > alternative && raw.indexOf("text/html") > raw.indexOf("text/plain"));
  assert(raw.indexOf("Content-ID: <ardentax-banner>") > raw.indexOf("text/html"));
  assert(raw.indexOf("application/pdf") > raw.indexOf("Content-ID: <ardentax-banner>"));
});

Deno.test("the PDF is attached in base64 under its file name", () => {
  const raw = dec.decode(buildMail(mail()).raw);
  assert(raw.includes(`filename="Ardentax-2026-11-ADTQ001 Sample.pdf"`));
  assert(raw.includes("Content-Disposition: attachment"));
  assert(raw.includes(btoa("%PDF-1.7 sample")));
});

Deno.test("base64 lines stay within 76 characters", () => {
  const raw = dec.decode(buildMail(mail({ attachments: [{ name: "a.pdf", type: "application/pdf", bytes: new Uint8Array(5000) }] })).raw);
  for (const line of raw.split("\r\n")) assert(line.length <= 998);
  const body = raw.split("filename=\"a.pdf\"")[1].split("\r\n\r\n")[1].split("\r\n--")[0];
  for (const line of body.split("\r\n")) assert(line.length <= 76);
});

Deno.test("non-ASCII subject and file name are encoded", () => {
  const raw = dec.decode(buildMail(mail({ subject: "Proposal – شركة", attachments: [{ name: "شركة.pdf", type: "application/pdf", bytes: pdf }] })).raw);
  assert(raw.includes("Subject: =?UTF-8?B?"));
  assert(raw.includes("filename*=UTF-8''"));
  assert(/^[\x00-\x7f]*$/.test(raw));
});

Deno.test("a line break cannot add a header", () => {
  const head = headerPart(dec.decode(buildMail(mail({ subject: "Hello\r\nBcc: evil@bad.example", to: ["pat@sample.example\r\nBcc: evil@bad.example"], fromName: "B\nBcc: evil@bad.example" })).raw));
  for (const line of head.split("\r\n")) assert(!line.startsWith("Bcc:"), line);
});

Deno.test("headers name sender and both recipient lists, with no blind copy", () => {
  const head = headerPart(dec.decode(buildMail(mail()).raw));
  assert(head.includes("From: Bharat Bajaj <bharat@ardentaxit.tax>"));
  assert(head.includes("To: pat@sample.example"));
  assert(head.includes("Cc: cc@sample.example"));
  assert(!head.includes("Bcc"));
});

Deno.test("a mail without a banner has no related part image", () => {
  const raw = dec.decode(buildMail(mail({ inline: [] })).raw);
  assert(!raw.includes("Content-ID:"));
  assertEquals(buildMail(mail()).messageId.endsWith("@ardentaxit.tax>"), true);
});
