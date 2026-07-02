/**
 * Daily Finance Update — Gold 22K rate + Nifty 50 with day-over-day diff
 * Data source: IBJA (Indian domestic benchmark), Yahoo Finance fallback
 * Cache: ./data/finance-cache.json (persists previous day for diff calc)
 */

import fs from "fs";
import path from "path";
import { generateStructured } from "../claude.js";

const CACHE_FILE = "./data/finance-cache.json";

interface FinanceCache {
  date: string;       // YYYY-MM-DD IST
  gold22k: number;    // ₹ per gram
  nifty: number;      // index value
}

function loadCache(): FinanceCache | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as FinanceCache;
  } catch { return null; }
}

function saveCache(data: FinanceCache): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
  } catch (e) { console.error("[finance] cache write failed:", e); }
}

async function yahooPrice(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
      { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data: any = await res.json();
    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof price === "number" ? price : null;
  } catch { return null; }
}

async function fetchGold22kIBJA(): Promise<number | null> {
  // IBJA (Indian Bullion Jewellers Association) — industry benchmark rate for India
  try {
    const res = await fetch("https://www.ibja.co/", {
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    // IBJA HTML pattern: 22KT">₹ 14521
    const m = html.match(/22KT[^0-9]*?([\d,]+)/);
    if (m?.[1]) {
      const val = parseInt(m[1].replace(/,/g, ""), 10);
      if (val >= 3000 && val <= 200000) return val;
    }
    return null;
  } catch { return null; }
}

async function fetchGold22k(): Promise<number | null> {
  // Try IBJA first (Indian domestic benchmark), fall back to Yahoo Finance + India duty adjustment
  const ibja = await fetchGold22kIBJA();
  if (ibja) return ibja;
  // Fallback: Gold futures (USD/troy oz) + USD→INR → 22K per gram
  // Apply ~9% India adjustment for import duty (6%) + GST (3%) to match domestic retail rates
  const [goldUSD, usdINR] = await Promise.all([
    yahooPrice("GC=F"),
    yahooPrice("USDINR=X"),
  ]);
  if (!goldUSD || !usdINR) return null;
  const gold24kPerGram = (goldUSD * usdINR) / 31.1035;
  return Math.round(gold24kPerGram * (22 / 24) * 1.09);
}

async function fetchNifty(): Promise<number | null> {
  const price = await yahooPrice("^NSEI");
  return price ? Math.round(price) : null;
}

function diffLabel(diff: number, unit: string): string {
  const sign = diff >= 0 ? "+" : "-";
  const abs = Math.abs(diff).toLocaleString("en-IN");
  const arrow = diff >= 0 ? "📈" : "📉";
  return `${arrow} ${sign}${unit}${abs}`;
}

export async function sendFinanceUpdate(): Promise<string | null> {
  const [gold22k, nifty] = await Promise.all([fetchGold22k(), fetchNifty()]);

  if (!gold22k && !nifty) {
    console.error("[finance] Both gold and Nifty fetch failed");
    return null;
  }

  // IST today string
  const todayIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000)
    .toISOString().split("T")[0]!;

  const prev = loadCache();
  const isNewDay = !prev || prev.date !== todayIST;

  let goldDiff: number | null = null;
  let niftyDiff: number | null = null;

  if (isNewDay && prev) {
    if (gold22k && prev.gold22k) goldDiff = gold22k - prev.gold22k;
    if (nifty && prev.nifty) niftyDiff = nifty - prev.nifty;
  }

  // Persist today's values (update only if fetched successfully)
  saveCache({
    date: todayIST,
    gold22k: gold22k ?? prev?.gold22k ?? 0,
    nifty: nifty ?? prev?.nifty ?? 0,
  });

  // Build context string for Claude tip
  const goldCtx = gold22k
    ? `Gold 22K ₹${gold22k.toLocaleString("en-IN")}/g${goldDiff !== null ? ` (${goldDiff >= 0 ? "up" : "down"} ₹${Math.abs(goldDiff).toLocaleString("en-IN")}/g)` : ""}`
    : "";
  const niftyCtx = nifty
    ? `Nifty 50 ${nifty.toLocaleString("en-IN")}${niftyDiff !== null ? ` (${niftyDiff >= 0 ? "up" : "down"} ${Math.abs(niftyDiff).toLocaleString("en-IN")} pts)` : ""}`
    : "";

  // Check if market has a significant move worth calling out
  const goldSignificant = goldDiff !== null && Math.abs(goldDiff) >= 100; // ₹100/g swing
  const niftySignificant = niftyDiff !== null && Math.abs(niftyDiff / (nifty ?? 1)) >= 0.02; // 2%+ move
  const marketNote = (goldSignificant || niftySignificant)
    ? `Today's notable move: ${[goldCtx, niftyCtx].filter(Boolean).join(", ")}. You can reference this if it directly connects to the tip.`
    : "";

  const tip = await generateStructured(
    `Give ONE practical, specific investment or personal finance tip for a Tamil young adult (age 20-35) in India.

${marketNote}

Rules:
- Write in Tanglish (Tamil in English letters)
- 2-3 sentences MAX
- Rotate across these topics naturally (don't always pick the same one): SIP investing, index funds, emergency fund, term insurance, gold ETF vs physical gold, avoiding lifestyle inflation, credit score, UPI/digital safety, tax saving (80C/NPS), debt repayment, tracking expenses, salary negotiation, side income ideas
- Must be actionable and specific — not generic ("invest wisely" is not acceptable)
- Surprise them with something non-obvious or often overlooked
- Only mention today's market data if there's a significant move AND the tip directly connects to it
- No disclaimers, no "this is not financial advice"

Output: Just the tip text, nothing else.`
  );

  // ── Format message ──
  let msg = `💰 *DAILY MARKET UPDATE*\n`;
  const dateLabel = new Date(Date.now() + 5.5 * 60 * 60 * 1000)
    .toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  msg += `_${dateLabel}_\n\n`;

  if (gold22k) {
    msg += `🥇 *Gold 22K:* ₹${gold22k.toLocaleString("en-IN")}/g`;
    if (goldDiff !== null) msg += `  ${diffLabel(goldDiff, "₹")}`;
    msg += "\n";
  }

  if (nifty) {
    msg += `📊 *Nifty 50:* ${nifty.toLocaleString("en-IN")}`;
    if (niftyDiff !== null) msg += `  ${diffLabel(niftyDiff, "")}pts`;
    msg += "\n";
  }

  if (tip) {
    msg += `\n💡 *Today's Tip:*\n${tip}`;
  }

  return msg;
}
