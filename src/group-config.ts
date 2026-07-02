// src/group-config.ts
// Single source of truth for all group configurations.
//
// To add a new group:
//   1. Add BOT_GROUP_N_ID=<jid> to .env
//   2. Write a prompt builder in prompts.ts (or reuse one)
//   3. Add a config entry to REGISTRY below
//   Nothing else needs to change.
//
// Task routing notes:
//   "admin" tasks (fantasy-enforce-deadlines, fantasy-sync-live,
//   fantasy-schedule-sync, fantasy-contest-create) must run exactly ONCE
//   regardless of group count — they do backend processing, not messaging.
//   Keep these in disabledTasks for all groups except the first/primary group.
//
//   "notification" tasks (fantasy-leaderboard, fantasy-prematch-*,
//   fantasy-morning-winners) should run for every group that wants them.

import { readFileSync } from "fs";
import { buildMainModePrompt, buildIplModePrompt } from "./prompts.js";

function readEnvFile(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(new URL("../../.env", import.meta.url), "utf-8")
        .split("\n")
        .filter(l => l.includes("=") && !l.startsWith("#"))
        .map(l => { const [k, ...v] = l.split("="); return [k!.trim(), v.join("=").trim()]; })
    );
  } catch { return {}; }
}

function buildExpensesPrompt(_mode: string): string {
  return `You are a helpful, concise expense-tracking assistant for a couple's WhatsApp group.
Respond in plain English only. No Tanglish, no humor, no emojis unless confirming a log.
Be brief and accurate. Your job is to help track, analyse, and report shared expenses.`;
}

export interface GroupMode {
  description: string; // message shown when this mode is activated via !mode
}

export interface GroupConfig {
  groupId: string;
  name: string;
  defaultMode: string;
  modes: Record<string, GroupMode>;
  disabledCommands: Set<string>; // !commands silently ignored in this group
  disabledTasks: Set<string>;    // scheduled tasks NOT dispatched to this group
  buildPrompt: (mode: string) => string;
  isExpenseGroup?: boolean;       // expense tracker group — different routing
  isConstructionGroup?: boolean;  // construction project fund tracker
}

function resolveId(envKey: string): string {
  return (process.env[envKey] ?? "").trim();
}

// Tasks that do backend processing — must run exactly once (only from primary group)
const ADMIN_TASKS = new Set([
  "fantasy-enforce-deadlines",
  "fantasy-sync-live",
  "fantasy-schedule-sync",
  "fantasy-contest-create",
]);

