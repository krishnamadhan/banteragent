import type { BotMessage, CommandResult } from "./types.js";
import { writeFileSync } from "fs";
import { getChatResponse, setGroupMode, generateContent } from "./claude.js";
import { getGroupConfig } from "./group-config.js";
import {
  handleGameCommand,
  clearGroupArchive,
  getArchiveStats,
  skipActiveGame,
  refreshGamesAdd,
  refreshGamesAll,
  resetArchive,
  runGameCheck,
  REFRESHABLE_GAMES,
  type RefreshableGame,
} from "./features/games.js";
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
import { invalidateGroupSettingsCache, recordGroupMute } from "./group-settings-cache.js";
import { handleFitboard, handlePushupNoVideo } from "./features/fitness.js";
import { handlePiAdminMessage } from "./pi-admin.js";
import { samePhone } from "./phone.js";
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
import { renderMainHelp } from "./help.js";
import { handleCloneCommand } from "./features/clone.js";

function parseCommand(text: string): { command: string; args: string } {
  if (!text.startsWith("!")) return { command: "chat", args: text };

  const parts = text.slice(1).trim().split(/\s+/);
  const command = (parts[0] ?? "").toLowerCase();
  const args = parts.slice(1).join(" ");

  return { command, args };
}

const _refreshConfirmPending = new Map<string, number>(); // groupId => ts

const LED_COLORS: Record<string, [number, number, number]> = {
  red: [255, 0, 0],
  green: [0, 255, 0],
  blue: [0, 0, 255],
  white: [255, 255, 255],
  warm: [255, 160, 60],
  yellow: [255, 255, 0],
  orange: [255, 90, 0],
  purple: [150, 0, 255],
  pink: [255, 40, 120],
  cyan: [0, 255, 255],
  amber: [255, 120, 0],
};

const LED_BULB_USAGE = "💡 *Bulb only*\n!led bulb <colour> — red green blue white warm yellow orange purple pink cyan amber\n!led bulb 255 0 128\n!led bulb bright <0-100>\n!led bulb on / off";

function parseByte(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const n = Number.parseInt(value, 10);
  return n >= 0 && n <= 255 ? n : null;
}

function parsePercent(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const n = Number.parseInt(value, 10);
  return n >= 0 && n <= 100 ? n : null;
}

function parseLedBulbBody(args: string[]): { cmd: string; value?: any; bright?: number } | null {
  const sub = args[0] || "";
  if (sub === "on" || sub === "off") return { cmd: sub };
  if (sub === "bright" || sub === "brightness") {
    const pct = parsePercent(args[1]);
    return pct === null ? null : { cmd: "bright", value: pct };
  }
  const rgb = [parseByte(args[0]), parseByte(args[1]), parseByte(args[2])];
  if (rgb.every((n): n is number => n !== null) && args.length === 3) {
    return { cmd: "color", value: rgb };
  }
  const named = LED_COLORS[sub];
  return named ? { cmd: "color", value: named } : null;
}

