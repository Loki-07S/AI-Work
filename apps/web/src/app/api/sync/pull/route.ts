import { NextRequest, NextResponse } from "next/server";
import { userFromAuthHeader } from "@/lib/auth";
import { getSql, migrateCloud } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    await migrateCloud();
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 503 });
  }

  const user = await userFromAuthHeader(req.headers.get("authorization"));
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get("projectId");
  const since = req.nextUrl.searchParams.get("since");
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const db = getSql();
  const owned = await db`
    SELECT id FROM projects WHERE id = ${projectId} AND owner_user_id = ${user.id} LIMIT 1
  `;
  if (!owned[0]) {
    // Also allow if user is in same org — simplified: deny if not owner for V1
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  const sinceNum = since ? Number(since) : 0;

  const tasks = await db`
    SELECT * FROM tasks WHERE project_id = ${projectId} AND updated_at > ${sinceNum}
  `;
  const agentRuns = await db`
    SELECT * FROM agent_runs WHERE project_id = ${projectId} AND updated_at > ${sinceNum}
  `;
  const events = await db`
    SELECT * FROM events WHERE project_id = ${projectId} AND updated_at > ${sinceNum}
  `;
  const checkpoints = await db`
    SELECT * FROM checkpoints WHERE project_id = ${projectId} AND updated_at > ${sinceNum}
  `;

  return NextResponse.json({ tasks, agentRuns, events, checkpoints });
}
