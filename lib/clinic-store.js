/**
 * ClinicStore — เก็บบันทึกคลินิก (visitRecords) ใน Firestore แบบ "เอกสารละเดือน"
 *
 * เดิมเก็บทุกรายการเป็น array เดียวใน pharmacy_tph/clinic_data ซึ่งจะชนเพดาน 1 MB ต่อเอกสารของ Firestore
 * และการบันทึกแบบส่งทั้งก้อนทำให้เครื่องที่บันทึกพร้อมกันเขียนทับรายการของกันและกัน
 *
 *   pharmacy_tph/clinic_YYYY-MM  { list: [visit...], updated }  — แบ่งตามเดือนของ visit.date (~150 KB/เดือน)
 *   pharmacy_tph/clinic_data     { sessionRecords, priceOverrides, patientRoster, deletedVisitIds,
 *                                  visitRecords (ของเดิม — ไม่เขียนเพิ่มแล้ว เก็บไว้เป็นต้นฉบับ/ย้ายเข้าเอกสารรายเดือน) }
 *
 * การเขียนทุกครั้งเป็น transaction: อ่านเอกสารเดือนนั้นล่าสุดจาก server แล้วแทนเฉพาะ id ที่เปลี่ยน
 * การเปลี่ยนแปลงเข้าคิวใน localStorage ก่อน ถ้าเน็ตหลุด/ส่งไม่ผ่าน จะลองส่งใหม่เองจนสำเร็จ
 * รายการที่ลบจะจด id ไว้ใน deletedVisitIds กันไม่ให้ถูกดึงกลับมาจากข้อมูลเดิม
 */
