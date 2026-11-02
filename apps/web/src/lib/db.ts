import { newId, nowMs } from "@aiwork/core";
import postgres from "postgres";

let sql: ReturnType<typeof postgres> | null = null;

export function getSql() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!sql) {
    sql = postgres(process.env.DATABASE_URL, { max: 10, ssl: "require" });
  }
  return sql;
}

export async function migrateCloud() {
  const db = getSql();
  await db`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT, name TEXT, github_id TEXT UNIQUE, created_at BIGINT NOT NULL)`;
  await db`CREATE TABLE IF NOT EXISTS organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL, stripe_customer_id TEXT, plan TEXT NOT NULL DEFAULT 'free', created_at BIGINT NOT NULL)`;
  await db`CREATE TABLE IF NOT EXISTS org_members (org_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', PRIMARY KEY (org_id, user_id))`;
  await db`CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL)`;
  await db`CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, org_id TEXT, owner_user_id TEXT, name TEXT NOT NULL, root_path TEXT, git_remote TEXT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)`;
  await db`CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', source TEXT NOT NULL DEFAULT 'auto', created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)`;
  await db`CREATE INDEX IF NOT EXISTS tasks_project_idx ON tasks(project_id)`.catch(() => undefined);
  await db`CREATE TABLE IF NOT EXISTS agent_runs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, project_id TEXT NOT NULL, agent TEXT NOT NULL, external_session_id TEXT NOT NULL, model TEXT, status TEXT NOT NULL DEFAULT 'running', started_at BIGINT NOT NULL, ended_at BIGINT, updated_at BIGINT NOT NULL)`;
  await db`CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT NOT NULL, agent_run_id TEXT NOT NULL, type TEXT NOT NULL, ts BIGINT NOT NULL, agent TEXT NOT NULL, generation_id TEXT, parent_event_id TEXT, dedupe_key TEXT, summary TEXT, payload_json TEXT NOT NULL, raw_payload TEXT, is_derived INTEGER NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL)`;
  await db`CREATE UNIQUE INDEX IF NOT EXISTS events_dedupe_cloud ON events(project_id, dedupe_key) WHERE dedupe_key IS NOT NULL`.catch(() => undefined);
  await db`CREATE TABLE IF NOT EXISTS checkpoints (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT NOT NULL, agent_run_id TEXT, git_commit TEXT NOT NULL, git_branch TEXT, dirty INTEGER NOT NULL DEFAULT 0, label TEXT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)`;
  await db`CREATE TABLE IF NOT EXISTS stripe_subscriptions (org_id TEXT PRIMARY KEY, stripe_subscription_id TEXT, status TEXT, price_id TEXT, updated_at BIGINT NOT NULL)`;
  await db`ALTER TABLE events ADD COLUMN IF NOT EXISTS search_tsv tsvector`.catch(() => undefined);
}

export { newId, nowMs };
