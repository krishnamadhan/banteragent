import type { BotMessage, CommandResult } from "./types.js";
import { getChatResponse, setGroupMode, generateContent } from "./claude.js";
import { handleGameCommand, clearGroupArchive } from "./features/games.js";
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
import { handleQuoteCommand } from "./features/quotes.js";
import { handleFantasyCommand } from "./features/fantasy.js";

function parseCommand(text: string): { command: string; args: string } {
  if (!text.startsWith("!")) return { command: "chat", args: text };

  const parts = text.slice(1).trim().split(/\s+/);
  const command = (parts[0] ?? "").toLowerCase();
  const args = parts.slice(1).join(" ");

  return { command, args };
}

export async function routeMessage(msg: BotMessage, recentMessages: string[] = []): Promise<CommandResult> {
  const { command, args } = parseCommand(msg.text);

  if (command !== "chat") {
    devlog({ type: "command", command, args, groupId: msg.groupId, sender: msg.senderName });
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
  !refreshgames — Reset game archive (owner only)`,
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
      const validModes: Record<string, string> = {
        roast:  "🔥 ROAST MODE — Default. Savage lovingly.",
        nanban: "🤝 NANBAN MODE — Warm nanban energy. Pure support, zero roast.",
        peter:  "🎓 PETER MODE — Broken English, over-explains everything, very much sophisticated itself.",
      };
      const picked = args.trim().toLowerCase();
      if (!picked) {
        const current = await (await import("./claude.js")).getGroupMode(msg.groupId);
        return { response: `Current mode: *${current}*\n\nChange: !mode roast / !mode nanban / !mode peter` };
      }
      if (!validModes[picked]) {
        return {
          response: `Machaan, valid modes: *roast* / *nanban* / *peter*\nExample: !mode peter`,
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
      const senderJid = msg.from; // e.g. "919487506127@s.whatsapp.net"
      const isOwner = ownerPhone && senderJid.startsWith(ownerPhone.replace("@c.us", "").replace("@s.whatsapp.net", ""));
      if (!isOwner) return { response: "Only group admin can use !refreshgames da 😤" };
      await clearGroupArchive(msg.groupId);
      return { response: "🎮 Game archive cleared! All questions are fresh again. Namma ku vaazhga, game kudhikaalam! Let's play!" };
    }

    case "bug":
      return { response: handleBugReport(args, msg, recentMessages) };

    // IPL Fantasy
    case "fantasy":
    case "f11":
    case "fl":  // shortcut: !fl = !fantasy leaderboard
      if (command === "fl") return handleFantasyCommand("leaderboard", msg);
      return handleFantasyCommand(args, msg);

    // Free chat (default)
    case "chat":
    default:
      return {
        response: await getChatResponse(msg.groupId, msg.senderName, args || msg.text),
      };
  }
}
