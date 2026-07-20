// Webhook รับคำสั่งจาก Telegram แล้วตอบข้อมูลยาใกล้หมดอายุ
// Deploy บน Cloudflare Workers — ดูขั้นตอนใน README.md
//
// คำสั่งที่รองรับ:
//   /check          สั่งรัน workflow expiry-telegram-notify.yml ทันที (สรุปยาใกล้หมดอายุ ≤90 วันทั้งหมด)
//   /search <ชื่อยา>  ค้นหายาตามชื่อ ตอบทันทีจากข้อมูลสด (ไม่ผ่าน workflow)
//   /help           แสดงคำสั่งทั้งหมด

const FIREBASE_API_KEY = 'AIzaSyDHiTSM7fz1FihDLyb_QxLGheo_6CuNXIE';
const PROJECT_ID = 'pharmacy-tph';
const DOC_PATH = 'pharmacy_tph/expiry_tracker';
const TRACKER_URL = 'https://oatsudster.github.io/pharmacy-tph/expiry-tracker.html';
const TELEGRAM_MAX_LEN = 4000;
const CHECK_COOLDOWN_MS = 60 * 1000; // กันสแปม /check — ห่างกันอย่างน้อย 1 นาที

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('OK');

    let update;
    try {
      update = await request.json();
    } catch {
      return new Response('OK');
    }

    const msg = update.message;
    if (!msg || typeof msg.text !== 'string') return new Response('OK');

    const chatId = String(msg.chat.id);
    if (chatId !== env.ALLOWED_CHAT_ID) {
      // ไม่ใช่กลุ่มที่อนุญาต — เงียบไว้ ไม่ตอบอะไร
      return new Response('OK');
    }

    const raw = msg.text.trim();
    const firstSpace = raw.indexOf(' ');
    const cmd = (firstSpace === -1 ? raw : raw.slice(0, firstSpace)).split('@')[0];
    const arg = firstSpace === -1 ? '' : raw.slice(firstSpace + 1).trim();

    if (cmd === '/check') {
      await handleCheck(env, chatId);
    } else if (cmd === '/search') {
      await handleSearch(env, chatId, arg);
    } else if (cmd === '/help') {
      await handleHelp(env, chatId);
    }

    return new Response('OK');
  },
};

async function handleHelp(env, chatId) {
  const text =
    '🤖 <b>คำสั่งที่ใช้ได้</b>\n\n' +
    '/check — ตรวจสอบยาใกล้หมดอายุทั้งหมดทันที (≤90 วัน)\n' +
    '/search ชื่อยา — ค้นหายาตามชื่อ ดูวันหมดอายุและตำแหน่งเก็บ\n' +
    '/help — แสดงคำสั่งทั้งหมดนี้';
  await replyTelegram(env, chatId, text);
}

async function handleCheck(env, chatId) {
  const lastRun = await env.RATE_LIMIT.get('last_check_ts');
  const now = Date.now();
  if (lastRun && now - Number(lastRun) < CHECK_COOLDOWN_MS) {
    const waitSec = Math.ceil((CHECK_COOLDOWN_MS - (now - Number(lastRun))) / 1000);
    await replyTelegram(env, chatId, `⏳ เพิ่งตรวจสอบไปเมื่อครู่ กรุณารออีก ${waitSec} วินาทีแล้วลองใหม่`);
    return;
  }
  await env.RATE_LIMIT.put('last_check_ts', String(now), { expirationTtl: 120 });

  await replyTelegram(env, chatId, '🔎 กำลังตรวจสอบรายการยาใกล้หมดอายุ รอสักครู่...');

  const dispatchRes = await fetch(
    `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW_FILE}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'expiry-telegram-webhook',
      },
      body: JSON.stringify({ ref: 'main' }),
    }
  );

  if (!dispatchRes.ok) {
    const errText = await dispatchRes.text().catch(() => '');
    console.error('dispatch failed', dispatchRes.status, errText);
    await replyTelegram(env, chatId, `❌ เรียกใช้งานไม่สำเร็จ (HTTP ${dispatchRes.status}) ลองใหม่อีกครั้ง หรือแจ้งผู้ดูแลระบบ`);
  }
}

async function handleSearch(env, chatId, query) {
  if (!query) {
    await replyTelegram(env, chatId, 'พิมพ์ /search ตามด้วยชื่อยา เช่น /search พาราเซตามอล');
    return;
  }

  let rows;
  try {
    const DATA = await loadBaseData();
    const state = await loadFirestoreState();
    rows = buildRows(DATA, state);
  } catch (e) {
    console.error('search data load failed', e);
    await replyTelegram(env, chatId, '❌ โหลดข้อมูลยาไม่สำเร็จ ลองใหม่อีกครั้ง');
    return;
  }

  const q = query.toLowerCase();
  const today = todayBangkokISO();
  const matches = rows
    .filter(r => (r.name || '').toLowerCase().includes(q))
    .map(r => ({ ...r, days: daysLeft(today, r.exp) }))
    .sort((a, b) => (a.days ?? 999999) - (b.days ?? 999999));

  if (matches.length === 0) {
    await replyTelegram(env, chatId, `ไม่พบยาที่มีชื่อตรงกับ "${escTg(query)}"`);
    return;
  }

  const shown = matches.slice(0, 20);
  let text = `🔍 พบ ${matches.length} รายการที่ตรงกับ "${escTg(query)}"\n\n`;
  for (const r of shown) {
    const status =
      r.days == null ? 'ไม่ระบุวันหมดอายุ' : r.days < 0 ? `หมดอายุแล้ว ${Math.abs(r.days)} วัน` : `เหลือ ${r.days} วัน`;
    text += `📦 ${escTg(r.box)} — ${escTg(r.name)} (จำนวน ${fmtQty(r.qty)}) — ${status}\n`;
  }
  if (matches.length > shown.length) {
    text += `\n… และอีก ${matches.length - shown.length} รายการ ลองค้นด้วยคำที่เจาะจงกว่านี้`;
  }
  if (text.length > TELEGRAM_MAX_LEN) {
    text = text.slice(0, TELEGRAM_MAX_LEN) + '\n… (ข้อความถูกตัด)';
  }

  await replyTelegram(env, chatId, text);
}

// ── อ่านข้อมูลยาแบบสด (เหมือน notify-expiry.mjs แต่ดึง HTML ผ่าน fetch แทนการอ่านไฟล์ local) ──
async function loadBaseData() {
  const res = await fetch(TRACKER_URL);
  if (!res.ok) throw new Error('fetch tracker html failed: ' + res.status);
  const html = await res.text();
  const m = html.match(/const DATA = (\{[\s\S]*?\});/);
  if (!m) throw new Error('DATA not found in tracker html');
  return JSON.parse(m[1]);
}

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
  if (res.status === 404) return { overrides: {}, extras: [], removed: [] };
  if (!res.ok) throw new Error('firestore fetch failed: ' + res.status);
  const doc = await res.json();
  const fields = fsFieldsToJs(doc.fields || {});
  return {
    overrides: fields.overrides || {},
    extras: fields.extras || [],
    removed: fields.removed || [],
  };
}

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

function todayBangkokISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}
function daysLeft(today, exp) {
  if (!exp) return null;
  const a = new Date(today + 'T00:00:00');
  const b = new Date(exp + 'T00:00:00');
  if (isNaN(b.getTime())) return null;
  return Math.round((b - a) / 86400000);
}

function escTg(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmtQty(q) {
  return q == null ? '?' : String(q);
}

async function replyTelegram(env, chatId, text) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
}
