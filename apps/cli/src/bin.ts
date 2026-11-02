#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import { initProject } from "./init.js";
import {
  checkpointCmd,
  checkpointsListCmd,
  decideCmd,
  filesCmd,
  restoreCmd,
  searchCmd,
  statusCmd,
  tailCmd,
  taskCreateCmd,
  taskPinCmd,
  tasksCmd,
  timelineCmd,
} from "./commands.js";
import {
  applyPull,
  buildPushPayload,
  configPath,
  loadConfig,
  pullFromCloud,
  pushToCloud,
  saveConfig,
} from "@aiwork/sync";
import { ensureProject, openSqlite } from "@aiwork/db";
import { nowMs } from "@aiwork/core";

const program = new Command();
program.name("aiwork").description("AIWork — task-centric AI agent activity workspace").version("0.1.0");

function root(): string {
  return path.resolve(process.cwd());
}

program
  .command("init")
  .description("Initialize AIWork in the current project and install agent hooks")
  .option("--agent <agent>", "cursor | claude-code | both", "cursor")
  .action((opts: { agent: string }) => {
    const map: Record<string, "cursor" | "claude_code" | "both"> = {
      cursor: "cursor",
      "claude-code": "claude_code",
      claude_code: "claude_code",
      both: "both",
    };
    const agent = map[opts.agent] ?? "cursor";
    initProject(root(), { agent });
    console.log(`AIWork initialized in ${root()}`);
    console.log(`Agent hooks: ${agent}`);
    console.log("Tip: trust this workspace in Cursor so project hooks load.");
  });

program
  .command("status")
  .description("Show local project capture status")
  .action(() => statusCmd(root()));

program
  .command("tail")
  .description("Show recent captured events")
  .option("-n, --limit <n>", "number of events", "30")
  .action((opts: { limit: string }) => tailCmd(root(), Number(opts.limit) || 30));

program
  .command("tasks")
  .description("List tasks")
  .action(() => tasksCmd(root()));

program
  .command("task")
  .description("Task operations")
  .argument("<action>", "create | pin")
  .argument("[arg]", "title or task id")
  .action((action: string, arg?: string) => {
    if (action === "create") {
      if (!arg) {
        console.error("Usage: aiwork task create <title>");
        process.exitCode = 1;
        return;
      }
      taskCreateCmd(root(), arg);
    } else if (action === "pin") {
      if (!arg) {
        console.error("Usage: aiwork task pin <taskId>");
        process.exitCode = 1;
        return;
      }
      taskPinCmd(root(), arg);
    } else {
      console.error("Unknown action. Use create|pin");
      process.exitCode = 1;
    }
  });

program
  .command("timeline")
  .description("Show chronological events for a task")
  .argument("[taskId]", "task id (default: active)")
  .action((taskId?: string) => timelineCmd(root(), taskId));

program
  .command("files")
  .description("File changes for a task")
  .argument("[taskId]", "task id (default: active)")
  .action((taskId?: string) => filesCmd(root(), taskId));

program
  .command("search")
  .description("Full-text search local history")
  .argument("<query>", "search query")
  .action((query: string) => searchCmd(root(), query));

program
  .command("checkpoint")
  .description("Create a git-tied checkpoint for the active task")
  .option("-l, --label <label>", "optional label")
  .action((opts: { label?: string }) => checkpointCmd(root(), opts.label));

program
  .command("checkpoints")
  .description("List checkpoints for active (or given) task")
  .argument("[taskId]")
  .action((taskId?: string) => checkpointsListCmd(root(), taskId));

program
  .command("restore")
  .description("Restore working tree to a checkpoint commit")
  .argument("<checkpointId>")
  .option("--force", "stash dirty tree before restore", false)
  .action((checkpointId: string, opts: { force?: boolean }) =>
    restoreCmd(root(), checkpointId, { force: opts.force })
  );

program
  .command("decide")
  .description("Extract DECISION events for a task via Claude API")
  .argument("[taskId]")
  .action(async (taskId?: string) => {
    await decideCmd(root(), taskId);
  });

program
  .command("login")
  .description("Save cloud API credentials for sync")
  .requiredOption("--token <token>", "access token from AIWork web")
  .option("--api <url>", "API base URL", "http://localhost:3000")
  .option("--email <email>")
  .action((opts: { token: string; api: string; email?: string }) => {
    const cfg = loadConfig();
    cfg.accessToken = opts.token;
    cfg.apiBaseUrl = opts.api;
    if (opts.email) cfg.email = opts.email;
    saveConfig(cfg);
    console.log(`Logged in. Config: ${configPath()}`);
  });

program
  .command("sync")
  .description("Push local history and pull remote updates")
  .action(async () => {
    const cfg = loadConfig();
    if (!cfg.accessToken || !cfg.apiBaseUrl) {
      console.error("Not logged in. Run: aiwork login --token <token>");
      process.exitCode = 1;
      return;
    }
    const client = openSqlite(root());
    try {
      const project = ensureProject(client, root());
      const syncRow = client.sqlite
        .prepare(`SELECT * FROM sync_state WHERE project_id = ?`)
        .get(project.id) as
        | { remote_project_id: string | null; last_push_at: number | null; last_pull_at: number | null }
        | undefined;
      const since = syncRow?.last_push_at ?? null;
      const payload = buildPushPayload(client, project.id, since);
      const push = await pushToCloud(cfg.apiBaseUrl, cfg.accessToken, payload);
      if (!push.ok) {
        console.error("Push failed:", push.error);
        process.exitCode = 1;
        return;
      }
      console.log(`Pushed ${push.accepted} row(s)`);

      const remoteId = syncRow?.remote_project_id ?? project.id;
      const pull = await pullFromCloud(
        cfg.apiBaseUrl,
        cfg.accessToken,
        remoteId,
        syncRow?.last_pull_at ?? null
      );
      if (!pull.ok) {
        console.error("Pull failed:", pull.error);
        process.exitCode = 1;
        return;
      }
      const applied = applyPull(client, {
        tasks: pull.tasks as Array<Record<string, unknown>>,
        agentRuns: pull.agentRuns as Array<Record<string, unknown>>,
        events: pull.events as Array<Record<string, unknown>>,
        checkpoints: pull.checkpoints as Array<Record<string, unknown>>,
      });
      const now = nowMs();
      client.sqlite
        .prepare(
          `INSERT INTO sync_state(project_id, remote_project_id, last_push_at, last_pull_at, cursor)
           VALUES(?, ?, ?, ?, ?)
           ON CONFLICT(project_id) DO UPDATE SET
             remote_project_id=excluded.remote_project_id,
             last_push_at=excluded.last_push_at,
             last_pull_at=excluded.last_pull_at`
        )
        .run(project.id, remoteId, now, now, null);
      console.log(`Pulled/applied ${applied} row(s)`);
    } finally {
      client.sqlite.close();
    }
  });

program
  .command("hook")
  .description("Internal: process a hook payload from stdin")
  .option("--agent <agent>", "cursor | claude_code", "cursor")
  .action(async (opts: { agent: string }) => {
    const { runHookProcess } = await import("@aiwork/collector");
    await runHookProcess(opts.agent === "claude_code" ? "claude_code" : "cursor");
  });

program.parseAsync(process.argv);
