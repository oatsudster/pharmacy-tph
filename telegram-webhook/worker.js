// Webhook รับคำสั่งจาก Telegram แล้วตอบข้อมูลยาใกล้หมดอายุ
// Deploy บน Cloudflare Workers — ดูขั้นตอนใน README.md
//
// คำสั่งที่รองรับ:
//   /check          สั่งรัน workflow expiry-telegram-notify.yml ทันที (สรุปยาใกล้หมดอายุ ≤90 วันทั้งหมด)
//   /search <ชื่อยา>  ค้นหายาตามชื่อ ตอบทันทีจากข้อมูลสด (ไม่ผ่าน workflow)
//   /monthly        (เฉพาะแชทงานโรงพยาบาล TASKS_CHAT_ID) รายการส่ง HRMS / SKYNET ประจำเดือน (cron ส่งเองทุกวันที่ 1)
//   /help           แสดงคำสั่งทั้งหมด
//
// Cron */5 นาที: แจ้งเอกสารใหม่ในหน้า insurance-audit เข้าแชทส่วนตัว TASKS_CHAT_ID (auditUploadsNotify) — ไม่เข้ากลุ่มห้องยา
// Cron trigger (wrangler.toml) สั่งรัน workflow เดียวกันทุกวัน 08:30 น. ไทย —
// ใช้แทน schedule ของ GitHub Actions ที่ดีเลย์ไม่แน่นอน (บางวันช้าไปถึงเที่ยง-บ่ายโมง)
// วันที่ 1 ของเดือน cron เดียวกันส่งข้อความเตือนลงข้อมูลเดือนที่แล้วใน HRMS และ SKYNET ด้วย (monthlyReminder)

const FIREBASE_API_KEY = 'AIzaSyDHiTSM7fz1FihDLyb_QxLGheo_6CuNXIE';
const PROJECT_ID = 'pharmacy-tph';
const DOC_PATH = 'pharmacy_tph/expiry_tracker';
const TRACKER_URL = 'https://tph-pharmacy.pages.dev/expiry-tracker';
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
      // แชทอื่น (เช่นแชทส่วนตัวของผู้ดูแล) ตอบแค่ /chatid หรือ /start — บอกเลข chat id ไว้ตั้งเป็น TASKS_CHAT_ID
      const c = msg.text.trim().split(/[\s@]/)[0];
      if (c === '/chatid' || c === '/start') {
        await replyTelegram(env, chatId, `chat id ของแชทนี้: <code>${escTg(chatId)}</code>` +
          (chatId === env.TASKS_CHAT_ID ? '\n✅ แชทนี้คือแชทงานโรงพยาบาล (เอกสาร insurance-audit, HRMS/SKYNET) — /monthly ใช้ได้' : ''));
      } else if (c === '/monthly' && chatId === env.TASKS_CHAT_ID) {
        await replyTelegram(env, chatId, monthlyReminder(new Date(), true));
      }
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
    } else if (cmd === '/annual') {
      await replyTelegram(env, chatId, (await annualDocsReminder(new Date(), true)) || '✅ งานเอกสารประจำปี (คบส./วัคซีน) ยังไม่ถึงช่วงเตือน หรือทำครบแล้ว');
    } else if (cmd === '/help') {
      await handleHelp(env, chatId);
    }

    return new Response('OK');
  },

  async scheduled(event, env, ctx) {
    // ทุก 5 นาที: เอกสารใหม่ในหน้า insurance-audit → แชทส่วนตัว (TASKS_CHAT_ID) ไม่ใช่กลุ่มห้องยา
    if (event.cron === AUDIT_CRON) {
      ctx.waitUntil(auditUploadsNotify(env).catch((e) => console.error('audit uploads', e)));
      return;
    }
    ctx.waitUntil(
      dispatchWorkflow(env).then(async (res) => {
        if (!res.ok) {
          console.error('scheduled dispatch failed', res.status, await res.text().catch(() => ''));
        }
      })
    );
    // วันที่ 1 ของเดือน (เวลาไทย) — เตือนส่งข้อมูลเดือนที่แล้วเข้า HRMS และ SKYNET
    // ส่งเข้าแชทงานโรงพยาบาล (TASKS_CHAT_ID) ตั้งแต่ 2026-11-10 — ยังไม่ตั้งค่าก็ส่งกลุ่มห้องยาเหมือนเดิม
    const reminder = monthlyReminder(new Date(event.scheduledTime));
    if (reminder) ctx.waitUntil(replyTelegram(env, env.TASKS_CHAT_ID || env.ALLOWED_CHAT_ID, reminder));
    // งานเอกสารประจำปี (annual-docs.html): เหลือ 14/7/3/1/0 วัน และทุกวันจันทร์ถ้าเลยกำหนด
    ctx.waitUntil(annualDocsReminder(new Date(event.scheduledTime)).then((t) => t && replyTelegram(env, env.ALLOWED_CHAT_ID, t)).catch((e) => console.error('annual docs', e)));
  },
};

