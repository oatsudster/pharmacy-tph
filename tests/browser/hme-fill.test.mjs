// สรุปยากลับบ้าน (HMe) ใส่เต็มดวง 9×6 — ข้อมูลสมมติ บล็อกเน็ตทั้งหมด ไม่สั่งพิมพ์จริง
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { ROOT } from '../helpers.mjs';

test('ยากลับบ้าน 9 รายการ → ดวงเดียว (เดิม 6+3) · 16 รายการ → 2 ดวง', async () => {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await ctx.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
    await ctx.addInitScript(() => { localStorage.setItem('tph_auth_v1', '1'); window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(ROOT, 'rx-sticker.html')).href); await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const D = [['Doxazosin', '4 mg', 'รับประทานครั้งละ 1 เม็ด', 'วันละ 1 ครั้ง ก่อนนอน', 1],
        ['Hydralazine', '25 mg', 'รับประทานครั้งละ 1 เม็ด', 'วันละ 4 ครั้ง หลังอาหาร เช้า กลางวัน เย็น และก่อนนอน', 1],
        ['Sodium bicarbonate', '300 mg', 'รับประทานครั้งละ 1 เม็ด', 'วันละ 3 ครั้ง หลังอาหาร เช้า กลางวัน เย็น', 1],
        ['Oseltamivir', '30 mg', 'รับประทานครั้งละ 1 เม็ด', 'วันละ 2 ครั้ง หลังอาหาร เช้า เย็น', 2],
        ['Theophylline SR', '200 mg', 'รับประทานครั้งละ 1 เม็ด', 'วันละ 1 ครั้ง หลังอาหาร', 20],
        ['Prednisolone', '5 mg', 'รับประทานครั้งละ 3 เม็ด', 'วันละ 2 ครั้ง หลังอาหาร เช้า เย็น', 18],
        ['Cetirizine', '10 mg', 'รับประทานครั้งละ 1 เม็ด', 'วันละ 1 ครั้ง ก่อนนอน', 10],
        ['Amlodipine', '5 mg', 'รับประทานครั้งละ 1 เม็ด', 'วันละ 1 ครั้ง หลังอาหารเช้า', 30],
        ['Simvastatin', '20 mg', 'รับประทานครั้งละ 1 เม็ด', 'วันละ 1 ครั้ง ก่อนนอน', 30]];
      const mk = (an, n) => ({ an, hn: '9999001', name: 'นายทดสอบ ระบบ', orderNo: an, type: 'HMe', date: '2026-11-20', time: '10:00', dchdate: '2026-11-20', ward: 'ผู้ป่วยใน', bed: '02',
        items: Array.from({ length: n }, (_, k) => { const d = D[k % D.length]; return { icode: String(k), name: d[0], strength: d[1], units: 'เม็ด', qty: d[4], line1: d[2], line2: d[3], line3: '' }; }) });
      const a = hmeLayout(mk('1', 9)), b = hmeLayout(mk('2', 16));
      const minFs = L => Math.min(L.fs, ...L.pages.flat().map(x => x[3] || 99));
      return { a: a.pages.map(p => p.length), aFs: minFs(a), b: b.pages.map(p => p.length), bFs: minFs(b) };
    });
    assert.deepEqual(r.a, [9]);
    assert.ok(r.aFs >= 6.5, 'font ' + r.aFs);
    assert.equal(r.b.length, 2);
    assert.ok(r.bFs >= 6.5, 'font ' + r.bFs);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
