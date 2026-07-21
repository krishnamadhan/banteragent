// Health feature — main entry point (AB-078, AB-083)
// Called by listener.ts for all health-group messages and images.
// SECURITY: raw photos deleted after analysis; untrusted input never reaches system prompts.

import type { PersonKey, HealthProfile } from "./types.js";
import { getHealthProfile, hasConsent, needsOnboarding, insertHealthEvent, correctHealthEvent, getTodayFoodEvents } from "./db.js";
import { getOnboardingPrompt, handleConsentStep, parseSafetyScreen, parsePrivacyChange, CONSENT_DECLINED } from "./consent.js";
import { logFoodFromPhoto, logFoodFromText, applyCorrectionToCache } from "./food.js";
import { resolveAttribution, getPendingMeal, storePendingMeal, clearPendingMeal, parseTimeOverride } from "./attribution.js";
import { classifyIntent } from "./router.js";
import { parseMetric, parseUndoRequest, parseEditRequest, needsConfirmation, plausibilityWarning } from "./parsers.js";
import {
  handleMetricLog, handleUndo, handleProfileInput, handleCoachQuestion,
  handleExport, handleDeleteData, HEALTH_HELP,
} from "./commands.js";
import { buildHealthInstructorPrompt } from "./healthPrompts.js";

// Resolve sender phone to person key. Reads from env at runtime (no restart needed).
function resolvePersonKey(senderPhone: string): PersonKey | null {
  const krishnaPhone = (process.env.BOT_HEALTH_KRISHNA_PHONE ?? "").replace(/\D/g, "");
  const indhuPhone   = (process.env.BOT_HEALTH_INDHU_PHONE   ?? "").replace(/\D/g, "");
  const senderDigits = senderPhone.replace(/\D/g, "").replace(/@c\.us$/, "");

  if (krishnaPhone && senderDigits.endsWith(krishnaPhone)) return "krishna";
  if (indhuPhone   && senderDigits.endsWith(indhuPhone))   return "indhu";
  return null;
}

// ── Photo handler (called by listener.ts) ─────────────────────────────────────────

export async function handleHealthImage(
  rawMsg: any,
  senderPhone: string,
  caption: string,
  messageId: string,
  groupId: string,
): Promise<void> {
  const person = resolvePersonKey(senderPhone);
  if (!person) {
    await rawMsg.reply("I don't recognise this number. Please ask Madhan to set BOT_HEALTH_KRISHNA_PHONE / BOT_HEALTH_INDHU_PHONE.");
    return;
  }

  const onboardingStep = await needsOnboarding(person);
  if (onboardingStep) {
    const prompt = await getOnboardingPrompt(person);
    if (prompt) await rawMsg.reply(prompt);
    return;
  }

  const profiles = await loadProfiles();

  // Try food photo logging
  try {
    const media = await rawMsg.downloadMedia();
    if (!media?.data) {
      await rawMsg.reply("❌ Couldn't download the image. Try again.");
      return;
    }

    await rawMsg.reply("🔍 Analysing...");
    const { result, receipt } = await logFoodFromPhoto(media.data, media.mimetype ?? "image/jpeg", caption, person);
    // raw image data is not persisted — media.data goes out of scope here

    if (!result) {
      await rawMsg.reply(receipt);
      return;
    }

    // Attribution resolution
    const { meals, askQuestion } = resolveAttribution(person, caption, undefined, result);

    if (askQuestion) {
      // Two-plate: store pending, ask
      storePendingMeal(messageId, person, result, messageId);
      await rawMsg.reply(receipt + "\n\n" + askQuestion);
      return;
    }

    // Log each attributed meal
    const now = new Date().toISOString();
    const timeOverride = parseTimeOverride(caption, Date.now());

    for (const meal of meals) {
      await insertHealthEvent({
        person: meal.person,
        type: "food",
        occurred_at: timeOverride ?? now,
        logged_at: now,
        timezone: "Asia/Kolkata",
        source_message_id: messageId + "_" + meal.person,
        source_type: "photo",
        payload: {
          items: meal.food_result.items,
          total_est_kcal_low:  meal.food_result.total_est_kcal_low,
          total_est_kcal_high: meal.food_result.total_est_kcal_high,
          total_protein_g:     meal.food_result.total_protein_g,
          confidence:          meal.food_result.confidence,
          parse_type:          "vision",
        },
        attribution_method: meal.attribution_method,
        confidence: meal.food_result.confidence,
        est_low:  meal.food_result.total_est_kcal_low,
        est_high: meal.food_result.total_est_kcal_high,
        model_version: "claude-haiku-4-5",
        nutrition_reference: null,
        supersedes_id: null,
        deleted_at: null,
      });
    }

    await rawMsg.reply(receipt);
  } catch (e) {
    console.error("[health] handleHealthImage error:", e);
    await rawMsg.reply("❌ Analysis failed. Please try again.");
  }
}

