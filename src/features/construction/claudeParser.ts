import Anthropic from "@anthropic-ai/sdk";
import { todayISO } from "./parse.js";
import type { ParsedFund, ParsedAdd, ParsedContri, ParseResult } from "./types.js";
import { CONSTRUCTION_CATEGORIES } from "./types.js";

const ai = new Anthropic();
const CATS = CONSTRUCTION_CATEGORIES.join(", ");

export async function parseFundCommand(raw: string): Promise<ParseResult<ParsedFund>> {
  const today = todayISO();
  const KNOWN = "Madhan, Amma (and any other name the user mentions)";
  try {
    const resp = await ai.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [{
        role: "user",
        content: `Parse this construction fund contribution (money added to the project pool):
"${raw}"

Today: ${today}. Known contributors: ${KNOWN}

Extract:
- amount: number (required, parse Indian formats: 1k=1000, 1.5L=150000, 50K=50000)
- person: who is adding money (default "Madhan" if not mentioned; normalise spelling/capitalise properly)
- description: optional note (e.g. "first instalment", "advance")
- date: YYYY-MM-DD (default ${today})

IMPORTANT: Normalise person names — "madhan", "madhn", "madan" → "Madhan"; "amma", "ama" → "Amma". Use the canonical spelling.

If amount is unclear, set needsClarification=true with a short question.

Respond ONLY with JSON:
{"amount":0,"person":"Madhan","description":null,"date":"${today}","needsClarification":false}
or: {"needsClarification":true,"question":"..."}`
      }],
    });
    let text = resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "";
    text = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    const parsed = JSON.parse(text);
    if (parsed.needsClarification) return { needsClarification: true, question: parsed.question };
    const amount = Number(parsed.amount);
    if (!amount || amount <= 0) return { error: "Couldn't find the amount. Include a clear number like ₹50000 or 50k." };
    return { data: {
      amount,
      person: parsed.person || "Madhan",
      description: parsed.description || null,
      date: parsed.date || today,
    }};
  } catch {
    return { error: `Couldn't parse that.\nTry: \`!fund 50000 Amma second instalment\`` };
  }
}

export async function parseAddCommand(raw: string): Promise<ParseResult<ParsedAdd>> {
  const today = todayISO();
  let text = "";
  try {
    const resp = await ai.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: `Parse this construction expense paid FROM the project pool fund:
"${raw}"

Today: ${today}. Categories: ${CATS}

Rules:
- amount: parse Indian formats (1000, 1,000, 1000rs, 1k=1000, 1.5L=150000, 50K=50000)
- category: best match from the list above
- description: concise what/for what
- date: YYYY-MM-DD (default ${today})
- paidBy: who paid, default "Madhan"

If amount is ambiguous, set needsClarification=true with a short question.

Respond ONLY with JSON (no prose):
{"amount":0,"category":"...","description":"...","date":"...","paidBy":"...","needsClarification":false}
or: {"needsClarification":true,"question":"..."}`
      }],
    });
    text = resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "";
    // strip possible markdown fences
    text = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    const parsed = JSON.parse(text);
    if (parsed.needsClarification) return { needsClarification: true, question: parsed.question };
    const amount = Number(parsed.amount);
    if (!amount || amount <= 0) return { error: "Couldn't find the amount. Include a clear number like ₹5000 or 5k." };
    return { data: {
      amount,
      category: parsed.category || "Misc",
      description: parsed.description || raw,
      date: parsed.date || today,
      paidBy: parsed.paidBy || "Madhan",
    }};
  } catch {
    return { error: `Couldn't parse that.\nTry: \`!add 5000 labor daily wages\`` };
  }
}

