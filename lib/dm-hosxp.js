// DM Remission ↔ ฐานข้อมูล HOSxP (ผ่าน HOSxP Bridge — เฉพาะเครื่อง รพ. ที่ติดตั้ง bridge พร้อม db.json)
//   ซิงค์อัตโนมัติทุกครั้งที่เปิดหน้า (dmHxSyncAll):
//     - คนไข้ที่มีนัดคลินิก NCDs remission (clinic 032) แต่ยังไม่อยู่ในรายชื่อ → เพิ่มให้ (อายุ/โรคประจำตัวจาก HOSxP)
//     - วันเข้าคลินิกที่ยังไม่มี visit → สร้าง visit (สัญญาณชีพ + lab ล่าสุดภายใน 60 วัน + ยาที่ได้ + ค่ายา)
//     - visit ที่บันทึกไว้แล้ว → เติมเฉพาะช่องที่ยังว่าง ไม่ทับค่าที่มีอยู่ และไม่แตะช่องที่เภสัชเขียนเอง (DRP/การเปลี่ยนยา/หมายเหตุ/ยาเหลือ)
//     - ค่ายาลดน้ำตาลต่อวันก่อนเข้าโครงการ (baseline) ที่ยังไม่ได้กรอก → คำนวณจาก visit ล่าสุดก่อนเข้าคลินิกที่มียาลดน้ำตาล
//   หน้าบันทึก: ปุ่มวันที่จาก HOSxP — วันที่บันทึกแล้วเปิดแก้ไข, วันที่ยังไม่มีกรอกฟอร์มให้ตรวจก่อนบันทึก
//   หน้าคัดกรอง: คนไข้คลินิกเบาหวาน (นัด LAB / DM) ที่เข้าเกณฑ์ภาวะสงบแล้ว หรือใกล้เข้าเกณฑ์
// ใช้ฟังก์ชัน/ตัวแปรของหน้า dm-remission.html: PATIENTS, getVisits, _fbMutateVisits, _patientsDoc, convertDosage, applyParsedData ฯลฯ
(function () {
  if (!window.tphHosxp) return;
  const esc = s => (window.escHtml ? escHtml(String(s ?? '')) : String(s ?? ''));
  const num = v => { const m = String(v ?? '').match(/-?\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : null; };
  const numStr = v => { const n = num(v); return n == null ? null : String(+n.toFixed(2)); };
  const thd = iso => tphHosxp.thDate(iso);
  const hn7 = h => String(h || '').trim().padStart(7, '0');
  const patientByHn = hn => PATIENTS.find(p => hn7(p.hn) === hn7(hn));
  const visitCache = {};   // hn → ผลจาก /db/dmvisits
  const DX_NAME = { E11: 'DM type 2', E10: 'DM type 1', E14: 'DM', I10: 'HT', I11: 'HT', E78: 'DLP', N18: 'CKD', I25: 'IHD', I63: 'Stroke', J44: 'COPD', J45: 'Asthma', E66: 'Obesity', M10: 'Gout', K76: 'Fatty liver' };
  const dxText = codes => [...new Set((codes || []).map(c => DX_NAME[c]).filter(Boolean))].join(', ');

  async function hxVisits(hn, dates) {
    const key = hn + '|' + (dates || []).join(',');
    if (!visitCache[key]) {
      const r = await tphHosxp.dmVisits(hn, dates);
      if (r) visitCache[key] = r;
    }
    return visitCache[key] || null;
  }

  // ยา 1 รายการจาก HOSxP → รูปแบบเดียวกับที่หน้านี้ใช้ (วิธีใช้แบบ "1x2 pc" ให้คำนวณค่ายาต่อวันได้)
  function toDrug(d) {
    const price = num(d.price) || 0, qty = num(d.qty) || 0;
    const dose = typeof convertDosage === 'function' ? convertDosage(d.usage || '', d.dose ? String(+num(d.dose)) : '', d.freqCode || '', d.timeCode || '') : (d.usage || '');
    return { name: d.name, dose, unit: d.unit || '', price, qty, stock: null, total: +(price * qty).toFixed(2), usage: d.usage || '' };
  }
  // ข้อมูล 1 วันจาก HOSxP → รูปแบบเดียวกับที่ parseHosXPText คืน (ใช้ applyParsedData ตัวเดิมกรอกฟอร์ม)
  function toParsed(v) {
    const L = v.lab || {};
    return {
      visitDate: v.date, weight: numStr(v.weight), height: numStr(v.height), bp: v.bp || '', dtx: numStr(v.dtx),
      fbs: numStr(L.fbs), hba1c: numStr(L.hba1c), ldl: numStr(L.ldl), tc: numStr(L.tc), tg: numStr(L.tg),
      cr: numStr(L.cr), egfr: numStr(L.egfr), urineAlb: numStr(L.urineAlb),
      drugs: (v.drugs || []).map(toDrug).map(x => ({ name: x.name, unit: x.unit, price: x.price, dosage: x.dose, qty: x.qty })),
      isClinicVisit: true,
    };
  }
  const AUTO_FIELDS = ['weight', 'height', 'bmi', 'bp', 'dtx', 'fbs', 'hba1c', 'ldl', 'tc', 'tg', 'cr', 'egfr', 'urineAlb'];
  function dbFields(v) {
    const d = toParsed(v), w = num(d.weight), h = num(d.height);
    return { weight: d.weight, height: d.height, bmi: w && h ? (w / (h / 100) ** 2).toFixed(1) : numStr(v.bmi), bp: d.bp, dtx: d.dtx,
      fbs: d.fbs, hba1c: d.hba1c, ldl: d.ldl, tc: d.tc, tg: d.tg, cr: d.cr, egfr: d.egfr, urineAlb: d.urineAlb };
  }
  function toVisit(p, v) {
    const f = dbFields(v), drugs = (v.drugs || []).map(toDrug);
    const out = { id: 'v_hx_' + hn7(p.hn) + '_' + v.date, patientId: p.id, patientName: p.name, date: v.date };
    AUTO_FIELDS.forEach(k => out[k] = f[k] || '');
    return Object.assign(out, { drugs, drugChange: '', drugProblem: '', note: '', source: 'hosxp',
      grandTotal: +drugs.reduce((s, x) => s + x.total, 0).toFixed(2), savedAt: new Date().toISOString() });
  }
  // visit ที่มีอยู่: สัญญาณชีพ/lab/รายการยา เติมเฉพาะที่ยังว่าง · วิธีใช้ยาที่เคยวางแล้วแยกผิด (เช่น "12x1" แทน "1x2"
  // ทำให้ค่ายาต่อวันเพี้ยน) แก้ให้ตรง HOSxP เก็บค่าเดิมไว้ใน doseBefore
  // คืน { filled, drugsFixed }
  function fillEmpty(vis, v) {
    const f = dbFields(v);
    let filled = false, drugsFixed = false;
    AUTO_FIELDS.forEach(k => { if ((vis[k] == null || vis[k] === '') && f[k]) { vis[k] = f[k]; filled = true; } });
    if ((v.drugs || []).length) {
      const db = v.drugs.map(toDrug);
      if (!(vis.drugs || []).length) {
        vis.drugs = db; vis.grandTotal = +db.reduce((s, x) => s + x.total, 0).toFixed(2); filled = true;
      } else {
        // แก้เฉพาะวิธีใช้ของยาตัวเดียวกัน (ชื่อ/ราคา/จำนวนที่บันทึกไว้คงเดิม — ราคาในหน้านี้อาจมาจากรายการราคาของห้องยา)
        vis.drugs.forEach(o => {
          const d = db.find(x => baseName(x.name) === baseName(o.name));
          if (d && d.dose && o.dose !== d.dose) { o.doseBefore = o.doseBefore || o.dose; o.dose = d.dose; drugsFixed = true; }
        });
      }
    }
    if (filled || drugsFixed) vis.hxFilledAt = new Date().toISOString();
    return { filled, drugsFixed };
  }
  // การเปลี่ยนแปลงยาโรคเรื้อรังเทียบ visit ก่อนหน้า (เฉพาะ visit ที่ช่องนี้ยังว่าง) — ขึ้นต้น 🗄 ให้รู้ว่าระบบสรุปเอง
  const baseName = n => String(n || '').toLowerCase().replace(/^\s*[\[(][^\])]*[\])]\s*/, '').replace(/\(.*?\)/g, '').replace(/[\d.,]+\s*(mg|mcg|g|ml|iu|units?)\.?.*$/i, '').replace(/\s+/g, ' ').trim();
  const chronic = d => (typeof classifyDrugClass === 'function' && classifyDrugClass(d.name)) || isDiabetesDrug(d.name);
  function drugDiff(prev, cur) {
    const a = new Map((prev.drugs || []).filter(chronic).map(d => [baseName(d.name), d]));
    const b = new Map((cur.drugs || []).filter(chronic).map(d => [baseName(d.name), d]));
    const stop = [...a.keys()].filter(k => !b.has(k)), start = [...b.keys()].filter(k => !a.has(k));
    const dose = [...b.keys()].filter(k => a.has(k) && a.get(k).dose && b.get(k).dose && a.get(k).dose !== b.get(k).dose)
      .map(k => `${k} ${a.get(k).dose} → ${b.get(k).dose}`);
    const parts = [stop.length && 'หยุด: ' + stop.join(', '), start.length && 'เริ่ม: ' + start.join(', '), dose.length && 'ปรับขนาด: ' + dose.join(', ')].filter(Boolean);
    return parts.length ? '🗄 ' + parts.join(' · ') : '';
  }
  function autoDrugChanges(list) {
    let n = 0;
    const byPid = {};
    list.forEach(v => (byPid[v.patientId] = byPid[v.patientId] || []).push(v));
    Object.values(byPid).forEach(vs => {
      vs.sort((x, y) => x.date.localeCompare(y.date));
      let prev = null;
      vs.forEach(v => {
        if (!(v.drugs || []).length) return;
        if (prev && !v.drugChange) { const t = drugDiff(prev, v); if (t) { v.drugChange = t; v.drugChangeAuto = true; n++; } }
        prev = v;
      });
    });
    return n;
  }
  function ageFrom(bd) {
    if (!bd) return '';
    const b = new Date(bd), now = new Date();
    return String(now.getFullYear() - b.getFullYear() - ((now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) ? 1 : 0));
  }

  // ── ซิงค์ทั้งคลินิก ────────────────────────────────────────
  let syncing = false;
  // opts.dryRun: คำนวณว่าจะเพิ่ม/เติมอะไรบ้างโดยไม่เขียนอะไรเลย (คืน { addedPts, baseSet, created, filled, sample })
  async function syncAll(manual, opts = {}) {
    if (syncing) return;
    const dry = !!opts.dryRun;
    syncing = true;
    const btn = document.getElementById('ig-sync');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังซิงค์…'; }
    try {
      const roster = await tphHosxp.dmRoster();
      if (!roster) { if (manual) showToast('⚠️ ต่อฐานข้อมูล HOSxP ไม่ได้ — ใช้ได้เฉพาะเครื่อง รพ. ที่ติดตั้ง HOSxP Bridge ตัวใหม่'); return; }
      // คนไข้ปัจจุบัน (อ่านจาก Firebase ใหม่ ไม่ใช้ค่าในหน้าที่อาจยังโหลดไม่เสร็จ)
      const pDoc = (typeof _patientsDoc === 'function') ? _patientsDoc() : null;
      let list = PATIENTS.slice(), baseDay = loadBaseline();
      if (pDoc) { const snap = await pDoc.get(); if (snap.exists) { list = snap.data().list || list; baseDay = snap.data().baselineDay || baseDay; } }
      const byHn = {};
      list.forEach(p => { if (p.hn) byHn[hn7(p.hn)] = p; });
      (roster.patients || []).forEach(r => { if (!byHn[hn7(r.hn)]) byHn[hn7(r.hn)] = { _new: true, id: 'pt_hx_' + hn7(r.hn), hn: hn7(r.hn), name: r.name, birthday: r.birthday }; });
      // ข้อมูลจาก HOSxP ของทุกคน (ส่งวันที่ของ visit ที่บันทึกไว้แล้วไปด้วย เพื่อเติมช่องว่างของ visit นอกวันคลินิก)
      const visitsNow = getVisits();
      const results = [];
      for (const hn of Object.keys(byHn)) {
        const p = byHn[hn];
        const dates = visitsNow.filter(v => v.patientId === p.id).map(v => v.date).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
        const r = await hxVisits(hn, [...new Set(dates)]);
        if (r) results.push({ p, r });
      }
      // คนไข้ใหม่ + อายุ/โรค/ค่ายาก่อนเข้าโครงการที่ยังว่าง
      let addedPts = 0, baseSet = 0;
      const patientUpdate = cur => {
        const out = cur.slice(), base = Object.assign({}, cur._base || {});
        results.forEach(({ p, r }) => {
          let x = out.find(q => hn7(q.hn) === hn7(p.hn));
          if (!x) {
            const first = p.name.replace(/^(นาย|นางสาว|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.)/, '').split(/\s+/)[0] || p.name;
            x = { id: p.id, name: p.name, shortName: first, hn: p.hn, age: ageFrom(p.birthday), dx: dxText(r.dx) || 'DM type 2', source: 'hosxp' };
            out.push(x); addedPts++;
          } else if (!x.dx && r.dx && r.dx.length) x.dx = dxText(r.dx);
          const bv = (r.visits || []).find(v => v.kind === 'baseline');
          if (bv && !(parseFloat(base[x.id]) > 0)) {
            const daily = dmDaily({ drugs: (bv.drugs || []).map(toDrug) });
            if (daily > 0) { base[x.id] = +daily.toFixed(2); baseSet++; }
          }
        });
        return { list: out, base };
      };
      let finalPts;
      if (dry) {
        const c = JSON.parse(JSON.stringify(list)); c._base = Object.assign({}, baseDay);
        finalPts = patientUpdate(c);
        let created = 0, filled = 0, fixed = 0; const cur = JSON.parse(JSON.stringify(getVisits())), sample = [];
        results.forEach(({ p, r }) => {
          const pt = finalPts.list.find(q => hn7(q.hn) === hn7(p.hn));
          (r.visits || []).forEach(v => {
            if (v.kind === 'baseline') return;
            const ex = cur.find(x => x.patientId === pt.id && x.date === v.date);
            if (ex) { const r2 = fillEmpty(ex, v); if (r2.filled) filled++; if (r2.drugsFixed) fixed++; }
            else if (v.kind === 'clinic') { created++; if (sample.length < 10) sample.push(['new', pt.shortName, v.date, toVisit(pt, v)]); }
          });
        });
        const chg = autoDrugChanges(cur);
        return { addedPts, baseSet, created, filled, fixed, changes: chg, sample, base: finalPts.base,
          changeSample: cur.filter(v => v.drugChangeAuto).slice(0, 6).map(v => [v.patientName, v.date, v.drugChange]),
          doseSample: cur.flatMap(v => (v.drugs || []).filter(d => d.doseBefore).map(d => [v.date, d.name, d.doseBefore, d.dose])) };
      } else if (pDoc) {
        finalPts = await firebase.firestore().runTransaction(async tx => {
          const snap = await tx.get(pDoc);
          const cur = snap.exists ? (snap.data().list || []) : list;
          cur._base = snap.exists ? (snap.data().baselineDay || {}) : baseDay;
          addedPts = 0; baseSet = 0;
          const u = patientUpdate(cur);
          if (addedPts || baseSet) tx.set(pDoc, { list: u.list, baselineDay: u.base, updated: Date.now() }, { merge: true });
          return u;
        });
      } else {
        list._base = baseDay; finalPts = patientUpdate(list);
        if (addedPts) savePatients(finalPts.list);
      }
      PATIENTS = finalPts.list;
      localStorage.setItem('dm_patients', JSON.stringify(PATIENTS));
      if (baseSet) localStorage.setItem('dm_baseline_day', JSON.stringify(finalPts.base));
      // visit: สร้างวันคลินิกที่ยังไม่มี + เติมช่องว่าง (transaction เดียว ไม่ทับงานของเครื่องอื่น)
      let created = 0, filled = 0, changes = 0, fixed = 0;
      const mutate = cur => {
        created = 0; filled = 0; fixed = 0;
        results.forEach(({ p, r }) => {
          const pt = PATIENTS.find(q => hn7(q.hn) === hn7(p.hn));
          if (!pt) return;
          (r.visits || []).forEach(v => {
            if (v.kind === 'baseline') return;
            const ex = cur.find(x => x.patientId === pt.id && x.date === v.date);
            if (ex) { const r2 = fillEmpty(ex, v); if (r2.filled) filled++; if (r2.drugsFixed) fixed++; }
            else if (v.kind === 'clinic') { cur.push(toVisit(pt, v)); created++; }
          });
        });
        changes = autoDrugChanges(cur);
        return cur;
      };
      if (_db) await _fbMutateVisits(mutate);
      else { mutate(_visitsCache); _localSave(); }
      window._dmHxLastSync = Date.now();
      if (typeof rebuildAllStrips === 'function') rebuildAllStrips();
      if (typeof _afterChange === 'function') _afterChange();
      const msg = [addedPts && `เพิ่มคนไข้ ${addedPts} ราย`, created && `เพิ่ม visit ${created} ครั้ง`, filled && `เติมข้อมูล ${filled} ครั้ง`, fixed && `แก้วิธีใช้ยาให้ตรง HOSxP ${fixed} ครั้ง`, changes && `สรุปการเปลี่ยนยา ${changes} ครั้ง`, baseSet && `ค่ายาก่อนเข้าโครงการ ${baseSet} ราย`].filter(Boolean);
      if (msg.length || manual) showToast('🗄 ซิงค์จาก HOSxP: ' + (msg.join(' · ') || 'ข้อมูลเป็นปัจจุบันแล้ว'));
    } catch (e) {
      console.error('dmHxSyncAll', e);
      if (manual) showToast('⚠️ ซิงค์จาก HOSxP ไม่สำเร็จ: ' + e.message);
    } finally {
      syncing = false;
      if (window.renderInfographic) renderInfographic();
    }
  }
  window.dmHxSyncAll = syncAll;

  // ── หน้าบันทึก ─────────────────────────────────────────────
  async function renderEntryCard() {
    const card = document.getElementById('hx-card'), body = document.getElementById('hx-body');
    if (!card || !body) return;
    const p = currentPatient;
    if (!p || !p.hn) { card.style.display = 'none'; return; }
    card.style.display = '';
    body.innerHTML = '<span class="hx-muted">⏳ กำลังอ่านจาก HOSxP…</span>';
    const r = await hxVisits(hn7(p.hn));
    if (currentPatient !== p) return;
    if (!r) { card.style.display = 'none'; showPaste(true); return; }   // เครื่องนี้ไม่มี bridge/DB — ใช้วางข้อความเหมือนเดิม
    showPaste(false);
    const vs = (r.visits || []).filter(v => v.kind !== 'baseline');
    if (!vs.length) { body.innerHTML = '<span class="hx-muted">ไม่พบวันเข้าคลินิก NCDs remission ของ HN นี้ใน HOSxP</span>'; return; }
    const all = getVisits();
    body.innerHTML = '<div class="hx-muted" style="margin-bottom:6px">วันเข้าคลินิกจาก HOSxP — ✓ = บันทึกแล้ว (กดเพื่อเปิดแก้ไข/เพิ่ม DRP) · ยังไม่มี ✓ = กดเพื่อกรอกฟอร์มให้ ตรวจแล้วกดบันทึก</div>' +
      vs.map((v, i) => { const s = all.some(x => x.patientId === p.id && x.date === v.date);
        return `<button type="button" class="hx-chip${s ? ' saved' : ''}" data-hx="${i}">${s ? '✓ ' : ''}${esc(thd(v.date))}${v.lab && v.lab.hba1c ? ` · A1c ${esc(numStr(v.lab.hba1c))}` : ''}</button>`; }).join('');
    body.querySelectorAll('[data-hx]').forEach(b => b.onclick = () => {
      const v = vs[+b.dataset.hx];
      const list = getVisits(), idx = list.findIndex(x => x.patientId === p.id && x.date === v.date);
      if (idx >= 0 && typeof loadVisitToForm === 'function') { loadVisitToForm(list[idx], idx); return; }
      _parsedData = toParsed(v);   // ตัวแปร let ของหน้าหลัก (global scope เดียวกัน ไม่ใช่ window.)
      applyParsedData();
    });
  }
  // ช่องวางข้อความจาก HOSxP ใช้เฉพาะเครื่องที่ต่อฐานข้อมูลไม่ได้
  function showPaste(on) {
    const pc = document.getElementById('parse-card');
    if (pc) pc.style.display = on ? '' : 'none';
  }

  // ── 3. คัดกรองคนไข้คลินิกเบาหวาน ───────────────────────────
  // นิยามภาวะสงบของไทย: HbA1c < 6.5% อย่างน้อย 3 เดือนหลังหยุดยาลดน้ำตาล
  // วันที่ยาหมด ≈ วันจ่าย + จำนวน ÷ ใช้ต่อวัน (ถ้าวิธีใช้มีขนาดยา) ไม่งั้นถึงวันนัด ไม่งั้น 30 วัน
  // ใกล้เกณฑ์ = ไม่ใช้อินซูลิน และ (HbA1c < 6.5 ใช้ยา ≤ 2 ชนิด หรือ HbA1c 6.5–6.9 ใช้ยา ≤ 1 ชนิด)
  const SCREEN = { remission: 6.5, nearMax: 7.0, offDays: 90, a1cMaxAgeDays: 540, nearMaxDrugsLow: 2, nearMaxDrugsHigh: 1 };
  const day = s => new Date(String(s).slice(0, 10) + 'T00:00:00');
  const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const isInsulinName = n => /insulin|mixtard|lantus|glargine|novo|humulin|gensulin|actrapid|insulatard|levemir|toujeo|tresiba/i.test(n);
  function classify(p) {
    const a1c = (p.a1c || []).map(([d, v]) => ({ d: day(d), v: num(v) })).filter(x => x.v != null && x.v > 2 && x.v < 25).sort((a, b) => a.d - b.d);
    if (!a1c.length) return null;
    const last = a1c[a1c.length - 1], today = new Date();
    if ((today - last.d) / 86400000 > SCREEN.a1cMaxAgeDays) return null;
    const rx = (p.rx || []).map(([d, name, qty, perDay, appt]) => {
      const start = day(d), q = num(qty) || 0, pd = num(perDay) || 0, ad = num(appt);
      const days = pd > 0 && !isInsulinName(name) ? Math.ceil(q / pd) : ad > 0 ? ad : 30;
      return { start, end: addDays(start, Math.min(days, 200)), name };
    }).sort((a, b) => a.start - b.start);
    const supplyEnd = rx.length ? rx.reduce((m, r) => r.end > m ? r.end : m, rx[0].end) : null;
    const drugsSince = d => [...new Set(rx.filter(r => r.end >= d).map(r => r.name))];
    const onMeds = supplyEnd && supplyEnd > addDays(last.d, -SCREEN.offDays);
    const recent = drugsSince(addDays(last.d, -SCREEN.offDays));
    const insulin = recent.some(isInsulinName);
    const trend = a1c.slice(-3).map(x => x.v);
    let tier = null, note = '';
    if (last.v < SCREEN.remission && !onMeds && !supplyEnd) {
      // ไม่มีประวัติจ่ายยาลดน้ำตาลที่ รพ. เลยใน 2 ปี — อาจรับยาที่ รพ.สต./ที่อื่น, คุมด้วยอาหารตั้งแต่แรก หรือเป็นภาวะก่อนเบาหวาน
      tier = 'norx'; note = 'ไม่พบการจ่ายยาลดน้ำตาลที่ รพ. ใน 2 ปี — ตรวจว่ารับยาที่ รพ.สต./ที่อื่นหรือไม่ ก่อนนับเป็นภาวะสงบ';
    } else if (last.v < SCREEN.remission && !onMeds) {
      tier = 'remission';
      note = `ยาลดน้ำตาลหมดประมาณ ${thd(iso(supplyEnd))} (ตรวจ HbA1c หลังหยุดยา ${Math.round((last.d - supplyEnd) / 86400000)} วัน)`;
    } else if (last.v < SCREEN.remission && supplyEnd && supplyEnd <= last.d && supplyEnd < today) {
      tier = 'confirm';
      note = `หยุดยาแล้ว แต่ HbA1c ตรวจหลังหยุดยาไม่ถึง 3 เดือน — ตรวจซ้ำได้ตั้งแต่ ${thd(iso(addDays(supplyEnd, SCREEN.offDays)))}`;
    } else if (insulin) {
      // ใช้อินซูลิน — ยังไม่ใช่กลุ่มเป้าหมายลดยาเพื่อเข้าภาวะสงบ
    } else if (last.v < SCREEN.remission && recent.length <= SCREEN.nearMaxDrugsLow) {
      tier = 'near'; note = `HbA1c < 6.5% ขณะยังใช้ยา ${recent.length} ชนิด — พิจารณาลด/หยุดยาร่วมกับปรับพฤติกรรม`;
    } else if (last.v >= SCREEN.remission && last.v < SCREEN.nearMax && recent.length <= SCREEN.nearMaxDrugsHigh) {
      tier = 'near'; note = recent.length ? `HbA1c 6.5–6.9% ใช้ยา ${recent.length} ชนิด` : 'HbA1c 6.5–6.9% ไม่ได้ใช้ยา — ปรับพฤติกรรมอีกเล็กน้อยอาจเข้าเกณฑ์';
    }
    if (!tier) return null;
    return { tier, note, last, trend, recent, insulin, p };
  }
  window._dmHxClassify = classify;   // ไว้ตรวจเกณฑ์จาก console / ชุดทดสอบ
  let screenRows = null;
  async function loadScreen() {
    const out = document.getElementById('screen-out'), btn = document.getElementById('screen-btn');
    btn.disabled = true; btn.textContent = '⏳ กำลังดึงข้อมูลจาก HOSxP (~15 วินาที)…';
    try {
      const r = await tphHosxp.dmScreen();
      if (!r) { out.innerHTML = '<div class="alert alert-warning"><span>⚠️</span><div>ต่อฐานข้อมูล HOSxP ไม่ได้ — ใช้ได้เฉพาะเครื่อง รพ. ที่ติดตั้ง HOSxP Bridge ตัวใหม่</div></div>'; return; }
      screenRows = (r.patients || []).map(classify).filter(Boolean);
      document.getElementById('screen-meta').textContent = `คนไข้คลินิกเบาหวาน (นัด LAB / DM) ใน 1 ปี ${r.patients.length} ราย · ดึงเมื่อ ${new Date().toLocaleString('th-TH')}`;
      renderScreen();
    } finally { btn.disabled = false; btn.textContent = '🔄 ดึงข้อมูลใหม่'; }
  }
  function renderScreen() {
    const out = document.getElementById('screen-out');
    if (!screenRows) return;
    const hideIn = document.getElementById('screen-hide-in').checked;
    const rows = screenRows.filter(x => !(hideIn && x.p.inRemission));
    const sect = (tier, title, cls, sub) => {
      const list = rows.filter(x => x.tier === tier).sort((a, b) => a.last.v - b.last.v);
      return `<div class="card"><div class="card-header ${cls}">${title} (${list.length})</div><div class="card-body">` +
        `<div class="hx-muted" style="margin-bottom:6px">${sub}</div>` + (list.length ? `<div style="overflow-x:auto"><table class="hx-table"><thead><tr>` +
        `<th>HN</th><th>ชื่อ</th><th>อายุ</th><th>HbA1c ล่าสุด</th><th>แนวโน้ม</th><th>ยาลดน้ำตาล (3 เดือนก่อนตรวจ)</th><th>หมายเหตุ</th><th>นัดคลินิกเบาหวานถัดไป</th></tr></thead><tbody>` +
        list.map(x => {
          const bd = x.p.birthday ? new Date(x.p.birthday) : null;
          const age = bd ? Math.floor((Date.now() - bd) / 31557600000) : '';
          return `<tr><td>${esc(x.p.hn)}${x.p.inRemission ? ' <span class="hx-badge">อยู่ในคลินิกแล้ว</span>' : ''}</td><td>${esc(x.p.name)}</td><td>${age}</td>` +
            `<td><b>${x.last.v}</b> <span class="hx-muted">${esc(thd(iso(x.last.d)))}</span></td><td>${x.trend.join(' → ')}</td>` +
            `<td>${x.recent.length ? x.recent.map(esc).join(', ') : '<span class="hx-muted">—</span>'}</td><td>${esc(x.note)}</td>` +
            `<td>${x.p.nextDm ? esc(thd(x.p.nextDm)) : '<span class="hx-muted">ไม่มีนัด</span>'}</td></tr>`;
        }).join('') + '</tbody></table></div>' : '<div class="hx-muted">ไม่มี</div>') + '</div></div>';
    };
    out.innerHTML =
      sect('remission', '✅ เข้าเกณฑ์ภาวะสงบแล้ว — เรียกเข้าคลินิก NCDs remission', 'hx-ok', `HbA1c ล่าสุด < ${SCREEN.remission}% และไม่ได้ใช้ยาลดน้ำตาลอย่างน้อย 3 เดือนก่อนตรวจ`) +
      sect('norx', '❔ HbA1c < 6.5% แต่ไม่มีประวัติยาลดน้ำตาลที่ รพ. — ตรวจสอบก่อน', 'hx-wait', 'อาจรับยาที่ รพ.สต./ที่อื่น คุมด้วยอาหารตั้งแต่แรก หรือเป็นภาวะก่อนเบาหวาน — ยืนยันประวัติยาก่อนนับเป็นภาวะสงบ') +
      sect('confirm', '⏳ รอยืนยัน — หยุดยาแล้ว ต้องตรวจ HbA1c ซ้ำ', 'hx-wait', `HbA1c < ${SCREEN.remission}% แต่ตรวจหลังหยุดยาไม่ถึง 3 เดือน`) +
      sect('near', '🟡 ใกล้เข้าเกณฑ์ — ดูแลพิเศษ', 'hx-near', `ไม่ใช้อินซูลิน และ HbA1c < ${SCREEN.remission}% ใช้ยา ≤ ${SCREEN.nearMaxDrugsLow} ชนิด หรือ HbA1c ${SCREEN.remission}–${(SCREEN.nearMax - 0.1).toFixed(1)}% ใช้ยา ≤ ${SCREEN.nearMaxDrugsHigh} ชนิด`) +
      '<div class="hx-muted" style="margin-top:6px">วันที่ยาหมดประมาณจากจำนวนที่จ่าย ÷ ขนาดยาต่อวัน (ถ้าไม่มีใช้วันนัด) — ตรวจประวัติใน HOSxP ก่อนตัดสินใจทุกครั้ง · ไม่นับอินซูลิน STAT ที่ ER · ใช้ HbA1c ภายใน 18 เดือน</div>';
  }

  // ── ต่อเข้ากับหน้าเดิม ─────────────────────────────────────
  function wrap(name, after) {
    const orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function () { const r = orig.apply(this, arguments); try { after.apply(this, arguments); } catch (e) { console.warn(name, e); } return r; };
  }
  window.addEventListener('DOMContentLoaded', () => {
    wrap('selectPatient', () => renderEntryCard());
    wrap('renderDashboard', () => window.renderInfographic && renderInfographic());
    const sb = document.getElementById('screen-btn');
    if (sb) sb.onclick = loadScreen;
    const hi = document.getElementById('screen-hide-in');
    if (hi) hi.onchange = renderScreen;
    // ซิงค์หลังหน้าโหลด Firebase เสร็จพอสมควร (การเขียนเป็น transaction อยู่แล้ว ไม่ทับข้อมูลเครื่องอื่น)
    if (!window.__dmHxNoAutoSync) setTimeout(() => syncAll(false), 2500);   // ปิดได้สำหรับทดสอบ
  });
})();
