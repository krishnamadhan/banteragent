import type { BotMessage } from "../types.js";

interface Quote {
  id: number;
  groupId: string;
  savedBy: string;
  speakerName: string;
  text: string;
  savedAt: number;
}

// In-memory store — lightweight, survives across messages, cleared on restart
const quoteStore: Quote[] = [];
let nextId = 1;

export function handleQuoteCommand(command: string, args: string, msg: BotMessage): string {
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
