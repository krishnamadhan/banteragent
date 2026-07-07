// Pi admin commands — responds to !pi <subcommand> from PI_ADMIN_NUMBER.
// Works in both DM and group. Silent ignore for non-admin senders.
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import { samePhone } from "./phone.js";

const execAsync = promisify(exec);
const STATUS_FILE = path.join(process.env.HOME ?? "/home/pi", "pi-monitor/status.json");
const LOG_FILE    = path.join(process.env.HOME ?? "/home/pi", "logs/banteragent-out.log");
const ERR_FILE    = path.join(process.env.HOME ?? "/home/pi", "logs/banteragent-err.log");
const QR_FLAG     = path.join(process.env.HOME ?? "/home/pi", "pi-monitor/qr-needed.flag");

function isAdmin(senderPhone: string): boolean {
  return samePhone(senderPhone, process.env.PI_ADMIN_NUMBER)
    || samePhone(senderPhone, process.env.BOT_OWNER_PHONE);
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
    // ── v2: one-shot traffic-light routine check ─────────────────────────────
    case "health":
    case "check":
    case "checks": {
      const s = readStatus();
      const [pm2Out, backupOut, errTail] = await Promise.all([
        runSafe("pm2 jlist"),
        runSafe("ls -t /home/pi/backups/nightly/*.tar.gz 2>/dev/null | head -3 | xargs -r ls -lh --time-style=+%Y-%m-%d | awk '{print $6, $5, $7}'"),
        runSafe(`tail -50 "${ERR_FILE}" 2>/dev/null | grep -ci "error" || true`),
      ]);

      // PM2 all apps
      let pm2Lines = "N/A";
      let pm2Bad = 0;
      try {
        const procs = JSON.parse(pm2Out);
        pm2Lines = procs.map((p: any) => {
          const ok = p.pm2_env.status === "online";
          if (!ok) pm2Bad++;
          const mem = Math.round((p.monit?.memory ?? 0) / 1048576);
          return `${ok ? "✅" : "🚨"} ${p.name} ${mem}MB r${p.pm2_env.restart_time}`;
        }).join("\n");
      } catch {}

      // Backup freshness
      let backupLine = "🚨 No backups found!";
      if (backupOut) {
        const newest = backupOut.split("\n")[0] ?? "";
        const dateStr = newest.split(" ")[0] ?? "";
        const ageDays = dateStr ? Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000) : 99;
        backupLine = ageDays <= 1 ? `✅ Fresh (${dateStr})` : ageDays <= 2 ? `⚠️ ${ageDays}d old` : `🚨 ${ageDays}d old — check cron!`;
      }

      const temp = s ? fmtTemp(s.cpu_temp) : "N/A";
      const ram  = s ? fmtPct(s.ram_percent) : "N/A";
      const disk = s ? fmtPct(s.disk_percent, 70, 85) : "N/A";
      const net  = s ? (s.internet_ok ? "✅" : "🚨 DOWN") : "N/A";
      const errCount = parseInt(errTail) || 0;
      const errLine = errCount === 0 ? "✅ clean" : errCount < 5 ? `⚠️ ${errCount} in last 50 lines` : `🚨 ${errCount} in last 50 lines`;
      const verdict = pm2Bad === 0 && (s?.internet_ok ?? false) && !backupLine.startsWith("🚨")
        ? "💚 *ALL SYSTEMS GO*" : "🔴 *ATTENTION NEEDED*";

      reply = `${verdict}\n━━━━━━━━━━━━━━━━━━━\n🌡 ${temp}  💾 RAM ${ram}  💿 Disk ${disk}  📡 ${net}\n\n*PM2 (${pm2Bad === 0 ? "all online" : pm2Bad + " DOWN"})*\n${pm2Lines}\n\n*Nightly backup:* ${backupLine}\n*Bot errors:* ${errLine}\n\n_Deep dive: !pi status · !pi errors · !pi backup_`;
      break;
    }

    // ── v2: backup status + manual trigger ───────────────────────────────────
    case "backup": {
      if (args[0] === "now") {
        await client.sendMessage(to, "💾 Running backup now...");
        await runSafe("/home/pi/scripts/nightly-backup.sh", 120000);
      }
      const listing = await runSafe("ls -lht /home/pi/backups/nightly/ 2>/dev/null | tail -n +2 | awk '{print $9, \"(\" $5 \")\"}' | head -9");
      const logTail = await runSafe("tail -4 /home/pi/logs/nightly-backup.log 2>/dev/null");
      reply = `*Nightly Backups* (~/backups/nightly)\n━━━━━━━━━━━━━━━━━━━\n\`\`\`\n${listing || "none found"}\n\`\`\`\n*Last run log:*\n\`\`\`\n${logTail || "no log"}\n\`\`\`\n_Trigger manually: !pi backup now_`;
      break;
    }

    // ── Full self-check (reuses the cron script) ─────────────────────────────
    case "selfcheck":
    case "sc": {
      const out = await runSafe("/home/pi/scripts/pi-selfcheck.py --print", 30000);
      reply = out || "self-check produced no output — is the script present?";
      break;
    }

    case "drift": {
      // Docs-freshness + board↔repo sync checks (weekly cron writes ~/reports/;
      // this runs them on demand).
      const [docs, sync] = await Promise.all([
        runSafe("python3 /home/pi/scripts/check_docs_drift.py --all", 30000),
        runSafe("python3 /home/pi/scripts/check_board_sync.py", 30000),
      ]);
      reply = `🧹 *Drift check*\n\n📄 Docs vs disk:\n${docs || "no output"}\n\n📋 Board ↔ repos:\n${sync || "no output"}`;
      break;
    }

    // ── Cosmo + LED status ───────────────────────────────────────────────────
    case "led": {
      const health = await runSafe("curl -s -m5 http://127.0.0.1:8000/health", 8000);
      const ledH = await runSafe("curl -s -m5 http://127.0.0.1:8000/led/health", 8000);
      let out = "🤖 *Cosmo / LED*\n";
      try {
        const h = JSON.parse(health);
        out += `Cosmo API: ✅ up ${h.uptime_s}s · ${h.cpu_temp_c}°C · RAM ${h.free_ram_mb}MB\n`;
      } catch { out += "Cosmo API: 🚨 down (cosmo not running?)\n"; }
      try {
        const l = JSON.parse(ledH);
        out += `LED strip: ${l.connected ? "✅ connected" : "⚪ not connected"} · ${l.writes_ok} ok/${l.writes_fail} fail`;
        if (l.tv_sync) out += "\n📺 TV sync active";
        if (l.scene) out += `\n🎬 scene: ${l.scene}`;
        if (l.last_error) out += `\n⚠️ ${l.last_error}`;
      } catch { out += "LED: (no data)"; }
      reply = out;
      break;
    }

    // ── v2: top processes by memory ──────────────────────────────────────────
    case "top": {
      const out = await runSafe("ps aux --sort=-rss | head -8 | awk 'NR>1{printf \"%.0fMB %.0f%% %s\\n\", $6/1024, $3, substr($11,1,40)}'");
      reply = `*Top processes (RAM / CPU)*\n\`\`\`\n${out}\n\`\`\``;
      break;
    }

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
        // Restarting banteragent risks the WhatsApp session — always confirm first
        await client.sendMessage(to, "⚠️ Restarting BanterAgent touches the WhatsApp session. Reply *!pi confirm restart* to proceed.");
        return;
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
      if (args[0] === "restart") {
        await client.sendMessage(to, "🔄 Restarting BanterAgent...");
        await runSafe("pm2 restart banteragent");
        await new Promise(r => setTimeout(r, 10000));
        const status = await runSafe("pm2 jlist");
        let ok = false;
        try { ok = JSON.parse(status).find((p: any) => p.name === "banteragent")?.pm2_env?.status === "online"; } catch {}
        reply = ok ? "✅ BanterAgent restarted successfully!" : "❌ BanterAgent may not have started. Check !pi errors";
        break;
      }
      reply = "Unknown confirmation. Use: !pi confirm reboot | !pi confirm restart";
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
          // v2: never auto-restart — code is ready, restart only on explicit confirm
          reply = `✅ Code updated & build clean!\n\`\`\`\n${gitOut.slice(0, 200)}\n\`\`\`\n⚠️ Changes apply on next restart. Reply *!pi confirm restart* when ready.`;
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

    case "cosmo": {
      const COSMO_LOG = path.join(process.env.HOME ?? "/home/pi", ".robot/logs/action_log.json");
      const n = Math.min(parseInt(args[0] ?? "20") || 20, 50);
      if (!fs.existsSync(COSMO_LOG)) {
        reply = "🤖 No Cosmo reactions logged yet. Is cosmo running? (`!pi status`)";
        break;
      }
      let entries: any[] = [];
      try {
        entries = JSON.parse(fs.readFileSync(COSMO_LOG, "utf8"));
      } catch {
        reply = "❌ Could not read Cosmo action log.";
        break;
      }
      const recent = entries.slice(-n).reverse(); // newest first
      if (recent.length === 0) {
        reply = "🤖 Log file exists but no entries yet.";
        break;
      }
      const TYPE_EMOJI: Record<string, string> = {
        sound: "🔊", speech: "🗣️", move: "🚶", expr: "👁️", display: "🖥️", servo: "🦾"
      };
      const lines = recent.map((e: any) => {
        const emoji = TYPE_EMOJI[e.output_type] ?? "•";
        const detail = e.detail ? `: ${e.detail}` : "";
        return `${e.ts_str}  ${emoji} *${e.output_detail}*\n    📍 ${e.trigger}${detail}`;
      });
      reply = `🤖 *Cosmo — Last ${lines.length} Reactions*\n${"━".repeat(20)}\n\n${lines.join("\n\n")}`;
      break;
    }

    case "help":
      reply = `*Pi Admin Commands*\n━━━━━━━━━━━━━━━━━━━\n💚 !pi health — One-shot traffic-light check (START HERE)\n🔍 !pi selfcheck — Deep validation (services/backups/watchdog/cosmo/LED)\n🧹 !pi drift — Docs-freshness + board↔repo sync check\n!pi status — Full system report\n🤖 !pi led — Cosmo API + LED strip health\n!pi cosmo [n] — Last N Cosmo reactions\n!pi backup [now] — Nightly backup status / trigger\n!pi top — Top processes by RAM\n!pi temp / battery / disk / network / uptime\n!pi logs [n] — Last N log lines\n!pi errors — Recent error logs\n\n*LED strip + Wipro bulb (TV Ambilight)*\n!led tv on / off — Sync strip + Wipro bulb to TV colours\n!led calibrate — Detect TV boundary (show a full-red screen first)\n!led status — Connection, sync mode, calibration, write health\n!led <colour> — red green blue white warm yellow orange purple pink cyan amber\n!led 255 0 128 — Custom RGB\n!led bright <0-100> — Brightness (0 = dark, stays connected)\n!led on / off — Soft power\n!led movie|chill|night|focus|reading|romance|party — Scene presets\n\n*Cosmo (robot)*\n!cosmo — Camera live feed link (also: !cosmo live)\n!cosmo snap — Camera photo · !cosmo record [s] — Video clip\n!cosmo status / caps / mood / last / log — Brain state\n!cosmo say <text> — Speak via TTS · !cosmo sim <event> — Inject event\n!cosmo test — Fire demo events · !cosmo move fwd|back|left|right|stop\n!cosmo home <event> — Smart-home event · !cosmo health — Full dump\n!cosmo mem — RAM usage · !cosmo start / stop — PM2 control\n\n*Games admin (owner)*\n!refreshgames — Archive stats · add <game> [N] · all [N] · reset\n!gamestats — Game archive stats · !gamecheck — Pool integrity check\n\n*Danger Zone*\n!pi restart bot — Restart BanterAgent (asks confirm)\n!pi restart pi — Reboot Pi (asks confirm)\n!pi update bot — Git pull + build (restart on confirm)\n!pi clean — Safe cleanup (logs + cache)`;
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
