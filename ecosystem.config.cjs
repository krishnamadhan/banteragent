module.exports = {
  apps: [
    {
      name: "banteragent",
      script: "npm",
      args: "run start",
      cwd: "/home/pi/banteragent",
      interpreter: "none",
      restart_delay: 5000,
      max_restarts: 20,
      min_uptime: "10s",
      env: {
        NODE_ENV: "production",
      },
      // Restart if process exits unexpectedly
      autorestart: true,
      // Log files
      out_file: "/home/pi/logs/banteragent-out.log",
      error_file: "/home/pi/logs/banteragent-err.log",
      merge_logs: true,
      time: true,
    },
  ],
};
