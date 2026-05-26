#!/bin/bash
# Deploy backend API lên production: kara.app.live1.vn
# Usage: ./deploy-backend.sh [--no-restart]

set -e

SERVER="root@kara.app.live1.vn"
REMOTE_PATH="/home/ubuntu/staging/kara/erp/"
LOCAL_PATH="$(dirname "$0")/api/erp/"
PM2="/home/ubuntu/.nvm/versions/node/v16.20.1/bin/pm2"

echo "[1/2] Syncing api/erp/ → $SERVER:$REMOTE_PATH ..."
rsync -avz --progress \
  --exclude='node_modules/' \
  --exclude='*.log' \
  --exclude='.DS_Store' \
  --exclude='.git/' \
  --exclude='logs/' \
  --exclude='server/datasources.json' \
  --exclude='credentials.json' \
  --exclude='google-sheet-credentials.json' \
  "$LOCAL_PATH" "$SERVER:$REMOTE_PATH"

if [[ "$1" == "--no-restart" ]]; then
  echo "[!] Skipping PM2 reload (--no-restart)"
  exit 0
fi

echo "[2/2] Reloading PM2 app 'prod-kara' ..."
ssh "$SERVER" "su - ubuntu -s /bin/bash -c 'PATH=/home/ubuntu/.nvm/versions/node/v16.20.1/bin:\$PATH pm2 reload prod-kara --no-color'"

echo "[✓] Deploy xong!"
