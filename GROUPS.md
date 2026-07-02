# BanterAgent — Multi-Group Architecture

## Overview

BanterAgent supports multiple WhatsApp groups from a single bot process.
Each group has its own configuration: prompt personality, available commands,
scheduled tasks, and bot modes.

All group configuration lives in one file: `src/group-config.ts`.
Adding a new group requires changes to **only two files** — `.env` and `group-config.ts`.

---

## Active Groups

### Group 1 — Main Tamil Banter Group
| Field | Value |
|-------|-------|
| Env var | `BOT_GROUP_ID` |
| JID | `120363399878677641@g.us` |
| Name | Banter Squad |
| Default mode | `nanban` |
| Available modes | `roast`, `nanban`, `peter` |
| Disabled commands | none |
| Disabled tasks | none |
| Prompt builder | `buildMainModePrompt()` |

**Modes:**
- `roast` — Savage Chennai humour, Tanglish, lovingly roasts members
- `nanban` — Warm supportive friend energy, no roasting
- `peter` — Broken Tamil-accented English, TEDx-in-WhatsApp energy

---

### Group 2 — IPL Fantasy Tamil Group
| Field | Value |
|-------|-------|
| Env var | `BOT_GROUP2_ID` |
| JID | `120363424669447247@g.us` |
| Name | Fantasy league🏏 |
| Default mode | `serious` |
| Available modes | `serious`, `roast` |
| Prompt builder | `buildIplModePrompt()` |

**Modes:**
- `serious` — Factual cricket bot. Scores, standings, stats only. No jokes.
- `roast` — Slightly vulgar cricket-only roasting (kuthu song energy). NO personal life jokes.

**Disabled commands:** `!ship`, `!dare`, `!gossip`, `!myinfo`, `!pushup`, `!fitboard`,
`!roastbattle`, `!astro`, `!dialect`, `!character`, `!wyr`, `!2t1l`

**Disabled tasks:** All admin/processing tasks (see below), plus horoscope, word-of-day,
history, movie-fact, finance-update, weekly-awards, weekend-prompt, monthly-recap,
weekly-score-reset, auto-game-drop, morning-roast, birthday-check.

**Enabled tasks:** cricket-alerts, fantasy-leaderboard, fantasy-prematch-1530,
fantasy-prematch-1930, fantasy-morning-winners, news-morning, reminders-check.

---

## Architecture

```
src/
├── prompts.ts        All prompt builder functions. No local imports.
│                     Add new group personalities here.
│
├── group-config.ts   REGISTRY of all groups + getGroupConfig() + getAllGroupIds().
│                     Add new group config entries here.
│
├── claude.ts         Imports from group-config. Uses config.buildPrompt(mode)
│                     for chat responses. Uses config.defaultMode for first load.
│
├── router.ts         Imports getGroupConfig. Filters disabled commands before
│                     routing. Mode command shows only the group's valid modes.
│
├── internal-server.ts  /run-task dispatches to ALL groups, filtered by
│                       config.disabledTasks for each group.
│
├── listener.ts       Allows messages from all group IDs in the registry.
│                     Handles additionalMessages for multi-part responses.
│
└── types.ts          CommandResult now includes additionalMessages for
                      chaining multiple messages (e.g. !welcome sequence).
```

---

## Task Routing

When pi-scheduler fires a task, `internal-server.ts` dispatches it to all
configured groups — unless the group has that task in its `disabledTasks` set.

### Admin/Processing Tasks (run exactly ONCE — disabled for all non-primary groups)
These tasks do backend work (no WhatsApp messages). Running them twice would cause
double processing, duplicate contest creation, etc.

| Task | Purpose |
|------|---------|
| `fantasy-enforce-deadlines` | Auto-advances match lifecycle (scheduled→open→locked→live) |
| `fantasy-sync-live` | Pulls live scores from Cricbuzz and updates player stats |
| `fantasy-schedule-sync` | Syncs upcoming match schedule from Cricbuzz |
| `fantasy-contest-create` | Creates daily fantasy contests for upcoming matches |

### Notification Tasks (run per-group — send WhatsApp messages)
These send messages to the group. Each group decides whether to receive them.

| Task | Sent to |
|------|---------|
| `fantasy-leaderboard` | Both groups |
| `fantasy-prematch-1530` | Both groups |
| `fantasy-prematch-1930` | Both groups |
| `fantasy-morning-winners` | Both groups |
| `cricket-alerts` | Both groups |
| `news-morning` | Both groups |
| `reminders-check` | Both groups |
| `horoscope` | Main group only |
| `morning-roast` | Main group only |
| `word-of-day` | Main group only |
| `history` / `movie-fact` | Main group only |
| `finance-update` | Main group only |
| `weekly-awards` | Main group only |

---

## Adding a New Group

1. **Add env var to `.env`:**
```
BOT_GROUP3_ID=120363xxxxxxxxxx@g.us
```

2. **Write a prompt builder in `src/prompts.ts`:**
```typescript
export function buildCollegeModePrompt(mode: string): string {
  switch (mode) {
    case "chill": return `You are...`;
    default:      return `You are...`;
  }
}
```

3. **Add config entry to `REGISTRY` in `src/group-config.ts`:**
```typescript
{
  groupId: resolveId("BOT_GROUP3_ID"),
  name: "College Batch Group",
  defaultMode: "chill",
  modes: {
    chill: { description: "😎 CHILL MODE — relaxed vibes" },
    roast: { description: "🔥 ROAST MODE — savage" },
  },
  disabledCommands: new Set(["pushup", "fitboard", "myinfo"]),
  disabledTasks: new Set([
    ...ADMIN_TASKS,        // always disable admin tasks for non-primary groups
    "horoscope",           // disable anything irrelevant
    "finance-update",
  ]),
  buildPrompt: buildCollegeModePrompt,
},
```

4. **Rebuild and restart:**
```bash
npm run build && pm2 restart banteragent --update-env
```

That's it. No other files need to change.

---

## Welcome Command

`!welcome` (or `!intro`) — sends a 5-part onboarding sequence explaining:
1. Bot intro and modes
2. How to play IPL fantasy
3. TATA IPL scoring rules
4. Bot commands reference
5. Games, settings, and bug reporting

---

## Notes

- Conversation history is per-group (`groupHistory` map in `claude.ts`, keyed by groupId)
- Bot mode is per-group, stored in `ba_group_settings` DB table, cached 30 min in memory
- Game archives (quiz questions used) are per-group, keyed by groupId
- `syncGroupMembers` in `index.ts` currently syncs only the primary group (`BOT_GROUP_ID`)
- `seedKnownCouples` runs only for the primary group (IPL group doesn't have couple profiles)
- `apply-fix` (bot self-update from !approve) sends error messages to primary group only
