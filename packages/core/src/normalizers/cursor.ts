import type { NormalizedEvent } from "../types.js";
import {
  hashDedupe,
  looksLikeTestCommand,
  nowMs,
  summarize,
  truncate,
} from "../utils.js";

type CursorHookBase = {
  conversation_id?: string;
  generation_id?: string;
  model?: string;
  model_id?: string;
  hook_event_name?: string;
  workspace_roots?: string[];
  transcript_path?: string | null;
  [key: string]: unknown;
};

function cleanFilePath(p?: unknown): string {
  if (typeof p !== "string") return "";
  let s = p.trim();
  if (/^\/[a-zA-Z]:[\\\/]/.test(s)) {
    s = s.slice(1);
  }
  return s;
}

function sessionId(raw: CursorHookBase): string {
  return String(raw.conversation_id ?? raw.session_id ?? "unknown");
}

export function normalizeCursorHook(rawInput: unknown): NormalizedEvent[] {
  const raw = (rawInput ?? {}) as CursorHookBase;
  const eventName = String(raw.hook_event_name ?? "");
  const externalSessionId = sessionId(raw);
  const generationId = raw.generation_id ? String(raw.generation_id) : null;
  const model = raw.model_id ? String(raw.model_id) : raw.model ? String(raw.model) : null;
  const ts = nowMs();
  const base = {
    ts,
    agent: "cursor" as const,
    generationId,
    externalSessionId,
    model,
    rawPayload: raw,
  };

  switch (eventName) {
    case "beforeSubmitPrompt": {
      const prompt = String(raw.prompt ?? "");
      const attachments = Array.isArray(raw.attachments)
        ? (raw.attachments as Array<{ file_path?: string }>)
            .map((a) => a.file_path)
            .filter((p): p is string => Boolean(p))
        : [];
      return [
        {
          ...base,
          type: "USER_PROMPT",
          summary: summarize(prompt || "(empty prompt)"),
          payload: { text: prompt, attachmentPaths: attachments },
          dedupeKey: hashDedupe("up", externalSessionId, generationId, prompt.slice(0, 200)),
        },
      ];
    }
    case "afterAgentResponse": {
      const text = String(raw.text ?? "");
      return [
        {
          ...base,
          type: "AGENT_RESPONSE",
          summary: summarize(text || "(empty response)"),
          payload: { text },
          dedupeKey: hashDedupe("ar", externalSessionId, generationId, String(text.length)),
        },
      ];
    }
    case "afterAgentThought": {
      // Stored as AGENT_RESPONSE metadata-style TOOL_CALL-adjacent note via AGENT_RESPONSE with thought flag
      const text = String(raw.text ?? "");
      return [
        {
          ...base,
          type: "AGENT_RESPONSE",
          summary: summarize(`[thought] ${text}`),
          payload: { text, kind: "thought", durationMs: raw.duration_ms ?? null },
          dedupeKey: hashDedupe("th", externalSessionId, generationId, String(text.length)),
          isDerived: true,
        },
      ];
    }
    case "beforeReadFile": {
      const path = cleanFilePath(raw.file_path);
      const { text, truncated } = truncate(String(raw.content ?? ""), 8192);
      return [
        {
          ...base,
          type: "FILE_READ",
          summary: `read ${path}`,
          payload: { path, contentTruncated: text, truncated },
          dedupeKey: hashDedupe("fr", externalSessionId, generationId, path),
        },
      ];
    }
    case "afterFileEdit": {
      const path = cleanFilePath(raw.file_path);
      const edits = Array.isArray(raw.edits)
        ? (raw.edits as Array<{ old_string?: string; new_string?: string }>).map((e) => ({
            old: String(e.old_string ?? ""),
            new: String(e.new_string ?? ""),
          }))
        : [];
      return [
        {
          ...base,
          type: "FILE_EDIT",
          summary: `edit ${path} (${edits.length} hunk${edits.length === 1 ? "" : "s"})`,
          payload: { path, edits },
          dedupeKey: hashDedupe(
            "fe",
            externalSessionId,
            generationId,
            path,
            String(edits.length),
            edits[0]?.new?.slice(0, 80)
          ),
        },
      ];
    }
    case "afterShellExecution": {
      const command = String(raw.command ?? "");
      const { text: outputTruncated } = truncate(String(raw.output ?? ""), 8192);
      const events: NormalizedEvent[] = [
        {
          ...base,
          type: "COMMAND",
          summary: summarize(command),
          payload: {
            command,
            cwd: null,
            outputTruncated,
            exitCode: null,
            durationMs: typeof raw.duration === "number" ? raw.duration : null,
          },
          dedupeKey: hashDedupe("cmd", externalSessionId, generationId, command.slice(0, 200)),
        },
      ];
      if (looksLikeTestCommand(command)) {
        events.push({
          ...base,
          type: "TEST",
          summary: summarize(`test: ${command}`),
          payload: {
            command,
            outputTruncated,
            framework: null,
            passed: null,
          },
          dedupeKey: hashDedupe("test", externalSessionId, generationId, command.slice(0, 200)),
          isDerived: true,
        });
      }
      return events;
    }
    case "preToolUse": {
      const tool = String(raw.tool_name ?? "unknown");
      const toolUseId = raw.tool_use_id ? String(raw.tool_use_id) : null;
      // Prefer specialized hooks for Shell/Read/Write — still record generic TOOL_CALL
      if (tool === "Shell" || tool === "Read" || tool === "Write" || tool === "StrReplace") {
        return [
          {
            ...base,
            type: "TOOL_CALL",
            summary: summarize(`${tool} (start)`),
            payload: {
              tool,
              input: raw.tool_input ?? {},
              outputTruncated: null,
              durationMs: null,
              toolUseId,
              phase: "start",
            },
            dedupeKey: toolUseId
              ? hashDedupe("tc-start", toolUseId)
              : hashDedupe("tc-start", externalSessionId, generationId, tool, JSON.stringify(raw.tool_input ?? {}).slice(0, 100)),
          },
        ];
      }
      return [
        {
          ...base,
          type: "TOOL_CALL",
          summary: summarize(`${tool}`),
          payload: {
            tool,
            input: raw.tool_input ?? {},
            outputTruncated: null,
            durationMs: null,
            toolUseId,
            phase: "start",
          },
          dedupeKey: toolUseId
            ? hashDedupe("tc-start", toolUseId)
            : hashDedupe("tc-start", externalSessionId, generationId, tool),
        },
      ];
    }
    case "postToolUse": {
      const tool = String(raw.tool_name ?? "unknown");
      const toolUseId = raw.tool_use_id ? String(raw.tool_use_id) : null;
      const { text: outputTruncated } = truncate(String(raw.tool_output ?? ""), 8192);
      const events: NormalizedEvent[] = [
        {
          ...base,
          type: "TOOL_CALL",
          summary: summarize(`${tool} done`),
          payload: {
            tool,
            input: raw.tool_input ?? {},
            outputTruncated,
            durationMs: typeof raw.duration === "number" ? raw.duration : null,
            toolUseId,
            phase: "end",
          },
          dedupeKey: toolUseId
            ? hashDedupe("tc-end", toolUseId)
            : hashDedupe("tc-end", externalSessionId, generationId, tool),
        },
      ];
      // Shell also fires afterShellExecution — skip COMMAND duplicate from postToolUse
      if (tool === "Shell" && raw.tool_input && typeof raw.tool_input === "object") {
        const command = String((raw.tool_input as { command?: string }).command ?? "");
        if (command && looksLikeTestCommand(command)) {
          events.push({
            ...base,
            type: "TEST",
            summary: summarize(`test: ${command}`),
            payload: { command, outputTruncated, framework: null, passed: null },
            dedupeKey: hashDedupe("test", externalSessionId, generationId, command.slice(0, 200)),
            isDerived: true,
          });
        }
      }
      return events;
    }
    case "postToolUseFailure": {
      const tool = String(raw.tool_name ?? "unknown");
      const message = String(raw.error_message ?? "tool failure");
      return [
        {
          ...base,
          type: "ERROR",
          summary: summarize(`${tool}: ${message}`),
          payload: {
            message,
            failureType: raw.failure_type ? String(raw.failure_type) : null,
            tool,
          },
          dedupeKey: hashDedupe(
            "err",
            externalSessionId,
            generationId,
            tool,
            String(raw.tool_use_id ?? message.slice(0, 80))
          ),
        },
      ];
    }
    case "stop": {
      const status = String(raw.status ?? "completed") as "completed" | "aborted" | "error";
      const events: NormalizedEvent[] = [];
      if (status === "error") {
        events.push({
          ...base,
          type: "ERROR",
          summary: "agent stop with error",
          payload: { message: "Agent loop ended with error", failureType: "stop_error", tool: null },
          dedupeKey: hashDedupe("stop-err", externalSessionId, generationId),
        });
      }
      if (status === "completed") {
        events.push({
          ...base,
          type: "TASK_COMPLETED",
          summary: "agent run completed",
          payload: { status: "completed" },
          dedupeKey: hashDedupe("done", externalSessionId, generationId),
        });
      }
      return events;
    }
    case "subagentStart":
    case "subagentStop":
    case "sessionStart":
    case "sessionEnd":
    case "beforeShellExecution":
    case "beforeMCPExecution":
    case "afterMCPExecution":
    case "preCompact":
    case "workspaceOpen":
      // Lifecycle / duplicate / policy hooks — record lightly as TOOL_CALL metadata or skip
      if (eventName === "subagentStart" || eventName === "subagentStop") {
        return [
          {
            ...base,
            type: "TOOL_CALL",
            summary: summarize(`${eventName}: ${String(raw.task ?? raw.subagent_type ?? "")}`),
            payload: {
              tool: "Task",
              input: raw,
              outputTruncated: raw.summary ? String(raw.summary).slice(0, 2000) : null,
              durationMs: typeof raw.duration_ms === "number" ? raw.duration_ms : null,
              toolUseId: raw.subagent_id ? String(raw.subagent_id) : null,
              phase: eventName === "subagentStart" ? "start" : "end",
            },
            dedupeKey: hashDedupe(eventName, String(raw.subagent_id ?? generationId)),
          },
        ];
      }
      return [];
    default:
      return [];
  }
}
