// แถบหัวข้อด้านซ้าย (lib/side-tabs.js) ทุกหน้าที่มี tab ย่อย — ปุ่มซ้ายกดแล้วทำงานเหมือนปุ่ม tab เดิม, tab เดิมถูกซ่อน,
// สถานะ "เลือกอยู่" ตามกัน, ไม่มี id ซ้ำ, มือถือเป็นแถบเลื่อนแนวนอนไม่ล้นจอ (บล็อกทุก request ออกเน็ต)
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT } from '../helpers.mjs';

// [หน้า, ลำดับปุ่มที่จะกด, ตรวจว่าเปลี่ยนจริง]
const PAGES = [
  ['rx-sticker.html', 3, () => document.getElementById('view-hme').style.display === ''],
  ['adr.html', 1, () => document.querySelectorAll('.tab-bar .tab-btn')[1].classList.contains('active')],
  ['waiting-time.html', 0, () => document.getElementById('tab-cart').classList.contains('active')],
  ['pharmacy-ha.html', 1, () => document.querySelector('#tabs [data-v="rdu"]').getAttribute('aria-selected') === 'true'],
  ['insurance-audit.html', 1, () => document.querySelector('.tabs [data-tab="docs"]').classList.contains('active')],
  ['dm-remission.html', 1, () => getComputedStyle(document.getElementById('page-patients')).display !== 'none'],
  ['clinic.html', 1, () => document.getElementById('view-report').style.display === 'block'],
  ['night-meds.html', 1, () => document.getElementById('view-sum').style.display === ''],
];

let browser;
test.before(async () => { browser = await chromium.launch(); });
test.after(async () => { await browser.close(); });

async function open(file, viewport) {
  const ctx = await browser.newContext({ viewport });
  await ctx.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem('tph_auth_v1', '1'); localStorage.removeItem('rx_sticker_view'); } catch (e) {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(path.join(ROOT, file)).href);
  await page.waitForSelector('.tph-side', { state: 'attached' });
  if (file === 'night-meds.html') await page.evaluate(() => { document.getElementById('result').style.display = ''; });
  return { ctx, page, errors };
}

for (const [file, idx, changed] of PAGES) {
  test(`${file}: tab ย่อยอยู่แถบซ้าย กดแล้วเปลี่ยนหน้าเหมือนปุ่มเดิม`, async () => {
    const { ctx, page, errors } = await open(file, { width: 1366, height: 800 });
    await page.waitForSelector('.tph-grp:not([hidden]) .tph-it:not([hidden])');   // night-meds: กลุ่มขึ้นหลังมีผลลัพธ์
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.tph-src-hidden')].every(e => getComputedStyle(e).display === 'none')), true);
    const side = await page.locator('.tph-side').boundingBox();
    assert.ok(side.x < 5 && side.width > 200, 'แถบอยู่ซ้ายสุด');
    await page.locator('.tph-grp').first().locator('.tph-it').nth(idx).click();
    await page.waitForFunction(changed);
    await page.waitForFunction(i => document.querySelector('.tph-grp').querySelectorAll('.tph-it')[i].classList.contains('on'), idx);
    // ไม่มี id ซ้ำ (สำเนาในแถบซ้ายต้องไม่พา id มาด้วย)
    assert.deepEqual(await page.evaluate(() => { const c = {}; document.querySelectorAll('[id]').forEach(e => c[e.id] = (c[e.id] || 0) + 1); return Object.keys(c).filter(k => c[k] > 1); }), []);
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

test('มือถือ: แถบซ้ายเป็นแถบปุ่มเลื่อนแนวนอน ไม่ล้นจอ', async () => {
  for (const file of ['rx-sticker.html', 'clinic.html', 'pharmacy-ha.html']) {
    const { ctx, page, errors } = await open(file, { width: 390, height: 844 });
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.tph-side')).flexDirection), 'row', file);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, file);
    assert.deepEqual(errors, [], file);
    await ctx.close();
  }
});

test('clinic.html: กลุ่ม "คลินิก" แสดงตอนบันทึก · กลุ่ม "รายงาน" (สร้างใหม่ทุกครั้ง) แสดงตอนดูรายงาน', async () => {
  const { ctx, page, errors } = await open('clinic.html', { width: 1366, height: 800 });
  const vis = () => page.$$eval('.tph-grp', gs => gs.map(g => (g.querySelector('.tph-lbl') || {}).textContent + ':' + !g.hidden));
  assert.deepEqual(await vis(), ['undefined:true', 'คลินิก:true', 'รายงาน:false']);
  await page.locator('.tph-it', { hasText: 'รายงาน & สถิติ' }).click();
  await page.waitForFunction(() => !document.querySelectorAll('.tph-grp')[2].hidden);
  assert.deepEqual(await vis(), ['undefined:true', 'คลินิก:false', 'รายงาน:true']);
  await page.locator('.tph-grp').nth(2).locator('.tph-it', { hasText: 'ยาคงเหลือ' }).click();
  await page.waitForFunction(() => window.reportView === 'leftover');
  await page.waitForFunction(() => [...document.querySelectorAll('.tph-grp')[2].querySelectorAll('.tph-it')].find(e => /ยาคงเหลือ/.test(e.textContent)).classList.contains('on'));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('แถบติดใต้หัวหน้าพอดี (DM มือถือ: ไม่เว้นช่องว่างเหนือแถบ ไม่นับ modal ที่ fixed เป็นหัว)', async () => {
  const { ctx, page, errors } = await open('dm-remission.html', { width: 390, height: 844 });
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => ({ hh: document.querySelector('.app-header').offsetHeight, top: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tph-top')) }));
  assert.equal(r.top, r.hh);
  assert.deepEqual(errors, []);
  await ctx.close();
});
