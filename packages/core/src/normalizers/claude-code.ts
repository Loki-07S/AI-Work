import type { NormalizedEvent } from "../types.js";
import {
  hashDedupe,
  looksLikeTestCommand,
  nowMs,
  summarize,
  truncate,
} from "../utils.js";

type ClaudeHook = {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  tool_use_id?: string;
  prompt?: string;
  message?: string;
  [key: string]: unknown;
};

function sessionId(raw: ClaudeHook): string {
  return String(raw.session_id ?? "unknown");
}

function toolName(raw: ClaudeHook): string {
  return String(raw.tool_name ?? "unknown");
}

export function normalizeClaudeCodeHook(rawInput: unknown): NormalizedEvent[] {
  const raw = (rawInput ?? {}) as ClaudeHook;
  const eventName = String(raw.hook_event_name ?? "");
  const externalSessionId = sessionId(raw);
  const ts = nowMs();
  const base = {
    ts,
    agent: "claude_code" as const,
    generationId: null as string | null,
    externalSessionId,
    model: null as string | null,
    rawPayload: raw,
  };

  switch (eventName) {
    case "UserPromptSubmit": {
      const prompt = String(raw.prompt ?? "");
      return [
        {
          ...base,
          type: "USER_PROMPT",
          summary: summarize(prompt || "(empty prompt)"),
          payload: { text: prompt, attachmentPaths: [] },
          dedupeKey: hashDedupe("up", externalSessionId, prompt.slice(0, 200), String(ts)),
        },
      ];
    }
    case "PreToolUse": {
      const tool = toolName(raw);
      const input = raw.tool_input ?? {};
      const events: NormalizedEvent[] = [
        {
          ...base,
          type: "TOOL_CALL",
          summary: summarize(`${tool}`),
          payload: {
            tool,
            input,
            outputTruncated: null,
            durationMs: null,
            toolUseId: raw.tool_use_id ? String(raw.tool_use_id) : null,
            phase: "start",
          },
          dedupeKey: hashDedupe(
            "tc-start",
            externalSessionId,
            tool,
            JSON.stringify(input).slice(0, 120),
            String(raw.tool_use_id ?? ts)
          ),
        },
      ];

      if (tool === "Read" && input && typeof input === "object") {
        const path = String((input as { file_path?: string }).file_path ?? "");
        events.push({
          ...base,
          type: "FILE_READ",
          summary: `read ${path}`,
          payload: { path, contentTruncated: null, truncated: false },
          dedupeKey: hashDedupe("fr", externalSessionId, path, String(ts)),
        });
      }
      return events;
    }
    case "PostToolUse": {
      const tool = toolName(raw);
      const input = raw.tool_input ?? {};
      const { text: outputTruncated } = truncate(
        typeof raw.tool_response === "string"
          ? raw.tool_response
          : JSON.stringify(raw.tool_response ?? ""),
        8192
      );
      const events: NormalizedEvent[] = [
        {
          ...base,
          type: "TOOL_CALL",
          summary: summarize(`${tool} done`),
          payload: {
            tool,
            input,
            outputTruncated,
            durationMs: null,
            toolUseId: raw.tool_use_id ? String(raw.tool_use_id) : null,
            phase: "end",
          },
          dedupeKey: hashDedupe(
            "tc-end",
            externalSessionId,
            tool,
            String(raw.tool_use_id ?? ts)
          ),
        },
      ];

      if ((tool === "Edit" || tool === "Write" || tool === "MultiEdit") && input && typeof input === "object") {
        const path = String(
          (input as { file_path?: string }).file_path ??
            (input as { path?: string }).path ??
            ""
        );
        const oldStr = String((input as { old_string?: string }).old_string ?? "");
        const newStr = String(
          (input as { new_string?: string }).new_string ??
            (input as { content?: string }).content ??
            ""
        );
        events.push({
          ...base,
          type: "FILE_EDIT",
          summary: `edit ${path}`,
          payload: { path, edits: [{ old: oldStr, new: newStr }] },
          dedupeKey: hashDedupe("fe", externalSessionId, path, newStr.slice(0, 80), String(ts)),
        });
      }

      if (tool === "Bash" && input && typeof input === "object") {
        const command = String((input as { command?: string }).command ?? "");
        events.push({
          ...base,
          type: "COMMAND",
          summary: summarize(command),
          payload: {
            command,
            cwd: raw.cwd ? String(raw.cwd) : null,
            outputTruncated,
            exitCode: null,
            durationMs: null,
          },
          dedupeKey: hashDedupe("cmd", externalSessionId, command.slice(0, 200), String(ts)),
        });
        if (looksLikeTestCommand(command)) {
          events.push({
            ...base,
            type: "TEST",
            summary: summarize(`test: ${command}`),
            payload: { command, outputTruncated, framework: null, passed: null },
            dedupeKey: hashDedupe("test", externalSessionId, command.slice(0, 200), String(ts)),
            isDerived: true,
          });
        }
      }
      return events;
    }
    case "PostToolUseFailure": {
      const tool = toolName(raw);
      const message = String(raw.error ?? raw.message ?? "tool failure");
      return [
        {
          ...base,
          type: "ERROR",
          summary: summarize(`${tool}: ${message}`),
          payload: { message, failureType: "error", tool },
          dedupeKey: hashDedupe("err", externalSessionId, tool, message.slice(0, 80), String(ts)),
        },
      ];
    }
    case "Stop": {
      return [
        {
          ...base,
          type: "TASK_COMPLETED",
          summary: "agent run completed",
          payload: { status: "completed" },
          dedupeKey: hashDedupe("done", externalSessionId, String(ts)),
        },
      ];
    }
    case "StopFailure": {
      return [
        {
          ...base,
          type: "ERROR",
          summary: "agent stop failure",
          payload: {
            message: String(raw.error ?? "API/stop failure"),
            failureType: "stop_error",
            tool: null,
          },
          dedupeKey: hashDedupe("stop-err", externalSessionId, String(ts)),
        },
      ];
    }
    case "Notification":
    case "SessionStart":
    case "SessionEnd":
    case "SubagentStart":
    case "SubagentStop":
    case "PreCompact":
      if (eventName === "SubagentStart" || eventName === "SubagentStop") {
        return [
          {
            ...base,
            type: "TOOL_CALL",
            summary: summarize(`${eventName}`),
            payload: {
              tool: "Task",
              input: raw,
              outputTruncated: null,
              durationMs: null,
              toolUseId: null,
              phase: eventName === "SubagentStart" ? "start" : "end",
            },
            dedupeKey: hashDedupe(eventName, externalSessionId, String(ts)),
          },
        ];
      }
      return [];
    default:
      // Some Claude hooks put assistant text in MessageDisplay / similar — ignore unknown
      return [];
  }
}
