import { useState } from "react";
import { supabase } from "../supabase";
import { BrandLogo, COPYRIGHT } from "./Brand";
import { portalLogin } from "@client-module/portal/portalApi";

export default function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      setError("Please enter your email or username, and your password.");
      return;
    }
    setLoading(true);
    setError("");
    // Staff sign in with an email; clients have a username with no @ and go to the Client Portal.
    if (!email.includes("@")) {
      try {
        await portalLogin(email.trim(), password);
        window.location.reload();
      } catch (e) {
        setError(e.message);
        setLoading(false);
      }
      return;
    }
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (authError) {
      setError("Invalid email or password. Please try again.");
    } else {
      onLogin(data.user);
    }
    setLoading(false);
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: 16,
        alignItems: "center",
        justifyContent: "center",
        background: "#f5f5f4",
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: 36,
          width: "100%",
          maxWidth: 400,
          border: "1px solid #e8e8e8",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <BrandLogo height={84} />
          </div>
          <div style={{ fontSize: 13, color: "#888", marginTop: 10 }}>
            Sign in
          </div>
        </div>

        {error && (
          <div
            style={{
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 6,
              padding: "10px 14px",
              fontSize: 13,
              color: "#b91c1c",
              marginBottom: 16,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ marginBottom: 14 }}>
          <label
            style={{
              display: "block",
              fontSize: 12,
              fontWeight: 500,
              color: "#555",
              marginBottom: 5,
            }}
          >
            Email or username
          </label>
          <input
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            placeholder="you@abcapital.ae"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            style={{ width: "100%" }}
            autoFocus
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label
            style={{
              display: "block",
              fontSize: 12,
              fontWeight: 500,
              color: "#555",
              marginBottom: 5,
            }}
          >
            Password
          </label>
          <input
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            style={{ width: "100%" }}
          />
        </div>

        <button
          onClick={handleLogin}
          disabled={loading}
          style={{
            width: "100%",
            padding: "10px",
            background: loading ? "#93c5fd" : "var(--accent)",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 500,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>

        <div
          style={{
            fontSize: 12,
            color: "#aaa",
            textAlign: "center",
            marginTop: 16,
          }}
        >
          Contact your admin to get access
        </div>
      </div>
      <div style={{ fontSize: 11, color: "#6b7f82", textAlign: "center" }}>{COPYRIGHT}</div>
    </div>
  );
}
