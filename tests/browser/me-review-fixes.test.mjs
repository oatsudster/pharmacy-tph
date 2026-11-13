// บั๊กที่ Gemini (รีวิว ME_Dashboard.html 2026-11-13, ชุด 1B) พบและยืนยันแล้ว — ห้ามกลับมาอีก · ข้อมูลสมมติทั้งหมด (HN 9999xxx)
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { ROOT } from '../helpers.mjs';

test('ME dashboard: ปี พ.ศ. / export / ตัวหาร / admin error / ใบสั่งยารายเดือน / ซิงค์', async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await ctx.addInitScript(() => { localStorage.setItem('tph_auth_v1', '1'); window.confirm = () => true; });
  try {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(ROOT, 'ME_Dashboard.html')).href); await page.waitForTimeout(800);
    const r = await page.evaluate(() => {
      const o = {};
      o.dates = [thToISOme('13/11/69'), thToISOme('13/11/2569'), thToISOme('1/10/68'), thToISOme('xx')];
      o.maxlen = ['mf-opd-date', 'mf-ipd-date', 'f-date-text', 'f-order-date-text'].map(id => document.getElementById(id).maxLength);
      o.stage = ['ความคลาดเคลื่อนในการจ่ายยา', 'ความคลาดเคลื่อนก่อนการจ่ายยา', 'ความคลาดเคลื่อนก่อนการจ่ายยา ( Pre-dispensing error)', 'ความคลาดเคลื่อนในการจ่ายยา(Dispensing error)'].map(extractStageShort);
      o.sev = ['Category C: xx', 'Category C', 'Category D :', 'Cat'].map(extractSeverity);

      // ข้อมูลสมมติ: ER 1 ME + 2 วันที่มีแต่ใบสั่งยา; IPD 2 เดือนมีตัวหาร (เดือนหนึ่งไม่มี ME) + เดือนที่ยังรอตัวหาร
      records = [
        { id: 1, date: '2026-10-05', time: '21:00', hasME: true, severity: 'C', drugs: [{ name: 'ยาA' }, { name: 'ยาB' }], drug: 'ยาA', rxDaily: 30 },
        { id: 2, date: '2026-10-06', hasME: false, rxDaily: 25 },
        { id: 3, date: '2026-10-07', hasME: false, rxDaily: 28 },
      ];
      hosxpRecords = [
        { id: 11, dept: 'IPD', date: '2026-10-10', severity: 'B', stage: 'Administration', stageRaw: 'ความคลาดเคลื่อนในการให้ยา ( Administration error)', detail: 'x' },
        { id: 12, dept: 'IPD', date: '2026-12-03', severity: 'C', stage: 'Administration', stageRaw: 'ความคลาดเคลื่อนในการให้ยา ( Administration error)', detail: 'y' },
        { id: 13, dept: 'OPD', date: '2026-10-11', severity: 'B', drug: '[ระบบคิว]', meCategory: 'system' },
      ];
      hosxpDenom = { '2026-10_IPD': 300, '2026-11_IPD': 200 };

      // export ER ไม่นับแถวที่มีแต่ใบสั่งยา
      o.exp = expFilter(erStatsRecords().filter(x => x.hasME !== false), { type: 'year', fyCE: 2027 }).length;

      // gauge IPD ทั้งปีงบ: (ME ต.ค. 1) / (300+200) × 1000 = 2 — ธ.ค. ยังไม่มีตัวหาร ไม่นับ
      let gauge = null; const g0 = window.updateGauge; window.updateGauge = (p, rate) => { if (p === 'ipd') gauge = rate; };
      renderHosXPDashboard('IPD');   // ครั้งแรกตั้งค่าเริ่มต้น (เดือนปัจจุบัน) → เปลี่ยนเป็นทั้งปีงบ 2570
      document.getElementById('ipd-dash-fy').value = '2570'; document.getElementById('ipd-dash-month').value = '';
      renderHosXPDashboard('IPD'); window.updateGauge = g0;
      o.gauge = gauge;

      // admin error: ยังไม่จัดหมวด → แถว "รอจัดหมวด" + นับในยอดรวม
      const d = computeAdminErrorReportData(2570);
      o.admin = [d.pendingTotal, d.grandTotal, d.sevGrandTotal];

      // ตาราง IPD: ตัวกรองเดือนใช้ได้จริง
      const mSel = document.getElementById('ipd-filter-month');
      mSel.innerHTML = '<option value="">ทั้งหมด</option><option value="2026-12">ธ.ค.</option>'; mSel.value = '2026-12';
      renderHosXPTable('IPD');
      o.table = document.getElementById('ipd-table-body').querySelectorAll('tr').length;

      // ชื่อหมวดระบบไม่ถูกนับเป็นยา / ER นับยาทุกตัว
      o.redact = redactMeText('ผู้ป่วย นายทดสอบ ระบบ HN 9999001 เตียง 12 ได้ยาผิด', { patient: 'นายทดสอบ ระบบ' });
      return o;
    });
    assert.deepEqual(r.dates, ['2026-11-13', '2026-11-13', '2025-10-01', '']);
    assert.deepEqual(r.maxlen, [10, 10, 10, 10]);
    assert.deepEqual(r.stage, ['Dispensing', 'Pre-dispensing', 'Pre-dispensing', 'Dispensing']);
    assert.deepEqual(r.sev, ['C', 'C', 'D', '']);
    assert.equal(r.exp, 1);
    assert.equal(r.gauge, 2);
    assert.deepEqual(r.admin, [2, 2, 2]);
    assert.equal(r.table, 1);
    assert.ok(!/9999001|ทดสอบ/.test(r.redact) && /\[เลข\]/.test(r.redact), r.redact);

    // วันที่สั่งยา: สั่ง 17:30 บันทึก 18:00 วันเดียวกัน = วันเดียวกัน · บันทึกเช้าวันถัดไป = เมื่อวาน
    const od = await page.evaluate(() => {
      const set = (id, v) => { const el = document.getElementById(id); el.value = v; };
      const run = (date, recT, ordT) => { set('f-date-text', date); set('f-time-text', recT); set('f-order-time-text', ordT);
        document.getElementById('f-order-date-text').dataset.userEdited = ''; suggestOrderDate(); return document.getElementById('f-order-date-text').value; };
      return [run('01/10/69', '18:00', '17:30'), run('02/10/69', '07:30', '21:00')];
    });
    assert.deepEqual(od, ['01/10/69', '01/10/69']);

    // ใบสั่งยารายเดือน: เว้นว่าง = ล้าง · แก้แล้วทุกแถวของวันนั้นเป็นค่าใหม่
    const rx = await page.evaluate(() => {
      window.save = () => {};
      records = [
        { id: 1, date: '2026-10-05', hasME: true, rxDaily: 30 }, { id: 4, date: '2026-10-05', hasME: true, rxDaily: 30 },
        { id: 2, date: '2026-10-06', hasME: false, rxDaily: 25 },
      ];
      document.getElementById('rxm-month').innerHTML = '<option value="2026-10">ต.ค.</option>';
      buildRxGrid();
      const inp = d => document.querySelector(`.rxm-inp[data-date="${d}"]`);
      inp('2026-10-05').value = '33'; inp('2026-10-06').value = '';
      saveRxMonthly();
      return records.map(x => [x.id, x.rxDaily]);
    });
    assert.deepEqual(rx, [[1, 33], [4, 33]]);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
