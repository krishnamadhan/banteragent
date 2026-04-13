#!/bin/bash
# deploy.sh — Push latest code to Raspberry Pi and restart the bot
# Usage: ./deploy.sh
# Run from PC after committing your changes.

set -e

PI_HOST="${PI_HOST:-pi@100.101.250.126}"   # Tailscale IP (change to 192.168.1.30 for local)
REMOTE_DIR="/home/pi/banteragent"

echo "==> Deploying to $PI_HOST:$REMOTE_DIR"

ssh "$PI_HOST" bash << EOF
  set -e
  cd "$REMOTE_DIR"

  echo "--- Pulling latest code ---"
  git pull

  echo "--- Installing dependencies ---"
  npm install --omit=dev

  echo "--- Building TypeScript ---"
  npm run build

  echo "--- Restarting PM2 ---"
  pm2 restart banteragent || pm2 start dist/index.js --name banteragent

  echo "--- Done ---"
  pm2 status banteragent
EOF

echo ""
echo "Deploy complete! Bot is running on the Pi."
echo "To tail logs: ssh $PI_HOST 'pm2 logs banteragent --lines 50'"
