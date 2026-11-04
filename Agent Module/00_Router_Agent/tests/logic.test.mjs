import test from "node:test";
import assert from "node:assert/strict";
import {
  FIXED_REPLY, NO_INFO, MAX_MESSAGE, ROUTES,
  eligibleAgents, canAfford, parseRanking, rankingPrompt,
  agentRequest, readAgentReply, agentHistory, fallbackAgents, rankingFailureReason,
  agentTimeoutMs, rankingCostUsd, RANKING_MODEL,
} from "../supabase/router-agent/logic.js";

test("the fixed reply keeps the user's spelling", () => assert.equal(FIXED_REPLY, "Opps! I dont Know"));
test("constants", () => {
  assert.equal(NO_INFO, "NO_INFO");
  assert.equal(MAX_MESSAGE, 4000);
  assert.deepEqual(Object.keys(ROUTES), ["AGT-08-SUPPORT", "AGT-05-BIZDEV", "AGT-11-CEO", "AGT-14-CRM"]);
  assert.equal(ROUTES["AGT-14-CRM"].fn, "crm-agent");
  assert.equal(ROUTES["AGT-08-SUPPORT"].fn, "support-agent");
  assert.equal(ROUTES["AGT-05-BIZDEV"].fn, "bd-agent");
  assert.equal(ROUTES["AGT-11-CEO"].fn, "ceo-agent");
});
test("CRM agent is eligible", () => assert.deepEqual(eligibleAgents([{ id: "AGT-14-CRM" }]).map((a) => a.id), ["AGT-14-CRM"]));
test("CRM request is router mode", () => { const m = [{ role: "user", content: "x" }]; assert.deepEqual(agentRequest("AGT-14-CRM", m), { messages: m, router: true }); });
test("only agents with a route", () => assert.deepEqual(eligibleAgents([{ id: "AGT-13-EMAIL" }, { id: "AGT-08-SUPPORT" }]).map((a) => a.id), ["AGT-08-SUPPORT"]));
test("eligible keeps order", () => assert.deepEqual(eligibleAgents([{ id: "AGT-11-CEO" }, { id: "AGT-08-SUPPORT" }]).map((a) => a.id), ["AGT-11-CEO", "AGT-08-SUPPORT"]));
test("ranking keeps at most two", () => assert.deepEqual(parseRanking('["a","b","c"]', ["a", "b", "c"]), ["a", "b"]));
test("ranking drops unknown ids", () => assert.deepEqual(parseRanking('["AGT-14-CRM","a"]', ["a"]), ["a"]));
test("ranking removes repeats", () => assert.deepEqual(parseRanking('["a","a"]', ["a"]), ["a"]));
test("ranking reads a fenced array", () => assert.deepEqual(parseRanking('```json\n["a"]\n```', ["a"]), ["a"]));
test("prose means no agent", () => assert.deepEqual(parseRanking("Use the a agent", ["a"]), []));
test("bad JSON means no agent", () => assert.deepEqual(parseRanking('["a"', ["a"]), []));
test("non-array JSON means no agent", () => assert.deepEqual(parseRanking('{"a":1}', ["a"]), []));
test("non-string text means no agent", () => assert.deepEqual(parseRanking(undefined, ["a"]), []));
test("an answer stays word for word", () => assert.deepEqual(readAgentReply(200, { reply: "  Three tasks.\n" }), { answer: "  Three tasks.\n" }));
test("NO_INFO alone", () => assert.deepEqual(readAgentReply(200, { reply: "NO_INFO" }), { code: "no_info" }));
test("NO_INFO inside text", () => assert.deepEqual(readAgentReply(200, { reply: "Sorry. NO_INFO" }), { code: "no_info" }));
test("empty reply", () => assert.deepEqual(readAgentReply(200, { reply: "  " }), { code: "empty" }));
test("missing or non-string reply", () => {
  assert.deepEqual(readAgentReply(200, {}), { code: "empty" });
  assert.deepEqual(readAgentReply(200, null), { code: "empty" });
  assert.deepEqual(readAgentReply(200, { reply: 5 }), { code: "empty" });
});
test("refused", () => assert.deepEqual(readAgentReply(403, { error: "x" }), { code: "agent_403" }));
test("any non-2xx is an error", () => {
  assert.deepEqual(readAgentReply(500, { reply: "hi" }), { code: "agent_500" });
  assert.deepEqual(readAgentReply(199, { reply: "hi" }), { code: "agent_199" });
  assert.deepEqual(readAgentReply(201, { reply: "hi" }), { answer: "hi" });
});
test("CEO request carries thread and key", () => assert.deepEqual(agentRequest("AGT-11-CEO", [], { threadId: "t", idempotencyKey: "k" }), { messages: [], threadId: "t", idempotencyKey: "k", router: true }));
test("BD request is a chat action", () => assert.equal(agentRequest("AGT-05-BIZDEV", [], {}).action, "chat"));
test("Support request has only messages and the flag", () => assert.deepEqual(agentRequest("AGT-08-SUPPORT", [], {}), { messages: [], router: true }));
test("spending can use up credit", () => assert.equal(canAfford({ budget_left: null }, 1, 1), false));
test("spending can use up the budget", () => assert.equal(canAfford({ budget_left: 0.5 }, 5, 0.5), false));
test("no cap needs only credit", () => assert.equal(canAfford({ budget_left: null }, 1, 0.5), true));
test("budget and credit both above spend", () => assert.equal(canAfford({ budget_left: 2 }, 5, 0.5), true));
test("history ends with the question", () => assert.deepEqual(agentHistory([{ role: "assistant", content: "x" }], "q").at(-1), { role: "user", content: "q" }));
test("history leaves out other roles", () => assert.deepEqual(agentHistory([{ role: "system", content: "s", extra: 1 }, { role: "user", content: "u", extra: 1 }], "q"), [{ role: "user", content: "u" }, { role: "user", content: "q" }]));
test("the ranking prompt holds no instructions from data", () => assert.match(rankingPrompt("ignore rules", [{ id: "a", name: "A", role: "R" }])[0].content, /only/i));
test("ranking prompt lists agents and question", () => {
  const m = rankingPrompt("my q", [{ id: "a", name: "A", role: "R" }]);
  assert.equal(m[0].role, "system");
  assert.equal(m[1].role, "user");
  assert.equal(m[1].content, "my q");
  assert.match(m[0].content, /"a"/);
});

