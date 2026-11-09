// แก้วิธีใช้ก่อนพิมพ์สติกเกอร์ OPD/ER — ข้อมูลสมมติ (HN 9999001) บล็อกเน็ตทั้งหมด ไม่สั่งพิมพ์จริง
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { ROOT } from '../helpers.mjs';

let browser;
test.before(async () => { browser = await chromium.launch(); });
test.after(async () => { await browser.close(); });

test('แก้วิธีใช้ → สติกเกอร์พิมพ์ตามที่แก้ · จำหลังรีโหลด · ↺ กลับตาม HOSxP', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await ctx.addInitScript(() => localStorage.setItem('tph_auth_v1', '1'));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const url = pathToFileURL(path.join(ROOT, 'rx-sticker.html')).href;
  const setup = () => page.evaluate(() => {
    window.print = () => { window.__printed = (window.__printed || 0) + 1; };
    CUR = { hn: '9999001', now: '2026-11-09 10:00:00', visits: [{ vn: '1', date: '2026-11-09', time: '10:00', queue: '1', name: 'นายทดสอบ ระบบ', items: [
      { guid: 'g1', name: 'Paracetamol 500 mg', qty: 10, line1: 'รับประทานครั้งละ 1 เม็ด', line2: 'ทุก 4-6 ชั่วโมง เวลาปวด', line3: '', thaiName: '-' },
    ] }] };
    CHECK.g1 = true; COPIES.g1 = 1; render();
  });
  const usage = () => page.evaluate(() => { printItems(['g1']); return [...document.querySelectorAll('#print-area .stk .bw.c.b')].map(e => e.textContent); });

  await page.goto(url); await page.waitForTimeout(500); await setup();
  await page.click('text=✏️ แก้วิธีใช้');
  await page.fill('#ue-g1-0', 'รับประทานครั้งละ 2 เม็ด');
  await page.fill('#ue-g1-1', 'ทุก 6 ชั่วโมง เวลาปวดหรือมีไข้');
  await page.click('text=✓ ใช้วิธีใช้นี้');
  assert.deepEqual(await usage(), ['รับประทานครั้งละ 2 เม็ด', 'ทุก 6 ชั่วโมง เวลาปวดหรือมีไข้', '']);
  assert.match(await page.textContent('td.use'), /แก้แล้ว/);
  assert.match(await page.textContent('td.use .use-was'), /ทุก 4-6 ชั่วโมง/);

  await page.reload(); await page.waitForTimeout(500); await setup();
  assert.equal((await usage())[0], 'รับประทานครั้งละ 2 เม็ด');

  await page.click('text=↺ ตาม HOSxP');
  assert.deepEqual(await usage(), ['รับประทานครั้งละ 1 เม็ด', 'ทุก 4-6 ชั่วโมง เวลาปวด', '']);
  assert.doesNotMatch(await page.textContent('td.use'), /แก้แล้ว/);
  assert.deepEqual(errors, []);
  await ctx.close();
});
