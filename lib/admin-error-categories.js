/* admin-error-categories.js — shared IPD Administration Error category list.
   Used by ME_Dashboard.html (data entry) and admin-error-ipd.html (nurse dashboard).
   Edit categories here only — do not fork this list back into either page. */
'use strict';

const IPD_METYPE_ADMIN = [
  'ให้ยาไม่ครบตามรายการที่สั่ง (Omission Error)',
  'ให้ยาผิดชนิด (Wrong Drug Error)',
  'ให้ยาที่ไม่ได้สั่ง (Unauthorized Drug Error)',
  'ให้ยาผิดวิธีใช้ยา (Wrong Method of Use Error)',
  'ให้ยาผิดจำนวน (Wrong Dose Error)',
  'ให้ยาผิดคน (Wrong Patient Error)',
  'ให้ยาผิดขนาด (Wrong Strength Error)',
  'ให้ยาผิดวิถีทางการให้ยา (Wrong Route Error)',
  'ให้ยาผิดเวลา (Wrong Time Error)',
  'ให้ยาผิดอัตราเร็ว (Wrong Rate Error)',
  'ให้ยาผิดเทคนิคการให้ยา (Wrong Administration Technique Error)',
  'ให้ยาที่ผู้ป่วยแพ้ (Known Allergy Error)',
  'ให้ยาที่มีปฏิกิริยาระหว่างยา (Drug Interaction Error)',
  'ให้ยาผิดรูปแบบยา (Wrong Dosage Form Error)',
  'ไม่ได้เก็บยากลับคืนหลังมื้อเที่ยง (Medication Not Retrieved After Administration)',
  'ยาไม่ผ่านการตรวจสอบของพยาบาลก่อนให้ผู้ป่วย (Unverified/Bypassed Nursing Administration)',
  'อื่นๆ (Others)'
];
// แปลงชื่อหมวดแบบเดิม (ก่อนเพิ่มวงเล็บภาษาอังกฤษ) ให้ตรงกับหมวดใหม่ — กันข้อมูลเก่าเพี้ยนหมวด
const LEGACY_ADMIN_CAT_MAP = {
  'ให้ยาไม่ครบรายการ':      IPD_METYPE_ADMIN[0],
  'ให้ยาผิดชนิด':            IPD_METYPE_ADMIN[1],
  'ให้ยาที่ไม่ได้สั่ง':         IPD_METYPE_ADMIN[2],
  'ให้ยาผิดวิธีใช้':           IPD_METYPE_ADMIN[3],
  'ให้ยาผิดจำนวน':           IPD_METYPE_ADMIN[4],
  'ให้ยาผิดคน':              IPD_METYPE_ADMIN[5],
  'ให้ยาผิดขนาด':            IPD_METYPE_ADMIN[6],
  'ให้ยาผิดวิถีทาง':          IPD_METYPE_ADMIN[7],
  'ให้ยาผิดเวลา':            IPD_METYPE_ADMIN[8],
  'ให้ยาในอัตราเร็วที่ผิด':     IPD_METYPE_ADMIN[9],
  'ให้ยาผิดเทคนิค':          IPD_METYPE_ADMIN[10],
  'ให้ยาที่แพ้':              IPD_METYPE_ADMIN[11],
  'ให้ยาที่มี DI กัน':         IPD_METYPE_ADMIN[12],
  'ให้ยาผิดรูปแบบยา':        IPD_METYPE_ADMIN[13],
  'ไม่ได้เก็บยากลับคืนเที่ยง':  IPD_METYPE_ADMIN[14],
  'อื่นๆ':                  IPD_METYPE_ADMIN[16],
};
const OTHER_ADMIN_CAT = IPD_METYPE_ADMIN[IPD_METYPE_ADMIN.length - 1];
const IPD_METYPE_ADMIN_SET = new Set(IPD_METYPE_ADMIN);
function normalizeAdminCat(v) {
  if (!v) return null;
  if (IPD_METYPE_ADMIN_SET.has(v)) return v;
  return LEGACY_ADMIN_CAT_MAP[v] || null;
}
