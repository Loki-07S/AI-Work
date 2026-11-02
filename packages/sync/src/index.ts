import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SqliteDb } from "@aiwork/db";

export type GlobalConfig = {
  apiBaseUrl?: string;
  accessToken?: string;
  refreshToken?: string;
  userId?: string;
  email?: string;
  orgId?: string;
};

export function configPath(): string {
  if (process.env.AIWORK_CONFIG_PATH) return process.env.AIWORK_CONFIG_PATH;
  return path.join(os.homedir(), ".aiwork", "config.json");
}

export function loadConfig(): GlobalConfig {
  const p = configPath();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as GlobalConfig;
  } catch {
    return {};
  }
}

export function saveConfig(cfg: GlobalConfig): void {
  const dir = path.dirname(configPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2) + "\n");
}

export type SyncPushPayload = {
  project: {
    id: string;
    name: string;
    rootPath: string;
  };
  tasks: unknown[];
  agentRuns: unknown[];
  events: unknown[];
  checkpoints: unknown[];
  since: number | null;
};

export async function pushToCloud(
  apiBaseUrl: string,
  token: string,
  payload: SyncPushPayload
): Promise<{ ok: boolean; accepted: number; error?: string }> {
  const res: any = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/api/sync/push`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    return { ok: false, accepted: 0, error: `${res.status} ${await res.text()}` };
  }
  const body = (await res.json()) as { accepted: number };
  return { ok: true, accepted: body.accepted ?? 0 };
}

export async function pullFromCloud(
  apiBaseUrl: string,
  token: string,
  remoteProjectId: string,
  since: number | null
): Promise<{
  ok: boolean;
  tasks: unknown[];
  agentRuns: unknown[];
  events: unknown[];
  checkpoints: unknown[];
  error?: string;
}> {
  const url = new URL(`${apiBaseUrl.replace(/\/$/, "")}/api/sync/pull`);
  url.searchParams.set("projectId", remoteProjectId);
  if (since != null) url.searchParams.set("since", String(since));
  const res: any = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    return {
      ok: false,
      tasks: [],
      agentRuns: [],
      events: [],
      checkpoints: [],
      error: `${res.status} ${await res.text()}`,
    };
  }
  const body = (await res.json()) as {
    tasks: unknown[];
    agentRuns: unknown[];
    events: unknown[];
    checkpoints: unknown[];
  };
  return { ok: true, ...body };
}

export function buildPushPayload(client: SqliteDb, projectId: string, since: number | null): SyncPushPayload {
  const project = client.sqlite
    .prepare(`SELECT id, name, root_path as rootPath FROM projects WHERE id = ?`)
    .get(projectId) as { id: string; name: string; rootPath: string };

  const sinceClause = since != null ? ` AND updated_at > ?` : "";
  const params = since != null ? [projectId, since] : [projectId];

  const tasks = client.sqlite
    .prepare(`SELECT * FROM tasks WHERE project_id = ?${sinceClause}`)
    .all(...params);
  const agentRuns = client.sqlite
    .prepare(`SELECT * FROM agent_runs WHERE project_id = ?${since != null ? " AND updated_at > ?" : ""}`)
    .all(...params);
  const events = client.sqlite
    .prepare(`SELECT * FROM events WHERE project_id = ?${since != null ? " AND updated_at > ?" : ""}`)
    .all(...params);
  const checkpoints = client.sqlite
    .prepare(`SELECT * FROM checkpoints WHERE project_id = ?${since != null ? " AND updated_at > ?" : ""}`)
    .all(...params);

  return { project, tasks, agentRuns, events, checkpoints, since };
}

export function applyPull(
  client: SqliteDb,
  data: {
    tasks: Array<Record<string, unknown>>;
    agentRuns: Array<Record<string, unknown>>;
    events: Array<Record<string, unknown>>;
    checkpoints: Array<Record<string, unknown>>;
  }
): number {
  let n = 0;
  const upsert = (table: string, row: Record<string, unknown>, cols: string[]) => {
    const placeholders = cols.map(() => "?").join(",");
    const updates = cols
      .filter((c) => c !== "id")
      .map((c) => `${c}=excluded.${c}`)
      .join(",");
    client.sqlite
      .prepare(
        `INSERT INTO ${table} (${cols.join(",")}) VALUES (${placeholders})
         ON CONFLICT(id) DO UPDATE SET ${updates}`
      )
      .run(...cols.map((c) => row[c] ?? null));
    n++;
  };

  for (const t of data.tasks) {
    upsert("tasks", snakeToRow(t), [
      "id",
      "project_id",
      "title",
      "status",
      "source",
      "created_at",
      "updated_at",
    ]);
  }
  for (const r of data.agentRuns) {
    upsert("agent_runs", snakeToRow(r), [
      "id",
      "task_id",
      "project_id",
      "agent",
      "external_session_id",
      "model",
      "status",
      "started_at",
      "ended_at",
      "updated_at",
    ]);
  }
  for (const e of data.events) {
    upsert("events", snakeToRow(e), [
      "id",
      "project_id",
      "task_id",
      "agent_run_id",
      "type",
      "ts",
      "agent",
      "generation_id",
      "parent_event_id",
      "dedupe_key",
      "summary",
      "payload_json",
      "raw_payload",
      "is_derived",
      "updated_at",
    ]);
  }
  for (const c of data.checkpoints) {
    upsert("checkpoints", snakeToRow(c), [
      "id",
      "project_id",
      "task_id",
      "agent_run_id",
      "git_commit",
      "git_branch",
      "dirty",
      "label",
      "created_at",
      "updated_at",
    ]);
  }
  return n;
}

function snakeToRow(row: Record<string, unknown>): Record<string, unknown> {
  // Accept either snake_case (from sqlite) or already flat
  return row;
}
