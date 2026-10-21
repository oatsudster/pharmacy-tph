// ตรวจขนาดยาตามการทำงานของไต (eGFR / CrCl) — ใช้กับ Smart Pharmacy หน้าต่างลอยจ่ายยาของเภสัชกร (lib/smart-rx.js)
//   การทำงานของไต: Cr ล่าสุดใน 400 วัน (lab 3036/3003/3118), eGFR จาก lab 3189 ถ้าตรวจวันเดียวกับ Cr ไม่งั้นคำนวณ CKD-EPI 2021
//   CrCl = Cockcroft-Gault ด้วยน้ำหนักล่าสุดใน 1 ปี (ส่วนสูงมี: ผอมกว่า IBW ใช้น้ำหนักจริง, > 120% IBW ใช้ AdjBW, นอกนั้น IBW)
//   ยาส่วนใหญ่ใช้ CrCl ตามเอกสารกำกับยา/Lexicomp — metformin SGLT2 spironolactone KCl NSAID insulin ใช้ eGFR (KDIGO)
//   ไม่มีน้ำหนัก → ใช้ eGFR แทน CrCl · อายุ < 18 ปี ไม่ตรวจ (สูตรและขนาดยาเป็นของผู้ใหญ่)
// ขนาดยา/วัน มาจาก perDay ของ smart-rx (parseUsage) — อ่านวิธีใช้ไม่ออกจะบอกให้ตรวจเอง
// ผลเป็นตัวช่วยคัดกรอง เภสัชกรต้องพิจารณาเอง (ข้อบ่งใช้ ขนาด loading ฟอกไต ฯลฯ)
(function () {
  'use strict';

  // tier: เลือกอันแรกที่ค่าไต < lt
  //   max = ขนาดสูงสุด mg/วัน, avoid = ไม่ควรใช้, ไม่มีทั้งสอง = ข้อแนะนำ
  //   level ค่าเริ่มต้น avoid → high, เกิน max → warn, ข้อแนะนำ → info
  //   startOnly = ขนาดเริ่มต้น: ยาเดิมขนาดเดิมแค่ info, ยาใหม่/เพิ่มขนาด/เปลี่ยนความแรงจึงเตือน
  // okIf = วิธีใช้ที่ถูกแล้ว (เช่น สัปดาห์ละ 3 ครั้ง), anyForm = ตรวจยาฉีดด้วย (ปกติตรวจเฉพาะยากิน)
  // เรียงสูตรผสมก่อนตัวยาเดี่ยว — ยา 1 รายการใช้กฎแรกที่ชื่อตรง
  const RULES = [
    { name: 'TDF/3TC/DTG (TLD)', re: /\bTLD\b|TDF.*3TC|tenofovir.*lamivud/i, tiers: [
      { lt: 30, avoid: true, text: 'สูตรรวมเม็ดเดียว ปรับขนาด TDF/3TC ไม่ได้ — ควรเปลี่ยนเป็นยาแยกเม็ด/สูตรที่ไม่มี TDF' },
      { lt: 50, avoid: true, level: 'warn', text: 'สูตรรวมเม็ดเดียวไม่แนะนำเมื่อ CrCl < 50 — ควรเปลี่ยนเป็นยาแยกเม็ด/สูตรที่ไม่มี TDF' }] },
    { name: 'FTC/TAF', re: /kocitaf|\bTAF\b|alafenamide/i, tiers: [
      { lt: 30, avoid: true, level: 'warn', text: 'FTC/TAF ไม่แนะนำเมื่อ CrCl < 30 (ยกเว้นฟอกไต)' }] },
    { name: 'tenofovir (TDF)', re: /tenofo|\bTDF\b/i, tiers: [
      { lt: 10, avoid: true, text: 'ไม่แนะนำ (ฟอกไต: 300 mg สัปดาห์ละครั้งหลังฟอก)' },
      { lt: 30, max: 100, level: 'high', text: '300 mg ทุก 72–96 ชม. — ควรเปลี่ยนสูตร' },
      { lt: 50, max: 150, text: '300 mg ทุก 48 ชม. หรือพิจารณาเปลี่ยนสูตร' }] },
    { name: 'lamivudine', re: /lamivud|\b3TC\b/i, tiers: [
      { lt: 5, max: 25, text: 'ครั้งแรก 50 mg แล้ว 25 mg วันละครั้ง' },
      { lt: 15, max: 50, text: 'ครั้งแรก 150 mg แล้ว 50 mg วันละครั้ง' },
      { lt: 30, max: 100, text: 'ครั้งแรก 150 mg แล้ว 100 mg วันละครั้ง' },
      { lt: 50, max: 150, text: '150 mg วันละครั้ง' }] },
    { name: 'zidovudine', re: /zidovud|\bAZT\b/i, tiers: [{ lt: 15, max: 300, text: '100 mg วันละ 3 ครั้ง' }] },

    { name: 'metformin', re: /metform|glucophage/i, basis: 'egfr', tiers: [
      { lt: 30, avoid: true, text: 'ห้ามใช้เมื่อ eGFR < 30 (เสี่ยง lactic acidosis)' },
      { lt: 45, max: 1000, text: 'ไม่เกิน 1,000 mg/วัน และไม่เริ่มใหม่' }] },
    { name: 'glibenclamide', re: /glibencl|daonil/i, tiers: [
      { lt: 60, avoid: true, level: 'warn', text: 'เสี่ยงน้ำตาลต่ำนาน — พิจารณา glipizide แทน' }] },
    { name: 'sitagliptin', re: /sitaglip|januvia/i, tiers: [{ lt: 30, max: 25, text: '25 mg/วัน' }, { lt: 45, max: 50, text: '50 mg/วัน' }] },
    { name: 'vildagliptin', re: /vildaglip|galvus/i, tiers: [{ lt: 50, max: 50, text: '50 mg วันละครั้ง' }] },
    { name: 'SGLT2i', re: /gliflozin|forxiga|jardiance/i, basis: 'egfr', tiers: [
      { lt: 20, level: 'info', text: 'ไม่ควรเริ่มใหม่เมื่อ eGFR < 20 (ใช้ต่อได้เพื่อไต/หัวใจจนฟอกไต) ผลลดน้ำตาลน้อยลง' }] },
    { name: 'insulin', re: /insulin|mixtard|lantus|glargine|novomix|novorapid|humulin|gensulin|actrapid|insulatard|levemir|\bNPH\b|อินซูลิน/i, basis: 'egfr', anyForm: true, tiers: [
      { lt: 30, level: 'info', text: 'ความต้องการอินซูลินลดลง — ระวังน้ำตาลต่ำ อาจต้องลดขนาด' }] },

    { name: 'NSAID', re: /ibuprof|brufen|diclofen|voltaren|naproxen|mefenam|ponstan|etoricox|arcoxia|celecox|celebrex|piroxic|meloxic|indometh|ketorolac|parecox|dynastat/i, basis: 'egfr', anyForm: true, tiers: [
      { lt: 30, avoid: true, text: 'หลีกเลี่ยง NSAID — ไตเสื่อมเพิ่ม/K สูง' },
      { lt: 60, level: 'warn', text: 'ใช้ขนาดต่ำสุด ระยะสั้น ติดตาม Cr/K (ระวังร่วมกับ ACEI/ARB/ยาขับปัสสาวะ)' }] },

    { name: 'spironolactone', re: /spironol|aldactone/i, basis: 'egfr', tiers: [
      { lt: 30, avoid: true, text: 'ไม่แนะนำเมื่อ eGFR < 30 — เสี่ยง K สูง' },
      { lt: 50, max: 25, text: 'ไม่เกิน 25 mg/วัน (หรือวันเว้นวัน) ติดตาม K' }] },
    { name: 'amiloride', re: /amilorid/i, basis: 'egfr', tiers: [{ lt: 30, avoid: true, text: 'ไม่แนะนำเมื่อ eGFR < 30 — เสี่ยง K สูง' }] },
    { name: 'KCl', re: /potassium\s*chl|\bKCL\b|K\s*elixir|kalium/i, basis: 'egfr', tiers: [
      { lt: 30, level: 'warn', text: 'ไตขับ K ได้น้อย เสี่ยง K สูง — ติดตาม K ใกล้ชิด' }] },
    { name: 'HCTZ', re: /HCTZ|hydrochlorothiaz/i, tiers: [
      { lt: 10, avoid: true, level: 'warn', text: 'ไม่ได้ผลและไม่แนะนำเมื่อ CrCl < 10' },
      { lt: 30, level: 'info', text: 'thiazide ได้ผลน้อยเมื่อ CrCl < 30 (ยกเว้นใช้ร่วม loop diuretic)' }] },
    { name: 'atenolol', re: /atenolol|tenormin/i, tiers: [
      { lt: 15, max: 25, text: 'ไม่เกิน 25 mg/วัน (หรือ 50 mg วันเว้นวัน)' },
      { lt: 35, max: 50, text: 'ไม่เกิน 50 mg/วัน' }] },
    { name: 'enalapril', re: /enalap/i, tiers: [
      { lt: 30, max: 2.5, startOnly: true, text: 'เริ่ม 2.5 mg/วัน ปรับตาม BP — ติดตาม K/Cr' }] },
    { name: 'captopril', re: /captop/i, tiers: [
      { lt: 10, max: 75, text: 'ลดเหลือ 50% ของขนาดปกติ' },
      { lt: 50, max: 112.5, text: 'ลดเหลือ 75% ของขนาดปกติ' }] },
    { name: 'digoxin', re: /digoxin|lanoxin/i, tiers: [
      { lt: 10, max: 0.0625, level: 'high', text: '0.0625 mg/วัน หรือ 0.125 mg วันเว้นวัน — ติดตามระดับยา/อาการพิษ' },
      { lt: 50, max: 0.125, text: 'ไม่เกิน 0.125 mg/วัน — ติดตามระดับยา/อาการพิษ' }] },

    { name: 'allopurinol', re: /allopur|zyloric/i, tiers: [
      { lt: 30, max: 100, startOnly: true, text: 'ขนาดเริ่มต้น ≤ 100 mg/วัน (CrCl < 10: 100 mg วันเว้นวัน) ปรับเพิ่มช้าๆ ตาม uric' },
      { lt: 60, max: 200, startOnly: true, text: 'ขนาดเริ่มต้น ≤ 200 mg/วัน ปรับเพิ่มช้าๆ ตาม uric' }] },
    { name: 'colchicine', re: /colchic/i, tiers: [
      { lt: 30, max: 0.3, text: 'ป้องกัน 0.3 mg/วัน (ครึ่งเม็ด 0.6) · รักษาข้ออักเสบเฉียบพลันห้ามซ้ำภายใน 2 สัปดาห์' }] },
    { name: 'gemfibrozil', re: /gemfibro|lopid/i, tiers: [
      { lt: 30, avoid: true, text: 'ไม่ควรใช้เมื่อไตเสื่อมรุนแรง (เสี่ยง myopathy)' },
      { lt: 60, level: 'info', text: 'ใช้ได้ด้วยความระวัง ติดตาม Cr' }] },
    { name: 'fenofibrate', re: /fenofib/i, tiers: [{ lt: 30, avoid: true, level: 'warn', text: 'ไม่แนะนำเมื่อ CrCl < 30' }] },
    { name: 'simvastatin', re: /simvast|zocor/i, tiers: [
      { lt: 30, max: 10, level: 'info', startOnly: true, text: 'เริ่ม 5 mg/วัน ระวัง myopathy เมื่อ > 10 mg/วัน' }] },

    { name: 'gabapentin', re: /gabapent|neurontin/i, tiers: [
      { lt: 15, max: 300, text: '100–300 mg/วัน' }, { lt: 30, max: 700, text: '200–700 mg/วัน' }, { lt: 60, max: 1400, text: '400–1,400 mg/วัน' }] },
    { name: 'pregabalin', re: /pregabal|lyrica/i, tiers: [
      { lt: 15, max: 75, text: '25–75 mg/วัน' }, { lt: 30, max: 150, text: '25–150 mg/วัน' }, { lt: 60, max: 300, text: '75–300 mg/วัน' }] },
    { name: 'levetiracetam', re: /levetirac|keppra/i, tiers: [
      { lt: 30, max: 1000, text: '250–500 mg ทุก 12 ชม.' }, { lt: 50, max: 1500, text: '250–750 mg ทุก 12 ชม.' }, { lt: 80, max: 2000, text: '500–1,000 mg ทุก 12 ชม.' }] },
    { name: 'lithium', re: /lithium|\bLiCO3\b/i, tiers: [
      { lt: 30, avoid: true, text: 'หลีกเลี่ยงเมื่อ CrCl < 30 — พิษจากยาสะสม' },
      { lt: 60, level: 'warn', text: 'ลดขนาด 25–50% ติดตามระดับ lithium ใกล้ชิด' }] },
    { name: 'risperidone', re: /risperid/i, tiers: [
      { lt: 30, max: 1, startOnly: true, text: 'เริ่ม 0.5 mg วันละ 2 ครั้ง ปรับเพิ่มช้าๆ' }] },
    { name: 'tramadol', re: /tramad|tramal/i, tiers: [
      { lt: 30, max: 200, text: 'ทุก 12 ชม. ไม่เกิน 200 mg/วัน' }] },
    { name: 'morphine', re: /morphin|\bMST\b/i, tiers: [
      { lt: 30, level: 'warn', text: 'metabolite สะสม — ลดขนาด/ยืดระยะห่าง ระวังง่วงซึม/กดการหายใจ' }] },

    { name: 'famotidine', re: /famotid/i, tiers: [{ lt: 50, max: 20, text: 'ไม่เกิน 20 mg/วัน' }] },
    { name: 'ranitidine', re: /ranitid/i, tiers: [{ lt: 50, max: 150, text: '150 mg วันละครั้ง' }] },
    { name: 'metoclopramide', re: /metoclop|plasil/i, tiers: [{ lt: 60, max: 20, text: 'ลดขนาด 50% (ไม่เกิน 20 mg/วัน)' }] },
    { name: 'domperidone', re: /domperid|motilium/i, tiers: [{ lt: 30, max: 20, text: 'ลดความถี่เหลือวันละ 1–2 ครั้ง' }] },
    { name: 'magnesium hydroxide', re: /milk of mag|\bMOM\b|magnesium hydrox/i, tiers: [
      { lt: 30, avoid: true, level: 'warn', text: 'หลีกเลี่ยง — แมกนีเซียมสะสม (เลือกยาระบายชนิดอื่น)' }] },
    { name: 'aluminium antacid', re: /alum.*milk|alum.*mag|alumin.*hydrox/i, tiers: [
      { lt: 30, level: 'info', text: 'เลี่ยงใช้ต่อเนื่อง — อะลูมิเนียมสะสม' }] },
    { name: 'hydroxyzine', re: /hydroxyz|atarax/i, tiers: [{ lt: 50, max: 50, text: 'ลดขนาด 50%' }] },
    { name: 'cetirizine', re: /cetiriz|alerest|zyrtec/i, tiers: [
      { lt: 10, avoid: true, level: 'warn', text: 'ไม่แนะนำเมื่อ CrCl < 10' }, { lt: 30, max: 5, text: '5 mg วันละครั้ง' }] },
    { name: 'tranexamic acid', re: /tranexam|transamin/i, tiers: [{ lt: 50, level: 'warn', text: 'ลดขนาดตามไต (ยาขับทางไตเป็นหลัก)' }] },

    // เม็ด 1 g (875/125): ขนาด/วันคิดเป็น "1 g" ต่อเม็ด — ครึ่งเม็ดวันละ 2 ครั้ง = 1,000 ผ่านเกณฑ์ CrCl 10–29
    { name: 'amoxicillin/clavulanate 1 g', re: /augmentin\s*1\s*g|amoxi\s*875/i, tiers: [
      { lt: 10, max: 500, text: 'ห้ามใช้เต็มเม็ด — ครึ่งเม็ด (amoxicillin ~437 mg) วันละครั้ง' },
      { lt: 30, max: 1000, text: 'ห้ามใช้เต็มเม็ด 875/125 mg เมื่อ CrCl < 30 — ครึ่งเม็ด วันละ 2 ครั้ง (หรือ 500/125 mg ทุก 12 ชม.)' }] },
    { name: 'amoxicillin/clavulanate', re: /augmentin|amox.*clav/i, tiers: [
      { lt: 10, max: 500, text: '250–500 mg ทุก 24 ชม.' }, { lt: 30, max: 1000, text: '250–500 mg ทุก 12 ชม.' }] },
    { name: 'amoxicillin', re: /amoxi|amoxy/i, tiers: [
      { lt: 10, max: 500, text: '250–500 mg ทุก 24 ชม.' }, { lt: 30, max: 1000, text: '250–500 mg ทุก 12 ชม.' }] },
    { name: 'ciprofloxacin', re: /ciproflox/i, tiers: [
      { lt: 30, max: 500, text: '250–500 mg ทุก 18–24 ชม.' }, { lt: 50, max: 1000, text: '250–500 mg ทุก 12 ชม.' }] },
    { name: 'norfloxacin', re: /norflox|lexinor/i, tiers: [{ lt: 30, max: 400, text: '400 mg วันละครั้ง' }] },
    { name: 'levofloxacin', re: /levoflox/i, tiers: [
      { lt: 20, max: 125, text: '500 mg ครั้งแรก แล้ว 250 mg ทุก 48 ชม.' },
      { lt: 50, max: 250, text: '500 mg ครั้งแรก แล้ว 250 mg วันละครั้ง (หรือ 750 mg ทุก 48 ชม.)' }] },
    { name: 'cotrimoxazole', re: /cotrimox|bactrim|sulfameth/i, tiers: [
      { lt: 15, avoid: true, level: 'warn', text: 'ไม่แนะนำเมื่อ CrCl < 15 — เสี่ยง K สูง/พิษจากยา' },
      { lt: 30, max: 800, text: 'ลดขนาด 50% (คิดเป็น sulfamethoxazole ไม่เกิน 800 mg/วัน)' }] },
    { name: 'nitrofurantoin', re: /nitrofur/i, tiers: [{ lt: 30, avoid: true, level: 'warn', text: 'ไม่แนะนำเมื่อ CrCl < 30 — ไม่ได้ผลและเสี่ยงพิษ' }] },
    { name: 'acyclovir', re: /acyclo|aciclo/i, tiers: [
      { lt: 10, max: 1600, text: 'งูสวัด 800 mg ทุก 12 ชม. · เริม 200 mg ทุก 12 ชม.' },
      { lt: 25, max: 2400, text: 'งูสวัด 800 mg ทุก 8 ชม.' }] },
    { name: 'oseltamivir', re: /oseltam|tamiflu/i, tiers: [
      { lt: 10, avoid: true, level: 'warn', text: 'ไม่แนะนำถ้าไม่ได้ฟอกไต (ฟอกไต: 30 mg หลังฟอกแต่ละครั้ง)' },
      { lt: 30, max: 30, text: 'รักษา 30 mg วันละครั้ง × 5 วัน' },
      { lt: 60, max: 60, text: 'รักษา 30 mg วันละ 2 ครั้ง × 5 วัน' }] },
    { name: 'fluconazole', re: /fluconaz/i, tiers: [{ lt: 50, level: 'info', text: 'หลังขนาด loading ลดขนาดลง 50% (ใช้ครั้งเดียว เช่น 150 mg ไม่ต้องปรับ)' }] },
    { name: 'ethambutol', re: /ethambut/i, okIf: /สัปดาห์ละ\s*3|3\s*ครั้ง\s*(ต่อ|\/)\s*สัปดาห์|จ\.?\s*พ\.?\s*ศ/i, tiers: [
      { lt: 30, level: 'warn', text: '15–25 mg/kg สัปดาห์ละ 3 ครั้ง (ไม่ให้ทุกวัน)' }] },
    { name: 'pyrazinamide', re: /pyrazinam|\bPZA\b/i, okIf: /สัปดาห์ละ\s*3|3\s*ครั้ง\s*(ต่อ|\/)\s*สัปดาห์|จ\.?\s*พ\.?\s*ศ/i, tiers: [
      { lt: 30, level: 'warn', text: '25–35 mg/kg สัปดาห์ละ 3 ครั้ง (ไม่ให้ทุกวัน)' }] },
  ];
  const INJ = /\binj|injection|\bIV\b|\bIM\b|\bamp|ampule|ampoule|vial/i;

  const num = v => { const m = String(v == null ? '' : v).replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };
  const fmt = (n, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toLocaleString('th-TH');
  const daysAgo = iso => Math.round((Date.now() - new Date(iso + 'T00:00:00')) / 864e5);
  function lab(info, k) {
    const a = info && info.labs && info.labs[k];
    const v = a && a[0] ? num(a[0].value) : null;
    return v == null || v <= 0 ? null : { v, date: a[0].date };
  }
  const stageOf = e => e >= 90 ? 'G1' : e >= 60 ? 'G2' : e >= 45 ? 'G3a' : e >= 30 ? 'G3b' : e >= 15 ? 'G4' : 'G5';

  // ── การทำงานของไต ──
  function kidney(info) {
    const ageY = info && info.ageM != null && info.ageM !== '' ? +info.ageM / 12 : null;
    const female = String(info && info.sex) === '2';
    const out = { ageY, female, adult: ageY == null || ageY >= 18 };
    const crL = lab(info, 'cr');
    if (crL) {
      out.cr = crL.v > 20 ? crL.v / 88.4 : crL.v;   // ผลเป็น µmol/L → mg/dL
      out.crDate = crL.date;
      out.old = daysAgo(crL.date) > 180;
    }
    const egL = lab(info, 'egfr');
    if (egL && (!crL || egL.date >= crL.date)) Object.assign(out, { egfr: egL.v, egfrSrc: 'lab', egfrDate: egL.date });
    else if (out.cr && ageY != null) {
      // CKD-EPI 2021 (ไม่มีตัวแปรเชื้อชาติ)
      const k = female ? 0.7 : 0.9, a = female ? -0.241 : -0.302, r = out.cr / k;
      out.egfr = 142 * Math.min(r, 1) ** a * Math.max(r, 1) ** -1.2 * 0.9938 ** ageY * (female ? 1.012 : 1);
      out.egfrSrc = 'CKD-EPI'; out.egfrDate = out.crDate;
    } else if (!crL) {
      const v = (info && info.vitals || []).find(x => +x.egfr > 0);   // eGFR ที่พยาบาลคัดกรองบันทึก
      if (v) Object.assign(out, { egfr: +v.egfr, egfrSrc: 'คัดกรอง', egfrDate: v.date });
    }
    if (out.egfr != null) out.stage = stageOf(out.egfr);
    // Cockcroft-Gault
    const vit = (info && info.vitals) || [];
    const w = vit.find(x => +x.bw > 0), h = vit.find(x => +x.height > 100);
    if (out.cr && ageY != null && w) {
      const abw = +w.bw;
      let wt = abw, wtNote = 'น้ำหนักจริง';
      if (h) {
        const ibw = (female ? 45.5 : 50) + 0.9055 * (+h.height - 152.4);
        if (ibw > 0 && abw > ibw * 1.2) { wt = ibw + 0.4 * (abw - ibw); wtNote = 'AdjBW (อ้วน)'; }
        else if (ibw > 0 && abw >= ibw) { wt = ibw; wtNote = 'IBW'; }
      }
      out.wt = wt; out.wtNote = wtNote; out.bw = abw; out.bwDate = w.date;
      out.crcl = (140 - ageY) * wt / (72 * out.cr) * (female ? 0.85 : 1);
    }
    return out;
  }

  // ── ตรวจยา ──
  // drugs: ยาวันนี้ ({ name, strength, units, form, usage, icode, _tags }), changes: จาก smart-rx compare,
  // perDay(d) → { mg, units, prn }
  function assess({ drugs, info, changes, perDay }) {
    const fn = kidney(info || {});
    const rows = [];
    const changed = new Set((changes || []).filter(c => /^(new|switch|strength|up)$/.test(c.type)).map(c => c.drug.icode));
    const label = d => String(d.name || '').replace(/^\s*ยาเดิม\s*\((.*)\)\s*$/, 'ยาเดิม $1').replace(/\s+/g, ' ').trim();
    const matched = [];
    (drugs || []).forEach(d => {
      // ยาเดิม (ผู้ป่วยนำมาเอง): ชื่อจริงอาจอยู่ในวิธีใช้
      const nm = String(d.name || '') + (/^\s*ยาเดิม/.test(d.name || '') ? ' ' + String(d.usage || '').replace(/[^A-Za-z0-9 ]/g, ' ') : '');
      const rule = RULES.find(r => r.re.test(nm));
      if (!rule) return;
      if (!rule.anyForm && INJ.test([d.name, d.form, d.units, d.strength].join(' '))) return;
      matched.push({ d, rule });
    });
    if (!fn.adult) return { fn, rows, skipped: 'อายุ < 18 ปี — ไม่ได้ตรวจขนาดยาตามไต (เกณฑ์เป็นของผู้ใหญ่)' };
    if (fn.egfr == null && fn.crcl == null) {
      return { fn, rows, missing: matched.length ? [...new Set(matched.map(m => label(m.d)))] : [] };
    }
    matched.forEach(({ d, rule }) => {
      const useCrcl = rule.basis !== 'egfr' && fn.crcl != null;
      const v = useCrcl ? fn.crcl : fn.egfr != null ? fn.egfr : fn.crcl;
      const basis = useCrcl || fn.egfr == null ? 'CrCl' : 'eGFR';
      const tier = rule.tiers.find(t => v < t.lt);
      const p = perDay ? perDay(d) || {} : {};
      const row = { drug: label(d), icode: d.icode, rule: rule.name, basis, value: v, mg: p.mg, usage: d.usage || '' };
      if (!tier) { rows.push(Object.assign(row, { level: 'ok', text: `ไม่ต้องปรับขนาดที่ ${basis} ${fmt(v, 0)}` })); return; }
      row.limit = `${basis} < ${tier.lt}`;
      row.rec = tier.text;
      if (rule.okIf && rule.okIf.test(d.usage || '')) { rows.push(Object.assign(row, { level: 'ok', text: `วิธีใช้เหมาะสมแล้ว (${tier.text})` })); return; }
      if (tier.avoid) { rows.push(Object.assign(row, { level: tier.level || 'high', text: tier.text })); return; }
      if (tier.max == null) { rows.push(Object.assign(row, { level: tier.level || 'info', text: tier.text })); return; }
      const fresh = changed.has(d.icode);
      if (p.mg == null) {
        rows.push(Object.assign(row, { level: 'info', text: `อ่านขนาด/วันจากวิธีใช้ไม่ได้ — ตรวจเอง: ควรไม่เกิน ${fmt(tier.max, 2)} mg/วัน (${tier.text})` }));
      } else if (p.mg > tier.max + 1e-6) {
        const lv = tier.startOnly && !fresh ? 'info' : tier.level || 'warn';
        rows.push(Object.assign(row, { level: lv, over: true,
          text: `${fmt(p.mg, 2)} mg/วัน เกินขนาดแนะนำ ≤ ${fmt(tier.max, 2)} mg/วัน — ${tier.text}${tier.startOnly && !fresh ? ' (ใช้ขนาดนี้ต่อเนื่องอยู่แล้ว)' : ''}` }));
      } else {
        rows.push(Object.assign(row, { level: 'ok', text: `${fmt(p.mg, 2)} mg/วัน ไม่เกิน ${fmt(tier.max, 2)} mg/วัน ✓` }));
      }
    });
    const order = { high: 0, warn: 1, info: 2, ok: 3 };
    rows.sort((a, b) => order[a.level] - order[b.level]);
    return { fn, rows };
  }

  // ข้อความสรุปการทำงานของไต 1 บรรทัด (ใช้ส่ง AI)
  function summary(fn) {
    if (!fn) return '';
    const s = [];
    if (fn.cr != null) s.push(`Cr ${fmt(fn.cr, 2)} mg/dL (${fn.crDate})`);
    if (fn.egfr != null) s.push(`eGFR ${fmt(fn.egfr, 0)} (${fn.egfrSrc}, ${fn.stage})`);
    if (fn.crcl != null) s.push(`CrCl ${fmt(fn.crcl, 0)} mL/min (Cockcroft-Gault, ${fn.wtNote} ${fmt(fn.wt, 1)} กก.)`);
    return s.join(' · ');
  }

  window.tphRenalDose = { kidney, assess, summary, RULES };
})();
