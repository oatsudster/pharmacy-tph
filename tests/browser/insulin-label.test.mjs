// ฉลากภาพอินซูลิน 9×6 — อ่านขนาดจากวิธีใช้ HOSxP · ดวงละ 2 มื้อ · ลูกสูบตรงขีด · เกินกระบอก = พิมพ์ไม่ได้ · ไม่ล้นดวง
// ข้อมูลสมมติทั้งหมด (HN 9999xxx)
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { ROOT } from '../helpers.mjs';

test('ฉลากภาพอินซูลิน: parse + layout + print 90×60', async () => {
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

    // วิธีใช้แบบ HOSxP → ขนาดแต่ละมื้อ
    const parsed = await page.evaluate(() => [
      insParse(['ฉีดเข้าใต้ผิวหนัง 16 ยูนิต ก่อนอาหารเช้า', '8 ยูนิต ก่อนอาหารเย็น', '']),
      insParse(['ฉีดเข้าใต้ผิวหนัง ก่อนนอน 10 ยูนิต', '', '']),
      insParse(['ฉีดตามแพทย์สั่ง', '', '']),
    ]);
    assert.deepEqual(parsed, [[16, 0, 8, 0], [0, 0, 0, 10], null]);

    // มาจากแท็บ OPD (ปุ่ม 💉) — ใบสั่งสมมติ
    await page.evaluate(() => {
      CUR = { hn: '9999001', now: '2026-11-13 10:00:00', visits: [{ vn: '1', name: 'นายทดสอบ ระบบ', date: '2026-11-13', time: '09:00', items: [
        { guid: 'g1', name: 'Paracetamol', strength: '500 mg', line1: 'รับประทานครั้งละ 1 เม็ด', line2: '', line3: '' },
        { guid: 'g2', name: 'Mixtard 30 HM', strength: '100 IU/ml', units: 'ขวด', line1: 'ฉีดเข้าใต้ผิวหนัง 20 ยูนิต ก่อนอาหารเช้า', line2: '8 ยูนิต ก่อนอาหารเย็น', line3: '' }] }] };
      CHECK.g1 = CHECK.g2 = true; COPIES.g1 = COPIES.g2 = 1; render();
    });
    assert.equal(await page.locator('#detail button[onclick^="insFromOpd"]').count(), 1);   // เฉพาะอินซูลิน
    await page.locator('#detail button[onclick^="insFromOpd"]').click();
    const st = await page.evaluate(() => insState());
    assert.deepEqual(st.doses, [20, 0, 8, 0]);
    assert.equal(st.name, 'นายทดสอบ ระบบ');
    assert.equal(st.when, 'ac30');
    assert.equal(await page.locator('#ins-prev .insstk').count(), 1);
    assert.equal(await page.locator('#ins-prev .insstk .syr').count(), 2);
    if (process.env.SHOT) await page.locator('#view-ins').screenshot({ path: process.env.SHOT });

    // ยางลูกสูบอยู่ตรงขีด 20 ของกระบอก 100 ยูนิต (0 = 10.5 มม., เต็ม = 66 มม.)
    const stopX = await page.evaluate(() => +document.querySelector('#ins-prev .syr rect[fill="#000"]').getAttribute('x'));
    assert.equal(stopX, 21.6);

    // 4 มื้อ + ดวงคำแนะนำ = 3 ดวง; ทุกอย่างอยู่ในกรอบ
    await page.evaluate(() => { ['10', '6', '8', '40'].forEach((v, i) => { document.getElementById('ins-d' + i).value = v; });
      document.getElementById('ins-tips').checked = true; insRender(); });
    assert.equal(await page.locator('#ins-prev .insstk').count(), 3);
    const over = await page.evaluate(() => [...document.querySelectorAll('#ins-prev .insstk .in')].map(b => {
      const r = b.getBoundingClientRect();
      return [...b.querySelectorAll('*')].some(c => { const q = c.getBoundingClientRect(); return q.width && (q.bottom > r.bottom + 1 || q.right > r.right + 1); });
    }));
    assert.deepEqual(over, [false, false, false]);

    // เกินขนาดกระบอก → ปุ่มพิมพ์ปิด
    await page.selectOption('#ins-syr', '30');
    assert.ok(await page.locator('#ins-print').isDisabled());
    assert.match(await page.locator('#ins-err').textContent(), /เกินกระบอกฉีดยา/);
    await page.selectOption('#ins-syr', '100');

    const r = await page.evaluate(() => { document.getElementById('ins-n').value = 2; insPrint();
      return { n: document.querySelectorAll('#print-area .insstk').length, size: document.getElementById('page-size').textContent }; });
    await page.waitForTimeout(150);
    assert.equal(r.n, 6);
    assert.match(r.size, /90mm 60mm/);
    assert.equal(await page.evaluate(() => window.__printed), 1);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
