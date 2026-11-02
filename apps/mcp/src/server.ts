#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  ensureProject,
  getCheckpoint,
  listCheckpoints,
  listEventsForTask,
  listTasks,
  openSqlite,
  searchLocal,
} from "@aiwork/db";
import path from "node:path";

function projectRoot(): string {
  return process.env.AIWORK_PROJECT_ROOT
    ? path.resolve(process.env.AIWORK_PROJECT_ROOT)
    : process.cwd();
}

function withDb<T>(fn: (client: ReturnType<typeof openSqlite>, projectId: string) => T): T {
  const root = projectRoot();
  const client = openSqlite(root);
  try {
    const project = ensureProject(client, root);
    return fn(client, project.id);
  } finally {
    client.sqlite.close();
  }
}

const server = new Server(
  { name: "aiwork", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_history",
      description: "Full-text search AIWork task/event history for this project",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
        },
        required: ["query"],
      },
    },
    {
      name: "get_task",
      description: "Get a task and its recent timeline events",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string" },
        },
        required: ["taskId"],
      },
    },
    {
      name: "get_decision",
      description: "List DECISION events for a task (LLM-derived summaries with source citations)",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string" },
        },
        required: ["taskId"],
      },
    },
    {
      name: "get_checkpoint",
      description: "Get checkpoint(s) for a task, or a specific checkpoint by id",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          checkpointId: { type: "string" },
        },
      },
    },
    {
      name: "list_tasks",
      description: "List AIWork tasks in the current project",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;

  try {
    if (name === "search_history") {
      const query = String(args.query ?? "");
      const limit = Number(args.limit ?? 20);
      const results = withDb((client) => searchLocal(client, query, limit));
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    }
    if (name === "list_tasks") {
      const tasks = withDb((client, projectId) => listTasks(client, projectId));
      return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }] };
    }
    if (name === "get_task") {
      const taskId = String(args.taskId ?? "");
      const data = withDb((client, projectId) => {
        const task = listTasks(client, projectId).find((t) => t.id === taskId);
        const events = listEventsForTask(client, taskId, 100).map((e) => ({
          id: e.id,
          type: e.type,
          ts: e.ts,
          agent: e.agent,
          summary: e.summary,
          payload: JSON.parse(e.payloadJson),
        }));
        return { task, events };
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
    if (name === "get_decision") {
      const taskId = String(args.taskId ?? "");
      const decisions = withDb((client) =>
        listEventsForTask(client, taskId, 500)
          .filter((e) => e.type === "DECISION")
          .map((e) => ({
            id: e.id,
            summary: e.summary,
            payload: JSON.parse(e.payloadJson),
            ts: e.ts,
          }))
      );
      return { content: [{ type: "text", text: JSON.stringify(decisions, null, 2) }] };
    }
    if (name === "get_checkpoint") {
      const checkpointId = args.checkpointId ? String(args.checkpointId) : null;
      const taskId = args.taskId ? String(args.taskId) : null;
      const data = withDb((client) => {
        if (checkpointId) return getCheckpoint(client, checkpointId) ?? null;
        if (taskId) return listCheckpoints(client, taskId);
        return [];
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: err instanceof Error ? err.message : String(err),
        },
      ],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
