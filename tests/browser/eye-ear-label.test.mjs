// ฉลากเสริมวิธีหยอดตา/ป้ายตา/หยอดหู — ตรวจชนิดยา · ข้าง · ปุ่มในแถว · พิมพ์ต่อท้ายอัตโนมัติ · ไม่ล้นดวง
// ข้อมูลสมมติทั้งหมด (HN 9999xxx)
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { ROOT } from '../helpers.mjs';

test('ฉลากเสริมตา/หู: detect + ปุ่ม + พิมพ์ + layout', async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await ctx.addInitScript(() => localStorage.setItem('tph_auth_v1', '1'));
  try {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(ROOT, 'rx-sticker.html')).href); await page.waitForTimeout(500);
    await page.evaluate(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });

    const det = await page.evaluate(() => [
      TphEyeEar.detect({ name: 'Chloramphenicol eye drop', line1: 'หยอดตาขวา ครั้งละ 1 หยด', line2: 'วันละ 4 ครั้ง' }),
      TphEyeEar.detect({ name: 'Chlortetracycline eye oint. 1%', line1: 'ป้ายตาทั้ง 2 ข้าง ก่อนนอน' }),
      TphEyeEar.detect({ name: 'Ciprofloxacin ear drop', line1: 'หยอดหูซ้าย ครั้งละ 3 หยด' }),
      TphEyeEar.detect({ name: 'Artificial tears eye drop', line1: 'ครั้งละ 1 หยด วันละ 4 ครั้ง' }),
      TphEyeEar.detect({ name: 'Tetracycline eye ointment', line1: 'วันละ 2 ครั้ง' }),
      TphEyeEar.detect({ name: 'Paracetamol 500 mg', line1: 'รับประทานครั้งละ 1 เม็ด' }),
      TphEyeEar.side('หยอดตาขวา'), TphEyeEar.side('หยอดตาทั้ง 2 ข้าง'), TphEyeEar.side('หยอดหูซ้าย'), TphEyeEar.side('วันละ 4 ครั้ง'),
    ]);
    assert.deepEqual(det, ['eye', 'eyeoint', 'ear', 'eye', 'eyeoint', null, 'R', 'B', 'L', '']);

    await page.evaluate(() => {
      localStorage.removeItem('rx_eyeear_auto');
      CUR = { hn: '9999002', now: '2026-11-17 10:00:00', visits: [{ vn: '1', name: 'นางทดสอบ ระบบตา', date: '2026-11-17', time: '09:00', items: [
        { guid: 'p', name: 'Paracetamol', strength: '500 mg', line1: 'รับประทานครั้งละ 1 เม็ด', line2: '', line3: '' },
        { guid: 'e', name: 'Chloramphenicol eye drop', strength: '0.5%', units: 'ขวด', qty: 1, line1: 'หยอดตาขวา ครั้งละ 1 หยด', line2: 'วันละ 4 ครั้ง', line3: '', hint: 'เก็บในตู้เย็น' },
        { guid: 'a', name: 'Ciprofloxacin ear drop', units: 'ขวด', qty: 1, line1: 'หยอดหูซ้าย ครั้งละ 3 หยด', line2: 'วันละ 2 ครั้ง', line3: '' }] }] };
      CHECK.p = CHECK.e = CHECK.a = true; COPIES.p = COPIES.e = COPIES.a = 1; render();
    });
    assert.equal(await page.locator('#detail button[onclick^="printEe"]').count(), 2);

    // ปุ่ม 👁 แถวเดียว → ฉลากเสริม 1 ดวง ข้างขวา + ตู้เย็นติ๊ก
    const one = await page.evaluate(() => { printEe(['e']); const s = document.querySelectorAll('#print-area .eestk');
      return { n: s.length, on: [...s[0].querySelectorAll('.bx.on')].map(b => b.nextSibling.textContent.trim().slice(0, 4)), txt: s[0].textContent }; });
    assert.equal(one.n, 1);
    assert.deepEqual(one.on, ['ขวา', 'เก็บ']);
    assert.match(one.txt, /9999002/); assert.match(one.txt, /1 เดือน/);

    // พิมพ์ต่อท้ายอัตโนมัติ: เฉพาะยาตา/หู
    await page.evaluate(() => setEeAuto(true));
    const auto = await page.evaluate(() => { printItems(['p', 'e', 'a']); return [...document.querySelectorAll('#print-area > div')].map(d => d.className); });
    assert.deepEqual(auto, ['stk', 'stk', 'eestk ee-eye', 'stk', 'eestk ee-ear']);
    await page.evaluate(() => setEeAuto(false));

    // ฉลากเปล่า 3 แบบในแท็บฉลากเปล่า · ไม่มีอะไรล้นกรอบ
    await page.evaluate(() => setView('blank'));
    assert.equal(await page.locator('#ee-prev .eestk').count(), 3);
    if (process.env.SHOT) await page.locator('#ee-prev').screenshot({ path: process.env.SHOT });
    const over = await page.evaluate(() => [...document.querySelectorAll('#ee-prev .in')].map(b => {
      const r = b.getBoundingClientRect();
      return [...b.querySelectorAll('*')].filter(c => c.getBoundingClientRect().bottom > r.bottom + 0.5 || c.getBoundingClientRect().right > r.right + 0.5).map(c => c.className || c.tagName);
    }));
    assert.deepEqual(over, [[], [], []]);
    await page.evaluate(() => { document.getElementById('ee-n').value = 4; document.querySelectorAll('#ee-prev label')[2].click(); printEeBlank(); });
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#print-area .eestk.ee-ear').count(), 4);
    assert.ok(await page.evaluate(() => window.__printed >= 3));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
