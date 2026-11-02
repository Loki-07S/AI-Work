import { NextRequest, NextResponse } from "next/server";
import { userFromAuthHeader } from "@/lib/auth";
import { getSql, migrateCloud, nowMs } from "@/lib/db";

type Row = Record<string, unknown>;

export async function POST(req: NextRequest) {
  try {
    await migrateCloud();
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 503 });
  }

  const user = await userFromAuthHeader(req.headers.get("authorization"));
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json()) as {
    project: { id: string; name: string; rootPath: string };
    tasks: Row[];
    agentRuns: Row[];
    events: Row[];
    checkpoints: Row[];
  };

  const db = getSql();
  const ts = nowMs();

  await db`
    INSERT INTO projects (id, owner_user_id, name, root_path, created_at, updated_at)
    VALUES (${body.project.id}, ${user.id}, ${body.project.name}, ${body.project.rootPath}, ${ts}, ${ts})
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      root_path = EXCLUDED.root_path,
      updated_at = EXCLUDED.updated_at
  `;

  let accepted = 0;

  for (const t of body.tasks ?? []) {
    await db`
      INSERT INTO tasks (id, project_id, title, status, source, created_at, updated_at)
      VALUES (
        ${String(t.id)}, ${String(t.project_id)}, ${String(t.title)},
        ${String(t.status ?? "open")}, ${String(t.source ?? "auto")},
        ${Number(t.created_at)}, ${Number(t.updated_at)}
      )
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at
    `;
    accepted++;
  }

  for (const r of body.agentRuns ?? []) {
    await db`
      INSERT INTO agent_runs (
        id, task_id, project_id, agent, external_session_id, model, status,
        started_at, ended_at, updated_at
      ) VALUES (
        ${String(r.id)}, ${String(r.task_id)}, ${String(r.project_id)}, ${String(r.agent)},
        ${String(r.external_session_id)}, ${r.model ? String(r.model) : null},
        ${String(r.status ?? "running")}, ${Number(r.started_at)},
        ${r.ended_at != null ? Number(r.ended_at) : null}, ${Number(r.updated_at)}
      )
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        ended_at = EXCLUDED.ended_at,
        model = EXCLUDED.model,
        updated_at = EXCLUDED.updated_at
    `;
    accepted++;
  }

  for (const e of body.events ?? []) {
    await db`
      INSERT INTO events (
        id, project_id, task_id, agent_run_id, type, ts, agent,
        generation_id, parent_event_id, dedupe_key, summary,
        payload_json, raw_payload, is_derived, updated_at
      ) VALUES (
        ${String(e.id)}, ${String(e.project_id)}, ${String(e.task_id)}, ${String(e.agent_run_id)},
        ${String(e.type)}, ${Number(e.ts)}, ${String(e.agent)},
        ${e.generation_id ? String(e.generation_id) : null},
        ${e.parent_event_id ? String(e.parent_event_id) : null},
        ${e.dedupe_key ? String(e.dedupe_key) : null},
        ${e.summary ? String(e.summary) : null},
        ${String(e.payload_json)},
        ${e.raw_payload ? String(e.raw_payload) : null},
        ${Number(e.is_derived ?? 0)},
        ${Number(e.updated_at)}
      )
      ON CONFLICT (id) DO UPDATE SET
        summary = EXCLUDED.summary,
        payload_json = EXCLUDED.payload_json,
        updated_at = EXCLUDED.updated_at
    `;
    accepted++;
  }

  for (const c of body.checkpoints ?? []) {
    await db`
      INSERT INTO checkpoints (
        id, project_id, task_id, agent_run_id, git_commit, git_branch,
        dirty, label, created_at, updated_at
      ) VALUES (
        ${String(c.id)}, ${String(c.project_id)}, ${String(c.task_id)},
        ${c.agent_run_id ? String(c.agent_run_id) : null},
        ${String(c.git_commit)}, ${c.git_branch ? String(c.git_branch) : null},
        ${Number(c.dirty ?? 0)}, ${c.label ? String(c.label) : null},
        ${Number(c.created_at)}, ${Number(c.updated_at)}
      )
      ON CONFLICT (id) DO UPDATE SET
        label = EXCLUDED.label,
        updated_at = EXCLUDED.updated_at
    `;
    accepted++;
  }

  return NextResponse.json({ accepted, projectId: body.project.id });
}
