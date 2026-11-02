"use client";

import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: mode, email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "failed");
        return;
      }
      setToken(data.token);
      localStorage.setItem("aiwork_token", data.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-6 py-16">
      <h1 className="font-display text-3xl font-bold">
        {mode === "login" ? "Sign in" : "Create account"}
      </h1>
      <p className="mt-2 text-ink/70">
        Local capture stays offline. Login unlocks cloud sync for your workspace.
      </p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <label className="block text-sm font-semibold">
          Email
          <input
            className="mt-1 w-full rounded-md border border-mist bg-white px-3 py-2"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="block text-sm font-semibold">
          Password
          <input
            className="mt-1 w-full rounded-md border border-mist bg-white px-3 py-2"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>
        {error && <p className="text-sm text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {loading ? "…" : mode === "login" ? "Sign in" : "Register"}
        </button>
      </form>
      <button
        className="mt-4 text-sm font-semibold text-accent"
        onClick={() => setMode(mode === "login" ? "register" : "login")}
      >
        {mode === "login" ? "Need an account? Register" : "Have an account? Sign in"}
      </button>

      {token && (
        <div className="mt-8 rounded-md border border-mist bg-white p-4">
          <p className="text-sm font-semibold">CLI login token</p>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-xs">{token}</pre>
          <p className="mt-3 text-sm text-ink/70">
            Run:{" "}
            <code className="rounded bg-mist/60 px-1">
              aiwork login --token {"<token>"} --api {typeof window !== "undefined" ? window.location.origin : ""}
            </code>
          </p>
        </div>
      )}

      <div className="mt-8 border-t border-mist pt-6">
        <a
          href="/api/auth/github"
          className="inline-flex rounded-md border border-mist bg-white px-4 py-2 text-sm font-semibold"
        >
          Continue with GitHub
        </a>
      </div>
    </div>
  );
}
