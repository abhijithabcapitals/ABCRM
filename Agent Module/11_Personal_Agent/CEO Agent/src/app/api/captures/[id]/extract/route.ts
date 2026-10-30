import { NextResponse } from "next/server";
import { z } from "zod";
import { ExtractionError, extractSuggestions } from "@/lib/openrouter";
import { meetsMfaRequirement } from "@/lib/supabase/assurance";
import { createClient } from "@/lib/supabase/server";

const idSchema = z.uuid();

// Suggestions are returned for review only; nothing is written until the user approves.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid capture id." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone, require_mfa")
    .maybeSingle();
  if (!profile) return NextResponse.json({ error: "Profile not provisioned." }, { status: 403 });
  if (!(await meetsMfaRequirement(supabase, profile.require_mfa))) {
    return NextResponse.json({ error: "MFA verification required." }, { status: 403 });
  }

  // RLS limits this to the signed-in user's own captures.
  const { data: capture } = await supabase
    .from("captures")
    .select("id, input_text, transcript")
    .eq("id", id)
    .maybeSingle();
  const note = capture?.input_text || capture?.transcript;
  if (!note) return NextResponse.json({ error: "Capture not found." }, { status: 404 });

  try {
    const suggestions = await extractSuggestions(note, profile.timezone);
    return NextResponse.json({ suggestions });
  } catch (cause) {
    const message = cause instanceof ExtractionError ? cause.message : "Extraction failed.";
    console.error("extract failed", cause instanceof Error ? cause.message : cause);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
