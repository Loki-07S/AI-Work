import { and, desc, eq, like, sql } from "drizzle-orm";
import type { AgentKind, NormalizedEvent } from "@aiwork/core";
import { newId, nowMs } from "@aiwork/core";
import type { SqliteDb } from "./sqlite.js";
import { agentRuns, checkpoints, events, projectMeta, projects, tasks } from "./schema.js";

export function getMeta(client: SqliteDb, key: string): string | null {
  const row = client.db.select().from(projectMeta).where(eq(projectMeta.key, key)).get();
  return row?.value ?? null;
}

export function setMeta(client: SqliteDb, key: string, value: string): void {
  client.sqlite
    .prepare(
      `INSERT INTO project_meta(key, value) VALUES(?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    )
    .run(key, value);
}

export function ensureProject(
  client: SqliteDb,
  projectRoot: string,
  name?: string
): { id: string; name: string; rootPath: string } {
  const existingId = getMeta(client, "project_id");
  if (existingId) {
    const row = client.db.select().from(projects).where(eq(projects.id, existingId)).get();
    if (row) {
      return { id: row.id, name: row.name, rootPath: row.rootPath };
    }
  }

  const id = newId();
  const ts = nowMs();
  const projectName = name ?? pathBasename(projectRoot);
  client.db.insert(projects).values({
    id,
    orgId: null,
    name: projectName,
    rootPath: projectRoot,
    gitRemote: null,
    createdAt: ts,
    updatedAt: ts,
  }).run();
  setMeta(client, "project_id", id);
  return { id, name: projectName, rootPath: projectRoot };
}

function pathBasename(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || "project";
}

export function getActiveTaskId(client: SqliteDb): string | null {
  return getMeta(client, "active_task_id");
}

export function setActiveTaskId(client: SqliteDb, taskId: string | null): void {
  if (taskId == null) {
    client.sqlite.prepare(`DELETE FROM project_meta WHERE key = ?`).run("active_task_id");
    return;
  }
  setMeta(client, "active_task_id", taskId);
}

export function createTask(
  client: SqliteDb,
  projectId: string,
  title: string,
  source: "manual" | "auto" = "manual"
): string {
  const id = newId();
  const ts = nowMs();
  client.db
    .insert(tasks)
    .values({
      id,
      projectId,
      title,
      status: "open",
      source,
      createdAt: ts,
      updatedAt: ts,
    })
    .run();
  client.sqlite
    .prepare(`INSERT INTO tasks_fts(task_id, title) VALUES(?, ?)`)
    .run(id, title);
  return id;
}

export function listTasks(client: SqliteDb, projectId: string) {
  return client.db
    .select()
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .orderBy(desc(tasks.updatedAt))
    .all();
}

export function getOrCreateRunForSession(
  client: SqliteDb,
  args: {
    projectId: string;
    agent: AgentKind;
    externalSessionId: string;
    model?: string | null;
    titleHint?: string;
  }
): { runId: string; taskId: string; created: boolean } {
  const existing = client.db
    .select()
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.projectId, args.projectId),
        eq(agentRuns.agent, args.agent),
        eq(agentRuns.externalSessionId, args.externalSessionId)
      )
    )
    .get();

  if (existing) {
    if (args.model && !existing.model) {
      client.db
        .update(agentRuns)
        .set({ model: args.model, updatedAt: nowMs() })
        .where(eq(agentRuns.id, existing.id))
        .run();
    }
    return { runId: existing.id, taskId: existing.taskId, created: false };
  }

  let taskId = getActiveTaskId(client);
  if (taskId) {
    const t = client.db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    if (!t) taskId = null;
  }

  if (!taskId) {
    const title =
      args.titleHint?.slice(0, 80) ||
      `${args.agent} session ${args.externalSessionId.slice(0, 8)}`;
    taskId = createTask(client, args.projectId, title, "auto");
    setActiveTaskId(client, taskId);
  }

  const runId = newId();
  const ts = nowMs();
  client.db
    .insert(agentRuns)
    .values({
      id: runId,
      taskId,
      projectId: args.projectId,
      agent: args.agent,
      externalSessionId: args.externalSessionId,
      model: args.model ?? null,
      status: "running",
      startedAt: ts,
      endedAt: null,
      updatedAt: ts,
    })
    .run();

  return { runId, taskId, created: true };
}

function extractSearchText(ev: NormalizedEvent): { payloadText: string; filePaths: string } {
  const p = ev.payload;
  const parts: string[] = [];
  const paths: string[] = [];
  if (typeof p.text === "string") parts.push(p.text);
  if (typeof p.command === "string") parts.push(p.command);
  if (typeof p.message === "string") parts.push(p.message);
  if (typeof p.path === "string") paths.push(p.path);
  if (typeof p.tool === "string") parts.push(p.tool);
  if (typeof p.outputTruncated === "string") parts.push(p.outputTruncated.slice(0, 2000));
  if (Array.isArray(p.attachmentPaths)) {
    for (const ap of p.attachmentPaths) if (typeof ap === "string") paths.push(ap);
  }
  return { payloadText: parts.join("\n"), filePaths: paths.join(" ") };
}

export function insertNormalizedEvents(
  client: SqliteDb,
  projectId: string,
  normalized: NormalizedEvent[]
): { inserted: number; skipped: number } {
  let inserted = 0;
  let skipped = 0;

  const insertStmt = client.sqlite.prepare(`
    INSERT INTO events (
      id, project_id, task_id, agent_run_id, type, ts, agent,
      generation_id, parent_event_id, dedupe_key, summary,
      payload_json, raw_payload, is_derived, updated_at
    ) VALUES (
      @id, @projectId, @taskId, @agentRunId, @type, @ts, @agent,
      @generationId, @parentEventId, @dedupeKey, @summary,
      @payloadJson, @rawPayload, @isDerived, @updatedAt
    )
  `);

  const ftsStmt = client.sqlite.prepare(`
    INSERT INTO events_fts(event_id, task_id, type, summary, payload_text, file_paths)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const tx = client.sqlite.transaction((items: NormalizedEvent[]) => {
    for (const ev of items) {
      const titleHint =
        ev.type === "USER_PROMPT" && typeof ev.payload.text === "string"
          ? String(ev.payload.text)
          : undefined;
      const { runId, taskId } = getOrCreateRunForSession(client, {
        projectId,
        agent: ev.agent,
        externalSessionId: ev.externalSessionId,
        model: ev.model,
        titleHint,
      });

      if (ev.type === "TASK_COMPLETED" || (ev.type === "ERROR" && ev.payload.failureType === "stop_error")) {
        const status =
          ev.type === "TASK_COMPLETED"
            ? "completed"
            : String((ev.payload as { status?: string }).status ?? "error");
        client.db
          .update(agentRuns)
          .set({
            status: status === "completed" ? "completed" : status === "aborted" ? "aborted" : "error",
            endedAt: ev.ts,
            updatedAt: nowMs(),
          })
          .where(eq(agentRuns.id, runId))
          .run();
      }

      const id = newId();
      const dedupeKey = ev.dedupeKey ?? null;
      try {
        insertStmt.run({
          id,
          projectId,
          taskId,
          agentRunId: runId,
          type: ev.type,
          ts: ev.ts,
          agent: ev.agent,
          generationId: ev.generationId ?? null,
          parentEventId: ev.parentEventId ?? null,
          dedupeKey,
          summary: ev.summary,
          payloadJson: JSON.stringify(ev.payload),
          rawPayload: ev.rawPayload != null ? JSON.stringify(ev.rawPayload) : null,
          isDerived: ev.isDerived ? 1 : 0,
          updatedAt: nowMs(),
        });
        const search = extractSearchText(ev);
        ftsStmt.run(id, taskId, ev.type, ev.summary, search.payloadText, search.filePaths);
        client.db
          .update(tasks)
          .set({ updatedAt: nowMs() })
          .where(eq(tasks.id, taskId))
          .run();
        inserted++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("UNIQUE") || msg.includes("unique")) {
          skipped++;
        } else {
          throw err;
        }
      }
    }
  });

  tx(normalized);
  return { inserted, skipped };
}

