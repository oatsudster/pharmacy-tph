// จัดหมวด Administration Error (IPD) จากข้อความ "หมายเหตุ" ด้วย Gemini API
// Deploy บน Cloudflare Workers — ดูขั้นตอนใน README.md
//
// รับ POST { items: [{ id, text }, ...] } (สูงสุด 60 รายการ/ครั้ง)
// ตอบ         { results: [{ id, category }, ...] }  — category เป็นค่าว่าง ("") ถ้า Gemini ไม่มั่นใจ

const CATEGORIES = [
  'ให้ยาไม่ครบรายการ', 'ให้ยาผิดชนิด', 'ให้ยาที่ไม่ได้สั่ง', 'ให้ยาผิดวิธีใช้', 'ให้ยาผิดจำนวน',
  'ให้ยาผิดคน', 'ให้ยาผิดขนาด', 'ให้ยาผิดวิถีทาง', 'ให้ยาผิดเวลา', 'ให้ยาในอัตราเร็วที่ผิด',
  'ให้ยาผิดเทคนิค', 'ให้ยาที่แพ้', 'ให้ยาที่มี DI กัน', 'ให้ยาผิดรูปแบบยา', 'ไม่ได้เก็บยากลับคืนเที่ยง',
];
const MAX_ITEMS = 60;
const MODEL = 'gemini-2.5-flash';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-App-Token',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

    if (env.APP_TOKEN && request.headers.get('X-App-Token') !== env.APP_TOKEN) {
      return json({ error: 'unauthorized' }, 401);
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: 'invalid json' }, 400); }
    const items = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : [];
    if (!items.length) return json({ results: [] });

    // กันสแปม/คุมโควตา Gemini — จำกัดจำนวนครั้งรวมต่อวัน
    const dayKey = 'quota_' + new Date().toISOString().slice(0, 10);
    const usedToday = Number((await env.RATE_LIMIT.get(dayKey)) || 0);
    if (usedToday >= 300) {
      return json({ error: 'daily quota reached, ลองใหม่พรุ่งนี้' }, 429);
    }
    await env.RATE_LIMIT.put(dayKey, String(usedToday + items.length), { expirationTtl: 172800 });

    try {
      const results = await classifyBatch(env, items);
      return json({ results });
    } catch (e) {
      console.error('classify failed', e);
      return json({ error: 'classify failed: ' + e.message }, 500);
    }
  },
};

async function classifyBatch(env, items) {
  const numbered = items.map((it, i) => `${i}. ${(it.text || '').trim().slice(0, 500) || '(ไม่มีรายละเอียด)'}`).join('\n');
  const prompt =
    'คุณเป็นเภสัชกรที่ช่วยจัดหมวดหมู่ "Administration Error" (ความคลาดเคลื่อนในขั้นตอนการให้ยาแก่ผู้ป่วย IPD) ' +
    'จากข้อความหมายเหตุ/รายละเอียดเหตุการณ์ที่บันทึกไว้ในระบบ ให้เลือกหมวดที่ตรงที่สุดหมวดเดียวจากรายการนี้เท่านั้น:\n' +
    CATEGORIES.map((c, i) => `- ${c}`).join('\n') +
    '\n\nถ้าข้อความไม่ได้บรรยายเหตุการณ์การให้ยา หรือไม่เข้ากับหมวดใดเลย ให้ตอบสตริงว่าง ""\n\n' +
    'รายการที่ต้องจัดหมวด (แต่ละบรรทัดขึ้นต้นด้วยหมายเลข):\n' + numbered;

  const schema = {
    type: 'OBJECT',
    properties: {
      results: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            index: { type: 'INTEGER' },
            category: { type: 'STRING', enum: [...CATEGORIES, ''] },
          },
          required: ['index', 'category'],
        },
      },
    },
    required: ['results'],
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
      }),
    }
  );
  if (!res.ok) throw new Error('gemini http ' + res.status + ': ' + (await res.text()).slice(0, 300));
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('empty gemini response');
  const parsed = JSON.parse(text);
  const byIndex = new Map((parsed.results || []).map(r => [r.index, r.category]));

  return items.map((it, i) => ({
    id: it.id,
    category: CATEGORIES.includes(byIndex.get(i)) ? byIndex.get(i) : '',
  }));
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
}
