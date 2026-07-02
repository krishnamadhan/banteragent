import type { BotMessage, CommandResult } from "./types.js";
import { writeFileSync } from "fs";
import { getChatResponse, setGroupMode, generateContent } from "./claude.js";
import { getGroupConfig } from "./group-config.js";
import { handleGameCommand, clearGroupArchive, getArchiveStats, skipActiveGame } from "./features/games.js";
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
import { startBattle, startTop10, handlePicksNext, handlePicksAnswer } from "./features/picks.js";
import { devlog } from "./devlog.js";
import { invalidateGroupSettingsCache } from "./group-settings-cache.js";
import { handleFitboard, handlePushupNoVideo } from "./features/fitness.js";
import { handlePiAdminMessage } from "./pi-admin.js";
import { handleQuoteCommand } from "./features/quotes.js";
import { handleFantasyCommand, handleWinCommand } from "./features/fantasy.js";
import { handleSolliAdiTrigger, handleSolliAdiPredict, handleSolliAdiStatus, handleSolliAdiLeaderboard } from "./features/solli-adi.js";
import {
  handleExpenseMessage, handleSpentCommand, handleAnalyseCommand, handleReportCommand,
  handleSplitCommand, handleSettleCommand, handleHistoryCommand,
  handleDeleteCommand, handleSummaryCommand, expensesHelp,
} from "./features/expenses/index.js";
import {
  handleFund, handleAdd, handleContri, handleApprove,
  handleDelete as handleConstructionDelete, handleSummary as handleConstructionSummary,
  handleBalance as handleConstructionBalance, handleHistory as handleConstructionHistory,
  handleReport, constructionHelp,
} from "./features/construction/index.js";

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

  // ── Expense group — dedicated routing ─────────────────────────────────────
  if (groupConfig.isExpenseGroup) {
    switch (command) {
      case "spent":   return { response: await handleSpentCommand(msg) };
      case "analyse":
      case "analyze": return { response: await handleAnalyseCommand(msg) };
      case "report":  return { response: await handleReportCommand(msg, args) };
      case "split":   return { response: await handleSplitCommand(msg, args) };
      case "settle":  return { response: await handleSettleCommand(msg, args) };
      case "history": return { response: await handleHistoryCommand(msg, args) };
      case "delete":  return { response: await handleDeleteCommand(msg, args) };
      case "summary": return { response: await handleSummaryCommand(msg) };
      case "h":
      case "help":    return { response: expensesHelp() };
      case "chat": {
        // Natural language — try to detect expense; fall back to silent
        const result = await handleExpenseMessage(msg);
        return { response: result ?? "" };
      }
      default:
        return { response: `Unknown command. Send \`!help\` for the full list.` };
    }
  }

  // ── Construction fund tracker — dedicated routing ──────────────────────────
  if (groupConfig.isConstructionGroup) {
    switch (command) {
      case "fund":       return { response: await handleFund(msg, args) };
      case "add":        return { response: await handleAdd(msg, args) };
      case "contri":
      case "contribute":
      case "contrib":    return { response: await handleContri(msg, args) };
      case "approve":    return { response: await handleApprove(msg, args) };
      case "delete":     return { response: await handleConstructionDelete(msg, args) };
      case "summary":    return { response: await handleConstructionSummary(msg) };
      case "balance":
      case "bal":        return { response: await handleConstructionBalance(msg) };
      case "history":    return { response: await handleConstructionHistory(msg, args) };
      case "report": {
        const r = await handleReport(msg);
        return r.file
          ? { response: "", mediaFile: r.file, mediaCaption: r.text }
          : { response: r.text };
      }
      case "h":
      case "help":       return { response: constructionHelp() };
      case "chat":       return { response: "" }; // ignore free chat in construction group
      default:
        return { response: `Unknown command. Send \`!help\` for the full list.` };
    }
  }

  switch (command) {
    case "h":   // short alias for !help
    case "help":
      return {
        response: `🤖 *TanglishBot Commands*

💬 *Chat:* dei claude <message>
🎮 *Games:*
  !battle [keyword] — VS bracket battle (group vote)
  !top10 [keyword] — Blind ranking game (group vote)
  !next [slot] — Reveal round / lock placement
  !quiz — Tamil movie emoji quiz
  !brandquiz — Guess the Indian brand
  !dialogue — Guess movie from dialogue
  !song — Guess Tamil song from English lyrics
  !wordle — Group Wordle (Tamil movie titles!)
  !w <word> — Submit a Wordle guess
  !detective — 🕵️ NEW! Solve the petty crime
  !songlyric — Complete the song lyric
  !riddle — Tamil riddle
  !fastfinger (!ff) — First to type wins!
  !mostlikely (!ml) — Most likely to... vote
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
  !mode roast / nanban / peter / paati 👵
  !mute — Mute bot for 1 hour
  !unmute — Resume bot

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
    case "detective":
    case "storytime":
    case "story":
    case "twotruthsonelie":
    case "2t1l":
    case "score":
      return handleGameCommand(command, args, msg);

    case "w":  // Wordle guess: !w <word>
      return handleGameCommand("wordle_guess", args, msg);

    case "a":      // short alias for !answer
    case "answer": {
      // Picks games (!battle / !top10) intercept first — no interference with other games
      const picksReply = await handlePicksAnswer(args, msg);
      if (picksReply !== null) return { response: picksReply };
      return handleGameCommand("answer", args, msg);
    }

    // Banter Picks — VS battle & blind ranking
    case "battle":
    case "vs":
      return { response: await startBattle(msg, args) };
    case "top10":
    case "blindrank":
      return { response: await startTop10(msg, args) };
    case "next":
      return { response: await handlePicksNext(msg, args) };
    case "skip":
    case "abandon":
      return { response: await skipActiveGame(msg.groupId) };

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
      setGroupMode(msg.groupId, picked); // persists to data/group-modes.json
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

    // Fantasy ranking leaderboard (gift voucher challenge)
    case "win":
      return handleWinCommand();

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

    case "led":
    case "lights":
    case "light": {
      // Owner DM only (listener gates DMs to BOT_OWNER_PHONE).
      if (msg.isGroup) return { response: "" };
      const robotToken = process.env.ROBOT_API_TOKEN || "";
      const headers: Record<string, string> = robotToken
        ? { "Content-Type": "application/json", Authorization: `Bearer ${robotToken}` }
        : { "Content-Type": "application/json" };
      const a = args.trim().toLowerCase().split(/\s+/);
      const sub = a[0] || "";

      // Calibrate the TV zone — user shows a full-red screen, we find the TV rectangle
      if (sub === "calibrate" || sub === "cal") {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 12000);
          const r = await fetch(`http://127.0.0.1:8000/led/calibrate`, {
            method: "POST", headers, signal: ctrl.signal });
          clearTimeout(t);
          const j: any = await r.json().catch(() => ({}));
          if (r.ok) {
            const caption = `🎯 Calibrated! TV boundary locked. Green outline = detected TV screen.\nNow send *!led tv on* to sync.\n(points: ${JSON.stringify(j.points || j.roi || [])})`;
            if (j.preview_b64) {
              const previewPath = "/tmp/ambilight-calibration-preview.jpg";
              writeFileSync(previewPath, Buffer.from(String(j.preview_b64), "base64"));
              return {
                response: "",
                mediaFile: previewPath,
                mediaCaption: caption,
              };
            }
            return { response: caption };
          }
          return { response: `🎯 ${j.error || `failed (${r.status})`}` };
        } catch {
          return { response: "🎯 Couldn't reach Cosmo (:8000). Is cosmo up?" };
        }
      }

      // TV ambilight mode — camera samples the TV, strip follows the colour
      if (sub === "tv" || sub === "ambilight" || sub === "sync") {
        const on = !(a[1] === "off" || a[1] === "stop" || a[1] === "0");
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 8000);
          const r = await fetch(`http://127.0.0.1:8000/led/tv`, {
            method: "POST", headers, body: JSON.stringify({ on }), signal: ctrl.signal });
          clearTimeout(t);
          const j: any = await r.json().catch(() => ({}));
          if (r.ok) return { response: on
            ? "📺 TV sync *ON* — strip now follows what's on screen. (Cosmo's eye is on TV duty; !led tv off to stop)"
            : "📺 TV sync *OFF* — strip back to manual." };
          return { response: `📺 ${j.error || `failed (${r.status})`}` };
        } catch {
          return { response: "📺 Couldn't reach Cosmo (:8000). Is cosmo up? !pi status" };
        }
      }

      let body: { cmd: string; value?: any } | null = null;
      if (sub === "off" || sub === "on") body = { cmd: sub };
      else if (sub === "bright" || sub === "brightness") body = { cmd: "bright", value: parseInt(a[1] || "100") };
      else if (/^\d+ \d+ \d+$/.test(a.join(" "))) body = { cmd: "color", value: [ +a[0], +a[1], +a[2] ] };
      else if (sub) body = { cmd: "named", value: sub };

      if (!body) {
        return { response: "💡 *LED strip*\n!led <colour> — red green blue white warm yellow orange purple pink cyan amber\n!led off / on\n!led bright <0-100>\n!led 255 0 128 — raw RGB\n🎯 !led calibrate — show full red TV screen, detect boundaries, send marked image\n📺 !led tv on / off — sync strip to the TV" };
      }
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 16000); // BLE scan+connect can take ~12s
        const r = await fetch(`http://127.0.0.1:8000/led`, {
          method: "POST", headers, body: JSON.stringify(body), signal: ctrl.signal,
        });
        clearTimeout(t);
        const j: any = await r.json().catch(() => ({}));
        if (r.ok) {
          const st = j.on ? `on · ${j.brightness}%` : "off";
          return { response: `💡 Done — strip ${st}` };
        }
        return { response: `💡 ${j.error || `failed (${r.status})`}` };
      } catch {
        return { response: "💡 Couldn't reach Cosmo (LED runs through the robot API on :8000). Is cosmo up? !pi status" };
      }
    }

    case "cosmo": {
      // DM-only; listener already gates DMs to BOT_OWNER_PHONE → owner path.
      if (msg.isGroup) return { response: "" };
      const rawArgs = args.trim();
      const [subWord, ...restWords] = rawArgs.split(/\s+/);
      const sub = (subWord || "").toLowerCase();
      const rest = restWords.join(" ").trim();
      const cosmoBase = `http://127.0.0.1:8080`;   // camera stream server
      const apiBase = `http://127.0.0.1:8000`;     // cosmo brain debug API

      const apiJson = async (path: string, init?: RequestInit): Promise<any> => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);
        try {
          const r = await fetch(`${apiBase}${path}`, { ...init, signal: ctrl.signal });
          return await r.json();
        } finally {
          clearTimeout(t);
        }
      };
      const robotToken = process.env.ROBOT_API_TOKEN || "";
      const authHeaders: Record<string, string> = robotToken
        ? { "Content-Type": "application/json", Authorization: `Bearer ${robotToken}` }
        : { "Content-Type": "application/json" };
      const apiAuth = async (path: string, body?: object): Promise<any> =>
        apiJson(path, { method: "POST", headers: authHeaders, body: body ? JSON.stringify(body) : undefined });
      const offline = { response: "🤖 Cosmo brain is offline. Try *!cosmo start*" };

      if (sub === "mem" || sub === "ram") {
        // v2: Cosmo memory footprint vs budget — reads PM2 locally, no robot API needed
        const { exec } = await import("child_process");
        const { promisify } = await import("util");
        const out = await promisify(exec)("pm2 jlist").then(r => r.stdout).catch(() => "");
        try {
          const p = JSON.parse(out).find((x: any) => x.name === "cosmo");
          if (!p) return { response: "🤖 Cosmo not found in PM2." };
          const memMB = Math.round((p.monit?.memory ?? 0) / 1048576);
          const cpu = p.monit?.cpu ?? 0;
          const budget = 500, cap = 1200;
          const icon = memMB > cap * 0.9 ? "🚨" : memMB > budget ? "⚠️" : "✅";
          return { response: `🤖 *Cosmo Memory*\n\nRSS: *${memMB}MB* ${icon}\nCPU: ${cpu}%\nBudget: ${budget}MB · PM2 kill-cap: ${cap}MB\nRestarts: ${p.pm2_env?.restart_time ?? "?"}\n\n${memMB > budget ? "_Over budget — perception models resident. Watch for growth._" : "_Within budget._"}` };
        } catch {
          return { response: "🤖 Could not read PM2 stats." };
        }
      }

      if (sub === "live" || sub === "stream" || sub === "") {
        return {
          response: `🤖 *Cosmo Live Feed*\n\nOpen this in your browser:\nhttp://100.101.250.126:8080\n\n_Works anywhere via Tailscale_`,
        };
      }

      if (sub === "snap" || sub === "pic" || sub === "photo") {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 10000);
          const r = await fetch(`${cosmoBase}/snap-send`, { method: "POST", signal: ctrl.signal });
          clearTimeout(t);
          if (!r.ok) return { response: `📷 Camera unavailable (${r.status}) — try *!cosmo start* if Cosmo just restarted` };
        } catch {
          return { response: "📷 Camera offline — Cosmo can't reach the stream server" };
        }
        return { response: "📸 Snap sent!" };
      }

      if (sub === "record" || sub === "rec" || sub === "video") {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 60000);
          const r = await fetch(`${cosmoBase}/record-send`, { method: "POST", signal: ctrl.signal });
          clearTimeout(t);
          if (!r.ok) return { response: `🎥 Recording failed (${r.status}) — camera may be offline` };
        } catch {
          return { response: "🎥 Recording timed out or camera offline" };
        }
        return { response: "🎥 Clip sent!" };
      }

      if (sub === "status") {
        try {
          const [h, s] = await Promise.all([apiJson("/health"), apiJson("/state")]);
          const e = s.emotion || {};
          const a = s.attention || {};
          const up = h.uptime_s || 0;
          const upStr = up > 3600 ? `${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m` : `${Math.floor(up / 60)}m`;
          return {
            response:
              `🤖 *Cosmo Status*\n` +
              `Up: ${upStr} | CPU ${h.cpu_temp_c}°C | RAM ${h.free_ram_mb}MB free\n` +
              `Mood ${e.mood ?? "—"} | Energy ${e.energy ?? "—"} | ${e.description || ""}\n` +
              `Sees: ${a.person || "no one"} (${a.persons_visible ?? 0} visible)\n` +
              `Last: ${(s.behavior || {}).last_response || "—"}`,
          };
        } catch { return offline; }
      }

      if (sub === "caps") {
        try {
          const c = await apiJson("/caps");
          const icon: Record<string, string> = { ready: "✅", simulated: "🧪", degraded: "⚠️", failed: "❌", absent: "⬜" };
          const lines = Object.entries(c).map(([k, v]) => `${icon[String(v)] || "·"} ${k}: ${v}`);
          return { response: `🤖 *Cosmo Capabilities*\n${lines.join("\n")}` };
        } catch { return offline; }
      }

      if (sub === "mood") {
        try {
          const s = await apiJson("/state");
          const e = s.emotion || {};
          return {
            response:
              `🤖 *Cosmo Mood*\nMood: ${e.mood}\nEnergy: ${e.energy}\nArousal: ${e.arousal}\nAttachment: ${e.attachment}\n_${e.description || ""}_`,
          };
        } catch { return offline; }
      }

      if (sub === "last") {
        try {
          const r = await apiJson("/cosmo/last?n=5");
          const evs = (r.events || []).map((ev: any) => `• ${typeof ev === "string" ? ev : JSON.stringify(ev)}`);
          return { response: `🤖 *Cosmo — recent events*\n${evs.join("\n") || "nothing yet"}\nLast said: ${r.last_response || "—"}` };
        } catch { return offline; }
      }

      if (sub === "log") {
        try {
          const r = await apiJson("/logs/tail?lines=10");
          const lines = (r.lines || []).slice(-10);
          return { response: `🤖 *Cosmo log tail*\n\`\`\`${lines.join("\n").slice(-1500)}\`\`\`` };
        } catch { return offline; }
      }

      if (sub === "say") {
        if (!rest) return { response: "Usage: !cosmo say <text>" };
        try {
          const r = await apiJson("/cosmo/say", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: rest }),
          });
          return { response: r.ok ? `🗣️ Cosmo says: "${r.text}"` : `❌ ${JSON.stringify(r)}` };
        } catch { return offline; }
      }

      if (sub === "sim") {
        if (!rest) return { response: "Usage: !cosmo sim <capability> (e.g. locomotion)" };
        try {
          const r = await apiJson("/cosmo/sim", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cap: rest.toLowerCase() }),
          });
          if (r.ok) return { response: `🧪 ${r.cap} → ${r.state}` };
          return { response: `❌ ${r.error}\nValid: ${(r.valid || []).join(", ")}` };
        } catch { return offline; }
      }

      if (sub === "start" || sub === "stop") {
        const { exec } = await import("child_process");
        const { promisify } = await import("util");
        const run = promisify(exec);
        try {
          const cmd = sub === "start"
            ? "pm2 start /home/pi/robot/ecosystem.config.js"
            : "pm2 stop cosmo";
          await run(cmd, { timeout: 30000 });
          return { response: sub === "start" ? "🤖 Cosmo waking up... give it ~30s" : "😴 Cosmo stopped." };
        } catch (e: any) {
          return { response: `❌ pm2 ${sub} failed: ${String(e?.message || e).slice(0, 200)}` };
        }
      }

      if (sub === "test") {
        try {
          const steps = ["face_seen", "touch", "emotion_happy"];
          const results: string[] = [];
          for (const trigger of steps) {
            const r = await apiAuth(`/trigger/${trigger}`);
            results.push(`${r.ok ? "✅" : "❌"} ${trigger}`);
            await new Promise(res => setTimeout(res, 1500));
          }
          return { response: `🧪 *Cosmo test sequence*\n${results.join("\n")}` };
        } catch { return offline; }
      }

      if (sub === "move") {
        const dirEndpoint: Record<string, string> = {
          fwd: "/motor/forward", forward: "/motor/forward",
          back: "/motor/back", backward: "/motor/back",
          left: "/motor/left", right: "/motor/right",
          stop: "/motor/stop",
        };
        const dir = (restWords[0] || "").toLowerCase();
        const endpoint = dirEndpoint[dir];
        if (!endpoint) return { response: `Usage: !cosmo move <fwd|back|left|right|stop>` };
        try {
          const body = dir === "stop" ? undefined : { speed: 0.4, duration: 1.0 };
          const r = await apiAuth(endpoint, body);
          return { response: r.ok ? `🚗 Moving ${dir}` : `❌ ${JSON.stringify(r)}` };
        } catch { return offline; }
      }

      if (sub === "home") {
        // !cosmo home <type> <device> [state]
        // e.g. !cosmo home device_on tv   or   !cosmo home presence home
        const [evType, device, state] = restWords;
        if (!evType) return { response: `Usage: !cosmo home <type> <device> [state]\nTypes: device_on device_off motion presence scene` };
        try {
          const payload: Record<string, string> = { type: evType };
          if (device) payload.device = device;
          if (state) payload.state = state;
          const r = await apiJson("/smarthome/event", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          return { response: r.ok ? `🏠 Smart home event injected: ${evType} / ${device || "—"}` : `❌ ${JSON.stringify(r)}` };
        } catch { return offline; }
      }

      if (sub === "health") {
        try {
          const { exec } = await import("child_process");
          const { promisify } = await import("util");
          const run = promisify(exec);
          const [h, s, pm2Out] = await Promise.all([
            apiJson("/health"),
            apiJson("/state"),
            run("pm2 jlist", { timeout: 5000 }).then(({ stdout }) => {
              const list = JSON.parse(stdout) as any[];
              return list.map((p: any) => `${p.name}: ${p.pm2_env?.status} (↺${p.pm2_env?.restart_time})`).join("\n");
            }).catch(() => "pm2 unavailable"),
          ]);
          const e = s.emotion || {};
          const up = h.uptime_s || 0;
          const upStr = up > 3600 ? `${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m` : `${Math.floor(up / 60)}m`;
          return {
            response:
              `🤖 *Cosmo Health*\n` +
              `Up: ${upStr} | CPU ${h.cpu_temp_c}°C | RAM ${h.free_ram_mb}MB free\n` +
              `Mood: ${e.mood} | Energy: ${e.energy} | Arousal: ${e.arousal} | Attach: ${e.attachment}\n` +
              `_${e.description || ""}_\n\n` +
              `*PM2*\n${pm2Out}`,
          };
        } catch { return offline; }
      }

      return {
        response:
          `Cosmo commands:\n` +
          `!cosmo live — browser stream\n!cosmo snap — photo\n!cosmo record — 30s video\n` +
          `!cosmo status — health + mood + attention\n!cosmo caps — capability states\n` +
          `!cosmo mood — personality state\n!cosmo last — recent events\n!cosmo log — log tail\n` +
          `!cosmo say <text> — speak via TTS\n!cosmo sim <cap> — simulate capability\n` +
          `!cosmo test — run face+touch+emotion test sequence\n` +
          `!cosmo move <fwd|back|left|right|stop> — motor control\n` +
          `!cosmo home <type> <device> [state] — inject smart home event\n` +
          `!cosmo health — full system health + PM2\n` +
          `!cosmo mem — RSS vs budget check\n` +
          `!cosmo start / stop — pm2 control`,
      };
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
