import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { oneDriveNote, oneDriveType } from "../logic/oneDrive.js";

const rd = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("OneDrive folder: IDs to KYC, bank statements to Bank Statements, the rest to Others", () => {
  for (const t of ["Passport", "Emirates visa", "Emirates ID", "Old visa", "Old Emirates ID"]) assert.equal(oneDriveType(t), "Passport / ID");
  assert.equal(oneDriveType("Bank statement"), "Bank Statement");
  assert.equal(oneDriveType("Ejari"), "Other");
  assert.equal(oneDriveType(undefined), "Other");
});

test("OneDrive note: nothing, all saved, or what failed", () => {
  assert.equal(oneDriveNote({ saved: 0, failed: 0 }), null);
  assert.deepEqual(oneDriveNote({ saved: 2, failed: 0 }), { tone: "ok", text: "2 files saved to the client's OneDrive folder." });
  const w = oneDriveNote({ saved: 1, failed: 1, reason: "the Client Module is not running on this PC" });
  assert.equal(w.tone, "warn");
  assert.match(w.text, /1 file was not saved to OneDrive: the Client Module is not running on this PC/);
});

test("Fields and documents: a case with no form takes a drop, and the files go to OneDrive too", () => {
  const p = rd("../components/onboarding/FieldsPanel.jsx");
  assert.match(p, /caseFormStart\(c\.id\)/);
  assert.match(p, /saveToOneDrive\(file, c\.client_name, c\.client_id, type\)/);
  assert.match(p, /\{canDrop && <BulkUpload/);
});

test("Client Login tab: saving the login emails it", () => {
  const l = rd("../components/workspace/ClientLogin.jsx");
  assert.match(l, /loginSaveAndEmail\(clientId, v\.username, v\.password, !!a\)/);
  assert.match(l, /Emailed to \$\{issued\.email\}/);
  const fn = rd("../../Client Login Module/supabase/client-portal/index.ts");
  assert.match(fn, /action === "setup_login_save"/);
  assert.match(fn, /business_setup_portal_login_save/);
});
