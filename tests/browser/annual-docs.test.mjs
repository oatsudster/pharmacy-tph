// งานเอกสารประจำปี (annual-docs.html): แถบซ้าย 3 กลุ่ม, คำสั่งพิมพ์ได้ตามรูปแบบต้นฉบับ, แจ้งเตือนตามกำหนด (บล็อกทุก request ออกเน็ต)
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT } from '../helpers.mjs';

let browser;
test.before(async () => { browser = await chromium.launch(); });
test.after(async () => { await browser.close(); });

async function open(state) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await ctx.addInitScript((st) => {
    localStorage.setItem('tph_auth_v1', '1');
    if (st) localStorage.setItem('tph_annual_docs_v1', JSON.stringify(st)); else localStorage.removeItem('tph_annual_docs_v1');
    window.print = () => { window.__printed = (window.__printed || 0) + 1; };
  }, state || null);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(path.join(ROOT, 'annual-docs.html')).href);
  await page.waitForSelector('.tph-side .tph-it');
  return { ctx, page, errors };
}

test('แถบซ้าย: กำหนดการ / งาน คบส. / งานวัคซีน — กดแล้วเปิดเอกสาร, ไม่มี id ซ้ำ', async () => {
  const { ctx, page, errors } = await open();
  const labels = await page.$$eval('.tph-grp', gs => gs.map(g => (g.querySelector('.tph-lbl') || {}).textContent || ''));
  assert.deepEqual(labels, ['', 'งาน คบส.', 'งานวัคซีน']);
  await page.locator('.tph-grp').nth(1).locator('.tph-it').first().click();
  await page.waitForFunction(() => document.getElementById('v-kbs_order').classList.contains('on'));
  await page.waitForSelector('#v-kbs_order .paper .doc');
  await page.locator('.tph-grp').nth(2).locator('.tph-it').nth(2).click();
  await page.waitForFunction(() => document.getElementById('v-vac_chart').classList.contains('on'));
  assert.deepEqual(await page.evaluate(() => { const c = {}; document.querySelectorAll('[id]').forEach(e => c[e.id] = (c[e.id] || 0) + 1); return Object.keys(c).filter(k => c[k] > 1); }), []);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('คำสั่ง คบส.: แก้ปี/ชื่อแล้วตัวอย่างเปลี่ยน, เลขไทย, พิมพ์ 1 หน้า A4 ตามขอบต้นฉบับ', async () => {
  const { ctx, page, errors } = await open();
  await page.evaluate(() => document.querySelector('[data-v="kbs_order"]').click());
  await page.waitForSelector('#v-kbs_order .paper .doc');
  await page.fill('#v-kbs_order [data-f="signYear"]', '2570');
  await page.selectOption('#v-kbs_order select[data-f="signMonth"]', '11');
  // คำนำหน้าเลือกจากรายการ + ชื่อ → เก็บรวม "นายทดสอบ"; ชื่อเดิม "นางสาวเกษราภรณ์" แยกเป็น นางสาว + เกษราภรณ์
  const first = page.locator('#v-kbs_order .mgrid').first();
  assert.equal(await first.locator('[data-pfx]').inputValue(), 'นางสาว');
  assert.equal(await first.locator('[data-name]').inputValue(), 'เกษราภรณ์');
  await first.locator('[data-pfx]').selectOption('นาย');
  await first.locator('[data-name]').fill('ทดสอบ');
  assert.equal(await page.evaluate(() => TphAnnualDocs.state.kbs_order.teams[0].members[0][0]), 'นายทดสอบ');
  await page.waitForFunction(() => /๒๕๗๐/.test(document.querySelector('#v-kbs_order .paper').textContent) && /นายทดสอบ/.test(document.querySelector('#v-kbs_order .paper').textContent));
  await page.locator('#v-kbs_order [data-print]').click();
  await page.waitForFunction(() => window.__printed === 1);
  assert.match(await page.textContent('#page-style'), /size: A4 portrait; margin: 1cm 1.95cm 0.25cm 2.54cm/);
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ preferCSSPageSize: true });
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  assert.equal(pages, 1, 'คำสั่ง คบส. ต้องพอดี 1 หน้าเหมือนต้นฉบับ');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('แจ้งเตือน: ใกล้ครบกำหนด → แถบเหลือง, เลยกำหนด → แถบแดง, ทำเสร็จแล้ว → หาย', async () => {
  const now = new Date(); const fy = now.getFullYear() + 543 + (now.getMonth() >= 9 ? 1 : 0);
  const soon = new Date(now.getTime() + 5 * 864e5), past = new Date(now.getTime() - 3 * 864e5);
  const sch = (d) => ({ day: d.getDate(), month: d.getMonth() + 1, lead: 14, doneFy: fy - 1, doneAt: '' });
  // ข้ามกรณีวันใกล้รอยต่อปีงบ (กำหนดจะตกไปอีกปีงบ)
  if (fyOf(soon) !== fy || fyOf(past) !== fy) return;
  const { ctx, page, errors } = await open({ schedule: { kbs_order: sch(soon), vac_order: sch(past), vac_plan: { day: 1, month: 9, lead: 14, doneFy: fy, doneAt: '' } } });
  await page.waitForSelector('#alerts .alert');
  assert.equal(await page.locator('#alerts .alert.warn').count(), 1);
  assert.equal(await page.locator('#alerts .alert.bad').count(), 1);
  await page.locator('#ov-cards [data-done="vac_order"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#alerts .alert').length === 1);
  assert.deepEqual(errors, []);
  await ctx.close();
  function fyOf(d) { return d.getFullYear() + 543 + (d.getMonth() >= 9 ? 1 : 0); }
});
