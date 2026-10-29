#!/bin/bash
# เปิด HOSxP Bridge บน Mac — LaunchAgent (th.go.tph.hosxpbridge) เรียกตอน login, "Restart HOSxP Bridge.command" เรียกซ้ำได้
# ปิดตัวที่เปิดอยู่ก่อน แล้วรัน pwsh ต่อในตัวนี้ (log อยู่ที่ bridge.log ในโฟลเดอร์เดียวกัน)
DIR="$(cd "$(dirname "$0")" && pwd)"
PWSH="$DIR/pwsh/pwsh"
[ -x "$PWSH" ] || PWSH="$(command -v pwsh)"
if [ -z "$PWSH" ]; then echo "ไม่พบ pwsh — ติดตั้งใหม่ด้วย Install HOSxP Bridge.command" >> "$DIR/bridge.log"; exit 1; fi
for p in $(pgrep -f 'hosxp-bridge[.]ps1'); do kill "$p" 2>/dev/null; done
sleep 1
LOG="$DIR/bridge.log"
# log ไม่ให้โตเกิน ~1 MB
if [ -f "$LOG" ] && [ "$(stat -f %z "$LOG")" -gt 1000000 ]; then mv -f "$LOG" "$LOG.old"; fi
exec "$PWSH" -NoProfile -File "$DIR/hosxp-bridge.ps1" >> "$LOG" 2>&1
