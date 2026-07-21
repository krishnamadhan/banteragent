// Health feature — intent router + message dispatch (AB-083)
// Model returns candidate JSON; app validates and acts. Fuzzy PARSE not fuzzy EXECUTE.

import Anthropic from "@anthropic-ai/sdk";
import type { PersonKey, IntentClassification, IntentLabel } from "./types.js";
import { INTENT_ROUTER_SYSTEM_PROMPT } from "./healthPrompts.js";

const anthropic = new Anthropic();
const MODEL = "claude-haiku-4-5-20251001";

// ── Intent classification ─────────────────────────────────────────────────────────

function validateIntentResponse(raw: unknown): IntentClassification | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const validIntents: IntentLabel[] = ["log", "question", "plan", "correction", "attribution", "report", "non_health"];
  if (!validIntents.includes(o.intent as IntentLabel)) return null;

  return {
    intent: o.intent as IntentLabel,
    confidence: o.confidence === "high" ? "high" : "low",
    target_person: ["krishna", "indhu", "both"].includes(o.target_person as string)
      ? o.target_person as PersonKey | "both"
      : undefined,
  };
}

export async function classifyIntent(
  text: string,
  senderPerson: PersonKey,
): Promise<IntentClassification> {
  // Fast path: explicit commands bypass LLM
  const t = text.trim().toLowerCase();
  if (t.startsWith("!weight") || t.startsWith("!wt"))   return { intent: "log", confidence: "high", target_person: senderPerson };
  if (t.startsWith("!sleep"))                            return { intent: "log", confidence: "high", target_person: senderPerson };
  if (t.startsWith("!steps") || t.startsWith("!st"))    return { intent: "log", confidence: "high", target_person: senderPerson };
  if (t.startsWith("!workout") || t.startsWith("!ex"))  return { intent: "log", confidence: "high", target_person: senderPerson };
  if (t.startsWith("!water"))                           return { intent: "log", confidence: "high", target_person: senderPerson };
  if (t.startsWith("!food"))                            return { intent: "log", confidence: "high", target_person: senderPerson };
  if (t.startsWith("!report") || t.startsWith("!summary")) return { intent: "report", confidence: "high" };
  if (t.startsWith("!undo"))                            return { intent: "correction", confidence: "high" };
  if (t.startsWith("!correct") || t.startsWith("!edit")) return { intent: "correction", confidence: "high" };
  if (t.startsWith("!plan"))                            return { intent: "plan", confidence: "high" };
  if (t.startsWith("!help"))                            return { intent: "non_health", confidence: "high" };
  if (t.startsWith("!export") || t.startsWith("!delete")) return { intent: "non_health", confidence: "high" };
  if (t.startsWith("!consent") || t.startsWith("!screen") || t.startsWith("!profile")) return { intent: "non_health", confidence: "high" };

  // LLM classification for NL messages
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 256,
      system: INTENT_ROUTER_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Sender: ${senderPerson}\nMessage: [DATA: ${text.slice(0, 500)}]` }],
    });

    const raw = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = validateIntentResponse(JSON.parse(cleaned));
    return parsed ?? { intent: "non_health", confidence: "low" };
  } catch {
    return { intent: "non_health", confidence: "low" };
  }
}
