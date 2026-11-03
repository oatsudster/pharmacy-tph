# ภาพประกอบ UI (img/ui/)

สร้างใน ChatGPT (โมเดลสร้างภาพ) แล้ววางไฟล์ไว้ในโฟลเดอร์นี้ด้วย **ชื่อไฟล์ตามตาราง** — เว็บตั้งค่า CSP ให้โหลดรูปได้เฉพาะไฟล์ในเว็บเอง ห้ามลิงก์รูปจากเว็บอื่น
ส่งไฟล์ให้ Claude ใส่เข้าหน้าเว็บ (ย่อขนาด + ตรวจว่าเข้ากับธีม) — ภาพที่ยังไม่มีไฟล์ หน้าเว็บแสดงแบบเดิม

## กติกาทุกภาพ

- **วาง "Style" ด้านล่างนำหน้าทุก prompt** ให้ทุกภาพเป็นชุดเดียวกัน
- **ห้ามมีตัวหนังสือในภาพ** (AI เขียนภาษาไทยเพี้ยน) — ข้อความอยู่ในหน้าเว็บ
- PNG พื้นหลังโปร่งใส · ไม่เกิน ~150 KB ต่อไฟล์ (Claude ย่อให้ได้)
- ไม่ทำภาพสอนฉีดอินซูลิน (หน้า insulin-teach ยังไม่ได้ใช้อย่างเป็นทางการ — ตัดออก 2026-11-03) · ภาพทางคลินิกในอนาคตต้องให้เภสัชกรตรวจก่อนใช้
- ไม่ใช้กับ: ตาราง, กราฟ, ฟอร์มกรอกข้อมูล, พื้นหลังหลังเนื้อหา · โลโก้ รพ. ใช้ไฟล์จริง ไม่ให้ AI สร้าง

### Style (วางนำหน้าทุก prompt)

```
Flat vector illustration, simple rounded shapes, consistent 2px dark-green outline, limited palette only:
deep green #1A5E38, dark green #124228, gold #C49A22, soft mint #EDF4EF, white, a little light grey #DCE6DF.
Friendly, calm, modern, Thai community hospital pharmacy context. Transparent background. No text, no letters,
no numbers, no logos, no watermark. Single centered subject with generous empty padding around it.
```

## 1. ภาพตอนยังไม่มีข้อมูล (empty state) — 800×600

| ไฟล์ | ใช้ที่ | Prompt (ต่อท้าย Style) |
|---|---|---|
| `empty-ha.png` | ตัวชี้วัด HA ยังไม่มีข้อมูล | `A clipboard with a simple bar chart and a check mark, next to a small round wall clock showing 8:30, suggesting a daily automatic report that has not arrived yet. Soft, slightly empty feeling.` |
| `empty-audit.png` | ตรวจสอบที่มาตัวเลข ยังไม่มีตัวเลข | `A large magnifying glass hovering over a blank spreadsheet sheet with empty rows and a small gold check badge in the corner, waiting to be filled.` |
| `empty-patient.png` | สติกเกอร์ยา: ยังไม่เลือกผู้ป่วย | `A blank medicine label sticker and a small pill bottle, with a soft dotted arrow pointing left (toward a list), inviting the user to choose a patient.` |
| `empty-visit.png` | DM Remission: ยังไม่มี visit | `A desk calendar page with a small blood drop and a heart-shaped leaf on it, a glucose meter beside it, calm and hopeful.` |
| `empty-search.png` | ค้นหาไม่พบ | `A magnifying glass with a small gentle question mark shape (drawn as a curved line, not a letter) beside a few scattered empty cards.` |
| `offline.png` | ต่อฐานข้อมูล/HOSxP Bridge ไม่ได้ | `A computer monitor with a small unplugged network cable and a cloud with a thin diagonal slash, simple and not alarming (no red color).` |

## 2. การ์ดหน้าแรก ME Dashboard (OPD / IPD / ER) — 512×512

| ไฟล์ | Prompt (ต่อท้าย Style) |
|---|---|
| `me-opd.png` | `Outpatient pharmacy counter: a dispensing window with a prescription paper and a small pill box, seen from the front. Icon-like composition that fits inside a square card.` |
| `me-ipd.png` | `Inpatient ward: a hospital bed with a pillow and an IV drip stand with a small bag. Same framing and size as the other card icons.` |
| `me-er.png` | `Emergency room: a small ambulance front view with a simple medical cross on the side, and a gentle motion line. Same framing and size as the other card icons.` |

## 3. หน้าใส่รหัสผ่าน (หน้าหลัก + login งานประกัน) — 800×800

| ไฟล์ | Prompt (ต่อท้าย Style) |
|---|---|
| `login.png` | `A friendly pharmacist in a white coat (gender-neutral, simple face without detailed features) standing behind a pharmacy shelf with medicine boxes, holding a tablet that shows a gold shield with a keyhole shape. Welcoming and secure feeling.` |

## 4. ไอคอนแอป (favicon / แท็บเบราว์เซอร์) — 512×512

| ไฟล์ | Prompt (ใช้แทน Style ข้างบน) |
|---|---|
| `app-icon.png` | `App icon: one capsule pill tilted 45 degrees, half deep green #1A5E38 and half gold #C49A22, on a rounded-square background of soft mint #EDF4EF. Extremely simple, bold shapes that stay recognisable at 16x16 pixels. No text, no outline details, no shadow.` |

## ใส่แล้ว (2026-11-03)

ไฟล์ในโฟลเดอร์นี้ย่อแล้ว (ตัดขอบโปร่งใสให้เท่ากัน · 400 px / การ์ด ME 256 px · 1–20 KB) — ต้นฉบับ 1254 px เก็บไว้ที่ `design-mockups/ui-originals/` (ไม่ขึ้น git)

| ไฟล์ | ใช้ที่ |
|---|---|
| `empty-ha.png` | pharmacy-ha.html `#ha-empty` |
| `empty-audit.png` | insurance-audit.html `#audit-empty` |
| `empty-patient.png` | rx-sticker.html ช่องรายละเอียดก่อนเลือกผู้ป่วย |
| `empty-visit.png` | dm-remission.html ประวัติ/แล็บ ยังไม่มีการตรวจ |
| `empty-search.png` | index.html ค้นระบบไม่พบ · expiry-tracker ไม่พบตามตัวกรอง · night-meds ไม่พบใบสั่งยา |
| `offline.png` | lib/hosxp-db.js กล่องเตือนไม่พบ HOSxP Bridge · rx-sticker รายชื่อ IPD ดึงไม่ได้ |
| `me-opd/ipd/er.png` | ME_Dashboard.html การ์ดหน้าแรก |
| `login.png` | index.html หน้าใส่รหัส · insurance-login.html |
| `app-icon.png`, `apple-touch-icon.png`, `favicon-32.png` | ไอคอนแท็บทุกหน้า + โลโก้หน้าใส่รหัส/ME (ทำจาก app-icon ต้นฉบับ พื้นปรับเป็นสีมิ้นต์เรียบ) |

CSS กลาง: `.tph-art` (และ `.tph-art.sm`) ใน lib/theme.css — ซ่อนตอนพิมพ์