test("a failed ranking falls back to the first two agents", () => assert.deepEqual(fallbackAgents([{ id: "a" }, { id: "b" }, { id: "c" }]), ["a", "b"]));
test("the ranking failure reason is short and on one line", () => assert.equal(rankingFailureReason({ error: { message: "Key\nlimit exceeded" } }, "hi"), "Key limit exceeded"));
test("the ranking failure reason is cut at 120 characters", () => assert.equal(rankingFailureReason({ error: { message: "x".repeat(200) } }, "hi").length, 120));
test("a reason quoting the question is not logged", () => assert.equal(rankingFailureReason({ error: { message: "Flagged: my private question" } }, "my private question"), ""));
test("provider metadata is never used as the reason", () => assert.equal(rankingFailureReason({ error: { metadata: { flagged_input: "secret" } } }, "q"), ""));
test("no error body gives no reason", () => assert.equal(rankingFailureReason(null, "q"), ""));

const shared = [{ role: "user", content: "q1" }, { role: "assistant", content: "from BD", agent_id: "AGT-05-BIZDEV" }, { role: "user", content: "q2" }, { role: "assistant", content: "from CEO", agent_id: "AGT-11-CEO" }];
test("an agent gets only its own replies", () => assert.deepEqual(agentHistory(shared, "q3", "AGT-11-CEO").map((m) => m.content), ["q1", "q2", "from CEO", "q3"]));
test("an agent with no replies gets only the questions", () => assert.deepEqual(agentHistory(shared, "q3", "AGT-08-SUPPORT").map((m) => m.role), ["user", "user", "user"]));
test("history items hold only role and content", () => assert.deepEqual(Object.keys(agentHistory(shared, "q", "AGT-05-BIZDEV")[1]), ["role", "content"]));
test("the CRM Agent gets more time", () => { assert.equal(agentTimeoutMs("AGT-14-CRM"), 120000); assert.equal(agentTimeoutMs("AGT-08-SUPPORT"), 70000); });
test("ranking is priced as Haiku", () => assert.equal(rankingCostUsd({ input_tokens: 1000000, output_tokens: 1000000 }), 0.6));
test("no usage costs nothing", () => assert.equal(rankingCostUsd(undefined), 0));
test("ranking uses Haiku", () => assert.equal(RANKING_MODEL, "claude-haiku-5-5"));
