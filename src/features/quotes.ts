import type { BotMessage } from "../types.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

interface Quote {
  id: number;
  groupId: string;
  savedBy: string;
  speakerName: string;
  text: string;
  savedAt: number;
}

// Lazy-loaded file-backed store; kept in memory after first command.
const QUOTES_FILE = join(process.cwd(), "data", "quotes.json");
const quoteStore: Quote[] = [];
let nextId = 1;
let loaded = false;

function loadQuotes(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (!existsSync(QUOTES_FILE)) return;
    const parsed = JSON.parse(readFileSync(QUOTES_FILE, "utf8"));
    if (!Array.isArray(parsed)) return;
    quoteStore.splice(0, quoteStore.length, ...parsed.filter(isQuote));
    nextId = Math.max(0, ...quoteStore.map((q) => q.id)) + 1;
  } catch (e) {
    console.error("[quotes] load failed:", e);
  }
}

function saveQuotes(): void {
  try {
    mkdirSync(dirname(QUOTES_FILE), { recursive: true });
    writeFileSync(QUOTES_FILE, JSON.stringify(quoteStore, null, 2));
  } catch (e) {
    console.error("[quotes] save failed:", e);
    throw new Error("Quote save failed");
  }
}

function isQuote(value: unknown): value is Quote {
  const q = value as Quote;
  return Number.isInteger(q?.id)
    && typeof q.groupId === "string"
    && typeof q.savedBy === "string"
    && typeof q.speakerName === "string"
    && typeof q.text === "string"
    && typeof q.savedAt === "number";
}

export function handleQuoteCommand(command: string, args: string, msg: BotMessage): string {
  loadQuotes();
  switch (command) {
    case "quoteme":
    case "savequote": {
      const text = args.trim();
      if (!text) return `Format: !quoteme <name> said "<quote>"\nExample: !quoteme Hari said "biryani la AC irundha nalla irukkum"`;

      // Parse "Name said ..." format
      const saidMatch = text.match(/^(.+?)\s+said\s+(.+)$/i);
      let speakerName: string;
      let quoteText: string;

      if (saidMatch) {
        speakerName = saidMatch[1]!.trim();
        quoteText = saidMatch[2]!.trim().replace(/^["']|["']$/g, "");
      } else {
        speakerName = msg.senderName;
        quoteText = text.replace(/^["']|["']$/g, "");
      }

      const quote: Quote = {
        id: nextId++,
        groupId: msg.groupId,
        savedBy: msg.senderName,
        speakerName,
        text: quoteText,
        savedAt: Date.now(),
      };
      quoteStore.push(quote);
      try {
        saveQuotes();
      } catch {
        quoteStore.pop();
        nextId--;
        return "Quote save panna mudiyala da, konjam retry pannu.";
      }
      return `✅ Quote #${quote.id} saved!\n\n💬 *"${quoteText}"*\n— ${speakerName}`;
    }

    case "quote": {
      const nameFilter = args.trim().toLowerCase();
      const pool = quoteStore.filter(
        (q) =>
          q.groupId === msg.groupId &&
          (!nameFilter || q.speakerName.toLowerCase().includes(nameFilter))
      );

      if (!pool.length) {
        return nameFilter
          ? `${args}-ku quote onnum save aagala! !quoteme pannu.`
          : "Yaarum quote save pannala machaan! !quoteme Hari said \"...\" — try pannu.";
      }

      const q = pool[Math.floor(Math.random() * pool.length)]!;
      return `💬 *Quote #${q.id}*\n\n"${q.text}"\n\n— *${q.speakerName}* _(saved by ${q.savedBy})_`;
    }

    case "quoteboard": {
      const groupQuotes = quoteStore.filter((q) => q.groupId === msg.groupId);
      if (!groupQuotes.length) return "No quotes saved yet! !quoteme pannu first da.";

      const counts = new Map<string, number>();
      for (const q of groupQuotes) {
        counts.set(q.speakerName, (counts.get(q.speakerName) ?? 0) + 1);
      }

      const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      const medals = ["🥇", "🥈", "🥉"];

      let board = `💬 *QUOTE LEADERBOARD*\n(${groupQuotes.length} total quotes saved)\n\n`;
      sorted.forEach(([name, count], i) => {
        board += `${medals[i] ?? `${i + 1}.`} ${name} — ${count} quote${count > 1 ? "s" : ""}\n`;
      });
      return board.trim();
    }

    default:
      return "Quote commands:\n!quoteme <name> said \"<text>\" — save a quote\n!quote [name] — random quote\n!quoteboard — most quoted members";
  }
}
