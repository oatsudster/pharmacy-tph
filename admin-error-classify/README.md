# Worker จัดหมวด Administration Error ด้วย Gemini AI

Worker นี้รับข้อความ "หมายเหตุ/รายละเอียด" ของรายการ ME (IPD) ที่ import จาก HosXP แล้วยังไม่มี
"ประเภทความคลาดเคลื่อน" ชัดเจน ส่งให้ Gemini ช่วยจัดเข้าหนึ่งใน 15 หมวด Administration Error
ให้อัตโนมัติ — ใช้จากปุ่ม "🤖 จัดหมวดด้วย AI" ในหน้า Admin Error รายเดือน ของ ME_Dashboard.html

API key ของ Gemini เก็บเป็น secret ฝั่งเซิร์ฟเวอร์เท่านั้น ไม่ฝังลงในหน้าเว็บ (หน้าเว็บเรียก Worker นี้แทน)

Deploy ฟรีบน Cloudflare Workers ทำตามขั้นตอนนี้ (ทำครั้งเดียว):

## 1. ติดตั้งเครื่องมือ + ล็อกอิน (ข้ามได้ถ้าทำไปแล้วตอนตั้งค่า telegram-webhook)

```
npm install -g wrangler
wrangler login
```

## 2. สร้าง KV namespace สำหรับจำกัดโควตารายวัน

```
cd admin-error-classify
wrangler kv namespace create RATE_LIMIT
```

จะได้ id กลับมา เอาไปแทนที่ `REPLACE_WITH_KV_NAMESPACE_ID` ใน `wrangler.toml`

## 3. สร้าง Gemini API key

ไปที่ https://aistudio.google.com/apikey → **Create API key** → คัดลอกค่าที่ได้ไว้ใช้ขั้นตอนถัดไป
(หมายเหตุ: คนละอย่างกับ Gemini Advanced/Plus ที่ใช้ผ่านแอป/เว็บ Gemini — ต้องสร้าง API key แยกที่นี่)

Free tier ของ Gemini API เพียงพอสำหรับงานนี้แน่นอน เพราะมีแค่ไม่กี่สิบรายการ/เดือน

## 4. Deploy worker

```
wrangler deploy
```

จะได้ URL กลับมาเช่น `https://admin-error-classify.<ชื่อบัญชี>.workers.dev` — เก็บ URL นี้ไว้ใส่ในขั้นตอนที่ 6

## 5. ตั้งค่า secrets (ทำทีละคำสั่ง จะมีให้พิมพ์ค่าแบบซ่อน)

```
wrangler secret put GEMINI_API_KEY
wrangler secret put APP_TOKEN
```

- `GEMINI_API_KEY` — ค่าจากขั้นตอนที่ 3
- `APP_TOKEN` — ตั้งสตริงลับอะไรก็ได้เอง (เช่นสุ่มยาวๆ) กันไม่ให้คนอื่นยิง endpoint นี้เล่นแล้วเปลืองโควตา
  ต้องเอาค่าเดียวกันนี้ไปใส่ในตัวแปร `ADMIN_CLASSIFY_TOKEN` ที่ `ME_Dashboard.html` ด้วย (ดูขั้นตอนที่ 6)

## 6. เชื่อมกับหน้าเว็บ

เปิด `ME_Dashboard.html` แก้ตัวแปรใกล้ต้นไฟล์ (ค้นหา `ADMIN_CLASSIFY_URL`):

```js
const ADMIN_CLASSIFY_URL   = 'https://admin-error-classify.<ชื่อบัญชี>.workers.dev';
const ADMIN_CLASSIFY_TOKEN = '<ค่าเดียวกับ APP_TOKEN>';
```

## 7. ทดสอบ

เข้าเมนู IPD → 🧾 Admin Error รายเดือน → ถ้ามีรายการที่ import จาก HosXP ที่ยังไม่มีหมวด
จะเห็นปุ่ม "🤖 จัดหมวดด้วย AI (N รายการ)" กดแล้วรอสักครู่ ตัวเลขในตารางควรอัปเดตตามผลจัด AI

## หมายเหตุ: secrets ต้องเป็น ASCII ล้วน ห้ามมี BOM

ถ้าตั้งค่า secret ผ่าน PowerShell ด้วย `'ค่า' | wrangler secret put ...` ค่าที่ได้อาจมี
BOM (U+FEFF) แอบติดหน้าข้อความ ทำให้ token ใช้งานไม่ได้แบบเงียบๆ วิธีที่ปลอดภัยกว่าคือใช้ Bash/Git Bash:
`printf '%s' 'ค่า' | wrangler secret put ...`