function splitRiddleResponse(content: string): { riddle: string; answer: string } {
  const riddleMatch = content.match(/RIDDLE:\s*(.+?)(?:\n\s*ANSWER:|$)/is);
  const answerMatch = content.match(/ANSWER:\s*(.+)$/is);
  return {
    riddle: riddleMatch?.[1]?.trim() || content.trim(),
    answer: answerMatch?.[1]?.trim() || "Answer generate aagala da, next riddle try pannalaam.",
  };
}

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
        response: renderMainHelp(samePhone(msg.from, process.env.BOT_OWNER_PHONE)),
      };

    case "clone":
      return handleCloneCommand(args, msg);

    // Games
    case "quiz":
    case "brandquiz":
    case "logoquiz":
    case "wordle":
    case "trivia":
    case "fastfinger":
    case "ff":
    case "detective":
    case "anagram":
    case "scramble":
    case "hangman":
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
      recordGroupMute(msg.groupId, muted);
      invalidateGroupSettingsCache(msg.groupId); // fresh state on very next message
      return {
        response: muted
          ? "🔇 Seri da, 1 hour mute pannitten. !unmute sollinaale early-aa tirupen."
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
    case "riddle": {
      const content = await generateContent(
        `Generate ONE short Tamil-style riddle in Tanglish, with one clear answer. Make it feel like a fun WhatsApp group riddle, not a quiz question. Format exactly:
RIDDLE: <riddle only>
ANSWER: <answer only>`
      );
      const { riddle, answer } = splitRiddleResponse(content);
      return {
        response: `🧩 *RIDDLE TIME*\n\n${riddle}`,
        additionalMessages: [
          { text: `🧩 *Riddle Answer*\n\n${answer}`, delayMs: 20000 },
        ],
      };
    }

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
      const ownerPhone = process.env.BOT_OWNER_PHONE;
      if (!samePhone(msg.from, ownerPhone)) return { response: "" };
      const pendingPath = "/home/pi/banteragent/pending-fix.md";
      const { existsSync } = await import("fs");
      if (!existsSync(pendingPath)) return { response: "No pending fix to approve da 🤷" };
      fetch("http://127.0.0.1:3099/apply-fix", { method: "POST" }).catch(console.error);
      return { response: "✅ Fix approved! Applying now — bot will restart in ~30s..." };
    }
    case "reject": {
      const ownerPhone = process.env.BOT_OWNER_PHONE;
      if (!samePhone(msg.from, ownerPhone)) return { response: "" };
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
      const isOwner = samePhone(senderJid, ownerPhone);
      if (!isOwner) return { response: "Only group admin can use !refreshgames da 😤" };
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const action = parts[0]?.toLowerCase();
      const game = parts[1]?.toLowerCase() as RefreshableGame | undefined;
      const games = new Set(REFRESHABLE_GAMES);
      if (action === "add") {
        if (!game || !games.has(game)) return { response: "Usage: *!refreshgames add <game> [N]*" };
        const count = parts[2] ? Number.parseInt(parts[2], 10) : 20;
        return { response: await refreshGamesAdd(msg.groupId, game, Number.isFinite(count) ? count : 20) };
      }
      if (action === "all") {
        const count = parts[1] ? Number.parseInt(parts[1], 10) : 20;
        return { response: await refreshGamesAll(msg.groupId, Number.isFinite(count) ? count : 20) };
      }
      if (action === "reset") {
        if (!game || !games.has(game)) return { response: "Usage: *!refreshgames reset <game>*" };
        resetArchive(msg.groupId, game === "wordle" ? "wordle500" : game);
        return { response: `OK ${game} archive reset. Existing pool kept; extras still available.` };
      }
      if (action === "confirm") {
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
      const poolColor = (remaining: number) => remaining <= 10 ? "\u{1F534}" : remaining <= 20 ? "\u{1F7E1}" : "\u{1F7E2}";
      const lines = stats.map(s => s.remaining !== undefined
        ? `  ${poolColor(s.remaining)} ${s.type}: ${s.used}/${s.total} used, ${s.remaining} left`
        : `  ${s.type}: ${s.used}/${s.total} used`);
      const totalUsed = stats.reduce((n, s) => n + s.used, 0);
      return { response: `📊 *Game Stats*\n――――――――――――――\n${lines.join("\n")}\n――――――――――――――\nTotal played: ${totalUsed}` };
    }

    case "gamecheck": {
      const ownerPhone = process.env.BOT_OWNER_PHONE;
      const isOwner = samePhone(msg.from, ownerPhone);
      if (!isOwner) return { response: "Only owner can use !gamecheck da" };
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const game = parts[0]?.toLowerCase() as RefreshableGame | undefined;
      const games = new Set(REFRESHABLE_GAMES);
      if (!game || !games.has(game)) return { response: "Usage: *!gamecheck <game> [quarantine]*" };
      const result = await runGameCheck(game, parts.includes("quarantine"));
      const sample = result.failures.slice(0, 8).map((f) => `- ${f.key}: ${f.reason}`).join("\n");
      return { response: `🔍 *Game Check: ${game}*\nChecked: ${result.checked}\nFAIL: ${result.failures.length}${result.quarantined ? `\nQuarantined: ${result.quarantined}` : ""}${sample ? `\n\n${sample}` : ""}` };
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

      // Manual Wipro bulb control — explicit bulb-only target.
      if (sub === "bulb") {
        const bulbArgs = a.slice(1).filter(Boolean);
        const body = parseLedBulbBody(bulbArgs);
        if (!body) return { response: LED_BULB_USAGE };
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 8000);
          const r = await fetch(`http://127.0.0.1:8000/led/bulb`, {
            method: "POST", headers, body: JSON.stringify(body), signal: ctrl.signal,
          });
          clearTimeout(t);
          const j: any = await r.json().catch(() => ({}));
          if (r.ok) {
            const state = j.on === false ? "off" : "on";
            const manual = j.last_manual ? ` · ${JSON.stringify(j.last_manual)}` : "";
            return { response: `💡 Bulb done — ${state}${manual}` };
          }
          return { response: `💡 Bulb ${j.error || `failed (${r.status})`}` };
        } catch {
          return { response: "💡 Couldn't reach Cosmo bulb API (:8000)." };
        }
      }

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

      // Scene presets (hands-free ambiance)
      const SCENES = ["movie", "chill", "night", "focus", "reading", "romance", "party"];
      if (SCENES.includes(sub)) {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 16000);
          const r = await fetch(`http://127.0.0.1:8000/led/scene`, {
            method: "POST", headers, body: JSON.stringify({ scene: sub }), signal: ctrl.signal });
          clearTimeout(t);
          const j: any = await r.json().catch(() => ({}));
          if (r.ok) return { response: `🎬 Scene *${sub}* set.` };
          return { response: `🎬 ${j.error || `failed (${r.status})`}` };
        } catch {
          return { response: "🎬 Couldn't reach Cosmo (:8000)." };
        }
      }

      // Status / health
      if (sub === "status" || sub === "health") {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 6000);
          const [s, h] = await Promise.all([
            fetch(`http://127.0.0.1:8000/led`, { headers, signal: ctrl.signal }).then(r => r.json()),
            fetch(`http://127.0.0.1:8000/led/health`, { headers, signal: ctrl.signal }).then(r => r.json()),
          ]);
          clearTimeout(t);
          const st: any = s, he: any = h;
          const conn = he.connected ? "✅ connected" : "🚨 offline";
          const sync = st.tv_sync ? "📺 TV sync ON" : "manual";
          const scene = st.scene ? ` · scene: ${st.scene}` : "";
          const cal = st.roi_active ? "✅" : "❌ not calibrated";
          const bulb = he.bulb;
          const bulbLine = bulb
            ? `\n\n💡 *Wipro bulb*\n${bulb.enabled ? "✅ enabled" : "🚨 disabled"} · ${bulb.on ? "on" : "off"}\nwrites: ${bulb.ok ?? 0} ok / ${bulb.fail ?? 0} fail${bulb.music ? "\nmode: music/sync" : ""}${bulb.last_manual ? `\nlast manual: ${JSON.stringify(bulb.last_manual)}` : ""}`
            : "";
          return { response: `💡 *LED strip*\n${conn} · ${st.on ? "on" : "off"} @ ${st.brightness}%${scene}\nmode: ${sync}\ncalibrated: ${cal}\nwrites: ${he.writes_ok} ok / ${he.writes_fail} fail${he.last_error ? `\nlast error: ${he.last_error}` : ""}${bulbLine}` };
        } catch {
          return { response: "💡 Couldn't reach Cosmo (:8000)." };
        }
      }

      let body: { cmd: string; value?: any } | null = null;
      if (sub === "off" || sub === "on") body = { cmd: sub };
      else if (sub === "bright" || sub === "brightness") body = { cmd: "bright", value: parseInt(a[1] || "100") };
      else if (sub === "pattern") {
        if (!a[1]) return { response: "🌈 *Patterns* (controller-side, zero BLE traffic)\n!led pattern rainbow|dreaming|rgb|trail|stream|curtain|spot|flutter|hop|strobe|gradual|race|run|swab|off\nor a raw index 0-210: !led pattern 42" };
        body = { cmd: "pattern", value: /^\d+$/.test(a[1]) ? parseInt(a[1]) : a[1] };
      }
      else if (sub === "music" || sub === "sound") {
        // built-in mic on the strip controller — reacts to room audio
        const eq = a[1] || "classic";
        body = { cmd: "music", value: /^\d+$/.test(eq) ? parseInt(eq) : eq };
      }
      else if (sub === "temp" || sub === "temperature") body = { cmd: "temp", value: parseInt(a[1] || "50") };
      else if (/^\d+ \d+ \d+$/.test(a.join(" "))) body = { cmd: "color", value: [ +a[0], +a[1], +a[2] ] };
      else if (sub) body = { cmd: "named", value: sub };

      if (!body) {
        return { response: "💡 *Lights (LED strip + Wipro bulb)*\n!led <colour> — red green blue white warm yellow orange purple pink cyan amber\n!led off / on · !led bright <0-100> (0 = dark, stays connected) · !led 255 0 128\n!led bulb <colour|R G B|bright N|on|off> — Wipro bulb only\n🎬 !led movie|chill|night|focus|reading|romance|party — scenes\n🌈 !led pattern [name|0-210] — built-in animations (bare = list)\n🎵 !led music [classic|soft|dynamic|disco|off] — strip's own mic sound-sync\n🌡️ !led temp <0-100> — white colour temperature (0 warm → 100 cool)\n📺 !led tv on / off — sync strip + Wipro bulb to the TV\n🎯 !led calibrate — detect TV boundary (show full red screen)\nℹ️ !led status — connection + health" };
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
      const w1 = `🤖 *TanglishBot — Welcome da!*

Enna command podra nu therinja podhum, naan group-la games, cricket updates, fun replies, polls, reminders, settings ellam handle panniduven.

*Modes:*
!mode nanban — Warm support
!mode roast — Savage banter
!mode peter — Broken English over-explain
!mode paati — Paati scolding with love`;
      const w2 = `🎲 *Games Available*

!quiz — Tamil movie emoji quiz
!wordle — Guess Tamil movie title
!trivia — Tamil Nadu trivia
!riddle — Tamil riddle
!fastfinger (!ff) — First to type wins
!anagram — Unscramble
!hangman — Co-op letter guessing
!score — Weekly game leaderboard`;
      const w3 = `⚡ *Useful Commands*

*Cricket:*
!cricket — Live scores
!cricket alerts on/off — Auto score alerts
!news ipl — IPL headlines

*Polls & Utility:*
!poll <question>
!vote <n>
!toss
!split <amount> <people>
!8ball <question>

*Fun:*
!roast <name>
!movie [mood/name]
!rank <topic>
!vibecheck`;
      const w4 = `🛠️ *Settings & Help*

!mode nanban/roast/peter/paati — Switch bot personality
!mute - mute for 1 hour (!unmute to end early)
!help — Full command list

🐛 *Report a Bug*
!bug <description>
Example: !bug wordle not accepting answer

Use !help anytime for the full command list.`;
      return {
        response: w1,
        additionalMessages: [
          { text: w2, delayMs: 600 },
          { text: w3, delayMs: 600 },
          { text: w4, delayMs: 600 },
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
