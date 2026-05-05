"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next") || "/trips";
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sent" | "err">("idle");
  const [errMsg, setErrMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("idle");
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      setErrMsg(error.message);
      setStatus("err");
    } else {
      setStatus("sent");
    }
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
      <form
        onSubmit={handleSubmit}
        style={{
          background: "var(--panel)",
          padding: 28,
          borderRadius: 16,
          border: "1px solid var(--border)",
          width: 360,
          boxShadow: "var(--shadow)",
        }}
      >
        <h1 style={{ marginTop: 0 }}>Sign in</h1>
        <p style={{ color: "var(--muted)", marginTop: 0 }}>
          We&apos;ll email you a magic link.
        </p>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@traila.ch"
          style={{
            width: "100%",
            padding: 10,
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--bg2)",
            color: "var(--text)",
            marginBottom: 12,
          }}
        />
        <button type="submit" className="btn" style={{ width: "100%" }}>
          Send magic link
        </button>
        {status === "sent" && (
          <div className="flash ok" style={{ marginTop: 12 }}>
            Check your email — click the link to sign in.
          </div>
        )}
        {status === "err" && (
          <div className="flash error" style={{ marginTop: 12 }}>
            {errMsg}
          </div>
        )}
      </form>
    </div>
  );
}
