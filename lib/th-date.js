/**
 * th-date.js — วันที่ปฏิทินตามเวลาไทย (Asia/Bangkok) ไม่ขึ้นกับ timezone ของเครื่อง
 *
 * ใช้แทน new Date().toISOString().slice(0, 10 / 7) ที่แปลงเป็น UTC ก่อน — ก่อน 07:00 น. จะได้วัน/เดือนก่อนหน้า
 * และ new Date(y, m, d).toISOString() ที่ได้วันก่อนหน้าเสมอ (เที่ยงคืนไทย = 17:00 UTC ของเมื่อวาน)
 * timestamp ที่ต้องเป็น UTC จริง (updated, createdAt) ยังใช้ toISOString() ตามเดิม
 *
 *   TphDate.ymd()            → '2026-10-30'   (วันนี้ตามเวลาไทย)
 *   TphDate.ym()             → '2026-10'
 *   TphDate.addMonths('2026-01', -1) → '2025-12'
 *   TphDate.lastFriday(2026, 10)     → '2026-10-30'
 *   TphDate.nextLastFriday()  → ศุกร์สุดท้ายของเดือนนี้ (รวมวันนี้ถ้าวันนี้คือวันนั้น) ไม่งั้นของเดือนหน้า
 *   TphDate.daysBetween('2026-10-29', '2026-10-30') → 1
 */
(function (root) {
  const FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' });
  const pad = n => String(n).padStart(2, '0');

  function ymd(d) {
    const p = {};
    FMT.formatToParts(d || new Date()).forEach(x => { p[x.type] = x.value; });
    return `${p.year}-${p.month}-${p.day}`;
  }
  function ym(d) { return ymd(d).slice(0, 7); }
  function addMonths(ymStr, n) {
    const [y, m] = String(ymStr).split('-').map(Number);
    const t = y * 12 + (m - 1) + n;
    return `${Math.floor(t / 12)}-${pad(t % 12 + 1)}`;
  }
  // m = 1–12 · คำนวณบนปฏิทินล้วน (UTC) ไม่มีเรื่องเวลา
  function lastFriday(y, m) {
    const last = new Date(Date.UTC(y, m, 0));               // วันสุดท้ายของเดือน m
    const back = (last.getUTCDay() - 5 + 7) % 7;            // 5 = ศุกร์
    return `${y}-${pad(m)}-${pad(last.getUTCDate() - back)}`;
  }
  function nextLastFriday(now) {
    const today = ymd(now);
    let [y, m] = today.split('-').map(Number);
    let c = lastFriday(y, m);
    if (c < today) { if (++m > 12) { m = 1; y++; } c = lastFriday(y, m); }
    return c;
  }
  const dayNum = s => { const [y, m, d] = String(s).split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
  function daysBetween(from, to) { return dayNum(to) - dayNum(from); }

  root.TphDate = { ymd, ym, addMonths, lastFriday, nextLastFriday, daysBetween };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.TphDate;
})(typeof window !== 'undefined' ? window : globalThis);
