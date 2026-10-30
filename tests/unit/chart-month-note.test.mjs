// UI ข้อ 6 — กราฟรายเดือน: เดือนปัจจุบันมี * และหมายเหตุ "เดือนนี้ยังไม่สิ้นสุด" (เวลาไทย)
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeContext, loadLib, fixedDate } from '../helpers.mjs';

function lib(now) { return loadLib(makeContext({ Date: fixedDate(now) }), 'lib/chart-month-note.js').TphMonthNote; }

test('mark: เดือนปัจจุบันตามเวลาไทยได้ *, เดือนอื่นไม่ได้', () => {
  const N = lib('2026-11-01T06:00:00+07:00');   // ยังเป็น 31 ต.ค. ตาม UTC
  assert.equal(N.currentYm(), '2026-11');
  assert.equal(N.mark('พ.ย. 69', '2026-11'), 'พ.ย. 69 *');
  assert.equal(N.mark('ต.ค. 69', '2026-10'), 'ต.ค. 69');
});

test('plugin: เว้นที่ใต้กราฟเฉพาะกราฟที่มีเดือนปัจจุบัน และไม่บวกซ้ำทุกครั้งที่ update', () => {
  const N = lib('2026-10-30T12:00:00+07:00');
  const chart = { config: { options: { layout: { padding: 8 } } }, data: { labels: ['ก.ย. 69', N.mark('ต.ค. 69', '2026-10')] } };
  N.plugin.beforeUpdate(chart); N.plugin.beforeUpdate(chart);
  assert.deepEqual({ ...chart.config.options.layout.padding }, { top: 8, right: 8, bottom: 24, left: 8 });
  chart.data.labels = ['ส.ค. 69', 'ก.ย. 69'];   // เปลี่ยนตัวกรองเป็นช่วงที่ไม่มีเดือนนี้
  N.plugin.beforeUpdate(chart);
  assert.deepEqual({ ...chart.config.options.layout.padding }, { top: 8, right: 8, bottom: 8, left: 8 });
});

test('plugin: วาดหมายเหตุเฉพาะกราฟที่มีเครื่องหมาย', () => {
  const N = lib('2026-10-30T12:00:00+07:00');
  const drawn = [];
  const ctx = { save() {}, restore() {}, fillText: t => drawn.push(t) };
  N.plugin.afterDraw({ ctx, width: 400, height: 200, data: { labels: ['ก.ย. 69'] } });
  N.plugin.afterDraw({ ctx, width: 400, height: 200, data: { labels: ['ต.ค. 69 *'] } });
  assert.deepEqual(drawn, [N.NOTE]);
});