// ── Text message handler (called by listener.ts) ──────────────────────────────────

export async function handleHealthMessage(
  rawMsg: any,
  senderPhone: string,
  text: string,
  messageId: string,
  quotedMessageId: string | undefined,
): Promise<void> {
  const person = resolvePersonKey(senderPhone);
  if (!person) {
    // Not a tracked person — ignore silently in health group
    return;
  }

  const t = text.trim();
  const tLower = t.toLowerCase();

  // ── Onboarding flow ─────────────────────────────────────────────────────────────
  const onboardingStep = await needsOnboarding(person);
  if (onboardingStep) {
    // Handle !consent and !screen replies
    const consentReply = await handleConsentStep(person, t);
    if (consentReply) {
      await rawMsg.reply(consentReply);
      return;
    }

    // If we're at the profile step, parse profile input
    if (onboardingStep === "profile" && !tLower.startsWith("!")) {
      const profileReply = await handleProfileInput(person, t);
      await rawMsg.reply(profileReply);
      return;
    }

    // Otherwise remind them of the current step
    const prompt = await getOnboardingPrompt(person);
    if (prompt) await rawMsg.reply(prompt);
    return;
  }

  // ── Privacy change ──────────────────────────────────────────────────────────────
  if (tLower.startsWith("!privacy")) {
    const mode = parsePrivacyChange(t);
    if (mode) {
      const { upsertHealthProfile } = await import("./db.js");
      await upsertHealthProfile(person, { privacy_mode: mode } as Partial<HealthProfile>);
      await rawMsg.reply(`✅ Privacy mode updated to: *${mode}*`);
      return;
    }
  }

  // ── Export / delete (AB-085) ───────────────────────────────────────────────────
  if (tLower.startsWith("!export")) {
    await rawMsg.reply(await handleExport(person));
    return;
  }
  if (tLower.startsWith("!delete my health")) {
    await rawMsg.reply(await handleDeleteData(person));
    return;
  }

  // ── Help ────────────────────────────────────────────────────────────────────────
  if (tLower === "!help" || tLower === "!health help") {
    await rawMsg.reply(HEALTH_HELP);
    return;
  }

  // ── Explicit metric commands ────────────────────────────────────────────────────
  if (/^!(weight|wt|sleep|steps|st|workout|ex|water|food)\b/i.test(t)) {
    const reply = await handleMetricLog(person, t, messageId);
    await rawMsg.reply(reply);
    return;
  }

  // ── Undo ───────────────────────────────────────────────────────────────────────
  if (parseUndoRequest(t)) {
    await rawMsg.reply(await handleUndo(person, messageId));
    return;
  }

  // ── Correction ─────────────────────────────────────────────────────────────────
  if (/^!(correct|edit|fix)\b/i.test(t)) {
    const edit = parseEditRequest(t);
    if (edit?.dishName && edit.correctedKcal) {
      await applyCorrectionToCache(edit.dishName, edit.correctedKcal, edit.correctedProtein ?? 0);
      await rawMsg.reply(`✅ Got it — "${edit.dishName}" updated to ${edit.correctedKcal} kcal. Future logs will use this.`);
      return;
    }
  }

  // ── Profile update ─────────────────────────────────────────────────────────────
  if (tLower.startsWith("!profile")) {
    if (tLower === "!profile" || tLower === "!profile update") {
      await rawMsg.reply("Send your updated profile details:\n*Sex, Age, Height, Weight, Goal weight, Activity level*");
      return;
    }
    // Profile data inline with command
    const profileText = t.replace(/^!profile\s*/i, "");
    await rawMsg.reply(await handleProfileInput(person, profileText));
    return;
  }

  // ── Report on demand ───────────────────────────────────────────────────────────
  if (/^!(report|summary)\b/i.test(t)) {
    const { buildDailyProvisionalReport } = await import("./reports.js");
    await rawMsg.reply(await buildDailyProvisionalReport());
    return;
  }

  // ── Plan ───────────────────────────────────────────────────────────────────────
  if (tLower.startsWith("!plan")) {
    const profiles = await loadProfiles();
    await rawMsg.reply(await handleCoachQuestion("Create a simple meal and movement plan for today.", person, profiles));
    return;
  }

  // ── Pending meal attribution reply ─────────────────────────────────────────────
  if (quotedMessageId) {
    const pending = getPendingMeal(quotedMessageId);
    if (pending) {
      const { meals, askQuestion } = resolveAttribution(person, t, quotedMessageId, pending.food_result);
      if (!askQuestion && meals.length > 0) {
        clearPendingMeal(quotedMessageId);
        const now = new Date().toISOString();
        for (const meal of meals) {
          await insertHealthEvent({
            person: meal.person,
            type: "food",
            occurred_at: now,
            logged_at: now,
            timezone: "Asia/Kolkata",
            source_message_id: messageId + "_attr_" + meal.person,
            source_type: "command",
            payload: { ...meal.food_result, attribution_resolved: true },
            attribution_method: meal.attribution_method,
            confidence: meal.food_result.confidence,
            est_low:  meal.food_result.total_est_kcal_low,
            est_high: meal.food_result.total_est_kcal_high,
            model_version: null,
            nutrition_reference: null,
            supersedes_id: null,
            deleted_at: null,
          });
        }
        await rawMsg.reply(`✅ Logged for: ${meals.map(m => m.person === "krishna" ? "Krishna" : "Indhu").join(" & ")}`);
        return;
      }
    }
  }

  // ── NL food log or question (intent classify) ──────────────────────────────────
  const profiles = await loadProfiles();
  const intent = await classifyIntent(t, person);

  if (intent.intent === "log") {
    // Try metric parse first
    const metric = parseMetric(t);
    if (metric) {
      if (needsConfirmation(metric.type, metric.value)) {
        await rawMsg.reply(`⚠️ ${plausibilityWarning(metric.type, metric.value)}\nReply *!confirm* to log it.`);
        return;
      }
      const reply = await handleMetricLog(person, t, messageId);
      await rawMsg.reply(reply);
      return;
    }

    // Otherwise assume food NL
    const { result, receipt } = await logFoodFromText(t, person);
    if (!result) {
      await rawMsg.reply(receipt);
      return;
    }

    const { meals, askQuestion } = resolveAttribution(person, t, undefined, result);
    if (askQuestion) {
      storePendingMeal(messageId, person, result, messageId);
      await rawMsg.reply(receipt + "\n\n" + askQuestion);
      return;
    }

    const now = new Date().toISOString();
    const timeOverride = parseTimeOverride(t, Date.now());

    for (const meal of meals) {
      await insertHealthEvent({
        person: meal.person,
        type: "food",
        occurred_at: timeOverride ?? now,
        logged_at: now,
        timezone: "Asia/Kolkata",
        source_message_id: messageId + "_nl_" + meal.person,
        source_type: "text",
        payload: {
          raw_text: t.slice(0, 200),
          items: meal.food_result.items,
          total_est_kcal_low:  meal.food_result.total_est_kcal_low,
          total_est_kcal_high: meal.food_result.total_est_kcal_high,
          total_protein_g:     meal.food_result.total_protein_g,
          confidence:          meal.food_result.confidence,
          parse_type:          "nl",
        },
        attribution_method: meal.attribution_method,
        confidence: meal.food_result.confidence,
        est_low:  meal.food_result.total_est_kcal_low,
        est_high: meal.food_result.total_est_kcal_high,
        model_version: "claude-haiku-4-5",
        nutrition_reference: null,
        supersedes_id: null,
        deleted_at: null,
      });
    }

    await rawMsg.reply(receipt);
    return;
  }

  if (intent.intent === "question" || intent.intent === "plan") {
    const answer = await handleCoachQuestion(t, person, profiles);
    await rawMsg.reply(answer);
    return;
  }

  if (intent.intent === "report") {
    const { buildDailyProvisionalReport } = await import("./reports.js");
    await rawMsg.reply(await buildDailyProvisionalReport());
    return;
  }

  // non_health: ignore (don't respond to general chat in health group)
}

async function loadProfiles(): Promise<Partial<Record<PersonKey, HealthProfile>>> {
  const [k, i] = await Promise.all([getHealthProfile("krishna"), getHealthProfile("indhu")]);
  const out: Partial<Record<PersonKey, HealthProfile>> = {};
  if (k) out.krishna = k;
  if (i) out.indhu = i;
  return out;
}

// ── Scheduler task handlers (AB-084) ─────────────────────────────────────────────

export async function runHealthDailyProvisional(): Promise<string> {
  const { buildDailyProvisionalReport } = await import("./reports.js");
  return buildDailyProvisionalReport();
}

export async function runHealthDailyFinal(): Promise<string> {
  const { buildDailyFinalReport } = await import("./reports.js");
  const yesterday = new Date(Date.now() + 5.5 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  return buildDailyFinalReport(yesterday);
}

export async function runHealthWeekly(): Promise<string> {
  const { buildWeeklyReport } = await import("./reports.js");
  return buildWeeklyReport();
}
