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
      name: "battery-monitor",
      script: "/home/pi/robot/battery_monitor.py",
      cwd: "/home/pi/robot",
      interpreter: "python3",
      autorestart: true,
      restart_delay: 10000,
      out_file: "/home/pi/logs/battery-monitor-out.log",
      error_file: "/home/pi/logs/battery-monitor-err.log",
      time: true,
    },

    // ── Claude Code remote session ("Pi Control") ─────────────────────────────
    // The ONLY Claude remote entry point (systemd claude-remote.service was
    // disabled 2026-07-02 — it duplicated this with a "mypi" session prefix).
    {
      name: "claude-remote",
      script: "/home/pi/scripts/claude-remote-start.sh",
      cwd: "/home/pi",
      interpreter: "/bin/bash",
      autorestart: true,
      restart_delay: 8000,
      out_file: "/home/pi/logs/claude-remote-out.log",
      error_file: "/home/pi/logs/claude-remote-err.log",
      time: true,
    },

    // ── Cosmo robot ───────────────────────────────────────────────────────────
    {
      name: "cosmo",
      script: "/home/pi/robot/tools/cosmo_demo.py",
      cwd: "/home/pi/robot",
      interpreter: "python3",
      autorestart: true,
      restart_delay: 5000,
      max_memory_restart: "1200M",
      env: { PYTHONPATH: "/home/pi/robot" },
      out_file: "/home/pi/.robot/logs/cosmo-out.log",
      error_file: "/home/pi/.robot/logs/cosmo-err.log",
      time: true,
    },

    // ── Irfan shorts UI ───────────────────────────────────────────────────────
    {
      name: "irfan-ui",
      script: "/home/pi/irfan-shorts/app.py",
      cwd: "/home/pi/irfan-shorts",
      interpreter: "python3",
      autorestart: true,
      time: true,
    },

    // ── AgentBoard — two-agent kanban UI (:9091) + daily WhatsApp standup ─────
    {
      name: "agentboard",
      script: "/home/pi/agentboard/server.py",
      cwd: "/home/pi/agentboard",
      interpreter: "python3",
      autorestart: true,
      restart_delay: 5000,
      out_file: "/home/pi/logs/agentboard-out.log",
      error_file: "/home/pi/logs/agentboard-err.log",
      time: true,
    },

    // Removed 2026-07-02 (were defined here but absent from the live PM2 dump):
    //   claude-startup — one-shot boot notifier, superseded by pi-monitor's reports
    //   bug-watcher    — scheduled-bug-fixer flow is disabled in pi-scheduler too
  ],
};
