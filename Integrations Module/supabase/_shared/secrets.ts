// Shared helper for Edge Functions: read an integration secret by name.
// Copy this file next to a function's index.ts when deploying it, together
// with registry.json, so every function reads secrets the same way.
//
//   import { requireSecret } from "./secrets.ts";
//   const token = requireSecret("WHATSAPP_ACCESS_TOKEN");

import registry from "./registry.json" with { type: "json" };

type Secret = { name: string; use: string; source: string };
type Integration = { id: string; name: string; status: string; secrets: Secret[] };

export const integrations: Integration[] = registry.groups.flatMap((g: { integrations: Integration[] }) => g.integrations);
export const secretNames: string[] = integrations.flatMap((i) => i.secrets.map((s) => s.name));

export class MissingSecretError extends Error {
  constructor(name: string) {
    const owner = integrations.find((i) => i.secrets.some((s) => s.name === name));
    super(`${name} is not set. Add it in Supabase -> Edge Functions -> Secrets${owner ? ` (${owner.name})` : ""}.`);
    this.name = "MissingSecretError";
  }
}

export function getSecret(name: string): string | undefined {
  const value = Deno.env.get(name)?.trim();
  return value ? value : undefined;
}

export function requireSecret(name: string): string {
  const value = getSecret(name);
  if (!value) throw new MissingSecretError(name);
  return value;
}

// True when every secret of an integration has a value.
export function isConfigured(integrationId: string): boolean {
  const i = integrations.find((x) => x.id === integrationId);
  return !!i && i.secrets.every((s) => getSecret(s.name));
}