export async function parseContriCommand(raw: string): Promise<ParseResult<ParsedContri>> {
  const today = todayISO();
  let text = "";
  try {
    const resp = await ai.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: `Parse this external contribution to a construction project. The person paid from THEIR OWN POCKET (not the project fund):
"${raw}"

Today: ${today}. Categories: ${CATS}

Extract:
- amount: number (required)
- person: name of who paid (required)
- category: what was it for (from list above)
- description: concise description
- date: YYYY-MM-DD (default ${today})

If person or amount is unclear, set needsClarification=true with a short question.

Respond ONLY with JSON:
{"amount":0,"person":"...","category":"...","description":"...","date":"...","needsClarification":false}
or: {"needsClarification":true,"question":"..."}`
      }],
    });
    text = resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "";
    text = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    const parsed = JSON.parse(text);
    if (parsed.needsClarification) return { needsClarification: true, question: parsed.question };
    const amount = Number(parsed.amount);
    if (!amount || amount <= 0) return { error: "Couldn't determine the amount." };
    if (!parsed.person) return { error: "Who contributed? Please mention the person's name." };
    return { data: {
      amount,
      person: parsed.person,
      category: parsed.category || "Misc",
      description: parsed.description || raw,
      date: parsed.date || today,
    }};
  } catch {
    return { error: `Couldn't parse that.\nTry: \`!contri Rajasekar paid borewell 20000\`` };
  }
}

// ── Image-based bulk parsers ──────────────────────────────────────────────────

export async function parseImageFundEntries(
  imageBase64: string,
  mimeType: string,
): Promise<ParsedFund[]> {
  const today = todayISO();
  const resp = await ai.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1500,
    messages: [{
      role: "user",
      content: [
        {
          type: "image",
          source: { type: "base64", media_type: mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: imageBase64 },
        },
        {
          type: "text",
          text: `This is a handwritten list of fund contributions to a house construction project in Tamil Nadu.

Extract ALL fund/income entries from the image. For each entry return:
- amount: number in rupees (Indian format: 1,00,000 = 100000; 50,000 = 50000; 5,54,000 = 554000)
- person: who contributed. Normalise: "madhan/maddy/madan/krishna madhan" → "Madhan"; "amma/mom/mother" → "Amma"; "raja/rajan" → "Raja"; keep others as written (capitalise first letter)
- description: brief note (e.g. "cash", "borewell advance", "first instalment") — null if none
- date: YYYY-MM-DD. If DD/MM/YY seen convert to full year (e.g. 25/03/26 → 2026-03-25). Default: ${today}

Skip any rows that are clearly headings/totals (no amount).

Today: ${today}

Respond ONLY with JSON — no prose, no markdown:
{"entries":[{"amount":0,"person":"Madhan","description":null,"date":"${today}"}]}`,
        },
      ],
    }],
  });
  const raw = resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "";
  const cleaned = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
  const parsed = JSON.parse(cleaned) as { entries: ParsedFund[] };
  return (parsed.entries ?? []).filter(e => Number(e.amount) > 0);
}

export async function parseImageExpenseEntries(
  imageBase64: string,
  mimeType: string,
): Promise<ParsedAdd[]> {
  const today = todayISO();
  const resp = await ai.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2000,
    messages: [{
      role: "user",
      content: [
        {
          type: "image",
          source: { type: "base64", media_type: mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: imageBase64 },
        },
        {
          type: "text",
          text: `This is a handwritten list of construction project expenses.

Extract ALL expense entries. For each entry return:
- amount: number in rupees (Indian format: 1,00,000 = 100000; commas are separators)
- category: best match from: ${CATS}
- description: concise what/for what (clean up abbreviations, e.g. "EB connection 3 phase" not "EB con 3 ph")
- date: YYYY-MM-DD — use ${today} if not shown
- paidBy: who paid — default "Madhan" if unclear

Skip headings/total rows. If amount is unclear or illegible, skip that row.

Today: ${today}

Respond ONLY with JSON — no prose, no markdown:
{"entries":[{"amount":0,"category":"Misc","description":"","date":"${today}","paidBy":"Madhan"}]}`,
        },
      ],
    }],
  });
  const raw = resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "";
  const cleaned = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
  const parsed = JSON.parse(cleaned) as { entries: ParsedAdd[] };
  return (parsed.entries ?? []).filter(e => Number(e.amount) > 0);
}
