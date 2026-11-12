// ฉลากยาเปล่า (ไฟดับ) — 2 แบบ · พิมพ์ตามจำนวน · หน้า 101.6×59.9 · ไม่ล้นดวง
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { ROOT } from '../helpers.mjs';

test('ฉลากเปล่า: แท็บ + พิมพ์ N ดวง + เนื้อหาไม่ล้นกรอบ', async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await ctx.addInitScript(() => localStorage.setItem('tph_auth_v1', '1'));
  try {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(path.join(ROOT, 'rx-sticker.html')).href); await page.waitForTimeout(500);
  await page.evaluate(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; setView('blank'); });
  assert.equal(await page.locator('#blank-prev .bstk').count(), 2);
  if (process.env.SHOT) await page.locator('#view-blank').screenshot({ path: process.env.SHOT });
  // ทุกแถวอยู่ในกรอบ .in (ไม่ล้นล่าง)
  const over = await page.evaluate(() => [...document.querySelectorAll('#blank-prev .in')].map(b => {
    const r = b.getBoundingClientRect(); return [...b.children].some(c => c.getBoundingClientRect().bottom > r.bottom + 0.5 || c.scrollWidth > c.clientWidth + 1);
  }));
  assert.deepEqual(over, [false, false]);
  const r = await page.evaluate(() => {
    document.getElementById('blank-n').value = 5;
    document.querySelectorAll('#blank-prev label')[1].click();
    printBlank();
    return { n: document.querySelectorAll('#print-area .bstk').length, free: /วิธีใช้/.test(document.querySelector('#print-area .bstk').textContent),
      size: document.getElementById('page-size').textContent };
  });
  await page.waitForTimeout(150);
  assert.equal(r.n, 5);
  assert.ok(r.free);
  assert.match(r.size, /101\.6mm 59\.9mm/);
  assert.equal(await page.evaluate(() => window.__printed), 1);
  assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
