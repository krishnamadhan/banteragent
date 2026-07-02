/**
 * src/features/rcb-finals.ts
 *
 * Live commentary generator for IPL 2026 Final (RCB vs GT).
 * Fetches Cricbuzz live data, detects notable events, and generates
 * unhinged superstitious RCB fan reactions via Claude Haiku.
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const STATE_FILE = join(process.env.HOME ?? "/home/pi", "banteragent/data/rcb-finals-state.json");
const MATCH_ID = "155409";
const RATE_LIMIT_PER_HOUR = 4;

interface FinalsState {
  innings_id: number;
  runs: number;
  wickets: number;
  recent_ovs: string;
  striker_name: string;
  striker_runs: number;
  msg_count: number;
  msg_hour: string; // IST hour key like "2026-05-31T19"
}

function defaultState(): FinalsState {
  return {
    innings_id: 0,
    runs: 0,
    wickets: 0,
    recent_ovs: "",
    striker_name: "",
    striker_runs: 0,
    msg_count: 0,
    msg_hour: "",
  };
}

function loadState(): FinalsState {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, "utf8")) as FinalsState;
    }
  } catch {
    // fall through to default
  }
  return defaultState();
}

function saveState(state: FinalsState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function getISTHourKey(): string {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  // Format: "2026-05-31T19"
  return ist.toISOString().slice(0, 13);
}

function isRateLimited(state: FinalsState): boolean {
  const currentHour = getISTHourKey();
  if (state.msg_hour !== currentHour) return false; // new hour resets
  return state.msg_count >= RATE_LIMIT_PER_HOUR;
}

function bumpCount(state: FinalsState): void {
  const currentHour = getISTHourKey();
  if (state.msg_hour !== currentHour) {
    state.msg_hour = currentHour;
    state.msg_count = 1;
  } else {
    state.msg_count++;
  }
}

// Count occurrences of a token (e.g. "6", "4", "W") in a string segment
function countToken(segment: string, token: string): number {
  return segment.split(token).length - 1;
}

// Isolate newly appended portion of recentOvsStats compared to previous
function getNewSegment(oldStr: string, newStr: string): string {
  if (!oldStr) return newStr;
  if (newStr === oldStr) return "";
  // New segment is whatever comes after the old string if it's a prefix, else full new string
  if (newStr.startsWith(oldStr)) return newStr.slice(oldStr.length);
  return newStr;
}

export async function rcbFinalsCommentary(): Promise<string | null> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return null;

  // Fetch live match data
  let matchData: any;
  try {
    const response = await fetch(
      `https://cricbuzz-cricket.p.rapidapi.com/mcenter/v1/${MATCH_ID}/leanback`,
      {
        headers: {
          "X-RapidAPI-Key": apiKey,
          "X-RapidAPI-Host": "cricbuzz-cricket.p.rapidapi.com",
        },
      }
    );
    if (!response.ok) return null;
    matchData = await response.json();
  } catch {
    return null;
  }

  const miniscore = matchData?.miniscore;
  if (!miniscore) return null;

  const batTeam     = (miniscore.batteamscore?.teamscore ?? 0) as number;
  const batWkts     = (miniscore.batteamscore?.teamwkts ?? 0) as number;
  // RCB teamid = 59 (from Cricbuzz), GT = 971
  const batTeamId   = (miniscore.batteamscore?.teamid ?? 0) as number;
  const recentOvs   = (miniscore.curovsstats ?? "") as string;
  const inningsId   = (miniscore.inningsid ?? 0) as number;
  const strikerName = (miniscore.batsmanstriker?.name ?? "") as string;
  const strikerRuns = (miniscore.batsmanstriker?.runs ?? 0) as number;
  const lastWicket  = (miniscore.lastwkt ?? "") as string;

  const state = loadState();

  // Detect events
  const isRCBBatting = batTeamId === 59; // RCB teamid in Cricbuzz
  const newSegment = getNewSegment(state.recent_ovs, recentOvs);
  const ovsChanged = recentOvs !== state.recent_ovs;

  const sixes    = ovsChanged ? countToken(newSegment, "6") : 0;
  const fours    = ovsChanged ? countToken(newSegment, "4") : 0;
  const newWicket = batWkts > state.wickets ||
    (inningsId !== state.innings_id && batWkts > 0);

  // Milestone detection: striker crossed 50 or 100
  const prevRuns   = state.striker_name === strikerName ? state.striker_runs : 0;
  const milestone50  = prevRuns < 50 && strikerRuns >= 50;
  const milestone100 = prevRuns < 100 && strikerRuns >= 100;

  const hasEvent = sixes > 0 || fours > 0 || newWicket || milestone50 || milestone100;

  if (!hasEvent) {
    // Update non-event state fields anyway
    if (ovsChanged || inningsId !== state.innings_id) {
      state.innings_id   = inningsId;
      state.runs         = batTeam;
      state.wickets      = batWkts;
      state.recent_ovs   = recentOvs;
      state.striker_name = strikerName;
      state.striker_runs = strikerRuns;
      saveState(state);
    }
    return null;
  }

  if (isRateLimited(state)) {
    // Still update state even if rate-limited
    state.innings_id   = inningsId;
    state.runs         = batTeam;
    state.wickets      = batWkts;
    state.recent_ovs   = recentOvs;
    state.striker_name = strikerName;
    state.striker_runs = strikerRuns;
    saveState(state);
    return null;
  }

  // Build event description (batting team short name)
  const team = isRCBBatting ? "RCB" : "GT";
  const parts: string[] = [];

  if (newWicket) {
    const wicketDesc = lastWicket ? ` — ${lastWicket}` : "";
    parts.push(`${team} wicket fell${wicketDesc}`);
  }
  if (sixes > 0) {
    const who = strikerName ? `${strikerName} (${team})` : team;
    parts.push(`${who} hit ${sixes === 1 ? "a six" : `${sixes} sixes`}`);
  }
  if (fours > 0) {
    const who = strikerName ? `${strikerName} (${team})` : team;
    parts.push(`${who} hit ${fours === 1 ? "a four" : `${fours} fours`}`);
  }
  if (milestone50) {
    parts.push(`${strikerName} (${team}) reached 50 runs`);
  }
  if (milestone100) {
    parts.push(`${strikerName} (${team}) reached 100 runs — CENTURY!`);
  }

  const eventDescription = parts.join("; ");

  // Call Claude Haiku
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return null;

  const client = new Anthropic({ apiKey: anthropicKey });
  let commentary: string | null = null;

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
      system: `You are a supremely confident, slightly arrogant RCB fan in a Tamil WhatsApp group reacting live to the IPL 2026 Final (RCB vs GT). Tanglish only (Tamil words in English letters). Max 3 lines. Max 2 emojis. NEVER repeat the same phrasing — be creative, varied, situation-specific each time.

You are NEVER rattled. You always knew this would happen. Everything is going to plan.

SITUATION-BASED reactions (vary wildly):

GT six/four:
- Dismiss it like it's nothing ("oru boundary-ku excited aaguteenga? cute 🙄")
- Already predicted it ("yeah yeah let them have their moment, scripted aachu")
- Condescending calm ("relax pa, Kohli era-la ithellam routine")
- Mock sympathy for GT fans ("enjoy pannunga, it's their last one for a while")

GT wicket (RCB bowling):
- Smug satisfaction, acting like you called it ("told you. TOLD you. next one also going same way")
- Chess master energy ("we set the trap 3 overs ago, now see")
- Pure swagger ("GT came to the final just to watch how it's done")

RCB wicket (bad for RCB):
- Don't panic, recalibrate confidently ("score adjust panrom, still our game to lose")
- Tactical dismissal ("plan B already ready, chill")
- Shade at the GT player ("he got lucky, won't happen again")
- Rare — one moment of real worry, but cover it fast ("...ok ok we're fine. we're fine. WE'RE FINE.")

RCB six/four:
- Pure unbothered swagger ("apdiye expect panni irunden 😎")
- Make it about RCB's legacy ("this is what generational talent looks like, take notes")
- Taunt GT softly ("yen da captain-a fielding adjust pannala? overconfident 🫡")

Milestones (50/100):
- RCB: Royalty energy ("of course century. this is RCB. this is Chinnaswamy-level class")
- GT: Begrudging respect, but pivot to RCB supremacy ("decent innings but wait for our reply")

Keep it WhatsApp-authentic — punchy, bold, like someone who has been waiting 18 years for this and refuses to act surprised that it's finally happening.`,
      messages: [{ role: "user", content: `Score: ${isRCBBatting ? "RCB" : "GT"} ${batTeam}/${batWkts}. Event: ${eventDescription}` }],
    });

    const content = message.content[0];
    if (content?.type === "text") {
      commentary = content.text.trim();
    }
  } catch {
    return null;
  }

  // Update state
  state.innings_id   = inningsId;
  state.runs         = batTeam;
  state.wickets      = batWkts;
  state.recent_ovs   = recentOvs;
  state.striker_name = strikerName;
  state.striker_runs = strikerRuns;
  bumpCount(state);
  saveState(state);

  return commentary;
}
