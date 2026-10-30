// ฉลากยารูปภาพในหน้าพิมพ์สติกเกอร์ยา — ข้อมูลสมมติ (HN 9999001) บล็อกเน็ตทั้งหมด ไม่สั่งพิมพ์จริง
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { ROOT } from '../helpers.mjs';

let browser;
test.before(async () => { browser = await chromium.launch(); });
test.after(async () => { await browser.close(); });

async function run(picHns, setup) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await ctx.addInitScript(h => { localStorage.setItem('tph_auth_v1', '1'); localStorage.setItem('rx_pic_hns', JSON.stringify(h)); }, picHns);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (setup) await setup();
  await page.goto(pathToFileURL(path.join(ROOT, 'rx-sticker.html')).href);
  await page.waitForTimeout(800);
  const out = await page.evaluate(() => {
    window.print = () => { window.__printed = (window.__printed || 0) + 1; };
    const it = (guid, l1, l2) => ({ guid, name: 'ยาทดสอบ ' + guid, qty: 10, line1: l1, line2: l2, line3: '', thaiName: '-' });
    CUR = { hn: '9999001', now: '2026-10-30 10:00:00', visits: [{ vn: '1', date: '2026-10-30', time: '10:00', queue: '1', name: 'นายทดสอบ ระบบ', items: [
      it('a', 'รับประทานครั้งละ 2 เม็ด', 'วันละ 2 ครั้ง หลังอาหาร เช้า-เย็น'),
      it('b', 'รับประทานครั้งละ 1 เม็ด', 'วันเว้นวัน'),
    ] }] };
    CHECK.a = CHECK.b = true; COPIES.a = COPIES.b = 1;
    render();
    printItems(['a', 'b']);
    const pa = document.getElementById('print-area');
    return {
      order: [...pa.children].map(c => c.className),
      pills: [...pa.querySelectorAll('.pstk .pcol.on .pills')].map(p => p.querySelectorAll('.pic').length),
      imgs: [...pa.querySelectorAll('.pstk img')].map(i => i.getAttribute('src')),
      table: [...document.querySelectorAll('td.use .pic-ok, td.use .pic-warn')].map(e => e.textContent),
    };
  });
  await page.waitForTimeout(300);
  out.printed = await page.evaluate(() => window.__printed || 0);
  out.errors = errors;
  await ctx.close();
  return out;
}

test('เปิดฉลากรูปภาพ: ดวงภาพต่อท้ายฉลากปกติของยานั้น · ยาวันเว้นวันไม่มีดวงภาพ + เตือนในตาราง', async () => {
  const r = await run(['9999001']);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.order, ['stk', 'pstk', 'stk']);
  assert.deepEqual(r.pills, [2, 2]);                 // เช้า 2 เม็ด, เย็น 2 เม็ด
  assert.match(r.table.join(' | '), /🖼️ หลังอาหาร · เช้า · เย็น · 2 เม็ด/);
  assert.match(r.table.join(' | '), /ทำฉลากภาพไม่ได้ \(วันเว้นวัน\)/);
  assert.equal(r.printed, 1);
});

test('ไม่ได้เปิดฉลากรูปภาพ (HN อื่น) → พิมพ์ฉลากปกติเหมือนเดิม', async () => {
  const r = await run(['9999002']);
  assert.deepEqual(r.order, ['stk', 'stk']);
  assert.deepEqual(r.table, []);
});

test('มีไฟล์ img/picto/morning.png → ใช้รูปนั้นแทนไอคอนพื้นฐาน', async () => {
  const f = path.join(ROOT, 'img/picto/morning.png');
  const existed = fs.existsSync(f);
  // PNG 1×1 ขาว (ไฟล์ทดสอบชั่วคราว — ลบทิ้งท้ายเทสต์ ถ้ามีไฟล์จริงอยู่แล้วไม่แตะ)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
  try {
    const r = await run(['9999001'], async () => { if (!existed) fs.writeFileSync(f, png); });
    assert.ok(r.imgs.includes('img/picto/morning.png'), JSON.stringify(r.imgs));
  } finally { if (!existed) fs.rmSync(f, { force: true }); }
});
