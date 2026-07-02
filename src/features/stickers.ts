/**
 * stickers.ts — Sticker library: save, deduplicate, and pick stickers for responses.
 *
 * Storage:
 *   /home/pi/banteragent/data/stickers/<hash>.webp  — raw sticker files
 *   /home/pi/banteragent/data/sticker-library.json  — metadata index
 *
 * Dedup: MD5 hash of the raw base64 data.
 */

import { createHash } from "crypto";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { resolve } from "path";
import { analyzeStickerVision, pickStickerForContext } from "../claude.js";
import { getClient } from "../index.js";

const DATA_DIR   = resolve("/home/pi/banteragent/data");
const STICKER_DIR = resolve(DATA_DIR, "stickers");
const INDEX_FILE  = resolve(DATA_DIR, "sticker-library.json");

export interface StickerEntry {
  id: string;           // MD5 hash of base64 data
  description: string;  // what the sticker looks/feels like
  when_to_use: string;  // situations where it fits
  source: "dm" | "group";
  addedAt: string;
  usageCount: number;
}

function ensureDirs(): void {
  mkdirSync(STICKER_DIR, { recursive: true });
}

export function loadLibrary(): StickerEntry[] {
  try {
    if (existsSync(INDEX_FILE)) return JSON.parse(readFileSync(INDEX_FILE, "utf8"));
  } catch {}
  return [];
}

function saveLibrary(entries: StickerEntry[]): void {
  ensureDirs();
  writeFileSync(INDEX_FILE, JSON.stringify(entries, null, 2));
}

function hashData(base64: string): string {
  return createHash("md5").update(base64).digest("hex");
}

export function stickerFilePath(id: string): string {
  return resolve(STICKER_DIR, `${id}.webp`);
}

/**
 * Save a sticker to the library.
 * Returns "saved" | "duplicate" | "error".
 * contextMessages: recent group messages before this sticker was sent (for group stickers).
 */
export async function saveSticker(
  base64: string,
  mimetype: string,
  source: "dm" | "group",
  contextMessages: string[] = [],
  skipAnalysis = false
): Promise<{ result: "saved" | "duplicate" | "error"; entry?: StickerEntry }> {
  try {
    ensureDirs();
    const id = hashData(base64);
    const library = loadLibrary();

    if (library.some((e) => e.id === id)) {
      return { result: "duplicate" };
    }

    // Skip Vision for "other group" harvested stickers — analysed lazily on first use
    const analysis = skipAnalysis
      ? { description: "harvested sticker", when_to_use: "general reactions" }
      : await analyzeStickerVision(base64, mimetype, contextMessages);

    const entry: StickerEntry = {
      id,
      description: analysis.description,
      when_to_use: analysis.when_to_use,
      source,
      addedAt: new Date().toISOString(),
      usageCount: 0,
    };

    // Write the .webp file
    const filePath = stickerFilePath(id);
    writeFileSync(filePath, Buffer.from(base64, "base64"));

    library.push(entry);
    saveLibrary(library);

    console.log(`[sticker] Saved new sticker ${id} (source=${source}): ${analysis.description}`);
    return { result: "saved", entry };
  } catch (e) {
    console.error("[sticker] saveSticker error:", e);
    return { result: "error" };
  }
}

/**
 * Pick the best sticker for a given bot response text.
 * Returns sticker id or null if none fits well.
 * Increments usageCount on the chosen sticker.
 */
export async function pickSticker(responseText: string): Promise<string | null> {
  const library = loadLibrary();
  if (library.length === 0) return null;

  // Pass at most 40 stickers to keep prompt small
  const candidates = library.slice(0, 40);
  const chosen = await pickStickerForContext(responseText, candidates);
  if (!chosen) return null;

  // Verify the .webp file exists before claiming we can send it
  if (!existsSync(stickerFilePath(chosen))) {
    console.warn(`[sticker] Picked sticker ${chosen} but file missing, skipping`);
    return null;
  }

  // Increment usage count
  const lib = loadLibrary();
  const entry = lib.find((e) => e.id === chosen);
  if (entry) {
    entry.usageCount++;
    saveLibrary(lib);
  }

  return chosen;
}

/**
 * Send a sticker to a WhatsApp JID.
 */
export async function sendSticker(jid: string, stickerId: string): Promise<void> {
  const pkgWweb = await import("whatsapp-web.js");
  const { MessageMedia } = (pkgWweb.default ?? pkgWweb) as any;
  const filePath = stickerFilePath(stickerId);
  if (!existsSync(filePath)) {
    console.warn(`[sticker] File not found: ${filePath}`);
    return;
  }
  const client = getClient();
  if (!client?.info) {
    console.warn("[sticker] Client not ready");
    return;
  }
  const media = MessageMedia.fromFilePath(filePath);
  await client.sendMessage(jid, media, { sendMediaAsSticker: true });
}
