import {
  createCheckpoint,
  ensureProject,
  getActiveTaskId,
  getCheckpoint,
  listCheckpoints,
  listEventsForTask,
  listRecentEvents,
  listTasks,
  openSqlite,
  searchLocal,
  setActiveTaskId,
  createTask,
  countEvents,
  fileChangesForTask,
  insertDecisionEvent,
} from "@aiwork/db";
import { newId } from "@aiwork/core";
import {
  gitBranch,
  gitHead,
  gitIsDirty,
  gitRestoreToCommit,
  isGitRepo,
} from "./git.js";

export function withDb<T>(projectRoot: string, fn: (client: ReturnType<typeof openSqlite>, projectId: string) => T): T {
  const client = openSqlite(projectRoot);
  try {
    const project = ensureProject(client, projectRoot);
    return fn(client, project.id);
  } finally {
    client.sqlite.close();
  }
}

export function statusCmd(projectRoot: string): void {
  withDb(projectRoot, (client, projectId) => {
    const project = ensureProject(client, projectRoot);
    const tasks = listTasks(client, projectId);
    const active = getActiveTaskId(client);
    const n = countEvents(client, projectId);
    console.log(`Project: ${project.name} (${projectId})`);
    console.log(`DB: ${client.dbFile}`);
    console.log(`Events: ${n}`);
    console.log(`Tasks: ${tasks.length}`);
    console.log(`Active task: ${active ?? "(none)"}`);
    for (const t of tasks.slice(0, 10)) {
      const mark = t.id === active ? "*" : " ";
      console.log(` ${mark} [${t.status}] ${t.title} (${t.id.slice(0, 10)})`);
    }
  });
}

export function tailCmd(projectRoot: string, limit = 30): void {
  withDb(projectRoot, (client, projectId) => {
    const rows = listRecentEvents(client, projectId, limit);
    for (const r of rows.reverse()) {
      const t = new Date(r.ts).toISOString().slice(11, 19);
      console.log(`${t} ${r.agent.padEnd(11)} ${r.type.padEnd(16)} ${r.summary ?? ""}`);
    }
  });
}

export function tasksCmd(projectRoot: string): void {
  withDb(projectRoot, (client, projectId) => {
    const active = getActiveTaskId(client);
    for (const t of listTasks(client, projectId)) {
      const mark = t.id === active ? "*" : " ";
      console.log(`${mark} ${t.id}  ${t.status.padEnd(10)} ${t.title}`);
    }
  });
}

export function taskCreateCmd(projectRoot: string, title: string): void {
  withDb(projectRoot, (client, projectId) => {
    const id = createTask(client, projectId, title, "manual");
    setActiveTaskId(client, id);
    console.log(`Created and pinned task ${id}: ${title}`);
  });
}

export function taskPinCmd(projectRoot: string, taskId: string): void {
  withDb(projectRoot, (client) => {
    setActiveTaskId(client, taskId);
    console.log(`Active task set to ${taskId}`);
  });
}

export function timelineCmd(projectRoot: string, taskId?: string): void {
  withDb(projectRoot, (client, projectId) => {
    const id = taskId ?? getActiveTaskId(client);
    if (!id) {
      console.error("No active task. Pass a task id or pin one.");
      process.exitCode = 1;
      return;
    }
    for (const r of listEventsForTask(client, id)) {
      const t = new Date(r.ts).toISOString().slice(11, 19);
      console.log(`${t} ${r.agent.padEnd(11)} ${r.type.padEnd(16)} ${r.summary ?? ""}`);
    }
  });
}

export function filesCmd(projectRoot: string, taskId?: string): void {
  withDb(projectRoot, (client) => {
    const id = taskId ?? getActiveTaskId(client);
    if (!id) {
      console.error("No active task.");
      process.exitCode = 1;
      return;
    }
    const seen = new Map<string, number>();
    for (const r of fileChangesForTask(client, id)) {
      try {
        const p = JSON.parse(r.payloadJson) as { path?: string };
        if (p.path) seen.set(p.path, (seen.get(p.path) ?? 0) + 1);
      } catch {
        /* ignore */
      }
    }
    for (const [path, count] of seen) {
      console.log(`${String(count).padStart(3)}  ${path}`);
    }
  });
}

export function searchCmd(projectRoot: string, query: string): void {
  withDb(projectRoot, (client) => {
    const results = searchLocal(client, query);
    if (results.length === 0) {
      console.log("No matches.");
      return;
    }
    for (const r of results) {
      console.log(`${r.type.padEnd(16)} task=${r.taskId.slice(0, 10)}  ${r.snippet}`);
      if (r.filePaths) console.log(`                 files: ${r.filePaths}`);
    }
  });
}

