// สติกเกอร์ยาเดิมใบ MR: แก้ชื่อ/ความแรง/วิธีใช้ + บันทึกรายการที่พิมพ์ตาม HN — ข้อมูลสมมติ (HN 9999001)
// บล็อกเน็ตทั้งหมด: bridge (tphHosxp) และ Firestore (mdHistRef) แทนด้วยของปลอมในหน้า ไม่สั่งพิมพ์จริง
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { ROOT } from '../helpers.mjs';

let browser;
test.before(async () => { browser = await chromium.launch(); });
test.after(async () => { await browser.close(); });

async function openPage() {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await ctx.addInitScript(() => { localStorage.setItem('tph_auth_v1', '1'); localStorage.setItem('rx_sticker_view', 'ipd'); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(path.join(ROOT, 'rx-sticker.html')).href);
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    window.print = () => { window.__printed = (window.__printed || 0) + 1; };
    const drug = (icode, name, strength, usage) => ({ icode, name, strength, units: 'tab', form: 'TAB', qty: '90', usage, vn: '6910010001', date: '2026-10-01', dep: 'นัด คลินิก HT' });
    tphHosxp.mrMeds = async () => ({ ok: true, chronic: true, regdate: '2026-10-31', items: [
      drug('1001', 'Amlodipine', '5 mg', 'รับประทานครั้งละ 1 เม็ด วันละ 1 ครั้ง หลังอาหาร เช้า'),
      drug('1002', 'Metformin', '500 mg', 'รับประทานครั้งละ 1 เม็ด วันละ 2 ครั้ง หลังอาหาร เช้า-เย็น'),
    ] });
    tphHosxp.mrDict = async () => null;
    // Firestore ปลอม: เก็บใน window.__fs ตามชื่อเอกสาร (set merge แบบตื้นพอสำหรับ { data: { h<HN>: … } })
    window.__fs = {};
    mdHistRef = hn => {
      const id = 'mr_meds_' + String(hn).slice(-2).padStart(2, '0');
      return {
        id,
        get: async () => ({ exists: !!window.__fs[id], data: () => JSON.parse(JSON.stringify(window.__fs[id])) }),
        set: async v => { const d = window.__fs[id] || (window.__fs[id] = { data: {} }); Object.assign(d.data, JSON.parse(JSON.stringify(v.data))); },
      };
    };
    IPD = [{ an: '690000001', hn: '9999001', name: 'นายทดสอบ ระบบ', regdate: '2026-10-31', bed: '1' },
           { an: '690000099', hn: '9999001', name: 'นายทดสอบ ระบบ', regdate: '2026-12-20', bed: '2' }];
  });
  return { ctx, page, errors };
}
const rows = page => page.$$eval('#md-list .md-row', rs => rs.map(r => ({ on: r.querySelector('input[type=checkbox]').checked, text: r.innerText.replace(/\s+/g, ' ') })));
const printed = page => page.$$eval('#print-area .mdstk .row.bx', rs => rs.map(r => r.innerText.replace(/\s+/g, ' ').trim()));

