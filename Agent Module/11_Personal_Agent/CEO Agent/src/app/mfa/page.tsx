"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

type TotpFactor = {
  id: string;
  status: "verified" | "unverified";
};

type Enrollment = {
  id: string;
  qrCode: string;
  secret: string;
};

export default function MfaPage() {
  const router = useRouter();
  const [factor, setFactor] = useState<TotpFactor | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadFactors() {
      try {
        const supabase = createClient();
        const { data, error: factorError } = await supabase.auth.mfa.listFactors();
        if (factorError) throw factorError;
        if (!active) return;
        const verified = data.totp.find((candidate) => candidate.status === "verified");
        if (verified) {
          setFactor({ id: verified.id, status: verified.status });
        } else {
          // `data.totp` lists verified factors only; unfinished enrollments appear in `data.all`.
          const pending = data.all.find(
            (candidate) => candidate.factor_type === "totp" && candidate.status === "unverified",
          );
          if (pending) {
            setError("An unfinished authenticator setup exists. Remove it in Supabase Auth or ask an administrator to reset it before continuing.");
          } else {
            const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
              factorType: "totp",
              friendlyName: "CEO Intelligence",
            });
            if (enrollError) throw enrollError;
            if (!active) return;
            setEnrollment({
              id: enrolled.id,
              qrCode: enrolled.totp.qr_code,
              secret: enrolled.totp.secret,
            });
          }
        }
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : "Could not load MFA setup.");
        }
      }
    }

    void loadFactors();
    return () => {
      active = false;
    };
  }, []);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const factorId = enrollment?.id ?? factor?.id;
    if (!factorId) {
      setError("No authenticator factor is available.");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    try {
      const supabase = createClient();
      const { data: challenge, error: challengeError } =
        await supabase.auth.mfa.challenge({ factorId });
      if (challengeError) throw challengeError;

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code: code.replace(/\s/g, ""),
      });
      if (verifyError) throw verifyError;

      setMessage("Authenticator verified.");
      router.replace("/");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "MFA verification failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="setup-shell">
      <section className="setup-card login-card">
        <p className="eyebrow">MULTI-FACTOR AUTHENTICATION</p>
        <h1>Verify it’s you.</h1>
        {enrollment ? (
          <div className="mfa-setup">
            <p className="muted">
              Scan this QR code with an authenticator app, then enter its
              six-digit code to finish setup.
            </p>
            {/* Supabase returns a data URI for this QR image. */}
            <img className="mfa-qr" src={enrollment.qrCode} alt="Authenticator setup QR code" />
            <p className="setup-note">
              Manual setup key: <code>{enrollment.secret}</code>
            </p>
          </div>
        ) : (
          <p className="muted">
            Enter the current six-digit code from your authenticator app.
          </p>
        )}
        <form className="login-form" onSubmit={verify}>
          <label>
            Authenticator code
            <input
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={8}
              onChange={(event) => setCode(event.target.value)}
              pattern="[0-9 ]{6,8}"
              required
              value={code}
            />
          </label>
          {error && <p className="notice notice-error" role="alert">{error}</p>}
          {message && <p className="notice notice-success" role="status">{message}</p>}
          <button className="primary-button" disabled={busy || (!factor && !enrollment)} type="submit">
            {busy ? "Verifying…" : enrollment ? "Enable authenticator" : "Verify and continue"}
          </button>
        </form>
      </section>
    </main>
  );
}
