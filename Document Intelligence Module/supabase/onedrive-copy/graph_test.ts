import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { Graph, GraphError, isUnderPath, pathSegments, WriteGuardError } from "./graph.ts";
import { clearTokenCache, getToken, toB64 } from "./msauth.ts";

// ---------- fake fetch ----------
type Call = { method: string; url: string; headers: Record<string, string>; body?: string };
type Handler = (c: Call) => Response | Promise<Response>;

function fake(handler: Handler): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const call: Call = {
      method: init?.method ?? "GET",
      url: String(input),
      headers,
      body: init?.body === undefined ? undefined : String(init.body),
    };
    calls.push(call);
    return await handler(call);
  }) as typeof fetch;
  return { fetch: f, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const ROOT_ID = "ROOT1";
const ROOT_PATH = "/drive/root:/CRM AB CAPITAL";
const DRIVE = "drv1";
const BASE = `https://graph.microsoft.com/v1.0/drives/${DRIVE}`;

const rootItem = (over: Record<string, unknown> = {}) =>
  json({ id: ROOT_ID, name: "CRM AB CAPITAL", folder: {}, parentReference: { path: "/drive/root:" }, ...over });

function mk(handler: Handler, root: Handler = () => rootItem()) {
  const f = fake((c) => (c.method === "GET" && c.url === `${BASE}/items/${ROOT_ID}` ? root(c) : handler(c)));
  const sleeps: number[] = [];
  const graph = new Graph({
    token: () => Promise.resolve("TOKEN-XYZ"),
    fetch: f.fetch,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    driveId: DRIVE,
    destRootId: ROOT_ID,
    destRootPath: ROOT_PATH,
  });
  return { graph, calls: f.calls, sleeps };
}

async function testKeyB64(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  return toB64(new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey)));
}

// ---------- getToken ----------
Deno.test("getToken posts a jwt-bearer client assertion and caches until 60 s before expiry", async () => {
  clearTokenCache();
  const env = {
    tenantId: "tenant-test.example",
    clientId: "00000000-test-client",
    thumbprint: "00112233445566778899AABBCCDDEEFF00112233",
    privateKeyPem: await testKeyB64(),
  };
  const { fetch: f, calls } = fake(() => json({ access_token: "tok-1", expires_in: 3600 }));
  let t = 1_000_000;
  const now = () => t;
  assertEquals(await getToken(env, f, now), "tok-1");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, "https://login.microsoftonline.com/tenant-test.example/oauth2/v2.0/token");
  assertEquals(calls[0].method, "POST");
  const form = new URLSearchParams(calls[0].body);
  assertEquals(form.get("client_assertion_type"), "urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
  assertEquals(form.get("scope"), "https://graph.microsoft.com/.default");
  assertEquals(form.get("grant_type"), "client_credentials");
  assertEquals(form.get("client_id"), env.clientId);
  assertEquals(form.get("client_assertion")!.split(".").length, 3);
  t += 3_000_000; // 3000 s later, 600 s left
  assertEquals(await getToken(env, f, now), "tok-1");
  assertEquals(calls.length, 1);
  t += 541_000; // under 60 s left
  await getToken(env, f, now);
  assertEquals(calls.length, 2);
});

Deno.test("getToken failure message holds no secrets", async () => {
  clearTokenCache();
  const key = await testKeyB64();
  const { fetch: f } = fake(() => json({ error: "invalid_client", error_description: "AADSTS700027: bad\nTrace" }, 401));
  const err = await assertRejects(() =>
    getToken({ tenantId: "t2", clientId: "c2", thumbprint: "00112233445566778899AABBCCDDEEFF00112233", privateKeyPem: key }, f, () => 0)
  );
  assert(String((err as Error).message).includes("401"));
  assert(!String((err as Error).message).includes(key.slice(0, 40)));
});

// ---------- path comparison ----------
Deno.test("pathSegments strips the drive prefix, decodes and lowercases", () => {
  assertEquals(pathSegments("/drive/root:/CRM AB CAPITAL/Accounting"), ["crm ab capital", "accounting"]);
  assertEquals(pathSegments("/drives/b!abc/root:/CRM%20AB%20CAPITAL/Acc%26x"), ["crm ab capital", "acc&x"]);
  assertEquals(pathSegments("/drive/root:"), []);
  assertEquals(pathSegments("CRM AB CAPITAL/X"), ["crm ab capital", "x"]);
});

