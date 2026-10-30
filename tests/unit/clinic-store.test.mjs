// F04 — ClinicStore: แก้รายการซ้ำระหว่างที่รอบส่งก่อนหน้ายังค้าง ต้องไม่เหลือสำเนาในเดือนกลาง
// Firestore จำลองในหน่วยความจำ (transaction get/set + arrayUnion) — commit แรกหน่วงได้ตามต้องการ
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeContext, loadLib } from '../helpers.mjs';

function fakeDb() {
  const docs = {};   // id → data
  let gate = null;   // Promise ที่ transaction ถัดไปต้องรอก่อน commit (จำลองเน็ตช้า)
  let failNext = false;
  const ref = id => ({ id });
  const db = {
    docs,
    hold() { let release; gate = new Promise(r => { release = r; }); return () => release(); },
    failOnce() { failNext = true; },
    collection: () => ({ doc: ref }),
    async runTransaction(fn) {
      const writes = [];
      const tx = {
        get: async r => ({ exists: r.id in docs, data: () => JSON.parse(JSON.stringify(docs[r.id] || {})) }),
        set: (r, data, opt) => writes.push([r.id, data, opt]),
      };
      await fn(tx);
      const g = gate; gate = null;
      if (g) await g;
      if (failNext) { failNext = false; throw new Error('unavailable'); }
      writes.forEach(([id, data, opt]) => {
        const cur = opt && opt.merge ? Object.assign({}, docs[id]) : {};
        Object.entries(data).forEach(([k, v]) => { cur[k] = v && v.__union ? [...new Set([...(cur[k] || []), ...v.__union])] : v; });
        docs[id] = cur;
      });
    },
  };
  return db;
}

function store(db) {
  const ls = {};
  const ctx = makeContext({
    localStorage: { getItem: k => ls[k] ?? null, setItem: (k, v) => { ls[k] = String(v); } },
    addEventListener: () => {},
    firebase: { firestore: { FieldValue: { arrayUnion: (...a) => ({ __union: a }) } } },
  });
  loadLib(ctx, 'lib/clinic-store.js');
  return ctx.ClinicStore.createSync(db, 'q', () => {});
}
const where = (db, id) => Object.keys(db.docs).filter(k => k.startsWith('clinic_2') && (db.docs[k].list || []).some(r => r.id === id)).sort();
const settle = () => new Promise(r => setTimeout(r, 30));
const rec = (date, note) => ({ id: 'v_test1', date, hn: '9999001', note });

test('F04: ย้าย Aug→Sep→Oct ระหว่างรอบแรกยังส่งไม่เสร็จ → เหลือที่ Oct ที่เดียว', async () => {
  const db = fakeDb();
  db.docs['clinic_2026-08'] = { list: [rec('2026-08-20', 'เดิม')] };
  const s = store(db);
  const release = db.hold();
  s.queue('v_test1', rec('2026-09-20', 'ย้ายไป ก.ย.'), 'clinic_2026-08');
  await settle();
  s.queue('v_test1', rec('2026-10-20', 'ย้ายไป ต.ค.'), 'clinic_2026-08');   // หน้าจอยังคิดว่าอยู่ ส.ค.
  release(); await settle(); await s.flush(); await settle();
  assert.deepEqual(where(db, 'v_test1'), ['clinic_2026-10']);
  assert.equal(db.docs['clinic_2026-10'].list[0].note, 'ย้ายไป ต.ค.');
  assert.equal(s.count(), 0);
});

test('F04: แก้แล้วลบระหว่างส่ง → ไม่เหลือที่ไหนเลย + จด deletedVisitIds', async () => {
  const db = fakeDb();
  db.docs['clinic_2026-08'] = { list: [rec('2026-08-20', 'เดิม')] };
  const s = store(db);
  const release = db.hold();
  s.queue('v_test1', rec('2026-09-20', 'แก้'), 'clinic_2026-08');
  await settle();
  s.queue('v_test1', null, 'clinic_2026-08');
  release(); await settle(); await s.flush(); await settle();
  assert.deepEqual(where(db, 'v_test1'), []);
  assert.deepEqual(db.docs.clinic_data.deletedVisitIds, ['v_test1']);
});

test('F04: สร้างใหม่แล้วเปลี่ยนเดือนระหว่างส่ง → อยู่เดือนสุดท้ายที่เดียว', async () => {
  const db = fakeDb();
  const s = store(db);
  const release = db.hold();
  s.queue('v_test1', rec('2026-09-01', 'ใหม่'), null);
  await settle();
  s.queue('v_test1', rec('2026-10-01', 'เปลี่ยนเดือน'), null);
  release(); await settle(); await s.flush(); await settle();
  assert.deepEqual(where(db, 'v_test1'), ['clinic_2026-10']);
});

test('F04: รอบแรกส่งไม่ผ่าน แล้วส่งใหม่ (retry) → ไม่ซ้ำ', async () => {
  const db = fakeDb();
  db.docs['clinic_2026-08'] = { list: [rec('2026-08-20', 'เดิม')] };
  const s = store(db);
  db.failOnce();
  s.queue('v_test1', rec('2026-09-20', 'ก.ย.'), 'clinic_2026-08');
  await settle();
  assert.equal(s.count(), 1, 'ยังรอส่ง');
  s.queue('v_test1', rec('2026-10-20', 'ต.ค.'), 'clinic_2026-08');
  await settle(); await s.flush(); await settle();
  assert.deepEqual(where(db, 'v_test1'), ['clinic_2026-10']);
  assert.equal(s.count(), 0);
});
