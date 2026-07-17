// แจ้งเตือนยาใกล้หมดอายุเข้า Telegram — รันจาก GitHub Actions (ดู .github/workflows/expiry-telegram-notify.yml)
//
// ทำซ้ำตรรกะ buildRows()/statusOf() จาก expiry-tracker.html นอกเบราว์เซอร์:
// อ่าน DATA (ข้อมูลพื้นฐาน) จากไฟล์ HTML โดยตรง + ดึงส่วนที่แก้ไข (overrides/extras/removed)
// จาก Firestore REST API แล้วรวมกันเป็นรายการปัจจุบันจริง
import { readFile } from 'node:fs/promises';

const FIREBASE_API_KEY = 'AIzaSyDHiTSM7fz1FihDLyb_QxLGheo_6CuNXIE';
const PROJECT_ID = 'pharmacy-tph';
const DOC_PATH = 'pharmacy_tph/expiry_tracker';
const TRACKER_URL = 'https://oatsudster.github.io/pharmacy-tph/expiry-tracker.html';
const NEAR_EXPIRY_DAYS = 90;
const TELEGRAM_MAX_LEN = 4000; // เผื่อ margin จาก limit จริง 4096

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function fail(msg) {
  console.error('❌ ' + msg);
  process.exit(1);
}

if (!BOT_TOKEN || !CHAT_ID) {
  fail('ไม่พบ TELEGRAM_BOT_TOKEN หรือ TELEGRAM_CHAT_ID ใน environment variables');
}

// ── 1. อ่าน DATA (ข้อมูลพื้นฐาน) จาก expiry-tracker.html ──────────────
async function loadBaseData() {
  const html = await readFile(new URL('../../expiry-tracker.html', import.meta.url), 'utf8');
  const m = html.match(/const DATA = (\{[\s\S]*?\});/);
  if (!m) fail('ไม่พบ "const DATA = {...}" ใน expiry-tracker.html — โครงสร้างไฟล์อาจเปลี่ยนไป');
  try {
    return JSON.parse(m[1]);
  } catch (e) {
    fail('parse DATA จาก expiry-tracker.html ไม่สำเร็จ: ' + e.message);
  }
}

// ── 2. ดึงส่วนที่แก้ไข (overrides/extras/removed) จาก Firestore REST API ──
function fsToJs(value) {
  if (value == null || value.nullValue !== undefined) return null;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.arrayValue !== undefined) return (value.arrayValue.values || []).map(fsToJs);
  if (value.mapValue !== undefined) return fsFieldsToJs(value.mapValue.fields || {});
  return null;
}
function fsFieldsToJs(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = fsToJs(v);
  return out;
}

