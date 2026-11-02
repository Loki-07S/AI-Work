import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AIWork",
  description: "Task-centric workspace for AI coding agent activity",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@500;700&family=Source+Sans+3:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-paper text-ink font-body antialiased">
        <header className="border-b border-mist bg-white/70 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
            <a href="/" className="font-display text-xl font-bold tracking-tight text-ink">
              AIWork
            </a>
            <nav className="flex gap-4 text-sm font-semibold text-ink/70">
              <a href="/login" className="hover:text-accent">
                Login
              </a>
              <a href="/dashboard" className="hover:text-accent">
                Dashboard
              </a>
              <a href="/privacy" className="hover:text-accent">
                Privacy
              </a>
              <a href="/billing" className="hover:text-accent">
                Billing
              </a>
            </nav>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
