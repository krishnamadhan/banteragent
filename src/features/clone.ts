import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { chmod, mkdtemp, readFile, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import pkg from "whatsapp-web.js";
import type { BotMessage, CommandResult } from "../types.js";

const { MessageMedia } = pkg as any;
const execFileAsync = promisify(execFile);

export const CLONE_CONSENT_PHRASE = "I consent to Cosmo cloning my voice for local lab use";
const REPLICATE_API_BASE = "https://api.replicate.com/v1";
const REPLICATE_MODEL = "lucataco/xtts-v2";
const ENROLL_TTL_MS = 10 * 60 * 1000;

type PendingEnrollment = {
  stage: "awaiting_consent" | "awaiting_audio";
  name: string;
  createdAt: number;
  consentAt?: string;
};

type CloneState = {
  enabledChats: Record<string, { profile: string; enabledBy: string; updatedAt: string }>;
};

const pending = new Map<string, PendingEnrollment>();

function dataDir(): string {
  return process.env.CLONE_DATA_DIR || "/home/pi/banteragent/data";
}

function voiceDir(): string {
  return process.env.CLONE_VOICE_DIR || "/home/pi/.robot/memory/voices";
}

function statePath(): string {
  return join(dataDir(), "clone-state.json");
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "");
}

function pendingKey(msg: Pick<BotMessage, "groupId" | "from">): string {
  return `${msg.groupId}|${msg.from}`;
}

function profileRoot(profile: string): string {
  return join(voiceDir(), slug(profile));
}

function loadState(): CloneState {
  try {
    return JSON.parse(readFileSync(statePath(), "utf8")) as CloneState;
  } catch {
    return { enabledChats: {} };
  }
}

