import type { BotMessage, CommandResult } from "./types.js";
import { getChatResponse, setGroupMode, generateContent } from "./claude.js";
import { getGroupConfig } from "./group-config.js";
import { handleGameCommand, clearGroupArchive, getArchiveStats } from "./features/games.js";
import { handleCricketCommand } from "./features/cricket.js";
import { handlePollCommand } from "./features/polls.js";
import { handleStatsCommand } from "./features/analytics.js";
import { handleReminderCommand } from "./features/reminders.js";
import { supabase } from "./supabase.js";
import { handleProfileCommand } from "./features/profiles.js";
import {
  handleMovie, handleShip, handleDare, handleDebate,
  handleGossip, handle8Ball, handleToss, handleSplit, handleSummary,
  handleRank, handleTranslate, handleVibeCheck, handleImagine, handleDialect,
  handleAstroMatch, handleRecipe, handleTrailer, handleCharacterSorter,
  handleRoastBattle, handleCountdown,
} from "./features/fun.js";
import { handleNews } from "./features/news.js";
import { handleBugReport } from "./features/bugs.js";
import { devlog } from "./devlog.js";
import { invalidateGroupSettingsCache } from "./group-settings-cache.js";
import { handleFitboard, handlePushupNoVideo } from "./features/fitness.js";
import { handlePiAdminMessage } from "./pi-admin.js";
import { handleQuoteCommand } from "./features/quotes.js";
import { handleFantasyCommand } from "./features/fantasy.js";
import { handleSolliAdiTrigger, handleSolliAdiPredict, handleSolliAdiStatus, handleSolliAdiLeaderboard } from "./features/solli-adi.js";

function parseCommand(text: string): { command: string; args: string } {
  if (!text.startsWith("!")) return { command: "chat", args: text };

  const parts = text.slice(1).trim().split(/\s+/);
  const command = (parts[0] ?? "").toLowerCase();
  const args = parts.slice(1).join(" ");

  return { command, args };
}

const _refreshConfirmPending = new Map<string, number>(); // groupId => ts

