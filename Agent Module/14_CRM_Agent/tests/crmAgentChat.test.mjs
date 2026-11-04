import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NO_INFO, MAX_NUMBERS, findLeadNumbers, formatLead, buildReply } from "../supabase/crm-agent/logic.js";

const user = (content) => ({ role: "user", content });
const assistant = (content) => ({ role: "assistant", content });
const lead = { lead_number: "LD-2026-000002", name: "HMR Konsultan", stage: "New Lead", status: "Open", priority: "Normal", assigned_to: "Abhijith", onboarding_status: "Not Started", last_activity_at: "2026-10-30T08:44:41Z", next_followup_at: "2026-10-31T08:44:00Z" };

test("constants", () => {
  assert.equal(NO_INFO, "NO_INFO");
  assert.equal(MAX_NUMBERS, 5);
});
test("finds a number in a sentence", () => assert.deepEqual(findLeadNumbers([user("What's the status of LD-2026-000002?")]), ["LD-2026-000002"]));
test("finds lowercase and punctuated", () => assert.deepEqual(findLeadNumbers([user("(ld-2026-000002), please")]), ["LD-2026-000002"]));
test("drops repeats", () => assert.deepEqual(findLeadNumbers([user("LD-2026-000002 and LD-2026-000002")]), ["LD-2026-000002"]));
test("keeps at most 5", () => {
  const nums = [1, 2, 3, 4, 5, 6].map((n) => `LD-2026-00000${n}`);
  assert.deepEqual(findLeadNumbers([user(nums.join(" "))]), nums.slice(0, 5));
});
test("follow-up uses the earlier user message", () => assert.deepEqual(findLeadNumbers([user("LD-2026-000002"), assistant("x"), user("who owns it?")]), ["LD-2026-000002"]));
test("the newest message wins", () => assert.deepEqual(findLeadNumbers([user("LD-2026-000001"), user("LD-2026-000002")]), ["LD-2026-000002"]));
test("ignores assistant text", () => assert.deepEqual(findLeadNumbers([assistant("LD-2026-000002"), user("who owns it?")]), []));
test("malformed input", () => {
  for (const bad of [null, "x", [null], [{ role: "user", content: 5 }]]) assert.deepEqual(findLeadNumbers(bad), []);
});
test("formats a lead", () => assert.equal(formatLead(lead), "LD-2026-000002, HMR Konsultan: New Lead, Open, Normal priority, assigned to Abhijith. Onboarding Not Started. Last activity 30 Oct 2026. Next follow-up 31 Oct 2026."));
test("date uses Dubai", () => assert.match(formatLead({ ...lead, next_followup_at: "2026-10-30T21:00:00Z" }), /Next follow-up 31 Oct 2026\.$/));
test("leaves out empty values", () => assert.equal(formatLead({ ...lead, assigned_to: null, next_followup_at: null, last_activity_at: null }), "LD-2026-000002, HMR Konsultan: New Lead, Open, Normal priority. Onboarding Not Started."));
test("leaves out a bad date", () => {
  const out = formatLead({ ...lead, last_activity_at: "soon" });
  assert.ok(!out.includes("Last activity"));
  assert.ok(!out.includes("Invalid"));
});
test("no numbers", () => assert.equal(buildReply([], []), "NO_INFO"));
test("no visible lead", () => assert.equal(buildReply(["LD-2026-000002"], [null]), "NO_INFO"));
test("mixed reply", () => assert.equal(buildReply(["LD-2026-000002", "LD-2026-000099"], [lead, null]), `${formatLead(lead)}\nLD-2026-000099: no information.`));

test("index has no service role or message logging", () => {
  const src = readFileSync(new URL("../supabase/crm-agent/index.ts", import.meta.url), "utf8");
  assert.ok(!src.includes("SERVICE_ROLE"));
  const logs = src.match(/console\.log\([^)]*\)/g) || [];
  assert.ok(logs.length > 0);
  for (const l of logs) assert.ok(!/message|content|lead/i.test(l.replace(/crm-agent/g, "")), l);
});
