#!/bin/bash
# ถอนการติดตั้ง HOSxP Bridge บน Mac: ปิดตัวที่เปิดอยู่ ลบ LaunchAgent และโฟลเดอร์ที่ติดตั้ง
LABEL=th.go.tph.hosxpbridge
DIR="$HOME/Library/Application Support/HOSxPBridge"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
for p in $(pgrep -f 'hosxp-bridge[.]ps1'); do kill "$p" 2>/dev/null; done
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
rm -rf "$DIR"
echo "ถอนการติดตั้ง HOSxP Bridge เรียบร้อย"
sleep 2
