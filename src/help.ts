type HelpSection = {
  heading: string;
  lines: string[];
};

function renderHelp(title: string, sections: HelpSection[]): string {
  const parts: string[] = [title, "━━━━━━━━━━━━━━━━━━━━━━━━"];
  for (const section of sections) {
    parts.push("", section.heading);
    for (const line of section.lines) parts.push(line);
  }
  return parts.join("\n");
}

const PUBLIC_SECTIONS: HelpSection[] = [
  {
    heading: "💬 *Chat:*",
    lines: ["dei claude <message>"],
  },
  {
    heading: "🎮 *Games:*",
    lines: [
      "  !quiz — Tamil movie emoji quiz",
      "  !trivia — Tamil Nadu trivia",
      "  !brandquiz / !logoquiz — Guess the Indian brand",
      "  !fastfinger (!ff) — First to type the word wins",
      "  !wordle — Squad Wordle (5-letter, crack it together)",
      "  !w <word> — Wordle guess",
      "  !anagram / !scramble — Unscramble, first correct wins",
      "  !hangman — Co-op letter guessing",
      "  !detective — Solve the petty crime",
      "  !battle / !vs — VS battle",
      "  !top10 / !blindrank — Blind ranking",
      "  !next — Next round / next prompt",
      "  !skip / !abandon — Skip active game",
      "  !a / !answer — Answer the active game",
      "  !score [alltime] — Leaderboard",
    ],
  },
  {
    heading: "🏏 *Cricket:*",
    lines: [
      "  !cricket — Live scores",
      "  !cricket alerts on/off",
    ],
  },
  {
    heading: "📊 *Polls:*",
    lines: [
      "  !poll <question>",
      "  !vote <number>",
    ],
  },
  {
    heading: "🏆 *Analytics:*",
    lines: [
      "  !stats — Group stats",
      "  !awards — Funny awards",
      "  !top — Most active",
      "  !lurkers — Expose lurkers",
    ],
  },
  {
    heading: "⏰ *Reminders:*",
    lines: [
      "  !remind me <task> at <time>",
      "  !remind group <task> at <time>",
      "  !reminders — List reminders",
    ],
  },
  {
    heading: "👤 *Profile:*",
    lines: [
      "  !myinfo nick Machan",
      "  !myinfo gender male",
      "  !myinfo zodiac scorpio",
      "  !myinfo birthday July 15",
      "  !myinfo job software engineer",
      "  !myinfo partner Priya",
      "  !myinfo show",
    ],
  },
  {
    heading: "🏆 *Fantasy:*",
    lines: [
      "  !fantasy — Fantasy contest commands",
      "  !f11 — Fantasy shortcut",
      "  !fl — Fantasy leaderboard shortcut",
      "  !win — Ranking leaderboard / gift challenge",
    ],
  },
  {
    heading: "🎯 *Solli Adi:*",
    lines: [
      "  !solli / !solliadi — Start prediction for next over",
      "  !predict / !p <runs> — Submit your guess",
      "  !solli lb — Leaderboard",
      "  !predict status / !predict s — Current round status",
    ],
  },
  {
    heading: "🎉 *Fun:*",
    lines: [
      "  !roast <name> — Savage roast",
      "  !praise <name> — Hype someone up",
      "  !ship Name1 Name2 — Love compatibility",
      "  !dare — Get a dare",
      "  !debate / !hottake — Hot take to spark argument",
      "  !gossip — Fake group gossip",
      "  !movie [mood/name] — Movie rec or info card",
      "  !trailer <movie> — Movie trailer reaction",
      "  !rank <topic> — Opinionated rankings for debate",
      "  !imagine <scenario> — AI scenario generator",
      "  !character / !charsort <movie> — Assign movie characters",
      "  !astro / !astromatch Rasi1 Rasi2 — Tamil rasi compatibility",
      "  !dialect [region] <text> — Regional dialect translator",
      "  !translate / !trans <text> — Tamil <-> English",
      "  !recipe <dish or ingredients> — Tamil recipe",
      "  !vibecheck / !vibe — Group mood analysis",
      "  !summary / !summarize / !catchup — Catch up on missed messages",
      "  !roastbattle / !rb PersonA vs PersonB — Epic roast battle",
      "  !roastmetaai / !roast_metaai / !mockmetaai — Mock Meta AI",
    ],
  },
  {
    heading: "🎲 *Instant:*",
    lines: [
      "  !toss [heads/tails] — Coin flip",
      "  !split <amount> <people> — Bill splitter",
      "  !8ball <question> — Magic 8 ball",
      "  !countdown / !cd (list / create <name> YYYY-MM-DD) — Event countdown",
    ],
  },
  {
    heading: "💬 *Quotes:*",
    lines: [
      "  !quoteme / !savequote <name> said \"<quote>\" — Save a group quote",
      "  !quote [name] — Random saved quote",
      "  !quoteboard — Most quoted members",
    ],
  },
  {
    heading: "📰 *News:*",
    lines: [
      "  !news — Hot news digest (cricket, movies, India)",
      "  !news ipl — IPL updates only",
      "  !news cricket — Cricket only",
      "  !news movies — Kollywood & entertainment",
      "  !news tech — Technology",
      "  !news india — India headlines",
    ],
  },
  {
    heading: "💪 *Fitness:*",
    lines: [
      "  !pushup — How to submit a pushup video",
      "  !fitboard — Weekly fitness leaderboard",
    ],
  },
  {
    heading: "⚙️ *Settings:*",
    lines: [
      "  !mode roast / nanban / peter / paati",
      "  !mute — Mute bot for 1 hour",
      "  !unmute — Resume bot",
    ],
  },
  {
    heading: "🐛 *Feedback:*",
    lines: [
      "  !bug <description> — Report a bug or issue",
      "  !gamestats — Game archive stats",
    ],
  },
];

