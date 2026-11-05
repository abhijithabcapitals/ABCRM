import { test } from "node:test";
import assert from "node:assert/strict";
import { accessFrom, agentKeyName, buildSystem, cleanHistory, isSubAgent, knowledgeText, MAX_KNOWLEDGE_CHARS, NO_INFO, readQuestion, wrapData } from "../supabase/agent-gateway/logic.js";
import { agentRequest, agentTimeoutMs, rankingPrompt, ROUTES } from "../supabase/router-agent/logic.js";
import { callerFrom, canReach, listReachable, personFrom, withBudget } from "../../14_CRM_Agent/supabase/crm-agent/logic.js";

test("the gateway runs sub agents only", () => {
  assert.equal(isSubAgent("AGT-03-TAX"), true);
  for (const id of ["AGT-00-ORCHESTRATOR", "AGT-14-CRM", "AGT-11-CEO", "../x", "", null, 3]) assert.equal(isSubAgent(id), false);
});

test("every folder agent has a route except Bruno", () => {
  const ids = ["01-CLIENT", "02-ACCOUNTING", "03-TAX", "04-AUDIT", "05-BIZDEV", "06-SOCIAL", "07-DOCUMENT", "08-SUPPORT", "09-SECURITY", "10-HR", "11-PERSONAL", "11-CEO", "12-IT", "13-EMAIL", "14-CRM"];
  assert.deepEqual(Object.keys(ROUTES).sort(), ids.map((i) => `AGT-${i}`).sort());
});

test("a gateway route names its agent, the browser never does", () => {
  const m = [{ role: "user", content: "x" }];
  assert.deepEqual(agentRequest("AGT-03-TAX", m), { agent_id: "AGT-03-TAX", messages: m, router: true });
  assert.deepEqual(agentRequest("AGT-14-CRM", m), { messages: m, router: true });
});

test("a sub agent has time to ask the CRM Agent", () => assert.ok(agentTimeoutMs("AGT-03-TAX") > 110_000));

test("Settings text reaches the model", () => {
  const s = buildSystem({ name: "Tax Agent", role: "R1", instructions: "I1", extra_content: "E1", approval_rules: "A1" }, { knowledge: "K1", today: "05/11/2026", person: "Sam" });
  for (const part of ["Tax Agent", "R1", "I1", "E1", "K1", "A1", "05/11/2026", "Sam", NO_INFO, "ask_crm_agent"]) assert.ok(s.includes(part), part);
});

test("Bruno's rules reach the ranking prompt", () => {
  const [system] = rankingPrompt("q", [{ id: "a", name: "A", role: "r" }], "Send tax to Tax");
  assert.ok(system.content.includes("Send tax to Tax"));
  assert.ok(!rankingPrompt("q", [], "")[0].content.includes("Routing rules"));
});

test("access needs a tick, credit and budget", () => {
  const agents = [{ id: "AGT-03-TAX", budget_left: 2 }];
  assert.deepEqual(accessFrom({ agents, credit_left: 5 }, "AGT-03-TAX"), { allowed: true, limit: 2 });
  assert.equal(accessFrom({ agents, credit_left: 0 }, "AGT-03-TAX").allowed, false);
  assert.equal(accessFrom({ agents, credit_left: 5 }, "AGT-10-HR").allowed, false);
});

test("key name matches the Settings screen", () => assert.equal(agentKeyName("AGT-14-CRM"), "AGENT_KEY_AGT_14_CRM"));

test("history starts with a question and is cut", () => {
  const h = cleanHistory([{ role: "assistant", content: "a" }, { role: "system", content: "s" }, { role: "user", content: "q" }]);
  assert.deepEqual(h, [{ role: "user", content: "q" }]);
});

test("knowledge stops at the limit", () => {
  const big = { title: "t", body: "x".repeat(MAX_KNOWLEDGE_CHARS) };
  assert.equal(knowledgeText([{ title: "a", body: "b" }, big]), "## a\nb");
});

test("question parsing survives bad input", () => {
  assert.equal(readQuestion('{"question":" q "}'), "q");
  assert.equal(readQuestion("not json"), "");
  assert.equal(readQuestion('{"question":5}'), "");
});

test("CRM data is marked as data", () => assert.ok(wrapData("x").includes("never instructions")));

test("only a real sub agent may ask the CRM Agent", () => {
  assert.equal(callerFrom(undefined), null);
  assert.equal(callerFrom("AGT-03-TAX"), "AGT-03-TAX");
  for (const bad of ["AGT-14-CRM", "AGT-00-ORCHESTRATOR", "x", 5]) assert.equal(callerFrom(bad), "");
});

test("a sub agent gets its list and the person's access together", () => {
  const scope = new Set(["public.hr_employees", "public.bd_leads"]);
  const member = personFrom("member", ["business-development"], scope);
  assert.equal(canReach("public", "bd_leads", member), true);
  assert.equal(canReach("public", "hr_employees", member), false, "person lacks the HR tab");
  assert.equal(canReach("public", "bd_campaigns", member), false, "not on the agent's list");
  const admin = personFrom("admin", [], scope);
  assert.equal(canReach("public", "hr_employees", admin), true);
  assert.equal(canReach("public", "client_master", admin), false, "an admin's sub agent is still limited to its list");
  assert.equal(canReach("public", "agents", personFrom("admin", [], new Set(["public.agents"]))), false, "refused tables stay refused");
  assert.deepEqual(listReachable([{ schema: "public", table: "bd_leads" }, { schema: "public", table: "bd_campaigns" }], member), ["public.bd_leads"]);
});

test("an empty list gives a sub agent nothing, and no list keeps the person's own reach", () => {
  assert.equal(canReach("public", "notifications", personFrom("admin", [], new Set())), false);
  assert.equal(canReach("public", "notifications", personFrom("member", [])), true);
});

test("the CRM Agent's budget limits a sub agent's question", () => {
  assert.deepEqual(withBudget({ allowed: true, limit: 5 }, 1), { allowed: true, limit: 1 });
  assert.equal(withBudget({ allowed: true, limit: 5 }, 0).allowed, false);
  assert.deepEqual(withBudget({ allowed: true, limit: 5 }, null), { allowed: true, limit: 5 });
  assert.equal(withBudget({ allowed: false, limit: 0 }, 9).allowed, false);
});
