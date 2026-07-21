// Health feature — consent + safety onboarding state machine (AB-078)
// Per-person flow: consent → safety screen → profile questionnaire.
// All state lives in ba_health_profile. No runtime in-memory map — resumable after restart.

import type { PersonKey, SafetyFlag, PrivacyMode } from "./types.js";
import { getHealthProfile, upsertHealthProfile, needsOnboarding } from "./db.js";

// ── Consent copy (AB-078) ─────────────────────────────────────────────────────────

export const CONSENT_INTRO = `Hi! I'm your HealthTrack coach — I'll help you and your partner track food, weight, sleep, and movement together.

Before we start, I need a moment for consent and setup. This takes about 2 minutes.

*What I collect:*
• Food photos and text descriptions you send here
• Weight, sleep, steps, workout, and water entries
• Your health profile (age, height, goal weight, activity level)

*What I do with it:*
• Photos are analysed by Claude AI and then *deleted* — I only keep the structured data (calories, macros)
• Data is stored securely in an encrypted database
• Your partner can see your logged habits (you can choose what's private — details below)
• I send daily progress summaries and a weekly reflection to this group

*What I don't do:*
• I don't share your data with anyone outside this group
• I don't diagnose medical conditions or replace medical advice
• I don't use your data to train AI models

*Privacy options:*
1️⃣ *Full sharing* — both see everything (calories, weight, vitals)
2️⃣ *Habits shared, vitals private* — partner sees food/steps/sleep but not your weight _(recommended)_
3️⃣ *Household summary only* — partner sees only aggregated "we hit X of 7 goals" summaries
4️⃣ *Individual* — fully private; reports sent to your DM (coming soon)

Reply with:
*!consent yes [1/2/3/4]* to agree and choose privacy mode
*!consent no* to decline (I won't track you but will still respond in the group)

_You can change your privacy mode anytime with !privacy [1-4]_`;

export const CONSENT_SAFETY_SCREEN = `Thanks! One quick safety check — I need to know if any of these apply to you.

Please reply *!screen [numbers]* with any that apply (or *!screen none*):

1. I am under 18
2. I am pregnant, trying to conceive, or breastfeeding
3. I have or have had an eating disorder
4. I use insulin, blood-sugar-lowering, or hypoglycemia medications
5. I have kidney, liver, heart, or metabolic disease

_These conditions mean I'll only track your habits — I won't prescribe calorie deficits or high-protein targets. Your doctor should set those goals._

Example: *!screen 2 4* (pregnant + on meds) or *!screen none* (none apply)`;

export const PROFILE_QUESTIONNAIRE = `Great! Now let's set up your profile so I can calculate your personalised targets.

Reply in one message with your details:
*Sex, Age, Height, Current weight, Goal weight, Activity level*

Example:
*Female, 29, 162 cm, 68 kg, 62 kg, lightly active*

Activity levels:
• *Sedentary* — mostly sitting (office work, no exercise)
• *Lightly active* — 1–3 light workouts/week or daily walking
• *Moderately active* — 3–5 workouts/week
• *Very active* — 6–7 hard workouts/week
• *Extra active* — physical job + daily training

_Measurements in metric preferred (cm, kg). Feet/inches/lbs also accepted._`;

export const CONSENT_DECLINED = `No worries — I won't track your health data. I'll still be here to answer general health questions if you'd like. You can start tracking anytime with *!consent yes*.`;

export const ONBOARDING_COMPLETE = (name: string, calLow: number, calHigh: number, protLow: number, protHigh: number, wksLow: number, wksHigh: number): string =>
  `✅ *All set, ${name}!*

Your daily targets:
🍽️ *Calories:* ${calLow}–${calHigh} kcal/day
💪 *Protein:* ${protLow}–${protHigh} g/day
🚰 Hydration target will appear in your daily report

*Expected progress:* ${wksLow}–${wksHigh} weeks (range — depends on consistency)

Start logging by:
• Sending a *food photo* anytime
• Typing *2 idli sambar coffee* or similar
• *!weight 74.2* for weight
• *!help* for all commands

I'll send a provisional check-in at 10 PM and a final daily summary each morning. Let's go! 💪`;

// ── Consent parsing ───────────────────────────────────────────────────────────────

