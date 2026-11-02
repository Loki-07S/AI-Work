import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  plan: text("plan").notNull().default("free"),
  createdAt: integer("created_at").notNull(),
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  orgId: text("org_id"),
  name: text("name").notNull(),
  rootPath: text("root_path").notNull(),
  gitRemote: text("git_remote"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("open"),
    source: text("source").notNull().default("auto"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    projectIdx: index("tasks_project_idx").on(t.projectId),
  })
);

export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    projectId: text("project_id").notNull(),
    agent: text("agent").notNull(),
    externalSessionId: text("external_session_id").notNull(),
    model: text("model"),
    status: text("status").notNull().default("running"),
    startedAt: integer("started_at").notNull(),
    endedAt: integer("ended_at"),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    uniqSession: uniqueIndex("agent_runs_session_uniq").on(
      t.projectId,
      t.agent,
      t.externalSessionId
    ),
  })
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    taskId: text("task_id").notNull(),
    agentRunId: text("agent_run_id").notNull(),
    type: text("type").notNull(),
    ts: integer("ts").notNull(),
    agent: text("agent").notNull(),
    generationId: text("generation_id"),
    parentEventId: text("parent_event_id"),
    dedupeKey: text("dedupe_key"),
    summary: text("summary"),
    payloadJson: text("payload_json").notNull(),
    rawPayload: text("raw_payload"),
    isDerived: integer("is_derived").notNull().default(0),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    projectTsIdx: index("events_project_ts_idx").on(t.projectId, t.ts),
    taskTsIdx: index("events_task_ts_idx").on(t.taskId, t.ts),
    dedupeUniq: uniqueIndex("events_dedupe_uniq").on(t.projectId, t.dedupeKey),
  })
);

export const checkpoints = sqliteTable(
  "checkpoints",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    taskId: text("task_id").notNull(),
    agentRunId: text("agent_run_id"),
    gitCommit: text("git_commit").notNull(),
    gitBranch: text("git_branch"),
    dirty: integer("dirty").notNull().default(0),
    label: text("label"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    taskIdx: index("checkpoints_task_idx").on(t.taskId),
  })
);

export const projectMeta = sqliteTable("project_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const syncState = sqliteTable("sync_state", {
  projectId: text("project_id").primaryKey(),
  remoteProjectId: text("remote_project_id"),
  lastPushAt: integer("last_push_at"),
  lastPullAt: integer("last_pull_at"),
  cursor: text("cursor"),
});

export const SCHEMA_SQL = sql`
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
CREATE UNIQUE INDEX IF NOT EXISTS events_dedupe_uniq ON events(project_id, dedupe_key);

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

CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
  event_id UNINDEXED,
  task_id UNINDEXED,
  type UNINDEXED,
  summary,
  payload_text,
  file_paths,
  tokenize = 'porter'
);

CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
  task_id UNINDEXED,
  title,
  tokenize = 'porter'
);
`;
