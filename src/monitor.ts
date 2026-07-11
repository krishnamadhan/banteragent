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
import path from "path";

const LOG_FILE = "/home/pi/logs/monitor.jsonl";
const CLAUDE_USAGE_FILE = "/home/pi/banteragent/data/claude-usage.json";

// Anthropic pricing checked 2026-07-11:
// Haiku 4.5 $1/$5 MTok, Sonnet 4.6 $3/$15 MTok, 5m cache writes 1.25x input,
// cache reads 0.1x base input.
// Sonnet 5 introductory pricing is $2/$10 MTok through 2026-08-31, then $3/$15.
const CLAUDE_PRICES = {
  haiku: { input: 1.00, output: 5.00, cache_read: 0.10, cache_write: 1.25 },
  sonnet: { input: 3.00, output: 15.00, cache_read: 0.30, cache_write: 3.75 },
  sonnet5Intro: { input: 2.00, output: 10.00, cache_read: 0.20, cache_write: 2.50 },
};

export type ClaudeUsageDay = {
  date: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
};

export type ClaudeUsageSummary = {
  days: ClaudeUsageDay[];
  total: ClaudeUsageDay;
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
  model?: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
  dur_ms: number;
  error?: string;
}): void {
  const price = priceForModel(opts.model);
  const cost_usd =
    (opts.input_tokens / 1_000_000) * price.input +
    (opts.output_tokens / 1_000_000) * price.output +
    ((opts.cache_creation_tokens ?? 0) / 1_000_000) * price.cache_write +
    ((opts.cache_read_tokens ?? 0) / 1_000_000) * price.cache_read;

  recordClaudeUsage(opts, cost_usd);
  write({
    ev: "claude",
    ...opts,
    cost_usd: +cost_usd.toFixed(6),
  });
}

function priceForModel(model: string | undefined): { input: number; output: number; cache_read: number; cache_write: number } {
  const m = (model ?? "").toLowerCase();
  if (m.includes("haiku")) return CLAUDE_PRICES.haiku;
  if (m.includes("sonnet-5") || m.includes("sonnet-5-")) {
    const introEnds = Date.UTC(2026, 7, 31, 23, 59, 59);
    return Date.now() <= introEnds ? CLAUDE_PRICES.sonnet5Intro : CLAUDE_PRICES.sonnet;
  }
  return CLAUDE_PRICES.sonnet;
}

function istDate(offsetDays = 0): string {
  const d = Date.now() + 5.5 * 60 * 60 * 1000 - offsetDays * 86400_000;
  return new Date(d).toISOString().slice(0, 10);
}

function blankUsageDay(date: string): ClaudeUsageDay {
  return { date, calls: 0, input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0, cost_usd: 0 };
}

function normalizeUsageDay(date: string, row: Partial<ClaudeUsageDay> | undefined): ClaudeUsageDay {
  return {
    ...blankUsageDay(date),
    ...(row ?? {}),
    date,
    cache_creation_tokens: row?.cache_creation_tokens ?? 0,
    cache_read_tokens: row?.cache_read_tokens ?? 0,
  };
}

function readUsageFile(): Record<string, ClaudeUsageDay> {
  try {
    return JSON.parse(fs.readFileSync(CLAUDE_USAGE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function recordClaudeUsage(opts: { input_tokens: number; output_tokens: number; cache_creation_tokens?: number; cache_read_tokens?: number }, costUsd: number): void {
  try {
    fs.mkdirSync(path.dirname(CLAUDE_USAGE_FILE), { recursive: true });
    const usage = readUsageFile();
    const today = istDate();
    const day = normalizeUsageDay(today, usage[today]);
    day.calls += 1;
    day.input_tokens += opts.input_tokens;
    day.output_tokens += opts.output_tokens;
    day.cache_creation_tokens += opts.cache_creation_tokens ?? 0;
    day.cache_read_tokens += opts.cache_read_tokens ?? 0;
    day.cost_usd = +(day.cost_usd + costUsd).toFixed(6);
    usage[today] = day;

    const keep = new Set(Array.from({ length: 45 }, (_, i) => istDate(i)));
    for (const key of Object.keys(usage)) {
      if (!keep.has(key)) delete usage[key];
    }
    fs.writeFileSync(CLAUDE_USAGE_FILE, JSON.stringify(usage, null, 2));
  } catch {
    // Monitoring must never break bot responses.
  }
}

export function getClaudeUsageSummary(days = 1, endOffsetDays = 0): ClaudeUsageSummary {
  const n = Math.max(1, Math.min(Math.trunc(days) || 1, 30));
  const usage = readUsageFile();
  const dates = Array.from({ length: n }, (_, i) => istDate(endOffsetDays + n - 1 - i));
  const rows = dates.map((date) => normalizeUsageDay(date, usage[date]));
  const total = rows.reduce((acc, row) => ({
    date: rows.length === 1 ? row.date : `${rows[0]?.date}..${rows[rows.length - 1]?.date}`,
    calls: acc.calls + row.calls,
    input_tokens: acc.input_tokens + row.input_tokens,
    output_tokens: acc.output_tokens + row.output_tokens,
    cache_creation_tokens: acc.cache_creation_tokens + row.cache_creation_tokens,
    cache_read_tokens: acc.cache_read_tokens + row.cache_read_tokens,
    cost_usd: +(acc.cost_usd + row.cost_usd).toFixed(6),
  }), blankUsageDay(""));
  return { days: rows, total };
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
