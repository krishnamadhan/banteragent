import fs from "fs";

export type LogType = "chat" | "auto" | "structured" | "content" | "command" | "scheduled";

export interface LogEntry {
  ts: string;
  type: LogType;
  groupId?: string;
  mode?: string;
  sender?: string;
  command?: string;
  args?: string;
  // Claude API call
  systemPrompt?: string;
  history?: Array<{ role: string; content: string }>;
  prompt?: string;
  response?: string;
  inputTokens?: number;
  outputTokens?: number;
  // Auto-response
  silent?: boolean;
  recentMessages?: string[];
  // Meta
  durationMs?: number;
  error?: string;
}

const LOG_FILE = "/home/pi/logs/monitor.jsonl";

function writeMonitorLine(entry: LogEntry): void {
  const { ts, type, command, mode, error, durationMs, inputTokens, outputTokens } = entry;
  const line = JSON.stringify({
    t: ts,
    type,
    command,
    mode,
    error,
    durationMs,
    inputTokens,
    outputTokens,
  }) + "\n";
  fs.appendFile(LOG_FILE, line, () => {});
}

export function devlog(entry: Omit<LogEntry, "ts">): void {
  writeMonitorLine({ ts: new Date().toISOString(), ...entry });
}
