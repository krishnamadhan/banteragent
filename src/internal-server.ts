import http from "http";
import { execFile } from "child_process";
import { getClient } from "./index.js";
import { runTask } from "./task-runner.js";
import wwjs from "whatsapp-web.js";
const { MessageMedia } = wwjs as any;

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

    // POST /run-task — called by pi-scheduler to execute a named task
    // Body: { task: string }
    if (req.method === "POST" && req.url === "/run-task") {
      const body = await readBody(req);
      let task = "", force = false;
      try { const parsed = JSON.parse(body); task = parsed.task ?? ""; force = parsed.force === true; } catch { /* ignore */ }
      if (!task) { res.writeHead(400).end(JSON.stringify({ ok: false, error: "task required" })); return; }

      // Dispatch to all configured groups, skipping groups that have this task disabled
      const { getAllGroupIds, getGroupConfig } = await import("./group-config.js");
      const allGroups = getAllGroupIds();
      if (!allGroups.length) { res.writeHead(503).end(JSON.stringify({ ok: false, error: "No groups configured" })); return; }

      const targets = allGroups.filter(gid => !getGroupConfig(gid).disabledTasks.has(task));
      res.writeHead(202, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, task, targets: targets.length, force }));
      for (const gid of targets) {
        runTask(task, gid, force).catch((e) => console.error(`[run-task] ${task}:${gid} uncaught:`, e));
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

    // POST /send-sticker — send a sticker from the library to a target
    // Body: { stickerId: string, to?: string }
    if (req.method === "POST" && req.url === "/send-sticker") {
      try {
        const body = await readBody(req);
        const { stickerId, to } = JSON.parse(body);
        const target = to ?? groupId;
        if (target && stickerId) {
          const { sendSticker } = await import("./features/stickers.js");
          await sendSticker(target, stickerId);
        }
        res.writeHead(200).end("ok");
      } catch (e) {
        res.writeHead(500).end("error");
      }
      return;
    }

    // POST /send-media — send a media file to a target
    // Body: { file: string (absolute path), to?: string, caption?: string }
    if (req.method === "POST" && req.url === "/send-media") {
      try {
        const body = await readBody(req);
        const { file, to, caption } = JSON.parse(body);
        const target = to ?? groupId;
        if (target && file) {
          const media = MessageMedia.fromFilePath(file);
          await getClient().sendMessage(target, media, { caption });
        }
        res.writeHead(200).end("ok");
      } catch (e) {
        console.error("[send-media] error:", e);
        res.writeHead(500).end(String(e));
      }
      return;
    }

    // POST /cosmo-notify — outbound message from Cosmo robot to owner DM
    // Body: { message: string }  — always targets BOT_OWNER_PHONE
    if (req.method === "POST" && req.url === "/cosmo-notify") {
      try {
        const ownerPhone = process.env.BOT_OWNER_PHONE;
        if (!ownerPhone) { res.writeHead(503).end("no owner configured"); return; }
        const jid = ownerPhone.includes("@") ? ownerPhone : `${ownerPhone}@c.us`;
        const body = await readBody(req);
        const { message } = JSON.parse(body);
        if (message) await getClient().sendMessage(jid, message);
        res.writeHead(200).end("ok");
      } catch (e) {
        console.error("[cosmo-notify] error:", e);
        res.writeHead(500).end("error");
      }
      return;
    }

    res.writeHead(404).end("not found");
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`🔧 Internal server listening on :${PORT}`);
  });
}