// ── เอกสารใหม่ในหน้า insurance-audit (งานโรงพยาบาล ไม่ใช่งานห้องยา) ──
// รายการไฟล์ = pharmacy_tph/insurance_audit_docs.files (ทั้งอัปโหลดผ่าน Apps Script และวางลิงก์เอง)
// จำ id ที่เคยเห็นไว้ใน KV 'audit_seen' — รอบแรก (ยังไม่มี key) จำไว้เฉย ๆ ไม่แจ้ง
const AUDIT_CRON = '*/5 * * * *';
const AUDIT_URL = 'https://tph-pharmacy.pages.dev/insurance-audit';
async function fsDoc(name) {
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/pharmacy_tph/${name}?key=${FIREBASE_API_KEY}`);
  if (res.status === 404) return {};
  if (!res.ok) throw new Error(`firestore ${name}: ${res.status}`);
  return fsFieldsToJs((await res.json()).fields || {});
}
async function auditUploadsNotify(env) {
  if (!env.TASKS_CHAT_ID) return;
  const files = (await fsDoc('insurance_audit_docs')).files || {};
  const ids = Object.keys(files);
  const raw = await env.RATE_LIMIT.get('audit_seen');
  const seen = new Set(raw ? JSON.parse(raw) : []);
  const fresh = ids.filter((id) => !seen.has(id));
  if (raw && !fresh.length && ids.length === seen.size) return;
  // เขียนก่อนส่ง — Telegram ล่มก็ไม่แจ้งซ้ำทุก 5 นาที
  await env.RATE_LIMIT.put('audit_seen', JSON.stringify(ids));
  if (!raw || !fresh.length) return;
  let topics = {}, metricName = {};
  try {
    const a = JSON.parse((await fsDoc('insurance_audit')).json || 'null') || {};
    for (const t of a.docs || []) topics[t.id] = t.name;
    for (const m of a.metrics || []) metricName[m.id] = m.name;
  } catch (e) { console.error('audit topics', e); }
  const list = fresh.map((id) => files[id]).sort((x, y) => String(x.at || '').localeCompare(String(y.at || '')));
  const lines = list.map((f) => {
    const t = new Date(f.at || Date.now()).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const ms = (f.metrics || []).map((m) => metricName[m] ? `${m} ${metricName[m]}` : m).join(', ');
    return `📄 <a href="${escTg(f.url).replace(/"/g, '&quot;')}">${escTg(f.name)}</a>\n` +
      `   📁 ${escTg(topics[f.folder] || 'ไม่ระบุเรื่อง')} · 👤 ${escTg(f.by || '-')} · ${escTg(t)}` +
      (f.size ? ` · ${(f.size / 1048576).toFixed(1)} MB` : '') + (ms ? `\n   ตัวชี้วัด ${escTg(ms)}` : '');
  });
  await replyTelegram(env, env.TASKS_CHAT_ID,
    `📥 <b>เอกสารใหม่ใน insurance-audit (${list.length} ไฟล์)</b>\n\n${lines.join('\n\n')}\n\n${AUDIT_URL}`);
}

const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

