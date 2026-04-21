// Pi admin commands — responds to !pi <subcommand> from PI_ADMIN_NUMBER.
// Works in both DM and group. Silent ignore for non-admin senders.
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";

const execAsync = promisify(exec);
const STATUS_FILE = path.join(process.env.HOME ?? "/home/pi", "pi-monitor/status.json");
const LOG_FILE    = path.join(process.env.HOME ?? "/home/pi", "logs/banteragent-out.log");
const ERR_FILE    = path.join(process.env.HOME ?? "/home/pi", "logs/banteragent-err.log");
const QR_FLAG     = path.join(process.env.HOME ?? "/home/pi", "pi-monitor/qr-needed.flag");

function isAdmin(senderPhone: string): boolean {
  const admin = process.env.PI_ADMIN_NUMBER ?? process.env.BOT_OWNER_PHONE ?? "";
  const adminNum = admin.replace(/@.*/, "");
  return senderPhone.replace(/@.*/, "").includes(adminNum) || adminNum.includes(senderPhone.replace(/@.*/, ""));
}

function readStatus(): Record<string, any> | null {
  try {
    if (!fs.existsSync(STATUS_FILE)) return null;
    const age = Date.now() - fs.statSync(STATUS_FILE).mtimeMs;
    if (age > 5 * 60 * 1000) return null; // stale after 5 min
    return JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"));
  } catch {
    return null;
  }
}

function fmtUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtTemp(t: number | null): string {
  if (t === null) return "N/A";
  const icon = t >= 75 ? "🚨" : t >= 65 ? "⚠️" : "✅";
  return `${t}°C ${icon}`;
}

function fmtPct(pct: number, warnAt = 80, critAt = 90): string {
  const icon = pct >= critAt ? "🚨" : pct >= warnAt ? "⚠️" : "✅";
  return `${pct}% ${icon}`;
}

async function runSafe(cmd: string, timeoutMs = 30000): Promise<string> {
  try {
    const { stdout } = await execAsync(cmd, { timeout: timeoutMs });
    return stdout.trim();
  } catch (e: any) {
    return e.message?.slice(0, 200) ?? "error";
  }
}