const OWNER_SECTIONS: HelpSection[] = [
  {
    heading: "🛠️ *Owner / Admin:*",
    lines: [
      "  !refreshgames — Archive stats / add / all / reset",
      "  !gamecheck <game> [quarantine] — Pool integrity check",
      "  !approve / !reject — Pending fix workflow",
      "  !led <colour|off|on|bright|tv|calibrate|scene|status> — LED strip + Wipro bulb",
      "  !led bulb <colour|R G B|bright N|on|off> — Wipro bulb only",
      "  !cosmo ... — Robot live/feed/status tools",
      "  !pi / !pi help — Pi monitor/admin command tree",
    ],
  },
];

export function renderMainHelp(isOwner: boolean): string {
  const sections = isOwner ? [...PUBLIC_SECTIONS, ...OWNER_SECTIONS] : PUBLIC_SECTIONS;
  return renderHelp(`🤖 *TanglishBot Commands*`, sections);
}

export function renderPiHelp(): string {
  return renderHelp(`*Pi Admin Commands*`, [
    {
      heading: "💚 *Health / checks:*",
      lines: [
        "  !pi health / !pi check / !pi checks — One-shot traffic-light check",
        "  !pi selfcheck / !pi sc — Deep validation",
        "  !pi drift — Docs-freshness + board<->repo sync check",
        "  !pi status — Full system report",
      ],
    },
    {
      heading: "🤖 *Cosmo / LED:*",
      lines: [
        "  !pi led — Cosmo API + LED strip health",
        "  !pi cosmo [n] — Last N Cosmo reactions",
      ],
    },
    {
      heading: "💾 *Backups / system:*",
      lines: [
        "  !pi backup [now] — Nightly backup status / trigger",
        "  !pi cost [days] — AI token spend estimate",
        "  !pi top — Top processes by RAM",
        "  !pi temp / battery / disk / network / uptime",
        "  !pi logs [n] — Last N log lines",
        "  !pi errors — Recent error logs",
      ],
    },
    {
      heading: "🏗️ *Owner / admin:*",
      lines: [
        "  !refreshgames — Archive stats / add <game> [N] / all [N] / reset",
        "  !gamestats — Game archive stats",
        "  !gamecheck <game> [quarantine] — Pool integrity check",
      ],
    },
    {
      heading: "⚠️ *Danger zone:*",
      lines: [
        "  !pi restart bot — Restart BanterAgent (asks confirm)",
        "  !pi restart pi — Reboot Pi (asks confirm)",
        "  !pi update bot — Git pull + build (restart on confirm)",
        "  !pi clean — Safe cleanup (logs + cache)",
        "  !pi confirm restart / reboot — Continue a pending action",
      ],
    },
  ]);
}
