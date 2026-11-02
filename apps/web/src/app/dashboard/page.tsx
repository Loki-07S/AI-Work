"use client";

import { useEffect, useState } from "react";

export default function DashboardPage() {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    setToken(localStorage.getItem("aiwork_token"));
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="font-display text-3xl font-bold">Dashboard</h1>
      <p className="mt-2 text-ink/70">
        Team search and shared history appear here after sync. Use the CLI and Cursor
        extension for day-to-day local work.
      </p>
      {!token ? (
        <p className="mt-8 text-sm">
          Not signed in. <a className="text-accent font-semibold" href="/login">Login</a>
        </p>
      ) : (
        <div className="mt-8 rounded-md border border-mist bg-white p-6">
          <p className="text-sm font-semibold">Signed in</p>
          <p className="mt-2 text-sm text-ink/70">
            Push from a project with <code className="rounded bg-mist/50 px-1">aiwork sync</code>{" "}
            after <code className="rounded bg-mist/50 px-1">aiwork login</code>.
          </p>
        </div>
      )}
    </div>
  );
}
