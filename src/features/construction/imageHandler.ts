import type { BotMessage } from "../../types.js";
import { insertFund, insertPendingAdd, getPendingItems } from "./db.js";
import { parseImageFundEntries, parseImageExpenseEntries } from "./claudeParser.js";
import { fmt } from "./parse.js";

function displayDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export async function handleConstructionImage(
  _client: any,
  rawMsg: any,
  msg: BotMessage,
  mode: "fund" | "add",
): Promise<void> {
  // Only act in construction groups
  const { getGroupConfig } = await import("../../group-config.js");
  if (!getGroupConfig(msg.groupId).isConstructionGroup) return;

  await rawMsg.reply(`📸 Scanning ${mode === "fund" ? "fund" : "expense"} entries from image...`);

  try {
    const media = await rawMsg.downloadMedia();
    if (!media?.data) {
      await rawMsg.reply("❌ Couldn't download the image. Try again.");
      return;
    }

    if (mode === "fund") {
      const entries = await parseImageFundEntries(media.data, media.mimetype ?? "image/jpeg");
      if (!entries.length) {
        await rawMsg.reply("❌ No fund entries found in that image. Try a clearer photo.");
        return;
      }

      let ok = 0;
      const lines: string[] = [];
      for (const e of entries) {
        const { error } = await insertFund(
          msg.groupId, Number(e.amount), e.person,
          e.description, e.date, msg.senderName,
        );
        if (!error) {
          ok++;
          lines.push(`${ok}. [IN] ${fmt(Number(e.amount))} — *${e.person}*${e.description ? ` (${e.description})` : ""} — ${displayDate(e.date)}`);
        }
      }

      const pending = await getPendingItems(msg.groupId);
      await rawMsg.reply(
        [`✅ *${ok} fund entries added — pending approval*`, "", ...lines, "", `Total pending: ${pending.length}`, `Send \`!approve all\` to confirm.`].join("\n"),
      );

    } else {
      const entries = await parseImageExpenseEntries(media.data, media.mimetype ?? "image/jpeg");
      if (!entries.length) {
        await rawMsg.reply("❌ No expense entries found in that image. Try a clearer photo.");
        return;
      }

      let ok = 0;
      const lines: string[] = [];
      for (const e of entries) {
        const { error } = await insertPendingAdd(
          msg.groupId, Number(e.amount), e.category,
          e.description, e.date, e.paidBy,
          msg.senderName, `[image] ${e.description}`,
        );
        if (!error) {
          ok++;
          lines.push(`${ok}. [OUT] ${fmt(Number(e.amount))} — ${e.category} — ${e.description} — ${displayDate(e.date)}`);
        }
      }

      const pending = await getPendingItems(msg.groupId);
      await rawMsg.reply(
        [`✅ *${ok} expense entries added — pending approval*`, "", ...lines, "", `Total pending: ${pending.length}`, `Send \`!approve all\` to confirm.`].join("\n"),
      );
    }

  } catch (e: unknown) {
    console.error("[construction-image] error:", e);
    await rawMsg.reply(`❌ Image scan failed: ${String(e instanceof Error ? e.message : e).slice(0, 100)}`);
  }
}
