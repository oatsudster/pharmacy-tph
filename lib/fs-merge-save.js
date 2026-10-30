/**
 * fs-merge-save.js — บันทึกเอกสาร Firestore แบบส่งเฉพาะส่วนที่เปลี่ยน + สถานะซิงค์ที่ยืนยันกับ server จริง
 *
 * ปัญหาเดิม (F03): หน้าเว็บบันทึกด้วย set({ records: ทั้งชุด }) — 2 เครื่องเพิ่มรายการคนละตัวพร้อมกัน
 *   เครื่องที่บันทึกทีหลังเขียนทับ รายการของอีกเครื่องหาย
 * วิธีใหม่: เทียบกับข้อมูลล่าสุดที่เห็นจาก server (base) แล้วส่งเฉพาะ operation
 *   - ฟิลด์ array (spec.arrays): ทั้งรายการเป็นหน่วย — เพิ่ม = arrayUnion, ลบ = arrayRemove, แก้ = เอาตัวเดิมออก + ใส่ตัวใหม่
 *   - ฟิลด์ map (spec.maps): แก้/ลบเฉพาะ key ที่เปลี่ยน (FieldPath ใช้ได้กับ key ทุกตัวอักษร)
 *   server รวมให้เองแบบ atomic ทำงานตอนออฟไลน์ได้ (เข้าคิวของ Firestore เหมือน set เดิม — transaction ทำไม่ได้)
 * นโยบายชนกัน: แก้รายการเดียวกันพร้อมกัน = ตัวที่ถึง server ทีหลังชนะ (dedupeBy เก็บตัวท้าย)
 *   ลบ vs แก้พร้อมกัน = ฉบับแก้ยังอยู่ · รายการเรียงใหม่ตามเวลาในหน้าเว็บ (arrayUnion ต่อท้ายเสมอ)
 *
 *   const t = TphMergeSave.tracker(docRef, { arrays: ['records'] });
 *   docRef.onSnapshot({ includeMetadataChanges: true }, snap => { t.seen(snap.exists ? snap.data() : null); ... TphMergeSave.status(snap) });
 *   await t.save({ records }, { updated: new Date().toISOString() });
 *
 * สถานะ (F08): status(snap) → 'server' (ยืนยันกับ server แล้ว) | 'pending' (บันทึกในเครื่อง รอส่ง) | 'cache' (ข้อมูลเก่าในเครื่อง ยังต่อ server ไม่ได้)
 */
