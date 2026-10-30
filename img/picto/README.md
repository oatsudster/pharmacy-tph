# รูปภาพฉลากยา (Pictogram) — prompt สำหรับสร้างใน ChatGPT

ใช้กับ "🖼️ พิมพ์ฉลากรูปภาพเพิ่ม" ในหน้าพิมพ์สติกเกอร์ยา (rx-sticker.html) สำหรับผู้ป่วยที่อ่านหนังสือไม่ออก/สายตาไม่ดี
ฉลากรูปภาพพิมพ์เป็น **ดวงเสริมต่อจากฉลากปกติ** (ฉลากปกติยังต้องมีครบ) บนเครื่องพิมพ์ความร้อน Zebra 101.6 × 60 มม. ขาวดำ

## วิธีใช้

1. เปิด ChatGPT (รุ่นที่สร้างภาพได้) → วาง **prompt หลัก** ด้านล่างก่อน 1 ครั้ง
2. ส่ง prompt ของแต่ละรูปทีละข้อ (ภาพละ 1 ข้อความ) — ถ้าสไตล์เริ่มเพี้ยน ส่ง prompt หลักซ้ำ
3. ดาวน์โหลดเป็น PNG แล้วเปลี่ยนชื่อไฟล์ **ให้ตรงตามตาราง** (ตัวพิมพ์เล็ก) ใส่ในโฟลเดอร์นี้ (`img/picto/`)
4. commit + push — หน้าเว็บตรวจหาไฟล์เอง: มีไฟล์ใช้รูปนั้น ไม่มีใช้ไอคอนพื้นฐาน (เส้นดำ/อีโมจิ) แทน จึงทยอยเพิ่มทีละรูปได้

**ข้อควรระวัง**
- ห้ามมีตัวอักษร/ตัวเลขในภาพ — AI เขียนภาษาไทยเพี้ยน หน้าเว็บพิมพ์ข้อความ (เช้า, หลังอาหาร, ครั้งละ 1 เม็ด) ให้เอง
- ขาวดำล้วน ไม่มีสีเทา/เงา/ไล่สี — เครื่องพิมพ์ความร้อนพิมพ์สีเทาเป็นจุดๆ ไม่ชัด
- ภาพต้องอ่านออกที่ขนาดเล็ก (7–20 มม.) — ลองย่อดูในจอก่อนใช้
- ภาพที่ใช้กับผู้ป่วยควรให้ทีมเภสัช/ผู้ป่วยตัวอย่างลองดูว่าเข้าใจตรงกันก่อนใช้จริง

## Prompt หลัก (ส่งก่อนทุกครั้ง)

```
I am making a set of pictograms for medicine labels at a Thai community hospital, for patients who cannot read or have poor eyesight.
Every image in this set must follow this exact style:
- Pure black and white only: solid black shapes and thick black outlines on a pure white background. No gray, no color, no gradients, no shadows, no texture.
- Very thick, bold lines (about 6% of the image width), simple rounded shapes, flat 2D pictogram style like international public signs.
- Absolutely no text, letters, numbers or symbols that look like writing.
- One subject, centered, filling about 80% of a square 1:1 canvas with even white margin. Transparent or white background.
- Must stay instantly recognizable when printed very small (7–20 mm) on a black-and-white thermal label printer.
- Friendly, neutral people (no specific ethnicity features exaggerated), Thai everyday context where relevant (e.g. a plate of rice).
Reply only with the image. I will send each subject one by one.
```

## รายการรูป (ชื่อไฟล์ → prompt)

### เวลา (ใช้บ่อยที่สุด — ทำก่อน)
| ไฟล์ | prompt |
|---|---|
| `morning.png` | Morning: a half sun rising above a horizon line with short rays, a small rooster silhouette on the left. |
| `noon.png` | Midday: a full round sun high in the sky with rays all around, directly above a simple short horizon line. |
| `evening.png` | Evening: a half sun setting below a horizon line, with two short horizontal lines under it like a sunset over water. |
| `bed.png` | Bedtime: a person sleeping in a bed with a pillow and blanket, a crescent moon and one star above. |

### มื้ออาหาร
| ไฟล์ | prompt |
|---|---|
| `before.png` | Before eating: an empty clean plate with a spoon and fork beside it, and a small clock above showing the meal has not started. Plate must clearly be empty. |
| `after.png` | After eating: an empty plate with a few rice grains left and a spoon and fork placed together across the plate, showing the meal is finished. |
| `with.png` | With food: a plate full of rice with a spoon, and a single round pill next to the plate. |

