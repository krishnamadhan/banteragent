import http from "http";
import { execFile } from "child_process";
import { getClient } from "./index.js";

const PORT = 3099;

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });
}

export function startInternalServer() {
  const server = http.createServer(async (req, res) => {
    const groupId = process.env.BOT_GROUP_ID;

    // POST /notify — send a WhatsApp message to a target (group or personal chat)
    // Body: { message: string, to?: string }  — 'to' defaults to BOT_GROUP_ID
    if (req.method === "POST" && req.url === "/notify") {
      try {
        const body = await readBody(req);
        const { message, to } = JSON.parse(body);
        const target = to ?? groupId;
        if (target && message) {
          await getClient().sendMessage(target, message);
        }
        res.writeHead(200).end("ok");
      } catch (e) {
        res.writeHead(500).end("error");
      }
      return;
    }

    // POST /apply-fix — triggered by !approve, runs claude to apply pending-fix.md
    if (req.method === "POST" && req.url === "/apply-fix") {
      res.writeHead(200).end("applying");
      const applyScript = "/home/pi/scripts/apply-fix.sh";
      execFile("bash", [applyScript], (err, stdout, stderr) => {
        if (err) {
          console.error("[apply-fix] Error:", stderr);
          getClient()
            .sendMessage(groupId!, "❌ Fix apply failed: " + stderr.slice(0, 200))
            .catch(console.error);
        }
      });
      return;
    }

    res.writeHead(404).end("not found");
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`🔧 Internal server listening on :`);
  });
}
