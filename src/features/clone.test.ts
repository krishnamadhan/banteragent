import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { BotMessage } from "../types.js";
import {
  CLONE_CONSENT_PHRASE,
  handleCloneCommand,
  handleCloneTextMessage,
  handleCloneVoiceNote,
} from "./clone.js";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "clone-test-"));
}

function msg(overrides: Partial<BotMessage> = {}): BotMessage {
  return {
    from: "919999999999@c.us",
    senderName: "Madhan",
    text: "",
    groupId: "120363@test@g.us",
    messageId: "m1",
    isGroup: true,
    timestamp: 1,
    ...overrides,
  };
}

test("clone enrollment stores nothing until exact consent and voice note arrive", async () => {
  const root = tempRoot();
  process.env.CLONE_DATA_DIR = join(root, "data");
  process.env.CLONE_VOICE_DIR = join(root, "voices");

  try {
    const start = await handleCloneCommand("enroll", msg());
    assert.match(start.response, /Nothing is stored before consent/);

    const wrong = await handleCloneTextMessage(msg({ text: "I consent" }));
    assert.match(wrong!, /did not match/);

    const ok = await handleCloneTextMessage(msg({ text: CLONE_CONSENT_PHRASE }));
    assert.match(ok!, /send one 10-30s WhatsApp voice note/);

    const rawMsg = {
      downloadMedia: async () => ({
        mimetype: "audio/wav",
        data: Buffer.from("RIFFfake-wav").toString("base64"),
      }),
    };
    const saved = await handleCloneVoiceNote(rawMsg, msg());
    assert.match(saved!, /Voice profile saved/);

    const profileDir = join(root, "voices", "madhan");
    assert.equal((statSync(profileDir).mode & 0o777), 0o700);
    assert.equal(readFileSync(join(profileDir, "reference.wav"), "utf8"), "RIFFfake-wav");
    const consent = JSON.parse(readFileSync(join(profileDir, "consent.json"), "utf8"));
    assert.equal(consent.consent_granted, true);
    assert.equal(consent.source, "banteragent_whatsapp_voice_note");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("clone say uses mock provider without a Replicate token", async () => {
  const root = tempRoot();
  process.env.CLONE_DATA_DIR = join(root, "data");
  process.env.CLONE_VOICE_DIR = join(root, "voices");
  process.env.CLONE_VOICE_PROVIDER = "mock";
  delete process.env.REPLICATE_API_TOKEN;

  try {
    await handleCloneCommand("enroll", msg());
    await handleCloneTextMessage(msg({ text: CLONE_CONSENT_PHRASE }));
    await handleCloneVoiceNote({
      downloadMedia: async () => ({
        mimetype: "audio/wav",
        data: Buffer.from("RIFFfake-wav").toString("base64"),
      }),
    }, msg());

    const result = await handleCloneCommand("say hello machaan", msg());
    assert.equal(result.response, "");
    assert.ok(result.mediaFile);
    assert.match(readFileSync(result.mediaFile!).subarray(0, 4).toString(), /RIFF/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    delete process.env.CLONE_VOICE_PROVIDER;
  }
});
