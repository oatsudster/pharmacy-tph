// F05 — วันที่/เดือนตามเวลาไทย ต้องไม่เลื่อนเป็นวันก่อนหน้าตอนก่อน 07:00 น. (รันทั้ง TZ=Asia/Bangkok และ TZ=UTC)
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { makeContext, loadLib, extractFn, fixedDate } from '../helpers.mjs';

const D = loadLib(makeContext(), 'lib/th-date.js').TphDate;

test('ymd/ym ใช้เวลาไทย ไม่ใช่ UTC', () => {
  assert.equal(D.ymd(new Date('2026-10-30T06:30:00+07:00')), '2026-10-30');
  assert.equal(D.ymd(new Date('2026-10-01T00:05:00+07:00')), '2026-10-01');
  assert.equal(D.ym(new Date('2026-10-01T06:59:00+07:00')), '2026-10');
  assert.equal(D.ymd(new Date('2026-09-30T23:59:00+07:00')), '2026-09-30');
  assert.equal(D.ymd(new Date('2028-02-29T03:00:00+07:00')), '2028-02-29');   // leap year
});

test('addMonths ข้ามปีได้', () => {
  assert.equal(D.addMonths('2026-01', -1), '2025-12');
  assert.equal(D.addMonths('2026-12', 1), '2027-01');
  assert.equal(D.addMonths('2026-10', -11), '2025-11');
});

test('lastFriday ของแต่ละเดือน', () => {
  assert.equal(D.lastFriday(2026, 10), '2026-10-30');
  assert.equal(D.lastFriday(2026, 11), '2026-11-27');
  assert.equal(D.lastFriday(2026, 7), '2026-07-31');   // วันสุดท้ายเป็นศุกร์พอดี
  assert.equal(D.lastFriday(2028, 2), '2028-02-25');
});

test('nextLastFriday: ก่อนวัน / วันนั้นเอง (ทุกช่วงเวลา) / หลังวัน', () => {
  assert.equal(D.nextLastFriday(new Date('2026-10-29T12:00:00+07:00')), '2026-10-30');   // ตัวอย่างในรายงาน
  assert.equal(D.nextLastFriday(new Date('2026-10-30T00:30:00+07:00')), '2026-10-30');
  assert.equal(D.nextLastFriday(new Date('2026-10-30T23:30:00+07:00')), '2026-10-30');
  assert.equal(D.nextLastFriday(new Date('2026-10-31T06:00:00+07:00')), '2026-11-27');
  assert.equal(D.nextLastFriday(new Date('2026-12-26T09:00:00+07:00')), '2027-01-29');   // ข้ามปี
});

test('daysBetween นับตามปฏิทิน', () => {
  assert.equal(D.daysBetween('2026-10-29', '2026-10-30'), 1);
  assert.equal(D.daysBetween('2026-10-30', '2026-10-30'), 0);
  assert.equal(D.daysBetween('2026-12-31', '2027-01-01'), 1);
});

// หน้าจริง: ME_Dashboard buildMonthFilterOptions — value ต้องตรงกับข้อความเดือน แม้เปิดตอน 06:30 น.
test('ME_Dashboard: ตัวเลือกเดือน value ตรงกับชื่อเดือน (06:30 น. วันที่ 30)', () => {
  const opts = [];
  const ctx = loadLib(makeContext({ Date: fixedDate('2026-10-30T06:30:00+07:00') }), 'lib/th-date.js');
  ctx.document = { getElementById: () => ({ appendChild: o => opts.push(o) }), createElement: () => ({}) };
  vm.runInContext(extractFn('ME_Dashboard.html', 'buildMonthFilterOptions') + '; buildMonthFilterOptions();', ctx);
  assert.equal(opts.length, 12);
  assert.deepEqual({ v: opts[11].value, t: opts[11].textContent }, { v: '2026-10', t: 'ตุลาคม 2569' });
  assert.deepEqual({ v: opts[0].value, t: opts[0].textContent }, { v: '2025-11', t: 'พฤศจิกายน 2568' });
});

test('ME_Dashboard: ตัวเลือกเดือน 1 ต.ค. 00:30 น. ยังเป็นตุลาคม', () => {
  const opts = [];
  const ctx = loadLib(makeContext({ Date: fixedDate('2026-10-01T00:30:00+07:00') }), 'lib/th-date.js');
  ctx.document = { getElementById: () => ({ appendChild: o => opts.push(o) }), createElement: () => ({}) };
  vm.runInContext(extractFn('ME_Dashboard.html', 'buildMonthFilterOptions') + '; buildMonthFilterOptions();', ctx);
  assert.equal(opts[11].value, '2026-10');
});

// หน้าจริง: dm-remission การ์ด "วันศุกร์สุดท้าย ในอีก N วัน"
test('dm-remission: nextLastFriday + daysUntil (29 ต.ค. เที่ยง → 30 ต.ค., อีก 1 วัน)', () => {
  const ctx = loadLib(makeContext({ Date: fixedDate('2026-10-29T12:00:00+07:00') }), 'lib/th-date.js');
  vm.runInContext(extractFn('dm-remission.html', 'nextLastFriday') + extractFn('dm-remission.html', 'daysUntil'), ctx);
  const d = vm.runInContext('nextLastFriday()', ctx);
  assert.equal(d, '2026-10-30');
  assert.equal(ctx.daysUntil(d), 1);
});

test('dm-remission: วันศุกร์สุดท้ายเอง 15:00 น. ยังแสดงวันนี้ อีก 0 วัน', () => {
  const ctx = loadLib(makeContext({ Date: fixedDate('2026-10-30T15:00:00+07:00') }), 'lib/th-date.js');
  vm.runInContext(extractFn('dm-remission.html', 'nextLastFriday') + extractFn('dm-remission.html', 'daysUntil'), ctx);
  assert.equal(vm.runInContext('nextLastFriday()', ctx), '2026-10-30');
  assert.equal(vm.runInContext('daysUntil(nextLastFriday())', ctx), 0);
});
