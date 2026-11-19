// ปุ่มพิมพ์สรุปรายการยา OPD จากหน้าต่างลอย จพ. (clinic.html) → rx-sticker.html#opdsum=HN — ข้อมูลสมมติ บล็อกเน็ตทั้งหมด ไม่สั่งพิมพ์จริง
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { ROOT } from '../helpers.mjs';

const today = new Date().toLocaleDateString('sv-SE');
const drug = (k, line2) => ({ guid: 'g' + k, name: 'Drug' + k, strength: '500 mg', units: 'เม็ด', qty: 30,
  line1: 'รับประทานครั้งละ 1 เม็ด', line2, line3: '' });

async function ctxOf(browser, bridge) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith('file:')) return r.continue();
    const m = u.match(/127\.0\.0\.1:8765\/db\/([a-z]+)/);
    if (m && bridge[m[1]]) return r.fulfill({ contentType: 'application/json', body: JSON.stringify(bridge[m[1]]) });
    return r.abort();
  });
  await ctx.addInitScript(() => { localStorage.setItem('tph_auth_v1', '1'); window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
  return ctx;
}

test('rx-sticker #opdsum=HN: ดึง visit วันนี้ล่าสุดแล้วพิมพ์สรุปเอง', async () => {
  const browser = await chromium.launch();
  try {
  const ctx = await ctxOf(browser, {
    rxqueue: { ok: true, items: [], now: today + ' 10:00:00' },
    rxsticker: { ok: true, hn: '9999001', now: today + ' 10:00:00', visits: [
      { vn: '2', date: today, time: '10:00', name: 'นายทดสอบ ระบบ', items: [drug(1, 'วันละ 2 ครั้ง หลังอาหาร เช้า เย็น'), drug(2, 'วันละ 1 ครั้ง หลังอาหาร เช้า')] },
      { vn: '1', date: '2020-01-01', time: '09:00', name: 'นายทดสอบ ระบบ', items: [drug(3, 'วันละ 1 ครั้ง')] }] },
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(path.join(ROOT, 'rx-sticker.html')).href + '#opdsum=9999001&t=1');
  await page.waitForFunction(() => window.__printed, null, { timeout: 5000 });
  const r = await page.evaluate(() => ({ rows: document.querySelectorAll('#print-area .hmestk tr').length,
    head: document.querySelector('#print-area .hd').textContent, hash: location.hash, refer: !!document.querySelector('#print-area .refnote') }));
  assert.equal(r.rows, 2);
  assert.match(r.head, /สรุปรายการยา.*HN 9999001/);
  assert.equal(r.hash, '');   // รีโหลดแล้วไม่พิมพ์ซ้ำ
  assert.equal(r.refer, false);
  assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('rx-sticker #opdsum=HN: ไม่มีใบสั่งวันนี้ → ไม่พิมพ์ แจ้งเตือน', async () => {
  const browser = await chromium.launch();
  try {
  const ctx = await ctxOf(browser, {
    rxqueue: { ok: true, items: [], now: today + ' 10:00:00' },
    rxsticker: { ok: true, hn: '9999001', now: today + ' 10:00:00', visits: [{ vn: '1', date: '2020-01-01', time: '09:00', name: 'x', items: [drug(3, 'วันละ 1 ครั้ง')] }] },
  });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(path.join(ROOT, 'rx-sticker.html')).href + '#refer=9999001');
  await page.waitForFunction(() => /ยังไม่มีใบสั่งยาของวันนี้/.test(document.getElementById('status').textContent), null, { timeout: 5000 });
  assert.equal(await page.evaluate(() => window.__printed || 0), 0);
  } finally { await browser.close(); }
});

test('clinic หน้าต่างลอย จพ.: ปุ่มพิมพ์สรุป + บอกว่ายาเปลี่ยนจากครั้งก่อน', async () => {
  const browser = await chromium.launch();
  try {
  const ctx = await ctxOf(browser, {});
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(path.join(ROOT, 'clinic.html')).href); await page.waitForTimeout(500);
  const r = await page.evaluate(async today => {
    const met = { icode: '1', name: 'METFORMIN', strength: '500 mg', units: 'เม็ด', qty: 60 };
    const aml = { icode: '2', name: 'AMLODIPINE', strength: '5 mg', units: 'เม็ด', qty: 30, usage: 'รับประทานครั้งละ 1 เม็ด วันละ 1 ครั้ง หลังอาหารเช้า' };
    const prev = [{ vn: 'p', date: '2026-08-01', drugs: [Object.assign({}, met, { usage: 'รับประทานครั้งละ 1 เม็ด วันละ 2 ครั้ง หลังอาหารเช้า เย็น' }), aml] }];
    let todayDrugs = [Object.assign({}, met, { usage: 'รับประทานครั้งละ 2 เม็ด วันละ 2 ครั้ง หลังอาหารเช้า เย็น' }), aml];
    tphHosxp.order = async () => ({ drugs: todayDrugs });
    tphHosxp.visits = async () => ({ visits: prev });
    const w = window.open('', 'fake-float');
    w.document.body.innerHTML = '<input id="fl-hn" value="9999001"><div id="fl-sum"></div>';
    floatWin = w; floatMode = 'tech';
    renderFloatSum();
    await new Promise(res => setTimeout(res, 200));
    const changed = { html: w.document.getElementById('fl-sum').textContent, chg: !!w.document.querySelector('.sumbox.chg'), btns: w.document.querySelectorAll('button[data-sum]').length };
    todayDrugs = prev[0].drugs; floatSumCache.clear(); renderFloatSum();
    await new Promise(res => setTimeout(res, 200));
    const same = { html: w.document.getElementById('fl-sum').textContent, chg: !!w.document.querySelector('.sumbox.chg') };
    // กดปุ่ม → เปิด rx-sticker.html#opdsum=HN
    let opened = '';
    w.open = u => { opened = u; return { focus() {} }; };
    w.document.querySelector('button[data-sum="1"]');
    printFloatSum(false);
    const op1 = opened; printFloatSum(true);
    return { changed, same, op1, op2: opened };
  }, today);
  assert.equal(r.changed.btns, 2);
  assert.ok(r.changed.chg);
  assert.match(r.changed.html, /ยาเปลี่ยนจากครั้งก่อน 1 รายการ/);
  assert.match(r.changed.html, /เพิ่มขนาด: METFORMIN/);
  assert.equal(r.same.chg, false);
  assert.match(r.same.html, /เหมือนครั้งก่อน/);
  assert.match(r.op1, /rx-sticker\.html#opdsum=9999001&t=\d+$/);
  assert.match(r.op2, /rx-sticker\.html#refer=9999001&t=\d+$/);
  assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('clinic: ปุ่ม 🔄 อัปเดต Bridge สั่ง tphHosxp.bridgeUpdate แบบ manual', async () => {
  const browser = await chromium.launch();
  try {
    const ctx = await ctxOf(browser, {});
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(ROOT, 'clinic.html')).href); await page.waitForTimeout(500);
    const r = await page.evaluate(async () => {
      let n = 0;
      tphHosxp.bridgeUpdate = async () => { n++; return { ok: true, updated: true, version: 'abc123' }; };
      const w = window.open('', 'fake-float2');
      w.document.body.innerHTML = '<div id="fl-link"></div>';
      floatWin = w;
      document.querySelector('button[onclick="manualBridgeUpdate()"]').click();
      await new Promise(res => setTimeout(res, 100));
      return { n, link: w.document.getElementById('fl-link').textContent };
    });
    assert.equal(r.n, 1);
    assert.match(r.link, /อัปเดต Bridge แล้ว \(abc123\)/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
