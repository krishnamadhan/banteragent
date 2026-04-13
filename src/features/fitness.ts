import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "../supabase.js";
import type { BotMessage } from "../types.js";

const execFileAsync = promisify(execFile);
const MODEL = "claude-sonnet-4-20250514";
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// ===== IST week start (Monday) — same pattern as games.ts =====
function getCurrentWeekStartIST(): string {
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(Date.now() + istOffset);
  const dayOfWeek = istNow.getUTCDay();
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const mondayIST = new Date(istNow);
  mondayIST.setUTCDate(istNow.getUTCDate() - daysFromMonday);
  return mondayIST.toISOString().split("T")[0]!;
}

// ===== Extract 2fps frames using ffmpeg =====
async function extractFrames(videoPath: string, outDir: string): Promise<string[]> {
  const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";
  const pattern = path.join(outDir, "frame_%04d.jpg");

  await execFileAsync(ffmpeg, [
    "-i", videoPath,
    "-vf", "fps=2,scale=480:-1",
    "-q:v", "2",
    "-f", "image2",
    pattern,
  ], { timeout: 30_000 });

  return fs.readdirSync(outDir)
    .filter((f) => f.startsWith("frame_") && f.endsWith(".jpg"))
    .sort()
    .map((f) => path.join(outDir, f));
}

// ===== Build frame grid with sharp =====
async function buildGrid(framePaths: string[]): Promise<Buffer> {
  // Dynamic import so the module loads fine even before npm install
  const { default: sharp } = await import("sharp");

  const COLS = 4;
  const THUMB_W = 240; // smaller thumbs so 2fps grid stays manageable
  const THUMB_H = 180;
  const rows = Math.ceil(framePaths.length / COLS);

  const compositeOps = await Promise.all(
    framePaths.map(async (fp, i) => {
      const resized = await sharp(fp)
        .resize(THUMB_W, THUMB_H, { fit: "cover", position: "center" })
        .jpeg({ quality: 70 })
        .toBuffer();
      return {
        input: resized,
        left: (i % COLS) * THUMB_W,
        top: Math.floor(i / COLS) * THUMB_H,
      };
    })
  );

  return sharp({
    create: {
      width: COLS * THUMB_W,
      height: rows * THUMB_H,
      channels: 3,
      background: { r: 20, g: 20, b: 20 },
    },
  })
    .composite(compositeOps)
    .jpeg({ quality: 80 })
    .toBuffer();
}

// ===== Claude Vision prompt =====
function buildPrompt(claimedReps: number, senderName: string): string {
  return `You are a professional fitness instructor reviewing a pushup submission.

You have 3 images:
1. Frame grid — ALL frames at 2fps, arranged left-to-right, top-to-bottom (chronological)
2. First frame — starting position
3. Last frame — ending position

${senderName} claims ${claimedReps} pushup reps.

COUNT VALID REPS:
- 1 valid rep = full descent (chest within ~2 inches of floor) + full ascent (elbows fully extended at top)
- Partial reps (no full descent OR no full lock-out at top) = 0
- Each rep should appear as a clear high→low→high cycle in the frames

FORM SCORE (1–10):
10 = perfect military form (straight body line, controlled tempo, full ROM every rep)
8–9 = solid form with minor issues
6–7 = decent effort, 1–2 consistent form breaks
4–5 = multiple form issues (sagging hips, flared elbows, incomplete range)
2–3 = poor form throughout, barely qualifying reps
1 = dangerous or unrecognisable as pushups

VERDICT (3–4 sentences, professional English):
- State the valid rep count clearly
- Give ONE specific, actionable form cue (e.g. "Keep your core engaged to prevent hip sag", "Drive your chest all the way to the floor for full range")
- Acknowledge what they did well if anything, then give the coaching note
- Tone: encouraging but honest, like a PT would speak — NO Tanglish, NO roasting, proper English only

Respond with ONLY valid JSON (no markdown, no extra text):
{"valid_reps":<number>,"form_score":<number>,"verdict":"<3-4 sentences professional English>"}`;
}

