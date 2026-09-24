// จัดหมวดข้อความภาษาไทยด้วย Groq API (Llama) — ใช้ร่วมกันได้หลายหน้าในเว็บแอปนี้
// (ME_Dashboard.html: Administration Error, adr.html: อาการ ADR ฯลฯ)
// Deploy บน Cloudflare Workers — ดูขั้นตอนใน README.md
//
// รับ POST { items: [{ id, text }, ...], categories: [string, ...], context: string } (items สูงสุด 60 รายการ/ครั้ง)
// ตอบ         { results: [{ id, category }, ...] }  — category เป็นค่าว่าง ("") ถ้า AI ไม่มั่นใจ/ไม่เข้าหมวดใด
//
// หรือ POST { mode: 'ask', question: string, data: object, context: string } — ถามคำถามอิสระเกี่ยวกับข้อมูลสรุป (ไม่มี PII)
// ตอบ         { answer: string }

const MAX_ITEMS = 60;
const MAX_QUESTION_LEN = 300;
const MAX_DATA_LEN = 4000;
const MODEL = 'openai/gpt-oss-120b';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-App-Token',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
    if (request.method === 'GET' && new URL(request.url).pathname === '/debug-models') {
      const r = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
      });
      return json(await r.json());
    }
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

    if (env.APP_TOKEN && request.headers.get('X-App-Token') !== env.APP_TOKEN) {
      return json({ error: 'unauthorized' }, 401);
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: 'invalid json' }, 400); }

    if (body.mode === 'ask') return handleAsk(env, body);

    const items = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : [];
    const categories = Array.isArray(body.categories) ? body.categories.filter(c => typeof c === 'string' && c.trim()) : [];
    const context = typeof body.context === 'string' ? body.context.trim() : '';
    if (!items.length) return json({ results: [] });
    if (!categories.length) return json({ error: 'missing categories' }, 400);

    // กันสแปม/คุมโควตา Groq — จำกัดจำนวนครั้งรวมต่อวัน
    const dayKey = 'quota_' + new Date().toISOString().slice(0, 10);
    const usedToday = Number((await env.RATE_LIMIT.get(dayKey)) || 0);
    if (usedToday >= 300) {
      return json({ error: 'daily quota reached, ลองใหม่พรุ่งนี้' }, 429);
    }
    await env.RATE_LIMIT.put(dayKey, String(usedToday + items.length), { expirationTtl: 172800 });

    try {
      const results = await classifyBatch(env, items, categories, context);
      return json({ results });
    } catch (e) {
      console.error('classify failed', e);
      return json({ error: 'classify failed: ' + e.message }, 500);
    }
  },
};

async function handleAsk(env, body) {
  const question = typeof body.question === 'string' ? body.question.trim().slice(0, MAX_QUESTION_LEN) : '';
  const context = typeof body.context === 'string' ? body.context.trim() : '';
  if (!question) return json({ error: 'missing question' }, 400);
  const dataStr = safeStringify(body.data).slice(0, MAX_DATA_LEN);

  const dayKey = 'quota_' + new Date().toISOString().slice(0, 10);
  const usedToday = Number((await env.RATE_LIMIT.get(dayKey)) || 0);
  if (usedToday >= 300) return json({ error: 'daily quota reached, ลองใหม่พรุ่งนี้' }, 429);
  await env.RATE_LIMIT.put(dayKey, String(usedToday + 1), { expirationTtl: 172800 });

  try {
    const answer = await askOnce(env, question, dataStr, context);
    return json({ answer });
  } catch (e) {
    console.error('ask failed', e);
    return json({ error: 'ask failed: ' + e.message }, 500);
  }
}

async function askOnce(env, question, dataStr, context) {
  const prompt =
    (context || 'ช่วยตอบคำถามเกี่ยวกับข้อมูลสรุปต่อไปนี้') +
    '\n\nข้อมูลสถิติ (JSON):\n' + dataStr +
    '\n\nคำถาม: ' + question +
    '\n\nตอบเป็นภาษาไทย กระชับ ตรงประเด็น ห้ามสมมติข้อมูลที่ไม่มีอยู่ในสถิติที่ให้มา';

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    }),
  });
  if (!res.ok) throw new Error('groq http ' + res.status + ': ' + (await res.text()).slice(0, 2000));
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('empty groq response');
  return text.trim();
}

function safeStringify(obj) {
  try { return JSON.stringify(obj ?? {}); } catch { return '{}'; }
}

async function classifyBatch(env, items, categories, context) {
  // ให้โมเดลตอบ "หมายเลขหมวด" แทนการพิมพ์ข้อความหมวดซ้ำ — กันปัญหาพิมพ์ตกหล่น/สลับตัวอักษร
  // (เช่น en dash "–" vs "-") ที่ทำให้จับคู่แบบ exact-match กับ categories.includes() พลาดได้ง่าย
  const numberedItems = items.map((it, i) => `${i}. ${(it.text || '').trim().slice(0, 500) || '(ไม่มีรายละเอียด)'}`).join('\n');
  const numberedCats = categories.map((c, i) => `${i}. ${c}`).join('\n');
  const prompt =
    (context || 'ช่วยจัดหมวดหมู่ข้อความต่อไปนี้') + ' ' +
    'ให้เลือกหมวดที่ตรงที่สุดหมวดเดียวจากรายการที่มีหมายเลขกำกับนี้เท่านั้น:\n' +
    numberedCats +
    '\n\nถ้าข้อความไม่เข้ากับหมวดใดเลยจริงๆ ให้ตอบ categoryIndex เป็น -1\n\n' +
    'รายการที่ต้องจัดหมวด (แต่ละบรรทัดขึ้นต้นด้วยหมายเลข):\n' + numberedItems +
    '\n\nตอบกลับเป็น JSON เท่านั้น รูปแบบ {"results":[{"index":0,"categoryIndex":2},...]} ' +
    'โดย index คือหมายเลขของรายการที่จัดหมวด (อ้างอิงจากรายการที่ต้องจัดหมวดด้านบน) ' +
    'และ categoryIndex คือหมายเลขของหมวดที่เลือก (อ้างอิงจากรายการหมวดด้านบน หรือ -1 ถ้าไม่เข้าหมวดใดเลยจริงๆ) ' +
    'ห้ามมีข้อความอื่นนอกเหนือจาก JSON';

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0,
    }),
  });
  if (!res.ok) throw new Error('groq http ' + res.status + ': ' + (await res.text()).slice(0, 2000));
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('empty groq response');
  const parsed = JSON.parse(text);
  const byIndex = new Map((parsed.results || []).map(r => [r.index, r.categoryIndex]));

  return items.map((it, i) => {
    const ci = byIndex.get(i);
    const valid = Number.isInteger(ci) && ci >= 0 && ci < categories.length;
    return { id: it.id, category: valid ? categories[ci] : '' };
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
}
