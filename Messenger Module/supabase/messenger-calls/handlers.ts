// What the messenger-calls function does, with its outside calls passed in so tests can run it.
// A refused request answers with a plain sentence, safe to show; database wording never leaves here.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const TOKEN_SECONDS = 600; // long enough to join; a connected call renews its own

export class Refused extends Error {}

const encoder = new TextEncoder();
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const json64 = (value: unknown) => base64url(encoder.encode(JSON.stringify(value)));

const hmacKey = (secret: string, use: KeyUsage) => crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [use]);

// A LiveKit join token for one person in one room.
export async function joinToken(o: { apiKey: string; apiSecret: string; room: string; identity: string; name: string; now: number }): Promise<string> {
  const seconds = Math.floor(o.now / 1000);
  const unsigned = `${json64({ alg: "HS256", typ: "JWT" })}.${json64({
    iss: o.apiKey,
    sub: o.identity,
    name: o.name,
    nbf: seconds - 5,
    exp: seconds + TOKEN_SECONDS,
    video: { room: o.room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
  })}`;
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(o.apiSecret, "sign"), encoder.encode(unsigned));
  return `${unsigned}.${base64url(new Uint8Array(signature))}`;
}

export type CallDeps = {
  // Runs as the signed-in person, so the database decides what they may do.
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  userId: () => Promise<string | null>;
  // Null when the LiveKit settings are missing.
  livekit: null | { url: string; apiKey: string; apiSecret: string };
  now: () => number;
};

export async function handle(body: Record<string, unknown>, deps: CallDeps): Promise<Record<string, unknown>> {
  if (body.action !== "token") throw new Refused("This request is not valid.");
  if (!deps.livekit) throw new Refused("Calls are not set up yet.");
  const id = body.call_id;
  if (typeof id !== "string" || !UUID.test(id)) throw new Refused("This request is not valid.");
  const identity = await deps.userId();
  if (!identity) throw new Refused("Please sign in again.");
  const { data, error } = await deps.rpc("messenger_call_for_token", { p_call: id });
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) throw new Refused("This call has ended.");
  const token = await joinToken({ apiKey: deps.livekit.apiKey, apiSecret: deps.livekit.apiSecret, room: row.room_name, identity, name: row.full_name || "Staff", now: deps.now() });
  return { url: deps.livekit.url, token, media: row.media };
}

// LiveKit signs each webhook: a JWT from our key, holding the sha256 of the exact body. Returns the event, or null if anything is wrong.
export async function verifyWebhook(o: { authorization: string | null; rawBody: string; apiKey: string; apiSecret: string; now: number }): Promise<Record<string, unknown> | null> {
  const parts = (o.authorization || "").replace(/^Bearer\s+/i, "").split(".");
  if (parts.length !== 3) return null;
  try {
    const good = await crypto.subtle.verify("HMAC", await hmacKey(o.apiSecret, "verify"), fromBase64url(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`));
    if (!good) return null;
    const header = JSON.parse(new TextDecoder().decode(fromBase64url(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(fromBase64url(parts[1])));
    if (header.alg !== "HS256" || claims.iss !== o.apiKey) return null;
    const seconds = Math.floor(o.now / 1000);
    if (typeof claims.exp === "number" && claims.exp < seconds - 60) return null;
    if (typeof claims.nbf === "number" && claims.nbf > seconds + 60) return null;
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(o.rawBody)));
    if (claims.sha256 !== btoa(String.fromCharCode(...digest))) return null;
    return JSON.parse(o.rawBody);
  } catch {
    return null;
  }
}

// Only the events that change a call. The database tolerates repeats.
export function webhookCall(event: Record<string, unknown>): { p_room: string; p_event: string; p_person: string | null } | null {
  const kind = event.event;
  const room = (event.room as { name?: unknown } | undefined)?.name;
  if (typeof room !== "string") return null;
  if (kind === "room_finished") return { p_room: room, p_event: kind, p_person: null };
  if (kind === "participant_left") {
    const person = (event.participant as { identity?: unknown } | undefined)?.identity;
    return typeof person === "string" ? { p_room: room, p_event: kind, p_person: person } : null;
  }
  return null;
}