async function handlePiCommand(
  client: any,
  senderPhone: string,
  to: string,   // reply target (group JID or personal)
  subCmd: string,
  args: string[]
): Promise<void> {
  let reply = "";

  switch (subCmd) {
    case "status": {
      const s = readStatus();
      const temp = s ? fmtTemp(s.cpu_temp) : "N/A";
      const ram  = s ? `${s.ram_used_mb}MB / ${s.ram_total_mb}MB (${fmtPct(s.ram_percent)})` : "N/A";
      const disk = s ? `${s.disk_used_gb}GB / ${s.disk_total_gb}GB (${fmtPct(s.disk_percent)})` : "N/A";
      const net  = s ? (s.internet_ok ? `Online ✅${s.ping_ms ? ` (${s.ping_ms}ms)` : ""}` : "DOWN 🚨") : "N/A";
      const uptime = s ? fmtUptime(s.uptime_secs) : "N/A";
      const bat  = s ? `${s.battery_level} | ${s.battery_ac_ok ? "AC OK" : "On Battery"} | ${s.battery_charging ? "Charging" : "Not Charging"}` : "N/A";
      const ts   = s?.tailscale_ip ? `Connected (${s.tailscale_ip}) ✅` : "N/A";
      const pm2  = s?.pm2 ?? {};
      const baProc = pm2["banteragent"];
      const baStatus = baProc ? `${baProc.status === "online" ? "Online ✅" : "DOWN 🚨"} | ${baProc.mem_mb}MB | ${baProc.restarts} restarts` : "N/A";
      const qr   = s?.qr_needed ? "\n\n⚠️ *WhatsApp QR NEEDED!*\nRun: scp pi@192.168.1.30:~/banteragent/qr.png ~/Desktop/qr.png" : "";

      reply = `*Pi Status Report*\n━━━━━━━━━━━━━━━━━━━\n🌡️ Temp: ${temp}\n💾 RAM: ${ram}\n💿 Disk: ${disk}\n🔋 Battery: ${bat}\n📡 Network: ${net}\n🌐 Tailscale: ${ts}\n⏱️ Uptime: ${uptime}\n\n*BanterAgent*\n━━━━━━━━━━━━━━━━━━━\n${baStatus}${qr}`;
      break;
    }

    case "temp": {
      const s = readStatus();
      if (!s) { reply = "No monitor data yet (pi-monitor may not be running)"; break; }
      const t = s.cpu_temp;
      const label = t >= 75 ? "CRITICAL!" : t >= 65 ? "warm — check cooling" : "normal";
      reply = `🌡️ Pi temperature: ${t}°C (${label}) ${t >= 75 ? "🚨" : t >= 65 ? "⚠️" : "✅"}`;
      break;
    }

    case "battery": {
      const s = readStatus();
      if (!s) { reply = "No monitor data yet"; break; }
      reply = `*Battery Status*\n━━━━━━━━━━━━━━━━\nLevel: ${s.battery_level}\nAC Power: ${s.battery_ac_ok ? "Connected ✅" : "DISCONNECTED ⚠️"}\nCharging: ${s.battery_charging ? "Yes ⚡" : "No"}`;
      break;
    }

    case "logs": {
      const n = Math.min(parseInt(args[0] ?? "20") || 20, 50);
      if (!fs.existsSync(LOG_FILE)) { reply = `Log not found: ${LOG_FILE}`; break; }
      const { stdout } = await execAsync(`tail -${n} "${LOG_FILE}"`);
      reply = `*Last ${n} lines of BanterAgent logs:*\n\`\`\`\n${stdout.trim().slice(0, 3000)}\n\`\`\``;
      break;
    }

    case "errors": {
      if (!fs.existsSync(ERR_FILE)) { reply = "✅ No error log found!"; break; }
      const { stdout } = await execAsync(`tail -20 "${ERR_FILE}"`);
      const content = stdout.trim();
      reply = content ? `*Recent errors:*\n\`\`\`\n${content.slice(0, 3000)}\n\`\`\`` : "✅ No recent errors!";
      break;
    }

    case "restart": {
      const svc = args[0]?.toLowerCase();
      if (svc === "bot") {
        await client.sendMessage(to, "🔄 Restarting BanterAgent...");
        await runSafe("pm2 restart banteragent");
        await new Promise(r => setTimeout(r, 10000));
        const status = await runSafe("pm2 jlist");
        let ok = false;
        try { ok = JSON.parse(status).find((p: any) => p.name === "banteragent")?.pm2_env?.status === "online"; } catch {}
        reply = ok ? "✅ BanterAgent restarted successfully!" : "❌ BanterAgent may not have started. Check !pi errors";
      } else if (svc === "pi") {
        // Ask for confirmation
        await client.sendMessage(to, "⚠️ This will reboot the entire Pi. Reply *!pi confirm reboot* to proceed.");
        return;
      } else {
        reply = "Usage: !pi restart bot | !pi restart pi";
      }
      break;
    }

    case "confirm": {
      if (args[0] === "reboot") {
        await client.sendMessage(to, "🔄 Pi rebooting in 5 seconds... Will be back in ~60 seconds.");
        setTimeout(() => execAsync("sudo reboot").catch(() => {}), 5000);
        return;
      }
      reply = "Unknown confirmation. Use: !pi confirm reboot";
      break;
    }

    case "update": {
      if (args[0] === "bot") {
        await client.sendMessage(to, "📦 Updating BanterAgent...");
        const gitOut = await runSafe("cd /home/pi/banteragent && git pull 2>&1", 30000);
        const npmOut = await runSafe("cd /home/pi/banteragent && npm install --prefer-offline 2>&1 | tail -3", 60000);
        const buildOut = await runSafe("cd /home/pi/banteragent && npm run build 2>&1 | tail -5", 60000);
        if (buildOut.includes("error")) {
          reply = `❌ Build failed:\n\`\`\`\n${buildOut.slice(0, 500)}\n\`\`\``;
        } else {
          await execAsync("pm2 restart banteragent");
          reply = `✅ BanterAgent updated and restarted!\n\`\`\`\n${gitOut.slice(0, 200)}\n\`\`\``;
        }
      } else {
        reply = "Usage: !pi update bot";
      }
      break;
    }

    case "disk": {
      const [dfOut, duOut] = await Promise.all([
        runSafe("df -h / | awk 'NR==2{print $2,$3,$4,$5}'"),
        runSafe("du -sh /home/pi/banteragent /home/pi/.pm2/logs /home/pi/.wwebjs_cache 2>/dev/null | sort -rh | head -5"),
      ]);
      const parts = dfOut.split(/\s+/);
      reply = `*Disk Usage*\n━━━━━━━━━━━━━━━━\nTotal: ${parts[0]}\nUsed: ${parts[1]} (${parts[3]})\nFree: ${parts[2]}\n\n*Top users:*\n\`\`\`\n${duOut}\n\`\`\``;
      break;
    }

    case "clean": {
      await client.sendMessage(to, "🧹 Cleaning up...");
      const before = await runSafe("df -h / | awk 'NR==2{print $4}'");
      await runSafe("pm2 flush 2>/dev/null");
      await runSafe("rm -rf /home/pi/.wwebjs_cache/* 2>/dev/null || true");
      await runSafe("npm cache clean --force 2>/dev/null || true");
      const after = await runSafe("df -h / | awk 'NR==2{print $4}'");
      reply = `✅ Cleaned!\nFree before: ${before}\nFree after: ${after}`;
      break;
    }

    case "network": {
      const [local, ping, ts, wifi] = await Promise.all([
        runSafe("hostname -I | awk '{print $1}'"),
        runSafe("ping -c 1 -W 2 8.8.8.8 | grep time= | awk -F'time=' '{print $2}'"),
        runSafe("tailscale ip -4 2>/dev/null").catch(() => "N/A"),
        runSafe("nmcli -t -f NAME,DEVICE con show --active 2>/dev/null || iwconfig 2>/dev/null | grep ESSID"),
      ]);
      const net = ping ? `Online ✅ (${ping.trim()})` : "DOWN 🚨";
      reply = `*Network Status*\n━━━━━━━━━━━━━━━━\nLocal IP: ${local}\nTailscale: ${ts || "N/A"}\nInternet: ${net}\nWiFi: ${wifi || "N/A"}`;
      break;
    }

    case "uptime": {
      const [piUp, pm2Out] = await Promise.all([
        runSafe("uptime -p"),
        runSafe("pm2 jlist"),
      ]);
      let baUp = "N/A";
      try {
        const procs = JSON.parse(pm2Out);
        const ba = procs.find((p: any) => p.name === "banteragent");
        if (ba) {
          const uptimeSecs = Math.floor((Date.now() - ba.pm2_env.pm_uptime) / 1000);
          baUp = fmtUptime(uptimeSecs);
        }
      } catch {}
      reply = `⏱️ Pi uptime: ${piUp}\n🤖 BanterAgent uptime: ${baUp}`;
      break;
    }

    case "help":
      reply = `*Pi Admin Commands*\n━━━━━━━━━━━━━━━━━━━\n!pi status — Full system report\n!pi temp — CPU temperature\n!pi battery — Battery status\n!pi logs [n] — Last N log lines (default 20)\n!pi errors — Recent error logs\n!pi restart bot — Restart BanterAgent\n!pi restart pi — Reboot Pi (asks confirm)\n!pi update bot — Git pull + redeploy\n!pi disk — Disk usage\n!pi clean — Safe cleanup (logs + cache)\n!pi network — Network status\n!pi uptime — Pi + bot uptime`;
      break;

    default:
      reply = `Unknown !pi command. Send *!pi help* for the list.`;
  }

  if (reply) await client.sendMessage(to, reply);
}

export async function handlePiAdminMessage(
  client: any,
  senderPhone: string,
  isGroup: boolean,
  to: string,
  text: string
): Promise<boolean> {
  if (!text.toLowerCase().startsWith("!pi ") && text.toLowerCase() !== "!pi") return false;
  if (!isAdmin(senderPhone)) return false; // silent ignore for non-admin

  const parts = text.slice(4).trim().split(/\s+/);
  const subCmd = (parts[0] ?? "status").toLowerCase();
  const args   = parts.slice(1);

  try {
    await handlePiCommand(client, senderPhone, to, subCmd, args);
  } catch (err: any) {
    await client.sendMessage(to, `*[Pi Monitor] Error:* ${err.message?.slice(0, 300) ?? "unknown"}`);
  }
  return true;
}
