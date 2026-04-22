module.exports = {
  apps: [
    // ── Core bot ─────────────────────────────────────────────────────────────
    {
      name: "banteragent",
      script: "npm",
      args: "run start",
      cwd: "/home/pi/banteragent",
      interpreter: "none",
      restart_delay: 5000,
      max_restarts: 20,
      min_uptime: "10s",
      env: { NODE_ENV: "production" },
      autorestart: true,
      out_file: "/home/pi/logs/banteragent-out.log",
      error_file: "/home/pi/logs/banteragent-err.log",
      merge_logs: true,
      time: true,
    },

    // ── Centralized cron scheduler ────────────────────────────────────────────
    // Drives all scheduled tasks by calling BanterAgent's /run-task endpoint.
    // If BanterAgent is down when a task fires, the HTTP call fails silently
    // and the next cron tick will retry automatically.
    {
      name: "pi-scheduler",
      script: "/home/pi/pi-scheduler/index.js",
      cwd: "/home/pi/pi-scheduler",
      interpreter: "node",
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 50,
      min_uptime: "5s",
      out_file: "/home/pi/logs/pi-scheduler-out.log",
      error_file: "/home/pi/logs/pi-scheduler-err.log",
      merge_logs: true,
      time: true,
    },

    // ── Pi system monitor ─────────────────────────────────────────────────────
    {
      name: "pi-monitor",
      script: "/home/pi/pi-monitor/monitor.py",
      interpreter: "python3",
      autorestart: true,
      restart_delay: 10000,
      out_file: "/home/pi/logs/pi-monitor-out.log",
      error_file: "/home/pi/logs/pi-monitor-err.log",
      time: true,
    },

    // ── Auxiliary processes ───────────────────────────────────────────────────
    {
      name: "bug-watcher",
      script: "/home/pi/scripts/bug-watcher.sh",
      interpreter: "bash",
      autorestart: true,
      restart_delay: 3000,
      out_file: "/home/pi/logs/bug-watcher-out.log",
      error_file: "/home/pi/logs/bug-watcher-err.log",
      time: true,
    },
    {
      name: "battery-monitor",
      script: "/home/pi/robot/battery_monitor.py",
      interpreter: "python3",
      autorestart: true,
      restart_delay: 10000,
      out_file: "/home/pi/logs/battery-monitor-out.log",
      error_file: "/home/pi/logs/battery-monitor-err.log",
      time: true,
    },
  ],
};
