/* ทะเบียนเจ้าหน้าที่ คปสอ.ถ้ำพรรณรา — ใช้ร่วมกันระหว่าง staff-update.html (ฟอร์มสาธารณะ ส่งลิงก์ในไลน์ รพ.สต.)
 * และ annual-docs.html (หมวด "ทะเบียนเจ้าหน้าที่": ตรวจรับคำขอ + เลือกรายชื่อลงคำสั่ง)
 *
 * Firestore (collection pharmacy_tph)
 *   staff_registry  { json: '{"staff":[{id,unit,prefix,first,last,pos,phone,at}]}', updated }   ← แก้จาก annual-docs เท่านั้น
 *   staff_requests  { reqs: [{id,at,unit,by,byPhone,note,items:[{type,staffId,prefix,first,last,pos,phone}]}], done: {reqId: 'ok'|'no'} }
 *     ฟอร์มสาธารณะเพิ่มคำขอด้วย arrayUnion (ไม่ทับของหน่วยอื่น) · type = keep | edit | leave | add
 */
(function () {
  const UNITS = [
    'โรงพยาบาลถ้ำพรรณรา',
    'สำนักงานสาธารณสุขอำเภอถ้ำพรรณรา',
    'รพ.สต.บ้านแพรกกลาง',
    'รพ.สต.บ้านพรรณราชลเขต',
    'รพ.สต.บ้านควนกอ',
    'รพ.สต.บ้านปลายเส',
    'รพ.สต.บ้านเกาะขวัญ',
  ];
  const PREFIXES = ['นาย', 'นาง', 'นางสาว', 'ดร.', 'ว่าที่ร้อยตรี', 'ว่าที่ร้อยตรีหญิง', 'นายแพทย์', 'แพทย์หญิง'];
  const POSITIONS = [
    'ผู้อำนวยการโรงพยาบาลส่งเสริมสุขภาพตำบล',
    'นักวิชาการสาธารณสุข', 'นักวิชาการสาธารณสุขปฏิบัติการ', 'นักวิชาการสาธารณสุขชำนาญการ', 'นักวิชาการสาธารณสุขชำนาญการพิเศษ',
    'นักสาธารณสุขปฏิบัติการ', 'นักสาธารณสุขชำนาญการ',
    'พยาบาลวิชาชีพปฏิบัติการ', 'พยาบาลวิชาชีพชำนาญการ', 'พยาบาลวิชาชีพชำนาญการพิเศษ',
    'เจ้าพนักงานสาธารณสุขปฏิบัติงาน', 'เจ้าพนักงานสาธารณสุขชำนาญงาน', 'เจ้าพนักงานสาธารณสุขอาวุโส',
    'เจ้าพนักงานทันตสาธารณสุขปฏิบัติงาน', 'เจ้าพนักงานทันตสาธารณสุขชำนาญงาน', 'ทันตาภิบาล',
    'แพทย์แผนไทยปฏิบัติการ', 'แพทย์แผนไทยชำนาญการ',
    'เภสัชกรปฏิบัติการ', 'เภสัชกรชำนาญการ', 'เจ้าพนักงานเภสัชกรรมปฏิบัติงาน', 'เจ้าพนักงานเภสัชกรรมชำนาญงาน',
    'นายแพทย์ปฏิบัติการ', 'นายแพทย์ชำนาญการ', 'นายแพทย์ชำนาญการพิเศษ',
    'ผู้ช่วยนักวิชาการสาธารณสุข', 'ผู้ช่วยเจ้าหน้าที่สาธารณสุข', 'พนักงานบริการ', 'พนักงานช่วยเหลือคนไข้',
  ];
  const splitPrefix = (v) => {
    v = String(v || '').trim();
    const p = [...PREFIXES].sort((a, b) => b.length - a.length).find((x) => v.startsWith(x));
    return p ? [p, v.slice(p.length).trim()] : ['', v];
  };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const fullName = (s) => `${s.prefix || ''}${s.first || ''} ${s.last || ''}`.trim();
  const FB = {
    apiKey: 'AIzaSyDHiTSM7fz1FihDLyb_QxLGheo_6CuNXIE',
    authDomain: 'pharmacy-tph.firebaseapp.com',
    projectId: 'pharmacy-tph',
    storageBucket: 'pharmacy-tph.firebasestorage.app',
  };
  // ลิงก์ฟอร์มที่ส่งในไลน์ (เปิดจากเครื่องตัวเองแบบ file:// ก็ให้ลิงก์เว็บจริง)
  const formUrl = () => (location.protocol === 'file:' ? 'https://tph-pharmacy.pages.dev/staff-update.html'
    : new URL('staff-update.html', location.href).href.split('#')[0].split('?')[0]);
  window.TphStaff = { UNITS, PREFIXES, POSITIONS, splitPrefix, uid, fullName, FB, COL: 'pharmacy_tph', REG: 'staff_registry', REQ: 'staff_requests', formUrl };
})();
