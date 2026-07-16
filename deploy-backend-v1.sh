#!/bin/bash
# Deploy backend API lên production v1: kara.test.live1.vn
# (server dùng chung với nhiều app khác — prod-api, prod-ats, prod-tl...,
#  chỉ động tới PM2 process 'prod-kara' của riêng app này)
# Usage: ./deploy-backend-v1.sh [--no-restart]

set -e

SERVER="root@kara.test.live1.vn"
REMOTE_PATH="/home/ubuntu/staging/kara/erp/"
LOCAL_PATH="$(dirname "$0")/api/erp/"
PM2="/home/ubuntu/.nvm/versions/node/v16.20.1/bin/pm2"

echo "[1/3] Backing up $SERVER:$REMOTE_PATH ..."
ssh "$SERVER" "BACKUP=/home/ubuntu/staging/kara/erp-backup-\$(date +%Y%m%d-%H%M%S).tar.gz; tar czf \"\$BACKUP\" --exclude=node_modules --exclude='*.log' --exclude=logs -C /home/ubuntu/staging/kara erp && echo \"[OK] Backup: \$BACKUP\""

echo "[2/3] Syncing api/erp/ → $SERVER:$REMOTE_PATH ..."
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

echo "[3/3] Reloading PM2 app 'prod-kara' ..."
ssh "$SERVER" "su - ubuntu -s /bin/bash -c 'PATH=/home/ubuntu/.nvm/versions/node/v16.20.1/bin:\$PATH pm2 reload prod-kara --no-color'"

echo "[✓] Deploy xong!"
