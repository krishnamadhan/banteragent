import fs from "fs";
import path from "path";
import type { BotMessage } from "../types.js";

const BUGS_FILE = path.resolve("bugs.md");

function initBugsFile(): void {
  if (!fs.existsSync(BUGS_FILE)) {
    fs.writeFileSync(BUGS_FILE, `# BanterAgent — Bug Reports

Bugs reported by group members via \`!bug\` command.
Developers: fix open bugs, then update STATUS to \`FIXED\` with notes.

---

`);
  }
}

function getNextBugNumber(): number {
  if (!fs.existsSync(BUGS_FILE)) return 1;
  const content = fs.readFileSync(BUGS_FILE, "utf-8");
  const matches = content.match(/^## Bug #(\d+)/gm);
  if (!matches?.length) return 1;
  const nums = matches.map((m) => parseInt(m.match(/#(\d+)/)![1]!));
  return Math.max(...nums) + 1;
}

export function handleBugReport(args: string, msg: BotMessage, recentMessages: string[]): string {
  const description = args.trim();
  if (!description) {
    return `Format: *!bug <what went wrong>*\nExample: !bug Quiz emoji doesn't match the movie at all`;
  }

  initBugsFile();

  const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const timestamp = istNow.toISOString().replace("T", " ").slice(0, 19) + " IST";
  const bugNum = getNextBugNumber();

  // Last 5 messages for context (strip current message)
  const context = recentMessages.slice(-5).map((m) => `  ${m}`).join("\n");

  const entry = `## Bug #${bugNum} — ${timestamp}
**Reporter:** ${msg.senderName} (\`${msg.from}\`)
**Group:** \`${msg.groupId ?? msg.from}\`
**Status:** \`OPEN\`
**Description:** ${description}

**Recent chat context:**
\`\`\`
${context || "  (no recent messages)"}
\`\`\`

**Fix notes:** _(developer fills this in)_

---

`;

  fs.appendFileSync(BUGS_FILE, entry);

  const preview = description.length > 60 ? description.slice(0, 57) + "..." : description;
  return `🐛 Bug #${bugNum} noted! Thanks ${msg.senderName} 🙏\n_"${preview}"_\n\nWill be fixed in the next update.`;
}