test('แก้ชื่อ/ความแรง/วิธีใช้ → สติกเกอร์พิมพ์ค่าที่แก้ · กดพิมพ์ = บันทึกรายการที่ติ๊กตาม HN', async () => {
  const { ctx, page, errors } = await openPage();
  await page.evaluate(() => openMd('690000001'));
  await page.waitForSelector('#md-list .md-row');
  assert.equal((await rows(page)).length, 2);

  // ✏️ แถว Metformin: ความแรง 500 → 850 mg, วิธีใช้รหัสพิมพ์เอง
  const i = await page.evaluate(() => MD.items.findIndex(d => d.icode === '1002'));
  await page.click(`#md-list .md-row:nth-child(${i + 1}) .eb`);
  const ed = page.locator('#md-list .md-row.ed');
  assert.equal(await ed.locator('input.mdx-in').nth(0).inputValue(), 'Metformin');
  assert.equal(await ed.locator('input.mdx-in').nth(1).inputValue(), '500 mg');
  await ed.locator('input.mdx-in').nth(1).fill('850 mg');
  await ed.locator('input.mdx-in').nth(1).dispatchEvent('change');
  await ed.locator('input.mdx-in').nth(2).fill('1 x 1 pc เย็น');
  await ed.locator('input.mdx-in').nth(2).dispatchEvent('change');
  await ed.locator('button[title="เสร็จ"]').click();
  const r1 = await rows(page);
  assert.match(r1[i].text, /Metformin 850 mg\s*แก้แล้ว/);
  assert.match(r1[i].text, /เดิม: Metformin 500 mg/);

  // ไม่ติ๊ก Amlodipine แล้วพิมพ์
  const j = await page.evaluate(() => MD.items.findIndex(d => d.icode === '1001'));
  await page.click(`#md-list .md-row:nth-child(${j + 1}) input[type=checkbox]`);
  await page.click('#md-print');
  await page.waitForTimeout(200);
  const p = await printed(page);
  assert.equal(p.length, 2);                          // 1 ยา × 2 ชุด
  assert.match(p[0], /1\. Metformin 850 mg\s*1 x 1 pc เย็น/);
  const saved = await page.evaluate(() => window.__fs.mr_meds_01.data.h9999001);
  assert.equal(saved.an, '690000001');
  assert.deepEqual(saved.items.map(s => [s.name, s.use, s.icode]), [['Metformin 850 mg', '1 x 1 pc เย็น', '1002']]);
  assert.match(await page.textContent('#md-hist'), /บันทึกแล้ว/);

  // เปิด AN เดิมอีกครั้ง → โหลดรายการที่พิมพ์ไว้: Metformin (แก้แล้ว) ติ๊ก, Amlodipine ไม่ติ๊ก
  await page.evaluate(() => openMd('690000001'));
  await page.waitForFunction(() => MD && document.querySelectorAll('#md-list .md-row').length === 2);
  const r2 = await rows(page);
  assert.equal(r2[0].on, true);
  assert.match(r2[0].text, /Metformin 850 mg/);
  assert.equal(r2[1].on, false);
  assert.match(await page.textContent('#md-hist'), /รายการที่พิมพ์ไว้แล้ว/);

  // admit ครั้งใหม่ (AN อื่น) → ไม่เปลี่ยนรายการเอง มีแถบ "ใช้รายการนี้"
  await page.evaluate(() => openMd('690000099'));
  await page.waitForFunction(() => MD && MD.x.an === '690000099' && document.querySelectorAll('#md-list .md-row').length === 2);
  assert.deepEqual((await rows(page)).map(r => r.on), [true, true]);
  assert.match(await page.textContent('#md-hist'), /ครั้งก่อน.*Metformin 850 mg/s);
  await page.click('#md-hist button');
  const r3 = await rows(page);
  assert.deepEqual(r3.map(r => r.on), [true, false]);
  assert.match(r3[0].text, /Metformin 850 mg/);

  // ↺ กลับเป็นค่าจาก HOSxP
  await page.click('#md-list .md-row:nth-child(1) .eb');
  await page.click('#md-list .md-row.ed button[title="กลับเป็นค่าจาก HOSxP"]');
  assert.match((await rows(page))[0].text, /Metformin 500 mg/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('ยาที่ดึงจาก visit อื่นเพิ่มเอง แก้ชื่อ/ความแรง/วิธีใช้ได้ และพิมพ์ + บันทึกค่าที่แก้', async () => {
  const { ctx, page, errors } = await openPage();
  await page.evaluate(() => {
    tphHosxp.mrVisits = async () => ({ ok: true, visits: [{ vn: '6905050001', date: '2026-05-05', dep: 'ER', pdx: 'J20', items: [
      { icode: '2001', name: 'Omeprazole', strength: '20 mg', units: 'cap', form: 'CAP', qty: '30', usage: 'รับประทานครั้งละ 1 แคปซูล วันละ 1 ครั้ง ก่อนอาหาร เช้า', vn: '6905050001', date: '2026-05-05', dep: 'ER' },
    ] }] });
    openMd('690000001');
  });
  await page.waitForSelector('#md-list .md-row');
  await page.click('#mdv summary');
  await page.click('#mdv-list button');
  const i = await page.evaluate(() => MD.items.findIndex(d => d.icode === '2001'));
  assert.ok(i >= 0);
  await page.click(`#md-list .md-row:nth-child(${i + 1}) .eb`);
  const ed = page.locator('#md-list .md-row.ed');
  await ed.locator('input.mdx-in').nth(1).fill('40 mg');
  await ed.locator('input.mdx-in').nth(1).dispatchEvent('change');
  await ed.locator('button[title="เสร็จ"]').click();
  assert.match((await rows(page))[i].text, /Omeprazole 40 mg\s*แก้แล้ว/);
  await page.evaluate(() => MD.items.forEach(d => d.on = d.icode === '2001'));
  await page.click('#md-print');
  await page.waitForTimeout(200);
  assert.match((await printed(page))[0], /1\. Omeprazole 40 mg\s*1 x 1 ac/);
  const saved = await page.evaluate(() => window.__fs.mr_meds_01.data.h9999001.items);
  assert.deepEqual(saved.map(s => s.name), ['Omeprazole 40 mg']);
  assert.deepEqual(errors, []);
  await ctx.close();
});
