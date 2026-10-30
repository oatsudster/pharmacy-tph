/**
 * chart-month-note.js — ทำเครื่องหมายเดือนปัจจุบัน (ยังไม่สิ้นสุด) บนกราฟรายเดือนทุกหน้าให้เหมือนกัน
 *
 *   labels: months.map(ym => TphMonthNote.mark(labelMonth(ym), ym))   // เดือนนี้ → "ต.ค. 69 *"
 *
 * ปลั๊กอิน Chart.js (ลงทะเบียนเองเมื่อโหลดหลัง chart.min.js): กราฟที่มีป้ายลงท้าย " *" จะมีหมายเหตุมุมขวาล่าง
 *   "* เดือนนี้ยังไม่สิ้นสุด — อย่าเทียบตรงๆ กับเดือนเต็ม" (รูปแบบ * เดียวกับหน้าติดตามรายได้ประกัน)
 * เดือนปัจจุบันคิดตามเวลาไทย (Asia/Bangkok) ไม่ขึ้นกับ timezone ของเครื่อง
 */
(function (root) {
  const NOTE = '* เดือนนี้ยังไม่สิ้นสุด — อย่าเทียบตรงๆ กับเดือนเต็ม';
  const PAD = 16;
  function currentYm() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 7); }
  function mark(label, ym) { return String(ym).slice(0, 7) === currentYm() ? label + ' *' : label; }
  const marked = chart => (chart.data.labels || []).some(l => /\s\*$/.test(String(l)));

  const plugin = {
    id: 'tphMonthNote',
    // เว้นที่ใต้กราฟให้หมายเหตุ เฉพาะกราฟที่มีเดือนปัจจุบัน (เก็บ padding เดิมไว้ ไม่บวกซ้ำทุกครั้งที่ update)
    beforeUpdate(chart) {
      const o = chart.config.options || (chart.config.options = {});
      o.layout = o.layout || {};
      if (!('tphPad' in chart)) chart.tphPad = o.layout.padding;
      const p = chart.tphPad;
      const base = typeof p === 'number' ? { top: p, right: p, bottom: p, left: p } : Object.assign({}, p || {});
      if (marked(chart)) base.bottom = (base.bottom || 0) + PAD;
      o.layout.padding = base;
    },
    afterDraw(chart) {
      if (!marked(chart)) return;
      const ctx = chart.ctx;
      ctx.save();
      ctx.font = '11px "Noto Sans Thai", "Sarabun", sans-serif';
      ctx.fillStyle = '#587363';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(NOTE, chart.width - 4, chart.height - 2);
      ctx.restore();
    },
  };
  if (root.Chart && root.Chart.register) root.Chart.register(plugin);

  root.TphMonthNote = { mark, currentYm, NOTE, plugin };
})(typeof window !== 'undefined' ? window : globalThis);
