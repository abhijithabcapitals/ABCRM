// Run: deno test "Agent Module/13_EMail_Agent/supabase/email-agent/logic_test.ts"
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  bulkDecision, cleanBody, dedupeKey, evidenceFound, matchRules, parseIcs, planItem, reminderTime, sanitizeExtraction, zonedToUtc,
} from "./logic.ts";

const now = new Date("2026-10-30T08:00:00Z");

Deno.test("cleanBody drops quoted history", () => {
  const text = "Please send the trade licence.\n\nOn Tue, 27 Oct 2026, Bharat wrote:\n> old text";
  assertEquals(cleanBody(text), "Please send the trade licence.");
});

Deno.test("evidence must appear in the email", () => {
  const body = "Kindly file the VAT return\nby 28 November 2026.";
  assert(evidenceFound("file the VAT return by 28 November 2026", body, "VAT"));
  assert(!evidenceFound("pay AED 50,000 today", body, "VAT"));
});

Deno.test("sanitizeExtraction drops unknown kinds and caps unsupported items", () => {
  const body = "Meeting on Monday 2 November at 10am at our Dubai office.";
  const ex = sanitizeExtraction({
    priority: "high", category: "client", action_required: true,
    phishing: { risk: "low", reasons: [] },
    items: [
      { kind: "meeting", title: "Client meeting", starts_at: "2026-11-02T10:00:00+04:00", confidence: 0.9, evidence: "Meeting on Monday 2 November at 10am" },
      { kind: "deadline", title: "Invented deadline", due_at: "2026-11-05T17:00:00+04:00", confidence: 0.9, evidence: "file by 5 November" },
      { kind: "send_money", title: "Not allowed", confidence: 1 },
    ],
  }, body, "Meeting");
  assertEquals(ex.items.length, 2);
  assertEquals(ex.items[0].starts_at, "2026-11-02T06:00:00.000Z");
  assertEquals(ex.items[0].confidence, 0.9);
  assertEquals(ex.items[1].confidence, 0.5);
});

Deno.test("planItem: confident future meeting goes to calendar", () => {
  const item = { kind: "meeting" as const, title: "Call", detail: null, starts_at: "2026-11-02T06:00:00Z", ends_at: null, due_at: null, location: null, confidence: 0.9, evidence: "x" };
  const opts = { autoCalendar: true, minConfidence: 0.75, noCalendar: false, phishingRisk: "none" as const, now };
  assertEquals(planItem(item, opts), "calendar");
  assertEquals(planItem({ ...item, confidence: 0.5 }, opts), "propose");
  assertEquals(planItem(item, { ...opts, phishingRisk: "high" }), "propose");
  assertEquals(planItem(item, { ...opts, noCalendar: true }), "propose");
  assertEquals(planItem({ ...item, starts_at: "2026-10-01T06:00:00Z" }, opts), "notice");
});

Deno.test("reminderTime is a day before, or soon when that has passed", () => {
  assertEquals(reminderTime("2026-11-05T13:00:00Z", now), "2026-11-04T13:00:00.000Z");
  assertEquals(reminderTime("2026-10-30T20:00:00Z", now), "2026-10-30T08:05:00.000Z");
  assertEquals(reminderTime("2026-10-29T20:00:00Z", now), null);
});

Deno.test("bulk mail is skipped unless it mentions action words", () => {
  const h = [{ key: "list-unsubscribe", value: "<mailto:x@y>" }];
  assertEquals(bulkDecision(h, "Our autumn newsletter", "Read our latest stories"), "skip");
  assertEquals(bulkDecision(h, "FTA: Corporate Tax return due", "File by 31 December"), "process");
  assertEquals(bulkDecision([], "Hello", "Hi"), "process");
});

Deno.test("rules match sender, domain and subject", () => {
  const rules = [
    { match_type: "domain" as const, pattern: "tax.gov.ae", action: "vip" as const },
    { match_type: "subject" as const, pattern: "webinar", action: "ignore" as const },
  ];
  assert(matchRules(rules, "noreply@tax.gov.ae", "Return").has("vip"));
  assert(matchRules(rules, "a@mail.tax.gov.ae", "Return").has("vip"));
  assert(matchRules(rules, "a@x.com", "Free Webinar today").has("ignore"));
  assertEquals(matchRules(rules, "a@x.com", "Hello").size, 0);
});

Deno.test("dedupeKey ignores Re: and punctuation", () => {
  assertEquals(dedupeKey("meeting", "t1", "Re: Audit kick-off!", "2026-11-02T06:00:00Z"), dedupeKey("meeting", "t1", "audit kick off", "2026-11-02T09:00:00Z"));
});

Deno.test("zonedToUtc converts Dubai and London wall time", () => {
  assertEquals(zonedToUtc(2026, 11, 2, 10, 0, 0, "Asia/Dubai"), "2026-11-02T06:00:00.000Z");
  assertEquals(zonedToUtc(2026, 7, 1, 10, 0, 0, "Europe/London"), "2026-07-01T09:00:00.000Z");
});

Deno.test("parseIcs reads Outlook invites with Windows zone names", () => {
  const ics = [
    "BEGIN:VCALENDAR", "METHOD:REQUEST", "BEGIN:VEVENT",
    "UID:abc-123", "SUMMARY:Audit kick-off\\, FY2026",
    "DTSTART;TZID=Arabian Standard Time:20261102T100000",
    "DTEND;TZID=Arabian Standard Time:20261102T110000",
    "LOCATION:Microsoft Teams", "ORGANIZER;CN=Ann:mailto:ann@client.ae",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const [e] = parseIcs(ics);
  assertEquals(e.method, "REQUEST");
  assertEquals(e.summary, "Audit kick-off, FY2026");
  assertEquals(e.start, "2026-11-02T06:00:00.000Z");
  assertEquals(e.end, "2026-11-02T07:00:00.000Z");
  assertEquals(e.organizer, "ann@client.ae");
  assertEquals(e.zoneGuessed, false);
});

Deno.test("parseIcs handles UTC, folded lines and cancellations", () => {
  const ics = "BEGIN:VCALENDAR\nMETHOD:CANCEL\nBEGIN:VEVENT\nSUMMARY:Long\n  title\nDTSTART:20261103T080000Z\nSTATUS:CANCELLED\nEND:VEVENT\nEND:VCALENDAR";
  const [e] = parseIcs(ics);
  assertEquals(e.method, "CANCEL");
  assertEquals(e.summary, "Long title");
  assertEquals(e.start, "2026-11-03T08:00:00.000Z");
  assertEquals(e.status, "CANCELLED");
});
