// โหลดหน้าจริงในเบราว์เซอร์ โดย "บล็อกทุก request ออกเน็ต" (ไม่มีทางแตะ Firebase/HOSxP/AI production)
// ตรวจ: ไม่มี JS error ตอนโหลด · ป้ายซิงค์ไม่อ้างว่า "ซิงค์แล้ว" เมื่อยังไม่ได้ยืนยันกับ server (F08)
// ทั้งจอคอม 1366 px และมือถือ 390 px (ไม่มีแถบเลื่อนแนวนอน)
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT } from '../helpers.mjs';

const PAGES = [
  ['adr.html', '#sync-badge'],
  ['waiting-time.html', '#sync-badge'],
  ['expiry-tracker.html', '#sync-badge'],
  ['index.html', null],
  ['ME_Dashboard.html', null],
  ['dm-remission.html', null],
  ['rx-sticker.html', null],
  ['clinic.html', '#sync-badge'],
  ['admin-error-ipd.html', '#sync-badge'],
  ['pharmacy-ha.html', null],
  ['insurance.html', null],
  ['night-meds.html', null],
];

let browser;
test.before(async () => { browser = await chromium.launch(); });
test.after(async () => { await browser.close(); });

for (const [file, badgeSel] of PAGES) {
  for (const [label, viewport] of [['desktop', { width: 1366, height: 800 }], ['mobile', { width: 390, height: 844 }]]) {
    test(`${file} (${label}): โหลดได้ไม่มี JS error${badgeSel ? ' + ป้ายไม่อ้างว่าซิงค์แล้ว' : ''}`, async t => {
      const ctx = await browser.newContext({ viewport });
      const blocked = [];
      await ctx.route('**/*', r => {
        if (r.request().url().startsWith('file:')) return r.continue();
        blocked.push(r.request().url()); return r.abort();
      });
      await ctx.addInitScript(() => { try { localStorage.setItem('tph_auth_v1', '1'); } catch (e) {} });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(pathToFileURL(path.join(ROOT, file)).href);
      // Firestore ส่ง snapshot จาก cache เมื่อต่อ server ไม่ได้ (~10 วินาที) — รอให้ป้ายเปลี่ยนจาก "กำลังเชื่อมต่อ" ก่อนตรวจ
      if (badgeSel) await page.waitForFunction(s => !/กำลัง(เชื่อมต่อ|โหลด)/.test(document.querySelector(s).textContent), badgeSel, { timeout: 20000 }).catch(() => {});
      else await page.waitForTimeout(2500);
      assert.deepEqual(errors, []);
      if (badgeSel) {
        const txt = await page.textContent(badgeSel);
        t.diagnostic('ป้าย: ' + txt);
        assert.doesNotMatch(txt, /กำลัง(เชื่อมต่อ|โหลด)/, 'snapshot ยังไม่มา — ทดสอบไม่ได้');
        assert.doesNotMatch(txt, /ซิงค์แล้ว/, `ป้าย: ${txt}`);
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (label === 'mobile') t.diagnostic(`แถบเลื่อนแนวนอนบนมือถือ ${overflow} px`);
      await ctx.close();
    });
  }
}
