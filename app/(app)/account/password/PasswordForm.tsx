"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export function PasswordForm() {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (pw.length < 8) {
      setErr("Password must be at least 8 characters.");
      return;
    }
    if (pw !== pw2) {
      setErr("Passwords don't match.");
      return;
    }
    setBusy(true);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setOk(true);
    setTimeout(() => router.push("/trips"), 1200);
  }

  return (
    <form onSubmit={handleSubmit}>
      <label style={labelStyle}>New password</label>
      <input
        type="password"
        required
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        autoComplete="new-password"
        style={inputStyle}
      />
      <label style={labelStyle}>Confirm new password</label>
      <input
        type="password"
        required
        value={pw2}
        onChange={(e) => setPw2(e.target.value)}
        autoComplete="new-password"
        style={inputStyle}
      />
      <button type="submit" className="btn" disabled={busy}>
        {busy ? "Saving…" : "Update password"}
      </button>
      {err && <div className="flash error" style={{ marginTop: 12 }}>{err}</div>}
      {ok && <div className="flash ok" style={{ marginTop: 12 }}>Password updated — redirecting…</div>}
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 10,
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--bg2)",
  color: "var(--text)",
  marginBottom: 12,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: 4,
  color: "var(--muted)",
  fontSize: 12,
};