export function checkpointCmd(projectRoot: string, label?: string): void {
  withDb(projectRoot, (client, projectId) => {
    if (!isGitRepo(projectRoot)) {
      console.error("Not a git repository.");
      process.exitCode = 1;
      return;
    }
    const taskId = getActiveTaskId(client);
    if (!taskId) {
      console.error("No active task to attach checkpoint to.");
      process.exitCode = 1;
      return;
    }
    const commit = gitHead(projectRoot);
    const branch = gitBranch(projectRoot);
    const dirty = gitIsDirty(projectRoot);
    const id = createCheckpoint(client, {
      projectId,
      taskId,
      gitCommit: commit,
      gitBranch: branch,
      dirty,
      label: label ?? null,
    });
    console.log(`Checkpoint ${id}`);
    console.log(`  commit: ${commit}`);
    console.log(`  branch: ${branch}`);
    console.log(`  dirty:  ${dirty}`);
  });
}

export function checkpointsListCmd(projectRoot: string, taskId?: string): void {
  withDb(projectRoot, (client) => {
    const id = taskId ?? getActiveTaskId(client);
    if (!id) {
      console.error("No active task.");
      process.exitCode = 1;
      return;
    }
    for (const c of listCheckpoints(client, id)) {
      console.log(
        `${c.id.slice(0, 10)}  ${c.gitCommit.slice(0, 10)}  dirty=${c.dirty}  ${c.label ?? ""}`
      );
    }
  });
}

export function restoreCmd(
  projectRoot: string,
  checkpointId: string,
  opts: { force?: boolean } = {}
): void {
  withDb(projectRoot, (client) => {
    const cp = getCheckpoint(client, checkpointId);
    if (!cp) {
      console.error("Checkpoint not found.");
      process.exitCode = 1;
      return;
    }
    const result = gitRestoreToCommit(projectRoot, cp.gitCommit, { force: opts.force });
    if (!result.ok) {
      console.error(result.reason);
      process.exitCode = 1;
      return;
    }
    console.log(`Restored to ${cp.gitCommit}`);
    if (result.backupRef) console.log(`Backup ref: ${result.backupRef}`);
    if (result.stashed) console.log("Previous dirty state stashed.");
  });
}

export async function decideCmd(projectRoot: string, taskId?: string): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Set ANTHROPIC_API_KEY to generate decisions.");
    process.exitCode = 1;
    return;
  }

  await withDb(projectRoot, async (client, projectId) => {
    const id = taskId ?? getActiveTaskId(client);
    if (!id) {
      console.error("No active task.");
      process.exitCode = 1;
      return;
    }
    const evs = listEventsForTask(client, id, 200);
    const compact = evs
      .filter((e) => e.type !== "DECISION")
      .map((e) => ({
        id: e.id,
        type: e.type,
        summary: e.summary,
        agent: e.agent,
        ts: e.ts,
      }));

    const prompt = `You extract factual DECISIONS from an AI coding agent session timeline.
Return ONLY valid JSON: { "decisions": [ { "text": string, "confidence": number, "source_event_ids": string[] } ] }
Rules:
- Every decision MUST cite one or more source_event_ids from the list.
- Do not invent decisions not supported by cited events.
- Prefer concrete technical choices (library, approach, file, API) over vague summary.
- If nothing clear, return { "decisions": [] }.

Events:
${JSON.stringify(compact, null, 2)}`;

    const res: any = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error(`Claude API error: ${res.status} ${await res.text()}`);
      process.exitCode = 1;
      return;
    }

    const body = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
    };
    const text = body.content.find((c) => c.type === "text")?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("Could not parse decisions JSON:", text.slice(0, 500));
      process.exitCode = 1;
      return;
    }
    const parsed = JSON.parse(jsonMatch[0]) as {
      decisions: Array<{ text: string; confidence?: number; source_event_ids: string[] }>;
    };

    const validIds = new Set(evs.map((e) => e.id));
    const runId = evs[0]?.agentRunId ?? newId();
    const agent = (evs[0]?.agent ?? "cursor") as "cursor" | "claude_code";

    let n = 0;
    for (const d of parsed.decisions ?? []) {
      const sources = (d.source_event_ids ?? []).filter((sid) => validIds.has(sid));
      if (sources.length === 0) {
        console.warn(`Skipping uncited decision: ${d.text}`);
        continue;
      }
      insertDecisionEvent(client, {
        projectId,
        taskId: id,
        agentRunId: runId,
        agent,
        text: d.text,
        sourceEventIds: sources,
        confidence: d.confidence ?? null,
      });
      console.log(`DECISION: ${d.text}`);
      console.log(`  sources: ${sources.join(", ")}`);
      n++;
    }
    console.log(`Stored ${n} decision(s).`);
  });
}
