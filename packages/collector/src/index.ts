import {
  normalizeClaudeCodeHook,
  normalizeCursorHook,
  type AgentKind,
  type NormalizedEvent,
} from "@aiwork/core";
import {
  ensureProject,
  insertNormalizedEvents,
  openSqlite,
} from "@aiwork/db";
import fs from "node:fs";
import path from "node:path";

export type CollectResult = {
  inserted: number;
  skipped: number;
  events: NormalizedEvent[];
};

export function cleanPath(p: string): string {
  let s = p.trim();
  // Strip leading slash for Windows drive paths (e.g. /c:/Users/... -> c:/Users/...)
  if (/^\/[a-zA-Z]:[\\\/]/.test(s)) {
    s = s.slice(1);
  }
  return path.resolve(s);
}

function findProjectRoot(startDir: string): string {
  let dir = cleanPath(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".aiwork")) || fs.existsSync(path.join(dir, ".git"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return cleanPath(startDir);
    dir = parent;
  }
}

export function resolveProjectRoot(workspaceRoots?: string[] | null, cwd?: string): string {
  if (workspaceRoots && workspaceRoots.length > 0 && typeof workspaceRoots[0] === "string" && workspaceRoots[0].trim()) {
    return cleanPath(workspaceRoots[0]);
  }
  return findProjectRoot(cwd && cwd.trim() ? cleanPath(cwd) : process.cwd());
}

export function normalizeHookPayload(
  agent: AgentKind,
  raw: unknown
): NormalizedEvent[] {
  if (agent === "cursor") return normalizeCursorHook(raw);
  return normalizeClaudeCodeHook(raw);
}

export function collectHookEvent(
  agent: AgentKind,
  raw: unknown,
  opts?: { projectRoot?: string }
): CollectResult {
  const roots =
    raw && typeof raw === "object" && Array.isArray((raw as { workspace_roots?: string[] }).workspace_roots)
      ? (raw as { workspace_roots: string[] }).workspace_roots
      : null;
  const cwd =
    raw && typeof raw === "object" && typeof (raw as { cwd?: string }).cwd === "string"
      ? (raw as { cwd: string }).cwd
      : process.cwd();

  const projectRoot = opts?.projectRoot ?? resolveProjectRoot(roots, cwd);
  const normalized = normalizeHookPayload(agent, raw);
  if (normalized.length === 0) {
    return { inserted: 0, skipped: 0, events: [] };
  }

  const client = openSqlite(projectRoot);
  try {
    const project = ensureProject(client, projectRoot);
    const { inserted, skipped } = insertNormalizedEvents(client, project.id, normalized);
    return { inserted, skipped, events: normalized };
  } finally {
    client.sqlite.close();
  }
}

/** Observe-only hook response — never block the agent */
export function observeOnlyResponse(hookEventName?: string): Record<string, unknown> {
  switch (hookEventName) {
    case "beforeSubmitPrompt":
      return { continue: true };
    case "beforeShellExecution":
    case "beforeMCPExecution":
    case "beforeReadFile":
    case "preToolUse":
    case "subagentStart":
      return { permission: "allow" };
    default:
      return {};
  }
}

export async function readStdinUtf8(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  let raw = Buffer.concat(chunks).toString("utf8");
  // Strip BOM if present (Windows)
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  return raw;
}

export async function runHookProcess(agent: AgentKind): Promise<void> {
  let response: Record<string, unknown> = {};
  try {
    const stdin = await readStdinUtf8();
    let raw: unknown = {};
    if (stdin.trim()) {
      try {
        raw = JSON.parse(stdin);
      } catch {
        raw = { hook_event_name: "parse_error", raw: stdin.slice(0, 500) };
      }
    }
    const hookEventName =
      raw && typeof raw === "object"
        ? String((raw as { hook_event_name?: string }).hook_event_name ?? "")
        : "";
    // Ensure Claude Code payloads have hook_event_name if passed via argv
    if (
      agent === "claude_code" &&
      raw &&
      typeof raw === "object" &&
      !(raw as { hook_event_name?: string }).hook_event_name
    ) {
      const fromArg = process.argv.find((a) => a.startsWith("--event="));
      if (fromArg) {
        (raw as { hook_event_name: string }).hook_event_name = fromArg.slice("--event=".length);
      }
    }
    response = observeOnlyResponse(
      (raw as { hook_event_name?: string })?.hook_event_name ?? hookEventName
    );
    collectHookEvent(agent, raw);
  } catch (err) {
    // Never fail closed — log to stderr for debugging only
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[aiwork] hook error: ${msg}\n`);
  }
  process.stdout.write(JSON.stringify(response));
}
