#!/bin/bash
# Deploy frontend lên CDN: https://cdn.live1.vn/builder-1/kara2/
# Usage: ./deploy-frontend.sh [--no-build]
#
# Lưu ý: thư mục đích trên server có .git nhưng KHÔNG được dùng git để deploy —
# nó bị kẹt ở commit đầu tiên và có hàng trăm thay đổi thủ công chưa commit.
# Deploy đúng cách là ghi đè trực tiếp dist/, index.html, service-worker.js
# (xem memory: deploy_infrastructure).

set -e

SERVER="root@cdn.live1.vn"
REMOTE_PATH="/var/www/cdn/builder-1/kara2"
LOCAL_PATH="$(dirname "$0")"

if [[ "$1" != "--no-build" ]]; then
  echo "[1/4] Building (node build.js) ..."
  node "$LOCAL_PATH/build.js"
else
  echo "[!] Skipping build (--no-build)"
fi

echo "[2/4] Backing up $SERVER:$REMOTE_PATH ..."
ssh "$SERVER" "BACKUP=/var/www/cdn/builder-1/kara2-backup-\$(date +%Y%m%d-%H%M%S).tar.gz; tar czf \"\$BACKUP\" -C /var/www/cdn/builder-1 kara2 && echo \"[OK] Backup: \$BACKUP\""

echo "[3/4] Syncing dist/, index.html, service-worker.js → $SERVER:$REMOTE_PATH/ ..."
rsync -avz --progress "$LOCAL_PATH/dist/" "$SERVER:$REMOTE_PATH/dist/"
rsync -avz --progress "$LOCAL_PATH/index.html" "$SERVER:$REMOTE_PATH/index.html"
rsync -avz --progress "$LOCAL_PATH/service-worker.js" "$SERVER:$REMOTE_PATH/service-worker.js"

echo "[4/4] Verifying ..."
ssh "$SERVER" "grep 'dist/app.bundle.js' $REMOTE_PATH/index.html; grep 'const CACHE_NAME' $REMOTE_PATH/service-worker.js"

echo "[✓] Deploy xong! → https://cdn.live1.vn/builder-1/kara2/"
