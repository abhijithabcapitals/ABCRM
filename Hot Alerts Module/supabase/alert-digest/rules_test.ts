import { assert, assertEquals } from "jsr:@std/assert@1";
import { digestSubject, digestText, passwordSecretName, secretMatches , recordDelivery } from "./rules.ts";

const alert = { id: "1", number: "ALT-000001", title: "Licence expiry: Acme", due_date: "2026-12-01", priority: "High", action: "Start the renewal." };

Deno.test("subject counts alerts, singular and plural", () => {
  assertEquals(digestSubject("Digest", 1), "Notification Centre: 1 alert open");
  assertEquals(digestSubject("Digest", 3), "Notification Centre: 3 alerts open");
  assertEquals(digestSubject("Critical", 2), "Critical: 2 alerts need action");
});
Deno.test("text lists each alert with its action and the link", () => {
  const t = digestText("Sam", [alert], "https://x.test/");
  assert(t.startsWith("Hello Sam,"));
  assert(t.includes("- [High] Licence expiry: Acme. Due: 2026-12-01. Action: Start the renewal."));
  assert(t.includes("https://x.test/"));
});
Deno.test("no name and no date still read plainly", () => {
  const t = digestText(null, [{ ...alert, due_date: null }]);
  assert(t.startsWith("Hello there,"));
  assert(t.includes("Due: no date."));
});
Deno.test("secret must match exactly and must exist", () => {
  assert(secretMatches("abc", "abc"));
  assert(!secretMatches("abd", "abc"));
  assert(!secretMatches("ab", "abc"));
  assert(!secretMatches(null, "abc"));
  assert(!secretMatches("abc", undefined));
});
Deno.test("password secret name matches the other mail functions", () => {
  assertEquals(passwordSecretName("info@abcapital.ae"), "MAIL_PASSWORD_INFO_ABCAPITAL_AE");
});
Deno.test("a failed record after a send is logged and never thrown, so the send is not retried", async () => {
  assertEquals(await recordDelivery(() => Promise.resolve({ error: null })), true);
  assertEquals(await recordDelivery(() => Promise.resolve({ error: { message: "no" } })), false);
  assertEquals(await recordDelivery(() => Promise.reject(new Error("network"))), false);
});
