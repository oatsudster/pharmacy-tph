#!/bin/bash
# เปิด/รีสตาร์ท HOSxP Bridge บน Mac (ดับเบิลคลิก)
LABEL=th.go.tph.hosxpbridge
DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl kickstart -k "gui/$(id -u)/$LABEL" 2>/dev/null || launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || (nohup /bin/bash "$DIR/start-bridge.sh" >/dev/null 2>&1 &)
for i in $(seq 1 30); do
  if curl -s -m 1 http://127.0.0.1:8765/version >/dev/null; then echo "✅ HOSxP Bridge ทำงานแล้ว"; sleep 2; exit 0; fi
  sleep 1
done
echo "⚠️ Bridge ยังไม่ตอบ — ดู $DIR/bridge.log"
read -n 1 -p "กดปุ่มใดก็ได้เพื่อปิด"
