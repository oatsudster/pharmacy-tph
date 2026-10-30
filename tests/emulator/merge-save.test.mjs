// F03/F08 กับ Firestore Emulator จริง (โปรเจกต์ demo-* ไม่มีทางแตะ production) + firestore.rules ของ repo
// รัน: cd tests && npm run test:emulator   (ต้องมี Java 11+)
// 2 client = 2 Firebase app แยกกัน เหมือน 2 เครื่องในห้องยา · ข้อมูลสมมติทั้งหมด
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { read } from '../helpers.mjs';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-pharmacy-tph';
assert.match(PROJECT, /^demo-/, 'ต้องรันกับโปรเจกต์ demo-* ของ emulator เท่านั้น');
const [HOST, PORT] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085').split(':');

globalThis.firebase = firebase;
vm.runInThisContext(read('lib/fs-merge-save.js'));
const M = globalThis.TphMergeSave;

let n = 0;
function client() {
  const app = firebase.initializeApp({ projectId: PROJECT, apiKey: 'demo' }, 'c' + (++n));
  const db = app.firestore();
  db.useEmulator(HOST, +PORT);
  return db;
}
const A = client(), B = client(), ADMIN = client();
const DOC = 'adr_records';   // id ที่ rules อนุญาตให้เขียน
const ids = list => list.map(r => r.id).sort();
const settle = (ms = 300) => new Promise(r => setTimeout(r, ms));

// เหมือนหน้าเว็บ: ฟัง snapshot แล้วส่งให้ tracker.seen ทุกครั้ง
function attach(db, spec = { arrays: ['records'] }) {
  const ref = db.collection('pharmacy_tph').doc(DOC);
  const t = M.tracker(ref, spec);
  const state = { data: null, status: null, t, ref };
  state.stop = ref.onSnapshot({ includeMetadataChanges: true }, s => { t.seen(s.exists ? s.data() : null); state.data = s.exists ? s.data() : null; state.status = M.status(s); });
  return state;
}
async function reset(data) {
  await ADMIN.collection('pharmacy_tph').doc(DOC).set(data);
  await settle();
}
const rec = (id, extra) => Object.assign({ id, date: '2026-10-30', drug: 'ยาทดสอบ', hn: '9999001' }, extra);

test('F03 (กลไกบั๊กเดิม): set ทั้งชุดจาก 2 เครื่อง → รายการของเครื่องแรกหาย', async () => {
  await reset({ records: [rec('orig')] });
  const a = [rec('orig'), rec('added-A')], b = [rec('orig'), rec('added-B')];   // ทั้งคู่เริ่มจาก original
  await A.collection('pharmacy_tph').doc(DOC).set({ records: a });
  await B.collection('pharmacy_tph').doc(DOC).set({ records: b });
  const d = (await ADMIN.collection('pharmacy_tph').doc(DOC).get()).data();
  assert.deepEqual(ids(d.records), ['added-B', 'orig']);   // added-A หาย = ยืนยันบั๊กตามรายงาน
});

test('F03: 2 เครื่องเพิ่มคนละรายการจาก base เดียวกัน → ครบทั้งคู่', async () => {
  await reset({ records: [rec('orig')] });
  const a = attach(A), b = attach(B);
  await settle();
  const localA = [rec('added-A'), rec('orig')], localB = [rec('added-B'), rec('orig')];
  b.stop();                                   // B ไม่เห็นของ A ก่อนบันทึก (ชนกันจริง)
  await a.t.save({ records: localA });
  await b.t.save({ records: localB });
  a.stop();
  const d = (await ADMIN.collection('pharmacy_tph').doc(DOC).get()).data();
  assert.deepEqual(ids(d.records), ['added-A', 'added-B', 'orig']);
});

test('F03: A ลบ / B (base เก่า) แก้รายการอื่น → ที่ลบไม่ฟื้นกลับ, ที่แก้เข้า', async () => {
  await reset({ records: [rec('x'), rec('y')] });
  const a = attach(A), b = attach(B);
  await settle();
  b.stop();
  await a.t.save({ records: [rec('y')] });                                  // A ลบ x
  await b.t.save({ records: [rec('x'), rec('y', { drug: 'แก้โดย B' })] });   // B ยังเห็น x อยู่
  a.stop();
  const d = (await ADMIN.collection('pharmacy_tph').doc(DOC).get()).data();
  assert.deepEqual(d.records, [rec('y', { drug: 'แก้โดย B' })]);
});

test('F03: แก้รายการเดียวกันพร้อมกัน → เหลือรายการเดียว (ตัวที่ถึงทีหลังชนะ)', async () => {
  await reset({ records: [rec('z')] });
  const a = attach(A), b = attach(B);
  await settle();
  b.stop();
  await a.t.save({ records: [rec('z', { drug: 'A' })] });
  await b.t.save({ records: [rec('z', { drug: 'B' })] });
  a.stop();
  const raw = (await ADMIN.collection('pharmacy_tph').doc(DOC).get()).data().records;
  assert.deepEqual(M.dedupeBy(raw, 'id'), [rec('z', { drug: 'B' })]);
  // บันทึกครั้งถัดไปจากหน้าเว็บ (base = raw, local = dedupe) ล้างสำเนาเก่าบน server ให้เอง
  const c = attach(A); await settle();
  await c.t.save({ records: M.dedupeBy(c.data.records, 'id') });
  c.stop();
  assert.deepEqual((await ADMIN.collection('pharmacy_tph').doc(DOC).get()).data().records, [rec('z', { drug: 'B' })]);
});