export async function routeMessage(msg: BotMessage, recentMessages: string[] = []): Promise<CommandResult> {
  const { command, args } = parseCommand(msg.text);

  if (command !== "chat") {
    devlog({ type: "command", command, args, groupId: msg.groupId, sender: msg.senderName });
  }

  // Per-group command filtering — silently ignore disabled commands
  const groupConfig = getGroupConfig(msg.groupId);
  if (command !== "chat" && groupConfig.disabledCommands.has(command)) {
    return { response: "" };
  }

  switch (command) {
    case "h":   // short alias for !help
    case "help":
      return {
        response: `🤖 *TanglishBot Commands*

💬 *Chat:* dei claude <message>
🎮 *Games:*
  !quiz — Tamil movie emoji quiz
  !brandquiz — Guess the Indian brand
  !dialogue — Guess movie from dialogue
  !song — Guess Tamil song from English lyrics
  !wordle — Group Wordle (Tamil movie titles!)
  !w <word> — Submit a Wordle guess
  !memory — Memorize & recall word sequence
  !songlyric — Complete the song lyric
  !riddle — Tamil riddle
  !fastfinger (!ff) — First to type wins!
  !mostlikely (!ml) — Most likely to... vote
  !tamilproverb (!proverb) — Guess the proverb meaning
  !storytime (!story) — Collaborative story
  !wyr — Would You Rather
  !wordchain — Word chain game
  !antakshari — Antakshari
  !trivia — Tamil Nadu trivia
  !2t1l — 2 Truths, 1 Lie
  !a — Answer any active game
  !score — Weekly leaderboard
  !score alltime — All-time leaderboard

🏏 *Cricket:*
  !cricket — Live scores
  !cricket alerts on/off

📊 *Polls:*
  !poll <question>
  !vote <number>

🏆 *Analytics:*
  !stats — Group stats
  !awards — Funny awards
  !top — Most active
  !lurkers — Expose lurkers

⏰ *Reminders:*
  !remind me <task> at <time>
  !remind group <task> at <time>
  !reminders — List reminders

👤 *Profile:*
  !myinfo nick Machan
  !myinfo gender male
  !myinfo zodiac scorpio
  !myinfo birthday July 15
  !myinfo job software engineer
  !myinfo partner Priya
  !myinfo show

🎉 *Fun:*
  !roast <name> — Savage roast
  !roastbattle (!rb) PersonA vs PersonB — Epic roast battle
  !roastmetaai — Mock that useless Meta AI
  !praise <name> — Hype someone up
  !ship Name1 Name2 — Love compatibility
  !dare — Get a dare
  !debate — Hot take to spark argument
  !gossip — Fake group gossip
  !movie [mood/name] — Movie rec or info card
  !trailer <movie> — Movie trailer reaction
  !rank <topic> — Opinionated rankings for debate
  !imagine <scenario> — AI scenario generator
  !character <movie> — Assign movie characters to members
  !astro Rasi1 Rasi2 — Tamil rasi compatibility
  !dialect [region] <text> — Regional dialect translator
  !translate <text> — Tamil ↔ English
  !recipe <dish or ingredients> — Tamil recipe
  !vibecheck — Group mood analysis
  !summary (!summarize / !catchup) — Catchup on missed messages

🎲 *Instant:*
  !toss [heads/tails] — Coin flip
  !split <amount> <people> — Bill splitter
  !8ball <question> — Magic 8 ball
  !countdown (list / create <name> YYYY-MM-DD) — Event countdown

💬 *Quotes:*
  !quoteme <name> said "<quote>" — Save a group quote
  !quote [name] — Random saved quote
  !quoteboard — Most quoted members

📰 *News:*
  !news — Hot news digest (cricket, movies, India)
  !news ipl — IPL updates only
  !news cricket — Cricket only
  !news movies — Kollywood & entertainment
  !news tech — Technology
  !news india — India headlines

💪 *Fitness:*
  !pushup — How to submit a pushup video
  !fitboard — Weekly fitness leaderboard

⚙️ *Settings:*
  !mode roast / nanban / peter
  !mute — Mute bot for 1 hour
  !unmute — Resume bot

🏏 *IPL Fantasy:*
  !fantasy join — Join group fantasy contest
  !fantasy lb (!fl) — Live leaderboard
  !fantasy stats — Top scorer points
  !fantasy score <player> — Specific player stats
  !fantasy xi — Playing XI (after toss)
  !fantasy help — Full fantasy help

🐛 *Feedback:*
  !bug <description> — Report a bug or issue
  !refreshgames — View archive stats + reset (owner only)\n!gamestats — View game archive stats`,
      };

    // Games
    case "quiz":
    case "brandquiz":
    case "logoquiz":
    case "dialogue":
    case "song":
    case "wordle":
    case "songlyric":
    case "wyr":
    case "wordchain":
    case "antakshari":
    case "trivia":
    case "riddle":
    case "fastfinger":
    case "ff":
    case "mostlikely":
    case "ml":
    case "tamilproverb":
    case "proverb":
    case "storytime":
    case "story":
    case "twotruthsonelie":
    case "2t1l":
    case "memory":
    case "score":
      return handleGameCommand(command, args, msg);

    case "w":  // Wordle guess: !w <word>
      return handleGameCommand("wordle_guess", args, msg);

    case "a":      // short alias for !answer
    case "answer":
      return handleGameCommand("answer", args, msg);

    // Cricket
    case "cricket":
      return handleCricketCommand(args, msg);

    // Polls
    case "poll":
    case "vote":
      return handlePollCommand(command, args, msg);

    // Analytics
    case "stats":
    case "awards":
    case "top":
    case "lurkers":
      return handleStatsCommand(command, msg);

    // Reminders
    case "remind":
    case "reminders":
      return handleReminderCommand(command, args, msg);

    // Mode change
    case "mode": {
      const validModes = Object.fromEntries(
        Object.entries(groupConfig.modes).map(([k, v]) => [k, v.description])
      );
      const modeList = Object.keys(validModes).map(m => "!mode " + m).join(" / ");
      const picked = args.trim().toLowerCase();
      if (!picked) {
        const current = await (await import("./claude.js")).getGroupMode(msg.groupId);
        return { response: `Current mode: *${current}*

Change: ${modeList}` };
      }
      if (!validModes[picked]) {
        return {
          response: `Valid modes: ${modeList}`,
        };
      }
      setGroupMode(msg.groupId, picked);
      const { error: modeErr } = await supabase.from("ba_group_settings").upsert({
        group_id: msg.groupId,
        bot_mode: picked,
        updated_at: new Date().toISOString(),
      });
      if (modeErr) console.error("[mode] Failed to save mode to DB:", modeErr.message);
      return { response: validModes[picked] };
    }

    // Mute / Unmute
    case "mute":
    case "unmute": {
      const muted = command === "mute";
      await supabase.from("ba_group_settings").upsert({
        group_id: msg.groupId,
        muted,
        updated_at: new Date().toISOString(),
      });
      invalidateGroupSettingsCache(msg.groupId); // fresh state on very next message
      return {
        response: muted
          ? "🔇 Seri da, mute pannitten. !unmute sollinaale tirupen."
          : "🔊 Ennoda thadai neenga! Back-aa vaanden 🎉",
      };
    }

    // Profile
    case "myinfo":
      return { response: await handleProfileCommand(args, msg) };

    // Fun — new commands
    case "rank":
      return { response: await handleRank(args) };
    case "translate":
    case "trans":
      return { response: await handleTranslate(args) };
    case "vibecheck":
    case "vibe":
      return { response: await handleVibeCheck() };
    case "imagine":
      return { response: await handleImagine(args) };
    case "dialect":
      return { response: await handleDialect(args) };
    case "astro":
    case "astromatch":
      return { response: await handleAstroMatch(args) };
    case "recipe":
      return { response: await handleRecipe(args) };
    case "trailer":
      return { response: await handleTrailer(args) };
    case "character":
    case "charsort":
      return { response: await handleCharacterSorter(args, msg) };
    case "roastbattle":
    case "rb":
      return { response: await handleRoastBattle(args) };
    case "countdown":
    case "cd":
      return { response: handleCountdown(args, msg) };

    // Quote system
    case "quoteme":
    case "savequote":
    case "quote":
    case "quoteboard":
      return { response: handleQuoteCommand(command, args, msg) };

    // Fun
    case "movie":
      return { response: await handleMovie(args, msg) };
    case "ship":
      return { response: await handleShip(args, msg) };
    case "dare":
      return { response: await handleDare(msg) };
    case "debate":
    case "hottake":
      return { response: await handleDebate(msg) };
    case "gossip":
      return { response: await handleGossip(msg) };

    // Summary / Catchup
    case "summarize":
    case "summary":
    case "catchup":
      return { response: await handleSummary(msg.groupId) };

    // News
    case "news":
      return { response: await handleNews(args, msg) };

    // Fitness
    case "pushup":
      // Video submissions are intercepted in listener.ts before reaching here.
      // Reaching here means !pushup was sent as plain text (no video attached).
      return { response: handlePushupNoVideo() };
    case "fitboard":
      return { response: await handleFitboard(msg) };

    // Instant utilities (no Claude)
    case "toss":
      return { response: handleToss(args) };
    case "split":
      return { response: handleSplit(args) };
    case "8ball":
      return { response: handle8Ball(args) };

    // Roast Meta AI
    case "roastmetaai":
    case "roast_metaai":
    case "mockmetaai": {
      const metaJid = process.env.META_AI_JID?.trim();
      const roastText = await generateContent(
        `Write a fresh, creative Tanglish roast of Meta AI — the useless AI inside WhatsApp that keeps saying "Vibe aachu?", responds in Hindi to Tamil people, echoes back exactly what you said, hedges everything ("It depends... I cannot say for sure..."), gives Wikipedia intros nobody asked for, and thinks it's being helpful. Each time make it different and specific — pick ONE thing to roast deeply rather than listing everything. Make it sound genuinely dumb. 4–5 lines, Tanglish, savage. No intro, jump straight into the roast.`
      );
      // Prepend @tag so Meta AI sees the mention and responds (for the lols)
      const tag = metaJid ? `@${metaJid.replace("@c.us", "")} ` : "";
      return {
        response: tag + roastText,
        mentions: metaJid ? [metaJid] : undefined,
      };
    }

    // Roast
    case "roast":
      return {
        response: await getChatResponse(
          msg.groupId,
          msg.senderName,
          `Roast ${args || msg.senderName} savagely in Tanglish. Start DIRECTLY with the roast — do NOT acknowledge ${msg.senderName} or explain what you're about to do. Just roast. Be specific and creative.`
        ),
      };

    // Praise
    case "praise":
      return {
        response: await getChatResponse(
          msg.groupId,
          msg.senderName,
          `Praise ${args || msg.senderName} warmly and genuinely in Tanglish. Start DIRECTLY with the praise — do NOT say "Dei [sender]" or acknowledge ${msg.senderName} first. Go straight to celebrating ${args || msg.senderName}. Be specific, heartfelt, and make them feel like a legend.`
        ),
      };

    // Bug approve/reject
    case "approve": {
      const pendingPath = "/home/pi/banteragent/pending-fix.md";
      const { existsSync } = await import("fs");
      if (!existsSync(pendingPath)) return { response: "No pending fix to approve da 🤷" };
      fetch("http://127.0.0.1:3099/apply-fix", { method: "POST" }).catch(console.error);
      return { response: "✅ Fix approved! Applying now — bot will restart in ~30s..." };
    }
    case "reject": {
      const { unlinkSync, existsSync: exists2 } = await import("fs");
      if (!exists2("/home/pi/banteragent/pending-fix.md")) return { response: "No pending fix da 🤷" };
      unlinkSync("/home/pi/banteragent/pending-fix.md");
      return { response: "❌ Fix rejected and cleared. Bug stays open for manual review." };
    }

    // Bug report
    case "refreshgames":
    case "resetgames": {
      const ownerPhone = process.env.BOT_OWNER_PHONE;
      const senderJid = msg.from;
      const isOwner = ownerPhone && senderJid.startsWith(ownerPhone.replace("@c.us", "").replace("@s.whatsapp.net", ""));
      if (!isOwner) return { response: "Only group admin can use !refreshgames da 😤" };
      const confirmArg = args[0]?.toLowerCase();
      if (confirmArg === "confirm") {
        const pending = _refreshConfirmPending.get(msg.groupId);
        if (!pending || Date.now() - pending > 60_000) {
          return { response: "Confirm window expired. Send *!refreshgames* again to start." };
        }
        _refreshConfirmPending.delete(msg.groupId);
        await clearGroupArchive(msg.groupId);
        return { response: "✅ Game archive cleared! All games are fresh. Let's play! 🎮" };
      }
      const stats = getArchiveStats(msg.groupId);
      _refreshConfirmPending.set(msg.groupId, Date.now());
      const statLines = stats.filter(s => s.used > 0).map(s => `  ${s.type}: ${s.used}/${s.total} used`);
      const totalUsed = stats.reduce((n, s) => n + s.used, 0);
      const statsBlock = statLines.length ? statLines.join("\n") : "  (no games played yet)";
      return { response: `📊 *Game Archive Stats*\n――――――――――――――\n${statsBlock}\n――――――――――――――\nTotal: ${totalUsed} questions played\n\nSend *!refreshgames confirm* within 60s to reset all` };
    }

    case "gamestats": {
      const stats = getArchiveStats(msg.groupId);
      const lines = stats.map(s => `  ${s.type}: ${s.used}/${s.total}`);
      const totalUsed = stats.reduce((n, s) => n + s.used, 0);
      return { response: `📊 *Game Stats*\n――――――――――――――\n${lines.join("\n")}\n――――――――――――――\nTotal played: ${totalUsed}` };
    }

    case "bug":
      return { response: handleBugReport(args, msg, recentMessages) };

    // IPL Fantasy
    case "fantasy":
    case "f11":
    case "fl":  // shortcut: !fl = !fantasy leaderboard
      if (command === "fl") return handleFantasyCommand("leaderboard", msg);
      return handleFantasyCommand(args, msg);

    // Solli Adi over-prediction game
    case "solli":
    case "solliadi": {
      const sub = args.toLowerCase().trim();
      if (sub === "status" || sub === "s") return handleSolliAdiStatus(msg);
      if (sub === "lb" || sub === "leaderboard" || sub === "score") return handleSolliAdiLeaderboard(msg);
      return handleSolliAdiTrigger(msg);
    }
    case "predict":
    case "p": {
      const pSub = args.toLowerCase().trim();
      if (pSub === "status" || pSub === "s") return handleSolliAdiStatus(msg);
      return handleSolliAdiPredict(msg, args);
    }

    case "pi":
      return { response: "" }; // handled at listener level (needs client + full JID)


    case "welcome":
    case "intro": {
      const w1 = `🏏 *Fantasy League Bot — Welcome da!*

Ennoda job: live IPL scores, fantasy leaderboard, group banter — eppavum ready.

Two modes:
📋 *!mode serious* — Clean cricket. Just facts.
🔥 *!mode roast* — Kuthu energy. Slight vulgarity. Cricket only.

Default is *serious mode*. Switch anytime.`;
      const w2 = `🎮 *How to Play — IPL Fantasy (ipl11.vercel.app)*

1️⃣ Sign up at *ipl11.vercel.app*
2️⃣ Build a team of 11 players (₹100 credit budget)
3️⃣ Pick Captain (2× pts) & Vice-Captain (1.5× pts)
4️⃣ Lock in your team *before the match starts*
5️⃣ Watch your points roll in live 🚀

*Team rules:*
• Min 1 WK, 1 BAT, 1 BOWL, 1 AR | Max 7 from same team
• ₹100 credit limit | Captain ≠ Vice-Captain

Use *!fantasy join* to get the contest invite code for this group.`;
      const w3 = `📊 *TATA IPL Scoring Rules*

*🏏 Batting*
Run → +1 | 4 → +1 | 6 → +2
30-run bonus → +4 | 50 → +8 | 100 → +16
Duck (out for 0) → −2
SR penalty: SR<70 → −6pts | SR<60 → −10pts (10+ balls faced)

*🎯 Bowling*
Wicket → +25 | Maiden → +8
Economy ≤6 → +6 | ≤7 → +4 | ≤8 → +2

*🤝 Fielding*
Catch → +8 | Stumping → +12
Run-out direct → +12 | Run-out indirect → +6

*👑 Multipliers*
Captain = 2× all points | Vice-Captain = 1.5× all points`;
      const w4 = `⚡ *Bot Commands*

*Cricket:*
!cricket — Live scores
!cricket alerts on/off — Auto score alerts
!news ipl — IPL headlines

*Fantasy:*
!fantasy join — Contest invite link
!fl — Live leaderboard (shortcut)
!fantasy xi — Playing XI (after toss)
!fantasy score <player> — Player points
!fantasy stats — Top performers

*Solli Adi (over prediction game):*
!solli — Start prediction for next over
!predict <runs> — Submit your guess
!solli lb — Solli Adi leaderboard

*Polls & Utility:*
!poll <question> / !vote <n>
!toss | !split <amount> <people> | !8ball <question>`;
      const w5 = `🎲 *Games Available*

!quiz — Tamil movie emoji quiz
!wordle — Guess Tamil movie title (6 tries)
!fastfinger (!ff) — First to type wins
!trivia — Tamil Nadu trivia
!riddle — Tamil riddle
!score — Weekly game leaderboard

🛠️ *Settings & Help*

!mode serious/roast — Switch bot personality
!mute / !unmute — Silence bot for 1 hour
!help — Full command list

🐛 *Report a Bug*
!bug <description>
Example: !bug fantasy leaderboard not loading

Good luck with your fantasy team da! May your captain not DNB 🏏`;
      return {
        response: w1,
        additionalMessages: [
          { text: w2, delayMs: 600 },
          { text: w3, delayMs: 600 },
          { text: w4, delayMs: 600 },
          { text: w5, delayMs: 600 },
        ],
      };
    }

    // Free chat (default)
    case "chat":
    default:
      return {
        response: await getChatResponse(msg.groupId, msg.senderName, args || msg.text),
      };
  }
}
