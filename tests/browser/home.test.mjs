// UI ข้อ 2,3,4,7 — หน้าแรกในเบราว์เซอร์จริง (บล็อกเน็ตทั้งหมด, ข้อมูลสมมติใน localStorage)
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT } from '../helpers.mjs';

const URL = pathToFileURL(path.join(ROOT, 'index.html')).href;
let browser;
test.before(async () => { browser = await chromium.launch(); });
test.after(async () => { await browser.close(); });

async function open(viewport, seed = {}) {
  const ctx = await browser.newContext({ viewport });
  await ctx.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await ctx.addInitScript(seed => {
    localStorage.setItem('tph_auth_v1', '1');
    for (const [k, v] of Object.entries(seed)) if (!localStorage.getItem('seeded_' + k)) { localStorage.setItem(k, JSON.stringify(v)); localStorage.setItem('seeded_' + k, '1'); }
  }, seed);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL);
  await page.waitForTimeout(800);
  return { ctx, page, errors };
}
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
const lastMonth = () => { const [y, m] = today().split('-').map(Number); const t = y * 12 + m - 2; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}-15`; };

test('ข้อ 4: ตัวเลขการ์ดใช้ฟิลด์จริง — ME ไม่นับแถว hasME:false, E–I, ADR ร้ายแรง, DM HbA1c ล่าสุด', async () => {
  const d = today();
  const { ctx, page, errors } = await open({ width: 1366, height: 900 }, {
    me_records_v2: [{ date: d, hasME: true, severity: 'E' }, { date: d, hasME: true, severity: 'B' }, { date: d, hasME: false }, { date: lastMonth(), hasME: true, severity: 'C' }],
    adr_records: [{ date: d, severity: 'ร้ายแรง (Serious)' }, { date: d, severity: 'ไม่ร้ายแรง (Non-serious)' }],
    dm_patients: [{ id: 'a' }, { id: 'b' }],
    dm_visits: [{ patientId: 'a', date: '2026-01-01', hba1c: '7.5' }, { patientId: 'a', date: '2026-06-01', hba1c: '6.1' }, { patientId: 'b', date: '2026-06-01', hba1c: '8' }],
  });
  const v = await page.evaluate(() => Object.fromEntries(['me-total', 'me-harm', 'me-month', 'adr-total', 'adr-serious', 'dm-patients', 'dm-remit', 'wt-stat-count']
    .map(i => [i, document.getElementById(i).textContent])));
  assert.deepEqual(v, { 'me-total': '2', 'me-harm': '1', 'me-month': '1', 'adr-total': '2', 'adr-serious': '1', 'dm-patients': '2', 'dm-remit': '1', 'wt-stat-count': '…' });
  // ไม่มี server (บล็อกเน็ต) → ต้องไม่อ้างว่าอัปเดตจาก server
  const upd = await page.evaluate(() => ['me', 'adr', 'clinic', 'dm'].map(c => document.getElementById(c + '-updated').textContent).join(' | '));
  assert.doesNotMatch(upd, /อัปเดต/, upd);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('ข้อ 3: ค้นด้วยคำเรียกงาน', async () => {
  const { ctx, page } = await open({ width: 1366, height: 900 });
  const count = async q => { await page.fill('#suite-search', q); return page.textContent('#suite-search-status'); };
  assert.match(await count('รายงาน'), /พบ 7 จาก 10/);
  assert.match(await count('แพ้ยา'), /พบ 2 จาก 10/);
  assert.match(await count('เคลม'), /พบ 1 จาก 10/);
  assert.match(await count('ไม่มีระบบนี้'), /พบ 0 จาก 10/);
  assert.equal(await page.isVisible('#suite-no-results'), true);
  await ctx.close();
});

test('ข้อ 7: หมวดงาน + ปักรายการโปรด (จำหลังรีเฟรช) + ใช้ล่าสุด', async () => {
  const { ctx, page } = await open({ width: 1366, height: 900 });
  const groups = () => page.evaluate(() => [...document.querySelectorAll('.home-group')].filter(s => !s.hidden).map(s => s.dataset.group + ':' + s.querySelectorAll('.app-card').length).join(' '));
  assert.equal(await groups(), 'record:4 hosxp:2 track:4');
  await page.click('.app-card[data-href="night-meds.html"] .fav-btn');
  assert.equal(await groups(), 'fav:1 record:4 hosxp:1 track:4');
  await page.reload(); await page.waitForTimeout(500);
  assert.equal(await groups(), 'fav:1 record:4 hosxp:1 track:4');
  assert.equal(await page.getAttribute('.app-card[data-href="night-meds.html"] .fav-btn', 'aria-pressed'), 'true');
  // คลิกการ์ด → ขึ้นใน "ใช้ล่าสุด" (หยุดการเปลี่ยนหน้าไว้ก่อน)
  await page.route('**/adr.html', r => r.abort());
  await page.click('.app-card[data-href="adr.html"] h2').catch(() => {});
  await page.goto(URL); await page.waitForTimeout(500);
  assert.match(await page.textContent('#recent-row'), /ADR/);
  await ctx.close();
});

test('ข้อ 7: รายงานประจำเดือน — เปิดแผง, ติ๊กแล้วนับที่เหลือ, จำหลังรีเฟรช', async () => {
  const { ctx, page } = await open({ width: 1366, height: 900 });
  assert.equal(await page.isVisible('#monthly-panel'), false);
  await page.click('#monthly-btn');
  assert.equal(await page.isVisible('#monthly-panel'), true);
  assert.match(await page.textContent('#monthly-due'), /เหลือ 7 รายการ/);
  await page.check('#monthly-list input[data-id="hrms"]');
  assert.match(await page.textContent('#monthly-due'), /เหลือ 6 รายการ/);
  await page.reload(); await page.waitForTimeout(500);
  assert.match(await page.textContent('#monthly-due'), /เหลือ 6 รายการ/);
  await ctx.close();
});

test('ข้อ 2: มือถือ 390 px — การ์ดแรกอยู่ในจอแรก, ปุ่มออกไม่ตกบรรทัด, ไม่มีแถบเลื่อนแนวนอน', async () => {
  const { ctx, page, errors } = await open({ width: 390, height: 844 });
  const m = await page.evaluate(() => ({
    card: document.querySelector('.app-card').getBoundingClientRect().top,
    header: document.querySelector('.header').getBoundingClientRect().height,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  assert.ok(m.card < 600, 'การ์ดแรกที่ ' + m.card + ' px (เดิม 701)');
  assert.ok(m.header < 80, 'ส่วนหัวสูง ' + m.header + ' px');
  assert.equal(m.overflow, 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});