(function (root) {
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  function arrayDiff(base, local) {
    const b = new Map(), l = new Map();
    (base || []).forEach(x => b.set(canon(x), x));
    (local || []).forEach(x => l.set(canon(x), x));
    return {
      remove: [...b].filter(([k]) => !l.has(k)).map(([, x]) => x),
      add: [...l].filter(([k]) => !b.has(k)).map(([, x]) => x),
    };
  }
  function mapDiff(base, local) {
    base = base || {}; local = local || {};
    const set = {}, del = [];
    Object.keys(local).forEach(k => { if (!(k in base) || canon(base[k]) !== canon(local[k])) set[k] = local[k]; });
    Object.keys(base).forEach(k => { if (!(k in local)) del.push(k); });
    return { set, del };
  }

  // base = null: ไม่รู้ค่าบน server (ยังโหลดไม่ได้ / ไม่มีเอกสาร) → รวมแบบเพิ่มอย่างเดียว ไม่ลบของใคร
  function save(ref, base, local, spec, extra) {
    const FV = root.firebase.firestore.FieldValue, FP = root.firebase.firestore.FieldPath;
    const arrays = spec.arrays || [], maps = spec.maps || [];
    if (!base) {
      const data = Object.assign({}, extra);
      arrays.forEach(f => { if ((local[f] || []).length) data[f] = FV.arrayUnion(...local[f]); });
      maps.forEach(f => { if (local[f] && Object.keys(local[f]).length) data[f] = local[f]; });
      return ref.set(data, { merge: true });
    }
    // update เดียวกันใส่ arrayRemove กับ arrayUnion ของฟิลด์เดียวกันไม่ได้ → 2 update ใน batch เดียว (atomic, ตามลำดับ)
    const first = [], second = [];
    arrays.forEach(f => {
      const d = arrayDiff(base[f], local[f]);
      if (d.remove.length) first.push(new FP(f), FV.arrayRemove(...d.remove));
      if (d.add.length) second.push(new FP(f), FV.arrayUnion(...d.add));
    });
    maps.forEach(f => {
      const d = mapDiff(base[f], local[f]);
      Object.keys(d.set).forEach(k => first.push(new FP(f, k), d.set[k]));
      d.del.forEach(k => first.push(new FP(f, k), FV.delete()));
    });
    if (!first.length && !second.length) return Promise.resolve(false);
    Object.entries(extra || {}).forEach(([k, v]) => (first.length ? first : second).push(new FP(k), v));
    const batch = ref.firestore.batch();
    if (first.length) batch.update(ref, ...first);
    if (second.length) batch.update(ref, ...second);
    return batch.commit().then(() => true);
  }

  function tracker(ref, spec) {
    const fields = (spec.arrays || []).concat(spec.maps || []);
    const pick = d => { const o = {}; fields.forEach(f => { if (d && d[f] !== undefined) o[f] = clone(d[f]); }); return o; };
    let base = null;
    return {
      // ทุก snapshot (รวมของที่ตัวเองเพิ่งบันทึก) — null = ไม่มีเอกสารบน server
      seen(data) { base = data ? pick(data) : null; },
      // ตั้ง base เป็นค่าที่ส่งไปทันที: บันทึกซ้อนก่อน snapshot ของรอบแรกมาถึง จะไม่ส่ง operation ซ้ำ/ค้างสำเนาเก่า
      save(local, extra) { const b = base; base = pick(local); return save(ref, b, local, spec, extra); },
    };
  }

  // รายการ id เดียวกันหลายตัว (แก้พร้อมกัน 2 เครื่อง) → เก็บตัวท้ายสุด = ที่ถึง server ทีหลัง
  function dedupeBy(list, key) {
    const last = new Map();
    (list || []).forEach((x, i) => { if (x && x[key] != null) last.set(x[key], i); });
    return (list || []).filter((x, i) => !x || x[key] == null || last.get(x[key]) === i);
  }

  function status(snap) {
    const m = snap && snap.metadata;
    if (!m) return 'server';
    if (m.hasPendingWrites) return 'pending';
    return m.fromCache ? 'cache' : 'server';
  }
  const STATUS_TEXT = {
    server: t => '☁️ ซิงค์แล้ว ' + t,
    pending: () => '⏳ บันทึกในเครื่องแล้ว รอส่งขึ้น server',
    cache: () => '📦 ข้อมูลในเครื่อง — ยังไม่ได้ยืนยันกับ server',
    error: () => '⚠️ บันทึกขึ้น server ไม่สำเร็จ (ข้อมูลยังอยู่ในเครื่องนี้)',
  };
  const STATUS_COLOR = { server: ['#d1fae5', '#065f46'], pending: ['#fef9c3', '#78350f'], cache: ['#fef9c3', '#78350f'], error: ['#fee2e2', '#991b1b'] };
  // ป้ายสถานะร่วมของทุกหน้า
  function badge(el, st, timeText) {
    if (!el) return;
    el.textContent = STATUS_TEXT[st](timeText || '');
    el.style.background = STATUS_COLOR[st][0];
    el.style.color = STATUS_COLOR[st][1];
    el.style.opacity = '1';
  }

  root.TphMergeSave = { canon, arrayDiff, mapDiff, save, tracker, dedupeBy, status, badge };
})(typeof window !== 'undefined' ? window : globalThis);
