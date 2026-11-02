import * as vscode from "vscode";
import {
  createTask,
  ensureProject,
  fileChangesForTask,
  getActiveTaskId,
  listEventsForTask,
  listTasks,
  openSqlite,
  searchLocal,
  setActiveTaskId,
  createCheckpoint,
  insertNormalizedEvents,
} from "@aiwork/db";
import { nowMs } from "@aiwork/core";
import type { NormalizedEvent } from "@aiwork/core";
import { execFileSync } from "node:child_process";
import * as path from "node:path";

// ── Constants ──────────────────────────────────────────────────────────────────
const INACTIVITY_MS = 30 * 60 * 1000; // 30 min gap → new task
const SESSION_ID = "vscode-ext";

// ── Helpers ───────────────────────────────────────────────────────────────────

function projectRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function withDb<T>(fn: (client: ReturnType<typeof openSqlite>, projectId: string) => T): T | undefined {
  const root = projectRoot();
  if (!root) return undefined;
  const client = openSqlite(root);
  try {
    const project = ensureProject(client, root);
    return fn(client, project.id);
  } finally {
    client.sqlite.close();
  }
}

/** Ensure there is an active task. Auto-creates one if none exists or
 *  if the last event was more than INACTIVITY_MS ago. Returns the taskId. */
function ensureActiveTask(
  client: ReturnType<typeof openSqlite>,
  projectId: string,
  hint: string
): string {
  const currentId = getActiveTaskId(client);

  // Check if current task still "fresh" (recent event within inactivity window)
  if (currentId) {
    const rows = client.sqlite
      .prepare(`SELECT ts FROM events WHERE task_id = ? ORDER BY ts DESC LIMIT 1`)
      .all(currentId) as { ts: number }[];
    const lastTs = rows[0]?.ts ?? 0;
    if (nowMs() - lastTs < INACTIVITY_MS) {
      return currentId; // still active, keep it
    }
  }

  // No active task or inactivity gap → create a new one
  const title = `Session — ${hint} — ${new Date().toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`;
  const newId = createTask(client, projectId, title, "auto");
  setActiveTaskId(client, newId);
  return newId;
}

function captureEvent(
  type: NormalizedEvent["type"],
  payload: Record<string, unknown>,
  hintForTask: string,
  dedupeKey?: string
) {
  const root = projectRoot();
  if (!root) return;
  const client = openSqlite(root);
  try {
    const project = ensureProject(client, root);
    const taskId = ensureActiveTask(client, project.id, hintForTask);
    const ev: NormalizedEvent = {
      type,
      ts: nowMs(),
      agent: "cursor",
      externalSessionId: SESSION_ID,
      summary: "",
      payload,
      dedupeKey: dedupeKey ?? null,
    };
    insertNormalizedEvents(client, project.id, [ev]);
  } catch {
    // never crash the editor
  } finally {
    client.sqlite.close();
  }
}

// ── Tree Items ─────────────────────────────────────────────────────────────────

class TaskItem extends vscode.TreeItem {
  constructor(
    public readonly taskId: string,
    title: string,
    status: string,
    active: boolean
  ) {
    super(title, vscode.TreeItemCollapsibleState.None);
    this.description = active ? `active · ${status}` : status;
    this.contextValue = "aiworkTask";
    this.iconPath = new vscode.ThemeIcon(active ? "pinned" : "circle-outline");
    this.command = { command: "aiwork.selectTask", title: "Select", arguments: [taskId] };
  }
}

class EventItem extends vscode.TreeItem {
  constructor(
    public readonly eventId: string,
    type: string,
    summary: string,
    agent: string,
    ts: number,
    public readonly payloadJson: string
  ) {
    super(`${type}`, vscode.TreeItemCollapsibleState.None);
    this.description = `${agent} · ${new Date(ts).toLocaleTimeString()} · ${summary}`;
    this.tooltip = summary;
    if (type === "FILE_EDIT" || type === "FILE_READ") {
      this.command = { command: "aiwork.openEventFile", title: "Open", arguments: [payloadJson] };
      this.iconPath = new vscode.ThemeIcon("file");
    } else if (type === "DECISION") {
      this.command = { command: "aiwork.showDecisionSources", title: "Sources", arguments: [payloadJson] };
      this.iconPath = new vscode.ThemeIcon("lightbulb");
    } else if (type === "COMMAND" || type === "TEST") {
      this.iconPath = new vscode.ThemeIcon("terminal");
    } else if (type === "ERROR") {
      this.iconPath = new vscode.ThemeIcon("error");
    } else {
      this.iconPath = new vscode.ThemeIcon("comment");
    }
  }
}