export function listEventsForTask(client: SqliteDb, taskId: string, limit = 500) {
  return client.db
    .select()
    .from(events)
    .where(eq(events.taskId, taskId))
    .orderBy(events.ts)
    .limit(limit)
    .all();
}

export function listRecentEvents(client: SqliteDb, projectId: string, limit = 50) {
  return client.db
    .select()
    .from(events)
    .where(eq(events.projectId, projectId))
    .orderBy(desc(events.ts))
    .limit(limit)
    .all();
}

export function fileChangesForTask(client: SqliteDb, taskId: string) {
  return client.db
    .select()
    .from(events)
    .where(and(eq(events.taskId, taskId), eq(events.type, "FILE_EDIT")))
    .orderBy(events.ts)
    .all();
}

export function searchLocal(client: SqliteDb, query: string, limit = 40) {
  const q = query.trim();
  if (!q) return [];

  // Prefer FTS; fall back to LIKE
  try {
    const rows = client.sqlite
      .prepare(
        `SELECT event_id, task_id, type, summary, payload_text, file_paths,
                snippet(events_fts, 3, '[', ']', '…', 12) AS snip
         FROM events_fts
         WHERE events_fts MATCH ?
         LIMIT ?`
      )
      .all(sanitizeFts(q), limit) as Array<{
      event_id: string;
      task_id: string;
      type: string;
      summary: string;
      payload_text: string;
      file_paths: string;
      snip: string;
    }>;
    return rows.map((r) => ({
      eventId: r.event_id,
      taskId: r.task_id,
      type: r.type,
      summary: r.summary,
      snippet: r.snip || r.summary,
      filePaths: r.file_paths,
    }));
  } catch {
    const likeQ = `%${q}%`;
    const rows = client.db
      .select()
      .from(events)
      .where(like(events.summary, likeQ))
      .orderBy(desc(events.ts))
      .limit(limit)
      .all();
    return rows.map((r) => ({
      eventId: r.id,
      taskId: r.taskId,
      type: r.type,
      summary: r.summary ?? "",
      snippet: r.summary ?? "",
      filePaths: "",
    }));
  }
}

