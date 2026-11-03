// แถบหัวขาวแบบเดียว (lib/tph-header.js): หัวเดิมซ่อน ของจริงย้ายมาครบ (id เดิม), เมนูเครื่องมือเพิ่มเติมเปิด/ปิด/กดแล้วทำงาน, แถบซ้ายติดใต้หัว
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT } from '../helpers.mjs';

const PAGES = ['clinic.html', 'adr.html', 'dm-remission.html', 'expiry-tracker.html', 'insurance.html', 'insurance-audit.html',
  'night-meds.html', 'rx-sticker.html', 'pharmacy-ha.html', 'waiting-time.html', 'admin-error-ipd.html'];
let browser;
test.before(async () => { browser = await chromium.launch(); });
test.after(async () => { await browser.close(); });
async function open(file, viewport = { width: 1366, height: 800 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem('tph_auth_v1', '1'); } catch (e) {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(path.join(ROOT, file)).href);
  await page.waitForSelector('.tph-hd');
  return { ctx, page, errors };
}

for (const f of PAGES) {
  test(`${f}: หัวขาวแบบเดียว อยู่บนสุด หัวเดิมซ่อน ชื่อหน้าอยู่ในหัวใหม่`, async () => {
    const { ctx, page, errors } = await open(f);
    const r = await page.evaluate(() => {
      const hd = document.querySelector('.tph-hd'), b = hd.getBoundingClientRect();
      return { top: b.top, bg: getComputedStyle(hd).backgroundColor, h: b.height, title: (hd.querySelector('.tph-hd-h') || {}).textContent || '',
        oldHidden: [...document.querySelectorAll('.tph-hd-old')].every(e => getComputedStyle(e).display === 'none'), n: document.querySelectorAll('.tph-hd').length };
    });
    assert.equal(r.n, 1); assert.equal(r.top, 0); assert.equal(r.bg, 'rgb(255, 255, 255)'); assert.ok(r.title.trim().length > 3, r.title);
    assert.ok(r.h >= 60 && r.h <= 80, 'สูง ' + r.h); assert.equal(r.oldHidden, true);
    // แถบซ้ายเริ่มใต้หัว
    const side = await page.evaluate(() => { const s = document.querySelector('.tph-side'); return s && getComputedStyle(s).display !== 'none' ? s.getBoundingClientRect().top : null; });
    if (side !== null) assert.ok(Math.abs(side - r.h) <= 2, `side ${side} hd ${r.h}`);
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

test('clinic: ปุ่มรองรวมในเมนู "เครื่องมือเพิ่มเติม" — เปิด/Esc ปิด/กดรายการแล้วปุ่มเดิมทำงาน + เมนูปิด', async () => {
  const { ctx, page, errors } = await open('clinic.html');
  assert.equal(await page.locator('.tph-hd-menu .tph-hd-mi').count(), 8);
  assert.equal(await page.isVisible('.tph-hd-menu'), false);
  await page.click('.tph-hd-morebtn');
  assert.equal(await page.isVisible('.tph-hd-menu'), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.isVisible('.tph-hd-menu'), false);
  await page.click('.tph-hd-morebtn');
  await page.click('.tph-hd-menu >> text=ทะเบียนผู้ป่วย');
  await page.waitForFunction(() => getComputedStyle(document.getElementById('pt-modal')).display !== 'none');
  assert.equal(await page.isVisible('.tph-hd-menu'), false);
  // ป้ายซิงค์ (id เดิม) อยู่ในหัวใหม่ — สคริปต์ของหน้ายังอัปเดตได้
  assert.equal(await page.evaluate(() => !!document.querySelector('.tph-hd #sync-badge')), true);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('insurance: ปุ่มประมวลผลเป็นปุ่มหลักเขียว · ปีงบ/ไตรมาสอยู่ในหัว · หัวไม่ติดบนจอ (แถบซ้ายของหน้าติดบนสุดเอง)', async () => {
  const { ctx, page, errors } = await open('insurance.html');
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('run-btn')).backgroundColor), 'rgb(26, 94, 56)');
  assert.equal(await page.evaluate(() => !!document.querySelector('.tph-hd #fy') && !!document.querySelector('.tph-hd #qtr')), true);
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector('.tph-hd')).position), 'sticky');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('มือถือ: หัวไม่ติดบนจอ ไม่ล้นจอ', async () => {
  for (const f of ['clinic.html', 'insurance.html', 'adr.html']) {
    const { ctx, page } = await open(f, { width: 390, height: 844 });
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.tph-hd')).position), 'relative', f);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, f);
    await ctx.close();
  }
});
