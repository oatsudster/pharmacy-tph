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
        set: async v => {   // merge 2 ชั้น (data / ext → h<HN>) + FieldValue.delete()
          const d = window.__fs[id] || (window.__fs[id] = {}), DEL = firebase.firestore.FieldValue.delete();
          for (const [f, m] of Object.entries(v)) {
            d[f] = d[f] || {};
            for (const [k, val] of Object.entries(m)) {
              if (val && typeof val.isEqual === 'function' && val.isEqual(DEL)) delete d[f][k];
              else d[f][k] = JSON.parse(JSON.stringify(val));
            }
          }
        },
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

// "ยาเดิม......" คีย์ชื่อ+วิธีใช้ภาษาอังกฤษล้วน (2026-11-02: เดิมทั้งข้อความไปอยู่ช่องชื่อ ช่องวิธีใช้ว่าง ชื่อยาวตกขอบตอนพิมพ์)
test('ยาเดิม......: แยกชื่อ/วิธีใช้ภาษาอังกฤษล้วน + ภาษาไทยในวงเล็บ — พิมพ์วิธีใช้ครบ', async () => {
  const { ctx, page, errors } = await openPage();
  await page.evaluate(() => {
    const old = (icode, usage) => ({ icode, name: 'ยาเดิม.............................', strength: 'mg.', units: '', form: '', qty: '0', usage, vn: '6910010001', date: '2026-10-01', dep: 'นัด คลินิก HT' });
    tphHosxp.mrMeds = async () => ({ ok: true, chronic: true, regdate: '2026-10-31', items: [
      old('3001', 'Ertapenem 1 g + NSS 50 ml IV 1 g OD'),
      old('3002', 'Semaglutide inj./pen 1 mg SC weekly .'),
      old('3003', 'Lactulose 20g/30ml (100 ml/ขวด) รับประทานครั้งละ 30 ซีซี วันละ 1 ครั้ง ก่อนนอน'),
      old('3004', '. . .'),
    ] });
    openMd('690000001');
  });
  await page.waitForSelector('#md-list .md-row');
  await page.evaluate(() => { MD.items.forEach(d => d.on = true); renderMd(); });
  await page.click('#md-print');
  await page.waitForTimeout(200);
  const p = (await printed(page)).slice(0, 4).join(' | ');
  assert.match(p, /Ertapenem 1 g \+ NSS 50 ml\s*IV 1 g OD/);
  assert.match(p, /Semaglutide inj\.\/pen 1 mg\s*SC weekly/);
  assert.match(p, /Lactulose 20g\/30ml \(100 ml\/ขวด\)\s*30 ml x 1 hs/);
  assert.doesNotMatch(p, /\.\.\.\.|mg\.\s/);
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

test('ยาเดิม รพ.อื่น: คีย์ครั้งเดียว → admit ครั้งหน้าขึ้นให้ทุกเครื่อง + เทียบวันนัด รพ.อื่น + ป้ายในรายชื่อผู้ป่วยใน', async () => {
  const { ctx, page, errors } = await openPage();
  await page.evaluate(() => {
    IPD.push({ an: '690000150', hn: '9999001', name: 'นายทดสอบ ระบบ', regdate: '2027-03-10', bed: '3' });
    tphHosxp.ipdList = async () => ({ items: IPD.slice(1) });
    openMd('690000001');
  });
  await page.waitForSelector('#md-list .md-row');
  // admit ครั้งแรก: คีย์ยาจาก รพ.อื่น + วันนัดครั้งถัดไป
  await page.fill('#mdx-src', 'รพ.สกลนคร');
  await page.fill('#mdx-name', 'Clopidogrel 75 mg');
  await page.fill('#mdx-usage', '1 x 1 pc');
  await page.click('.mdx-add button.btn-primary');
  await page.fill('#mdx-next', '2027-01-15');
  await page.fill('#mdx-nextsrc', 'รพ.สกลนคร');
  await page.dispatchEvent('#mdx-nextsrc', 'change');
  await page.waitForFunction(() => window.__fs.mr_meds_01 && window.__fs.mr_meds_01.ext && window.__fs.mr_meds_01.ext.h9999001);
  const rec = await page.evaluate(() => window.__fs.mr_meds_01.ext.h9999001);
  assert.deepEqual(rec.items, [{ name: 'Clopidogrel 75 mg', usage: '1 x 1 pc', src: 'รพ.สกลนคร' }]);
  assert.equal(rec.next, '2027-01-15');

  // อีกเครื่อง (ไม่มี localStorage) admit ใหม่ 20 ธ.ค. — ก่อนนัด → ขึ้นให้ ติ๊กไว้ + ✅
  await page.evaluate(() => { localStorage.removeItem('mr_ext_meds'); openMd('690000099'); });
  await page.waitForFunction(() => MD && MD.x.an === '690000099' && MD.items.some(d => d.ext));
  const ext = await page.evaluate(() => MD.items.filter(d => d.ext).map(d => [d.namePrint, d.on]));
  assert.deepEqual(ext, [['Clopidogrel 75 mg', true]]);
  assert.match(await page.textContent('#mdx-rec'), /ยาเดิม รพ\.อื่น 1 รายการ — ทำไว้แล้ว.*admit ก่อนนัด รพ\.สกลนคร 15 ม\.ค\. 70/s);
  assert.equal(await page.inputValue('#mdx-next'), '2027-01-15');
  // เปิดดูเฉย ๆ ไม่ถือว่ายืนยัน — วันที่ทำไว้ไม่เปลี่ยน
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => window.__fs.mr_meds_01.ext.h9999001.an), '690000001');

  // admit 10 มี.ค. 70 — เลยนัด → ⚠️
  await page.evaluate(() => openMd('690000150'));
  await page.waitForFunction(() => MD && MD.x.an === '690000150' && MD.items.some(d => d.ext));
  assert.match(await page.textContent('#mdx-rec'), /เลยนัด รพ\.สกลนคร 15 ม\.ค\. 70 แล้ว/);

  // รายชื่อผู้ป่วยใน: ป้ายตามวันนัด
  await page.evaluate(() => loadIpd());
  await page.waitForSelector('.xb.ok');
  const badges = await page.$$eval('#ipd-list .ipd-row', rs => rs.map(r => [...r.querySelectorAll('.xb')].map(b => b.className + ' ' + b.textContent).join(' | ')));
  assert.match(badges[0], /xb ok 🏥 ยาเดิม รพ\.อื่น 1 รายการ · ก่อนนัด 15 ม\.ค\. 70/);
  assert.match(badges[1], /xb warn 🏥 ยาเดิม รพ\.อื่น 1 รายการ · เลยนัด 15 ม\.ค\. 70/);

  // พิมพ์ = ยืนยัน → วันที่ทำไว้ + AN อัปเดต
  await page.click('#md-print');
  await page.waitForFunction(() => window.__fs.mr_meds_01.ext.h9999001.an === '690000150');
  assert.deepEqual(errors, []);
  await ctx.close();
});
