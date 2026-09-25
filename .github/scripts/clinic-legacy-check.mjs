// เตือนผ่าน Telegram ให้ลบข้อมูลคลินิกชุดเดิม (pharmacy_tph/clinic_data.visitRecords) เมื่อครบกำหนด
//
// ตั้งแต่ 25 ก.ย. 69 บันทึกคลินิกย้ายไปเก็บเป็นเอกสารรายเดือน clinic_YYYY-MM (lib/clinic-store.js)
// ฟิลด์ visitRecords เดิมเก็บไว้เป็นต้นฉบับชั่วคราว ลบได้เมื่อทุกเครื่องใช้หน้าเว็บรุ่นใหม่แล้ว
//
// สคริปต์นี้อ่านอย่างเดียว ไม่ลบอะไร:
//   - ก่อน DUE_DATE หรือเมื่อ visitRecords ถูกลบไปแล้ว → ไม่ส่งอะไร (หยุดเตือนเอง)
//   - ถึงกำหนด → ตรวจว่าทุกรายการในข้อมูลเดิมอยู่ในเอกสารรายเดือนครบ แล้วส่งผลตรวจไป Telegram
// ทดสอบในเครื่อง: TODAY=2026-11-30 DRY_RUN=1 node .github/scripts/clinic-legacy-check.mjs

const DUE_DATE = '2026-11-25';
const FIRST_MONTH = '2026-06';
const API_KEY = 'AIzaSyDHiTSM7fz1FihDLyb_QxLGheo_6CuNXIE'; // web API key เดียวกับหน้าเว็บ (สาธารณะอยู่แล้ว)
const BASE = 'https://firestore.googleapis.com/v1/projects/pharmacy-tph/databases/(default)/documents/pharmacy_tph/';

const DRY_RUN = !!process.env.DRY_RUN;
const today = process.env.TODAY || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

function fail(msg) { console.error('❌ ' + msg); process.exit(1); }

// ค่าใน Firestore REST → ค่า JS ธรรมดา
const conv = v => v.mapValue ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, conv(x)]))
  : v.arrayValue ? (v.arrayValue.values || []).map(conv)
  : 'integerValue' in v ? Number(v.integerValue) : 'nullValue' in v ? null : Object.values(v)[0];

async function getDoc(id) {
  const res = await fetch(BASE + id + '?key=' + API_KEY);
  if (res.status === 404) return null;
  if (!res.ok) fail(`อ่าน ${id} ไม่ได้: HTTP ${res.status}`);
  const d = await res.json();
  return Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, conv(v)]));
}

