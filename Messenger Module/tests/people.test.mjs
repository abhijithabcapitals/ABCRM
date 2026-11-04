import test from "node:test";
import assert from "node:assert/strict";
import { splitStaff } from "../logic/people.js";

test("splitStaff leaves out self and separates people with no email", () => {
  const { available, noEmail } = splitStaff([
    { id: "1", full_name: "Me", email: "me@x.ae" },
    { id: "2", full_name: "A", email: "a@x.ae" },
    { id: "3", full_name: "B", email: " " },
  ], "1");
  assert.deepEqual(available.map((p) => p.id), ["2"]);
  assert.deepEqual(noEmail.map((p) => p.id), ["3"]);
});

test("splitStaff keeps everyone when no current user is known, and sorts by name", () => {
  const { available } = splitStaff([
    { id: "2", full_name: "Zed", email: "z@x.ae" },
    { id: "1", full_name: "Amy", email: "a@x.ae" },
  ], undefined);
  assert.deepEqual(available.map((p) => p.id), ["1", "2"]);
});