class FileItem extends vscode.TreeItem {
  constructor(filePath: string, count: number) {
    super(filePath, vscode.TreeItemCollapsibleState.None);
    this.description = `${count} edit${count === 1 ? "" : "s"}`;
    this.iconPath = new vscode.ThemeIcon("file-code");
    this.command = { command: "vscode.open", title: "Open", arguments: [vscode.Uri.file(filePath)] };
  }
}

// ── Tree Providers ─────────────────────────────────────────────────────────────

class TasksProvider implements vscode.TreeDataProvider<TaskItem> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  refresh() { this._onDidChange.fire(); }
  getTreeItem(el: TaskItem) { return el; }
  getChildren(): TaskItem[] {
    return withDb((client, projectId) => {
      const active = getActiveTaskId(client);
      return listTasks(client, projectId).map(
        (t) => new TaskItem(t.id, t.title, t.status, t.id === active)
      );
    }) ?? [];
  }
}

class TimelineProvider implements vscode.TreeDataProvider<EventItem> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private selectedTaskId: string | null = null;
  setTask(id: string | null) { this.selectedTaskId = id; this.refresh(); }
  refresh() { this._onDidChange.fire(); }
  getTreeItem(el: EventItem) { return el; }
  getChildren(): EventItem[] {
    return withDb((client) => {
      const taskId = this.selectedTaskId ?? getActiveTaskId(client);
      if (!taskId) return [];
      return listEventsForTask(client, taskId).map(
        (e) => new EventItem(e.id, e.type, e.summary ?? "", e.agent, e.ts, e.payloadJson)
      );
    }) ?? [];
  }
}

class FilesProvider implements vscode.TreeDataProvider<FileItem> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private selectedTaskId: string | null = null;
  setTask(id: string | null) { this.selectedTaskId = id; this.refresh(); }
  refresh() { this._onDidChange.fire(); }
  getTreeItem(el: FileItem) { return el; }
  getChildren(): FileItem[] {
    return withDb((client) => {
      const taskId = this.selectedTaskId ?? getActiveTaskId(client);
      if (!taskId) return [];
      const counts = new Map<string, number>();
      for (const e of fileChangesForTask(client, taskId)) {
        try {
          const p = JSON.parse(e.payloadJson) as { path?: string };
          if (p.path) counts.set(p.path, (counts.get(p.path) ?? 0) + 1);
        } catch { /* ignore */ }
      }
      return [...counts.entries()].map(([p, c]) => new FileItem(p, c));
    }) ?? [];
  }
}

