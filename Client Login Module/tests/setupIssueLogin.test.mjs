// Checks the login issued with a quote and the client's own decision, without running the Edge Function: the generated secrets follow the staff rules,
// the password goes nowhere but the vault and the email, and the decision runs only from the live session.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generatePassword as serverPassword, suggestUsername as serverUsername, usernameCandidates } from "../supabase/_shared/loginSecret.ts";
import { generatePassword, suggestUsername } from "../../Business Setup Module/logic/loginSecret.js";
import { noticeEmail } from "../supabase/_shared/credentialText.ts";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const portal = read("../supabase/client-portal/index.ts");
const code = (s) => s.replace(/^\s*\/\/.*$/gm, "");

// The part of the staff block that handles one action.
function staffBranch() {
  const start = portal.indexOf('if (action === "setup_issue_login") {');
  assert.notEqual(start, -1, "setup_issue_login is missing from the staff block");
  return portal.slice(start, portal.indexOf('const { data: doc, error: docErr } = await staff.rpc("client_inputs_file"', start));
}

test("the server password follows the staff rules: same length, same alphabet, fresh every time", () => {
  const staffAlphabet = /^[abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789]{14}$/;
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    const s = serverPassword(), c = generatePassword();
    assert.match(s, staffAlphabet);
    assert.match(c, staffAlphabet);
    seen.add(s);
  }
  assert.equal(seen.size, 300);
  assert.equal(serverPassword(20).length, 20);
  assert.doesNotMatch(Array.from({ length: 50 }, () => serverPassword()).join(""), /[01OIl]/, "look-alike characters are left out");
});

test("the server username rule is the staff rule, and the candidates meet the database rule", () => {
  for (const name of ["Al Noor Trading LLC", "  A.B.  ", "Ça va & Co", "", "X", "x".repeat(80)]) assert.equal(serverUsername(name), suggestUsername(name));
  const rule = /^[a-z0-9][a-z0-9._-]{3,59}$/;
  for (const [name, id] of [["Al Noor Trading LLC", "CL000012"], ["X", "CL000012"], ["", "CL000012"], ["!!!", "CL000012"], ["y".repeat(90), "CL000012"]]) {
    const list = usernameCandidates(name, id);
    assert.equal(new Set(list).size, list.length, "no repeats");
    for (const u of list) assert.match(u, rule, `${name} -> ${u}`);
  }
  assert.equal(usernameCandidates("Al Noor Trading LLC", "CL000012")[0], "al.noor.trading.llc");
  assert.equal(usernameCandidates("X", "CL000012")[0], "x.cl000012");
});

test("setup_issue_login checks the right in the database, through the staff client, before it does anything", () => {
  const b = staffBranch();
  assert.match(b, /staff\.rpc\("business_setup_issue_login_ok"/);
  assert.ok(b.indexOf("business_setup_issue_login_ok") < b.indexOf("business_setup_login_grant"));
  assert.ok(b.indexOf("business_setup_issue_login_ok") < b.indexOf("business_setup_login_mail"));
  assert.match(b, /permission/);
  // It is inside the block that runs as the signed-in staff member, before the client-session check.
  assert.ok(portal.indexOf('if (action === "setup_issue_login") {') < portal.indexOf('"client_portal_session"'));
  assert.match(portal, /action === "staff_signed_url" \|\| action === "setup_issue_login"/);
});

test("the password is generated on the server, saved through the service-role grant, and never returned or logged", () => {
  const b = code(staffBranch());
  assert.match(b, /generatePassword\(\)/);
  assert.doesNotMatch(b, /body\.(password|username)/, "the browser names neither");
  assert.match(b, /admin\.rpc\("business_setup_login_grant"/);
  assert.doesNotMatch(b, /client_portal_admin_grant/, "the admin-only function is left alone");
  for (const m of b.matchAll(/json\(\{([^}]*)\}/g)) assert.doesNotMatch(m[1], /password/, `a response carries the password: ${m[0]}`);
  assert.doesNotMatch(b, /console\.(log|error|warn|info)/);
  assert.match(b, /ok: true, emailed: [\w.]+, username/);
  // The returned shape is exactly ok, emailed, username.
  for (const m of b.matchAll(/json\(\{ ok: true([^}]*)\}\)/g)) assert.match(m[1], /^, emailed: [^,]+, username: [^,]+$/);
});

test("a failed email keeps the login; a returning client gets the notice only; resend never changes the login", () => {
  const b = code(staffBranch());
  assert.match(b, /emailCredentials\(admin/);
  assert.match(b, /emailNotice\(admin/);
  const resend = b.slice(b.indexOf("body.resend === true"), b.indexOf("if (info.has_login) return await notice()"));
  assert.ok(resend.length > 100);
  assert.match(resend, /business_setup_login_mail|loginMail\(true\)/);
  assert.doesNotMatch(resend, /login_grant|generatePassword/);
  assert.match(resend, /emailCredentials/);
  // The notice path reads the login without its password.
  assert.match(b, /loginMail\(false\)/);
  assert.doesNotMatch(b.slice(b.indexOf("const notice"), b.indexOf("if (body.resend")), /password/i);
});

test("the notice email carries the username and no password", () => {
  const n = noticeEmail({ name: "Al Noor\r\nTrading", username: "al.noor" });
  assert.match(n.subject, /new quote/i);
  assert.match(n.text, /^Dear Al Noor Trading,/);
  assert.match(n.text, /Username: al\.noor/);
  assert.doesNotMatch(n.text, /password:/i);
  const mail = code(read("../supabase/_shared/credentialMail.ts"));
  const notice = mail.slice(mail.indexOf("export async function emailNotice"), mail.indexOf("export async function emailCredentials"));
  assert.match(notice, /noticeEmail\(mail\)/);
  assert.doesNotMatch(notice, /password/i);
  assert.match(mail, /async function sendText/);
  assert.equal((mail.match(/new SmtpClient\(/g) || []).length, 1, "one mailbox path for both emails");
});

test("setup_decide sits after the session check and uses the session's account only", () => {
  const start = portal.indexOf('case "setup_decide":');
  assert.ok(start > portal.indexOf('rpc("client_portal_session"'));
  const b = portal.slice(start, portal.indexOf('case "gallery_url"', start));
  assert.match(b, /business_setup_portal_decide/);
  assert.match(b, /p_account: accountId/);
  assert.doesNotMatch(b, /body\.(account|account_id|client|client_id|p_account)/);
  assert.match(b, /"Accepted"/);
  assert.match(b, /"Rejected"/);
});

test("the header comment lists both new actions", () => {
  const header = portal.slice(0, portal.indexOf("import "));
  assert.match(header, /setup_issue_login \{ case_id, resend\? \}/);
  assert.match(header, /setup_decide \{ document_id, decision/);
});
