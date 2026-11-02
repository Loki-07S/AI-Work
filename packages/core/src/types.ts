export const EVENT_TYPES = [
  "USER_PROMPT",
  "AGENT_RESPONSE",
  "TOOL_CALL",
  "FILE_READ",
  "FILE_EDIT",
  "COMMAND",
  "TEST",
  "ERROR",
  "DECISION",
  "TASK_COMPLETED",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const AGENTS = ["cursor", "claude_code"] as const;
export type AgentKind = (typeof AGENTS)[number];

export const TASK_STATUSES = ["open", "completed", "archived"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const RUN_STATUSES = ["running", "completed", "aborted", "error"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export type NormalizedEvent = {
  type: EventType;
  ts: number;
  agent: AgentKind;
  generationId?: string | null;
  parentEventId?: string | null;
  dedupeKey?: string | null;
  summary: string;
  payload: Record<string, unknown>;
  rawPayload?: unknown;
  isDerived?: boolean;
  externalSessionId: string;
  model?: string | null;
};

export type UserPromptPayload = {
  text: string;
  attachmentPaths: string[];
};

export type AgentResponsePayload = {
  text: string;
};

export type ToolCallPayload = {
  tool: string;
  input: unknown;
  outputTruncated?: string | null;
  durationMs?: number | null;
  toolUseId?: string | null;
  phase?: "start" | "end" | "failure";
};

export type FileReadPayload = {
  path: string;
  contentTruncated?: string | null;
  truncated: boolean;
};

export type FileEditPayload = {
  path: string;
  edits: Array<{ old: string; new: string }>;
};

export type CommandPayload = {
  command: string;
  cwd?: string | null;
  outputTruncated?: string | null;
  exitCode?: number | null;
  durationMs?: number | null;
};

export type TestPayload = CommandPayload & {
  framework?: string | null;
  passed?: boolean | null;
};

export type ErrorPayload = {
  message: string;
  failureType?: string | null;
  tool?: string | null;
};

export type DecisionPayload = {
  text: string;
  confidence?: number | null;
  sourceEventIds: string[];
};

export type TaskCompletedPayload = {
  status: "completed" | "aborted" | "error";
};
