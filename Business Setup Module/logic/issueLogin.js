// What staff are told after the client's login is issued with a quote (portal action setup_issue_login). Pure, so it is tested.
// The quote is saved before the login is asked for, so it stays issued whatever happens here. The password never reaches a screen:
// the server makes it and emails it, and nothing in this file reads one.
const KEPT = "The quote stays issued.";

// result: the action's answer { ok, emailed, username }. error: what it threw (the server's own sentence for a refusal).
export function issueNotice(result, error) {
  if (error) return { tone: "error", text: String(error.message || error), note: KEPT, resend: false };
  if (result?.emailed) return { tone: "ok", text: "The login was emailed to the client.", resend: false };
  return { tone: "warn", text: "The login was not emailed to the client.", note: KEPT, resend: true };
}
