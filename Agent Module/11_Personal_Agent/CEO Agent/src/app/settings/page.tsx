import Link from "next/link";
import { redirect } from "next/navigation";
import ClaudeIntegrationPanel from "@/components/claude-integration-panel";
import { meetsMfaRequirement } from "@/lib/supabase/assurance";
import { createClient } from "@/lib/supabase/server";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("display_name, require_mfa")
    .maybeSingle();
  if (error) throw new Error(`Could not load your CEO profile: ${error.message}`);
  if (profile && !(await meetsMfaRequirement(supabase, profile.require_mfa))) {
    redirect("/mfa");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">CI</span>
          <span>
            <strong>CEO Intelligence</strong>
            <small>Private executive memory</small>
          </span>
        </Link>
        <div className="account">
          <nav aria-label="Main navigation" className="topbar-nav">
            <Link className="nav-link" href="/">
              Workspace
            </Link>
            <Link
              aria-current="page"
              className="nav-link nav-link-active"
              href="/settings"
            >
              Settings
            </Link>
          </nav>
          <span className="account-name">
            {profile?.display_name || user.email || "Signed in"}
          </span>
          <form action="/auth/signout" method="post">
            <button className="text-button" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <div className="workspace settings-workspace">
        <section className="welcome">
          <p className="eyebrow">SETTINGS</p>
          <h1>Connected services</h1>
          <p className="muted">
            Manage the Claude Desktop connection and see what information this
            app can access.
          </p>
        </section>
        {!profile ? (
          <section className="notice notice-error" role="alert">
            Your account is not provisioned for this workspace yet. Ask the
            project administrator to create your CEO profile.
          </section>
        ) : (
          <ClaudeIntegrationPanel />
        )}
      </div>
    </main>
  );
}