test('F03: บันทึกซ้อน 2 ครั้งติดกันก่อน snapshot มา → ไม่ค้างฉบับกลาง', async () => {
  await reset({ records: [rec('q')] });
  const a = attach(A); await settle();
  const p1 = a.t.save({ records: [rec('q', { drug: 'v1' })] });
  const p2 = a.t.save({ records: [rec('q', { drug: 'v2' })] });
  await Promise.all([p1, p2]); a.stop();
  assert.deepEqual((await ADMIN.collection('pharmacy_tph').doc(DOC).get()).data().records, [rec('q', { drug: 'v2' })]);
});

test('F03: ฟิลด์ map (expiry tracker) — แก้คนละ key / ลบ key / key มีจุด → รวมครบ', async () => {
  const spec = { maps: ['overrides', 'boxChecked'], arrays: ['removed'] };
  await reset({ overrides: { 'd.1': { exp: '2027-01-01' } }, boxChecked: { b1: '2026-10-01' }, removed: [] });
  const a = attach(A, spec), b = attach(B, spec);
  await settle();
  b.stop();
  await a.t.save({ overrides: { 'd.1': { exp: '2027-01-01' }, d2: { qty: 5 } }, boxChecked: { b1: '2026-10-01' }, removed: ['r1'] });
  await b.t.save({ overrides: { 'd.1': { exp: '2027-02-02' } }, boxChecked: {}, removed: [] });
  a.stop();
  const d = (await ADMIN.collection('pharmacy_tph').doc(DOC).get()).data();
  assert.deepEqual(d.overrides, { 'd.1': { exp: '2027-02-02' }, d2: { qty: 5 } });
  assert.deepEqual(d.boxChecked, {});
  assert.deepEqual(d.removed, ['r1']);
});

test('F03: เอกสารยังไม่มีบน server → สร้างได้ ไม่ error', async () => {
  await ADMIN.collection('pharmacy_tph').doc(DOC).delete(); await settle();
  const a = attach(A); await settle();
  await a.t.save({ records: [rec('first')] });
  a.stop();
  assert.deepEqual(ids((await ADMIN.collection('pharmacy_tph').doc(DOC).get()).data().records), ['first']);
});

test('F08: ออฟไลน์ → สถานะ pending (ไม่ใช่ "ซิงค์แล้ว") → ต่อเน็ตแล้ว server', async () => {
  await reset({ records: [rec('o')] });
  const a = attach(A); await settle();
  assert.equal(a.status, 'server');
  await A.disableNetwork();
  a.t.save({ records: [rec('o'), rec('offline-add')] });   // ออฟไลน์: promise ค้างจนกว่าจะส่งได้
  await settle();
  assert.equal(a.status, 'pending');
  assert.deepEqual(ids(a.data.records), ['o', 'offline-add']);                          // เห็นในเครื่องทันที
  assert.deepEqual(ids((await ADMIN.collection('pharmacy_tph').doc(DOC).get()).data().records), ['o']);   // server ยังไม่ได้
  await A.enableNetwork();
  await settle(800);
  assert.equal(a.status, 'server');
  assert.deepEqual(ids((await ADMIN.collection('pharmacy_tph').doc(DOC).get()).data().records), ['o', 'offline-add']);
  a.stop();
});

test('F08: เปิดหน้าตอนต่อ server ไม่ได้ → สถานะ cache', async () => {
  const C = client();
  await C.disableNetwork();
  const ref = C.collection('pharmacy_tph').doc(DOC);
  const st = await new Promise(res => { const u = ref.onSnapshot({ includeMetadataChanges: true }, s => { u(); res(M.status(s)); }, () => res('error')); });
  assert.equal(st, 'cache');
});

test('F08: server ปฏิเสธ (rules) → save reject ให้หน้าเว็บขึ้นป้าย error', async () => {
  const ref = A.collection('pharmacy_tph').doc('not_in_rules_list');
  const t = M.tracker(ref, { arrays: ['records'] });
  await assert.rejects(t.save({ records: [rec('nope')] }), /permission|PERMISSION/i);
});

// F01 — บันทึกพฤติกรรมของ rules ปัจจุบันไว้ (ไม่แก้ในรอบนี้: ต้องมี Firebase Auth + deploy rules)
test('F01: rules ปัจจุบันให้ client ที่ไม่ login อ่าน/เขียนเอกสารที่อนุญาตได้', { todo: 'ต้องย้ายไป Firebase Auth ก่อน แล้ว test นี้ต้องกลับเป็น "ถูกปฏิเสธ"' }, async () => {
  const C = client();
  await C.collection('pharmacy_tph').doc(DOC).set({ records: [] });   // ไม่มี auth แต่เขียนได้
  assert.fail('unauthenticated write ไม่ควรสำเร็จ');
});