function saveState(state: CloneState): void {
  mkdirSync(dataDir(), { recursive: true });
  const tmp = `${statePath()}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
  renameSync(tmp, statePath());
}

function profileExists(profile: string): boolean {
  const root = profileRoot(profile);
  return existsSync(join(root, "reference.wav")) && existsSync(join(root, "consent.json"));
}

function cleanupExpired(): void {
  const now = Date.now();
  for (const [key, value] of pending) {
    if (now - value.createdAt > ENROLL_TTL_MS) pending.delete(key);
  }
}

function help(profile: string, enabled: boolean): string {
  return [
    "*!clone*",
    `Profile: ${profileExists(profile) ? profile : "not enrolled"}`,
    `Audio replies: ${enabled ? "on" : "off"}`,
    "",
    "!clone enroll — start consent + voice-note enrollment",
    "!clone on / off — cloned audio replies in this chat",
    "!clone say <text> — send one cloned voice note",
    "!clone cancel — stop enrollment",
  ].join("\n");
}

export async function handleCloneCommand(args: string, msg: BotMessage): Promise<CommandResult> {
  cleanupExpired();
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const sub = (parts[0] || "status").toLowerCase();
  const profile = msg.senderName || msg.from.replace("@c.us", "");
  const state = loadState();
  const enabled = !!state.enabledChats[msg.groupId];

  if (sub === "status" || sub === "help") {
    return { response: help(profile, enabled) };
  }

  if (sub === "enroll") {
    pending.set(pendingKey(msg), { stage: "awaiting_consent", name: profile, createdAt: Date.now() });
    return {
      response:
        "Voice clone enrollment started.\n\n" +
        "Reply with this exact consent line first:\n" +
        `_${CLONE_CONSENT_PHRASE}_\n\n` +
        "After that, send a 10-30s WhatsApp voice note. Nothing is stored before consent.",
    };
  }

  if (sub === "cancel") {
    pending.delete(pendingKey(msg));
    return { response: "Clone enrollment cancelled." };
  }

  if (sub === "on") {
    if (!profileExists(profile)) {
      return { response: "No consented clone profile yet. Send *!clone enroll* first." };
    }
    state.enabledChats[msg.groupId] = {
      profile,
      enabledBy: msg.from,
      updatedAt: new Date().toISOString(),
    };
    saveState(state);
    return { response: "Cloned audio replies are on for this chat. If synthesis fails, I will keep replying as text." };
  }

  if (sub === "off") {
    delete state.enabledChats[msg.groupId];
    saveState(state);
    return { response: "Cloned audio replies are off." };
  }

  if (sub === "say") {
    const text = args.replace(/^say\s*/i, "").trim();
    if (!text) return { response: "Usage: *!clone say <text>*" };
    if (!profileExists(profile)) return { response: "No consented clone profile yet. Send *!clone enroll* first." };
    const mediaFile = await synthesizeToFile(text, profile).catch((e) => {
      console.error("[clone] say failed:", e);
      return null;
    });
    if (!mediaFile) return { response: "Clone synthesis unavailable. Text fallback only for now." };
    return { response: "", mediaFile, mediaCaption: "", mediaAsVoice: true };
  }

  return { response: help(profile, enabled) };
}

export async function handleCloneTextMessage(msg: BotMessage): Promise<string | null> {
  cleanupExpired();
  const entry = pending.get(pendingKey(msg));
  if (!entry || entry.stage !== "awaiting_consent") return null;
  if (msg.text.trim() !== CLONE_CONSENT_PHRASE) {
    return "Consent line did not match. Send *!clone cancel* or paste the exact line.";
  }
  entry.stage = "awaiting_audio";
  entry.consentAt = new Date().toISOString();
  pending.set(pendingKey(msg), entry);
  return "Consent recorded in chat. Now send one 10-30s WhatsApp voice note.";
}

export function isCloneVoiceNote(rawMsg: any): boolean {
  return !!rawMsg?.hasMedia && (rawMsg.type === "audio" || rawMsg.type === "ptt");
}

export async function handleCloneVoiceNote(rawMsg: any, msg: BotMessage): Promise<string | null> {
  cleanupExpired();
  const key = pendingKey(msg);
  const entry = pending.get(key);
  if (!entry || entry.stage !== "awaiting_audio" || !entry.consentAt) return null;

  try {
    const media = await rawMsg.downloadMedia();
    const root = profileRoot(entry.name);
    mkdirSync(root, { recursive: true, mode: 0o700 });
    await chmod(root, 0o700);

    const inputExt = media.mimetype?.includes("wav") ? "wav" : "ogg";
    const inputPath = join(root, `source.${inputExt}`);
    const referencePath = join(root, "reference.wav");
    await writeFile(inputPath, Buffer.from(media.data, "base64"));
    await writeReferenceWav(inputPath, referencePath, media.mimetype || "");

    writeFileSync(join(root, "consent.json"), JSON.stringify({
      name: entry.name,
      consent_granted: true,
      consent_phrase: CLONE_CONSENT_PHRASE,
      spoken_consent: CLONE_CONSENT_PHRASE,
      transcribed_consent: null,
      created_at: entry.consentAt,
      source: "banteragent_whatsapp_voice_note",
      scope: "Cosmo local lab voice cloning only",
      revocation: "Delete this voice directory or send !clone off to stop WhatsApp cloned replies.",
    }, null, 2) + "\n");

    pending.delete(key);
    return "Voice profile saved. Send *!clone on* to use cloned audio replies in this chat.";
  } catch (e) {
    console.error("[clone] enrollment failed:", e);
    pending.delete(key);
    return "Voice enrollment failed safely. Nothing changed for replies; try *!clone enroll* again.";
  }
}

async function writeReferenceWav(inputPath: string, referencePath: string, mimetype: string): Promise<void> {
  if (mimetype.includes("wav")) {
    await writeFile(referencePath, await readFile(inputPath));
    return;
  }
  await execFileAsync("ffmpeg", [
    "-y", "-i", inputPath,
    "-ar", "22050", "-ac", "1",
    referencePath,
  ], { timeout: 20_000 });
}

export async function sendCloneAudioReplyIfEnabled(
  client: any,
  rawMsg: any,
  msg: BotMessage,
  text: string,
): Promise<boolean> {
  const enabled = loadState().enabledChats[msg.groupId];
  if (!enabled || !text.trim()) return false;

  try {
    const mediaFile = await synthesizeToFile(text, enabled.profile);
    const media = MessageMedia.fromFilePath(mediaFile);
    const chat = await rawMsg.getChat();
    await client.sendMessage(chat.id._serialized, media, { sendAudioAsVoice: true });
    rmSync(mediaFile, { force: true });
    return true;
  } catch (e) {
    console.error("[clone] audio reply failed, falling back to text:", e);
    return false;
  }
}

async function synthesizeToFile(text: string, profile: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "banteragent-clone-"));
  const out = join(dir, "reply.wav");
  if (process.env.CLONE_VOICE_PROVIDER === "mock" || process.env.CLONE_VOICE_MOCK === "1") {
    await writeFile(out, makeSilentWav(22050, 0.4));
    return out;
  }

  const token = process.env.REPLICATE_API_TOKEN?.trim();
  if (!token) throw new Error("REPLICATE_API_TOKEN is unset");

  const audio = await synthesizeWithReplicate(text, join(profileRoot(profile), "reference.wav"), token);
  await writeFile(out, audio);
  return out;
}

async function synthesizeWithReplicate(text: string, referencePath: string, token: string): Promise<Buffer> {
  const [owner, name] = REPLICATE_MODEL.split("/");
  const prediction = await fetchJson(`${REPLICATE_API_BASE}/models/${owner}/${name}/predictions`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "wait=20" },
    body: JSON.stringify({
      input: {
        text,
        speaker: "data:audio/wav;base64," + readFileSync(referencePath).toString("base64"),
        language: process.env.REPLICATE_XTTS_LANGUAGE || "en",
      },
    }),
  });
  const output = await waitForPrediction(prediction, token);
  const url = outputUrl(output);
  if (!url) throw new Error("replicate output URL missing");
  return fetchBytes(url, token);
}

async function waitForPrediction(prediction: any, token: string): Promise<unknown> {
  const deadline = Date.now() + 20_000;
  let current = prediction;
  while (true) {
    if (current.status === "succeeded") return current.output;
    if (current.status === "failed" || current.status === "canceled") {
      throw new Error(`replicate ${current.status}`);
    }
    if (Date.now() > deadline) throw new Error("replicate timeout");
    const getUrl = current.urls?.get;
    if (!getUrl) throw new Error("replicate poll URL missing");
    await new Promise((r) => setTimeout(r, 500));
    current = await fetchJson(getUrl, token, { method: "GET" });
  }
}

function outputUrl(output: unknown): string | null {
  if (typeof output === "string") return output;
  if (Array.isArray(output) && typeof output[0] === "string") return output[0];
  if (output && typeof output === "object") {
    const o = output as Record<string, unknown>;
    for (const key of ["audio", "url", "output"]) {
      if (typeof o[key] === "string") return o[key];
    }
  }
  return null;
}

async function fetchJson(url: string, token: string, init: RequestInit): Promise<any> {
  const res = await fetchWithTimeout(url, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchBytes(url: string, token: string): Promise<Buffer> {
  const res = await fetchWithTimeout(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20_000);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function makeSilentWav(sampleRate: number, seconds: number): Buffer {
  const samples = Math.max(1, Math.floor(sampleRate * seconds));
  const dataSize = samples * 2;
  const b = Buffer.alloc(44 + dataSize);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + dataSize, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(dataSize, 40);
  return b;
}
