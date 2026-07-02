// Admin command handler ? responds only to BOT_OWNER_PHONE in personal (non-group) chat.
// Professional English tone. No banter personality.
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import { configuredOwnerJid, samePhone } from "./phone.js";

const execAsync = promisify(exec);

function readBatteryState(): Record<string, any> {
  try { return JSON.parse(fs.readFileSync("/tmp/battery_monitor_state.json", "utf8")); }
  catch { return {}; }
}

export async function handleAdminCommand(
  client: any,
  senderPhone: string,
  isGroup: boolean,
  text: string
): Promise<boolean> {
  const ownerPhone = process.env.BOT_OWNER_PHONE;
  const ownerJid = configuredOwnerJid();
  if (isGroup || !samePhone(senderPhone, ownerPhone) || !ownerJid) return false;
  if (!text.startsWith("!")) return false;
  if (text.toLowerCase().startsWith("!pi ") || text.toLowerCase() === "!pi") return false;

  const [cmd, ...args] = text.slice(1).toLowerCase().trim().split(/\s+/);
  let reply = "";

  try {
    switch (cmd) {

      case "ping": {
        const uptime = await execAsync("uptime -p").then(r => r.stdout.trim());
        reply = `*[Monitor] Online*\nUptime: ${uptime}`;
        break;
      }

      case "battery": {
        const state = readBatteryState();
        const pyScript = `
import smbus2, time
def read(retries=3):
    for i in range(retries):
        bus = smbus2.SMBus(1)
        try:
            dv = bus.read_i2c_block_data(0x36,0x02,2)
            ds = bus.read_i2c_block_data(0x36,0x04,2)
        finally:
            bus.close()
        raw_v=(dv[0]<<8)|dv[1]; v=(raw_v>>4)*1.25/1000
        raw_s=(ds[0]<<8)|ds[1]; soc=(raw_s>>8)+((raw_s&0xFF)/256)
        if 2.5<=v<=4.5 and 0<=soc<=100:
            print(f'{v:.3f},{soc:.1f}'); return
        time.sleep(2)
    raise ValueError('bad I2C read')
read()
`.trim().replace(/\n/g, "; ");
        let v: number, soc: number;
        try {
          const { stdout } = await execAsync(`python3 -c "${pyScript.replace(/"/g, '\\"')}"`);
          [v, soc] = stdout.trim().split(",").map(Number);
        } catch {
          // Fall back to state file values if I2C is unavailable
          const s = readBatteryState() as any;
          reply = `*[Monitor] Battery*\n⚠️ I2C sensor unavailable\nLast known: ${s.last_soc ?? "?"}% (${s.last_voltage ?? "?"}V)\nAC: ${s.ac_ok ? "Connected" : "DISCONNECTED"} | Charging: ${s.charging ? "ON" : "OFF"}`;
          break;
        }
        const ac = state.ac_ok === true ? "Connected" : state.ac_ok === false ? "DISCONNECTED" : "Unknown";
        const chState = (state as any).charging;
        const charging = chState === true ? "ON" : chState === false ? "OFF" : "Unknown";
        const vstatus = v >= 3.87 ? "Full" : v >= 3.70 ? "High" : v >= 3.55 ? "Medium" : v >= 3.40 ? "Low" : "Critical";
        const filled = Math.max(0, Math.min(10, Math.round(soc / 10)));
        const bar = "|".repeat(filled) + ".".repeat(10 - filled);
        reply = `*[Monitor] Battery*\n${bar} ${soc.toFixed(1)}%\nVoltage: ${v.toFixed(3)}V (${vstatus})\nAC Power: ${ac}\nCharging: ${charging}`;
        break;
      }

      case "charging": {
        const onOff = args[0];
        if (!onOff || !["on", "off"].includes(onOff)) { reply = "Usage: !charging on|off"; break; }
        const level = onOff === "on" ? "dl" : "dh";
        await execAsync(`pinctrl set 16 op ${level}`);
        // Update state file
        const state = readBatteryState();
        state.charging = onOff === "on";
        fs.writeFileSync("/tmp/battery_monitor_state.json", JSON.stringify(state));
        reply = `*[Monitor]* Charging ${onOff === "on" ? "enabled" : "disabled"}.`;
        break;
      }

      case "status": {
        const state = readBatteryState();
        const [batRaw, temp, mem, disk, pm2out] = await Promise.all([
          execAsync(`python3 -c "import smbus2; bus=smbus2.SMBus(1); dv=bus.read_i2c_block_data(0x36,0x02,2); ds=bus.read_i2c_block_data(0x36,0x04,2); bus.close(); raw_v=(dv[0]<<8)|dv[1]; v=(raw_v>>4)*1.25/1000; raw_s=(ds[0]<<8)|ds[1]; soc=(raw_s>>8)+((raw_s&0xFF)/256); print(f'{v:.2f}V {soc:.0f}%')"`).then(r => r.stdout.trim()).catch(() => "N/A"),
          execAsync("vcgencmd measure_temp 2>/dev/null || awk '{printf \"%.1f C\", $1/1000}' /sys/class/thermal/thermal_zone0/temp").then(r => r.stdout.trim()).catch(() => "N/A"),
          execAsync("free -h | awk '/^Mem/{print $3\"/\"$2}'").then(r => r.stdout.trim()).catch(() => "N/A"),
          execAsync("df -h / | awk 'NR==2{print $3\"/\"$2\" (\"$5\")\"}' ").then(r => r.stdout.trim()).catch(() => "N/A"),
          execAsync("pm2 jlist 2>/dev/null").then(r => {
            return JSON.parse(r.stdout)
              .map((p: any) => `  ${p.name}: ${p.pm2_env.status}`)
              .join("\n");
          }).catch(() => "  (pm2 unavailable)"),
        ]);
        const acLabel = state.ac_ok === true ? "AC OK" : state.ac_ok === false ? "AC LOST" : "AC ?";
        const chLabel = state.charging === false ? "charge OFF" : "charge ON";
        reply = `*[Monitor] System Status*\nBattery:  ${batRaw} ${acLabel} ${chLabel}\nCPU temp: ${temp}\nMemory:   ${mem}\nDisk:     ${disk}\n\nPM2:\n${pm2out}`;
        break;
      }

      case "restart": {
        const svc = args[0];
        const allowed = ["banteragent", "bug-watcher", "battery-monitor"];
        if (!svc) { reply = `Usage: !restart <service>\nAllowed: ${allowed.join(", ")}`; break; }
        if (!allowed.includes(svc)) { reply = `Unknown service. Allowed: ${allowed.join(", ")}`; break; }
        await execAsync(`pm2 restart ${svc}`);
        reply = `*[Monitor]* Restarted \`${svc}\`.`;
        break;
      }

      case "logs": {
        const svc  = args[0] || "banteragent";
        const n    = Math.min(parseInt(args[1]) || 30, 100);
        const file = `/home/pi/logs/${svc}-out.log`;
        if (!fs.existsSync(file)) { reply = `Log not found: ${file}`; break; }
        const { stdout } = await execAsync(`tail -${n} "${file}"`);
        reply = `*[Monitor] ${svc} (last ${n} lines)*\n\`\`\`\n${stdout.trim().slice(0, 3500)}\n\`\`\``;
        break;
      }

      case "ip": {
        const [local, ts] = await Promise.all([
          execAsync("hostname -I | awk '{print $1}'").then(r => r.stdout.trim()),
          execAsync("tailscale ip -4 2>/dev/null").then(r => r.stdout.trim()).catch(() => "N/A"),
        ]);
        reply = `*[Monitor] IP Addresses*\nLocal:     ${local}\nTailscale: ${ts}`;
        break;
      }

      case "uptime": {
        const [up, load] = await Promise.all([
          execAsync("uptime -p").then(r => r.stdout.trim()),
          execAsync("awk '{print $1, $2, $3}' /proc/loadavg").then(r => r.stdout.trim()),
        ]);
        reply = `*[Monitor] Uptime*\n${up}\nLoad avg: ${load}`;
        break;
      }

      case "wifi": {
        const { stdout } = await execAsync("nmcli -t -f NAME,DEVICE,STATE con show --active 2>/dev/null");
        reply = `*[Monitor] Network*\n${stdout.trim()}`;
        break;
      }

      case "bugs": {
        const { stdout } = await execAsync(`grep -A4 'Status.*OPEN\\|Status.*PENDING' /home/pi/banteragent/bugs.md 2>/dev/null || echo 'No open bugs'`);
        reply = `*[Monitor] Open Bugs*\n${stdout.trim().slice(0, 3000)}`;
        break;
      }

      case "fixbugs": {
        reply = `*[Monitor]* Triggering bug fixer...`;
        await client.sendMessage(ownerJid, reply);
        execAsync("bash /home/pi/scripts/fix-bugs.sh &").catch(() => {});
        return true;
      }

      case "reboot": {
        reply = `*[Monitor]* Rebooting Pi in 5 seconds...`;
        await client.sendMessage(ownerJid, reply);
        setTimeout(() => execAsync("sudo reboot").catch(() => {}), 5000);
        return true;
      }

      case "shutdown": {
        reply = `*[Monitor]* Shutting down Pi in 5 seconds...`;
        await client.sendMessage(ownerJid, reply);
        setTimeout(() => execAsync("sudo shutdown -h now").catch(() => {}), 5000);
        return true;
      }

      case "ps": {
        const { stdout } = await execAsync("ps aux --sort=-%cpu | head -8 | awk 'NR>1{print $1,$3,$4,$11}'");
        reply = `*[Monitor] Top Processes*\n\`\`\`\n${stdout.trim()}\n\`\`\``;
        break;
      }

      case "temp": {
        const { stdout } = await execAsync("vcgencmd measure_temp 2>/dev/null || awk '{printf \"%.1f C\", $1/1000}' /sys/class/thermal/thermal_zone0/temp");
        reply = `*[Monitor] CPU Temperature*\n${stdout.trim()}`;
        break;
      }

      case "run": {
        const task = args.join(" ").trim();
        if (!task) {
          reply = "Usage: !run <task description>\nExample: !run why did banteragent crash at 3pm";
          break;
        }

        const SESSION_CONTEXT = `# Pi Remote Session — System Context

## Device
- Raspberry Pi 5, Linux (aarch64), user: pi, home: /home/pi
- Shell: bash, --dangerously-skip-permissions: active

## PM2 Services
- banteragent     — WhatsApp bot (TypeScript/ESM), internal HTTP on port 3099
- battery-monitor — Battery health + AC power monitor
- pi-monitor      — System health, writes /tmp/pi-monitor-state.json
- pi-scheduler    — Centralized node-cron (IST), POSTs tasks to BanterAgent :3099

## Projects

BanterAgent — /home/pi/banteragent/
  Source: src/ (TypeScript, ESM). Build: cd /home/pi/banteragent && npm run build
  Deploy after build: pm2 restart banteragent
  Bug tracker: /home/pi/banteragent/bugs.md
  Config: /home/pi/banteragent/.env
  Internal API:
    POST http://127.0.0.1:3099/notify   { message, to? }  — send WhatsApp message
    POST http://127.0.0.1:3099/run-task { task }           — trigger a scheduled task
  WhatsApp targets:
    Main group:  120363399878677641@g.us
    IPL Fantasy: 120363424669447247@g.us
    Admin DM:    919487506127@c.us

pi-scheduler — /home/pi/pi-scheduler/index.js (CommonJS, node-cron)
  Restart: pm2 restart pi-scheduler

IPL Fantasy — /home/pi/ipl-fantasy/ (Next.js 16, Supabase, Tailwind)
  Deploy: git commit + push to main → Vercel auto-deploys

BSPL Cricket Sim — /home/pi/bspl/ (Next.js, Supabase, not deployed)

Robot — /home/pi/robot/ and /home/pi/robot_move.py

## Scripts & Logs
  Scripts: /home/pi/scripts/
  Logs:    /home/pi/logs/
  Scheduled bug fixer: /home/pi/scripts/scheduled-bug-fixer.sh (runs every 30 min via pi-scheduler)
  Apply-fix: /home/pi/banteragent/src/apply-fix.sh

## Sending WhatsApp from shell
  curl -s -X POST http://127.0.0.1:3099/notify \\
    -H 'Content-Type: application/json' \\
    -d '{"message":"...","to":"919487506127@c.us"}'

## Task
${task}`;

        // Show context to admin before spawning so they can review it
        const preview = SESSION_CONTEXT.length > 3600
          ? SESSION_CONTEXT.slice(0, 3600) + "\n...(truncated for display)"
          : SESSION_CONTEXT;
        await client.sendMessage(ownerJid, `*[Claude Session Starting]*\nTask: _${task}_\n\n*Context the session will receive:*\n\`\`\`\n${preview}\n\`\`\``);

        // Spawn Claude — runs asynchronously, sends result back when done
        const { execFile } = await import("child_process");
        execFile(
          "claude",
          ["--dangerously-skip-permissions", "--print", SESSION_CONTEXT],
          { timeout: 10 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 },
          async (err, stdout) => {
            const output = stdout?.trim();
            if (!output) {
              const errMsg = (err?.message ?? "No output returned").slice(0, 400);
              await client.sendMessage(ownerJid, `*[Claude Error]*\n${errMsg}`).catch(() => {});
              return;
            }
            const MAX = 3800;
            const parts = Math.ceil(output.length / MAX);
            for (let i = 0; i < output.length; i += MAX) {
              const chunk = output.slice(i, i + MAX);
              const label = parts > 1 ? ` (${Math.floor(i / MAX) + 1}/${parts})` : "";
              await client.sendMessage(ownerJid, `*[Claude Result]${label}*\n${chunk}`).catch(() => {});
            }
          }
        );

        return true; // context message already sent above
      }

      case "help":
        reply = `*[Monitor] Admin Commands*
!ping — alive check + uptime
!battery — battery level, voltage, AC + charge status
!status — full system status
!charging on|off — manually enable/disable charging
!restart <service> — restart PM2 process
!logs [service] [n] — last N log lines (default 30)
!ip — IP addresses (local + Tailscale)
!uptime — uptime + load average
!wifi — active network connections
!bugs — show open/pending bugs
!fixbugs — manually trigger bug fixer
!temp — CPU temperature
!ps — top processes by CPU
!led calibrate — calibrate TV boundary from full red screen
!led tv on|off — TV Ambilight sync
!reboot — reboot Pi
!shutdown — shutdown Pi
!run <task> — spawn a Claude session to execute a task`;
        break;

      // Commands handled by the main router — fall through so they work in DM too
      case "bug":
      case "fantasy":
      case "fl":
      case "solli":
      case "predict":
      case "cosmo":
      case "led":
      case "lights":
      case "light":
        return false;

      default:
        reply = `Unknown command: !${cmd}\nSend *!help* for available commands.`;
    }
  } catch (err: any) {
    reply = `*[Monitor] Error running !${cmd}*\n${err.message?.slice(0, 300)}`;
  }

  await client.sendMessage(ownerJid, reply);
  return true;
}