function sanitizeFts(q: string): string {
  // Quote tokens for FTS5 prefix safety
  return q
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, "")}"*`)
    .join(" ");
}

export function createCheckpoint(
  client: SqliteDb,
  args: {
    projectId: string;
    taskId: string;
    agentRunId?: string | null;
    gitCommit: string;
    gitBranch?: string | null;
    dirty: boolean;
    label?: string | null;
  }
): string {
  const id = newId();
  const ts = nowMs();
  client.db
    .insert(checkpoints)
    .values({
      id,
      projectId: args.projectId,
      taskId: args.taskId,
      agentRunId: args.agentRunId ?? null,
      gitCommit: args.gitCommit,
      gitBranch: args.gitBranch ?? null,
      dirty: args.dirty ? 1 : 0,
      label: args.label ?? null,
      createdAt: ts,
      updatedAt: ts,
    })
    .run();
  return id;
}

export function listCheckpoints(client: SqliteDb, taskId: string) {
  return client.db
    .select()
    .from(checkpoints)
    .where(eq(checkpoints.taskId, taskId))
    .orderBy(desc(checkpoints.createdAt))
    .all();
}

export function getCheckpoint(client: SqliteDb, id: string) {
  return client.db.select().from(checkpoints).where(eq(checkpoints.id, id)).get();
}

export function insertDecisionEvent(
  client: SqliteDb,
  args: {
    projectId: string;
    taskId: string;
    agentRunId: string;
    agent: AgentKind;
    text: string;
    sourceEventIds: string[];
    confidence?: number | null;
  }
): string {
  const id = newId();
  const ts = nowMs();
  const summary = args.text.slice(0, 120);
  const payload = {
    text: args.text,
    confidence: args.confidence ?? null,
    sourceEventIds: args.sourceEventIds,
  };
  client.sqlite
    .prepare(
      `INSERT INTO events (
        id, project_id, task_id, agent_run_id, type, ts, agent,
        generation_id, parent_event_id, dedupe_key, summary,
        payload_json, raw_payload, is_derived, updated_at
      ) VALUES (?, ?, ?, ?, 'DECISION', ?, ?, NULL, NULL, ?, ?, ?, NULL, 1, ?)`
    )
    .run(
      id,
      args.projectId,
      args.taskId,
      args.agentRunId,
      ts,
      args.agent,
      `decision-${id}`,
      summary,
      JSON.stringify(payload),
      ts
    );
  client.sqlite
    .prepare(
      `INSERT INTO events_fts(event_id, task_id, type, summary, payload_text, file_paths)
       VALUES (?, ?, 'DECISION', ?, ?, '')`
    )
    .run(id, args.taskId, summary, args.text);
  return id;
}

export function countEvents(client: SqliteDb, projectId: string): number {
  const row = client.sqlite
    .prepare(`SELECT COUNT(*) as c FROM events WHERE project_id = ?`)
    .get(projectId) as { c: number };
  return row.c;
}
