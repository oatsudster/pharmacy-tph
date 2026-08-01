// จัดหมวดข้อความภาษาไทยด้วย Groq API (Llama) — ใช้ร่วมกันได้หลายหน้าในเว็บแอปนี้
// (ME_Dashboard.html: Administration Error, adr.html: อาการ ADR ฯลฯ)
// Deploy บน Cloudflare Workers — ดูขั้นตอนใน README.md
//
// รับ POST { items: [{ id, text }, ...], categories: [string, ...], context: string } (items สูงสุด 60 รายการ/ครั้ง)
// ตอบ         { results: [{ id, category }, ...] }  — category เป็นค่าว่าง ("") ถ้า AI ไม่มั่นใจ/ไม่เข้าหมวดใด

const MAX_ITEMS = 60;
const MODEL = 'openai/gpt-oss-120b';
const NONE = 'ไม่เข้าหมวดใด';

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

async function classifyBatch(env, items, categories, context) {
  const numbered = items.map((it, i) => `${i}. ${(it.text || '').trim().slice(0, 500) || '(ไม่มีรายละเอียด)'}`).join('\n');
  const prompt =
    (context || 'ช่วยจัดหมวดหมู่ข้อความต่อไปนี้') + ' ' +
    'ให้เลือกหมวดที่ตรงที่สุดหมวดเดียวจากรายการนี้เท่านั้น:\n' +
    categories.map(c => `- ${c}`).join('\n') +
    `\n\nถ้าข้อความไม่เข้ากับหมวดใดเลย ให้ตอบ "${NONE}"\n\n` +
    'รายการที่ต้องจัดหมวด (แต่ละบรรทัดขึ้นต้นด้วยหมายเลข):\n' + numbered +
    '\n\nตอบกลับเป็น JSON เท่านั้น รูปแบบ {"results":[{"index":0,"category":"..."},...]} ' +
    'โดย category ต้องเป็นสตริงที่ตรงกับหมวดในรายการเป๊ะๆ (หรือ "' + NONE + '") ห้ามมีข้อความอื่นนอกเหนือจาก JSON';

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
  const byIndex = new Map((parsed.results || []).map(r => [r.index, r.category]));

  return items.map((it, i) => ({
    id: it.id,
    category: categories.includes(byIndex.get(i)) ? byIndex.get(i) : '',
  }));
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
}
