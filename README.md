# AIWork ⚡

> **A task-centric workspace that records, organizes, searches, and resumes AI coding agent activity across long-lived codebases.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Architecture: Local--First](https://img.shields.io/badge/Architecture-Local--First-green.svg)](#architecture)

---

## 📌 The Problem

Developers working with AI coding agents (such as **Cursor** and **Claude Code**) lose track of what was asked, what the agent attempted, what it changed, and why. 

AI coding activity typically lives in linear, ephemeral chat windows rather than structured, searchable project history. When debugging regressions, resuming tasks after context loss, or collaborating across teams, critical context is lost.

---

## 💡 The Solution

**AIWork** observes AI agent loops in real-time, structuring agent operations into a unified hierarchy:

```
Organization ──> Project ──> Task ──> Agent Run ──> Events (Prompts, Tools, Diffs, Shell) ──> Checkpoints
```

- **Zero-Friction Capture:** Uses native agent lifecycle hooks (`beforeSubmitPrompt`, `afterAgentResponse`, tool calls, shell executions).
- **Offline & Local-First:** All events write synchronously to a project-local SQLite database (`.aiwork/aiwork.db`) with full-text search (FTS5).
- **Fast Full-Text Search:** Instant command-line and UI search across past prompts, tool outputs, shell commands, and file edits.
- **Git-Tied Checkpoints:** Capture commits, branches, and dirty status directly linked to task history.
- **Cloud Sync:** Securely sync local events to a central PostgreSQL (Supabase) database when authenticated.

---

## 🏗️ Architecture & Monorepo Structure

AIWork is structured as a TypeScript pnpm monorepo:

```
aiwork/
├── packages/
│   ├── core/           # Event schemas, payload types, and normalizers (Cursor & Claude Code)
│   ├── db/             # Local SQLite database layer (Drizzle ORM + raw SQLite FTS5)
│   ├── collector/      # Stdio hook listener and pipeline normalizer
│   └── sync/           # Local <-> Cloud delta synchronization engine
├── apps/
│   ├── cli/            # Developer CLI (aiwork init, timeline, search, sync, status, etc.)
│   ├── extension/      # Cursor / VS Code companion extension with activity panels
│   ├── mcp/            # Model Context Protocol server exposing history to agents
│   └── web/            # Next.js 14 web dashboard with Supabase auth and Stripe billing
└── scripts/            # Database migration and diagnostic utilities
```

---

## 🚀 Quickstart

### 1. Prerequisites

- **Node.js**: `v18.20.0+`
- **pnpm**: `v9+`
- **Cursor IDE** or **Claude Code**

### 2. Installation & Build

Clone the repository and install dependencies:

```bash
git clone https://github.com/Loki-07S/AI-Work.git
cd AI-Work
pnpm install
pnpm build
```

---

## 💻 CLI Commands

Run the CLI from your project or link it globally:

| Command | Description |
| :--- | :--- |
| `aiwork init` | Initialize `.aiwork/` local database and install `.cursor/hooks.json` |
| `aiwork timeline` | View chronologically formatted agent prompt, tool, and response activity |
| `aiwork search "<query>"` | Full-text search across past prompts, file paths, commands, and diffs |
| `aiwork tasks` | List tasks and see which task is currently active/pinned |
| `aiwork status` | Summary of local events, project ID, and active task |
| `aiwork checkpoint` | Create a task-linked checkpoint tied to the current git commit |
| `aiwork files` | View files modified under the current active task |
| `aiwork login` | Authenticate the CLI with your AIWork cloud token |
| `aiwork sync` | Push local events and pull remote team changes |

---

## 🔌 Cursor Agent Integration

AIWork integrates natively with Cursor using **Cursor Agent Lifecycle Hooks**. Running `aiwork init` in your repository configures `.cursor/hooks.json`:

```json
{
  "version": 1,
  "hooks": {
    "beforeSubmitPrompt": [{ "command": "aiwork hook --agent=cursor" }],
    "afterAgentResponse": [{ "command": "aiwork hook --agent=cursor" }],
    "preToolUse": [{ "command": "aiwork hook --agent=cursor" }],
    "postToolUse": [{ "command": "aiwork hook --agent=cursor" }],
    "beforeShellExecution": [{ "command": "aiwork hook --agent=cursor" }],
    "afterShellExecution": [{ "command": "aiwork hook --agent=cursor" }],
    "afterFileEdit": [{ "command": "aiwork hook --agent=cursor" }],
    "stop": [{ "command": "aiwork hook --agent=cursor" }]
  }
}
```

### Captured Lifecycle Events:
- **`beforeSubmitPrompt`**: Captures user intention, attachments, session IDs, and active models.
- **`preToolUse` & `postToolUse`**: Captures file reads, greps, semantic searches, and arguments.
- **`beforeShellExecution` & `afterShellExecution`**: Records commands run, exit codes, and output snippets.
- **`afterFileEdit`**: Tracks hunk modifications, target files, and diff statistics.
- **`afterAgentResponse`**: Records the completed response text and token metrics.
- **`stop`**: Signals turn completion and marks the agent run status.

---

## 🌐 Web Dashboard & Cloud Sync

To run the cloud dashboard locally:

```bash
cd apps/web
# Configure .env.local with DATABASE_URL and JWT_SECRET
pnpm dev
```

Visit `http://localhost:3000` to register, grab your CLI login token, and view synced projects.

---

## 📄 License

MIT © [Loki-07S](https://github.com/Loki-07S)
