/* export-utils.js — shared export helpers (Excel + PDF + modal) */
'use strict';

/* ══ DATE FILTER ════════════════════════════════════════════════ */

function expFilter(records, f) {
  return records.filter(r => {
    const d = r.date || '';
    if (!d) return false;
    if (f.type === 'date') {
      if (f.from && d < f.from) return false;
      if (f.to   && d > f.to)   return false;
    } else if (f.type === 'month') {
      if (!d.startsWith(f.month)) return false;
    } else if (f.type === 'year') {
      const s = (f.fyCE - 1) + '-10-01', e = f.fyCE + '-09-30';
      if (d < s || d > e) return false;
    }
    return true;
  });
}

/* ══ EXCEL ══════════════════════════════════════════════════════ */

function expExcel(sheets, filename) {
  if (typeof XLSX === 'undefined') { alert('ไม่พบ xlsx.js'); return; }
  const wb = XLSX.utils.book_new();
  sheets.forEach(({ name, data }) => {
    const ws = XLSX.utils.json_to_sheet(data);
    if (data.length) {
      ws['!cols'] = Object.keys(data[0]).map(k => ({
        wch: Math.min(45, Math.max(
          String(k).length + 2,
          ...data.slice(0, 200).map(r => String(r[k] == null ? '' : r[k]).length + 1)
        ))
      }));
    }
    XLSX.utils.book_append_sheet(wb, ws, String(name).slice(0, 31));
  });
  XLSX.writeFile(wb, filename + '.xlsx');
}

/* ══ PDF ════════════════════════════════════════════════════════ */

function expPDF({ title, subtitle, headers, rows, landscape }) {
  const base = location.href.replace(/[^/]*(\?.*)?$/, '');
  const orient = landscape ? 'landscape' : 'portrait';

  const thHTML = headers.map(h => `<th>${h}</th>`).join('');
  const tbHTML = rows.map(r =>
    `<tr>${r.map(c => `<td>${c == null ? '' : String(c).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\n/g,'<br>')}</td>`).join('')}</tr>`
  ).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>${title}</title>
<link href="${base}lib/noto-sans-thai.css" rel="stylesheet">
<style>
body{font-family:'Noto Sans Thai','Sarabun',sans-serif;font-size:9pt;margin:0;padding:0}
.pg{padding:12mm 10mm 8mm}
h2{font-size:12pt;color:#1A5E38;margin:0 0 2px;font-weight:800}
.sub{font-size:8.5pt;color:#666;margin:0 0 10px}
table{width:100%;border-collapse:collapse}
th{background:#1A5E38;color:#fff;padding:5px 7px;text-align:left;font-size:8pt;white-space:nowrap}
td{padding:4px 7px;border-bottom:1px solid #e4e8e6;font-size:8pt;vertical-align:top;word-break:break-word}
tr:nth-child(even) td{background:#f5faf7}
.foot{margin-top:8px;font-size:7.5pt;color:#aaa;text-align:right;border-top:1px solid #e0e0e0;padding-top:4px}
@media print{@page{size:A4 ${orient};margin:0}body{margin:0}.pg{padding:10mm 8mm 6mm}}
</style></head><body><div class="pg">
<h2>${title}</h2><div class="sub">${subtitle}</div>
<table><thead><tr>${thHTML}</tr></thead><tbody>${tbHTML}</tbody></table>
<div class="foot">รายการทั้งหมด ${rows.length} รายการ &nbsp;|&nbsp; พิมพ์เมื่อ ${new Date().toLocaleString('th-TH')} &nbsp;|&nbsp; รพ.ถ้ำพรรณรา</div>
</div><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),500))<\/script>
</body></html>`;

  const w = window.open('', '_blank', 'width=1080,height=740');
  if (!w) { alert('กรุณาอนุญาต popup ใน browser ก่อน export PDF'); return; }
  w.document.write(html);
  w.document.close();
}

/* ══ MODAL ══════════════════════════════════════════════════════ */

let _expTab = 'date';

function expModalOpen(previewFn) {
  window._expPreviewFn = previewFn;
  const now = new Date();
  const cyTH = now.getFullYear() + 543;
  const fyTH = now.getMonth() >= 9 ? cyTH + 1 : cyTH;

  const mySel = document.getElementById('exp-month-year');
  if (!mySel.children.length)
    mySel.innerHTML = Array.from({length:5},(_,i)=>cyTH-i).map(y=>`<option>${y}</option>`).join('');

  const fySel = document.getElementById('exp-fy');
  if (!fySel.children.length)
    fySel.innerHTML = Array.from({length:5},(_,i)=>fyTH-i).map(y=>`<option>${y}</option>`).join('');

  document.getElementById('exp-month').value = String(now.getMonth()+1).padStart(2,'0');
  document.getElementById('export-modal').classList.add('show');
  expSetTab('date');
}

function expModalClose() {
  document.getElementById('export-modal').classList.remove('show');
}

function expSetTab(t) {
  _expTab = t;
  ['date','month','year'].forEach(x => {
    document.getElementById('exp-pane-'+x).style.display = x===t ? '' : 'none';
    const b = document.getElementById('exp-tab-'+x);
    b.style.background = x===t ? 'var(--primary)' : 'var(--bg,#f4f7f5)';
    b.style.color      = x===t ? '#fff' : 'var(--text-mid,#3D5A47)';
  });
  expUpdatePreview();
}

function expUpdatePreview() {
  if (!window._expPreviewFn) return;
  const n = window._expPreviewFn(expGetFilter());
  document.getElementById('exp-preview').textContent = `📊 พบ ${n} รายการที่จะ export`;
}

function expGetFilter() {
  if (_expTab === 'date') {
    const f = document.getElementById('exp-from').value.trim();
    const t = document.getElementById('exp-to').value.trim();
    return { type:'date', from: f ? _expTH2ISO(f):null, to: t ? _expTH2ISO(t):null };
  }
  if (_expTab === 'month') {
    const m = document.getElementById('exp-month').value;
    const y = parseInt(document.getElementById('exp-month-year').value) - 543;
    return { type:'month', month:`${y}-${m}` };
  }
  const fy = parseInt(document.getElementById('exp-fy').value) - 543;
  return { type:'year', fyCE: fy };
}

function expFilterLabel(f) {
  const mn = ['','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  if (f.type === 'date') {
    const a = f.from ? expISOtoTH(f.from) : 'ทั้งหมด';
    const b = f.to   ? expISOtoTH(f.to)   : 'ทั้งหมด';
    return a === b && a !== 'ทั้งหมด' ? a : `${a}–${b}`;
  }
  if (f.type === 'month') {
    const [y,m] = f.month.split('-');
    return `${mn[parseInt(m)]} ${parseInt(y)+543}`;
  }
  return `ปีงบประมาณ ${f.fyCE+543}`;
}

function expISOtoTH(iso) {
  if (!iso) return '';
  const [y,m,d] = iso.split('-');
  const mn = ['','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  return `${parseInt(d)} ${mn[parseInt(m)]} ${parseInt(y)+543}`;
}

function _expTH2ISO(s) {
  const p = s.split('/');
  if (p.length !== 3) return s;
  const y = parseInt(p[2]) > 2500 ? parseInt(p[2])-543 : parseInt(p[2]);
  return `${y}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
}
