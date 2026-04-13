import type { BotMessage } from "../types.js";
import { generateContent } from "../claude.js";

// ===== RSS-based news (no API key needed) =====
// Sources: NDTV feeds — reliable India coverage, freely accessible

const FEEDS: Record<string, string[]> = {
  sports:        ["https://www.espncricinfo.com/rss/content/story/feeds/0.xml"],
  ipl:           ["https://www.espncricinfo.com/rss/content/story/feeds/0.xml"],
  entertainment: ["https://www.thehindu.com/entertainment/movies/feeder/default.rss"],
  tech:          ["https://feeds.feedburner.com/gadgets360-latest"],
  india:         ["https://www.thehindu.com/news/national/feeder/default.rss"],
  mix:           [
    "https://www.espncricinfo.com/rss/content/story/feeds/0.xml",
    "https://www.thehindu.com/entertainment/movies/feeder/default.rss",
    "https://www.thehindu.com/news/national/feeder/default.rss",
  ],
};

const TOPIC_MAP: Record<string, string> = {
  cricket: "sports", sports: "sports",
  ipl: "ipl",
  movie: "entertainment", movies: "entertainment", cinema: "entertainment", film: "entertainment", kollywood: "entertainment",
  tech: "tech", technology: "tech",
  india: "india",
};

// IPL-specific filter when topic is ipl
const IPL_FILTER = " Focus specifically on IPL matches, scores, team standings, and player performances. Ignore non-IPL cricket.";

// Simple per-group rate limit — don't hammer RSS on every !news
const lastNewsFetch = new Map<string, number>();
const NEWS_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

async function fetchRSSTitles(url: string): Promise<string[]> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TanglishBot/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    console.log(`[news] RSS fetch ${url} → HTTP ${res.status}`);
    if (!res.ok) return [];
    const xml = await res.text();

    const titles: string[] = [];
    // CDATA titles: <title><![CDATA[...]]></title>  and plain: <title>...</title>
    const re = /<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/gs;
    let match;
    while ((match = re.exec(xml)) !== null) {
      const t = match[1]?.trim();
      if (!t || t.length < 10) continue;
      // Skip feed channel title lines
      if (/^NDTV|^RSS|^Feed|^ESPN|^The Hindu|^Gadgets/i.test(t)) continue;
      titles.push(t);
    }
    return titles.slice(0, 8);
  } catch {
    return [];
  }
}

/**
 * Scheduled news drop — bypasses user rate limit.
 * Called by scheduler; updates lastNewsFetch so user !news shortly after gets a cooldown notice.
 */
export async function scheduledNewsDrop(groupId: string, feedKey: "mix" | "ipl" | "sports" = "mix"): Promise<string> {
  const urls = FEEDS[feedKey]!;
  const results = await Promise.all(urls.map(fetchRSSTitles));
  const headlines = results.flatMap((r) => r.slice(0, 3));

  // Record fetch time so !news within 5 min shows cooldown
  lastNewsFetch.set(groupId, Date.now());

  if (!headlines.length) {
    return await generateContent(
      `News fetch failed. Share 4-5 hot news items in Tanglish about ${feedKey === "ipl" ? "IPL cricket" : "cricket, Kollywood, and India"} that a Tamil 20-35 friends group would find interesting. Commentary style. Start with "📰 *HOT NEWS*"`
    );
  }

  const headlineBlock = headlines.map((h) => `• ${h}`).join("\n");
  const iplExtra = feedKey === "ipl" ? IPL_FILTER : "";
  const prompt = `Real headlines right now:

${headlineBlock}

Write a punchy Tanglish news digest for a Tamil 20-35 WhatsApp group. MAXIMUM 6 lines total.${iplExtra}

FILTER RULES:
- KEEP: match results with scores, movie release/controversy/box office, anything surprising or viral
- SKIP: routine appointments, budget procedures, press releases, "inaugurated" or "launched scheme" headlines
- Pick only 2-3 headlines that would make someone say "wait what??" — quality over quantity

FORMAT:
- Start with "📰 *HOT NEWS*" — no intro before it
- One sharp line per story with your opinion
- End with ONE punchy Tanglish verdict
- Be a commentator, not a reporter`;

  return await generateContent(prompt);
}

export async function handleNews(args: string, msg: BotMessage): Promise<string> {
  const topic = args.trim().toLowerCase();
  const feedKey = TOPIC_MAP[topic] ?? "mix";

  // Rate limit
  const lastTime = lastNewsFetch.get(msg.groupId) ?? 0;
  if (Date.now() - lastTime < NEWS_COOLDOWN_MS) {
    const waitMins = Math.ceil((NEWS_COOLDOWN_MS - (Date.now() - lastTime)) / 60000);
    return `Dei, news konjam neram pakkattum! ${waitMins} min-la again try pannunga 🗞️`;
  }

  const urls = FEEDS[feedKey]!;

  // Fetch all feeds in parallel, take up to 3 headlines per feed
  const results = await Promise.all(urls.map((u) => fetchRSSTitles(u)));
  const perFeed = feedKey === "mix" ? 3 : 8;
  const headlines = results.flatMap((r) => r.slice(0, perFeed));

  lastNewsFetch.set(msg.groupId, Date.now());

  if (!headlines.length) {
    // Fallback: Claude's knowledge
    const topicLabel = topic || "general India + cricket + movies";
    return await generateContent(
      `News fetch failed. Share 4-5 hot news items in Tanglish about ${topicLabel} that a Tamil 20-35 friends group would find interesting. ` +
      `Mix of cricket, Kollywood, and India. Commentary style. Note it's from your training knowledge. Start with "📰 *HOT NEWS* (brain cache edition)"`
    );
  }

  const headlineBlock = headlines.map((h) => `• ${h}`).join("\n");
  const topicLabel = topic ? `${topic} news` : "today's hot mix";
  const iplExtra = feedKey === "ipl" ? IPL_FILTER : "";

  const prompt = `Real headlines right now (${topicLabel}):

${headlineBlock}

Write a punchy Tanglish news digest for a Tamil 20-35 WhatsApp group. MAXIMUM 6 lines total.${iplExtra}

FILTER RULES:
- KEEP: match results with scores, movie release/controversy/box office, political scandal, anything surprising or viral
- SKIP: routine ministerial appointments, budget procedures, press releases, any "inaugurated" or "launched scheme" headline
- Pick only 2-3 headlines that would make someone say "wait what??" — quality over quantity
- If only 1 headline is actually interesting, cover just that one well

FORMAT:
- Start with "📰 *HOT NEWS*" — no intro line before it
- One sharp line per story with your opinion, not a summary
- End with ONE punchy verdict (not a summary, a hot take)
- Tanglish throughout — be a commentator, not a reporter`;


  return await generateContent(prompt);
}
