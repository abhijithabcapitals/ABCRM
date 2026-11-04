// What the messenger-files function does, with its outside calls passed in so tests can run it.
// A refused request answers with a plain sentence, safe to show; database and storage wording never leaves here.

export const MAX_BYTES = 25 * 1024 * 1024;
const BLOCKED = new Set(["exe", "bat", "cmd", "com", "msi", "scr", "ps1", "vbs", "js", "jar", "hta", "lnk", "dll"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Deps = {
  // Runs as the signed-in person, so the database decides what they may do.
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  // Null when the storage settings are missing.
  storage: null | {
    putLink: (key: string) => Promise<string>;
    getLink: (key: string, fileName: string) => Promise<string>;
    sizeOf: (key: string) => Promise<number | null>;
    remove: (key: string) => Promise<void>;
  };
  newId: () => string;
};

export class Refused extends Error {}

function checkName(name: unknown): string {
  const text = typeof name === "string" ? name.trim() : "";
  if (!text || text.length > 255) throw new Refused("This file name cannot be used.");
  const ext = text.includes(".") ? text.split(".").pop()!.toLowerCase() : "";
  if (BLOCKED.has(ext)) throw new Refused(`.${ext} files cannot be shared.`);
  return text;
}

function checkId(id: unknown): string {
  if (typeof id !== "string" || !UUID.test(id)) throw new Refused("This request is not valid.");
  return id;
}

async function isMember(deps: Deps, conversation: string) {
  const { data, error } = await deps.rpc("messenger_is_member", { p_conversation: conversation });
  if (error || data !== true) throw new Refused("You are not a member of this chat.");
}

export async function handle(body: Record<string, unknown>, deps: Deps): Promise<Record<string, unknown>> {
  if (!deps.storage) throw new Refused("File sharing is not set up yet.");
  const storage = deps.storage;

  if (body.action === "upload_start") {
    const conversation = checkId(body.conversation_id);
    checkName(body.name);
    if (typeof body.size !== "number" || body.size < 1 || body.size > MAX_BYTES) throw new Refused("Files can be at most 25 MB.");
    await isMember(deps, conversation);
    const key = `${conversation}/${deps.newId()}`;
    return { key, url: await storage.putLink(key) };
  }

  if (body.action === "send_file") {
    const conversation = checkId(body.conversation_id);
    const message = checkId(body.message_id);
    const name = checkName(body.name);
    const key = typeof body.key === "string" ? body.key : "";
    if (!key.startsWith(`${conversation}/`) || !UUID.test(key.slice(conversation.length + 1))) throw new Refused("This request is not valid.");
    await isMember(deps, conversation);
    // An upload link cannot limit the size, so the stored file is measured here.
    const size = await storage.sizeOf(key);
    if (size === null) throw new Refused("Your file was not uploaded. Please try again.");
    if (size < 1 || size > MAX_BYTES) {
      await storage.remove(key);
      throw new Refused("Files can be at most 25 MB.");
    }
    const type = typeof body.type === "string" && body.type && body.type.length <= 200 ? body.type : "application/octet-stream";
    const { error } = await deps.rpc("messenger_send_file", {
      p_id: message, p_conversation: conversation, p_key: key, p_name: name, p_type: type, p_size: size, p_parent: body.parent_id ?? null,
    });
    if (error) throw new Refused("Your file was not sent. Please try again.");
    return { ok: true };
  }

  if (body.action === "download") {
    const { data, error } = await deps.rpc("messenger_file_for_download", { p_attachment: checkId(body.attachment_id) });
    const row = Array.isArray(data) ? data[0] : null;
    if (error || !row) throw new Refused("This file is no longer available.");
    return { url: await storage.getLink(row.storage_key, row.file_name) };
  }

  throw new Refused("This request is not valid.");
}

// RFC 5987, so any file name survives and nothing in it can break out of the header.
export function attachmentHeader(fileName: string): string {
  const safe = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename*=UTF-8''${safe}`;
}
