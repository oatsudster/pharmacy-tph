// DM Remission ↔ ฐานข้อมูล HOSxP (ผ่าน HOSxP Bridge — เฉพาะเครื่อง รพ. ที่ติดตั้ง bridge พร้อม db.json)
//   1. หน้าบันทึก: เลือกคนไข้ → ปุ่มวันที่เข้าคลินิก NCDs remission จาก HOSxP → กดแล้วกรอกฟอร์มให้ (สัญญาณชีพ + lab + ยา) ตรวจทานแล้วบันทึกเอง
//   2. หน้าคนไข้: เพิ่มคนไข้ที่มีนัดคลินิก NCDs remission แต่ยังไม่อยู่ในรายชื่อ / นำเข้า visit ในอดีตที่ยังไม่ได้บันทึก
//   3. หน้าคัดกรอง: คนไข้คลินิกเบาหวาน (นัด LAB / DM) ที่เข้าเกณฑ์ภาวะสงบแล้ว หรือใกล้เข้าเกณฑ์
// ใช้ฟังก์ชันของหน้า dm-remission.html: PATIENTS, savePatients, getVisits, saveVisitDoc, applyParsedData, _parsedData ฯลฯ
(function () {
  if (!window.tphHosxp) return;
  const esc = s => (window.escHtml ? escHtml(String(s ?? '')) : String(s ?? ''));
  const num = v => { const m = String(v ?? '').match(/-?\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : null; };
  const numStr = v => { const n = num(v); return n == null ? null : String(+n.toFixed(2)); };
  const thd = iso => tphHosxp.thDate(iso);
  const hn7 = h => String(h || '').trim().padStart(7, '0');
  const patientByHn = hn => PATIENTS.find(p => hn7(p.hn) === hn7(hn));
  const visitCache = {};   // hn → visits จาก HOSxP
  async function hxVisits(hn) {
    if (!visitCache[hn]) { const r = await tphHosxp.dmVisits(hn); if (r) visitCache[hn] = r.visits || []; }
    return visitCache[hn] || null;
  }

  // ข้อมูล 1 วันจาก HOSxP → รูปแบบเดียวกับที่ parseHosXPText คืน (ใช้ applyParsedData ตัวเดิมกรอกฟอร์ม)
  function toParsed(v) {
    const L = v.lab || {};
    return {
      visitDate: v.date, weight: numStr(v.weight), height: numStr(v.height), bp: v.bp || '', dtx: numStr(v.dtx),
      fbs: numStr(L.fbs), hba1c: numStr(L.hba1c), ldl: numStr(L.ldl), tc: numStr(L.tc), tg: numStr(L.tg),
      cr: numStr(L.cr), egfr: numStr(L.egfr), urineAlb: numStr(L.urineAlb),
      drugs: (v.drugs || []).map(d => ({ name: d.name, unit: d.unit || '', price: num(d.price) || 0, dosage: d.usage || '', qty: num(d.qty) || 0 })),
      isClinicVisit: true,
    };
  }
  function toVisit(p, v) {
    const d = toParsed(v);
    const w = num(d.weight), h = num(d.height);
    const drugs = d.drugs.map(x => ({ name: x.name, dose: x.dosage, unit: x.unit, price: x.price, qty: x.qty, stock: null, total: +(x.price * x.qty).toFixed(2) }));
    return {
      id: 'v_hx_' + hn7(p.hn) + '_' + v.date, patientId: p.id, patientName: p.name, date: v.date,
      weight: d.weight || '', height: d.height || '', bmi: w && h ? (w / (h / 100) ** 2).toFixed(1) : (numStr(v.bmi) || ''),
      bp: d.bp, dtx: d.dtx || '', fbs: d.fbs || '', hba1c: d.hba1c || '', ldl: d.ldl || '', tc: d.tc || '', tg: d.tg || '',
      cr: d.cr || '', egfr: d.egfr || '', urineAlb: d.urineAlb || '', drugs, drugChange: '', drugProblem: '',
      note: 'นำเข้าจาก HOSxP', grandTotal: +drugs.reduce((s, x) => s + x.total, 0).toFixed(2), savedAt: new Date().toISOString(), source: 'hosxp',
    };
  }

  // ── 1. หน้าบันทึก ──────────────────────────────────────────
  async function renderEntryCard() {
    const card = document.getElementById('hx-card'), body = document.getElementById('hx-body');
    if (!card || !body) return;
    const p = currentPatient;
    if (!p || !p.hn) { card.style.display = 'none'; return; }
    card.style.display = '';
    body.innerHTML = '<span class="hx-muted">⏳ กำลังอ่านจาก HOSxP…</span>';
    const vs = await hxVisits(hn7(p.hn));
    if (currentPatient !== p) return;
    if (!vs) { card.style.display = 'none'; return; }   // เครื่องนี้ไม่มี bridge/DB — ซ่อนไว้ ใช้วางข้อความเหมือนเดิม
    if (!vs.length) { body.innerHTML = '<span class="hx-muted">ไม่พบวันเข้าคลินิก NCDs remission ของ HN นี้ใน HOSxP</span>'; return; }
    const saved = new Set(getVisits().filter(v => v.patientId === p.id).map(v => v.date));
    body.innerHTML = '<div class="hx-muted" style="margin-bottom:6px">กดวันที่ → กรอกสัญญาณชีพ, lab (ล่าสุดภายใน 60 วันก่อนวันนั้น) และยาที่ได้ ลงฟอร์มให้ ตรวจทานแล้วกดบันทึก</div>' +
      vs.map((v, i) => `<button type="button" class="hx-chip${saved.has(v.date) ? ' saved' : ''}" data-hx="${i}" title="${saved.has(v.date) ? 'บันทึกวันนี้ไว้แล้ว — กดเพื่อกรอกทับในฟอร์ม (ยังไม่บันทึกจนกว่าจะกดบันทึก)' : ''}">` +
        `${saved.has(v.date) ? '✓ ' : ''}${esc(thd(v.date))}${v.lab && v.lab.hba1c ? ` · A1c ${esc(numStr(v.lab.hba1c))}` : ''}</button>`).join('');
    body.querySelectorAll('[data-hx]').forEach(b => b.onclick = () => {
      _parsedData = toParsed(vs[+b.dataset.hx]);   // ตัวแปร let ของหน้าหลัก (อยู่ใน global scope เดียวกัน ไม่ใช่ window.)
      applyParsedData();
    });
  }

  // ── 2. หน้าคนไข้ ───────────────────────────────────────────
  async function renderRoster() {
    const el = document.getElementById('hx-roster');
    if (!el) return;
    const r = await tphHosxp.dmRoster();
    if (!r) { el.innerHTML = ''; return; }
    const missing = (r.patients || []).filter(x => !patientByHn(x.hn));
    el.innerHTML = missing.length
      ? `<div class="card"><div class="card-header">🗄 คนไข้ที่มีนัดคลินิก NCDs remission ใน HOSxP แต่ยังไม่อยู่ในรายชื่อ (${missing.length})</div><div class="card-body">` +
        missing.map(x => `<div class="hx-row"><span><b>${esc(x.hn)}</b> ${esc(x.name)} · เริ่ม ${esc(thd(x.firstDate))}${x.nextDate ? ' · นัดถัดไป ' + esc(thd(x.nextDate)) : ''}</span>` +
          `<button type="button" class="btn btn-primary btn-sm" data-add="${esc(x.hn)}">➕ เพิ่ม</button></div>`).join('') + '</div></div>'
      : '';
    el.querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
      const x = missing.find(m => m.hn === b.dataset.add);
      const bd = x.birthday ? new Date(x.birthday) : null, now = new Date();
      const age = bd ? now.getFullYear() - bd.getFullYear() - ((now.getMonth() < bd.getMonth() || (now.getMonth() === bd.getMonth() && now.getDate() < bd.getDate())) ? 1 : 0) : '';
      const first = x.name.replace(/^(นาย|นางสาว|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.)/, '').split(/\s+/)[0] || x.name;
      PATIENTS.push({ id: 'pt_' + Date.now(), name: x.name, shortName: first, hn: x.hn, age: String(age), dx: 'DM type 2' });
      savePatients(PATIENTS);
      if (window.rebuildAllStrips) rebuildAllStrips();
      renderPatientsPage();
      showToast('✅ เพิ่ม ' + x.name + ' แล้ว — เลือกคนไข้เพื่อนำเข้าประวัติจาก HOSxP');
    });
  }

  async function renderImportBox(p) {
    const el = document.getElementById('hx-import');
    if (!el) return;
    el.innerHTML = '';
    if (!p || !p.hn) return;
    const vs = await hxVisits(hn7(p.hn));
    if (!vs || currentHistPatient !== p) return;
    const saved = new Set(getVisits().filter(v => v.patientId === p.id).map(v => v.date));
    const todo = vs.filter(v => !saved.has(v.date));
    if (!todo.length) { el.innerHTML = vs.length ? '<div class="hx-muted" style="margin-bottom:8px">🗄 ทุกวันที่เข้าคลินิกใน HOSxP บันทึกไว้แล้ว</div>' : ''; return; }
    el.innerHTML = `<div class="alert alert-info" style="margin-bottom:10px"><span>🗄</span><div>HOSxP มีวันเข้าคลินิก NCDs remission ที่ยังไม่ได้บันทึก ${todo.length} ครั้ง: ${todo.map(v => esc(thd(v.date))).join(', ')}` +
      `<br><button type="button" class="btn btn-primary btn-sm" id="hx-import-btn" style="margin-top:6px">นำเข้าทั้งหมด (สัญญาณชีพ + lab + ยา)</button>` +
      ` <span class="hx-muted">ช่องการเปลี่ยนแปลงยา/ปัญหาการใช้ยา/ยาเหลือ ยังว่าง — เติมเองภายหลังได้</span></div></div>`;
    document.getElementById('hx-import-btn').onclick = async e => {
      e.target.disabled = true;
      let n = 0;
      for (const v of todo) {
        try { await saveVisitDoc(toVisit(p, v)); n++; e.target.textContent = `⏳ นำเข้าแล้ว ${n}/${todo.length}`; }
        catch (err) { showToast('⚠️ นำเข้า ' + thd(v.date) + ' ไม่สำเร็จ: ' + err.message); }
      }
      showToast(`✅ นำเข้าจาก HOSxP ${n} ครั้ง`);
      if (window.renderDashboard) renderDashboard();
      renderHistory(p);
    };
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
    wrap('renderPatientsPage', () => renderRoster());
    wrap('renderHistory', p => renderImportBox(p));
    const sb = document.getElementById('screen-btn');
    if (sb) sb.onclick = loadScreen;
    const hi = document.getElementById('screen-hide-in');
    if (hi) hi.onchange = renderScreen;
  });
})();
