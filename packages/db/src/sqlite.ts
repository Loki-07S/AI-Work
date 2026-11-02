import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema.js";

export type SqliteClient = {
  db: ReturnType<typeof drizzle<typeof schema>>;
  sqlite: Database.Database;
  dbFile: string;
};

export type SqliteDb = SqliteClient;

export function ensureAiworkDir(projectRoot: string): string {
  const dir = path.join(projectRoot, ".aiwork");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function dbPathForProject(projectRoot: string): string {
  return path.join(ensureAiworkDir(projectRoot), "aiwork.db");
}

export function openSqlite(projectRoot: string): SqliteClient {
  const dbFile = dbPathForProject(projectRoot);
  const sqlite = new Database(dbFile);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  migrate(sqlite);
  const db = drizzle(sqlite, { schema });
  return { db, sqlite, dbFile };
}

export function migrate(sqlite: Database.Database): void {
  sqlite.exec(`
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  stripe_customer_id TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  git_remote TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  source TEXT NOT NULL DEFAULT 'auto',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_project_idx ON tasks(project_id);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  agent TEXT NOT NULL,
  external_session_id TEXT NOT NULL,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_session_uniq
  ON agent_runs(project_id, agent, external_session_id);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  agent_run_id TEXT NOT NULL,
  type TEXT NOT NULL,
  ts INTEGER NOT NULL,
  agent TEXT NOT NULL,
  generation_id TEXT,
  parent_event_id TEXT,
  dedupe_key TEXT,
  summary TEXT,
  payload_json TEXT NOT NULL,
  raw_payload TEXT,
  is_derived INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_project_ts_idx ON events(project_id, ts);
CREATE INDEX IF NOT EXISTS events_task_ts_idx ON events(task_id, ts);
CREATE UNIQUE INDEX IF NOT EXISTS events_dedupe_uniq ON events(project_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  agent_run_id TEXT,
  git_commit TEXT NOT NULL,
  git_branch TEXT,
  dirty INTEGER NOT NULL DEFAULT 0,
  label TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS checkpoints_task_idx ON checkpoints(task_id);

CREATE TABLE IF NOT EXISTS project_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
  project_id TEXT PRIMARY KEY,
  remote_project_id TEXT,
  last_push_at INTEGER,
  last_pull_at INTEGER,
  cursor TEXT
);
`);

  // FTS tables — create if missing
  const ftsExists = sqlite
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='events_fts'`
    )
    .get();
  if (!ftsExists) {
    sqlite.exec(`
CREATE VIRTUAL TABLE events_fts USING fts5(
  event_id UNINDEXED,
  task_id UNINDEXED,
  type UNINDEXED,
  summary,
  payload_text,
  file_paths,
  tokenize = 'porter'
);
CREATE VIRTUAL TABLE tasks_fts USING fts5(
  task_id UNINDEXED,
  title,
  tokenize = 'porter'
);
`);
  }
}
