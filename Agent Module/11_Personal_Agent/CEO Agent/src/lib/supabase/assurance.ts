import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/** True when the session meets the profile's MFA requirement (verified TOTP and aal2). */
export async function meetsMfaRequirement(
  supabase: SupabaseClient<Database, "ceo">,
  requireMfa: boolean,
) {
  if (!requireMfa) return true;
  const [{ data: assurance, error: assuranceError }, { data: factors, error: factorsError }] =
    await Promise.all([
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.auth.mfa.listFactors(),
    ]);
  if (assuranceError) throw new Error(`Could not verify MFA status: ${assuranceError.message}`);
  if (factorsError) throw new Error(`Could not load MFA factors: ${factorsError.message}`);
  const hasVerifiedTotp = factors.totp.some((factor) => factor.status === "verified");
  return hasVerifiedTotp && assurance.currentLevel === "aal2";
}
