import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MAIN_FIELDS, isExpired, mainFieldsForm, mainFieldsPayload, mergeMainFields, needsAttention } from "../logic/mainFields.js";

test("main fields join the client list by client id", () => {
  const rows = mergeMainFields([{ client_id: "A", legal_name: "A LLC" }], [{ client_id: "A", zone: "IFZA", missing: ["Visa"], dates_to_check: true }]);
  assert.equal(rows[0].legal_name, "A LLC");
  assert.equal(rows[0].zone, "IFZA");
  assert.deepEqual(rows[0].missing, ["Visa"]);
  assert.equal(rows[0].dates_to_check, true);
});

test("a client the fields list does not hold shows every field as missing", () => {
  const [r] = mergeMainFields([{ client_id: "B" }], []);
  assert.equal(r.missing.length, MAIN_FIELDS.length);
  assert.equal(needsAttention(r), true);
});

test("a complete client needs no attention, and a date to check does", () => {
  assert.equal(needsAttention({ missing: [] }), false);
  assert.equal(needsAttention({ missing: [], dates_to_check: true }), true);
});

test("the form sends every field, so a cleared value is cleared", () => {
  const p = mainFieldsPayload({ zone: " IFZA ", manager: "" });
  assert.deepEqual(Object.keys(p).sort(), MAIN_FIELDS.map((f) => f.name).sort());
  assert.equal(p.zone, "IFZA");
  assert.equal(p.manager, "");
  assert.equal(p.visa, "");
});

test("the form marks what is missing and nothing else", () => {
  const f = mainFieldsForm({ missing: ["Visa"] });
  assert.equal(f.find((x) => x.name === "visa").label, "Visa (missing)");
  assert.equal(f.find((x) => x.name === "zone").label, "Zone");
});

test("an expiry before today is expired; a blank is not", () => {
  assert.equal(isExpired("2026-01-01", "2026-11-05"), true);
  assert.equal(isExpired("2026-11-05", "2026-11-05"), false);
  assert.equal(isExpired(null, "2026-11-05"), false);
});

test("All Clients asks for portal access only on a client with a Banking-side row", () => {
  const src = readFileSync(fileURLToPath(new URL("../../Client Module/crm/ClientsHub.jsx", import.meta.url)), "utf8");
  assert.match(src, /isAdmin && !open\.setup_only && <ClientAccess/);
});

test("the row's edit button does not also open the client, and needs the KYC right", () => {
  const src = readFileSync(fileURLToPath(new URL("../components/Clients.jsx", import.meta.url)), "utf8");
  assert.match(src, /stopPropagation/);
  assert.match(src, /can\("setup\.kyc\.manage"\) &&[\s\S]*Complete/);
});
