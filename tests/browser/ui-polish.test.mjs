// ธีมกลาง + แก้จากรายงานตรวจ UI (2026-11-03): ทุกหน้าโหลด lib/theme.css + lib/tph-ui.js, ปีงบ ME คำนวณจากวันที่,
// สถานะซิงค์ ME/DM ไม่อ้างว่าซิงค์แล้วเมื่อเป็นข้อมูลจาก cache, คีย์บอร์ดใช้การ์ด/เมนูที่เป็น div ได้, contrast ปุ่มทอง
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT } from '../helpers.mjs';

let browser;
test.before(async () => { browser = await chromium.launch(); });
test.after(async () => { await browser.close(); });

async function open(file, viewport = { width: 1366, height: 800 }, now) {
  const ctx = await browser.newContext({ viewport });
  await ctx.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await ctx.addInitScript(t => {
    try { localStorage.setItem('tph_auth_v1', '1'); } catch (e) {}
    if (t) { const T = new Date(t).getTime(), D = Date; window.Date = class extends D { constructor(...a) { super(...(a.length ? a : [T])); } static now() { return T; } }; }
  }, now || null);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(path.join(ROOT, file)).href);
  return { ctx, page, errors };
}

test('ทุกหน้าโหลดธีมกลางและตัวช่วยคีย์บอร์ด', () => {
  const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
  assert.ok(pages.length >= 15);
  for (const f of pages) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.match(s, /<link rel="stylesheet" href="lib\/theme\.css">\s*<\/head>/, f);
    assert.match(s, /<script src="lib\/tph-ui\.js"><\/script>/, f);
  }
});

test('ME: ปีงบประมาณคำนวณจากวันที่ (พ.ย. 2569 = 2570, ก.ย. 2570 = 2570)', async () => {
  for (const [now, fy] of [['2026-11-03T09:00:00+07:00', '2570'], ['2027-09-30T09:00:00+07:00', '2570'], ['2027-10-01T09:00:00+07:00', '2571']]) {
    const { ctx, page, errors } = await open('ME_Dashboard.html', undefined, now);
    await page.waitForFunction(f => document.getElementById('topbar-fy').textContent.includes(f), fy);
    assert.equal(await page.textContent('#nav-year'), fy);
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});

test('ME + DM: ต่อ server ไม่ได้ → ไม่ขึ้น "ซิงค์แล้ว" / "Realtime"', async () => {
  const me = await open('ME_Dashboard.html');
  await me.page.waitForFunction(() => document.getElementById('fb-sync-badge'), null, { timeout: 25000 }).catch(() => {});
  await me.page.waitForTimeout(12000);
  const meTxt = await me.page.evaluate(() => (document.getElementById('fb-sync-badge') || {}).textContent || '');
  assert.doesNotMatch(meTxt, /ซิงค์แล้ว/);
  await me.ctx.close();
  const dm = await open('dm-remission.html');
  await dm.page.waitForTimeout(12000);
  assert.doesNotMatch(await dm.page.textContent('#sync-status-btn'), /Realtime/);
  await dm.ctx.close();
});

test('คีย์บอร์ด: การ์ด OPD ใน ME กด Enter เข้าแผนก · การ์ดกรองสถานะ expiry และหัวตารางกด Tab เข้าได้ · ยาเหลือสะสม clinic กด Space ติ๊ก', async () => {
  const me = await open('ME_Dashboard.html');
  await me.page.waitForSelector('.landing-card[tabindex="0"][role="button"]');
  await me.page.focus('.landing-card');
  await me.page.keyboard.press('Enter');
  await me.page.waitForFunction(() => document.getElementById('section-opd').classList.contains('active'));
  assert.equal(await me.page.getAttribute('#nav-ipd', 'tabindex'), '0');
  assert.deepEqual(me.errors, []);
  await me.ctx.close();

  const ex = await open('expiry-tracker.html');
  await ex.page.waitForSelector('.kpi-card[tabindex="0"]');
  assert.equal(await ex.page.getAttribute('th[onclick]', 'tabindex'), '0');
  await ex.ctx.close();

  const cl = await open('clinic.html');
  await cl.page.focus('#drp-quick-label');
  await cl.page.keyboard.press(' ');
  assert.equal(await cl.page.getAttribute('#drp-quick-label', 'aria-checked'), 'true');
  assert.equal(await cl.page.textContent('#drp-quick-icon'), '☑');
  assert.deepEqual(cl.errors, []);
  await cl.ctx.close();
});

test('contrast: ปุ่มทองใช้ตัวเขียวเข้ม · หัวกลุ่มแถบซ้ายไม่จางเกิน', async () => {
  const { ctx, page } = await open('rx-sticker.html');
  assert.equal(await page.evaluate(() => { const b = document.createElement('button'); b.className = 'btn btn-gold'; document.body.appendChild(b); return getComputedStyle(b).color; }), 'rgb(13, 51, 32)');
  await ctx.close();
  const c = await open('clinic.html');
  const col = await c.page.evaluate(() => getComputedStyle(document.querySelector('.tph-lbl')).color);
  const a = +((col.match(/rgba\([^)]*,\s*([\d.]+)\)/) || [])[1] || 1);
  assert.ok(a >= 0.6, col);
  await c.ctx.close();
});

test('หน้าหลัก: ปุ่ม "เปิดระบบ" เขียวสีเดียวทุกการ์ด · หัวขาว · การ์ด 4 ใบต่อแถวบนจอคอม', async () => {
  const { ctx, page, errors } = await open('index.html');
  const r = await page.evaluate(() => ({
    btn: [...new Set([...document.querySelectorAll('.open-btn')].map(b => getComputedStyle(b).backgroundColor))],
    hd: getComputedStyle(document.querySelector('.header')).backgroundColor,
    cols: getComputedStyle([...document.querySelectorAll('.cards-grid')].find(g => g.offsetWidth)).gridTemplateColumns.split(' ').length,   // กลุ่มรายการโปรดที่ว่างซ่อนอยู่
    n: document.querySelectorAll('.open-btn').length,
  }));
  assert.deepEqual(r.btn, ['rgb(26, 94, 56)']); assert.ok(r.n >= 10);
  assert.equal(r.hd, 'rgb(255, 255, 255)'); assert.equal(r.cols, 4);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('คลินิก: แถบ ล้างฟอร์ม/บันทึก ติดท้ายจอระหว่างเลื่อนฟอร์ม · หัวข้อมีเลข 1-3 · ปุ่มล้างฟอร์มยังทำงาน', async () => {
  const { ctx, page, errors } = await open('clinic.html', { width: 1408, height: 614 });
  await page.waitForSelector('.cl-savebar .btn-submit');
  const nums = await page.$$eval('.entry-col > .form-title, .lo-section-wrap > .form-title', a => a.map(e => getComputedStyle(e, '::before').content));
  assert.deepEqual(nums, Array(3).fill('counter(clsec)'));   // 3 หัวข้อมีเลขลำดับ (ภาพจริงขึ้น 1 2 3)
  // เลื่อนไปกลางฟอร์ม: ปุ่มบันทึกอยู่ในจอ (ติดล่าง)
  await page.evaluate(() => scrollTo(0, 300));
  const b = await page.evaluate(() => { const r = document.querySelector('.cl-savebar .btn-submit').getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
  assert.ok(b.bottom <= 614 && b.top > 450, JSON.stringify(b));
  await page.fill('#f-hn', '9999001');
  await page.click('.cl-savebar .btn-clear');
  await page.waitForFunction(() => document.getElementById('f-hn').value === '');
  assert.deepEqual(errors, []);
  await ctx.close();
});
