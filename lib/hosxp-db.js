// อ่านข้อมูลจากฐานข้อมูล HOSxP ผ่าน HOSxP Bridge ที่รันในเครื่องนี้ (127.0.0.1:8765, อ่านอย่างเดียว)
// ใช้ได้เฉพาะเครื่องใน รพ. ที่ติดตั้ง bridge พร้อม db.json — เครื่องอื่นได้ null กลับมา หน้าเว็บต้องทำงานต่อได้ตามปกติ
// หน้าที่ใช้ต้องเพิ่ม http://127.0.0.1:8765 ใน connect-src ของ CSP
(function () {
  const BASE = 'http://127.0.0.1:8765/db/';
  async function get(path, hn) {
    hn = String(hn || '').trim();
    if (!/^\d{5,10}$/.test(hn)) return null;
    try {
      const res = await fetch(BASE + path + '?hn=' + encodeURIComponent(hn), { cache: 'no-store', targetAddressSpace: 'loopback' });
      if (!res.ok) return null;
      const j = await res.json();
      return j && j.ok ? j : null;
    } catch (e) { return null; }
  }
  // "2026-09-15" → "15 ก.ย. 2569"
  const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  function thDate(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${+m[3]} ${TH_M[+m[2] - 1]} ${+m[1] + 543}` : '';
  }
  window.tphHosxp = {
    // { pname, fname, lname, birthday, sex } — fullName = "นายสมชาย ใจดี"
    async patient(hn) {
      const p = await get('patient', hn);
      if (p) p.fullName = ((p.pname || '') + (p.fname || '') + ' ' + (p.lname || '')).trim();
      return p;
    },
    // ใบสั่งยา visit วันนี้ { vn, time, drugs:[{icode,name,strength,units,form,qty,usage}], appts:[{date,days,clinic}], apptDays }
    order: hn => get('order', hn),
    // ยา 6 visit ล่าสุดก่อนวันนี้ { visits:[{vn,date,time,dep,drugs:[...]}] } ใหม่ → เก่า
    visits: hn => get('visits', hn),
    thDate,
  };
})();
