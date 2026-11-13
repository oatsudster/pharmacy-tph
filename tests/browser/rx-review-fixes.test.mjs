// บั๊กที่ Gemini (รีวิว rx-sticker.html 2026-11-13) พบและยืนยันแล้ว — ห้ามกลับมาอีก · ข้อมูลสมมติทั้งหมด
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { ROOT } from '../helpers.mjs';

test('rx-sticker: แปลงวิธีใช้ / ฉลากอินซูลิน / แก้วิธีใช้ค้าง / ป้ายทับ', async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await ctx.addInitScript(() => localStorage.setItem('tph_auth_v1', '1'));
  try {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(ROOT, 'rx-sticker.html')).href); await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const o = {};
      // อินซูลิน: ช่องว่างมื้อเช้า + เย็น 10 = เย็น ไม่ใช่เช้า; แบบเลขนำหน้ายังได้เหมือนเดิม
      o.ins = [mdAbbrIns('ฉีดเข้าใต้ผิวหนัง ก่อนอาหาร เช้า ...... ยูนิต เย็น ..10.. ยูนิต'),
        mdAbbrIns('ฉีดเข้าใต้ผิวหนัง ก่อนอาหาร ..8.... ยูนิต เช้า ...... ยูนิต เย็น'),
        mdAbbrIns('ฉีดเข้าใต้ผิวหนัง 16 ยูนิต ก่อนอาหารเช้า 8 ยูนิต ก่อนอาหารเย็น'),
        mdAbbrIns('ฉีดเข้าใต้ผิวหนัง ก่อนอาหาร เช้า ...... ยูนิต เย็น ...... ยูนิต')];
      // ยาพ่น
      o.inh = ['พ่นยาทางปาก 2 ที วันละ 2 ครั้ง เวลา เช้า-เย็น', 'พ่นยาทางปาก 2 ที วันละ 3 ครั้ง เช้า เย็น ก่อนนอน',
        'พ่นยาทางปาก 2 ที วันละ 1 ครั้ง เย็น', 'กดพ่นยาทางปาก 2 ที เวลามีอาการหอบ ทุก 4 ชั่วโมง', 'กดพ่นยาทางปาก 1 ที วันละ 1 ครั้ง ก่อนนอน'].map(mdAbbr);
      o.mix = mdAbbr('รับประทานครั้งละ 1 เม็ด วันละ 2 ครั้ง ก่อนอาหารเช้า และ หลังอาหารเย็น');
      o.hme = hmeDrug({ name: 'ยาเดิม(Atorvastatin 20 mg)', line1: 'รับประทานครั้งละ 1 เม็ด', line2: 'ก่อนนอน' });
      o.split = mdOldSplit('KCl 20 mEq/15 cc รับประทานครั้งละ 30 ซีซี');
      o.when = ['NovoMix 30 Penfill', 'Insulatard HM'].map(insWhenFor);
      o.name = insDrugName({ name: 'Gensulin', strength: 'N 100 IU/ml' });
      // คำใต้ลูกศรอยู่ในกระบอก 0–81 มม. ทุกขนาด
      const pa = document.getElementById('print-area'); pa.style.cssText = 'display:block';
      o.over = [];
      [[100, 100], [50, 50], [30, 30]].forEach(([cap, max]) => { for (let d = 1; d <= max; d++) {
        const h = document.createElement('div'); h.innerHTML = insSyrSvg(d, cap); pa.appendChild(h);
        const bb = h.querySelector('svg text:last-of-type').getBBox();
        if (bb.x < 0 || bb.x + bb.width > 81) o.over.push(`${d}/${cap}`); h.remove(); } });
      pa.style.cssText = '';
      return o;
    });
    assert.deepEqual(r.ins, ['0-0-10 u SC ac', '8-0-0 u SC ac', '16-0-8 u SC ac', 'ฉีดเข้าใต้ผิวหนัง ก่อนอาหาร เช้า ...... ยูนิต เย็น ...... ยูนิต']);
    assert.deepEqual(r.inh, ['2 puff bid', 'พ่นยาทางปาก 2 ที วันละ 3 ครั้ง เช้า เย็น ก่อนนอน', '2 puff เย็น', '2 puff prn q 4 hr', '1 puff hs']);
    assert.equal(r.mix, 'รับประทานครั้งละ 1 เม็ด วันละ 2 ครั้ง ก่อนอาหารเช้า และ หลังอาหารเย็น');
    assert.deepEqual(r.hme, { name: 'ยาเดิม: Atorvastatin 20 mg', use: '1 x 1 hs' });
    assert.deepEqual(r.split, ['KCl 20 mEq/15 cc', 'รับประทานครั้งละ 30 ซีซี']);
    assert.deepEqual(r.when, ['ac0', 'ac30']);
    assert.equal(r.name, 'Gensulin N');
    assert.deepEqual(r.over, []);

    // ฉลากอินซูลิน: ก่อนนอนอย่างเดียว ไม่บอก "ก่อนอาหาร"; แก้ HN = ล้างคนเดิม
    await page.evaluate(() => { setView('ins'); insFill({ hn: '9999001', name: 'นายทดสอบ ระบบ', drug: 'Insulatard HM', doses: [0, 0, 0, 10] }); });
    const tag = await page.locator('#ins-prev .insstk .dr span').textContent();
    assert.equal(tag, 'ฉีดก่อนนอน');
    await page.fill('#ins-hn', '9999002');
    assert.equal(await page.inputValue('#ins-name'), '');
    assert.equal(await page.inputValue('#ins-d3'), '');
    assert.ok(await page.locator('#ins-print').isDisabled());

    // แก้วิธีใช้ไว้ แล้ว HOSxP เปลี่ยนวิธีใช้ = ทิ้งที่แก้; ป้ายยาปฏิชีวนะไม่ทับบรรทัดวิธีใช้
    const e = await page.evaluate(() => {
      const it = { guid: 'g1', name: 'Amoxicillin', strength: '500 mg', qty: 20, line1: 'รับประทานครั้งละ 2 เม็ด', line2: 'วันละ 2 ครั้ง หลังอาหาร เช้า - เย็น', line3: '', antibiotic: 'Y', light: 'Y' };
      USE_EDIT.g1 = { l: ['แก้เอง', '', ''], o: useHos(it).join('|'), at: Date.now() };
      const a = useOrig(it)[0];
      const it2 = Object.assign({}, it, { line1: 'รับประทานครั้งละ 1 เม็ด' });
      const b = useOrig(it2)[0];
      delete USE_EDIT.g1;
      CUR = { hn: '9999001', now: '2026-11-13 10:00:00', visits: [] };
      const h = document.createElement('div'); h.innerHTML = stickerHtml({ name: 'ทดสอบ', queue: '1' }, it, 1, 1, new Date());
      return { a, b, tags: [...h.querySelectorAll('.stk > div')].filter(d => /ยาปฏิชีวนะ|เก็บพ้นแสง/.test(d.textContent)).map(d => d.style.top) };
    });
    assert.equal(e.a, 'แก้เอง');
    assert.equal(e.b, 'รับประทานครั้งละ 1 เม็ด');
    assert.deepEqual(e.tags, ['39.95mm']);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
