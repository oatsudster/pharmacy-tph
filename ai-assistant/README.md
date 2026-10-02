# Worker ผู้ช่วย AI (Claude Haiku / Sonnet)

ตัวกลางให้วิดเจ็ต `lib/ai-assistant.js` (ปุ่ม 🤖 มุมขวาล่างทุกหน้า) เรียก Claude โดยไม่ต้องฝัง API key ในหน้าเว็บ
เลือกรุ่นได้จากวิดเจ็ต: **Haiku 4.5** (เร็ว/ถูก) หรือ **Sonnet 5.5** (แม่นกว่า) — จำกัด 400 ครั้ง/วันรวมทุกหน้า (แก้ `DAILY_LIMIT`)

## Deploy (ทำครั้งเดียว)

```
cd ai-assistant
wrangler kv namespace create RATE_LIMIT      # เอา id ไปใส่ใน wrangler.toml
wrangler secret put ANTHROPIC_API_KEY        # จาก console.anthropic.com (ต้องมีเครดิต)
wrangler secret put APP_TOKEN                # ค่าเดียวกับ AI_TOKEN ใน lib/ai-assistant.js
wrangler deploy
```

URL ที่ได้ต้องตรงกับ `AI_URL` ใน `lib/ai-assistant.js` และ `connect-src` ของ CSP ในแต่ละหน้า
(ค่าตั้งต้นคือ `https://ai-assistant.oatsudster.workers.dev`)

## ความเป็นส่วนตัว
Worker ไม่เก็บข้อมูล ไม่รัน tool เอง — เบราว์เซอร์ค้นข้อมูลในเครื่องแล้วส่งเฉพาะผลที่ตัดฟิลด์ระบุตัวผู้ป่วยออก (ชื่อ/HN/AN) ให้ AI
