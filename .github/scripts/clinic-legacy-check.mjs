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

const inMonths = new Set();
let monthDocs = 0;
for (const ym of monthsUntil(today.slice(0, 7))) {
  const d = await getDoc('clinic_' + ym);
  if (!d) continue;
  monthDocs++;
  (d.list || []).forEach(r => r && r.id && inMonths.add(r.id));
}
const dead = new Set(meta.deletedVisitIds || []);
const missing = legacy.filter(r => r && r.id && !inMonths.has(r.id) && !dead.has(r.id));

const text = missing.length === 0
  ? `🗂 <b>ถึงเวลาลบข้อมูลคลินิกชุดเดิมแล้ว</b>\n\n` +
    `ตรวจแล้ว ✅ ข้อมูลเดิม ${legacy.length} รายการ อยู่ในเอกสารรายเดือนครบทุกรายการ ` +
    `(ตอนนี้มีทั้งหมด ${inMonths.size} รายการ ใน ${monthDocs} เดือน)\n\n` +
    `<b>ก่อนลบ</b>: ให้ทุกเครื่องกด Ctrl+F5 ในหน้าคลินิก และกด 💾 Backup เก็บไว้\n` +
    `<b>วิธีลบ</b>: บอก Claude Code ว่า "ลบ visitRecords เดิมใน clinic_data" ` +
    `หรือใน Firebase Console → pharmacy_tph → clinic_data → ลบเฉพาะฟิลด์ <code>visitRecords</code> (ห้ามลบทั้งเอกสาร)\n\n` +
    `จะเตือนทุกวันจันทร์จนกว่าจะลบ`
  : `🗂 <b>ข้อมูลคลินิกชุดเดิม — ยังไม่ควรลบ</b>\n\n` +
    `⚠️ มี ${missing.length} จาก ${legacy.length} รายการในข้อมูลเดิมที่ยังไม่อยู่ในเอกสารรายเดือน ` +
    `น่าจะมีเครื่องที่เปิดหน้าคลินิกรุ่นเก่าค้างอยู่\n\n` +
    `ให้ทุกเครื่องกด Ctrl+F5 ในหน้าคลินิก ระบบจะย้ายรายการที่ขาดให้เอง แล้วจะตรวจใหม่วันจันทร์หน้า`;

console.log(`legacy ${legacy.length} | in months ${inMonths.size} (${monthDocs} docs) | missing ${missing.length}`);
await send(text);