const REGISTRY: GroupConfig[] = [

  // ── Main Tamil Banter Group ───────────────────────────────────────────────────
  {
    groupId: resolveId("BOT_GROUP_ID"),
    name: "Main Tamil Group",
    defaultMode: "nanban",
    modes: {
      roast:   { description: "🔥 ROAST MODE — Default. Savage lovingly." },
      nanban:  { description: "🤝 NANBAN MODE — Warm nanban energy. Pure support, zero roast." },
      peter:   { description: "🎓 PETER MODE — Broken English, over-explains everything, very much sophisticated itself." },
      rcb_fan: { description: "🔴 RCB FAN MODE — Unhinged superstitious RCB fan energy. Finals day only." },
    },
    disabledCommands: new Set<string>(),
    disabledTasks:    new Set<string>(["horoscope"]),
    buildPrompt: buildMainModePrompt,
  },

  // ── IPL Fantasy Tamil Group ───────────────────────────────────────────────────
  {
    groupId: resolveId("BOT_GROUP2_ID"),
    name: "IPL Tamil Group",
    defaultMode: "serious",
    modes: {
      serious: { description: "📋 SERIOUS MODE — Clean cricket. Just the facts." },
      roast:   { description: "🔥 ROAST MODE — IPL roast mode. Slight vulgarity, cricket only." },
    },
    disabledCommands: new Set<string>([
      "ship", "dare", "gossip", "myinfo", "pushup", "fitboard",
      "roastbattle", "rb", "astro", "astromatch", "dialect",
      "character", "charsort", "wyr", "2t1l", "twotruthsonelie",
    ]),
    disabledTasks: new Set<string>([
      // Admin/processing tasks — run once from main group only
      ...ADMIN_TASKS,
      // Non-cricket content
      "horoscope",
      "word-of-day",
      "history",
      "movie-fact",
      "finance-update",
      "weekly-awards",      // quiz game leaderboard
      "weekend-prompt",
      "monthly-recap",
      "weekly-score-reset", // quiz score reset
      "auto-game-drop",     // quiz game auto-drop
      "morning-roast",      // general banter, not cricket-specific
      "birthday-check",     // profiles not set up for this group
    ]),
    buildPrompt: buildIplModePrompt,
  },

  // ── Inuma Expenses Tracker ────────────────────────────────────────────────────
  {
    groupId: resolveId("BOT_EXPENSES_GROUP_ID"),
    name: "Inuma Expenses",
    defaultMode: "default",
    modes: {
      default: { description: "Expense tracking mode." },
    },
    isExpenseGroup: true,
    disabledCommands: new Set<string>(),
    disabledTasks: new Set<string>([
      ...ADMIN_TASKS,
      "horoscope", "word-of-day", "history", "movie-fact", "finance-update",
      "weekly-awards", "weekend-prompt", "monthly-recap", "weekly-score-reset",
      "auto-game-drop", "morning-roast", "birthday-check", "news-morning",
      "fantasy-leaderboard", "fantasy-prematch-1530", "fantasy-prematch-1930",
      "fantasy-morning-winners", "cricket-alerts", "reminders-check",
    ]),
    buildPrompt: buildExpensesPrompt,
  },

  // ── Tiruvannamalai Construction Project ───────────────────────────────────────
  {
    groupId: resolveId("BOT_CONSTRUCTION_GROUP_ID"),
    name: "Construction Tracker",
    defaultMode: "default",
    modes: {
      default: { description: "Construction fund tracker." },
    },
    isConstructionGroup: true,
    disabledCommands: new Set<string>(),
    disabledTasks: new Set<string>([
      ...ADMIN_TASKS,
      "horoscope", "word-of-day", "history", "movie-fact", "finance-update",
      "weekly-awards", "weekend-prompt", "monthly-recap", "weekly-score-reset",
      "auto-game-drop", "morning-roast", "birthday-check", "news-morning",
      "fantasy-leaderboard", "fantasy-prematch-1530", "fantasy-prematch-1930",
      "fantasy-morning-winners", "cricket-alerts", "reminders-check",
    ]),
    buildPrompt: () => "You are a construction project fund tracker assistant. Be brief and accurate.",
  },

];

// Fallback for unknown groups — uses main group behaviour, no restrictions
const FALLBACK: GroupConfig = { ...REGISTRY[0], groupId: "", name: "Unknown Group" };

export function getGroupConfig(groupId: string): GroupConfig {
  // Patch group IDs that were empty at startup — read live from .env so bot picks them
  // up without a restart (e.g. construction group added after bot was already running).
  const live = readEnvFile();
  for (const cfg of REGISTRY) {
    if (!cfg.groupId && cfg.isConstructionGroup) {
      cfg.groupId = live["BOT_CONSTRUCTION_GROUP_ID"] ?? "";
    }
    if (!cfg.groupId && cfg.isExpenseGroup) {
      cfg.groupId = live["BOT_EXPENSES_GROUP_ID"] ?? "";
    }
  }
  return REGISTRY.find(c => c.groupId && c.groupId === groupId) ?? FALLBACK;
}

// Returns all configured group JIDs (non-empty only).
// Reads live .env for groups that were empty at startup.
export function getAllGroupIds(): string[] {
  const live = readEnvFile();
  for (const cfg of REGISTRY) {
    if (!cfg.groupId && cfg.isConstructionGroup) cfg.groupId = live["BOT_CONSTRUCTION_GROUP_ID"] ?? "";
    if (!cfg.groupId && cfg.isExpenseGroup)     cfg.groupId = live["BOT_EXPENSES_GROUP_ID"]     ?? "";
  }
  return REGISTRY.map(c => c.groupId).filter(Boolean);
}
