export default function HomePage() {
  return (
    <section className="relative mx-auto max-w-5xl px-6 pb-24 pt-20">
      <div className="max-w-2xl">
        <p className="font-display text-5xl font-bold leading-tight tracking-tight text-ink md:text-6xl">
          AIWork
        </p>
        <h1 className="mt-6 text-2xl font-semibold text-ink/90 md:text-3xl">
          Record, organize, and resume what your coding agents did.
        </h1>
        <p className="mt-4 max-w-xl text-lg text-ink/70">
          Local-first timeline for Cursor and Claude Code. Search tasks in seconds. Sync
          when your team needs a shared history.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a
            href="/login"
            className="rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-accent/90"
          >
            Sign in to sync
          </a>
          <a
            href="/privacy"
            className="rounded-md border border-mist bg-white px-5 py-2.5 text-sm font-semibold text-ink transition hover:border-accent/40"
          >
            Privacy
          </a>
        </div>
      </div>
      <div
        className="pointer-events-none absolute inset-y-10 right-0 hidden w-1/2 bg-[url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22%3E%3Cpath d=%22M0 40L40 0H20L0 20zm40 0V20L20 40z%22 fill=%22%231f6feb%22 fill-opacity=%220.06%22/%3E%3C/svg%3E')] md:block"
        aria-hidden
      />
    </section>
  );
}
