import http from "http";

function electionRequest(method: string, path: string, body?: object): Promise<{ status: number; data: any }> {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: "127.0.0.1", port: 3100, path, method,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try { resolve({ status: res.statusCode!, data: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode!, data: {} }); }
        });
      }
    );
    req.setTimeout(60000, () => { req.destroy(); resolve({ status: 408, data: { error: "timeout" } }); });
    req.on("error", () => resolve({ status: 503, data: { error: "election bot not running — cd ~/election-bot && node index.js" } }));
    if (payload) req.write(payload);
    req.end();
  });
}

export async function callElectionBot(action: "trigger" | "list" | "consti", params?: { num?: string }): Promise<string> {
  if (action === "trigger") {
    const { status } = await electionRequest("POST", "/trigger");
    if (status === 200) return "🗳️ Fetching TN results now — sending in a moment!";
    return "⚠️ Election bot offline. Run: cd ~/election-bot && node index.js";
  }

  if (action === "list") {
    const { status, data } = await electionRequest("GET", "/list");
    if (status !== 200 || !data.list?.length) {
      return data.error
        ? `⚠️ Couldn't fetch list: ${data.error}`
        : "⚠️ Election bot offline. Run: cd ~/election-bot && node index.js";
    }
    const list: Array<{ name: string; num: number }> = data.list;
    // Format: sorted alphabetically, compact two-column style
    const lines = ["📋 *TN Constituencies (234)*", "_Use !tn consti <number> for live details_", ""];
    for (const c of list) {
      lines.push(`${String(c.num).padStart(3, " ")} — ${c.name}`);
    }
    return lines.join("\n");
  }

  if (action === "consti") {
    if (!params?.num) return "Usage: *!tn consti 63*";
    const { status, data } = await electionRequest("POST", "/consti", { num: params.num });
    if (status !== 200) {
      return data.error
        ? `⚠️ ${data.error}`
        : "⚠️ Election bot offline. Run: cd ~/election-bot && node index.js";
    }
    return data.message || "⚠️ No data returned";
  }

  return "Unknown action";
}