// ===== Main: process a pushup video (fire-and-forget from listener) =====
export async function handlePushupVideo(
  rawMsg: any,
  claimedReps: number,
  senderPhone: string,
  senderName: string,
  groupId: string
): Promise<void> {
  await rawMsg.reply(`💪 *${senderName}* submitted ${claimedReps} pushups! Analyzing form... (15–30 sec)`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pushup-"));

  try {
    // 1. Download video
    const media = await rawMsg.downloadMedia();
    if (!media?.data) {
      await rawMsg.reply("Video download panna mudiyala da. Retry pannu!");
      return;
    }

    const videoPath = path.join(tmpDir, "input.mp4");
    fs.writeFileSync(videoPath, Buffer.from(media.data, "base64"));

    // Size guard: 50MB
    if (fs.statSync(videoPath).size > 50 * 1024 * 1024) {
      await rawMsg.reply("Video too big da! 50MB-kku kizha trim panni send pannu.");
      return;
    }

    // 2. Extract frames
    let framePaths: string[];
    try {
      framePaths = await extractFrames(videoPath, tmpDir);
    } catch {
      await rawMsg.reply(
        "ffmpeg not found da! Admin-kitte sollu — server-la `sudo apt install ffmpeg` run pannanum."
      );
      return;
    }

    if (framePaths.length === 0) {
      await rawMsg.reply("Video-la frames illa da. MP4 format-la send pannu.");
      return;
    }

    // Cap at 120 frames (60s at 2fps = sensible max for a pushup set)
    if (framePaths.length > 120) framePaths.splice(120);

    // 3. Build grid + pick edge frames
    const { default: sharp } = await import("sharp");
    const gridBuffer = await buildGrid(framePaths);
    const firstBuf = await sharp(framePaths[0]!).jpeg({ quality: 85 }).toBuffer();
    const lastBuf  = await sharp(framePaths[framePaths.length - 1]!).jpeg({ quality: 85 }).toBuffer();

    // 4. Claude Vision
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: gridBuffer.toString("base64") } },
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: firstBuf.toString("base64") } },
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: lastBuf.toString("base64") } },
          { type: "text", text: buildPrompt(claimedReps, senderName) },
        ],
      }],
    });

    // 5. Parse response
    const rawText = response.content[0]?.type === "text" ? response.content[0].text : "{}";
    const jsonStr = rawText.replace(/```json\n?|\n?```/g, "").trim();

    let parsed: { valid_reps: number; form_score: number; verdict: string };
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      await rawMsg.reply("Claude brain freeze aayiduchu da. Try again pannu!");
      return;
    }

    const validReps  = Math.max(0, Math.round(parsed.valid_reps ?? 0));
    const formScore  = Math.min(10, Math.max(1, Math.round(parsed.form_score ?? 5)));
    const verdict    = (parsed.verdict ?? "Verdict generate panna mudiyala da.").trim();

    // 6. Save to DB
    await supabase.from("ba_fitness_scores").insert({
      group_id:      groupId,
      sender_phone:  senderPhone,
      sender_name:   senderName,
      exercise_type: "pushup",
      claimed_reps:  claimedReps,
      valid_reps:    validReps,
      form_score:    formScore,
      verdict,
    });

    // 7. Send grid image + verdict
    try {
      const pkgWweb = await import("whatsapp-web.js");
      const { MessageMedia } = pkgWweb.default as any;
      const gridMedia = new MessageMedia("image/jpeg", gridBuffer.toString("base64"), "pushup_frames.jpg");
      await rawMsg.reply(gridMedia, undefined, { caption: `📸 ${senderName}'s pushup frames` });
    } catch {
      // Grid send failing is non-fatal — still send the verdict
    }

    const trophy = formScore >= 8 ? "🏆" : formScore >= 5 ? "💪" : "😅";
    await rawMsg.reply(
      `${trophy} *PUSHUP VERDICT — ${senderName}*\n\n` +
      `${verdict}\n\n` +
      `✅ Valid reps: *${validReps}/${claimedReps}*\n` +
      `📐 Form: *${formScore}/10*\n\n` +
      `_!fitboard to see weekly leaderboard_`
    );

  } finally {
    // Cleanup temp dir
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* non-fatal */ }
  }
}

// ===== !fitboard — weekly leaderboard =====
export async function handleFitboard(msg: BotMessage): Promise<string> {
  const weekStart = getCurrentWeekStartIST();

  const { data } = await supabase
    .from("ba_fitness_scores")
    .select("sender_phone, sender_name, valid_reps, form_score")
    .eq("group_id", msg.groupId)
    .gte("submitted_at", `${weekStart}T00:00:00+05:30`)
    .order("submitted_at", { ascending: true });

  if (!data?.length) {
    return "Indha week yaarum pushup pannalai da! 🥺 Lazy group!\n\nSend pushup video with caption *!pushup <count>* to start!";
  }

  // Aggregate per person: sum reps, average form score
  const personMap = new Map<string, { name: string; totalReps: number; formSum: number; sessions: number }>();
  for (const row of data) {
    const p = personMap.get(row.sender_phone) ?? { name: row.sender_name, totalReps: 0, formSum: 0, sessions: 0 };
    p.name = row.sender_name;
    p.totalReps += row.valid_reps;
    p.formSum   += row.form_score;
    p.sessions  += 1;
    personMap.set(row.sender_phone, p);
  }

  const sorted = [...personMap.values()].sort((a, b) => b.totalReps - a.totalReps);
  const medals = ["🥇", "🥈", "🥉"];

  let board = "💪 *FITNESS BOARD — This Week*\n\n";
  sorted.forEach((p, i) => {
    const avgForm = (p.formSum / p.sessions).toFixed(1);
    board += `${medals[i] ?? "•"} *${p.name}* — ${p.totalReps} reps (form: ${avgForm}/10, ${p.sessions} session${p.sessions > 1 ? "s" : ""})\n`;
  });

  if (sorted[0]) {
    board += `\n👑 This week's king: *${sorted[0].name}* with ${sorted[0].totalReps} reps!`;
  }

  board += `\n\n_Submit: send pushup video, caption = !pushup <count>_`;
  return board;
}

// ===== !pushup with no video = instructions =====
export function handlePushupNoVideo(): string {
  return `💪 *PUSHUP CHALLENGE*

How to submit:
1. Record yourself doing pushups 📱
2. Send the video to the group
3. Caption: *!pushup 20* (replace 20 with your rep count)

What the bot does:
• Extracts frames at 2fps and analyses your movement
• Counts valid reps (full depth + full lockout only)
• Gives you a form score out of 10 with coaching feedback

View leaderboard: *!fitboard*`;
}
