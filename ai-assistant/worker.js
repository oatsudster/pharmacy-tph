// ตัวกลางเรียก Claude (Haiku / Sonnet) สำหรับผู้ช่วย AI ในทุกหน้าของเว็บแอป
// Deploy บน Cloudflare Workers — ดูขั้นตอนใน README.md
//
// รับ POST { model: 'haiku'|'sonnet', system: string, messages: [...], tools: [...] }
// ตอบ         { content: [...], stop_reason, usage }  (รูปแบบเดียวกับ Anthropic Messages API)
//
// Worker ไม่รันเครื่องมือเอง — เบราว์เซอร์เป็นคนรัน tool แล้วส่งผลกลับมาในรอบถัดไป
// ข้อมูลผู้ป่วยจึงอยู่ในเบราว์เซอร์ และส่งให้ AI เฉพาะผลลัพธ์ที่ฟิลด์ระบุตัวตนถูกตัดออกแล้ว

const MODELS = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-5-5',
};
const MAX_TOKENS = 2048;
const MAX_BODY_BYTES = 200_000;
const MAX_MESSAGES = 40;
const DAILY_LIMIT = 400; // จำนวนครั้งเรียก API รวมต่อวัน (กันค่าใช้จ่ายบานปลาย)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-App-Token',
};

const BASE_SYSTEM =
  'คุณเป็นผู้ช่วยของกลุ่มงานเภสัชกรรมและคุ้มครองผู้บริโภค โรงพยาบาลถ้ำพรรณรา ตอบเป็นภาษาไทย กระชับ ตรงประเด็น ' +
  'ใช้เครื่องมือที่มีเพื่อค้นข้อมูลจริงเสมอ ห้ามเดาหรือสมมติตัวเลข ถ้าไม่มีข้อมูลให้บอกตรงๆ ' +
  'ข้อมูลระบุตัวผู้ป่วย (ชื่อ/HN/AN) ถูกซ่อนจากคุณโดยตั้งใจ ไม่ต้องพยายามขอ';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
    if (!env.APP_TOKEN || request.headers.get('X-App-Token') !== env.APP_TOKEN) {
      return json({ error: 'unauthorized' }, 401);
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: 'request too large' }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: 'invalid json' }, 400); }

    const model = MODELS[body.model] || MODELS.sonnet;
    const messages = Array.isArray(body.messages) ? body.messages.slice(-MAX_MESSAGES) : [];
    if (!messages.length) return json({ error: 'missing messages' }, 400);
    const tools = Array.isArray(body.tools) ? body.tools.slice(0, 20) : [];
    const system = BASE_SYSTEM + '\n\n' + (typeof body.system === 'string' ? body.system.slice(0, 6000) : '');

    const dayKey = 'quota_' + new Date().toISOString().slice(0, 10);
    const used = Number((await env.RATE_LIMIT.get(dayKey)) || 0);
    if (used >= DAILY_LIMIT) return json({ error: 'ใช้ครบโควตารายวันแล้ว ลองใหม่พรุ่งนี้' }, 429);
    await env.RATE_LIMIT.put(dayKey, String(used + 1), { expirationTtl: 172800 });

    const payload = { model, max_tokens: MAX_TOKENS, system, messages };
    if (tools.length) payload.tools = tools;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error('anthropic error', res.status, text.slice(0, 500));
      return json({ error: 'AI error ' + res.status }, 502);
    }
    return new Response(text, { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
}
