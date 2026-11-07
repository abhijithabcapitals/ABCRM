// node --test "Business Development Module/tests/"
import test from "node:test";
import assert from "node:assert/strict";
import { addLeadFiles, fillLeadForm, leadFromDocai } from "../logic/leadDocuments.js";

const licence = {
  name: "licence.pdf",
  extraction: {
    fields: [
      { key: "trade_name", value: "ACME Trading", confidence: "high" },
      { key: "legal_name", value: "ACME  General Trading LLC", confidence: "high" },
      { key: "email", value: "Info@Acme.ae", confidence: "medium" },
      { key: "phone", value: "+971 50 123 4567", confidence: "low" },
      { key: "main_activity", value: "General Trading", confidence: "high" },
    ],
    people: [{ name: "JOHN SMITH", nationality: "British" }],
  },
};
const passport = { name: "passport.jpg", extraction: { fields: [], people: [{ name: "MARIA DE LA CRUZ", nationality: "Philippines" }] } };

test("a licence gives the company, contact, email and activity; low confidence is skipped", () => {
  const { values, sources } = leadFromDocai([licence]);
  assert.deepEqual(values, {
    name: "ACME General Trading LLC", email: "info@acme.ae", contact_name: "John Smith",
    notes: "Business activity (from documents): General Trading",
  });
  assert.equal(sources.name, "licence.pdf");
});

test("a passport alone makes an individual lead", () => {
  const { values } = leadFromDocai([passport]);
  assert.deepEqual(values, { name: "Maria De La Cruz", lead_type: "individual" });
});

test("the first document wins for the contact person", () => {
  const { values } = leadFromDocai([passport, licence]);
  assert.equal(values.contact_name, "Maria De La Cruz");
  assert.equal(values.name, "ACME General Trading LLC");
});

test("only empty fields are filled; the lead type follows the name", () => {
  const form = { lead_type: "company", name: "", contact_name: "Typed", email: "", mobile: "", notes: "" };
  const { form: next, filled } = fillLeadForm(form, { name: "Maria", lead_type: "individual", contact_name: "Other", email: "a@b.co" });
  assert.equal(next.name, "Maria");
  assert.equal(next.lead_type, "individual");
  assert.equal(next.contact_name, "Typed");
  assert.equal(next.email, "a@b.co");
  assert.deepEqual(filled, ["name", "lead_type", "email"]);
  const kept = fillLeadForm({ ...form, name: "Typed Co" }, { name: "Maria", lead_type: "individual" });
  assert.equal(kept.form.lead_type, "company");
  assert.deepEqual(kept.filled, []);
});

test("files: PDFs and images only, no repeats, 20 MB cap", () => {
  const a = { name: "a.pdf", size: 10 };
  const { files, rejected } = addLeadFiles([a], [a, { name: "b.PNG", size: 5 }, { name: "c.docx", size: 5 }, { name: "d.jpg", size: 21 * 1024 * 1024 }]);
  assert.deepEqual(files.map((f) => f.name), ["a.pdf", "b.PNG"]);
  assert.equal(rejected.length, 2);
});
