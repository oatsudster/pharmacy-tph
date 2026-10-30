/**
 * usage-picto.js — แปลงวิธีใช้ยา (ข้อความ 3 บรรทัดจาก HOSxP) เป็นข้อมูลสำหรับ "ฉลากยารูปภาพ"
 * สำหรับผู้ป่วยที่อ่านหนังสือไม่ออก หรือสายตาไม่ดี (พิมพ์เป็นดวงเสริมต่อจากฉลากปกติ — ไม่ใช่แทน)
 *
 *   TphPicto.parse('รับประทานครั้งละ 1 เม็ด', 'วันละ 2 ครั้ง หลังอาหาร เช้า-เย็น', '')
 *   → { route:'oral', amount:{n:1,text:'1',unit:'เม็ด',form:'tablet'}, slots:{morning:1,noon:0,evening:1,bed:0},
 *       meal:'after', prn:null, everyH:null, warnings:[], assumed:false }
 *
 * แปลแบบระวัง: วิธีใช้ที่ทำเป็นภาพแล้วอาจเข้าใจผิด (วันเว้นวัน, รายสัปดาห์, ระบุวัน, ปรับขนาด, หยุดยา, ตามแพทย์สั่ง,
 * มื้อไม่ตรงกับจำนวนครั้ง) คืน { error: 'เหตุผล' } — หน้าเว็บไม่พิมพ์ฉลากภาพของยานั้นและบอกผู้ใช้
 * "วันละ N ครั้ง" ที่ไม่บอกมื้อ → เดาเป็นมื้อมาตรฐาน (assumed:true) ให้หน้าเว็บเตือนให้ตรวจก่อนพิมพ์
 *
 * รูปภาพ: img/picto/<ชื่อ>.png (สร้างจาก prompt ใน img/picto/README.md) — ไม่มีไฟล์ใช้ไอคอน SVG พื้นฐานใน ICON แทน
 */