// force = ส่งแม้ไม่ใช่วันที่ 1 (คำสั่ง /monthly) — เดือนที่แจ้งคือเดือนก่อนเดือนปัจจุบัน
function monthlyReminder(now, force) {
  const bkk = new Date(now.getTime() + 7 * 3600 * 1000);   // เวลาไทย UTC+7
  if (!force && bkk.getUTCDate() !== 1) return null;
  const prev = new Date(Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth() - 1, 1));
  const month = `${TH_MONTHS[prev.getUTCMonth()]} ${prev.getUTCFullYear() + 543}`;
  return (
    `📅 <b>วันที่ 1 — ส่งข้อมูลเดือน${month}</b>\n\n` +
    '<b>1. HRMS (ความคลาดเคลื่อนทางยา)</b>\n' +
    '• OPD/IPD จาก HOSxP + ER จาก ME Dashboard\n' +
    '• โปรแกรม HRMS เปิดเองที่เครื่องเภสัช 09:00 น. — ตรวจรายการแล้วกด เริ่ม\n\n' +
    '<b>2. SKYNET (อย.)</b>\n' +
    '• ใบสั่งยา OPD / วันนอน IPD / ARV (ช่อง TB กรอกเอง)\n' +
    '• รายงาน ADR ที่ยังไม่ได้ส่ง — โปรแกรม SKYNET ADR Auto Fill\n\n' +
    'ส่งครบแล้วตอบ ✅ ในกลุ่มนี้ได้เลย'
  );
}

const ANNUAL_TASKS = {
  kbs_order: 'คำสั่งแต่งตั้งคณะกรรมการดำเนินงานคุ้มครองผู้บริโภคอำเภอ (งาน คบส.)',
  vac_order: 'คำสั่งแต่งตั้งคณะทำงานบริหารจัดการวัคซีนฯ (งานวัคซีน)',
  vac_plan: 'ทบทวนแผน/ผังเตรียมความพร้อม Cold Chain + ซ้อมแผน (งานวัคซีน)',
};
const TH_MS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
// ตรรกะเดียวกับ status() ใน annual-docs.html (ปีงบ ต.ค.–ก.ย., doneFy = ปีงบที่ทำเสร็จล่าสุด)
async function annualDocsReminder(now, force) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/pharmacy_tph/annual_docs?key=${FIREBASE_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const doc = await res.json();
  const js = doc.fields && doc.fields.json && doc.fields.json.stringValue;
  if (!js) return null;
  const S = JSON.parse(js);
  const bkk = new Date(now.getTime() + 7 * 3600 * 1000);
  const today = Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate());
  const fy = bkk.getUTCFullYear() + 543 + (bkk.getUTCMonth() >= 9 ? 1 : 0);
  const monday = bkk.getUTCDay() === 1;
  const lines = [];
  for (const [id, name] of Object.entries(ANNUAL_TASKS)) {
    const sch = S.schedule && S.schedule[id];
    if (!sch || (sch.doneFy || 0) >= fy) continue;
    const dueY = fy - 543 - (sch.month >= 10 ? 1 : 0);
    const days = Math.round((Date.UTC(dueY, sch.month - 1, sch.day) - today) / 864e5);
    const due = `${sch.day} ${TH_MS[sch.month - 1]} ${dueY + 543}`;
    const lead = Math.max(7, sch.lead || 14);
    if (days < 0 && (monday || force)) lines.push(`⛔ <b>${name}</b>
   เลยกำหนด ${-days} วัน (${due})`);
    else if (days >= 0 && (force ? days <= lead : [lead, 14, 7, 3, 1, 0].includes(days))) lines.push(`⚠️ <b>${name}</b>
   ${days === 0 ? 'ครบกำหนดวันนี้' : 'อีก ' + days + ' วัน'} (${due})`);
  }
  if (!lines.length) return null;
  return `📜 <b>งานเอกสารประจำปีงบ ${fy}</b>

${lines.join('\n\n')}

แก้ไข/พิมพ์ที่หน้า "งานเอกสารประจำปี" แล้วกด ✓ ทำเสร็จแล้ว เพื่อหยุดเตือน
https://tph-pharmacy.pages.dev/annual-docs`;
}

function dispatchWorkflow(env) {
  return fetch(
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
}

async function handleHelp(env, chatId) {
  const text =
    '🤖 <b>คำสั่งที่ใช้ได้</b>\n\n' +
    '/check — ตรวจสอบยาใกล้หมดอายุทั้งหมดทันที (≤90 วัน)\n' +
    '/search ชื่อยา — ค้นหายาตามชื่อ ดูวันหมดอายุและตำแหน่งเก็บ\n' +
    '/annual — ดูงานเอกสารประจำปี (คำสั่ง คบส./วัคซีน, แผน Cold Chain) ที่ใกล้/เลยกำหนด\n' +
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

  const dispatchRes = await dispatchWorkflow(env);

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
