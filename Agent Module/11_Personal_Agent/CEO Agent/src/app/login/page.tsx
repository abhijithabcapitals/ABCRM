"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);

    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) throw signInError;
      window.location.assign("/");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Sign-in failed. Please try again.",
      );
      setBusy(false);
    }
  }

  return (
    <main className="setup-shell">
      <section className="setup-card login-card">
        <Link className="brand" href="/">
          <span className="brand-mark">CI</span>
          <span>
            <strong>CEO Intelligence</strong>
            <small>Private executive memory</small>
          </span>
        </Link>
        <p className="eyebrow">SECURE SIGN IN</p>
        <h1>Welcome back.</h1>
        <p className="muted">
          Access is invite-only. Create your user in the dedicated Supabase
          project before signing in.
        </p>
        <form className="login-form" onSubmit={signIn}>
          <label>
            Email
            <input
              autoComplete="username"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error && (
            <p className="notice notice-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary-button" disabled={busy} type="submit">
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
