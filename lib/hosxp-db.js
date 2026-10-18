// อ่านข้อมูลจากฐานข้อมูล HOSxP ผ่าน HOSxP Bridge ที่รันในเครื่องนี้ (127.0.0.1:8765, อ่านอย่างเดียว)
// ใช้ได้เฉพาะเครื่องใน รพ. ที่ติดตั้ง bridge พร้อม db.json — เครื่องอื่นได้ null กลับมา หน้าเว็บต้องทำงานต่อได้ตามปกติ
// หน้าที่ใช้ต้องเพิ่ม http://127.0.0.1:8765 ใน connect-src ของ CSP
(function () {
  const BASE = 'http://127.0.0.1:8765/db/';
  async function get(path, hn, extra) {
    hn = String(hn || '').trim();
    if (!/^\d{5,10}$/.test(hn)) return null;
    try {
      const res = await fetch(BASE + path + '?hn=' + encodeURIComponent(hn) + (extra || ''), { cache: 'no-store', targetAddressSpace: 'loopback' });
      if (!res.ok) return null;
      const j = await res.json();
      return j && j.ok ? j : null;
    } catch (e) { return null; }
  }
  async function getPath(path) {
    try {
      const res = await fetch(BASE + path, { cache: 'no-store', targetAddressSpace: 'loopback' });
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
    // ยาเดิม: { visits:[{clinic,clinicName,vn,date,time,drugs}] (visit ล่าสุดที่มียาของแต่ละคลินิกนัด DM/HT/COPD),
    //           discharge:{an,regdate,dchdate,dchtime,drugs} (ยากลับบ้านของการนอน รพ. ครั้งล่าสุด) | null }
    meds: hn => get('meds', hn),
    // ตัวหาร ME รายเดือน 24 เดือนล่าสุด { months: { 'YYYY-MM': { opd: visit, ipd: วันนอน } } }
    denom: () => getPath('denom'),
    // รายงาน ADR ของห้องยา (Pharmacy > Adverse drug reactions) ตั้งแต่วันที่ from { items:[...] }
    // DM remission: คนไข้ที่มีนัดคลินิก NCDs remission / วันเข้าคลินิกพร้อมสัญญาณชีพ-lab-ยา / ข้อมูลคัดกรองคลินิกเบาหวาน
    dmRoster: () => getPath('dmroster'),
    // dates = วันที่เพิ่มเติมที่ต้องการข้อมูล (เช่น visit ที่บันทึกไว้แล้ว) นอกจากวันเข้าคลินิก
    dmVisits: (hn, dates) => get('dmvisits', hn, dates && dates.length ? '&dates=' + dates.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).join(',') : ''),
    dmScreen: () => getPath('dmscreen'),
    // รายงาน Medication error OPD/IPD (Pharmacy > Medication error) ตั้งแต่วันที่ from { items:[{id,hn,dept,date,time,patient,doctor,drug,stage,severity,meType,note,officer}] }
    me: from => getPath('me' + (/^\d{4}-\d{2}-\d{2}$/.test(from || '') ? '?from=' + from : '')),
    // ยาที่สั่งช่วงเวรบ่าย-ดึก: date = เช้าวันที่สิ้นสุดเวร, from/to = HH:MM (ค่าเริ่ม 19:30 → 08:00) { from, to, items:[...] }
    nightMeds: (date, from, to) => /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? getPath('nightmeds?date=' + date +
      (/^\d{1,2}:\d{2}$/.test(from || '') ? '&from=' + from : '') + (/^\d{1,2}:\d{2}$/.test(to || '') ? '&to=' + to : '')) : Promise.resolve(null),
    // ฟอร์มลง ME ER: date = "วันที่" ในฟอร์ม (เช้าวันสิ้นเวร) → ใบสั่งยาของ HN นี้วันที่ date-1 และ date
    // { name, birthday, sex, rx:[{vn,an,date,time,n,dep,age}] }
    erRx: (hn, date) => /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? get('errx', hn, '&date=' + date) : Promise.resolve(null),
    adr: from => getPath('adr' + (/^\d{4}-\d{2}-\d{2}$/.test(from || '') ? '?from=' + from : '')),
    // สติกเกอร์ยา: visit วันนี้/เมื่อคืนที่มียา + ใครล็อก VN { items:[{vn,hn,date,time,queue,name,dep,ndrug,lastmod,lockStaff,lockComputer,lockTime}] }
    rxQueue: () => getPath('rxqueue'),
    // ข้อมูลสติกเกอร์ยาแต่ละรายการของ HN นี้ (visit วันนี้/เมื่อวาน) ตามแบบสติกเกอร์ HOSxP { visits:[{vn,...,items:[...]}] }
    rxSticker: hn => get('rxsticker', hn),
    // ผู้ป่วยในที่ยังไม่จำหน่าย { items:[{an,hn,regdate,regtime,ward,wardName,bed,room,name}] }
    ipdList: () => getPath('ipdlist'),
    mrMeds: (hn, an) => /^\d+$/.test(String(an || '')) ? get('mrmeds', hn, '&an=' + an) : Promise.resolve(null),
    // ใบสั่งยากลับบ้าน (HMe) วันนี้/เมื่อวาน { orders:[{an,orderNo,date,time,hn,name,ward,bed,lastmod,items:[...]}], now }
    hme: () => getPath('hme'),
    // Smart Pharmacy: { sex, ageM, vitals:[{date,bps,bpd,pulse,bw,pregnancy,egfr}], labs:{cr:[{date,value}],...}, allergy, dxToday, dxHistory, ddi }
    smartRx: hn => get('smartrx', hn),
    thDate,
  };
})();
