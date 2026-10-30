"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";

let client: ReturnType<typeof createBrowserClient<Database, "ceo">> | undefined;

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  client ??= createBrowserClient<Database, "ceo">(url, key, {
    db: { schema: "ceo" },
  });
  return client;
}
