import Link from "next/link";
import { redirect } from "next/navigation";
import CaptureReview from "@/components/capture-review";
import CaptureWorkspace from "@/components/capture-workspace";
import { meetsMfaRequirement } from "@/lib/supabase/assurance";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ) {
    return (
      <main className="setup-shell">
        <section className="setup-card">
          <div className="brand-mark">CI</div>
          <p className="eyebrow">PRIVATE EXECUTIVE WORKSPACE</p>
          <h1>Your ideas, decisions and commitments—in one trusted place.</h1>
          <p className="muted">
            The starter is built. Connect a dedicated Supabase project to turn
            on sign-in and private capture.
          </p>
          <Link className="primary-link" href="/login">
            Open setup sign-in
          </Link>
          <p className="setup-note">
            Follow <code>README.md</code> before adding any private information.
          </p>
        </section>
      </main>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("display_name, timezone, require_mfa")
    .maybeSingle();
  if (profileError) throw new Error(`Could not load your CEO profile: ${profileError.message}`);

  if (profile && !(await meetsMfaRequirement(supabase, profile.require_mfa))) redirect("/mfa");

  const [{ data: captures, error }] = await Promise.all([
    supabase
      .from("captures")
      .select("id, input_text, transcript, audio_path, status, created_at, error_message")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

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
      <div className="workspace">
        <section className="welcome">
          <p className="eyebrow">YOUR EXECUTIVE MEMORY</p>
          <h1>Capture the thought. Keep the context.</h1>
          <p className="muted">
            Save a thought, then ask for suggested records and approve the ones
            to keep. Transcription, reminders and CRM sync stay off until
            configured and verified.
          </p>
        </section>
        {!profile ? (
          <section className="notice notice-error" role="alert">
            Your account is not provisioned for this workspace yet. Ask the
            project administrator to create your CEO profile in{" "}
            <code>ceo.profiles</code>.
          </section>
        ) : (
          <CaptureWorkspace userId={user.id} />
        )}
        {error ? (
          <section className="notice notice-error" role="alert">
            Could not load saved captures: {error.message}
          </section>
        ) : (
          <section className="capture-history">
            <div className="section-heading">
              <div>
                <p className="eyebrow">RECENT CAPTURES</p>
                <h2>Your saved thoughts</h2>
              </div>
              <span className="count-pill">{captures?.length ?? 0}</span>
            </div>
            {!captures?.length ? (
              <div className="empty-state">
                Your saved captures will appear here.
              </div>
            ) : (
              <ul className="capture-list">
                {captures.map((capture) => (
                  <li className="capture-row" key={capture.id}>
                    <div className="capture-copy">
                      <p>
                        {capture.input_text ||
                          capture.transcript ||
                          (capture.audio_path
                            ? "Voice recording saved"
                            : "Capture received")}
                      </p>
                      <time dateTime={capture.created_at}>
                        {new Intl.DateTimeFormat("en", {
                          dateStyle: "medium",
                          timeStyle: "short",
                          timeZone: profile?.timezone || "Asia/Dubai",
                        }).format(new Date(capture.created_at))}
                      </time>
                      {capture.error_message && (
                        <small className="error-text">{capture.error_message}</small>
                      )}
                      {(capture.input_text || capture.transcript) && (
                        <CaptureReview captureId={capture.id} userId={user.id} />
                      )}
                    </div>
                    <span className={`status-pill status-${capture.status}`}>
                      {capture.status.replaceAll("_", " ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        <footer className="privacy-footnote">
          Captures are private to your signed-in account. A note is sent to
          OpenRouter (DeepSeek) only when you press “Suggest records”, and only
          approved suggestions are saved. No other external actions are enabled.
        </footer>
      </div>
    </main>
  );
}