// ── Activate ──────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  const tasksProvider = new TasksProvider();
  const timelineProvider = new TimelineProvider();
  const filesProvider = new FilesProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("aiwork.tasks", tasksProvider),
    vscode.window.registerTreeDataProvider("aiwork.timeline", timelineProvider),
    vscode.window.registerTreeDataProvider("aiwork.files", filesProvider)
  );

  const refreshAll = () => {
    tasksProvider.refresh();
    timelineProvider.refresh();
    filesProvider.refresh();
  };

  // ── Capture: file saves (FILE_EDIT) — auto-creates task on first save ──────
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.scheme !== "file") return;
      const filePath = doc.uri.fsPath;
      if (filePath.includes(".aiwork")) return;
      const hint = path.basename(filePath);
      captureEvent("FILE_EDIT", { path: filePath, saved: true }, hint, `fe-save-${filePath}`);
      refreshAll();
    })
  );

  // ── Capture: file opens (FILE_READ) ───────────────────────────────────────
  let lastOpenedFile = "";
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!editor || editor.document.uri.scheme !== "file") return;
      const filePath = editor.document.uri.fsPath;
      if (filePath === lastOpenedFile || filePath.includes(".aiwork")) return;
      lastOpenedFile = filePath;
      const hint = path.basename(filePath);
      // Only capture FILE_READ if a task already exists (don't auto-create on mere file open)
      const root = projectRoot();
      if (!root) return;
      const client = openSqlite(root);
      try {
        const taskId = getActiveTaskId(client);
        if (!taskId) return; // no task yet — wait for a real action
        captureEvent("FILE_READ", { path: filePath }, hint, `fr-open-${filePath}-${Date.now()}`);
      } finally {
        client.sqlite.close();
      }
      refreshAll();
    })
  );

  // ── Capture: terminal open/close (COMMAND) ────────────────────────────────
  context.subscriptions.push(
    vscode.window.onDidOpenTerminal((terminal) => {
      captureEvent("COMMAND", { command: terminal.name, event: "terminal_opened" }, terminal.name);
    }),
    vscode.window.onDidCloseTerminal((terminal) => {
      captureEvent("COMMAND", {
        command: terminal.name,
        exitCode: terminal.exitStatus?.code ?? null,
        event: "terminal_closed",
      }, terminal.name);
      refreshAll();
    })
  );

  // ── Commands ─────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("aiwork.refresh", refreshAll),

    vscode.commands.registerCommand("aiwork.selectTask", (taskId: string) => {
      timelineProvider.setTask(taskId);
      filesProvider.setTask(taskId);
    }),

    // Manual task creation — user can override the auto name
    vscode.commands.registerCommand("aiwork.createTask", async () => {
      const title = await vscode.window.showInputBox({
        prompt: "Task title (leave blank to auto-name from current work)",
        placeHolder: "e.g. Fix login redirect",
      });
      const finalTitle = title?.trim() ||
        `Session — ${new Date().toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`;
      withDb((client, projectId) => {
        const id = createTask(client, projectId, finalTitle, "manual");
        setActiveTaskId(client, id);
        vscode.window.showInformationMessage(`AIWork: started new task "${finalTitle}"`);
      });
      refreshAll();
    }),

    vscode.commands.registerCommand("aiwork.pinTask", (item?: TaskItem) => {
      if (!item?.taskId) return;
      withDb((client) => { setActiveTaskId(client, item.taskId); });
      timelineProvider.setTask(item.taskId);
      filesProvider.setTask(item.taskId);
      refreshAll();
    }),

    vscode.commands.registerCommand("aiwork.openEventFile", async (payloadJson: string) => {
      try {
        const p = JSON.parse(payloadJson) as { path?: string };
        if (!p.path) return;
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(p.path));
        await vscode.window.showTextDocument(doc);
      } catch (err) {
        vscode.window.showErrorMessage(`AIWork: could not open file (${err})`);
      }
    }),

    vscode.commands.registerCommand("aiwork.showDecisionSources", async (payloadJson: string) => {
      try {
        const p = JSON.parse(payloadJson) as { text?: string; sourceEventIds?: string[]; confidence?: number };
        const md = [`# Decision`, ``, p.text ?? "", ``, `Confidence: ${p.confidence ?? "n/a"}`, ``,
          `## Source event IDs`, ...(p.sourceEventIds ?? []).map((id) => `- \`${id}\``)].join("\n");
        const doc = await vscode.workspace.openTextDocument({ content: md, language: "markdown" });
        await vscode.window.showTextDocument(doc, { preview: true });
      } catch { /* ignore */ }
    }),

    vscode.commands.registerCommand("aiwork.search", async () => {
      const query = await vscode.window.showInputBox({ prompt: "Search AIWork history" });
      if (!query) return;
      const results = withDb((client) => searchLocal(client, query, 30)) ?? [];
      if (results.length === 0) {
        vscode.window.showInformationMessage("AIWork: no matches");
        return;
      }
      const picked = await vscode.window.showQuickPick(
        results.map((r) => ({
          label: r.type,
          description: r.snippet,
          detail: `task ${r.taskId.slice(0, 10)} ${r.filePaths || ""}`,
          taskId: r.taskId,
          filePaths: r.filePaths,
        })),
        { matchOnDescription: true, matchOnDetail: true }
      );
      if (!picked) return;
      timelineProvider.setTask(picked.taskId);
      filesProvider.setTask(picked.taskId);
      const firstPath = picked.filePaths?.split(/\s+/).find(Boolean);
      if (firstPath) {
        try {
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(firstPath));
          await vscode.window.showTextDocument(doc);
        } catch { /* ignore */ }
      }
      refreshAll();
    }),

    vscode.commands.registerCommand("aiwork.checkpoint", () => {
      const root = projectRoot();
      if (!root) return;
      withDb((client, projectId) => {
        const taskId = getActiveTaskId(client);
        if (!taskId) {
          vscode.window.showWarningMessage("AIWork: no active task — save a file first to auto-create one");
          return;
        }
        try {
          const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
          const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
          const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim().length > 0;
          const id = createCheckpoint(client, { projectId, taskId, gitCommit: commit, gitBranch: branch, dirty, label: null });
          vscode.window.showInformationMessage(
            `AIWork checkpoint ${id.slice(0, 8)} @ ${commit.slice(0, 8)}${dirty ? " (dirty)" : ""}`
          );
        } catch (err) {
          vscode.window.showErrorMessage(`AIWork checkpoint failed: ${err}`);
        }
      });
    })
  );

  // Auto-refresh every 5s
  const interval = setInterval(refreshAll, 5000);
  context.subscriptions.push({ dispose: () => clearInterval(interval) });

  vscode.window.showInformationMessage("AIWork active — tasks auto-create on first file save.");
}

export function deactivate() {}