### รูปแบบยา / จำนวน (ใช้วาดจำนวนเม็ดต่อมื้อ — ต้องเรียบง่ายมาก)
| ไฟล์ | prompt |
|---|---|
| `tablet.png` | One round tablet seen from above, with a single straight score line across the middle. Simple circle, nothing else. |
| `half.png` | Exactly half of a round tablet (a half circle), seen from above, flat cut edge at the bottom. |
| `capsule.png` | One capsule pill lying horizontally, left half solid black, right half white with black outline. |
| `tsp.png` | A small teaspoon seen from above, filled with liquid (bowl solid black). |
| `tbsp.png` | A large tablespoon seen from above, filled with liquid (bowl solid black), clearly bigger and wider than a teaspoon. |
| `drop.png` | A single liquid drop shape, solid black. |
| `sachet.png` | One small square sachet packet of medicine powder with a tear line at the top corner. |
| `clock.png` | A simple round clock face with two hands, no numbers. |

### วิธีใช้ยา (ยาที่ไม่ใช่ยากิน)
| ไฟล์ | prompt |
|---|---|
| `eye.png` | Eye drops: a dropper bottle tilted above an open eye, one drop falling into the eye. |
| `ear.png` | Ear drops: a side view of a head showing the ear, a dropper above the ear with one drop falling in. |
| `nose.png` | Nasal spray: a nasal spray bottle inserted in one nostril of a side-view face. |
| `inhaler.png` | Inhaler: a side-view person breathing in from a metered-dose inhaler held at the mouth. |
| `sublingual.png` | Under the tongue: a side-view open mouth with the tongue raised and a small tablet placed under the tongue. |
| `suppository.png` | Suppository: one bullet-shaped suppository with a short arrow pointing upward. Simple, not anatomical. |
| `skin.png` | Apply on skin: a finger spreading cream on the back of a hand, a small tube of cream beside it. |

### ใช้เมื่อมีอาการ
| ไฟล์ | prompt |
|---|---|
| `prn.png` | Only when needed: a person holding their head looking unwell, with a single pill beside them. |
| `prn-pain.png` | Pain: a person holding their head with both hands, short jagged lines around the head showing headache. |
| `prn-fever.png` | Fever: a person lying in bed with a thermometer in the mouth and wavy heat lines above the head. |
| `prn-cough.png` | Cough: a side-view person coughing into their elbow, small burst lines in front of the mouth. |
| `prn-nausea.png` | Nausea: a person holding their stomach with one hand and covering their mouth with the other. |
| `prn-chest.png` | Chest pain: a person pressing a hand on the center of their chest, short jagged lines at the chest. |
| `prn-constipation.png` | Constipation: a person sitting on a toilet holding their stomach. |
| `prn-diarrhea.png` | Diarrhea: a person running toward a toilet while holding their stomach. |
| `prn-itch.png` | Itch: a hand scratching the other forearm, short wavy lines on the skin. |
| `prn-sleep.png` | Cannot sleep: a person lying in bed with eyes wide open, a crescent moon in the window. |
| `prn-dyspnea.png` | Shortness of breath: a person with a hand on the chest, mouth open, curved breath lines in front of the mouth. |

### คำเตือน
| ไฟล์ | prompt |
|---|---|
| `sleepy.png` | Causes drowsiness: a face with closed eyes and three small "z"-like curved lines (not letters, just curls) above, next to a car crossed out with a thick diagonal line. |
| `shake.png` | Shake well: a medicine bottle with curved motion lines on both sides and a hand holding it. |
| `fridge.png` | Keep in the refrigerator: a simple refrigerator with the door open and a small medicine bottle on a shelf, a snowflake on the door. |
| `no-crush.png` | Do not crush or chew: a tablet with a crushing pestle above it, both inside a thick circle with a diagonal prohibition line. |
| `finish.png` | Use until finished: a medicine bottle tipped over and empty, with a thick check mark beside it. |

## หลังสร้างครบ

- ไฟล์ PNG ขนาดแนะนำ 512–1024 px สี่เหลี่ยมจัตุรัส ไฟล์ละไม่เกิน ~200 KB (ย่อได้ในโปรแกรม Paint)
- ถ้ารูปไหนดูไม่ออกเมื่อพิมพ์จริง ลบไฟล์นั้นทิ้ง หน้าเว็บกลับไปใช้ไอคอนพื้นฐานเอง
