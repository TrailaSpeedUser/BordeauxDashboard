"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type Mode = "signIn" | "reset";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/trips";

  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [okMsg, setOkMsg] = useState("");

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrMsg("");
    setOkMsg("");
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      setErrMsg(error.message);
      return;
    }
    // Successful sign-in: cookie is set by the browser client. Force a
    // server round-trip so middleware sees the new session.
    router.push(next);
    router.refresh();
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrMsg("");
    setOkMsg("");
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/api/auth/callback?next=/account/password`,
    });
    setBusy(false);
    if (error) {
      setErrMsg(error.message);
      return;
    }
    setOkMsg("Reset email sent — check your inbox.");
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
      <form
        onSubmit={mode === "signIn" ? handleSignIn : handleReset}
        style={{
          background: "var(--panel)",
          padding: 28,
          borderRadius: 16,
          border: "1px solid var(--border)",
          width: 360,
          boxShadow: "var(--shadow)",
        }}
      >
        <h1 style={{ marginTop: 0 }}>
          {mode === "signIn" ? "Sign in" : "Reset password"}
        </h1>
        {mode === "reset" && (
          <p style={{ color: "var(--muted)", marginTop: 0 }}>
            Enter your email and we&apos;ll send a reset link.
          </p>
        )}

        <label style={labelStyle}>Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@traila.ch"
          autoComplete="email"
          style={inputStyle}
        />

        {mode === "signIn" && (
          <>
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              style={inputStyle}
            />
          </>
        )}

        <button type="submit" className="btn" style={{ width: "100%", marginTop: 4 }} disabled={busy}>
          {busy ? "…" : mode === "signIn" ? "Sign in" : "Send reset link"}
        </button>

        <div style={{ marginTop: 12, fontSize: 12, color: "var(--muted)", textAlign: "center" }}>
          {mode === "signIn" ? (
            <button
              type="button"
              onClick={() => { setMode("reset"); setErrMsg(""); setOkMsg(""); }}
              style={linkBtnStyle}
            >
              Forgot password?
            </button>
          ) : (
            <button
              type="button"
              onClick={() => { setMode("signIn"); setErrMsg(""); setOkMsg(""); }}
              style={linkBtnStyle}
            >
              ← Back to sign in
            </button>
          )}
        </div>

        {okMsg && <div className="flash ok" style={{ marginTop: 12 }}>{okMsg}</div>}
        {errMsg && <div className="flash error" style={{ marginTop: 12 }}>{errMsg}</div>}
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 10,
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--bg2)",
  color: "var(--text)",
  marginBottom: 10,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: 4,
  color: "var(--muted)",
  fontSize: 12,
};

const linkBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--accent-2)",
  cursor: "pointer",
  fontSize: 12,
  textDecoration: "underline",
  padding: 0,
};