Deno.test("isUnderPath respects segment boundaries and case", () => {
  assert(isUnderPath("/drive/root:/CRM AB CAPITAL", ROOT_PATH));
  assert(isUnderPath("/drive/root:/crm ab capital/Accounting/X", ROOT_PATH));
  assert(isUnderPath("/drive/root:/CRM%20AB%20CAPITAL/Accounting", ROOT_PATH));
  assert(!isUnderPath("/drive/root:/CRM AB CAPITAL OLD", ROOT_PATH));
  assert(!isUnderPath("/drive/root:/CRM AB CAPITAL OLD/Accounting", ROOT_PATH));
  assert(!isUnderPath("/drive/root:/CRM AB CAPITALX", ROOT_PATH));
  assert(!isUnderPath("/drive/root:/Other/CRM AB CAPITAL", ROOT_PATH));
  assert(!isUnderPath("/drive/root:/CRM AB CAPITAL/../Other", ROOT_PATH));
  assert(!isUnderPath("/drive/root:", ROOT_PATH));
  assert(!isUnderPath(undefined, ROOT_PATH));
});

// ---------- delta ----------
Deno.test("delta follows nextLink and yields the final deltaLink", async () => {
  const { graph, calls } = mk((c) => {
    if (c.url.includes("/items/SRC/delta?")) {
      return json({ value: [{ id: "a", name: "a" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/next-page" });
    }
    if (c.url === "https://graph.microsoft.com/v1.0/next-page") {
      return json({ value: [{ id: "b", name: "b" }], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta-final" });
    }
    return json({}, 404);
  });
  const pages = [];
  for await (const p of graph.delta("SRC")) pages.push(p);
  assertEquals(pages.length, 2);
  assertEquals(pages[0].items.map((i) => i.id), ["a"]);
  assertEquals(pages[0].deltaLink, undefined);
  assertEquals(pages[0].nextLink, "https://graph.microsoft.com/v1.0/next-page");
  assertEquals(pages[1].nextLink, undefined);
  assertEquals(pages[1].deltaLink, "https://graph.microsoft.com/v1.0/delta-final");
  assertEquals(
    calls[0].url,
    `${BASE}/items/SRC/delta?$select=id,name,size,file,folder,parentReference,lastModifiedDateTime,deleted`,
  );
  assertEquals(calls[0].headers.authorization, "Bearer TOKEN-XYZ");
});

Deno.test("delta resumes from a stored deltaLink and refuses foreign hosts", async () => {
  const { graph, calls } = mk(() => json({ value: [], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/d2" }));
  for await (const _ of graph.delta("SRC", "https://graph.microsoft.com/v1.0/d1")) { /* drain */ }
  assertEquals(calls[0].url, "https://graph.microsoft.com/v1.0/d1");
  const g2 = mk(() => json({}));
  await assertRejects(async () => {
    for await (const _ of g2.graph.delta("SRC", "https://evil.example/steal")) { /* drain */ }
  });
  assertEquals(g2.calls.length, 0);
});

// ---------- ensureFolder ----------
Deno.test("ensureFolder creates each level under the destination root and caches ids", async () => {
  let n = 0;
  const { graph, calls } = mk((c) => {
    if (c.method === "POST" && c.url.endsWith("/children")) {
      n++;
      return json({ id: `F${n}`, name: JSON.parse(c.body!).name }, 201);
    }
    return json({}, 404);
  });
  const id = await graph.ensureFolder("Accounting/X - CL900001/KYC");
  assertEquals(id, "F3");
  const posts = calls.filter((c) => c.method === "POST");
  assertEquals(posts.map((p) => p.url), [
    `${BASE}/items/${ROOT_ID}/children`,
    `${BASE}/items/F1/children`,
    `${BASE}/items/F2/children`,
  ]);
  assertEquals(JSON.parse(posts[0].body!), { name: "Accounting", folder: {}, "@microsoft.graph.conflictBehavior": "fail" });
  assertEquals(calls.length, 4, "one read to verify the root, none for ids this run created");
  assertEquals(await graph.ensureFolder("Accounting/X - CL900001/KYC"), "F3");
  assertEquals(await graph.ensureFolder("Accounting/X - CL900001"), "F2");
  assertEquals(calls.length, 4);
});

Deno.test("ensureFolder reuses the existing folder on 409", async () => {
  const { graph, calls } = mk((c) => {
    if (c.method === "POST") return json({ error: { code: "nameAlreadyExists" } }, 409);
    if (c.method === "GET" && c.url === `${BASE}/items/${ROOT_ID}:/Accounting`) {
      return json({ id: "EXIST1", name: "Accounting", folder: {}, parentReference: { path: ROOT_PATH } });
    }
    return json({}, 404);
  });
  assertEquals(await graph.ensureFolder("Accounting"), "EXIST1");
  assertEquals(calls.map((c) => c.method), ["GET", "POST", "GET"]);
});

Deno.test("ensureFolder rejects empty and dot segments before any request", async () => {
  const { graph, calls } = mk(() => json({}, 500));
  await assertRejects(() => graph.ensureFolder("A/../B"), Error);
  await assertRejects(() => graph.ensureFolder("A//B"), Error);
  assertEquals(calls.length, 0);
});

// ---------- write guard ----------
Deno.test("startCopy into a parent outside the destination throws WriteGuardError and sends no POST", async () => {
  for (const outside of ["/drive/root:/Old Source Folder/Accounting", "/drive/root:/CRM AB CAPITAL OLD", "/drive/root:"]) {
    const { graph, calls } = mk((c) => {
      if (c.method === "GET" && c.url.startsWith(`${BASE}/items/BAD`)) {
        return json({ id: "BAD", name: "Sub", parentReference: { path: outside } });
      }
      return json({}, 500);
    });
    await assertRejects(() => graph.startCopy("SRCFILE", "BAD", "a.pdf"), WriteGuardError);
    assertEquals(calls.filter((c) => c.method !== "GET").length, 0);
  }
});

Deno.test("startCopy refuses a parent with no path, and a sibling named like the destination", async () => {
  const { graph, calls } = mk((c) => {
    if (c.url.includes("/items/NOPATH")) return json({ id: "NOPATH", name: "x" });
    if (c.url.includes("/items/SIB")) return json({ id: "SIB", name: "CRM AB CAPITAL OLD", parentReference: { path: "/drive/root:" } });
    return json({}, 500);
  });
  await assertRejects(() => graph.startCopy("S", "NOPATH", "a"), WriteGuardError);
  await assertRejects(() => graph.startCopy("S", "SIB", "a"), WriteGuardError);
  assertEquals(calls.filter((c) => c.method !== "GET").length, 0);
});

Deno.test("startCopy into the destination root and a subfolder is allowed and returns the monitor URL", async () => {
  const { graph, calls } = mk((c) => {
    if (c.method === "GET" && c.url.includes("/items/SUBF")) {
      return json({ id: "SUBF", name: "KYC", parentReference: { path: "/drive/root:/crm ab capital/Accounting/X" } });
    }
    if (c.method === "POST") return new Response(null, { status: 202, headers: { Location: "https://monitor.example/job/1" } });
    return json({}, 500);
  });
  assertEquals(await graph.startCopy("SRCF", ROOT_ID, "root.pdf"), "https://monitor.example/job/1");
  assertEquals(await graph.startCopy("SRCF", "SUBF", "a.pdf"), "https://monitor.example/job/1");
  const posts = calls.filter((c) => c.method === "POST");
  assertEquals(posts[0].url, `${BASE}/items/SRCF/copy?@microsoft.graph.conflictBehavior=rename`);
  assertEquals(JSON.parse(posts[0].body!), { parentReference: { driveId: DRIVE, id: ROOT_ID }, name: "root.pdf" });
  assertEquals(JSON.parse(posts[1].body!).parentReference.id, "SUBF");
});

Deno.test("recycle on a source-folder item throws WriteGuardError and sends no DELETE", async () => {
  const { graph, calls } = mk((c) => {
    if (c.method === "GET") {
      return json({ id: "SRCITEM", name: "f.pdf", parentReference: { path: "/drive/root:/Old Source Folder/Accounting" } });
    }
    return json({}, 500);
  });
  await assertRejects(() => graph.recycle("SRCITEM"), WriteGuardError);
  assertEquals(calls.filter((c) => c.method === "DELETE").length, 0);
});

Deno.test("recycle refuses the destination root itself and deletes a destination item", async () => {
  const { graph, calls } = mk((c) => {
    if (c.method === "GET") {
      return json({ id: "OWN", name: "f.pdf", parentReference: { path: "/drive/root:/CRM AB CAPITAL/Accounting" } });
    }
    if (c.method === "DELETE") return new Response(null, { status: 204 });
    return json({}, 500);
  });
  await assertRejects(() => graph.recycle(ROOT_ID), WriteGuardError);
  assertEquals(calls.length, 0);
  await graph.recycle("OWN");
  assertEquals(calls.at(-1)!.method, "DELETE");
  assertEquals(calls.at(-1)!.url, `${BASE}/items/OWN`);
});

// ---------- retries ----------
Deno.test("429 with Retry-After 2 then 200 sleeps 2000 ms once and succeeds", async () => {
  let n = 0;
  const { graph, sleeps, calls } = mk(() =>
    ++n === 1 ? json({ error: { code: "activityLimitReached" } }, 429, { "Retry-After": "2" }) : json({ id: "i1", name: "n" })
  );
  assertEquals((await graph.getItem("i1")).id, "i1");
  assertEquals(sleeps, [2000]);
  assertEquals(calls.length, 2);
});

Deno.test("five 503 responses throw GraphError without URL or token in the message", async () => {
  const { graph, calls, sleeps } = mk(() => json({ error: { code: "serviceNotAvailable" } }, 503));
  const e = (await assertRejects(() => graph.getItem("i1"), GraphError)) as GraphError;
  assertEquals([e.status, e.code], [503, "serviceNotAvailable"]);
  assert(!e.message.includes("graph.microsoft.com"));
  assert(!e.message.includes("TOKEN-XYZ"));
  assertEquals(calls.length, 5);
  assertEquals(sleeps.length, 4);
});

Deno.test("non-retryable errors throw GraphError at once", async () => {
  const { graph, calls } = mk(() => json({ error: { code: "itemNotFound" } }, 404));
  const e = (await assertRejects(() => graph.getItem("zz"), GraphError)) as GraphError;
  assertEquals([e.status, e.code], [404, "itemNotFound"]);
  assertEquals(calls.length, 1);
});

// ---------- pollCopy ----------
Deno.test("pollCopy sends no Authorization header and maps statuses", async () => {
  const replies = [
    json({ status: "inProgress", percentageComplete: 10 }),
    json({ status: "completed", resourceId: "NEW1" }),
    json({ status: "failed", error: { code: "nameAlreadyExists" } }),
    new Response(null, { status: 303, headers: { Location: `${BASE}/items/NEW2?x=1` } }),
  ];
  const { graph, calls } = mk(() => replies.shift()!);
  assertEquals(await graph.pollCopy("https://monitor.example/job/1"), { status: "inProgress" });
  assertEquals(await graph.pollCopy("https://monitor.example/job/1"), { status: "completed", resourceId: "NEW1" });
  assertEquals(await graph.pollCopy("https://monitor.example/job/1"), { status: "failed", error: "nameAlreadyExists" });
  assertEquals(await graph.pollCopy("https://monitor.example/job/1"), { status: "completed", resourceId: "NEW2" });
  for (const c of calls) assertEquals(c.headers.authorization, undefined);
});

// ---------- fix round 1 ----------
Deno.test("a destination root id that is not the destination folder is refused before any write", async () => {
  for (const wrong of [
    { name: "Old Source Folder", parentReference: { path: "/drive/root:" } }, // wrong folder
    { name: "root", parentReference: undefined }, // drive root, no path
    { name: "CRM AB CAPITAL OLD", parentReference: { path: "/drive/root:" } }, // sibling
    { name: "CRM AB CAPITAL", parentReference: { path: "/drive/root:/Elsewhere" } }, // same name, deeper
  ]) {
    const { graph, calls } = mk(() => json({}, 500), () => rootItem(wrong));
    await assertRejects(() => graph.ensureFolder("Accounting"), WriteGuardError);
    await assertRejects(() => graph.startCopy("S", ROOT_ID, "a.pdf"), WriteGuardError);
    assertEquals(calls.filter((c) => c.method !== "GET").length, 0);
  }
});

Deno.test("shortcuts and remote items are refused as targets and on 409 reuse", async () => {
  const { graph, calls } = mk((c) => {
    if (c.method === "GET" && c.url.includes("/items/LINK")) {
      return json({ id: "LINK", name: "KYC", remoteItem: { id: "x" }, folder: {}, parentReference: { path: ROOT_PATH } });
    }
    if (c.method === "POST") return json({ error: { code: "nameAlreadyExists" } }, 409);
    if (c.method === "GET" && c.url.includes(":/Accounting")) {
      return json({ id: "EX", name: "Accounting", folder: {}, remoteItem: { id: "y" }, parentReference: { path: ROOT_PATH } });
    }
    return json({}, 500);
  });
  await assertRejects(() => graph.startCopy("S", "LINK", "a"), WriteGuardError);
  await assertRejects(() => graph.recycle("LINK"), WriteGuardError);
  await assertRejects(() => graph.ensureFolder("Accounting"), WriteGuardError);
  assertEquals(calls.filter((c) => c.method === "DELETE").length, 0);
});

Deno.test("recycle needs an item strictly deeper than the root; guard errors carry no names", async () => {
  const { graph, calls } = mk((c) => {
    if (c.url.includes("/items/SHALLOW")) return json({ id: "SHALLOW", name: "CRM AB CAPITAL", parentReference: { path: "/drive/root:" } });
    if (c.url.includes("/items/SECRET")) return json({ id: "SECRET", name: "Acme Client Ltd", parentReference: { path: "/drive/root:/Old Source Folder" } });
    return json({}, 500);
  });
  await assertRejects(() => graph.recycle("SHALLOW"), WriteGuardError);
  const e = (await assertRejects(() => graph.recycle("SECRET"), WriteGuardError)) as Error;
  assert(!e.message.includes("Acme") && !e.message.includes("Old Source"));
  assertEquals(calls.filter((c) => c.method === "DELETE").length, 0);
});

Deno.test("copy POST is not retried on 502/504 but is on 429/503; other requests retry 504", async () => {
  for (const status of [502, 504]) {
    const { graph, calls } = mk((c) => (c.method === "POST" ? json({ error: { code: "gw" } }, status) : json({}, 500)), undefined);
    const e = (await assertRejects(() => graph.startCopy("S", ROOT_ID, "a"), GraphError)) as GraphError;
    assertEquals(e.status, status);
    assertEquals(calls.filter((c) => c.method === "POST").length, 1);
  }
  let n = 0;
  const r = mk((c) => (c.method === "POST" ? (++n === 1 ? json({}, 503) : new Response(null, { status: 202, headers: { Location: "https://m.example/1" } })) : json({}, 500)));
  assertEquals(await r.graph.startCopy("S", ROOT_ID, "a"), "https://m.example/1");
  assertEquals(r.calls.filter((c) => c.method === "POST").length, 2);
  let k = 0;
  const g = mk(() => (++k === 1 ? json({}, 504) : json({ id: "i", name: "n" })));
  assertEquals((await g.graph.getItem("i")).id, "i");
});

Deno.test("Retry-After above the cap throws GraphError instead of a shortened wait", async () => {
  for (const status of [429, 503]) {
    const { graph, sleeps, calls } = mk(() => json({ error: { code: "x" } }, status, { "Retry-After": "600" }));
    const e = (await assertRejects(() => graph.getItem("i"), GraphError)) as GraphError;
    assertEquals([e.status, e.code], [status, "throttled"]);
    assertEquals(sleeps, []);
    assertEquals(calls.length, 1);
  }
});

Deno.test("ensureFolder trims segments and rejects whitespace-only ones", async () => {
  const { graph, calls } = mk((c) => (c.method === "POST" ? json({ id: "T1", name: "x" }, 201) : json({}, 404)));
  await assertRejects(() => graph.ensureFolder("A/   /B"), Error);
  assertEquals(calls.length, 0);
  assertEquals(await graph.ensureFolder("  KYC "), "T1");
  assertEquals(JSON.parse(calls.find((c) => c.method === "POST")!.body!).name, "KYC");
});
