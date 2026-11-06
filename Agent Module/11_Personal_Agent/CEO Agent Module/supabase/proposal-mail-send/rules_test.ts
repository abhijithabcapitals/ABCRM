import { assertEquals } from "jsr:@std/assert@1";
import { attachmentChoice, attachmentName, attachmentsFor, claimFilter, isSignedProposalPath, mailBodies, NOT_SIGNED, parseSigned, refusal } from "./rules.ts";

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

Deno.test("claimFilter: 2 minute staleness, unsent unless resend", () => {
  const now = new Date("2026-11-05T10:00:00.000Z");
  assertEquals(claimFilter(now, {}), { staleBefore: "2026-11-05T09:58:00.000Z", requireUnsent: true, storagePath: null });
  assertEquals(claimFilter(now, { resend: false }).requireUnsent, true);
  assertEquals(claimFilter(now, { resend: true }), { staleBefore: "2026-11-05T09:58:00.000Z", requireUnsent: false, storagePath: null });
});

Deno.test("the attachment is named after the proposal's Ref, made safe, ending .pdf", () => {
  assertEquals(attachmentName("ABC/2026/11/BSQ001"), "ABC-2026-11-BSQ001.pdf");
  assertEquals(attachmentName("ABC\\2026:11*BSQ<2>"), "ABC-202611BSQ2.pdf");
  assertEquals(attachmentName(" ../x "), "x.pdf");
  assertEquals(attachmentName(""), "Proposal.pdf");
  assertEquals(attachmentName(null), "Proposal.pdf");
});

Deno.test("a rejected or replaced proposal is not sent", () => {
  assertEquals(refusal({ ...good, status: "rejected" }, { resend: true }), "This proposal was rejected and cannot be sent.");
  assertEquals(refusal({ ...good, status: "superseded" }, { resend: true }), "This proposal was replaced and cannot be sent.");
  assertEquals(refusal({ ...good, status: "issued" }, { resend: false }), null);
  assertEquals(refusal({ ...good, status: "accepted" }, { resend: false }), null);
});

// ---- Signed or unsigned copy (shared signing, Template Hub 011) ----
const LIVE = { id: "s1", source_table: "hub_documents", source_id: ID, pdf_path: `Business Setup/${ID}/signed/abc.pdf`, superseded_at: null };

Deno.test("parseSigned takes only true, false or nothing", () => {
  assertEquals(parseSigned(undefined), false);
  assertEquals(parseSigned(null), false);
  assertEquals(parseSigned(false), false);
  assertEquals(parseSigned(true), true);
  assertEquals(parseSigned("true"), { error: "signed must be true or false." });
  assertEquals(parseSigned(1), { error: "signed must be true or false." });
});

Deno.test("unsigned send is unchanged: the row's own PDF, no signature checked", () => {
  assertEquals(attachmentChoice(good, false, null), { path: good.storage_path, signatureId: null });
  assertEquals(attachmentChoice(good, false, LIVE), { path: good.storage_path, signatureId: null });
});

Deno.test("signed send takes the live signature's PDF", () => {
  assertEquals(attachmentChoice(good, true, LIVE), { path: LIVE.pdf_path, signatureId: "s1" });
});

Deno.test("signed send with no live signature is refused", () => {
  assertEquals(attachmentChoice(good, true, null), { error: NOT_SIGNED });
  assertEquals(attachmentChoice(good, true, { ...LIVE, superseded_at: "2026-11-06T08:00:00Z" }), { error: NOT_SIGNED });
  assertEquals(attachmentChoice(good, true, { ...LIVE, source_id: "99999999-2222-3333-4444-555555555555" }), { error: NOT_SIGNED });
  assertEquals(attachmentChoice(good, true, { ...LIVE, source_table: "ardentax_documents" }), { error: NOT_SIGNED });
  assertEquals(attachmentChoice(good, true, { ...LIVE, id: null }), { error: NOT_SIGNED });
});

Deno.test("the signed PDF must sit directly under Business Setup/<id>/signed/", () => {
  const bad = (pdf_path: string) => assertEquals(attachmentChoice(good, true, { ...LIVE, pdf_path }), { error: "The signed PDF's path is not valid." });
  bad(`Business Setup/${ID}/abc.pdf`);
  bad(`Business Setup/${ID}/signed/abc.docx`);
  bad(`Business Setup/${ID}/signed/x/abc.pdf`);
  bad(`Business Setup/${ID}/signed/../abc.pdf`);
  bad(`Business Setup/other/signed/abc.pdf`);
  bad(`Accounting/${ID}/signed/abc.pdf`);
  bad(`Business Setup/${ID}/signed/.pdf`.replace(".pdf", ""));
  assertEquals(isSignedProposalPath(ID, LIVE.pdf_path), true);
  assertEquals(isSignedProposalPath(null, LIVE.pdf_path), false);
  assertEquals(isSignedProposalPath(ID, null), false);
});

Deno.test("claimFilter holds the PDF that was read", () => {
  const now = new Date("2026-11-05T10:00:00.000Z");
  assertEquals(claimFilter(now, {}, good).storagePath, good.storage_path);
  assertEquals(claimFilter(now, {}).storagePath, null);
});

// ---- Mail text (Task 4 shared rules) ----
Deno.test("the closing mark is never sent; with no mail signature the closing stays; bold asterisks leave the plain part", () => {
  const draft = "Dear Pat,\n\n*Option 1*\n\n-- closing --\nKind regards\nSam Signer";
  const m = mailBodies(draft);
  assertEquals(m.text, "Dear Pat,\n\nOption 1\n\nKind regards\nSam Signer");
  assertEquals(m.html.includes("-- closing --"), false);
  assertEquals(m.html.includes("<b>Option 1</b>"), true);
  assertEquals(m.html.includes("Kind regards"), true);
  assertEquals(mailBodies("No mark here").text, "No mark here");
});

Deno.test("the mail function sends the chosen copy, checks the signature again after the claim, and never the Word file", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  if (!src.includes("attachmentChoice(") || !src.includes("parseSigned(") || !src.includes("mailBodies(")) throw new Error("index.ts must use the rules");
  const claim = src.indexOf("await claim.select"), recheck = src.indexOf(".is(\"superseded_at\", null)", claim), smtp = src.indexOf("new SmtpClient", claim);
  if (!(claim > 0 && recheck > claim && smtp > recheck)) throw new Error("the live signature must be checked again after the claim and before SMTP");
  if (/word_path\)|download\(doc\.word_path/.test(src)) throw new Error("the Word file is never read for sending");
});

import { sentNotRecorded } from "./rules.ts";

// SMTP accepted, sent mark failed: the claim is kept (released before the mark is written) and the reply is an error that says the mail went out.
Deno.test("a sent mail whose mark fails keeps the claim and says it went out", async () => {
  const msg = sentNotRecorded("timeout");
  if (!/was sent/i.test(msg) || !/not record/i.test(msg) || !/timeout/.test(msg) || !/Do not send it again/.test(msg)) throw new Error(msg);
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const smtp = src.indexOf(".send(login.user"), keep = src.indexOf("released = true", smtp), mark = src.indexOf("mail_sent_at: sentAt", smtp);
  if (!(smtp > 0 && keep > smtp && mark > keep)) throw new Error("the claim must be kept once SMTP accepted the mail, before the sent mark");
  if ((src.match(/released = true/g) || []).length !== 1) throw new Error("only the accepted send keeps the claim");
  if (!/if \(notRecorded\) return json\(\{ error: notRecorded/.test(src)) throw new Error("a failed mark must reply with an error");
});
