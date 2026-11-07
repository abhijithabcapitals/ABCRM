// node --test "Impovements Module/tests"
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { addFiles, filterRows, formProblem, MAX_FILES, safeName, storagePath } from "../logic/improvements.js";

const file = (name, type = "image/png", size = 1000) => ({ name, type, size });

test("addFiles keeps images and PDFs, refuses other types, big files and an 11th file", () => {
  const { files, errors } = addFiles([], [file("a.png"), file("b.pdf", "application/pdf"), file("c.exe", "application/x-msdownload"), file("d.png", "image/png", 11 * 1024 * 1024)]);
  assert.deepEqual(files.map((f) => f.name), ["a.png", "b.pdf"]);
  assert.equal(errors.length, 2);
  const full = Array.from({ length: MAX_FILES }, (_, i) => file(`${i}.png`));
  const more = addFiles(full, [file("x.png")]);
  assert.equal(more.files.length, MAX_FILES);
  assert.match(more.errors[0], /Only 10/);
});

test("safeName and storagePath give a path the database accepts", () => {
  assert.equal(safeName("My screen shot (1).png"), "My_screen_shot_1_.png");
  assert.equal(safeName("../../etc"), "etc");
  assert.equal(storagePath("u1", "r1", "x", "a b.png"), "u1/r1/x-a_b.png");
});

test("formProblem needs a title and limits lengths", () => {
  assert.match(formProblem({ title: "  " }), /title/);
  assert.match(formProblem({ title: "x".repeat(201) }), /under 200/);
  assert.equal(formProblem({ title: "Fix", details: "ok" }), "");
});

test("filterRows: open hides done and declined", () => {
  const rows = ["new", "seen", "planned", "done", "declined"].map((status) => ({ status }));
  assert.equal(filterRows(rows, "open").length, 3);
  assert.equal(filterRows(rows, "done").length, 1);
  assert.equal(filterRows(rows, "all").length, 5);
});

test("the table turns on row-level security and the bucket stays private", () => {
  const sql = readFileSync(fileURLToPath(new URL("../../Database Module/Improvements Base/migrations/001_improvements.sql", import.meta.url)), "utf8");
  assert.match(sql, /alter table public\.improvement_requests enable row level security/);
  assert.match(sql, /'improvements', 'improvements', false/);
});