async function loadFirestoreState() {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${DOC_PATH}?key=${FIREBASE_API_KEY}`;
  const res = await fetch(url);
  if (res.status === 404) {
    // ยังไม่เคยมีการแก้ไขใดๆ เลย — ใช้ค่าเริ่มต้นว่าง (เหมือน loadLocalState() ตอนไม่มีข้อมูล)
    return { overrides: {}, extras: [], removed: [] };
  }
  if (!res.ok) fail(`ดึงข้อมูล Firestore ไม่สำเร็จ: HTTP ${res.status}`);
  const doc = await res.json();
  const fields = fsFieldsToJs(doc.fields || {});
  return {
    overrides: fields.overrides || {},
    extras: fields.extras || [],
    removed: fields.removed || [],
  };
}

// ── 3. ทำซ้ำ buildRows() ────────────────────────────────────────────
function buildRows(DATA, { overrides, extras, removed }) {
  const baseRows = DATA.rows.map((r, i) => ({ ...r, id: 'r' + i, baseQty: r.qty, baseExp: r.exp }));
  const removedSet = new Set(removed);
  const fromBase = baseRows
    .filter(r => !removedSet.has(r.id))
    .map(r => {
      const ov = overrides[r.id];
      const qty = ov && ov.qty != null ? ov.qty : r.baseQty;
      const exp = ov && ov.exp !== undefined ? ov.exp : r.baseExp;
      return { ...r, qty, exp };
    });
  const fromExtra = extras.map(e => ({ ...e }));
  return [...fromBase, ...fromExtra];
}

// ── 4. daysLeft/status — Asia/Bangkok เท่านั้น ห้ามใช้ UTC ตรงๆ ──────
function todayBangkokISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }); // YYYY-MM-DD
}
function daysLeft(today, exp) {
  if (!exp) return null;
  const a = new Date(today + 'T00:00:00');
  const b = new Date(exp + 'T00:00:00');
  if (isNaN(b.getTime())) return null;
  return Math.round((b - a) / 86400000);
}

// ── 5-6. กรอง/จัดกลุ่ม/สร้างข้อความ ──────────────────────────────────
function escTg(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmtQty(q) {
  if (q == null) return '?';
  return Number.isInteger(q) ? String(q) : String(q);
}
function buildMessage(today, rows) {
  const near = rows
    .map(r => ({ ...r, days: daysLeft(today, r.exp) }))
    .filter(r => r.days !== null && r.days <= NEAR_EXPIRY_DAYS);

  const [dd, mm, yyyy] = [today.slice(8, 10), today.slice(5, 7), today.slice(0, 4)];
  const header = `🔔 <b>แจ้งเตือนยาใกล้หมดอายุ — รพ.ถ้ำพรรณรา</b>\n📅 ${dd}/${mm}/${yyyy}\n\n`;

  if (near.length === 0) {
    return header + '✅ ไม่มีรายการยาใกล้หมดอายุ (≤90 วัน) ในวันนี้';
  }

  // จัดกลุ่มตามกล่อง เรียงกล่องตามรายการที่ใกล้หมดอายุที่สุดในกล่องนั้นก่อน
  const byBox = new Map();
  for (const r of near) {
    if (!byBox.has(r.box)) byBox.set(r.box, []);
    byBox.get(r.box).push(r);
  }
  const boxGroups = [...byBox.entries()]
    .map(([box, items]) => ({ box, items: items.sort((a, b) => a.days - b.days) }))
    .sort((a, b) => a.items[0].days - b.items[0].days);

  let body = `⚠️ พบ ${near.length} รายการที่หมดอายุแล้ว/ใกล้หมดอายุ (≤${NEAR_EXPIRY_DAYS} วัน)\n\n`;
  for (const g of boxGroups) {
    body += `📦 <b>${escTg(g.box)}</b>\n`;
    for (const r of g.items) {
      const status = r.days < 0 ? `หมดอายุแล้ว ${Math.abs(r.days)} วัน` : `เหลือ ${r.days} วัน`;
      body += ` • ${escTg(r.name)} (จำนวน ${fmtQty(r.qty)}) — ${status}\n`;
    }
    body += '\n';
  }

  let msg = header + body + `🔗 ดูรายละเอียดทั้งหมด: ${TRACKER_URL}`;
  if (msg.length > TELEGRAM_MAX_LEN) {
    const cut = header + body.slice(0, TELEGRAM_MAX_LEN - header.length - 120);
    msg = cut + `\n… และรายการอื่นๆ อีก — ดูทั้งหมดที่: ${TRACKER_URL}`;
  }
  return msg;
}

// ── 7. ส่งเข้า Telegram ──────────────────────────────────────────────
async function sendTelegram(text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    fail(`ส่งข้อความ Telegram ไม่สำเร็จ: ${data.description || res.status}`);
  }
}

// ── main ─────────────────────────────────────────────────────────────
const DATA = await loadBaseData();
const state = await loadFirestoreState();
const rows = buildRows(DATA, state);
const today = todayBangkokISO();
const message = buildMessage(today, rows);

console.log('--- ข้อความที่จะส่ง ---');
console.log(message);
console.log('-----------------------');

await sendTelegram(message);
console.log('✅ ส่งข้อความแจ้งเตือนสำเร็จ');
