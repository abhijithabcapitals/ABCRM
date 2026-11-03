// Checks the client-portal Edge Function without running it: every Business Setup action works only from the
// account of the live session, and nothing from the browser can name another client's records.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../supabase/client-portal/index.ts", import.meta.url)), "utf8");
const ACTIONS = ["setup_view", "form_get", "form_save", "form_submit", "setup_file"];

function branch(name) {
  const start = src.indexOf(`case "${name}":`);
  assert.notEqual(start, -1, `${name} is missing`);
  const next = src.indexOf("\n      case ", start + 1);
  const def = src.indexOf("\n      default:", start + 1);
  return src.slice(start, Math.min(next === -1 ? Infinity : next, def));
}

test("every Business Setup action sits after the session check", () => {
  const session = src.indexOf('"client_portal_session"');
  assert.ok(session > 0);
  for (const a of ACTIONS) assert.ok(src.indexOf(`case "${a}":`) > session, `${a} runs before the session check`);
});

test("the browser cannot name a client, account or form", () => {
  for (const a of ACTIONS) {
    const b = branch(a);
    assert.doesNotMatch(b, /body\.(client_id|client|account_id|account|form_id)/, `${a} reads an identity from the browser`);
    assert.match(b, /accountId/, `${a} does not use the session's account`);
  }
});

test("setup_file asks the database whether the file is this client's", () => {
  const b = branch("setup_file");
  assert.match(b, /business_setup_portal_file/);
  assert.match(b, /p_account: accountId/);
  assert.match(b, /createSignedUrl\(.*300/s);
});

test("form uploads are tied to this account's own form", () => {
  const b = branch("upload_start");
  assert.match(b, /for_form/);
  assert.match(b, /business_setup_form_get/);
  assert.doesNotMatch(b, /body\.form_id/);
});

test("a preview needs the Setup right or admin", () => {
  assert.match(src, /setup\.portal\.manage/);
});
