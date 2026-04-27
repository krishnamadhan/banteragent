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

import { buildMainModePrompt, buildIplModePrompt } from "./prompts.js";

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
      roast:  { description: "🔥 ROAST MODE — Default. Savage lovingly." },
      nanban: { description: "🤝 NANBAN MODE — Warm nanban energy. Pure support, zero roast." },
      peter:  { description: "🎓 PETER MODE — Broken English, over-explains everything, very much sophisticated itself." },
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

];

// Fallback for unknown groups — uses main group behaviour, no restrictions
const FALLBACK: GroupConfig = { ...REGISTRY[0], groupId: "", name: "Unknown Group" };

export function getGroupConfig(groupId: string): GroupConfig {
  return REGISTRY.find(c => c.groupId && c.groupId === groupId) ?? FALLBACK;
}

// Returns all configured group JIDs (non-empty only)
export function getAllGroupIds(): string[] {
  return REGISTRY.map(c => c.groupId).filter(Boolean);
}
