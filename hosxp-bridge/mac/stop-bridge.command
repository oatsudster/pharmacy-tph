#!/bin/bash
# ปิด HOSxP Bridge บน Mac (ไม่มีหน้าต่างให้ปิด) — เปิดใหม่: Restart HOSxP Bridge.command
for p in $(pgrep -f 'hosxp-bridge[.]ps1'); do kill "$p" 2>/dev/null; done
echo "ปิด HOSxP Bridge แล้ว"
sleep 1
