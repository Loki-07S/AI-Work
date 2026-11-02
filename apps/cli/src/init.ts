import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureAiworkDir, openSqlite, ensureProject } from "@aiwork/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Resolve absolute path to the hook entry that Cursor will spawn */
export function hookCommand(agent: "cursor" | "claude_code"): string {
  const hookJs = path.resolve(__dirname, "hook.js");
  const agentFlag = agent === "claude_code" ? " --agent=claude_code" : " --agent=cursor";
  // Use node explicitly for Windows compatibility
  return `node "${hookJs}"${agentFlag}`;
}

const CURSOR_HOOK_EVENTS = [
  "sessionStart",
  "sessionEnd",
  "beforeSubmitPrompt",
  "afterAgentResponse",
  "afterAgentThought",
  "preToolUse",
  "postToolUse",
  "postToolUseFailure",
  "beforeShellExecution",
  "afterShellExecution",
  "beforeMCPExecution",
  "afterMCPExecution",
  "beforeReadFile",
  "afterFileEdit",
  "subagentStart",
  "subagentStop",
  "preCompact",
  "stop",
] as const;

export function initProject(
  projectRoot: string,
  opts: { agent?: "cursor" | "claude_code" | "both" } = {}
): void {
  const agent = opts.agent ?? "cursor";
  ensureAiworkDir(projectRoot);
  const client = openSqlite(projectRoot);
  ensureProject(client, projectRoot);
  client.sqlite.close();

  // gitignore
  const gi = path.join(projectRoot, ".gitignore");
  const giEntry = ".aiwork/";
  if (fs.existsSync(gi)) {
    const current = fs.readFileSync(gi, "utf8");
    if (!current.split(/\r?\n/).includes(giEntry.replace("/", "")) && !current.includes(".aiwork")) {
      fs.appendFileSync(gi, `\n# AIWork local data\n${giEntry}\n`);
    }
  } else {
    fs.writeFileSync(gi, `# AIWork local data\n${giEntry}\n`);
  }

  if (agent === "cursor" || agent === "both") {
    installCursorHooks(projectRoot);
  }
  if (agent === "claude_code" || agent === "both") {
    installClaudeHooks(projectRoot);
  }
}

function installCursorHooks(projectRoot: string): void {
  const cursorDir = path.join(projectRoot, ".cursor");
  fs.mkdirSync(cursorDir, { recursive: true });
  const hooksPath = path.join(cursorDir, "hooks.json");
  const cmd = hookCommand("cursor");

  let existing: { version?: number; hooks?: Record<string, Array<{ command: string }>> } = {
    version: 1,
    hooks: {},
  };
  if (fs.existsSync(hooksPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
    } catch {
      // backup and replace
      fs.copyFileSync(hooksPath, hooksPath + ".bak");
    }
  }
  existing.version = existing.version ?? 1;
  existing.hooks = existing.hooks ?? {};

  for (const event of CURSOR_HOOK_EVENTS) {
    const list = existing.hooks[event] ?? [];
    const already = list.some((h) => h.command.includes("hook.js") && h.command.includes("aiwork"));
    // Also match our absolute path pattern
    const already2 = list.some((h) => h.command.includes("apps") && h.command.includes("hook.js"));
    const already3 = list.some((h) => h.command === cmd);
    if (!already && !already2 && !already3) {
      list.push({ command: cmd });
    } else {
      // Refresh command path to current install
      for (const h of list) {
        if (
          h.command.includes("hook.js") &&
          (h.command.includes("aiwork") || h.command.includes("--agent=cursor"))
        ) {
          h.command = cmd;
        }
      }
    }
    existing.hooks[event] = list;
  }

  fs.writeFileSync(hooksPath, JSON.stringify(existing, null, 2) + "\n");
}

function installClaudeHooks(projectRoot: string): void {
  const claudeDir = path.join(projectRoot, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  const settingsPath = path.join(claudeDir, "settings.json");
  const cmd = hookCommand("claude_code");

  const events = [
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "Stop",
    "StopFailure",
    "SubagentStart",
    "SubagentStop",
    "SessionStart",
    "SessionEnd",
  ];

  let settings: {
    hooks?: Record<string, Array<{ matcher?: string; hooks: Array<{ type: string; command: string }> }>>;
  } = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    } catch {
      fs.copyFileSync(settingsPath, settingsPath + ".bak");
    }
  }
  settings.hooks = settings.hooks ?? {};

  for (const event of events) {
    const groups = settings.hooks[event] ?? [];
    const eventCmd = `${cmd} --event=${event}`;
    const has = groups.some((g) =>
      g.hooks?.some((h) => h.command.includes("hook.js") && h.command.includes("claude_code"))
    );
    if (!has) {
      groups.push({
        hooks: [{ type: "command", command: eventCmd }],
      });
    } else {
      for (const g of groups) {
        for (const h of g.hooks ?? []) {
          if (h.command.includes("hook.js") && h.command.includes("claude_code")) {
            h.command = eventCmd;
          }
        }
      }
    }
    settings.hooks[event] = groups;
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}
