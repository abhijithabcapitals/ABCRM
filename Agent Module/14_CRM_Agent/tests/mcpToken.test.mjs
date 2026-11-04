import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createMcpToken } from "../components/mcpToken.js";

test("token is 64 lowercase hex", async () => {
  const { token } = await createMcpToken();
  assert.match(token, /^[0-9a-f]{64}$/);
});

test("hash is the SHA-256 of the token", async () => {
  const { token, hash } = await createMcpToken();
  assert.equal(hash, createHash("sha256").update(token).digest("hex"));
});

test("header value", async () => {
  const { token, headerValue } = await createMcpToken();
  assert.equal(headerValue, "Bearer " + token);
});

test("tokens differ", async () => {
  const a = await createMcpToken();
  const b = await createMcpToken();
  assert.notEqual(a.token, b.token);
});
