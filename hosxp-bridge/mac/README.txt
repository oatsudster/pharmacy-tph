HOSxP Bridge สำหรับ Mac

วิธีติดตั้ง (ครั้งเดียว — ต่อไปหน้าเว็บอัปเดต bridge ให้เองอัตโนมัติ)
1. ดับเบิลคลิก zip ให้แตกเป็นโฟลเดอร์ HOSxPBridge-mac
2. คลิกขวา "Install HOSxP Bridge.command" > Open > Open
   (ดับเบิลคลิกตรงๆ macOS จะไม่ยอมเปิดเพราะไม่ได้มาจาก App Store)
   ถ้ายังเปิดไม่ได้: System Settings > Privacy & Security > เลื่อนลงกด "Open Anyway"
3. ถ้า macOS ถามว่าให้ "pwsh" ค้นหาอุปกรณ์ใน Local Network ให้กด Allow (ใช้ต่อฐานข้อมูล HOSxP)
4. ในหน้าตั้งค่า Chrome ที่เปิดขึ้น ตั้ง "Local network" และ "Apps on device" เป็น Allow

บน Mac bridge อ่านหน้าจอ HOSxP ไม่ได้ (HOSxP รันผ่าน Wine) — ใช้ได้ทุกอย่างที่ดึงจากฐานข้อมูล HOSxP
(สติกเกอร์ยา, ฟอร์ม ME ER, ยาเวรดึก, Smart Pharmacy ตาม HN ฯลฯ) แต่หน้าต่างลอยจะไม่ตาม HN ที่เปิดใน HOSxP เอง

รีสตาร์ท / ปิด / ถอนการติดตั้ง: ไฟล์ .command ใน ~/Library/Application Support/HOSxPBridge
(Finder > Go > Go to Folder... แล้ววาง path นี้)

ห้ามส่งไฟล์ zip นี้ออกนอกเครือข่ายโรงพยาบาล (มีรหัสฐานข้อมูลอยู่ข้างใน)
