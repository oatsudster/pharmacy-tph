// จัดหมวดข้อความภาษาไทยด้วย Groq API (Llama) — ใช้ร่วมกันได้หลายหน้าในเว็บแอปนี้
// (ME_Dashboard.html: Administration Error, adr.html: อาการ ADR ฯลฯ)
// Deploy บน Cloudflare Workers — ดูขั้นตอนใน README.md
//
// รับ POST { items: [{ id, text }, ...], categories: [string, ...], context: string } (items สูงสุด 60 รายการ/ครั้ง)
// ตอบ         { results: [{ id, category }, ...] }  — category เป็นค่าว่าง ("") ถ้า AI ไม่มั่นใจ/ไม่เข้าหมวดใด
//
// หรือ POST { mode: 'ask', question: string, data: object, context: string } — ถามคำถามอิสระเกี่ยวกับข้อมูลสรุป (ไม่มี PII)
// ตอบ         { answer: string }
//
// หรือ POST { mode: 'chat', model: 'fast'|'smart', system, messages, tools } — ผู้ช่วย AI (lib/ai-assistant.js)
// รับ/ตอบรูปแบบ Anthropic Messages (tool_use / tool_result) แล้วแปลงเป็น OpenAI format เรียก Groq
// ตอบ         { content: [...], stop_reason: 'tool_use' | 'end_turn' }

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

    if (body.mode === 'chat') return handleChat(env, body);
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

// ── ผู้ช่วย AI (chat + tool use) ─────────────────────────────────
const CHAT_MODELS = { fast: 'openai/gpt-oss-20b', smart: 'openai/gpt-oss-120b' };
const CHAT_DAILY_LIMIT = 400;
const CHAT_BASE_SYSTEM =
  'คุณเป็นผู้ช่วยของกลุ่มงานเภสัชกรรมและคุ้มครองผู้บริโภค โรงพยาบาลถ้ำพรรณรา ตอบเป็นภาษาไทย กระชับ ตรงประเด็น ' +
  'ใช้เครื่องมือที่มีเพื่อค้นข้อมูลจริงเสมอ ห้ามเดาหรือสมมติตัวเลข ถ้าไม่มีข้อมูลให้บอกตรงๆ ' +
  'ข้อมูลระบุตัวผู้ป่วย (ชื่อ/HN/AN) ถูกซ่อนจากคุณโดยตั้งใจ ไม่ต้องพยายามขอ';

async function handleChat(env, body) {
  const model = CHAT_MODELS[body.model] || CHAT_MODELS.smart;
  const src = Array.isArray(body.messages) ? body.messages.slice(-40) : [];
  if (!src.length) return json({ error: 'missing messages' }, 400);
  const system = CHAT_BASE_SYSTEM + '\n\n' + (typeof body.system === 'string' ? body.system.slice(0, 6000) : '');

  const messages = [{ role: 'system', content: system }];
  for (const m of src) {
    if (m.role === 'user') {
      if (typeof m.content === 'string') { messages.push({ role: 'user', content: m.content.slice(0, 2000) }); continue; }
      for (const b of m.content || []) {
        if (b.type === 'tool_result') messages.push({ role: 'tool', tool_call_id: b.tool_use_id, content: String(b.content).slice(0, 9000) });
      }
    } else if (m.role === 'assistant') {
      const blocks = Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content) }];
      const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n');
      const calls = blocks.filter(b => b.type === 'tool_use').map(b => ({
        id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input || {}) },
      }));
      const msg = { role: 'assistant', content: text || null };
      if (calls.length) msg.tool_calls = calls;
      messages.push(msg);
    }
  }
  const tools = (Array.isArray(body.tools) ? body.tools.slice(0, 20) : []).map(t => ({
    type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));

  const dayKey = 'chatquota_' + new Date().toISOString().slice(0, 10);
  const used = Number((await env.RATE_LIMIT.get(dayKey)) || 0);
  if (used >= CHAT_DAILY_LIMIT) return json({ error: 'ใช้ครบโควตารายวันแล้ว ลองใหม่พรุ่งนี้' }, 429);
  await env.RATE_LIMIT.put(dayKey, String(used + 1), { expirationTtl: 172800 });

  const payload = { model, messages, temperature: 0.2, max_tokens: 4096 };
  if (tools.length) { payload.tools = tools; payload.tool_choice = 'auto'; }
  try {
    const call = m => fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.GROQ_API_KEY}` },
      body: JSON.stringify({ ...payload, model: m }),
    });
    let res = await call(model);
    // โควตาฟรีจำกัดโทเคน/นาทีแยกตามรุ่น — ชนเพดานรุ่นแม่น ให้ลองรุ่นเร็วทันที
    if (res.status === 429 && model !== CHAT_MODELS.fast) res = await call(CHAT_MODELS.fast);
    if (res.status === 429) {
      const t = await res.text();
      const m = t.match(/try again in\s*([\d.]+)\s*(ms|s)/i);
      const wait = m ? Math.ceil(m[2].toLowerCase() === 'ms' ? m[1] / 1000 : +m[1]) : 15;
      return json({ error: 'โควตา AI รายนาทีเต็มชั่วคราว', retry_after: Math.min(wait + 1, 30) }, 429);
    }
    if (!res.ok) throw new Error('groq http ' + res.status + ': ' + (await res.text()).slice(0, 500));
    const data = await res.json();
    const msg = data.choices?.[0]?.message || {};
    const content = [];
    if (msg.content) content.push({ type: 'text', text: msg.content });
    for (const c of msg.tool_calls || []) {
      let input = {};
      try { input = JSON.parse(c.function.arguments || '{}'); } catch { /* ใช้ {} */ }
      content.push({ type: 'tool_use', id: c.id, name: c.function.name, input });
    }
    return json({ content, stop_reason: (msg.tool_calls || []).length ? 'tool_use' : 'end_turn' });
  } catch (e) {
    console.error('chat failed', e);
    return json({ error: 'chat failed: ' + e.message }, 502);
  }
}
