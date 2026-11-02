import { execFileSync } from "node:child_process";

function run(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function isGitRepo(cwd: string): boolean {
  try {
    run(cwd, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

export function gitHead(cwd: string): string {
  return run(cwd, ["rev-parse", "HEAD"]);
}

export function gitBranch(cwd: string): string {
  try {
    return run(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  } catch {
    return "HEAD";
  }
}

export function gitIsDirty(cwd: string): boolean {
  const status = run(cwd, ["status", "--porcelain"]);
  return status.length > 0;
}

export function gitCreateBackupRef(cwd: string, label: string): string {
  const ref = `refs/aiwork/backup-${label.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40)}-${Date.now()}`;
  run(cwd, ["update-ref", ref, "HEAD"]);
  return ref;
}

export function gitStashPush(cwd: string, message: string): void {
  run(cwd, ["stash", "push", "-u", "-m", message]);
}

export function gitCheckoutCommit(cwd: string, commit: string): void {
  run(cwd, ["checkout", commit, "--"]);
  // Prefer restoring files to that commit without detaching unless needed —
  // For restore we checkout the commit in detached or reset mixed with safety.
  // Plan: refuse dirty unless --force with stash; then `git reset --hard <commit>` is too dangerous.
  // Use: git restore --source=<commit> . after stash, OR git checkout <commit> for detached.
}

export function gitRestoreToCommit(
  cwd: string,
  commit: string,
  opts: { force?: boolean } = {}
): { ok: true; backupRef?: string; stashed: boolean } | { ok: false; reason: string } {
  if (!isGitRepo(cwd)) return { ok: false, reason: "Not a git repository" };
  const dirty = gitIsDirty(cwd);
  let stashed = false;
  let backupRef: string | undefined;
  if (dirty) {
    if (!opts.force) {
      return {
        ok: false,
        reason: "Working tree is dirty. Commit/stash changes, or pass --force to stash and restore.",
      };
    }
    backupRef = gitCreateBackupRef(cwd, "pre-restore");
    gitStashPush(cwd, `aiwork-restore-${commit.slice(0, 8)}`);
    stashed = true;
  } else {
    backupRef = gitCreateBackupRef(cwd, "pre-restore");
  }

  try {
    // Detached checkout of the checkpoint commit
    run(cwd, ["checkout", "--detach", commit]);
    return { ok: true, backupRef, stashed };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
