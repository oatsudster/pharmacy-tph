// DM Remission — Infographic dashboard (หน้ารายงาน ส่วนบนสุด)
// อ่านจาก visit ที่บันทึก/ซิงค์จาก HOSxP แล้ว (getVisits) — ไม่มีการกรอกเพิ่ม
// เกณฑ์ภาวะสงบของไทย: HbA1c < 6.5% โดยไม่ได้ใช้ยาลดน้ำตาลอย่างน้อย 3 เดือนก่อนตรวจ (และหลังจากนั้นยังไม่กลับมาใช้)
// ใช้ HbA1c ค่าที่มีจริงล่าสุด — ไม่ต้องตรวจทุก visit (computeRemissionStatus เดิมนับเฉพาะ visit ที่มี HbA1c ติดกัน จึงนับขาดเกือบทุกคน)
(function () {
  const CSS = `
  #page-infographic { --ig-ink:#1C2B22; --ig-ink2:#3D5A47; --ig-muted:#7A9A85; --ig-line:#D6E4DA; --ig-soft:#EAF4EE;
    --ig-brand:#1A5E38; --ig-brand-d:#124228; --ig-gold:#C49A22; --ig-s1:#2a78d6; --ig-s2:#eb6834; --ig-up:#e34948; --ig-grid:#eef2ef;
    --ig-good:#0ca30c; --ig-warn:#fab219; --ig-serious:#ec835a; --ig-crit:#d03b3b; }
  .ig-hero { background:linear-gradient(135deg,#1A5E38 0%,#124228 100%); color:#fff; border-radius:16px; padding:20px 22px; margin-bottom:14px; display:flex; flex-wrap:wrap; gap:14px; align-items:flex-end; justify-content:space-between; }
  .ig-hero h2 { margin:0; font-size:22px; font-weight:800; letter-spacing:.2px; }
  .ig-hero .sub { opacity:.85; font-size:13px; margin-top:4px; }
  .ig-hero .ctrl { display:flex; gap:10px; flex-wrap:wrap; align-items:center; font-size:13px; }
  .ig-hero select, .ig-hero button { font:inherit; font-size:13px; border-radius:8px; border:1px solid rgba(255,255,255,.35); background:rgba(255,255,255,.12); color:#fff; padding:5px 10px; cursor:pointer; }
  .ig-hero select option { color:#1C2B22; }
  .ig-hero label { display:flex; gap:6px; align-items:center; cursor:pointer; }
  .ig-kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:10px; margin-bottom:14px; }
  .ig-kpi { background:#fff; border:1px solid var(--ig-line); border-radius:14px; padding:14px 16px; position:relative; overflow:hidden; }
  .ig-kpi::before { content:''; position:absolute; left:0; top:0; bottom:0; width:4px; background:var(--ig-brand); }
  .ig-kpi.gold::before { background:var(--ig-gold); }
  .ig-kpi .lbl { font-size:12px; color:var(--ig-ink2); font-weight:600; }
  .ig-kpi .val { font-size:28px; font-weight:800; color:var(--ig-ink); line-height:1.15; margin-top:4px; font-variant-numeric:tabular-nums; }
  .ig-kpi .val small { font-size:14px; font-weight:700; color:var(--ig-ink2); }
  .ig-kpi .note { font-size:12px; color:var(--ig-muted); margin-top:3px; }
  .ig-kpi .delta { display:inline-block; font-size:12px; font-weight:700; padding:1px 7px; border-radius:10px; background:var(--ig-soft); color:var(--ig-brand-d); margin-top:4px; }
  .ig-grid2 { display:grid; grid-template-columns:3fr 2fr; gap:12px; margin-bottom:12px; }
  @media (max-width:900px) { .ig-grid2 { grid-template-columns:1fr; } }
  .ig-card { background:#fff; border:1px solid var(--ig-line); border-radius:14px; padding:14px 16px; }
  .ig-card h3 { margin:0 0 2px; font-size:15px; color:var(--ig-ink); }
  .ig-card .cap { font-size:12px; color:var(--ig-muted); margin-bottom:8px; }
  .ig-chart { position:relative; height:280px; }
  .ig-legend { display:flex; flex-wrap:wrap; gap:12px; font-size:12px; color:var(--ig-ink2); margin-top:6px; }
  .ig-legend i { display:inline-block; width:14px; height:3px; border-radius:2px; vertical-align:middle; margin-right:5px; }
  .ig-legend i.dot { width:10px; height:10px; border-radius:50%; }
  .ig-status { display:flex; flex-direction:column; gap:8px; margin-top:4px; }
  .ig-srow { display:grid; grid-template-columns:150px 1fr 44px; gap:8px; align-items:center; font-size:13px; color:var(--ig-ink); }
  .ig-sbar { height:14px; background:var(--ig-grid); border-radius:4px; overflow:hidden; }
  .ig-sbar span { display:block; height:100%; border-radius:0 4px 4px 0; }
  .ig-srow b { text-align:right; font-variant-numeric:tabular-nums; }
  .ig-pts { display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:10px; }
  .ig-pt { background:#fff; border:1px solid var(--ig-line); border-radius:14px; padding:12px 14px; cursor:pointer; transition:box-shadow .15s, border-color .15s; }
  .ig-pt:hover, .ig-pt.on { border-color:var(--ig-s1); box-shadow:0 2px 10px rgba(42,120,214,.15); }
  .ig-pt .top { display:flex; justify-content:space-between; align-items:flex-start; gap:6px; }
  .ig-pt .nm { font-weight:800; font-size:14px; color:var(--ig-ink); }
  .ig-pt .mo { font-size:11px; color:var(--ig-muted); }
  .ig-badge { font-size:11px; font-weight:700; padding:2px 8px; border-radius:10px; white-space:nowrap; }
  .ig-badge.remission { background:#dcfce7; color:#166534; } .ig-badge.improving { background:#e0f2fe; color:#0e7490; }
  .ig-badge.steady { background:#FBF3DC; color:#7c5a00; } .ig-badge.relapse { background:#fee2e2; color:#991b1b; }
  .ig-pt .row { display:flex; justify-content:space-between; gap:8px; font-size:12px; color:var(--ig-ink2); margin-top:6px; align-items:center; }
  .ig-pt .row b { color:var(--ig-ink); font-variant-numeric:tabular-nums; }
  .ig-pt .drugs { margin-top:6px; display:flex; flex-wrap:wrap; gap:4px; }
  .ig-pt .drugs span { font-size:11px; padding:1px 6px; border-radius:6px; background:var(--ig-soft); color:var(--ig-brand-d); }
  .ig-pt .drugs span.off { text-decoration:line-through; color:var(--ig-muted); background:#f3f4f6; }
  .ig-tbl { width:100%; border-collapse:collapse; font-size:12px; }
  .ig-tbl th, .ig-tbl td { padding:5px 6px; border-top:1px solid var(--ig-grid); text-align:left; }
  .ig-tbl th { background:#F4F7F5; }
  .ig-empty { padding:30px; text-align:center; color:var(--ig-muted); }
  .ig-sync { font-size:12px; opacity:.9; }
  `;
  const STATUS = {
    remission: { label: 'ภาวะสงบ (Remission)', icon: '✅', color: 'var(--ig-good)' },
    improving: { label: 'ดีขึ้น', icon: '📉', color: 'var(--ig-s1)' },
    steady: { label: 'ยังไม่เปลี่ยนแปลง', icon: '➖', color: 'var(--ig-warn)' },
    relapse: { label: 'กลับเป็นซ้ำ', icon: '⚠️', color: 'var(--ig-crit)' },
  };
  const n = x => { const f = parseFloat(String(x ?? '').replace(/[^\d.\-]/g, '')); return isNaN(f) ? null : f; };
  const fmt = (x, d = 1) => x == null ? '—' : (+x).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d });
  const sign = (x, d = 1) => x == null ? '—' : (x > 0 ? '+' : '') + fmt(x, d);
  const esc = s => (window.escHtml ? escHtml(String(s ?? '')) : String(s ?? ''));
  const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const thd = iso => { const m = String(iso || '').match(/(\d{4})-(\d{2})-(\d{2})/); return m ? `${+m[3]} ${TH_M[+m[2] - 1]} ${(+m[1] + 543) % 100}` : ''; };
  const fy = iso => { const d = new Date(iso); return d.getFullYear() + 543 + (d.getMonth() >= 9 ? 1 : 0); };
  let chA1c = null, chWt = null, selected = null, showNames = true, fyFilter = '';

  function patientStats() {
    const visits = getVisits();
    const base = (window.loadBaseline ? loadBaseline() : {}) || {};
    return PATIENTS.map((p, i) => {
      let pvs = visits.filter(v => v.patientId === p.id).sort((a, b) => a.date.localeCompare(b.date));
      if (fyFilter) pvs = pvs.filter(v => fy(v.date) <= +fyFilter);   // ข้อมูลถึงสิ้นปีงบที่เลือก
      if (!pvs.length) return null;
      const first = pvs[0], last = pvs[pvs.length - 1];
      const a1c = pvs.map(v => ({ d: v.date, v: n(v.hba1c) })).filter(x => x.v != null);
      const wt = pvs.map(v => ({ d: v.date, v: n(v.weight) })).filter(x => x.v != null);
      const dmNames = v => [...new Set((v.drugs || []).filter(d => isDiabetesDrug(d.name)).map(d => d.name.replace(/\s*\d.*$/, '').replace(/\(.*?\)/g, '').trim()))];
      const firstWithDrugs = pvs.find(v => (v.drugs || []).length) || first;
      const lastWithDrugs = [...pvs].reverse().find(v => (v.drugs || []).length) || last;
      const dm0 = dmNames(firstWithDrugs), dm1 = dmNames(lastWithDrugs);
      const a0 = a1c.length ? a1c[0].v : null, a1 = a1c.length ? a1c[a1c.length - 1].v : null;
      const drugDates = pvs.filter(v => (v.drugs || []).some(d => isDiabetesDrug(d.name))).map(v => v.date);
      const meets = x => x.v < 6.5 && !drugDates.some(d => d <= x.d && (new Date(x.d) - new Date(d)) / 86400000 < 90);
      const lastA = a1c[a1c.length - 1];
      const inRem = !!lastA && meets(lastA) && !drugDates.some(d => d > lastA.d);
      const everRem = a1c.some(meets);
      const improving = (a0 != null && a1 != null && a1 <= a0 - 0.3) || dm1.length < dm0.length;
      const status = inRem ? 'remission' : everRem ? 'relapse' : improving ? 'improving' : 'steady';
      const rem = { inRemission: inRem };
      const cost0 = n(base[p.id]) || dmDaily(firstWithDrugs) || 0, cost1 = dmDaily(lastWithDrugs) || 0;
      return { p, idx: i, pvs, first, last, a1c, wt, a0, a1, w0: wt.length ? wt[0].v : null, w1: wt.length ? wt[wt.length - 1].v : null,
        dm0, dm1, status, rem, cost0, cost1, months: (new Date(last.date) - new Date(first.date)) / 2629800000 };
    }).filter(Boolean);
  }
  const label = s => showNames ? (s.p.shortName || s.p.name) : 'ผู้ป่วย ' + String(s.idx + 1).padStart(2, '0');
  const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  function render() {
    const root = document.getElementById('page-infographic');
    if (!root || typeof getVisits !== 'function') return;
    if (!document.getElementById('ig-style')) { const st = document.createElement('style'); st.id = 'ig-style'; st.textContent = CSS; document.head.appendChild(st); }
    const S = patientStats();
    const fys = [...new Set(getVisits().map(v => fy(v.date)))].sort();
    const N = S.length;
    const remN = S.filter(s => s.status === 'remission').length;
    const a1Pairs = S.filter(s => s.a0 != null && s.a1 != null && s.a1c.length >= 2);
    const wPairs = S.filter(s => s.w0 != null && s.w1 != null && s.wt.length >= 2);
    const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
    const a0m = mean(a1Pairs.map(s => s.a0)), a1m = mean(a1Pairs.map(s => s.a1));
    const dW = mean(wPairs.map(s => s.w1 - s.w0)), dWp = mean(wPairs.map(s => (s.w1 - s.w0) / s.w0 * 100));
    const stopped = S.filter(s => s.dm0.length && !s.dm1.length).length, reduced = S.filter(s => s.dm1.length && s.dm1.length < s.dm0.length).length;
    const c0 = S.reduce((t, s) => t + s.cost0, 0), c1 = S.reduce((t, s) => t + s.cost1, 0);
    const firstDate = S.length ? S.map(s => s.first.date).sort()[0] : null;
    const syncedAt = window._dmHxLastSync ? `🗄 ซิงค์จาก HOSxP ${new Date(window._dmHxLastSync).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}` : '';

    root.innerHTML = `
      <div class="ig-hero">
        <div><h2>DM Remission Clinic · ผลลัพธ์โครงการ</h2>
          <div class="sub">โรงพยาบาลถ้ำพรรณรา · ผู้ป่วย ${N} ราย${firstDate ? ` · ตั้งแต่ ${thd(firstDate)}` : ''} · ข้อมูลจาก visit ที่บันทึกและซิงค์จาก HOSxP</div></div>
        <div class="ctrl">
          <label>ข้อมูลถึงปีงบ <select id="ig-fy"><option value="">ล่าสุด</option>${fys.map(f => `<option value="${f}"${String(f) === fyFilter ? ' selected' : ''}>${f}</option>`).join('')}</select></label>
          <label><input type="checkbox" id="ig-names"${showNames ? ' checked' : ''}> แสดงชื่อ</label>
          <button type="button" id="ig-sync" title="ดึงข้อมูลล่าสุดจาก HOSxP (เฉพาะเครื่องที่มี HOSxP Bridge)">🔄 ซิงค์ HOSxP</button>
          <span class="ig-sync">${esc(syncedAt)}</span>
        </div>
      </div>
      ${!N ? '<div class="ig-card ig-empty">ยังไม่มีข้อมูล visit</div>' : `
      <div class="ig-kpis">
        <div class="ig-kpi"><div class="lbl">เข้าภาวะสงบ</div><div class="val">${remN}<small> / ${N} ราย</small></div><div class="note">${N ? fmt(remN / N * 100, 0) : 0}% · HbA1c ล่าสุด &lt; 6.5% โดยไม่ใช้ยาลดน้ำตาล ≥ 3 เดือนก่อนตรวจ</div></div>
        <div class="ig-kpi"><div class="lbl">HbA1c เฉลี่ย (ครั้งแรก → ล่าสุด)</div><div class="val">${fmt(a0m)}<small> → </small>${fmt(a1m)}<small>%</small></div><span class="delta">${sign(a1m != null && a0m != null ? a1m - a0m : null)} %</span> <span class="note">${a1Pairs.length} ราย</span></div>
        <div class="ig-kpi"><div class="lbl">น้ำหนักเปลี่ยนเฉลี่ย</div><div class="val">${sign(dW)}<small> กก.</small></div><span class="delta">${sign(dWp)}% ของน้ำหนักตั้งต้น</span> <span class="note">${wPairs.length} ราย</span></div>
        <div class="ig-kpi"><div class="lbl">ยาลดน้ำตาล</div><div class="val">${stopped}<small> หยุดได้</small> · ${reduced}<small> ลดลง</small></div><div class="note">เทียบรายการยาครั้งแรกกับครั้งล่าสุด</div></div>
        <div class="ig-kpi gold"><div class="lbl">ค่ายาลดน้ำตาล (ทั้งคลินิก)</div><div class="val">฿${fmt(c0, 0)}<small> → </small>฿${fmt(c1, 0)}<small> /วัน</small></div><span class="delta">ประหยัด ฿${fmt(Math.max(0, (c0 - c1) * 365), 0)} /ปี</span></div>
      </div>
      <div class="ig-grid2">
        <div class="ig-card"><h3>HbA1c ตั้งแต่เข้าคลินิก</h3><div class="cap">แกนนอน = เดือนนับจาก visit แรก · เส้นเขียว = มัธยฐานของคลินิก · คลิกการ์ดผู้ป่วยด้านล่างเพื่อเน้นเส้นของคนนั้น</div>
          <div class="ig-chart"><canvas id="ig-a1c" aria-label="กราฟ HbA1c ตามเวลา"></canvas></div>
          <div class="ig-legend"><span><i style="background:var(--ig-brand);height:4px"></i>มัธยฐานคลินิก</span><span><i style="background:#c9cfcb"></i>ผู้ป่วยแต่ละราย</span><span><i style="background:var(--ig-s1)"></i>ผู้ป่วยที่เลือก</span><span><i style="background:var(--ig-good);height:0;border-top:2px dashed var(--ig-good)"></i>เกณฑ์ 6.5%</span></div></div>
        <div class="ig-card"><h3>สถานะผู้ป่วย</h3><div class="cap">ภาวะสงบ = HbA1c ล่าสุด &lt; 6.5% และไม่ได้ใช้ยาลดน้ำตาล ≥ 3 เดือน · กลับเป็นซ้ำ = เคยเข้าเกณฑ์แล้วตอนนี้ไม่เข้า · ดีขึ้น = HbA1c ลดลง ≥ 0.3% หรือใช้ยาลดน้ำตาลน้อยลง</div>
          <div class="ig-status">${Object.entries(STATUS).map(([k, s]) => { const c = S.filter(x => x.status === k).length; return `<div class="ig-srow"><span>${s.icon} ${s.label}</span><div class="ig-sbar"><span style="width:${N ? c / N * 100 : 0}%;background:${s.color}"></span></div><b>${c}</b></div>`; }).join('')}</div>
          <h3 style="margin-top:16px">น้ำหนักเปลี่ยนแปลง (%)</h3><div class="cap">ครั้งแรก → ครั้งล่าสุด · น้ำเงิน = ลดลง · แดง = เพิ่มขึ้น</div>
          <div class="ig-chart" style="height:${Math.max(140, wPairs.length * 22 + 40)}px"><canvas id="ig-wt" aria-label="กราฟน้ำหนักเปลี่ยนแปลงรายคน"></canvas></div></div>
      </div>
      <div class="ig-card" style="margin-bottom:12px"><h3>ผู้ป่วยรายคน</h3><div class="cap">ยาลดน้ำตาล: ขีดฆ่า = หยุดแล้ว (เทียบครั้งแรก) · คลิกเพื่อเน้นในกราฟ</div>
        <div class="ig-pts">${S.map(s => cardHtml(s)).join('')}</div></div>
      <details class="ig-card" style="margin-bottom:12px"><summary style="cursor:pointer;font-weight:700">📋 ดูเป็นตาราง</summary>
        <div style="overflow-x:auto;margin-top:8px"><table class="ig-tbl"><thead><tr><th>ผู้ป่วย</th><th>สถานะ</th><th>เดือนในโครงการ</th><th>HbA1c แรก</th><th>HbA1c ล่าสุด</th><th>น้ำหนักแรก</th><th>ล่าสุด</th><th>ยาลดน้ำตาล แรก</th><th>ล่าสุด</th><th>ค่ายา/วัน แรก</th><th>ล่าสุด</th></tr></thead><tbody>
        ${S.map(s => `<tr><td>${esc(label(s))}</td><td>${STATUS[s.status].icon} ${STATUS[s.status].label}</td><td>${fmt(s.months, 0)}</td><td>${fmt(s.a0)}</td><td>${fmt(s.a1)}</td><td>${fmt(s.w0)}</td><td>${fmt(s.w1)}</td><td>${s.dm0.length}</td><td>${s.dm1.length}</td><td>${fmt(s.cost0, 2)}</td><td>${fmt(s.cost1, 2)}</td></tr>`).join('')}
        </tbody></table></div></details>`}`;
    const q = id => document.getElementById(id);
    q('ig-fy').onchange = e => { fyFilter = e.target.value; render(); };
    q('ig-names').onchange = e => { showNames = e.target.checked; render(); };
    q('ig-sync').onclick = () => window.dmHxSyncAll && dmHxSyncAll(true);
    root.querySelectorAll('.ig-pt').forEach(c => c.onclick = () => { selected = selected === c.dataset.pid ? null : c.dataset.pid; render(); });
    if (N) drawCharts(S, wPairs);
  }

  function cardHtml(s) {
    const st = STATUS[s.status];
    const spark = s.a1c.length >= 2 ? sparkline(s.a1c.map(x => x.v), s.a1c.map(x => x.d), { w: 110, h: 30, color: '#2a78d6', refLine: 6.5 }) : '';
    const all = [...new Set([...s.dm0, ...s.dm1])];
    return `<div class="ig-pt${selected === s.p.id ? ' on' : ''}" data-pid="${esc(s.p.id)}">
      <div class="top"><div><div class="nm">${esc(label(s))}</div><div class="mo">${fmt(s.months, 0)} เดือน · ${s.pvs.length} visit</div></div><span class="ig-badge ${s.status}">${st.icon} ${st.label}</span></div>
      <div class="row"><span>HbA1c <b>${fmt(s.a0)} → ${fmt(s.a1)}</b>%</span>${spark}</div>
      <div class="row"><span>น้ำหนัก <b>${fmt(s.w0)} → ${fmt(s.w1)}</b> กก.</span><span>${s.w0 != null && s.w1 != null ? sign(s.w1 - s.w0) + ' กก.' : ''}</span></div>
      <div class="drugs">${all.length ? all.map(d => `<span class="${s.dm1.includes(d) ? '' : 'off'}">${esc(d)}</span>`).join('') : '<span>ไม่มียาลดน้ำตาล</span>'}</div>
    </div>`;
  }

  function drawCharts(S, wPairs) {
    if (typeof Chart === 'undefined') return;
    if (chA1c) chA1c.destroy();
    if (chWt) chWt.destroy();
    const mo = (s, d) => (new Date(d) - new Date(s.first.date)) / 2629800000;
    const lines = S.filter(s => s.a1c.length).map(s => {
      const on = selected === s.p.id;
      return { label: label(s), data: s.a1c.map(x => ({ x: +mo(s, x.d).toFixed(1), y: x.v, d: x.d })), showLine: true,
        borderColor: on ? '#2a78d6' : '#c9cfcb', backgroundColor: on ? '#2a78d6' : '#c9cfcb', borderWidth: on ? 3 : 1.5,
        pointRadius: on ? 4 : 2.5, pointHoverRadius: 6, order: on ? 0 : 2, tension: 0.25 };
    });
    // มัธยฐานรายไตรมาสนับจาก visit แรก
    const buckets = {};
    S.forEach(s => s.a1c.forEach(x => { const b = Math.round(mo(s, x.d) / 3) * 3; (buckets[b] = buckets[b] || []).push(x.v); }));
    const med = Object.keys(buckets).map(Number).sort((a, b) => a - b).filter(b => buckets[b].length >= 2).map(b => ({ x: b, y: +median(buckets[b]).toFixed(2), k: buckets[b].length }));
    lines.push({ label: 'มัธยฐานคลินิก', data: med, showLine: true, borderColor: '#1A5E38', backgroundColor: '#1A5E38', borderWidth: 4, pointRadius: 3, order: -1, tension: 0.25, isMed: true });
    const maxX = Math.max(3, ...lines.flatMap(l => l.data.map(p => p.x)));
    lines.push({ label: 'เกณฑ์ 6.5%', data: [{ x: 0, y: 6.5 }, { x: maxX, y: 6.5 }], showLine: true, borderColor: '#0ca30c', borderDash: [5, 4], borderWidth: 2, pointRadius: 0, order: 3, isRef: true });
    chA1c = new Chart(document.getElementById('ig-a1c'), {
      type: 'scatter', data: { datasets: lines },
      options: { maintainAspectRatio: false, animation: false,
        scales: { x: { type: 'linear', min: 0, title: { display: true, text: 'เดือนนับจาก visit แรก' }, grid: { color: '#eef2ef' } },
          y: { title: { display: true, text: 'HbA1c (%)' }, grid: { color: '#eef2ef' }, suggestedMin: 4.5, suggestedMax: 9 } },
        plugins: { legend: { display: false },
          tooltip: { filter: i => !i.dataset.isRef, callbacks: { label: c => c.dataset.isMed ? `มัธยฐาน ${c.raw.y}% (${c.raw.k} ค่า) · เดือนที่ ${c.raw.x}` : `${c.dataset.label}: ${c.raw.y}% · ${thd(c.raw.d)}` } } } },
    });
    const w = wPairs.map(s => ({ s, pct: (s.w1 - s.w0) / s.w0 * 100 })).sort((a, b) => a.pct - b.pct);
    chWt = new Chart(document.getElementById('ig-wt'), {
      type: 'bar',
      data: { labels: w.map(x => label(x.s)), datasets: [{ data: w.map(x => +x.pct.toFixed(1)),
        backgroundColor: w.map(x => selected === x.s.p.id ? '#124228' : x.pct <= 0 ? '#2a78d6' : '#e34948'), borderRadius: 4, borderSkipped: false, barThickness: 14 }] },
      options: { indexAxis: 'y', maintainAspectRatio: false, animation: false,
        scales: { x: { title: { display: true, text: '% เปลี่ยนจากน้ำหนักตั้งต้น' }, grid: { color: '#eef2ef' } }, y: { grid: { display: false } } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => { const x = w[c.dataIndex]; return `${sign(x.pct)}% (${fmt(x.s.w0)} → ${fmt(x.s.w1)} กก.)`; } } } } },
    });
  }

  window.renderInfographic = render;
})();
