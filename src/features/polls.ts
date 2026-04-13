import type { BotMessage } from "../types.js";
import { generateStructured } from "../claude.js";
import { supabase } from "../supabase.js";

// ===== Create Poll =====
async function createPoll(question: string, msg: BotMessage): Promise<string> {
  if (!question) return "Poll question kudu machaan! Usage: !poll <question>";

  // Deactivate existing polls
  await supabase
    .from("ba_polls")
    .update({ is_active: false })
    .eq("group_id", msg.groupId)
    .eq("is_active", true);

  // Let Claude generate fun options
  const prompt = `Someone asked this poll question in a Tamil friends WhatsApp group: "${question}"

Generate exactly 4 funny poll options in Tanglish. Each option should be short (under 10 words) and funny.
Format EXACTLY like this (no other text):
1. <option>
2. <option>
3. <option>
4. <option>`;

  const content = await generateStructured(prompt);

  const options: Array<{ text: string; votes: number }> = [];
  const lines = content.split("\n").filter((l) => l.match(/^\d+[.)]/));

  for (const line of lines.slice(0, 4)) {
    const text = line.replace(/^\d+[.)]\s*/, "").trim();
    if (text) options.push({ text, votes: 0 });
  }

  if (options.length < 2) {
    return "Poll options generate panna mudiyala. Try again with a different question!";
  }

  await supabase.from("ba_polls").insert({
    group_id: msg.groupId,
    question,
    options,
    votes: {},
    created_by: msg.from,
  });

  let response = `📊 *POLL: ${question}*\n\n`;
  options.forEach((opt, i) => {
    response += `${i + 1}️⃣ ${opt.text}\n`;
  });
  response += `\nType !vote <number> to vote!`;

  return response;
}

// ===== Vote =====
async function vote(args: string, msg: BotMessage): Promise<string> {
  const voteNum = parseInt(args.trim());
  if (isNaN(voteNum)) return "Number sollu machaan! Usage: !vote 1";

  const { data: poll } = await supabase
    .from("ba_polls")
    .select("*")
    .eq("group_id", msg.groupId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!poll) return "Active poll onnum illa. !poll <question> start pannu!";

  const optIndex = voteNum - 1;
  if (optIndex < 0 || optIndex >= poll.options.length) {
    return `1 to ${poll.options.length} range-la number sollu machaan!`;
  }

  // Check if already voted
  const votes = poll.votes as Record<string, number>;
  if (votes[msg.from] !== undefined) {
    const prevChoice = votes[msg.from] + 1;
    return `Nee already option ${prevChoice} ku vote poittae da! Double voting illa inga 😤`;
  }

  // Record vote
  votes[msg.from] = optIndex;
  const options = poll.options as Array<{ text: string; votes: number }>;
  options[optIndex].votes += 1;

  await supabase
    .from("ba_polls")
    .update({ votes, options })
    .eq("id", poll.id);

  const totalVotes = Object.keys(votes).length;

  let result = `✅ ${msg.senderName} voted for: ${options[optIndex].text}\n\n📊 *Results (${totalVotes} votes):*\n`;

  options.forEach((opt, i) => {
    const pct = totalVotes > 0 ? Math.round((opt.votes / totalVotes) * 100) : 0;
    const bar = "▓".repeat(Math.round(pct / 5)) + "░".repeat(20 - Math.round(pct / 5));
    result += `${i + 1}. ${opt.text}\n   ${bar} ${pct}% (${opt.votes})\n`;
  });

  return result;
}

// ===== Main Handler =====
export async function handlePollCommand(
  command: string,
  args: string,
  msg: BotMessage
): Promise<{ response: string }> {
  if (command === "poll") {
    return { response: await createPoll(args, msg) };
  }
  return { response: await vote(args, msg) };
}
