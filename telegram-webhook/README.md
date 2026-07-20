# คำสั่งบอท Telegram — ตรวจ/ค้นหายาใกล้หมดอายุ

Worker นี้รับข้อความจาก Telegram จากกลุ่มที่อนุญาตเท่านั้น รองรับคำสั่ง:

- `/check` — สั่งรัน GitHub Actions workflow `expiry-telegram-notify.yml` ทันที
  สรุปยาใกล้หมดอายุ ≤90 วันทั้งหมด (ไม่ต้องรอ 08:00 น. หรือเข้าเว็บ GitHub) ใช้เวลา ~15-20 วิ
- `/search ชื่อยา` — ค้นหายาตามชื่อ ตอบทันทีจากข้อมูลสด (ดึง HTML + Firestore เอง ไม่ผ่าน workflow)
- `/help` — แสดงคำสั่งทั้งหมด

Deploy ฟรีบน Cloudflare Workers ครับ ทำตามขั้นตอนนี้ (ทำครั้งเดียว):

## 1. ติดตั้งเครื่องมือ

```
npm install -g wrangler
```

## 2. ล็อกอิน Cloudflare

```
wrangler login
```

จะเปิดเบราว์เซอร์ให้ล็อกอิน/สมัครบัญชี Cloudflare (ฟรี ไม่ต้องผูกบัตร)

## 3. Deploy worker

```
cd telegram-webhook
wrangler deploy
```

จะได้ URL กลับมาเช่น `https://expiry-telegram-webhook.<ชื่อบัญชี>.workers.dev` — เก็บ URL นี้ไว้ใช้ขั้นตอนที่ 5

## 4. ตั้งค่า secrets (ทำทีละคำสั่ง จะมีให้พิมพ์ค่าแบบซ่อน)

```
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put GITHUB_TOKEN
wrangler secret put ALLOWED_CHAT_ID
```

- `TELEGRAM_BOT_TOKEN` — ใช้ค่าเดียวกับที่ตั้งไว้ใน GitHub Actions secret (จาก @BotFather)
- `ALLOWED_CHAT_ID` — ใช้ค่าเดียวกับ `TELEGRAM_CHAT_ID` ใน GitHub Actions secret (chat id ของกลุ่มแผนก กันไม่ให้คนอื่นสั่ง `/check` จากที่อื่นได้)
- `GITHUB_TOKEN` — ต้องสร้างใหม่ (ดูข้อ 5)

## 5. สร้าง GitHub token สำหรับให้ worker สั่งรัน workflow ได้

1. ไปที่ GitHub → รูปโปรไฟล์ (มุมขวาบน) → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
2. **Repository access:** เลือก "Only select repositories" → เลือก `pharmacy-tph`
3. **Permissions** → **Repository permissions** → หา **Actions** → ตั้งเป็น **Read and write**
4. Generate แล้วคัดลอก token (ขึ้นต้น `github_pat_...`) — เห็นครั้งเดียว เก็บไว้ใส่ในขั้นตอนที่ 4

## 6. ผูก webhook กับ Telegram

เปิด URL นี้ในเบราว์เซอร์ (แทน `<BOT_TOKEN>` และ `<WORKER_URL>` ด้วยของจริง):

```
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=<WORKER_URL>
```

ถ้าสำเร็จจะเห็น `{"ok":true,"result":true,"description":"Webhook was set"}`

## 7. ทดสอบ

- พิมพ์ `/check` ในกลุ่ม Telegram ของแผนก → บอทควรตอบ "🔎 กำลังตรวจสอบ..." ทันที
  แล้วตามด้วยข้อความสรุปรายการยาใกล้หมดอายุภายในไม่กี่สิบวินาที
- พิมพ์ `/search พารา` → บอทควรตอบรายการยาที่ชื่อมีคำว่า "พารา" ทันที
- พิมพ์ `/help` → บอทควรตอบรายการคำสั่งทั้งหมด

## หมายเหตุ: secrets ต้องเป็น ASCII ล้วน ห้ามมี BOM

ถ้าตั้งค่า secret ผ่าน PowerShell ด้วย `'ค่า' | wrangler secret put ...` ค่าที่ได้อาจมี
BOM (U+FEFF) แอบติดหน้าข้อความ ทำให้ token ใช้งานไม่ได้แบบเงียบๆ (error 401 จากปลายทาง)
วิธีที่ปลอดภัยกว่าคือใช้ Bash/Git Bash: `printf '%s' 'ค่า' | wrangler secret put ...`
