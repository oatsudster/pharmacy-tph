// ฉลากยารูปภาพ — แปลงวิธีใช้ (3 บรรทัด HOSxP) เป็นข้อมูลภาพ และปฏิเสธวิธีใช้ที่ทำเป็นภาพแล้วอาจเข้าใจผิด
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeContext, loadLib } from '../helpers.mjs';

const P = loadLib(makeContext(), 'lib/usage-picto.js').TphPicto;
const plain = o => JSON.parse(JSON.stringify(o));
const S = (m, n, e, b) => ({ morning: m, noon: n, evening: e, bed: b });

test('กินวันละ 2 ครั้ง หลังอาหาร เช้า-เย็น', () => {
  const r = plain(P.parse('รับประทานครั้งละ 1 เม็ด', 'วันละ 2 ครั้ง หลังอาหาร เช้า-เย็น', ''));
  assert.deepEqual(r, { route: 'oral', amount: { n: 1, text: '1', unit: 'เม็ด', form: 'tablet' }, slots: S(1, 0, 1, 0), meal: 'after', prn: null, everyH: null, warnings: [], assumed: false });
});

test('ครึ่งเม็ด / 1 เม็ดครึ่ง / 1/4 เม็ด', () => {
  assert.equal(P.parse('รับประทานครั้งละ ครึ่ง เม็ด', 'วันละ 1 ครั้ง หลังอาหารเช้า', '').amount.n, 0.5);
  assert.equal(P.parse('รับประทานครั้งละ 1 เม็ดครึ่ง', 'วันละ 1 ครั้ง ก่อนนอน', '').amount.n, 1.5);
  assert.equal(P.parse('รับประทานครั้งละ 1/4 เม็ด', 'วันละ 1 ครั้ง ก่อนนอน', '').amount.n, 0.25);
});

test('ก่อนนอนอย่างเดียว ไม่มีก่อน/หลังอาหาร', () => {
  const r = P.parse('รับประทานครั้งละ 1 เม็ด', 'วันละ 1 ครั้ง ก่อนนอน', '');
  assert.deepEqual(plain(r.slots), S(0, 0, 0, 1));
  assert.equal(r.meal, null);
});

test('ก่อนอาหาร 3 มื้อ / ขนาดแยกมื้อ', () => {
  assert.deepEqual(plain(P.parse('รับประทานครั้งละ 1 เม็ด', 'วันละ 3 ครั้ง ก่อนอาหาร เช้า กลางวัน เย็น', '').slots), S(1, 1, 1, 0));
  const r = P.parse('รับประทาน', 'เช้า 2 เม็ด เย็น 1 เม็ด หลังอาหาร', '');
  assert.deepEqual(plain(r.slots), S(2, 0, 1, 0));
  assert.equal(r.meal, 'after');
});

test('ขนาดแยกมื้อมีครึ่งเม็ด: "กลางวัน 1 เม็ดครึ่ง" = 1.5', () => {
  assert.deepEqual(plain(P.parse('รับประทาน', 'เช้า 2 เม็ด กลางวัน 1 เม็ดครึ่ง เย็น 4 เม็ด หลังอาหาร', '').slots), S(2, 1.5, 4, 0));
});

test('วันละ N ครั้งไม่บอกมื้อ → เดามื้อมาตรฐาน + assumed', () => {
  const r = P.parse('รับประทานครั้งละ 2 ช้อนชา', 'วันละ 3 ครั้ง หลังอาหาร', '');
  assert.deepEqual(plain(r.slots), S(2, 2, 2, 0));
  assert.equal(r.assumed, true);
  assert.equal(r.amount.form, 'tsp');
});

test('เมื่อมีอาการ (prn) + ห่างกัน', () => {
  const r = P.parse('รับประทานครั้งละ 1-2 เม็ด', 'เวลาปวดหรือมีไข้ ทุก 4-6 ชั่วโมง', '');
  assert.equal(r.slots, null);
  assert.deepEqual(plain(r.prn), { symptom: 'pain', everyH: '4-6' });
  assert.equal(r.amount.text, '1-2');
  assert.equal(r.amount.n, null);
});

test('ทา / หยอดตา / พ่น ไม่ใส่มื้ออาหาร', () => {
  assert.equal(P.parse('ทาบางๆ บริเวณที่เป็น', 'วันละ 2 ครั้ง เช้า-เย็น', '').route, 'skin');
  const e = P.parse('หยอดตาข้างละ 1 หยด', 'วันละ 4 ครั้ง', '');
  assert.equal(e.route, 'eye'); assert.equal(e.meal, null); assert.equal(e.amount.form, 'drop');
  assert.equal(P.parse('พ่นครั้งละ 2 สูด', 'วันละ 2 ครั้ง เช้า-เย็น', '').route, 'inhaler');
});

test('คำเตือน: ง่วง/เขย่าขวด จากข้อความ, ยาปฏิชีวนะ → กินจนหมด', () => {
  const r = P.parse('รับประทานครั้งละ 1 เม็ด', 'วันละ 1 ครั้ง ก่อนนอน', 'ยานี้อาจทำให้ง่วงนอน', { antibiotic: 'Y', hint: 'เขย่าขวดก่อนใช้' });
  assert.deepEqual(plain(r.warnings).sort(), ['finish', 'shake', 'sleepy']);
});

test('ยาหยอดตาปฏิชีวนะ ไม่ขึ้น "ใช้จนหมด" เอง (เฉพาะยากิน)', () => {
  assert.deepEqual(plain(P.parse('หยอดตาข้างละ 1 หยด', 'วันละ 4 ครั้ง', '', { antibiotic: 'Y' }).warnings), []);
});

for (const [lines, why] of [
  [['รับประทานครั้งละ 1 เม็ด', 'วันเว้นวัน หลังอาหารเช้า', ''], /วันเว้นวัน/],
  [['รับประทานครั้งละ 1 เม็ด', 'สัปดาห์ละ 1 ครั้ง', ''], /สัปดาห์/],
  [['รับประทานครั้งละ 1 เม็ด', 'ทุกวันจันทร์ พุธ ศุกร์', ''], /วันในสัปดาห์/],
  [['off', '', ''], /หยุด/],
  [['รับประทานตามแพทย์สั่ง', '', ''], /แพทย์สั่ง/],
  [['ฉีดใต้ผิวหนัง 16 ยูนิต', 'ก่อนอาหารเช้า', ''], /อินซูลิน/],
  [['รับประทานครั้งละ 1 เม็ด', 'วันละ 2 ครั้ง หลังอาหาร เช้า กลางวัน เย็น', ''], /วันละ 2 ครั้ง แต่ระบุ 3 มื้อ/],
  [['........', '', ''], /ไม่มีวิธีใช้/],
]) {
  test('ไม่ทำฉลากภาพ: ' + lines.join(' ').trim(), () => {
    const r = P.parse(...lines);
    assert.ok(r.error, JSON.stringify(r));
    assert.match(r.error, why);
  });
}

test('ไอคอนพื้นฐานครบสำหรับเวลา/มื้อ/รูปแบบยาที่วาดในฉลาก', () => {
  for (const k of ['morning', 'noon', 'evening', 'bed', 'before', 'after', 'with', 'tablet', 'half', 'capsule', 'tsp', 'drop', 'clock'])
    assert.match(P.ICON[k], /^<svg/, k);
});