export function parseConsentReply(text: string): { accepted: boolean; privacy_mode: PrivacyMode } | null {
  const t = text.trim().toLowerCase();
  if (!t.startsWith("!consent")) return null;

  if (t.includes("no")) {
    return { accepted: false, privacy_mode: "shared-habits-private-vitals" };
  }

  const privacyMatch = t.match(/!consent\s+yes\s+([1-4])/);
  const modeNum = privacyMatch ? parseInt(privacyMatch[1]!, 10) : 2;
  const modeMap: Record<number, PrivacyMode> = {
    1: "shared-all",
    2: "shared-habits-private-vitals",
    3: "household-summary",
    4: "individual",
  };

  return { accepted: true, privacy_mode: modeMap[modeNum] ?? "shared-habits-private-vitals" };
}

export function parseSafetyScreen(text: string): SafetyFlag[] | null {
  const t = text.trim().toLowerCase();
  if (!t.startsWith("!screen")) return null;

  if (t.includes("none")) return [];

  const flagMap: Record<number, SafetyFlag> = {
    1: "under18",
    2: "pregnancy_ttc_breastfeeding",
    3: "eating_disorder",
    4: "insulin_hypoglycemia_meds",
    5: "kidney_liver_cardiac_metabolic",
  };

  const numbers = [...t.matchAll(/[1-5]/g)].map(m => parseInt(m[0]!));
  return numbers.map(n => flagMap[n]).filter(Boolean) as SafetyFlag[];
}

export function parsePrivacyChange(text: string): PrivacyMode | null {
  const m = text.trim().toLowerCase().match(/^!privacy\s+([1-4])$/);
  if (!m) return null;
  const modeMap: Record<number, PrivacyMode> = {
    1: "shared-all",
    2: "shared-habits-private-vitals",
    3: "household-summary",
    4: "individual",
  };
  return modeMap[parseInt(m[1]!, 10)] ?? null;
}

// ── Onboarding state machine ──────────────────────────────────────────────────────

export async function getOnboardingPrompt(person: PersonKey): Promise<string | null> {
  const step = await needsOnboarding(person);
  if (step === "consent") return CONSENT_INTRO;
  if (step === "safety_screen") return CONSENT_SAFETY_SCREEN;
  if (step === "profile") return PROFILE_QUESTIONNAIRE;
  return null; // fully onboarded
}

export async function handleConsentStep(
  person: PersonKey,
  text: string,
): Promise<string | null> {
  const step = await needsOnboarding(person);
  if (!step) return null; // already onboarded

  if (step === "consent") {
    const parsed = parseConsentReply(text);
    if (!parsed) return null; // not a consent reply — let router handle

    if (!parsed.accepted) {
      await upsertHealthProfile(person, {
        person,
        consent: {
          accepted: false,
          accepted_at: new Date().toISOString(),
          data_collected_ack: false,
          partner_visibility_ack: false,
          photo_retention_ack: false,
          claude_processing_ack: false,
          storage_ack: false,
          reminders_ack: false,
          privacy_mode: "individual",
        },
        privacy_mode: "individual",
      } as Parameters<typeof upsertHealthProfile>[1]);
      return CONSENT_DECLINED;
    }

    await upsertHealthProfile(person, {
      person,
      consent: {
        accepted: true,
        accepted_at: new Date().toISOString(),
        data_collected_ack: true,
        partner_visibility_ack: true,
        photo_retention_ack: true,
        claude_processing_ack: true,
        storage_ack: true,
        reminders_ack: true,
        privacy_mode: parsed.privacy_mode,
      },
      privacy_mode: parsed.privacy_mode,
    } as Parameters<typeof upsertHealthProfile>[1]);

    return CONSENT_SAFETY_SCREEN;
  }

  if (step === "safety_screen") {
    const flags = parseSafetyScreen(text);
    if (flags === null) return null;

    await upsertHealthProfile(person, {
      screen_flags: {
        screened: true,
        screened_at: new Date().toISOString(),
        flags,
        log_only: flags.length > 0,
      },
    } as Parameters<typeof upsertHealthProfile>[1]);

    return PROFILE_QUESTIONNAIRE;
  }

  return null;
}
