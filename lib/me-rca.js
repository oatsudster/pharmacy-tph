/* me-rca.js — RCA (5 Whys + Swiss Cheese) และติดตามมาตรการแก้ไข (CAPA) ของ ME ระดับ E ขึ้นไป
   ใช้ใน ME_Dashboard.html: อ่าน records (ER) + hosxpRecords (OPD/IPD) ที่หน้าโหลดไว้แล้ว
   เก็บใน Firestore pharmacy_tph/me_rca { data: { <key ของ ME>: rca } } บันทึกทีละ key (merge) ไม่เขียนทับของเครื่องอื่น */
'use strict';
(function () {
  const SEVERE = ['E', 'F', 'G', 'H', 'I'];

  // ปัจจัยร่วม (ช่องโหว่ของ Swiss Cheese) — เน้นหาจุดอ่อนของระบบ ไม่ใช่ตัวบุคคล
  const FACTORS = [
    ['patient',  'ผู้ป่วย', 'สื่อสารไม่ได้ ประวัติไม่ครบ หลายโรค ยาหลายขนาน'],
    ['person',   'ผู้ปฏิบัติ', 'ความรู้/ประสบการณ์ ความเหนื่อยล้า ไม่ได้ทำตามขั้นตอน'],
    ['task',     'งาน / ขั้นตอน', 'ไม่มีหรือไม่ชัดเจน ขั้นตอนซับซ้อน ไม่มีจุดตรวจสอบ'],
    ['team',     'ทีม / การสื่อสาร', 'ส่งเวร คำสั่งด้วยวาจา ลายมือ ไม่ทวนกลับ'],
    ['env',      'สิ่งแวดล้อม / ภาระงาน', 'คนน้อย งานล้น ถูกขัดจังหวะ แสง/พื้นที่'],
    ['tech',     'อุปกรณ์ / ระบบ IT', 'HOSxP ไม่เตือน ตั้งค่าผิด เครื่องมือเสีย'],
    ['drug',     'ยา / ฉลาก / บรรจุภัณฑ์', 'LASA ฉลากคล้าย ความแรงหลายขนาด ที่เก็บติดกัน'],
    ['org',      'องค์กร / นโยบาย / การอบรม', 'นโยบายไม่ชัด ไม่มีการอบรม วัฒนธรรมความปลอดภัย'],
  ];

  // ลำดับความเข้มแข็งของมาตรการ (VA NCPS Action Hierarchy)
  const STRENGTH = {
    strong: { label: 'Strong', color: '#15803d', bg: '#dcfce7',
      hint: 'บังคับด้วยระบบ (forcing function) ตั้งค่า HOSxP ห้าม/บล็อก เปลี่ยนกระบวนการให้ไม่ต้องจำ ตัดขั้นตอนเสี่ยง ยกเลิก/เปลี่ยนรายการยา แยกที่เก็บถาวร' },
    medium: { label: 'Medium', color: '#a16207', bg: '#fef9c3',
      hint: 'checklist / แบบฟอร์มช่วยจำ ทวนกลับ (read-back) ปรับ software ให้เตือน ลดการขัดจังหวะ เพิ่มกำลังคน ฝึกแบบจำลองสถานการณ์' },
    weak:   { label: 'Weak', color: '#b91c1c', bg: '#fee2e2',
      hint: 'ตรวจสอบซ้ำ (double check) ติดป้ายเตือน ออกนโยบาย/แนวทางใหม่ อบรม กำชับ ประชุมชี้แจง' },
  };
  const STATUS_ACT = { todo: 'ยังไม่เริ่ม', doing: 'กำลังทำ', done: 'เสร็จแล้ว' };

  let rcaData = {};
  let editKey = null;
  try { rcaData = JSON.parse(localStorage.getItem('me_rca') || '{}'); } catch (e) {}

  const esc = s => window.escHtml(s == null ? '' : s);
  const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const addMonths = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10); };
  const thDate = iso => iso ? formatDateThai(iso) : '—';
  const meKey = r => r.hxMeId ? 'hx' + r.hxMeId : 'r' + String(r.id).replace(/\D/g, '_');
  const drugText = r => r.drug || (r.drugs && r.drugs.length ? r.drugs.map(d => d.name).join(', ') : '');

  // ME ทุกแผนก (ไม่รวมข้อมูลสรุปรายเดือนที่ไม่มีรายบุคคล)
  function allME() {
    const er = erStatsRecords().filter(r => r.hasME !== false).map(r => Object.assign({}, r, { dept: 'ER' }));
    const hx = hosxpRecords.filter(r => r.source !== 'hosxp_manual');
    return [...hx, ...er].filter(r => r.date);
  }

  // ชื่อยาเป็นคำ ≥ 4 ตัวอักษร (ตัดรูปแบบ/หน่วย) ใช้เทียบว่าเป็นยาเดียวกันไหม
  const STOP = new Set(['TAB', 'TABS', 'CAPS', 'SYRUP', 'INJECTION', 'INJ', 'AMPULE', 'VIAL', 'CREAM', 'TABLET', 'CAPSULE', 'SOLUTION', 'ORAL', 'SUSP', 'SUSPENSION', 'BOTTLE']);
  const drugTokens = s => new Set(String(s || '').toUpperCase().replace(/ยาเดิม/g, ' ').split(/[^A-Z]+/).filter(w => w.length >= 4 && !STOP.has(w)));
  const sameDrug = (a, b) => { const x = drugTokens(a); return [...drugTokens(b)].some(w => x.has(w)); };

  // วันที่ CAPA ทุกข้อเสร็จ = จุดเริ่มนับติดตามผล 3/6 เดือน
  function capaDoneDate(rca) {
    const acts = (rca && rca.actions) || [];
    if (!acts.length || acts.some(a => a.status !== 'done')) return null;
    return acts.map(a => a.doneDate || rca.rcaDate || '').sort().pop() || null;
  }

  // ME ยาเดียวกันที่เกิดขึ้นหลังจากนั้น ในช่วง (from, to]
  function recurrences(me, from, to) {
    const d = drugText(me);
    if (!d || !from) return [];
    const key = meKey(me);
    return allME().filter(r => meKey(r) !== key && r.date > from && (!to || r.date <= to) && sameDrug(d, drugText(r)));
  }

  function statusOf(rca) {
    if (!rca) return { k: 'none', t: 'ยังไม่ทำ RCA', c: '#b91c1c', bg: '#fee2e2' };
    if (!rca.rootCause || !(rca.actions || []).length) return { k: 'draft', t: 'กำลังวิเคราะห์', c: '#a16207', bg: '#fef9c3' };
    const done = capaDoneDate(rca);
    if (!done) {
      const late = rca.actions.some(a => a.status !== 'done' && a.due && a.due < today());
      return late ? { k: 'late', t: 'CAPA เลยกำหนด', c: '#b91c1c', bg: '#fee2e2' } : { k: 'capa', t: 'ดำเนินการ CAPA', c: '#1d4ed8', bg: '#dbeafe' };
    }
    if ((rca.fu3 && rca.fu3.result === 'recur') || (rca.fu6 && rca.fu6.result === 'recur')) return { k: 'recur', t: 'เกิดซ้ำ — ทบทวน', c: '#b91c1c', bg: '#fee2e2' };
    if (rca.fu6 && rca.fu6.result) return { k: 'closed', t: 'ปิดแล้ว', c: '#15803d', bg: '#dcfce7' };
    const due = addMonths(done, rca.fu3 && rca.fu3.result ? 6 : 3);
    return due <= today() ? { k: 'fudue', t: 'ถึงกำหนดติดตาม ' + (rca.fu3 && rca.fu3.result ? '6' : '3') + ' ด.', c: '#7c3aed', bg: '#ede9fe' }
                          : { k: 'fu', t: 'รอติดตามผล', c: '#0e7490', bg: '#cffafe' };
  }
  const pill = s => `<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:13px;font-weight:700;color:${s.c};background:${s.bg};white-space:nowrap">${esc(s.t)}</span>`;

  // ── บันทึก ──────────────────────────────────────────────
  const fs = () => (window.firebase && firebase.apps.length) ? firebase.firestore() : null;
  function saveLocal() { try { localStorage.setItem('me_rca', JSON.stringify(rcaData)); } catch (e) {} }
  async function saveOne(key) {
    saveLocal();
    const db = fs(); if (!db) return;
    try {
      if (rcaData[key]) await db.collection('pharmacy_tph').doc('me_rca').set({ data: { [key]: rcaData[key] }, updated: new Date().toISOString() }, { merge: true });
      else await db.collection('pharmacy_tph').doc('me_rca').update(new firebase.firestore.FieldPath('data', key), firebase.firestore.FieldValue.delete());
    } catch (e) { console.warn('[Firebase] me_rca save:', e.message); alert('บันทึกขึ้น Firebase ไม่สำเร็จ (เก็บไว้ในเครื่องแล้ว): ' + e.message); }
  }
  function listen() {
    const db = fs(); if (!db) return;
    db.collection('pharmacy_tph').doc('me_rca').onSnapshot(snap => {
      rcaData = (snap.exists && snap.data().data) || {};
      saveLocal();
      if (document.getElementById('section-rca')?.classList.contains('active') && !editKey) renderRCA();
    }, e => console.warn('[Firebase] me_rca:', e.message));
  }

  // ── หน้ารายการ ───────────────────────────────────────────
  function rows() {
    const showAll = document.getElementById('rca-all')?.checked;
    const fy = parseInt(document.getElementById('rca-fy')?.value || '') || 0;
    const st = document.getElementById('rca-status')?.value || '';
    return allME()
      .filter(r => showAll || SEVERE.includes(r.severity) || rcaData[meKey(r)])
      .filter(r => !fy || getFiscalYear(r.date) === fy)
      .map(r => ({ me: r, rca: rcaData[meKey(r)], s: statusOf(rcaData[meKey(r)]) }))
      .filter(x => !st || x.s.k === st || (st === 'open' && !['closed', 'none'].includes(x.s.k)))
      .sort((a, b) => b.me.date.localeCompare(a.me.date));
  }

  function renderRCA() {
    const fySel = document.getElementById('rca-fy');
    if (fySel && fySel.options.length <= 1) {
      [...new Set(allME().map(r => getFiscalYear(r.date)).filter(Boolean))].sort((a, b) => b - a)
        .forEach(y => fySel.add(new Option('ปีงบ ' + y, y)));
    }
    // KPI นับจาก ME ระดับ E+ ทั้งหมด (ไม่ขึ้นกับตัวกรองสถานะ)
    const fy = parseInt(fySel?.value || '') || 0;
    const severe = allME().filter(r => SEVERE.includes(r.severity) && (!fy || getFiscalYear(r.date) === fy));
    const done = severe.filter(r => { const x = rcaData[meKey(r)]; return x && x.rootCause && (x.actions || []).length; });
    const acts = Object.values(rcaData).filter(x => !fy || getFiscalYear(x.meDate) === fy).flatMap(x => x.actions || []);
    const strongMed = acts.filter(a => a.strength === 'strong' || a.strength === 'medium').length;
    const late = acts.filter(a => a.status !== 'done' && a.due && a.due < today()).length;
    const fuDue = Object.values(rcaData).filter(x => (!fy || getFiscalYear(x.meDate) === fy) && statusOf(x).k === 'fudue').length;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('rca-kpi-severe', severe.length);
    set('rca-kpi-done', severe.length ? Math.round(done.length / severe.length * 100) + '%' : '—');
    set('rca-kpi-done-sub', `ทำแล้ว ${done.length} / ${severe.length} เหตุการณ์`);
    set('rca-kpi-strong', acts.length ? Math.round(strongMed / acts.length * 100) + '%' : '—');
    set('rca-kpi-strong-sub', `Strong/Medium ${strongMed} จาก ${acts.length} มาตรการ`);
    set('rca-kpi-late', late);
    set('rca-kpi-fu', fuDue);

    const list = rows();
    window._rcaRows = list;
    const tb = document.getElementById('rca-tbody');
    if (!tb) return;
    tb.innerHTML = list.map((x, i) => {
      const r = x.me, dept = r.dept || 'ER';
      const dc = dept === 'OPD' ? '#2563eb' : dept === 'IPD' ? '#16a34a' : '#7c3aed';
      const a = (x.rca && x.rca.actions) || [];
      const capa = a.length ? `${a.filter(z => z.status === 'done').length}/${a.length}` : '—';
      return `<tr>
        <td class="nw">${thDate(r.date)}</td>
        <td><span style="background:${dc}22;color:${dc};font-size:12px;font-weight:700;padding:2px 8px;border-radius:12px">${esc(dept)}</span></td>
        <td>${esc(drugText(r)) || '—'}</td>
        <td style="font-size:14px">${esc(r.meType || r.stage) || '—'}</td>
        <td><span class="badge sev-${esc(r.severity || '')}">${esc(r.severity) || '—'}</span></td>
        <td>${pill(x.s)}</td>
        <td style="text-align:center">${capa}</td>
        <td><button class="btn-cancel" style="color:var(--primary);border-color:var(--primary);font-weight:700" onclick="RCA.open(${i})">${x.rca ? '✏️ เปิด' : '➕ ทำ RCA'}</button></td>
      </tr>`;
    }).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--text-light);padding:32px 0">ไม่มี ME ระดับ E ขึ้นไปในช่วงที่เลือก</td></tr>';
  }

  // ── ฟอร์ม RCA ────────────────────────────────────────────
  const inp = 'width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:7px;font-size:15px;font-family:inherit;box-sizing:border-box';
  const lbl = t => `<div style="font-size:14px;font-weight:700;color:var(--text-mid);margin:14px 0 6px">${t}</div>`;

  function actionRow(a, i) {
    const s = STRENGTH[a.strength] || STRENGTH.weak;
    return `<div class="rca-act" data-i="${i}" style="border:1px solid var(--border);border-left:5px solid ${s.color};border-radius:9px;padding:10px 12px;margin-bottom:10px">
      <div style="display:flex;gap:8px;align-items:flex-start">
        <textarea data-f="text" rows="2" placeholder="มาตรการแก้ไข/ป้องกัน" style="${inp};flex:1">${esc(a.text)}</textarea>
        <button type="button" onclick="RCA.delAction(${i})" title="ลบ" style="background:#fee2e2;color:#b91c1c;border:none;border-radius:7px;padding:6px 10px;cursor:pointer">✕</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:8px">
        <select data-f="strength" onchange="RCA.syncActions()" style="${inp}">${Object.entries(STRENGTH).map(([k, v]) => `<option value="${k}"${a.strength === k ? ' selected' : ''}>${v.label}</option>`).join('')}</select>
        <input data-f="owner" placeholder="ผู้รับผิดชอบ" value="${esc(a.owner)}" style="${inp}">
        <label style="font-size:13px;color:var(--text-light)">กำหนดเสร็จ<input data-f="due" type="date" value="${esc(a.due)}" style="${inp}"></label>
        <select data-f="status" onchange="RCA.syncActions()" style="${inp}">${Object.entries(STATUS_ACT).map(([k, v]) => `<option value="${k}"${a.status === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
        ${a.status === 'done' ? `<label style="font-size:13px;color:var(--text-light)">วันที่เสร็จ<input data-f="doneDate" type="date" value="${esc(a.doneDate || today())}" style="${inp}"></label>` : ''}
      </div>
      <div style="font-size:12px;color:${s.color};margin-top:6px">${esc(s.hint)}</div>
    </div>`;
  }

  function fuBlock(n, me, rca) {
    const base = capaDoneDate(rca);
    const fu = (rca && rca['fu' + n]) || {};
    if (!base) return `<div style="color:var(--text-light);font-size:14px">นับ ${n} เดือนหลัง CAPA ทุกข้อเสร็จ</div>`;
    const from = n === 3 ? base : addMonths(base, 3), to = addMonths(base, n);
    const rec = recurrences(me, from, to);
    const auto = rec.length
      ? `<span style="color:#b91c1c;font-weight:700">พบ ME ยาเดียวกัน ${rec.length} ครั้ง</span> (${rec.map(r => thDate(r.date) + ' ' + (r.dept || 'ER') + ' ระดับ ' + (r.severity || '?')).map(esc).join(', ')})`
      : `<span style="color:#15803d;font-weight:700">ยังไม่พบ ME ยาเดียวกัน</span>`;
    return `<div style="font-size:14px;margin-bottom:6px">ช่วง ${thDate(from)} – ${thDate(to)} ${to > today() ? '(ยังไม่ครบกำหนด)' : ''} · ระบบตรวจ: ${auto}</div>
      <div style="display:grid;grid-template-columns:200px 1fr;gap:8px">
        <select id="rca-fu${n}-result" style="${inp}">
          <option value="">— ยังไม่ประเมิน —</option>
          <option value="ok"${fu.result === 'ok' ? ' selected' : ''}>ไม่เกิดซ้ำ ได้ผล</option>
          <option value="recur"${fu.result === 'recur' ? ' selected' : ''}>เกิดซ้ำ ต้องทบทวน</option>
        </select>
        <input id="rca-fu${n}-note" placeholder="บันทึกผลการติดตาม" value="${esc(fu.note)}" style="${inp}">
      </div>`;
  }

  let draftActions = [];
  function openForm(i) {
    const x = window._rcaRows[i]; if (!x) return;
    const me = x.me, key = meKey(me), rca = x.rca || {};
    editKey = key;
    draftActions = JSON.parse(JSON.stringify(rca.actions || []));
    const whys = rca.whys || ['', '', '', '', ''];
    const f = new Set(rca.factors || []);
    const m = document.getElementById('rca-modal');
    m.dataset.idx = i;
    document.getElementById('rca-modal-body').innerHTML = `
      <div style="background:var(--primary-light);border-radius:10px;padding:12px 16px;font-size:15px;line-height:1.7">
        <b>${thDate(me.date)} ${esc(me.time || '')}</b> · ${esc(me.dept || 'ER')} · ระดับ <span class="badge sev-${esc(me.severity || '')}" style="padding:1px 9px;font-size:14px">${esc(me.severity || '—')}</span><br>
        <b>ยา:</b> ${esc(drugText(me)) || '—'} · <b>ประเภท:</b> ${esc(me.meType || '—')} · <b>ขั้นตอน:</b> ${esc(me.stage || me.stageRaw || '—')}<br>
        <b>รายละเอียด:</b> ${esc(me.detail || '—')}${me.intervention ? '<br><b>การแก้ไขเบื้องต้น:</b> ' + esc(me.intervention) : ''}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">
        <div>${lbl('วันที่ทำ RCA')}<input id="rca-date" type="date" value="${esc(rca.rcaDate || today())}" style="${inp}"></div>
        <div>${lbl('ทีมที่ร่วมวิเคราะห์')}<input id="rca-team" value="${esc(rca.team)}" placeholder="เช่น ภก. / พยาบาล ER / แพทย์" style="${inp}"></div>
      </div>
      ${lbl('ปัญหา (เกิดอะไรขึ้น — เขียนเป็นข้อเท็จจริง ไม่ระบุตัวบุคคล)')}
      <textarea id="rca-problem" rows="2" style="${inp}">${esc(rca.problem)}</textarea>
      ${lbl('5 Whys — ถาม "ทำไม" ต่อเนื่องจนถึงสาเหตุเชิงระบบ')}
      ${whys.map((w, k) => `<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px"><span style="flex:0 0 74px;font-weight:700;color:var(--primary)">ทำไม ${k + 1}</span><input class="rca-why" value="${esc(w)}" style="${inp}"></div>`).join('')}
      ${lbl('ปัจจัยร่วม (Swiss Cheese — ช่องโหว่ที่ทำให้ความผิดพลาดหลุดถึงผู้ป่วย)')}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:6px">
        ${FACTORS.map(([k, t, h]) => `<label style="display:flex;gap:8px;align-items:flex-start;border:1px solid var(--border);border-radius:8px;padding:7px 10px;cursor:pointer"><input type="checkbox" class="rca-factor" value="${k}"${f.has(k) ? ' checked' : ''} style="margin-top:4px"><span><b style="font-size:14px">${t}</b><br><span style="font-size:12px;color:var(--text-light)">${h}</span></span></label>`).join('')}
      </div>
      ${lbl('สาเหตุรากเหง้า (Root cause)')}
      <textarea id="rca-root" rows="2" style="${inp}">${esc(rca.rootCause)}</textarea>
      ${lbl('มาตรการแก้ไข/ป้องกัน (CAPA) — ควรมีอย่างน้อย 1 ข้อระดับ Strong หรือ Medium')}
      <div id="rca-actions"></div>
      <button type="button" class="btn-cancel" onclick="RCA.addAction()" style="color:var(--primary);border-color:var(--primary);font-weight:700">➕ เพิ่มมาตรการ</button>
      ${lbl('ติดตามผล 3 เดือน')}${fuBlock(3, me, rca)}
      ${lbl('ติดตามผล 6 เดือน')}${fuBlock(6, me, rca)}
      <div style="display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap;margin-top:22px">
        <div>${x.rca ? '<button type="button" class="btn-cancel" style="color:#b91c1c;border-color:#fca5a5" onclick="RCA.remove()">🗑 ลบ RCA</button> <button type="button" class="btn-cancel" onclick="RCA.print()">📄 พิมพ์ PDF</button>' : ''}</div>
        <div><button type="button" class="btn-cancel" onclick="RCA.close()">ยกเลิก</button> <button type="button" class="btn btn-primary" style="padding:9px 26px;font-size:16px" onclick="RCA.save()">💾 บันทึก</button></div>
      </div>`;
    renderActions();
    m.style.display = 'flex';
    m.scrollTop = 0;
  }

  function readActions() {
    document.querySelectorAll('#rca-actions .rca-act').forEach(el => {
      const a = draftActions[+el.dataset.i]; if (!a) return;
      el.querySelectorAll('[data-f]').forEach(f => { a[f.dataset.f] = f.value.trim(); });
      if (a.status !== 'done') delete a.doneDate;
    });
  }
  function renderActions() {
    const box = document.getElementById('rca-actions');
    if (box) box.innerHTML = draftActions.map(actionRow).join('') || '<div style="color:var(--text-light);font-size:14px;margin-bottom:8px">ยังไม่มีมาตรการ</div>';
  }

  function collect() {
    readActions();
    const old = rcaData[editKey] || {};
    const me = window._rcaRows[+document.getElementById('rca-modal').dataset.idx].me;
    const v = id => (document.getElementById(id)?.value || '').trim();
    const fu = n => v('rca-fu' + n + '-result') || v('rca-fu' + n + '-note') ? { result: v('rca-fu' + n + '-result'), note: v('rca-fu' + n + '-note'), date: (old['fu' + n] || {}).date || today() } : null;
    const rca = {
      meDept: me.dept || 'ER', meDate: me.date, meDrug: drugText(me), meSeverity: me.severity || '',
      rcaDate: v('rca-date'), team: v('rca-team'), problem: v('rca-problem'),
      whys: [...document.querySelectorAll('.rca-why')].map(e => e.value.trim()),
      factors: [...document.querySelectorAll('.rca-factor:checked')].map(e => e.value),
      rootCause: v('rca-root'),
      actions: draftActions.filter(a => a.text),
      created: old.created || new Date().toISOString(), updated: new Date().toISOString(),
    };
    const f3 = fu(3), f6 = fu(6);
    if (f3) rca.fu3 = f3;
    if (f6) rca.fu6 = f6;
    return rca;
  }

  window.RCA = {
    render: renderRCA,
    open: openForm,
    close() { document.getElementById('rca-modal').style.display = 'none'; editKey = null; renderRCA(); },
    addAction() { readActions(); draftActions.push({ id: Date.now().toString(36), text: '', strength: 'medium', owner: '', due: addMonths(today(), 1), status: 'todo' }); renderActions(); },
    delAction(i) { readActions(); draftActions.splice(i, 1); renderActions(); },
    syncActions() { readActions(); renderActions(); },
    save() {
      const rca = collect();
      if (!rca.problem && !rca.rootCause && !rca.whys.some(Boolean)) { alert('กรุณากรอกปัญหา, 5 Whys หรือสาเหตุรากเหง้าอย่างน้อย 1 ช่อง'); return; }
      if (rca.actions.some(a => a.status === 'done' && !a.doneDate)) rca.actions.forEach(a => { if (a.status === 'done' && !a.doneDate) a.doneDate = today(); });
      if (rca.actions.length && !rca.actions.some(a => a.strength !== 'weak') && !confirm('มาตรการทั้งหมดเป็นระดับ Weak (อบรม/กำชับ/ติดป้าย) ซึ่งมักป้องกันการเกิดซ้ำไม่ได้\nบันทึกต่อหรือไม่?')) return;
      const key = editKey;
      rcaData[key] = rca;
      saveOne(key);
      RCA.close();
    },
    remove() {
      if (!editKey || !confirm('ลบ RCA ของเหตุการณ์นี้ทั้งหมด?')) return;
      const key = editKey;
      delete rcaData[key];
      saveOne(key);
      RCA.close();
    },
    print() {
      const rca = collect();
      const me = window._rcaRows[+document.getElementById('rca-modal').dataset.idx].me;
      const fac = FACTORS.filter(([k]) => rca.factors.includes(k)).map(([, t]) => t).join(', ') || '—';
      const fuTxt = f => f ? ({ ok: 'ไม่เกิดซ้ำ', recur: 'เกิดซ้ำ' }[f.result] || '—') + (f.note ? ' — ' + f.note : '') : '—';
      expPDF({
        title: 'รายงานวิเคราะห์สาเหตุรากเหง้า (RCA) และมาตรการแก้ไข (CAPA)',
        subtitle: `ME ${me.dept || 'ER'} วันที่ ${expISOtoTH(me.date)} ระดับ ${me.severity || '—'} · ทำ RCA ${expISOtoTH(rca.rcaDate)} · ทีม: ${rca.team || '—'}`,
        sections: [
          { title: 'เหตุการณ์', headers: ['หัวข้อ', 'รายละเอียด'], rows: [
            ['ยา', drugText(me)], ['ประเภท / ขั้นตอน', (me.meType || '—') + ' / ' + (me.stage || me.stageRaw || '—')],
            ['รายละเอียด', me.detail || '—'], ['ปัญหา', rca.problem || '—']] },
          { title: '5 Whys', headers: ['ลำดับ', 'ทำไม'], rows: rca.whys.map((w, i) => ['ทำไม ' + (i + 1), w || '—']) },
          { title: 'ปัจจัยร่วมและสาเหตุรากเหง้า', headers: ['หัวข้อ', 'รายละเอียด'], rows: [['ปัจจัยร่วม (Swiss Cheese)', fac], ['สาเหตุรากเหง้า', rca.rootCause || '—']] },
          { title: 'มาตรการแก้ไข/ป้องกัน (CAPA)', headers: ['#', 'มาตรการ', 'ระดับ', 'ผู้รับผิดชอบ', 'กำหนดเสร็จ', 'สถานะ'],
            rows: rca.actions.map((a, i) => [i + 1, a.text, (STRENGTH[a.strength] || {}).label || '', a.owner || '—', a.due ? expISOtoTH(a.due) : '—',
              STATUS_ACT[a.status] + (a.doneDate ? ' ' + expISOtoTH(a.doneDate) : '')]) },
          { title: 'ติดตามผล', headers: ['ช่วง', 'ผล'], rows: [['3 เดือน', fuTxt(rca.fu3)], ['6 เดือน', fuTxt(rca.fu6)]] },
        ],
      });
    },
    exportList() {
      const list = rows();
      if (!list.length) { alert('ไม่มีรายการ'); return; }
      expPDF({
        title: 'สรุป RCA / CAPA ความคลาดเคลื่อนทางยา', subtitle: 'รพ.ถ้ำพรรณรา · พิมพ์ ' + expISOtoTH(today()), landscape: true,
        headers: ['วันที่', 'แผนก', 'ยา', 'ระดับ', 'สาเหตุรากเหง้า', 'CAPA (ระดับ/สถานะ)', 'สถานะ'],
        rows: list.map(x => [expISOtoTH(x.me.date), x.me.dept || 'ER', drugText(x.me), x.me.severity || '', (x.rca && x.rca.rootCause) || '—',
          ((x.rca && x.rca.actions) || []).map(a => `• ${a.text} [${(STRENGTH[a.strength] || {}).label}/${STATUS_ACT[a.status]}]`).join('\n') || '—', x.s.t]),
      });
    },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', listen); else listen();
})();
