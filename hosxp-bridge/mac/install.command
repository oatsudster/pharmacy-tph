#!/bin/bash
# ติดตั้ง HOSxP Bridge บน Mac ให้ผู้ใช้คนปัจจุบัน (ไม่ต้องใช้สิทธิ์ admin) — ในชุดติดตั้งชื่อ "Install HOSxP Bridge.command"
#   1. ใช้ PowerShell 7 (pwsh) ที่แนบมาในชุด (หรือดาวน์โหลดจาก GitHub) แตกไว้ใน ~/Library/Application Support/HOSxPBridge/pwsh
#   2. คัดลอก bridge + db.json แล้วตั้ง LaunchAgent ให้เปิดเองตอน login
#   3. ตรวจว่า bridge ตอบ และต่อฐานข้อมูล HOSxP ได้
# บน Mac อ่านหน้าจอ HOSxP (Wine) ไม่ได้ — ใช้ได้เฉพาะข้อมูลจากฐานข้อมูล (/db/*) และอัปเดตตัวเองจากหน้าเว็บได้เหมือน Windows
PWSH_VER=7.4.6
LABEL=th.go.tph.hosxpbridge
SRC="$(cd "$(dirname "$0")" && pwd)"
DIR="$HOME/Library/Application Support/HOSxPBridge"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
fail() { echo "❌ $1"; read -n 1 -p "กดปุ่มใดก็ได้เพื่อปิด"; exit 1; }

echo "== ติดตั้ง HOSxP Bridge =="
mkdir -p "$DIR" "$HOME/Library/LaunchAgents" || fail "สร้างโฟลเดอร์ไม่ได้"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
for p in $(pgrep -f 'hosxp-bridge[.]ps1'); do kill "$p" 2>/dev/null; done

# PowerShell 7
case "$(uname -m)" in arm64) ARCH=osx-arm64 ;; *) ARCH=osx-x64 ;; esac
TGZ="powershell-$PWSH_VER-$ARCH.tar.gz"
if [ ! -x "$DIR/pwsh/pwsh" ] || ! "$DIR/pwsh/pwsh" -NoProfile -Command 'exit 0' 2>/dev/null; then
  echo "• ติดตั้ง PowerShell $PWSH_VER ($ARCH)"
  if [ -f "$SRC/$TGZ" ]; then PKG="$SRC/$TGZ"
  else
    PKG="$(mktemp -d)/$TGZ"
    curl -fL -o "$PKG" "https://github.com/PowerShell/PowerShell/releases/download/v$PWSH_VER/$TGZ" || fail "ดาวน์โหลด PowerShell ไม่ได้ (ต่อเน็ตแล้วลองใหม่)"
  fi
  rm -rf "$DIR/pwsh"; mkdir -p "$DIR/pwsh"
  tar -xzf "$PKG" -C "$DIR/pwsh" || fail "แตกไฟล์ PowerShell ไม่ได้"
  chmod +x "$DIR/pwsh/pwsh"
fi

# ไฟล์ bridge (ชื่อในชุดติดตั้ง → ชื่อในเครื่อง ตาม update.json)
echo "• คัดลอกไฟล์ bridge"
cp -f "$SRC/hosxp-bridge.ps1" "$SRC/hxdb.cs" "$SRC/update.json" "$SRC/start-bridge.sh" "$DIR/" || fail "คัดลอกไฟล์ไม่ได้"
cp -f "$SRC/mac/restart-bridge.command" "$DIR/Restart HOSxP Bridge.command"
cp -f "$SRC/mac/stop-bridge.command" "$DIR/Stop HOSxP Bridge.command"
cp -f "$SRC/mac/uninstall-bridge.command" "$DIR/Uninstall HOSxP Bridge.command"
[ -f "$SRC/db.json" ] && cp -f "$SRC/db.json" "$DIR/"
chmod +x "$DIR/start-bridge.sh" "$DIR/"*.command
# ไฟล์ที่แตกจาก zip ที่ดาวน์โหลดมาติด quarantine — macOS จะไม่ยอมรัน pwsh
xattr -dr com.apple.quarantine "$DIR" 2>/dev/null

# เปิดเองตอน login (AbandonProcessGroup: ตอนอัปเดตตัวเอง ตัวเก่าเปิดตัวใหม่แล้วปิดตัวเอง ห้าม launchd ปิดตัวใหม่ตามไปด้วย)
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$DIR/start-bridge.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>AbandonProcessGroup</key><true/>
</dict>
</plist>
EOF
launchctl bootstrap "gui/$(id -u)" "$PLIST" || fail "ตั้งให้เปิดเองตอน login ไม่ได้"

echo "• รอ bridge ตอบ"
OK=
for i in $(seq 1 40); do
  if curl -s -m 1 http://127.0.0.1:8765/version >/dev/null; then OK=1; break; fi
  sleep 1
done
[ -n "$OK" ] || fail "Bridge ยังไม่ตอบ — ดู $DIR/bridge.log"
# ต่อฐานข้อมูลครั้งแรกใช้เวลาเล็กน้อย
sleep 3
if curl -s -m 5 "http://127.0.0.1:8765/db/denom" | grep -q '"ok":true'; then
  echo "✅ เชื่อมฐานข้อมูล HOSxP แล้ว"
else
  echo "⚠️ ยังเชื่อมฐานข้อมูล HOSxP ไม่ได้ — ต้องต่อ Wi-Fi/LAN ของ รพ. และถ้า macOS ถามเรื่อง Local Network ให้กด Allow"
fi

# Chrome ต้องอนุญาตให้หน้าเว็บคุยกับ bridge ในเครื่อง
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] && ("$CHROME" "chrome://settings/content/siteDetails?site=https%3A%2F%2Foatsudster.github.io" >/dev/null 2>&1 &)
echo
echo "✅ ติดตั้ง HOSxP Bridge เรียบร้อย (เปิดเองทุกครั้งที่ login)"
echo "• ในหน้าตั้งค่า Chrome ที่เปิดขึ้น ตั้ง \"Local network\" และ \"Apps on device\" เป็น Allow"
echo "• รีสตาร์ท/ปิด/ถอนการติดตั้ง: ไฟล์ .command ใน $DIR"
echo "• ต่อไปหน้าเว็บจะอัปเดต bridge ให้เองอัตโนมัติ ไม่ต้องติดตั้งใหม่"
read -n 1 -p "กดปุ่มใดก็ได้เพื่อปิด"
