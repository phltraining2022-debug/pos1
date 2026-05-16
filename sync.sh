#!/bin/bash
# Sync kara2 -> cdn.live1.vn:/var/www/cdn/builder-1/kara2

SRC="/Users/ben/Documents/bk/cdn/builder-1/kara2/"
DST="root@cdn.live1.vn:/var/www/cdn/builder-1/kara2/"

rsync -avz --progress \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='*.log' \
  --exclude='.DS_Store' \
  "$SRC" "$DST"
