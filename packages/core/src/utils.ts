import { ulid } from "ulid";

export function newId(): string {
  return ulid();
}

export function nowMs(): number {
  return Date.now();
}

export function truncate(text: string | null | undefined, max = 8192): {
  text: string | null;
  truncated: boolean;
} {
  if (text == null) return { text: null, truncated: false };
  if (text.length <= max) return { text, truncated: false };
  return { text: text.slice(0, max) + "\n…[truncated]", truncated: true };
}

export function summarize(text: string, max = 120): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 1) + "…";
}

const TEST_PATTERNS = [
  /\bnpm\s+(test|run\s+test)\b/i,
  /\bpnpm\s+(test|run\s+test)\b/i,
  /\byarn\s+test\b/i,
  /\bvitest\b/i,
  /\bjest\b/i,
  /\bpytest\b/i,
  /\bgo\s+test\b/i,
  /\bcargo\s+test\b/i,
  /\bmocha\b/i,
  /\bplaywright\s+test\b/i,
];

export function looksLikeTestCommand(command: string): boolean {
  return TEST_PATTERNS.some((re) => re.test(command));
}

export function hashDedupe(...parts: Array<string | null | undefined>): string {
  const raw = parts.filter(Boolean).join("|");
  let h = 0;
  for (let i = 0; i < raw.length; i++) {
    h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0;
  }
  return `d${(h >>> 0).toString(16)}`;
}
