/**
 * Daily Finance Update — Gold 22K rate + Sensex with day-over-day diff
 * Data source: Yahoo Finance (free, no API key)
 * Cache: ./data/finance-cache.json (persists previous day for diff calc)
 */

import fs from "fs";
import path from "path";
import { generateStructured } from "../claude.js";

const CACHE_FILE = "./data/finance-cache.json";

interface FinanceCache {
  date: string;       // YYYY-MM-DD IST
  gold22k: number;    // ₹ per 10g
  sensex: number;     // index value
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

async function fetchGold22k(): Promise<number | null> {
  // Gold futures (USD/troy oz) + USD→INR conversion → 22K per 10g
  const [goldUSD, usdINR] = await Promise.all([
    yahooPrice("GC=F"),
    yahooPrice("USDINR=X"),
  ]);
  if (!goldUSD || !usdINR) return null;
  const gold24kPerGram = (goldUSD * usdINR) / 31.1035;
  return Math.round(gold24kPerGram * (22 / 24) * 10);
}

async function fetchSensex(): Promise<number | null> {
  const price = await yahooPrice("^BSESN");
  return price ? Math.round(price) : null;
}

function diffLabel(diff: number, unit: string): string {
  const sign = diff >= 0 ? "+" : "-";
  const abs = Math.abs(diff).toLocaleString("en-IN");
  const arrow = diff >= 0 ? "📈" : "📉";
  return `${arrow} ${sign}${unit}${abs}`;
}

export async function sendFinanceUpdate(): Promise<string | null> {
  const [gold22k, sensex] = await Promise.all([fetchGold22k(), fetchSensex()]);

  if (!gold22k && !sensex) {
    console.error("[finance] Both gold and Sensex fetch failed");
    return null;
  }

  // IST today string
  const todayIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000)
    .toISOString().split("T")[0]!;

  const prev = loadCache();
  const isNewDay = !prev || prev.date !== todayIST;

  let goldDiff: number | null = null;
  let sensexDiff: number | null = null;

  if (isNewDay && prev) {
    if (gold22k && prev.gold22k) goldDiff = gold22k - prev.gold22k;
    if (sensex && prev.sensex) sensexDiff = sensex - prev.sensex;
  }

  // Persist today's values (update only if fetched successfully)
  saveCache({
    date: todayIST,
    gold22k: gold22k ?? prev?.gold22k ?? 0,
    sensex: sensex ?? prev?.sensex ?? 0,
  });

  // Build context string for Claude tip
  const goldCtx = gold22k
    ? `Gold 22K ₹${gold22k.toLocaleString("en-IN")}/10g${goldDiff !== null ? ` (${goldDiff >= 0 ? "up" : "down"} ₹${Math.abs(goldDiff).toLocaleString("en-IN")})` : ""}`
    : "";
  const sensexCtx = sensex
    ? `Sensex ${sensex.toLocaleString("en-IN")}${sensexDiff !== null ? ` (${sensexDiff >= 0 ? "up" : "down"} ${Math.abs(sensexDiff).toLocaleString("en-IN")} pts)` : ""}`
    : "";

  const tip = await generateStructured(
    `Give ONE practical, specific investment or personal finance tip for a Tamil young adult (age 20-35) in India today.
Market context: ${[goldCtx, sensexCtx].filter(Boolean).join(", ")}.

Rules:
- Write in Tanglish (Tamil in English letters)
- 2-3 sentences MAX
- Must be actionable (e.g. "Indha week SIP amount double pannu", "Gold ETF vs physical gold — idhu nalla time", "Emergency fund 3 months expense ready-aa?")
- Reference today's market data naturally if relevant
- Genuinely useful, not generic — surprise them with something specific
- No disclaimers, no "this is not financial advice"

Output: Just the tip text, nothing else.`
  );

  // ── Format message ──
  let msg = `💰 *DAILY MARKET UPDATE*\n`;
  const dateLabel = new Date(Date.now() + 5.5 * 60 * 60 * 1000)
    .toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  msg += `_${dateLabel}_\n\n`;

  if (gold22k) {
    msg += `🥇 *Gold 22K:* ₹${gold22k.toLocaleString("en-IN")}/10g`;
    if (goldDiff !== null) msg += `  ${diffLabel(goldDiff, "₹")}`;
    msg += "\n";
  }

  if (sensex) {
    msg += `📊 *Sensex:* ${sensex.toLocaleString("en-IN")}`;
    if (sensexDiff !== null) msg += `  ${diffLabel(sensexDiff, "")}pts`;
    msg += "\n";
  }

  if (tip) {
    msg += `\n💡 *Today's Tip:*\n${tip}`;
  }

  return msg;
}
