// Admin command handler ? responds only to BOT_OWNER_PHONE in personal (non-group) chat.
// Professional English tone. No banter personality.
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";

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
  if (isGroup || senderPhone !== ownerPhone) return false;
  if (!text.startsWith("!")) return false;

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
        await client.sendMessage(ownerPhone!, reply);
        execAsync("bash /home/pi/scripts/fix-bugs.sh &").catch(() => {});
        return true;
      }

      case "reboot": {
        reply = `*[Monitor]* Rebooting Pi in 5 seconds...`;
        await client.sendMessage(ownerPhone!, reply);
        setTimeout(() => execAsync("sudo reboot").catch(() => {}), 5000);
        return true;
      }

      case "shutdown": {
        reply = `*[Monitor]* Shutting down Pi in 5 seconds...`;
        await client.sendMessage(ownerPhone!, reply);
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

      case "help":
        reply = `*[Monitor] Admin Commands*
!ping ? alive check + uptime
!battery ? battery level, voltage, AC + charge status
!status ? full system status
!charging on|off ? manually enable/disable charging
!restart <service> ? restart PM2 process
!logs [service] [n] ? last N log lines (default 30)
!ip ? IP addresses (local + Tailscale)
!uptime ? uptime + load average
!wifi ? active network connections
!bugs ? show open/pending bugs
!fixbugs ? manually trigger bug fixer
!temp ? CPU temperature
!ps ? top processes by CPU
!reboot ? reboot Pi
!shutdown ? shutdown Pi`;
        break;

      default:
        reply = `Unknown command: !${cmd}\nSend *!help* for available commands.`;
    }
  } catch (err: any) {
    reply = `*[Monitor] Error running !${cmd}*\n${err.message?.slice(0, 300)}`;
  }

  await client.sendMessage(ownerPhone!, reply);
  return true;
}
