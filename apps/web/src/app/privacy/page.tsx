export default function PrivacyPage() {
  return (
    <article className="prose prose-neutral mx-auto max-w-3xl px-6 py-12">
      <h1 className="font-display text-3xl font-bold">Privacy (one-pager)</h1>
      <p className="mt-4 text-ink/80">
        AIWork captures prompts, tool activity, file paths/edits, and command output from
        coding agents so you can search and resume work.
      </p>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-ink/80">
        <li>
          <strong>Local by default.</strong> History is stored in{" "}
          <code>.aiwork/aiwork.db</code> on your machine. No account is required for capture,
          timeline, or search.
        </li>
        <li>
          <strong>Sync is opt-in.</strong> Cloud sync only runs after you sign in and run{" "}
          <code>aiwork sync</code> (or enable team sync).
        </li>
        <li>
          <strong>Truncation.</strong> File read contents are truncated by default (about 8KB)
          to limit sensitive bulk data in the database.
        </li>
        <li>
          <strong>Decisions.</strong> Optional LLM summaries call Anthropic with session
          event metadata you already captured locally; they are usage-metered on paid plans.
        </li>
        <li>
          <strong>Your responsibility.</strong> Do not capture secrets you are not allowed to
          store. Prefer redacting env files and credentials in agent prompts.
        </li>
      </ul>
      <p className="mt-6 text-sm text-ink/60">Last updated: 2026-10-01</p>
    </article>
  );
}
