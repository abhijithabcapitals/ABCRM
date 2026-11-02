// Shared helper for Edge Functions: read a credential saved in Settings > Integrations.
// Copy this file next to a function's index.ts when deploying it.
//
//   import { requireSecret } from "./secrets.ts";
//   const token = await requireSecret(adminClient, "WHATSAPP_ACCESS_TOKEN");
//
// `adminClient` is a Supabase client using the service role: only that role can read
// Vault values. A value saved in Settings wins over an Edge Function secret of the same name.

// deno-lint-ignore no-explicit-any
type Db = any;

export class MissingSecretError extends Error {
  constructor(name: string) {
    super(`${name} is not set. Add it in Settings > Integrations.`);
    this.name = "MissingSecretError";
  }
}

export async function getSecret(admin: Db, name: string): Promise<string | undefined> {
  const { data } = await admin.rpc("credential_get", { p_name: name });
  const value = (typeof data === "string" && data ? data : Deno.env.get(name))?.trim();
  return value ? value : undefined;
}

export async function requireSecret(admin: Db, name: string): Promise<string> {
  const value = await getSecret(admin, name);
  if (!value) throw new MissingSecretError(name);
  return value;
}