(function () {
  const COL = 'pharmacy_tph';
  const META = 'clinic_data';
  const PREFIX = 'clinic_';

  // เดือนของบันทึก → ชื่อเอกสาร (วันที่ผิดรูปแบบไปรวมที่ clinic_0000-00 ไม่ให้หาย)
  function monthKey(date) {
    return PREFIX + (/^\d{4}-\d{2}/.test(date || '') ? String(date).slice(0, 7) : '0000-00');
  }

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  // ฟังข้อมูลแบบ realtime: เอกสารรายเดือนทั้งหมด + clinic_data แล้วรวมเป็นรายการเดียว
  // onChange({ visits, monthOf: {id: เอกสารเดือน}, legacy: บันทึกเดิมที่ยังไม่ได้ย้าย, meta })
  function watch(db, onChange, onError) {
    let months = null, meta = null;
    const emit = () => {
      if (!months || !meta) return;
      const monthOf = {}, visits = [];
      months.forEach((list, key) => list.forEach(r => {
        if (r && r.id && !monthOf[r.id]) { monthOf[r.id] = key; visits.push(r); }
      }));
      const dead = new Set(meta.deletedVisitIds || []);
      const legacy = (meta.visitRecords || []).filter(r => r && r.id && !monthOf[r.id] && !dead.has(r.id));
      onChange({ visits: visits.concat(legacy), monthOf, legacy, meta });
    };
    const docId = firebase.firestore.FieldPath.documentId();
    // clinic_0 ≤ id < clinic_: ได้เฉพาะ clinic_YYYY-MM (":" อยู่ถัดจาก "9") ไม่รวม clinic_data
    const u1 = db.collection(COL).where(docId, '>=', PREFIX + '0').where(docId, '<', PREFIX + ':')
      .onSnapshot(qs => {
        months = new Map();
        qs.forEach(d => months.set(d.id, (d.data() || {}).list || []));
        emit();
      }, onError);
    const u2 = db.collection(COL).doc(META)
      .onSnapshot(s => { meta = s.exists ? s.data() : {}; emit(); }, onError);
    return () => { u1(); u2(); };
  }

  // ops: [{ id, rec (null = ลบ), from (เอกสารเดือนที่รายการนี้เคยอยู่ ถ้ารู้) }]
  // onlyIfMissing: ใช้ตอนย้ายข้อมูลเดิม — เพิ่มเฉพาะ id ที่ยังไม่มีในเอกสารเดือนนั้น ไม่ทับรายการที่ถูกแก้ไปแล้ว
  async function commit(db, ops, onlyIfMissing) {
    const keys = new Set();
    ops.forEach(o => { if (o.rec) keys.add(monthKey(o.rec.date)); if (o.from) keys.add(o.from); });
    const deleted = ops.filter(o => !o.rec).map(o => o.id);
    const metaRef = db.collection(COL).doc(META);
    await db.runTransaction(async tx => {
      const refs = [...keys].map(k => db.collection(COL).doc(k));
      const snaps = await Promise.all(refs.map(r => tx.get(r)));
      const dead = onlyIfMissing ? new Set(((await tx.get(metaRef)).data() || {}).deletedVisitIds || []) : null;
      refs.forEach((ref, i) => {
        let list = snaps[i].exists ? (snaps[i].data().list || []) : [];
        const mine = ops.filter(o => o.rec && monthKey(o.rec.date) === ref.id);
        if (onlyIfMissing) {
          const have = new Set(list.map(r => r.id));
          const add = mine.filter(o => !have.has(o.id) && !dead.has(o.id));
          if (!add.length) return;
          list = list.concat(add.map(o => o.rec));
        } else {
          const ids = new Set(ops.map(o => o.id));
          list = list.filter(r => !ids.has(r.id)).concat(mine.map(o => o.rec));
        }
        tx.set(ref, { list, updated: Date.now() });
      });
      if (deleted.length) {
        tx.set(metaRef, { deletedVisitIds: firebase.firestore.FieldValue.arrayUnion(...deleted) }, { merge: true });
      }
    });
  }

  // ย้ายบันทึกเดิมใน clinic_data.visitRecords เข้าเอกสารรายเดือน (ทำซ้ำได้ ไม่ซ้ำซ้อน ไม่ทับของที่แก้แล้ว)
  function migrateLegacy(db, legacy) {
    return commit(db, legacy.map(r => ({ id: r.id, rec: r, from: null })), true);
  }

  // คิวการเปลี่ยนแปลงที่ยังส่งไม่สำเร็จ เก็บใน localStorage รอดแม้ปิดหน้าเว็บ แล้วลองส่งใหม่ทุก 15 วินาที/เมื่อเน็ตกลับมา
  function createSync(db, storageKey, onState) {
    let pending = {};
    try { pending = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch (e) { pending = {}; }
    let busy = false, lastError = null;
    const persist = () => { try { localStorage.setItem(storageKey, JSON.stringify(pending)); } catch (e) {} };

    function queue(id, rec, from) {
      const prev = pending[id];
      // from ต้องเป็นที่อยู่บน server ตอนแรกสุด (แก้ซ้ำหลายครั้งก่อนส่งได้ ก็ยังลบจากเดือนเดิมถูก)
      pending[id] = { id, rec: rec ? clone(rec) : null, from: prev ? prev.from : (from || null), v: (prev ? prev.v : 0) + 1 };
      persist(); onState && onState(); flush();
    }

    async function flush() {
      if (busy) return;
      const ops = Object.values(pending);
      if (!ops.length) return;
      busy = true;
      try {
        await commit(db, ops, false);
        ops.forEach(o => { if (pending[o.id] && pending[o.id].v === o.v) delete pending[o.id]; });
        persist(); lastError = null;
      } catch (e) {
        lastError = e; console.warn('ClinicStore sync:', e);
      }
      busy = false;
      onState && onState();
      if (!lastError && Object.keys(pending).length) flush();
    }

    // รายการจาก server + การเปลี่ยนแปลงที่ยังรอส่ง = สิ่งที่ผู้ใช้ควรเห็น
    function overlay(visits) {
      const ids = new Set(Object.keys(pending));
      const out = visits.filter(r => !ids.has(r.id));
      Object.values(pending).forEach(o => { if (o.rec) out.push(clone(o.rec)); });
      return out;
    }

    setInterval(flush, 15000);
    window.addEventListener('online', flush);
    return { queue, flush, overlay, count: () => Object.keys(pending).length, error: () => lastError };
  }

  window.ClinicStore = { monthKey, watch, commit, migrateLegacy, createSync };
})();
