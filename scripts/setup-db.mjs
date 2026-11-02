#!/usr/bin/env node
/**
 * AIWork — Cloud DB Setup Script
 * Runs all Postgres migrations once.
 *
 * Usage (run from the aiwork root):
 *   node scripts/setup-db.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

// ── Load .env.local ──────────────────────────────────────────────────────────
const envPath = resolve(rootDir, "apps/web/.env.local");
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key && val && !process.env[key]) process.env[key] = val;
  }
  console.log("✓ Loaded apps/web/.env.local");
} else {
  console.error("❌ apps/web/.env.local not found. Create it first.");
  process.exit(1);
}

// ── Validate DATABASE_URL ────────────────────────────────────────────────────
const url = process.env.DATABASE_URL;
if (!url || url.includes("[YOUR-PASSWORD]") || url.includes("YOUR_PASSWORD")) {
  console.error(`
❌ DATABASE_URL still has a placeholder password.
   Open apps/web/.env.local and replace [YOUR-PASSWORD] with your real password.
`);
  process.exit(1);
}
console.log(`✓ DATABASE_URL found (host: ${new URL(url).hostname})`);

// ── Import postgres from apps/web node_modules ────────────────────────────────
// postgres is installed in apps/web, not root — resolve from there
const require = createRequire(resolve(rootDir, "apps/web/package.json"));
const postgresPath = require.resolve("postgres");
const { default: postgres } = await import(pathToFileURL(postgresPath).href);

// ── Connect ──────────────────────────────────────────────────────────────────
console.log("⏳ Connecting to Supabase Postgres...");
const sql = postgres(url, {
  max: 1,
  ssl: "require",
  connect_timeout: 20,
});

try {
  const [row] = await sql`SELECT version() as v`;
  console.log(`✓ Connected — ${row.v.split(" ").slice(0, 2).join(" ")}\n`);
} catch (err) {
  console.error("❌ Connection failed:", err.message);
  console.error("\nCommon causes:");
  console.error("  • Wrong password in .env.local");
  console.error("  • Supabase project paused (check dashboard)");
  await sql.end();
  process.exit(1);
}

// ── Migrations ───────────────────────────────────────────────────────────────
const steps = [
  ["users", () => sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      name TEXT,
      github_id TEXT UNIQUE,
      created_at BIGINT NOT NULL
    )`],
  ["organizations", () => sql`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      stripe_customer_id TEXT,
      plan TEXT NOT NULL DEFAULT 'free',
      created_at BIGINT NOT NULL
    )`],
  ["org_members", () => sql`
    CREATE TABLE IF NOT EXISTS org_members (
      org_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      PRIMARY KEY (org_id, user_id)
    )`],
  ["sessions", () => sql`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL
    )`],
  ["projects", () => sql`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      org_id TEXT,
      owner_user_id TEXT,
      name TEXT NOT NULL,
      root_path TEXT,
      git_remote TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )`],
  ["tasks", () => sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      source TEXT NOT NULL DEFAULT 'auto',
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )`],
  ["tasks_project_idx", () => sql`
    CREATE INDEX IF NOT EXISTS tasks_project_idx ON tasks(project_id)`],
  ["agent_runs", () => sql`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      agent TEXT NOT NULL,
      external_session_id TEXT NOT NULL,
      model TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      started_at BIGINT NOT NULL,
      ended_at BIGINT,
      updated_at BIGINT NOT NULL
    )`],
  ["events", () => sql`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      agent_run_id TEXT NOT NULL,
      type TEXT NOT NULL,
      ts BIGINT NOT NULL,
      agent TEXT NOT NULL,
      generation_id TEXT,
      parent_event_id TEXT,
      dedupe_key TEXT,
      summary TEXT,
      payload_json TEXT NOT NULL,
      raw_payload TEXT,
      is_derived INTEGER NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL
    )`],
  ["events_dedupe_idx", () => sql`
    CREATE UNIQUE INDEX IF NOT EXISTS events_dedupe_cloud
      ON events(project_id, dedupe_key)
      WHERE dedupe_key IS NOT NULL`],
  ["events_search_tsv (col)", () => sql`
    ALTER TABLE events ADD COLUMN IF NOT EXISTS search_tsv tsvector`],
  ["events_tsv_idx", () => sql`
    CREATE INDEX IF NOT EXISTS events_tsv_idx ON events USING GIN(search_tsv)`],
  ["checkpoints", () => sql`
    CREATE TABLE IF NOT EXISTS checkpoints (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      agent_run_id TEXT,
      git_commit TEXT NOT NULL,
      git_branch TEXT,
      dirty INTEGER NOT NULL DEFAULT 0,
      label TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )`],
  ["stripe_subscriptions", () => sql`
    CREATE TABLE IF NOT EXISTS stripe_subscriptions (
      org_id TEXT PRIMARY KEY,
      stripe_subscription_id TEXT,
      status TEXT,
      price_id TEXT,
      updated_at BIGINT NOT NULL
    )`],
];

let failed = false;
for (const [name, fn] of steps) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ❌ ${name}: ${err.message}`);
    failed = true;
    break;
  }
}

await sql.end();

if (failed) {
  console.error("\n❌ Migration failed. Fix the error above and re-run.");
  process.exit(1);
}

console.log(`
✅ All migrations complete! Supabase is ready.

Next steps:
  1. Generate a JWT_SECRET (if you haven't):
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     → Paste into apps/web/.env.local  (JWT_SECRET=...)

  2. Start the web app:
     pnpm --filter @aiwork/web dev

  3. Open http://localhost:3000/login → register an account

  4. Sync from your project:
     node "C:\\Users\\Lokesh\\AI work\\aiwork\\apps\\cli\\dist\\bin.js" login --token <token> --api http://localhost:3000
     node "C:\\Users\\Lokesh\\AI work\\aiwork\\apps\\cli\\dist\\bin.js" sync
`);
