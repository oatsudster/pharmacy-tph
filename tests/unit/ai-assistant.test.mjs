// F02 — HN/ชื่อผู้ป่วยต้องไม่ออกไปกับ request ไป Worker AI ทุกทาง (list_datasets, query_data, export_report, extraTools)
// F06 — export ที่เกิน 5,000 แถวต้องบอกว่าไม่ครบ ทั้งในผลเครื่องมือ ปุ่มดาวน์โหลด และในไฟล์
// ใช้ jsdom + fetch จำลอง (ไม่เรียก AI จริง) · ข้อมูลสมมติทั้งหมด
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { read } from '../helpers.mjs';

const HN = '9999001', HN2 = '9999002', NAME = 'ทดสอบ หนึ่ง', NOTE_HN = 'โทรตาม HN ' + HN2 + ' แล้ว';

// สร้างหน้าว่างที่โหลด ai-assistant.js แล้วรอให้ widget พร้อม
function page() {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://example.test/' });
  const w = dom.window;
  w.eval(read('lib/ai-assistant.js'));
  return w;
}

// config ของหน้า dm-remission จริง (ดึงจาก HTML) รันกับข้อมูลสมมติ
function initDmRemission(w) {
  const src = read('dm-remission.html');
  const start = src.lastIndexOf('AiAssistant.init({');
  const end = src.indexOf('});', src.lastIndexOf('dm_patients:')) + 3;
  w.getVisits = () => [
    { date: '2026-09-25', patientId: 'pt_hx_' + HN, patientName: NAME, weight: '70', hba1c: '6.1', drugs: [{ name: 'Metformin' }], note: NOTE_HN },
    { date: '2026-10-30', patientId: 'pt_hx_' + HN2, patientName: 'ทดสอบ สอง', weight: '80', hba1c: '7.2', drugs: [], note: '' },
  ];
  w.PATIENTS = [{ id: 'pt_hx_' + HN, dx: 'DM', name: NAME, hn: HN }, { id: 'pt_hx_' + HN2, dx: 'DM', name: 'ทดสอบ สอง', hn: HN2 }];
  w.dmCost = () => 0;
  w.eval(src.slice(start, end));
}

// fetch จำลอง: รอบแรก AI ขอเครื่องมือทุกตัว, รอบถัดไปตอบข้อความ — เก็บ body ทุก request
function fakeAi(w, toolUses) {
  const bodies = [];
  let n = 0;
  w.fetch = async (url, opt) => {
    bodies.push(opt.body);
    const content = n++ === 0 ? toolUses.map((t, i) => ({ type: 'tool_use', id: 't' + i, name: t[0], input: t[1] })) : [{ type: 'text', text: 'สรุปแล้ว' }];
    return { ok: true, status: 200, json: async () => ({ content, stop_reason: n === 1 ? 'tool_use' : 'end_turn' }) };
  };
  return bodies;
}

async function ask(w, q) {
  const input = w.document.querySelector('textarea, input[type=text]');
  input.value = q;
  const send = [...w.document.querySelectorAll('button')].find(b => /ส่ง|➤|send/i.test(b.textContent + (b.getAttribute('aria-label') || '')));
  send.click();
  for (let i = 0; i < 50 && !/สรุปแล้ว|❌/.test(w.document.body.textContent); i++) await new Promise(r => setTimeout(r, 10));
}

test('F02: request body ไม่มี HN/ชื่อ/patientId ที่มี HN — config dm-remission จริง ทุกเครื่องมือ', async () => {
  const w = page();
  initDmRemission(w);
  const bodies = fakeAi(w, [
    ['list_datasets', {}],
    ['query_data', { dataset: 'dm_visits', fields: ['date', 'patientId', 'hba1c', 'drugs'] }],
    ['query_data', { dataset: 'dm_patients' }],
    ['query_data', { dataset: 'dm_visits', group_by: ['patientId'], aggregate: { op: 'avg', field: 'hba1c' } }],
    ['export_report', { dataset: 'dm_patients', title: 'รายชื่อ', fields: ['patientId', 'name', 'hn'] }],
  ]);
  await ask(w, 'HbA1c เฉลี่ยรายคน');
  assert.ok(bodies.length >= 2, 'ต้องมีรอบส่งผลเครื่องมือกลับ');
  const all = bodies.join('\n');
  for (const secret of [HN, HN2, NAME, 'ทดสอบ สอง', 'pt_hx_']) assert.ok(!all.includes(secret), 'หลุด: ' + secret);
  // ยังวิเคราะห์รายคนได้ด้วยรหัสแทน
  assert.match(bodies[1], /P001/);
  assert.match(bodies[1], /P002/);
});

