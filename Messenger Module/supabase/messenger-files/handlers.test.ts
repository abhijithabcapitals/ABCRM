import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { attachmentHeader, type Deps, handle, MAX_BYTES, Refused } from "./handlers.ts";

const CHAT = "11111111-1111-1111-1111-111111111111";
const MSG = "22222222-2222-2222-2222-222222222222";
const FILE = "33333333-3333-3333-3333-333333333333";
const KEY = `${CHAT}/${FILE}`;

function deps(over: { member?: boolean; size?: number | null; rpcError?: boolean; download?: unknown } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const removed: string[] = [];
  const d: Deps = {
    newId: () => FILE,
    rpc: (fn, args) => {
      calls.push({ fn, args });
      if (fn === "messenger_is_member") return Promise.resolve({ data: over.member ?? true, error: null });
      if (fn === "messenger_file_for_download") return Promise.resolve({ data: over.download ?? [{ storage_key: KEY, file_name: "a.pdf" }], error: null });
      return Promise.resolve({ data: null, error: over.rpcError ? { message: "secret database wording" } : null });
    },
    storage: {
      putLink: (key) => Promise.resolve(`https://store/put/${key}`),
      getLink: (key) => Promise.resolve(`https://store/get/${key}`),
      sizeOf: () => Promise.resolve(over.size === undefined ? 1000 : over.size),
      remove: (key) => { removed.push(key); return Promise.resolve(); },
    },
  };
  return { d, calls, removed };
}
const start = { action: "upload_start", conversation_id: CHAT, name: "a.pdf", size: 1000 };
const send = { action: "send_file", conversation_id: CHAT, message_id: MSG, key: KEY, name: "a.pdf", type: "application/pdf" };

Deno.test("upload_start gives a link under the chat's own folder", async () => {
  assertEquals(await handle(start, deps().d), { key: KEY, url: `https://store/put/${KEY}` });
});
Deno.test("upload_start refuses a non-member, a blocked type, too large, and a bad id", async () => {
  await assertRejects(() => handle(start, deps({ member: false }).d), Refused, "not a member");
  await assertRejects(() => handle({ ...start, name: "run.EXE" }, deps().d), Refused, ".exe");
  await assertRejects(() => handle({ ...start, size: MAX_BYTES + 1 }, deps().d), Refused, "25 MB");
  await assertRejects(() => handle({ ...start, conversation_id: "../x" }, deps().d), Refused, "not valid");
});
Deno.test("send_file uses the measured size, not one the browser claims", async () => {
  const { d, calls } = deps({ size: 4242 });
  await handle({ ...send, size: 1 }, d);
  assertEquals(calls.find((c) => c.fn === "messenger_send_file")?.args.p_size, 4242);
});
Deno.test("send_file removes a file over the limit and sends nothing", async () => {
  const { d, calls, removed } = deps({ size: MAX_BYTES + 1 });
  await assertRejects(() => handle(send, d), Refused, "25 MB");
  assertEquals(removed, [KEY]);
  assertEquals(calls.some((c) => c.fn === "messenger_send_file"), false);
});
Deno.test("send_file refuses a key from another chat, a path trick, and a missing file", async () => {
  await assertRejects(() => handle({ ...send, key: `${MSG}/${FILE}` }, deps().d), Refused, "not valid");
  await assertRejects(() => handle({ ...send, key: `${CHAT}/../${FILE}` }, deps().d), Refused, "not valid");
  await assertRejects(() => handle(send, deps({ size: null }).d), Refused, "not uploaded");
});
Deno.test("a database refusal never shows its own wording", async () => {
  const err = await assertRejects(() => handle(send, deps({ rpcError: true }).d), Refused);
  assertEquals(err.message, "Your file was not sent. Please try again.");
});
Deno.test("download needs a row the database agrees to give", async () => {
  assertEquals(await handle({ action: "download", attachment_id: FILE }, deps().d), { url: `https://store/get/${KEY}` });
  await assertRejects(() => handle({ action: "download", attachment_id: FILE }, deps({ download: [] }).d), Refused, "no longer available");
});
Deno.test("missing storage settings and an unknown action get plain sentences", async () => {
  await assertRejects(() => handle(start, { ...deps().d, storage: null }), Refused, "not set up");
  await assertRejects(() => handle({ action: "other" }, deps().d), Refused, "not valid");
});
Deno.test("a file name cannot break out of the download header", () => {
  assertEquals(attachmentHeader(`a"b\r\nX: y'.pdf`), "attachment; filename*=UTF-8''a%22b%0D%0AX%3A%20y%27.pdf");
});