(function (root) {
  const clean = s => String(s || '').replace(/[\u0000-\u001F ]/g, ' ').replace(/\s+/g, ' ').trim();
  const UNITS = [
    ['แคปซูล', 'capsule'], ['แคป', 'capsule'], ['เม็ด', 'tablet'], ['ช้อนชา', 'tsp'], ['ช้อนโต๊ะ', 'tbsp'],
    ['ซี.ซี.', 'ml'], ['ซีซี', 'ml'], ['มล.', 'ml'], ['มล', 'ml'], ['ml', 'ml'], ['cc', 'ml'],
    ['หยด', 'drop'], ['ที', 'puff'], ['สูด', 'puff'], ['กด', 'puff'], ['ซอง', 'sachet'], ['หลอด', 'tube'],
  ];
  const UNIT_RE = UNITS.map(u => u[0].replace(/\./g, '\\.')).join('|');
  const NUM = '(ครึ่ง|\\d+(?:\\.\\d+)?\\s*\\/\\s*\\d+|\\d+(?:\\.\\d+)?(?:\\s*-\\s*\\d+(?:\\.\\d+)?)?)';
  const SLOT_WORDS = [['morning', /เช้า/], ['noon', /กลางวัน|เที่ยง/], ['evening', /เย็น/], ['bed', /ก่อนนอน/]];
  const DEFAULT_SLOTS = { 1: ['morning'], 2: ['morning', 'evening'], 3: ['morning', 'noon', 'evening'], 4: ['morning', 'noon', 'evening', 'bed'] };
  const UNSUPPORTED = [
    [/วันเว้นวัน|เว้นวัน/, 'วันเว้นวัน'], [/สัปดาห์|อาทิตย์ละ|เดือนละ/, 'ใช้เป็นรายสัปดาห์/รายเดือน'],
    [/จันทร์|อังคาร|พุธ|พฤหัส|ศุกร์|เสาร์/, 'ระบุวันในสัปดาห์'], [/หยุด|(^|\s)off\b/i, 'มีคำสั่งหยุดยา'],
    [/ลดลง|เพิ่มขึ้น|ทีละ|ปรับ/, 'มีการปรับขนาดยา'], [/ตามแพทย์สั่ง|ตามสั่ง|ตามที่แพทย์/, 'ตามแพทย์สั่ง'],
    [/ยูนิต|unit|หน่วย/i, 'ยาฉีด/อินซูลิน (ใช้ฉลากปกติ)'],
  ];
  const ROUTES = [
    ['eye', /หยอดตา|ป้ายตา/], ['ear', /หยอดหู/], ['nose', /หยอดจมูก|พ่นจมูก/], ['inhaler', /พ่น|สูด/],
    ['sublingual', /อมใต้ลิ้น/], ['suppository', /เหน็บ|สอดช่องคลอด/], ['injection', /ฉีด/],
    ['skin', /(^|\s)ทา(?!น)|ทาบาง|ทาบริเวณ|ทาที่/], ['oral', /รับประทาน|กิน|ทาน|อม|ละลายน้ำ|ดื่ม/],
  ];
  const SYMPTOMS = [['pain', /ปวด/], ['fever', /ไข้/], ['cough', /ไอ/], ['nausea', /คลื่นไส้|อาเจียน/],
    ['chest', /เจ็บหน้าอก|แน่นหน้าอก/], ['constipation', /ท้องผูก|ไม่ถ่าย/], ['diarrhea', /ถ่ายเหลว|ท้องเสีย/],
    ['itch', /คัน|ผื่น/], ['sleep', /นอนไม่หลับ/], ['dyspnea', /หอบ|เหนื่อย/]];
  const WARNINGS = [['sleepy', /ง่วง/], ['shake', /เขย่า/], ['fridge', /ตู้เย็น/], ['no-crush', /ห้ามบด|ห้ามเคี้ยว|กลืนทั้งเม็ด|ห้ามหัก/],
    ['finish', /จนหมด|ติดต่อกันจนครบ/]];

  const toN = s => {
    if (!s) return null;
    s = String(s).replace(/\s/g, '');
    if (s === 'ครึ่ง') return 0.5;
    if (/^\d+(\.\d+)?\/\d+$/.test(s)) { const [a, b] = s.split('/').map(Number); return b ? a / b : null; }
    if (/^\d+(\.\d+)?$/.test(s)) return +s;
    return null;   // ช่วง 1-2: แสดงเป็นข้อความ ไม่วาดจำนวนเม็ด
  };
  const formOf = u => (UNITS.find(x => x[0] === u) || [])[1] || 'other';
  const fmt = n => String(Math.round(n * 100) / 100);

  function parse(l1, l2, l3, extra) {
    const t = clean([l1, l2, l3].join(' ')).replace(/\s*-\s*(?=(เช้า|กลางวัน|เที่ยง|เย็น|ก่อนนอน))/g, ' ');
    if (!t || /^[.\s]+$/.test(t)) return { error: 'ไม่มีวิธีใช้' };
    for (const [re, why] of UNSUPPORTED) if (re.test(t)) return { error: why };
    const route = (ROUTES.find(r => r[1].test(t)) || [])[0];
    if (!route) return { error: 'ไม่รู้วิธีใช้ (กิน/ทา/หยอด/พ่น)' };

    // ขนาดยาแยกมื้อ: "เช้า 2 เม็ด เย็น 1 เม็ด"
    const per = {};
    const perRe = new RegExp('(เช้า|กลางวัน|เที่ยง|เย็น|ก่อนนอน)\\s*' + NUM + '\\s*(ครึ่ง)?\\s*(' + UNIT_RE + ')(\\s*ครึ่ง)?', 'g');
    let m, perUnit = null;
    while ((m = perRe.exec(t))) {
      const slot = SLOT_WORDS.find(([, re]) => re.test(m[1]))[0];
      const v = toN(m[2]);
      per[slot] = v != null && (m[3] || m[5]) ? v + 0.5 : v;   // "1 เม็ดครึ่ง"
      perUnit = m[4];
    }

    const am = t.match(new RegExp('(?:ครั้งละ\\s*)?' + NUM + '\\s*(ครึ่ง)?\\s*(' + UNIT_RE + ')(\\s*ครึ่ง)?'));
    let amount = null;
    if (Object.keys(per).length) {
      if (Object.values(per).some(v => v == null)) return { error: 'ขนาดยาแต่ละมื้อไม่ชัด' };
      amount = { n: null, text: '', unit: perUnit, form: formOf(perUnit) };
    } else if (am) {
      let n = toN(am[1]);
      if (n != null && (am[2] || am[4])) n += 0.5;    // "1 เม็ดครึ่ง"
      amount = { n, text: n != null ? fmt(n) : am[1].replace(/\s/g, ''), unit: am[3], form: formOf(am[3]) };
    } else if (route === 'oral') return { error: 'ไม่พบขนาดยา (ครั้งละกี่เม็ด/ช้อน)' };

    const prnM = /เมื่อ|เวลามี|เวลา(?:ปวด|ไอ)|ถ้า|ตามอาการ|\bprn\b/i.test(t);
    const ev = t.match(/ทุก\s*(\d+(?:\s*-\s*\d+)?)\s*(?:ชั่วโมง|ชม)/);
    const everyH = ev ? ev[1].replace(/\s/g, '') : null;
    const freqM = t.match(/วันละ\s*(\d)\s*(?:ครั้ง|เวลา|มื้อ)?/);
    const freq = freqM ? +freqM[1] : null;

    let slots = null, assumed = false;
    const named = SLOT_WORDS.filter(([, re]) => re.test(t)).map(([k]) => k);
    if (Object.keys(per).length) {
      slots = { morning: 0, noon: 0, evening: 0, bed: 0 };
      Object.entries(per).forEach(([k, v]) => { slots[k] = v; });
    } else if (named.length) {
      if (freq && freq !== named.length) return { error: `วันละ ${freq} ครั้ง แต่ระบุ ${named.length} มื้อ` };
      slots = { morning: 0, noon: 0, evening: 0, bed: 0 };
      named.forEach(k => { slots[k] = amount && amount.n != null ? amount.n : 1; });
    } else if (freq && !prnM && !everyH) {
      if (!DEFAULT_SLOTS[freq]) return { error: `วันละ ${freq} ครั้ง` };
      slots = { morning: 0, noon: 0, evening: 0, bed: 0 };
      DEFAULT_SLOTS[freq].forEach(k => { slots[k] = amount && amount.n != null ? amount.n : 1; });
      assumed = true;
    }
    if (!slots && !prnM && !everyH && route === 'oral') return { error: 'ไม่ระบุเวลา/จำนวนครั้ง' };

    let meal = null;
    if (/พร้อมอาหาร|หลังอาหารทันที/.test(t)) meal = 'with';
    else if (/ก่อนอาหาร/.test(t)) meal = 'before';
    else if (/หลังอาหาร/.test(t)) meal = 'after';
    // มื้ออาหาร (เช้า/กลางวัน/เย็น) ไม่บอกก่อน/หลังอาหาร = หลังอาหาร (กติกาเดียวกับสติกเกอร์ยาเดิม)
    else if (route === 'oral' && slots && (slots.morning || slots.noon || slots.evening)) meal = 'after';

    const prn = prnM ? { symptom: (SYMPTOMS.find(([, re]) => re.test(t)) || [null])[0], everyH } : null;
    const hay = t + ' ' + clean(extra && extra.hint);
    const warnings = WARNINGS.filter(([, re]) => re.test(hay)).map(([k]) => k);
    // ยาปฏิชีวนะชนิดกิน = กินจนหมด (หยอดตา/ทา ไม่ใช่ — ใช้ตามข้อความบนฉลากเท่านั้น)
    if (extra && extra.antibiotic === 'Y' && route === 'oral' && !warnings.includes('finish')) warnings.push('finish');
    return { route, amount, slots, meal, prn, everyH: prn ? null : everyH, warnings, assumed };
  }

  // ── ไอคอนพื้นฐาน (ใช้เมื่อยังไม่มีไฟล์ใน img/picto/) — เส้นดำหนาบนพื้นขาว พิมพ์เครื่องความร้อนได้ชัด ──
  const S = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="#000" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  const rays = (cx, cy, r1, r2, from, to, step) => { let s = ''; for (let a = from; a <= to; a += step) { const q = a * Math.PI / 180; s += `<line x1="${cx + r1 * Math.cos(q)}" y1="${cy - r1 * Math.sin(q)}" x2="${cx + r2 * Math.cos(q)}" y2="${cy - r2 * Math.sin(q)}"/>`; } return s; };
  const ICON = {
    morning: S(`<line x1="8" y1="72" x2="92" y2="72"/><path d="M28 72a22 22 0 0 1 44 0"/>${rays(50, 72, 31, 42, 20, 160, 35)}`),
    noon: S(`<circle cx="50" cy="50" r="17" fill="#000"/>${rays(50, 50, 27, 40, 0, 330, 30)}`),
    evening: S(`<line x1="8" y1="62" x2="92" y2="62"/><path d="M30 62a20 20 0 0 1 40 0" fill="#000"/><line x1="22" y1="76" x2="78" y2="76"/><line x1="34" y1="88" x2="66" y2="88"/>`),
    bed: S(`<path d="M62 18a30 30 0 1 0 22 46a26 26 0 1 1 -22 -46z" fill="#000"/><path d="M24 22l3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" stroke-width="3" fill="#000"/>`),
    before: S(`<ellipse cx="50" cy="60" rx="38" ry="14"/><ellipse cx="50" cy="58" rx="22" ry="7"/><circle cx="50" cy="24" r="13"/><line x1="50" y1="24" x2="50" y2="16"/><line x1="50" y1="24" x2="56" y2="27"/>`),
    after: S(`<ellipse cx="50" cy="66" rx="38" ry="14"/><path d="M26 62q24-30 48 0" fill="#000"/><line x1="70" y1="20" x2="70" y2="48"/><line x1="82" y1="20" x2="82" y2="48"/>`),
    with: S(`<ellipse cx="44" cy="64" rx="34" ry="13"/><path d="M22 60q22-26 44 0" fill="#000"/><circle cx="82" cy="34" r="9" fill="#000"/>`),
    tablet: S(`<circle cx="50" cy="50" r="34" fill="#fff"/><line x1="24" y1="50" x2="76" y2="50"/>`),
    half: S(`<path d="M16 50a34 34 0 0 1 68 0z" fill="#fff"/>`),
    capsule: S(`<rect x="14" y="32" width="72" height="36" rx="18" fill="#fff"/><path d="M50 32v36" /><path d="M50 32h18a18 18 0 0 1 0 36h-18z" fill="#000"/>`),
    tsp: S(`<ellipse cx="30" cy="50" rx="20" ry="13"/><line x1="50" y1="50" x2="92" y2="50"/>`),
    tbsp: S(`<ellipse cx="32" cy="50" rx="26" ry="17"/><line x1="58" y1="50" x2="94" y2="50"/>`),
    drop: S(`<path d="M50 12C36 36 26 50 26 64a24 24 0 0 0 48 0c0-14-10-28-24-52z" fill="#000"/>`),
    clock: S(`<circle cx="50" cy="50" r="38"/><line x1="50" y1="50" x2="50" y2="26"/><line x1="50" y1="50" x2="68" y2="58"/>`),
  };
  // รายการไฟล์ภาพที่หน้าเว็บมองหา (img/picto/<name>.png) — ตรงกับ prompt ใน img/picto/README.md
  const FILES = ['morning', 'noon', 'evening', 'bed', 'before', 'after', 'with', 'tablet', 'half', 'capsule', 'tsp', 'tbsp', 'drop', 'clock',
    'eye', 'ear', 'nose', 'inhaler', 'sublingual', 'suppository', 'skin', 'sachet',
    'prn-pain', 'prn-fever', 'prn-cough', 'prn-nausea', 'prn-chest', 'prn-constipation', 'prn-diarrhea', 'prn-itch', 'prn-sleep', 'prn-dyspnea', 'prn',
    'sleepy', 'shake', 'fridge', 'no-crush', 'finish'];
  const TH = {
    morning: 'เช้า', noon: 'กลางวัน', evening: 'เย็น', bed: 'ก่อนนอน', before: 'ก่อนอาหาร', after: 'หลังอาหาร', with: 'พร้อมอาหาร',
    eye: 'หยอดตา', ear: 'หยอดหู', nose: 'จมูก', inhaler: 'สูด/พ่น', sublingual: 'อมใต้ลิ้น', suppository: 'เหน็บ', skin: 'ทาผิว', injection: 'ฉีด',
    pain: 'ปวด', fever: 'มีไข้', cough: 'ไอ', nausea: 'คลื่นไส้', chest: 'เจ็บหน้าอก', constipation: 'ท้องผูก', diarrhea: 'ถ่ายเหลว', itch: 'คัน',
    sleep: 'นอนไม่หลับ', dyspnea: 'หอบ', sleepy: 'ง่วง', shake: 'เขย่าขวด', fridge: 'เก็บตู้เย็น', 'no-crush': 'ห้ามบด/เคี้ยว', finish: 'ใช้จนหมด',
  };

  const api = { parse, ICON, FILES, TH };
  root.TphPicto = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
