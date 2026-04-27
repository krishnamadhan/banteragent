/**
 * monitor.ts — append-only event logger for 2-day evaluation
 *
 * Every event is one JSON line in /home/pi/logs/monitor.jsonl
 * No external deps, fire-and-forget writes, survives restarts.
 *
 * Event types:
 *   task_start / task_end  — scheduled task lifecycle
 *   claude                 — every Claude API call (tokens, cost, latency)
 *   api_call               — every outbound HTTP call (fantasy, cricbuzz, etc.)
 *   msg_sent               — bot sent a WhatsApp message
 *   group_msg              — user message received in group
 *   error                  — any caught exception
 */

import fs from "fs";

const LOG_FILE = "/home/pi/logs/monitor.jsonl";

// claude-sonnet-4-20250514 pricing (USD per million tokens)
const CLAUDE_PRICE = {
  input:        3.00,
  output:      15.00,
  cache_read:   0.30,
};

function write(obj: Record<string, unknown>): void {
  const line = JSON.stringify({ t: new Date().toISOString(), ...obj }) + "\n";
  fs.appendFile(LOG_FILE, line, () => {}); // non-blocking
}

// ── Task tracking ─────────────────────────────────────────────────────────────

const _taskStart = new Map<string, number>(); // task → start ms

export function monTaskStart(name: string): void {
  _taskStart.set(name, Date.now());
  write({ ev: "task_start", task: name });
}

export function monTaskEnd(
  name: string,
  result: { ok: boolean; sent: boolean; error?: string }
): void {
  const dur = Date.now() - (_taskStart.get(name) ?? Date.now());
  _taskStart.delete(name);
  write({ ev: "task_end", task: name, dur_ms: dur, ...result });
}

// ── Claude API tracking ───────────────────────────────────────────────────────

export function monClaude(opts: {
  type: string;
  task?: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens?: number;
  dur_ms: number;
  error?: string;
}): void {
  const cost_usd =
    (opts.input_tokens        / 1_000_000) * CLAUDE_PRICE.input  +
    (opts.output_tokens       / 1_000_000) * CLAUDE_PRICE.output +
    ((opts.cache_read_tokens ?? 0) / 1_000_000) * CLAUDE_PRICE.cache_read;

  write({
    ev: "claude",
    ...opts,
    cost_usd: +cost_usd.toFixed(6),
  });
}

// ── Outbound API call tracking ────────────────────────────────────────────────

export function monApiCall(opts: {
  svc: string;        // "fantasy" | "cricbuzz" | "news" | "finance" | ...
  path: string;
  method?: string;
  status?: number;
  dur_ms: number;
  error?: string;
  task?: string;
}): void {
  write({ ev: "api_call", method: "GET", ...opts });
}

// ── WhatsApp message sent ─────────────────────────────────────────────────────

export function monMsgSent(opts: {
  task: string;
  preview: string;   // first 80 chars
  chars: number;
}): void {
  write({ ev: "msg_sent", ...opts });
}

// ── Group message received ────────────────────────────────────────────────────

let _lastBotMsgAt = 0;

export function recordBotMsgTime(): void {
  _lastBotMsgAt = Date.now();
}

export function monGroupMsg(senderName: string, isCommand: boolean): void {
  const mins_after_bot = _lastBotMsgAt
    ? +((Date.now() - _lastBotMsgAt) / 60_000).toFixed(1)
    : null;
  write({ ev: "group_msg", sender: senderName, is_cmd: isCommand, mins_after_bot });
}

// ── Error tracking ────────────────────────────────────────────────────────────

export function monError(task: string, err: unknown): void {
  write({
    ev: "error",
    task,
    msg: err instanceof Error ? err.message : String(err),
  });
}