test('F02: extraTools ที่คืนค่าจริงออกมาตรงๆ ก็ถูกแทนด้วย [ซ่อน]', async () => {
  const w = page();
  w.AiAssistant.init({
    title: 't', datasets: { v: { label: 'v', rows: () => [{ hn: HN, name: NAME, x: 1 }], private: ['hn', 'name'] } },
    extraTools: [{ name: 'leak', description: 'd', input_schema: { type: 'object', properties: {} }, run: () => ({ text: `คนไข้ ${NAME} HN ${HN}` }) }],
  });
  const r = w.AiAssistant._runTool('leak', {});
  assert.ok(!r.content.includes(HN) && !r.content.includes(NAME), r.content);
  assert.match(r.content, /\[ซ่อน\]/);
});

test('F02: filter ด้วยรหัสแทนยังได้แถวที่ถูกคน', () => {
  const w = page();
  initDmRemission(w);
  w.AiAssistant._runTool('query_data', { dataset: 'dm_patients' });   // กำหนดรหัสแทนตามลำดับที่เห็น
  const r = JSON.parse(w.AiAssistant._runTool('query_data', { dataset: 'dm_visits', filters: [{ field: 'patientId', op: 'eq', value: 'P002' }], fields: ['date', 'hba1c'] }).content);
  assert.equal(r.matched, 1);
  assert.deepEqual(r.rows, [{ date: '2026-10-30', hba1c: 7.2 }]);
});

// ── F06 ──
function exportPage(n) {
  const w = page();
  w.AiAssistant.init({ title: 't', datasets: { r: { label: 'r', rows: () => Array.from({ length: n }, (_, i) => ({ date: '2026-10-01', i })) } } });
  return w;
}
for (const [n, exported, truncated] of [[1, 1, false], [5000, 5000, false], [5001, 5000, true]]) {
  test(`F06: export ${n} แถว → exported ${exported}, truncated ${truncated}`, () => {
    const r = JSON.parse(exportPage(n).AiAssistant._runTool('export_report', { dataset: 'r', title: 'x', fields: ['i'] }).content);
    assert.equal(r.matched, n);
    assert.equal(r.exported, exported);
    assert.equal(r.truncated, truncated);
    if (truncated) assert.match(r.message, /ไม่ครบ/);
  });
}
test('F06: export 0 แถว ไม่สร้างไฟล์', () => {
  const r = JSON.parse(exportPage(0).AiAssistant._runTool('export_report', { dataset: 'r', title: 'x', fields: ['i'] }).content);
  assert.equal(r.ok, false);
});

test('F06: ปุ่มดาวน์โหลดและไฟล์ Excel บอกว่าไม่ครบเมื่อเกิน 5,000 แถว', async () => {
  const w = exportPage(5001);
  let excel = null;
  w.expExcel = (sheets) => { excel = sheets[0].data; };
  fakeAi(w, [['export_report', { dataset: 'r', title: 'ทั้งหมด', fields: ['i'] }]]);
  await ask(w, 'export');
  const dl = w.document.querySelector('.aiw-dl');
  assert.match(dl.textContent, /5000 จาก 5001 แถว — ไม่ครบ/);
  dl.querySelector('button[data-k=excel]').click();
  assert.equal(excel.length, 5001);                       // 5,000 แถวข้อมูล + 1 แถวคำเตือน
  assert.match(Object.values(excel[5000])[0], /ไม่ครบ/);
});
