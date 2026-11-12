// ใบสรุปรายการยา OPD/ER — ข้อมูลสมมติ (HN 9999001) บล็อกเน็ตทั้งหมด ไม่สั่งพิมพ์จริง
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { ROOT } from '../helpers.mjs';

test('สรุปรายการยา OPD: เฉพาะที่ติ๊ก · ดวงละ 6 · วิธีใช้ย่อ · หน้า 101.6×59.9', async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await ctx.addInitScript(() => localStorage.setItem('tph_auth_v1', '1'));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(path.join(ROOT, 'rx-sticker.html')).href); await page.waitForTimeout(500);
  const r = await page.evaluate(() => {
    window.print = () => { window.__printed = (window.__printed || 0) + 1; };
    const items = Array.from({ length: 8 }, (_, k) => ({ guid: 'g' + k, name: 'Drug' + k, strength: '500 mg', units: 'เม็ด', qty: 30,
      line1: 'รับประทานครั้งละ 1 เม็ด', line2: 'วันละ 3 ครั้ง หลังอาหาร เช้า กลางวัน เย็น', line3: '' }));
    CUR = { hn: '9999001', now: '2026-11-12 10:00:00', visits: [{ vn: '691112', date: '2026-11-12', time: '10:00', queue: '5', name: 'นายทดสอบ ระบบ', items }] };
    items.forEach(it => { CHECK[it.guid] = true; COPIES[it.guid] = 1; });
    CHECK.g7 = false; render();
    document.querySelector('button[onclick^="printOpdSum"]').click();
    const stk = [...document.querySelectorAll('#print-area .hmestk')];
    return { n: stk.length, rows: stk.map(s => s.querySelectorAll('tr').length), use: stk[0].querySelector('tr td:nth-child(3)').textContent,
      head: stk[0].querySelector('.hd2').textContent, size: document.getElementById('page-size').textContent };
  });
  await page.waitForTimeout(150);
  assert.equal(r.n, 2);
  assert.deepEqual(r.rows, [6, 1]);
  assert.match(r.use, /1 x 3 pc/);
  assert.match(r.head, /7 รายการ \(1\/2\)/);
  assert.match(r.size, /101\.6mm 59\.9mm/);
  assert.equal(await page.evaluate(() => window.__printed), 1);
  assert.deepEqual(errors, []);
  await browser.close();
});