function monthsUntil(ym) {
  const out = [];
  let [y, m] = FIRST_MONTH.split('-').map(Number);
  const [ey, em] = ym.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${String(m).padStart(2, '0')}`); if (++m > 12) { m = 1; y++; } }
  return out;
}

async function send(text) {
  if (DRY_RUN) { console.log('--- DRY_RUN: ข้อความที่จะส่ง ---\n' + text); return; }
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN, CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  if (!BOT_TOKEN || !CHAT_ID) fail('ไม่พบ TELEGRAM_BOT_TOKEN หรือ TELEGRAM_CHAT_ID');
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) fail(`ส่งข้อความ Telegram ไม่สำเร็จ: ${data.description || res.status}`);
  console.log('ส่งแล้ว');
}

if (today < DUE_DATE) { console.log(`ยังไม่ถึงกำหนด (${today} < ${DUE_DATE})`); process.exit(0); }

const meta = await getDoc('clinic_data');
const legacy = (meta && meta.visitRecords) || null;
if (!legacy) { console.log('ลบ visitRecords เดิมไปแล้ว — ไม่ต้องเตือน'); process.exit(0); }

// ขนาดโดยประมาณ (JSON) — Firestore จำกัดเอกสารละ 1 MB
const kb = x => Math.round(Buffer.byteLength(JSON.stringify(x)) / 1024);
const thDate = iso => { const [y, m, d] = String(iso || '').split('-').map(Number); return y ? `${d} ${['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][m - 1]} ${String(y + 543).slice(2)}` : '-'; };

const inMonths = new Set(), months = [];
for (const ym of monthsUntil(today.slice(0, 7))) {
  const d = await getDoc('clinic_' + ym);
  if (!d) continue;
  const list = d.list || [];
  list.forEach(r => r && r.id && inMonths.add(r.id));
  months.push({ ym, n: list.length, kb: kb(d) });
}
const dead = new Set(meta.deletedVisitIds || []);
const missing = legacy.filter(r => r && r.id && !inMonths.has(r.id) && !dead.has(r.id));
const legacyDates = legacy.map(r => r.date).filter(Boolean).sort();
const biggest = months.reduce((a, b) => (b.kb > a.kb ? b : a), { kb: 0 });
const keep = ['sessionRecords', 'priceOverrides', 'patientRoster', 'deletedVisitIds'].filter(k => k in meta);
const metaKb = kb(meta), legacyKb = kb(legacy);

const monthLines = months.map(m => `  • ${m.ym}: ${m.n} รายการ (${m.kb} KB)`).join('\n');
const facts =
  `<b>📊 ผลตรวจ (${thDate(today)})</b>\n` +
  `• ข้อมูลเดิม <code>visitRecords</code>: ${legacy.length} รายการ (${thDate(legacyDates[0])} – ${thDate(legacyDates[legacyDates.length - 1])}) ขนาด ${legacyKb} KB\n` +
  `• อยู่ในเอกสารรายเดือนแล้ว: ${legacy.length - missing.length}/${legacy.length} รายการ\n` +
  `• รายการที่ถูกลบไปแล้ว (กันไม่ให้ฟื้น): ${dead.size} รายการ\n` +
  `• เอกสารรายเดือนตอนนี้: ${inMonths.size} รายการ ใน ${months.length} เดือน ใหญ่สุด ${biggest.kb} KB (${biggest.ym || '-'}) จากเพดาน 1,024 KB\n` +
  monthLines;

let text;
if (missing.length === 0) {
  text =
    `🗂 <b>ถึงเวลาลบข้อมูลคลินิกชุดเดิมแล้ว</b>\n` +
    `ครบ 2 เดือนหลังย้ายไปเก็บแบบรายเดือน (25 ก.ย. 69) — ตรวจแล้ว ✅ ลบได้อย่างปลอดภัย\n\n` +
    facts + '\n\n' +
    `<b>🗑 สิ่งที่จะลบ</b>\n` +
    `• เฉพาะฟิลด์ <code>visitRecords</code> ในเอกสาร <code>clinic_data</code> (${legacyKb} KB) — เป็นสำเนาเก่า หน้าเว็บไม่ได้ใช้แสดงผลแล้ว\n` +
    `• เอกสาร clinic_data จะเล็กลงจาก ${metaKb} KB เหลือราว ${Math.max(1, metaKb - legacyKb)} KB\n\n` +
    `<b>🔒 สิ่งที่ต้องเก็บไว้ (ห้ามลบ)</b>\n` +
    `• ${keep.map(k => `<code>${k}</code>`).join(', ')} ในเอกสาร clinic_data\n` +
    `• เอกสาร <code>clinic_YYYY-MM</code> ทั้งหมด\n\n` +
    `<b>✅ ก่อนลบ</b>\n` +
    `1. ทุกเครื่องกด Ctrl+F5 ในหน้าคลินิกและหน้าแรก (รวมเครื่องห้องจ่ายยา)\n` +
    `2. กด 💾 Backup ในหน้าคลินิก เก็บไฟล์ไว้\n\n` +
    `<b>🛠 วิธีลบ (เลือกอย่างใดอย่างหนึ่ง)</b>\n` +
    `• บอก Claude Code ว่า "ลบ visitRecords เดิมใน clinic_data" — จะสำรองและตรวจซ้ำก่อนลบ\n` +
    `• หรือ Firebase Console → Firestore → pharmacy_tph → clinic_data → กด 🗑 ที่แถว <code>visitRecords</code> เท่านั้น (ห้ามลบทั้งเอกสาร)\n\n` +
    `<b>ℹ️ ผลกระทบ</b>: ไม่มี — ข้อมูลในหน้าเว็บยังอยู่ครบ ถ้าผิดพลาดกู้คืนได้จากไฟล์ Backup ด้วยปุ่ม 📥 Import\n\n` +
    `จะเตือนทุกวันจันทร์จนกว่าจะลบ`;
} else {
  const byDate = {};
  missing.forEach(r => { const k = `${thDate(r.date)} ${r.clinic || ''}`.trim(); byDate[k] = (byDate[k] || 0) + 1; });
  text =
    `🗂 <b>ข้อมูลคลินิกชุดเดิม — ยังไม่ควรลบ</b>\n\n` +
    `⚠️ มี ${missing.length} รายการในข้อมูลเดิมที่ยังไม่อยู่ในเอกสารรายเดือน ` +
    `แปลว่ามีเครื่องที่ยังเปิดหน้าคลินิกรุ่นเก่าค้างอยู่และบันทึกลงที่เดิม\n` +
    `รายการที่ขาด (วันที่ คลินิก): ${Object.entries(byDate).slice(0, 10).map(([k, n]) => `${k} ×${n}`).join(', ')}\n\n` +
    facts + '\n\n' +
    `<b>ต้องทำ</b>: ให้ทุกเครื่องกด Ctrl+F5 ในหน้าคลินิก ระบบจะย้ายรายการที่ขาดให้เองทันทีที่เปิดหน้ารุ่นใหม่ ` +
    `แล้วจะตรวจใหม่วันจันทร์หน้า`;
}

console.log(`legacy ${legacy.length} | in months ${inMonths.size} (${months.length} docs) | missing ${missing.length}`);
await send(text);
