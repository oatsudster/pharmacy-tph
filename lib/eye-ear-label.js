/**
 * ฉลากเสริมวิธีใช้ยาหยอดตา / ป้ายตา / หยอดหู (ผู้ใช้ขอ 2026-11-17)
 * ดวงเดียว 101.6 × 59.9 มม. ม้วนเดียวกับฉลากยา — พื้นที่พิมพ์ซ้าย 10.58 มม. กว้าง 78.3 มม.
 * รูปลายเส้นขาวดำวาดเอง (SVG) เพราะเครื่องพิมพ์ความร้อนพิมพ์สี/เทาไม่ได้
 * เปิดใช้แล้วใช้ได้ 1 เดือนทุกตัว (ผู้ใช้เลือก) · ต้องใช้ escHtml จาก lib/esc-html.js
 */
(function () {
  const SK = 'fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round"';
  // ตาส่วนที่ใช้ร่วม: คิ้ว ขนตา เปลือกตาบน ลูกตา + เปลือกตาล่างที่ถูกดึงลงเป็นกระพุ้ง + นิ้วดึง
  const EYE = `
    <path d="M14 26 Q42 12 70 22" ${SK} stroke-width="4"/>
    <path d="M10 58 Q46 28 88 56" ${SK} stroke-width="2.6"/>
    <path d="M22 47 l-4 -6 M32 40 l-3 -7 M43 37 l-1 -7 M54 37 l1 -7 M65 39 l3 -6 M75 44 l4 -5" ${SK} stroke-width="1.8"/>
    <clipPath id="CLIP"><path d="M10 58 Q46 28 88 56 Q48 76 10 58Z"/></clipPath>
    <g clip-path="url(#CLIP)"><circle cx="49" cy="52" r="12" ${SK} stroke-width="2.2"/><circle cx="49" cy="52" r="5.5" fill="#000"/><circle cx="52" cy="49" r="1.8" fill="#fff"/></g>
    <path d="M10 58 Q48 76 88 56" ${SK} stroke-width="1.6"/>
    <path d="M14 61 Q48 92 84 60" ${SK} stroke-width="2.6"/>
    <path d="M24 70 l-2 4 M36 76 l-1 4 M48 78 v4 M60 76 l1 4 M72 70 l2 4" ${SK} stroke-width="1.4"/>
    <path d="M36 118 V100 Q36 88 48 88 Q60 88 60 100 V118" ${SK} stroke-width="2.4"/>
    <path d="M41 97 Q48 91 55 97" ${SK} stroke-width="1.6"/>
    <path d="M48 84 v-4 M44 85 l-1 -3 M52 85 l1 -3" ${SK} stroke-width="1.4"/>`;
  const SVG = {
    // หยอดตา: ขวดหยอดชี้ลง หยดยาตกลงกระพุ้งตาล่าง
    eye: `<svg viewBox="0 0 100 118" xmlns="http://www.w3.org/2000/svg">${EYE.replace(/CLIP/g, 'ce1')}
      <g transform="translate(78 30) rotate(25)">
        <path d="M-2 0 L-4 -9 H4 L2 0Z" fill="#000"/>
        <rect x="-8" y="-24" width="16" height="15" rx="3" fill="#fff" stroke="#000" stroke-width="2.4"/>
        <rect x="-6" y="-30" width="12" height="6" rx="1.5" fill="#000"/>
      </g>
      <path d="M74 36 l-6 14" stroke="#000" stroke-width="1.4" stroke-dasharray="2 2.5" fill="none"/>
      <path d="M66 58 q-4 6 0 8 q4 -2 0 -8Z" fill="#000"/></svg>`,
    // ป้ายตา: หลอดยาจากมุมขวาบน บีบยาเป็นเส้นลงกระพุ้งตาล่าง
    eyeoint: `<svg viewBox="0 0 100 118" xmlns="http://www.w3.org/2000/svg">${EYE.replace(/CLIP/g, 'ce2')}
      <path d="M26 66 Q48 82 72 67" fill="none" stroke="#000" stroke-width="7.5" stroke-linecap="round"/>
      <path d="M26 66 Q48 82 72 67" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round"/>
      <path d="M32 69 Q48 78 66 70" fill="none" stroke="#000" stroke-width="1" stroke-dasharray="1.5 2.5"/>
      <g transform="translate(71 68) scale(.78) rotate(-58)">
        <rect x="0" y="-2.5" width="9" height="5" fill="#fff" stroke="#000" stroke-width="1.8"/>
        <path d="M9 -4 L14 -9 H48 V9 H14 L9 4Z" fill="#fff" stroke="#000" stroke-width="2.4" stroke-linejoin="round"/>
        <path d="M48 -10 V10" stroke="#000" stroke-width="3"/>
        <path d="M20 -3 H40 M20 2 H34" stroke="#000" stroke-width="1.4"/>
      </g></svg>`,
    // หยอดหู: ใบหูด้านข้าง ลูกศรดึงใบหูขึ้น-ไปด้านหลัง ขวดหยอดชี้ลงรูหู
    ear: `<svg viewBox="0 0 100 118" xmlns="http://www.w3.org/2000/svg">
      <path d="M38 40 C36 14 74 8 80 34 C84 52 70 60 66 74 C62 92 50 100 42 92 C37 87 40 80 44 78" ${SK} stroke-width="2.8"/>
      <path d="M48 40 C48 26 68 24 70 38 C71 48 62 52 60 60" ${SK} stroke-width="2"/>
      <path d="M56 70 C52 74 50 80 54 84" ${SK} stroke-width="2"/>
      <ellipse cx="50" cy="60" rx="5" ry="6.5" fill="#000"/>
      <path d="M78 22 Q86 12 92 4" ${SK} stroke-width="3"/>
      <path d="M84 4 L93 2 L92 11" ${SK} stroke-width="3"/>
      <g transform="translate(36 44) rotate(-35)">
        <path d="M-2 0 L-4 -9 H4 L2 0Z" fill="#000"/>
        <rect x="-8" y="-24" width="16" height="15" rx="3" fill="#fff" stroke="#000" stroke-width="2.4"/>
        <rect x="-6" y="-30" width="12" height="6" rx="1.5" fill="#000"/>
      </g>
      <path d="M41 52 q-3 5 0 6.5 q3 -1.5 0 -6.5Z" fill="#000"/></svg>`,
  };
  const TEXT = {
    eye: { title: 'วิธีหยอดตาที่ถูกต้อง', organ: 'ตา', steps: [
      'ล้างมือ · ถ้ายาขุ่นให้เขย่าขวดก่อน',
      'แหงนหน้า ดึงเปลือกตาล่างเป็นกระพุ้ง',
      'หยอดยาลงกระพุ้ง ปลายขวดห้ามแตะตา',
      'หลับตา กดหัวตาเบาๆ 1–2 นาที',
      'ยาตาหลายขวด หยอดห่างกัน 5 นาที'] },
    eyeoint: { title: 'วิธีป้ายตาที่ถูกต้อง', organ: 'ตา', steps: [
      'ล้างมือ ดึงเปลือกตาล่างเป็นกระพุ้ง',
      'บีบยาเป็นเส้นยาว ~1 ซม. ลงกระพุ้ง',
      'ปลายหลอดห้ามแตะตา',
      'หลับตา กลอกตาไปมาให้ยากระจาย',
      'ตามัวชั่วคราว ป้ายก่อนนอนดีที่สุด',
      'ใช้คู่ยาหยอด: หยอดก่อน ป้ายหลัง'] },
    ear: { title: 'วิธีหยอดหูที่ถูกต้อง', organ: 'หู', steps: [
      'ล้างมือ กำขวดยาในมือ 2–3 นาทีให้อุ่น',
      'นอนตะแคง หูข้างที่หยอดอยู่ด้านบน',
      'ดึงใบหูขึ้นไปด้านหลัง (เด็กเล็ก: ดึงลงไปด้านหลัง)',
      'หยอดยา ปลายขวดห้ามแตะหู',
      'กดติ่งหน้าหูเบาๆ แล้วนอนต่อ 3–5 นาที'],
      warn: 'ปวดมากขึ้น มีหนอง/เลือดไหล ให้หยุดยาแล้วมาพบแพทย์' },
  };
  const KINDS = Object.keys(TEXT);

  // ชนิดยา: ดูวิธีใช้ก่อน (เภสัช/แพทย์เขียนชัดกว่า) แล้วค่อยดูชื่อยา
  function detect(it) {
    const use = [it.line1, it.line2, it.line3].join(' ');
    const name = [it.name, it.strength, it.units, it.namePrint].filter(Boolean).join(' ');
    if (/ป้ายตา/.test(use)) return 'eyeoint';
    if (/หยอดตา/.test(use)) return 'eye';
    if (/หยอดหู/.test(use)) return 'ear';
    if (/หยอด|ป้าย|ทา|รับประทาน|พ่น|ฉีด/.test(use)) {}   // วิธีใช้บอก route อื่นชัดเจน → ไม่เดาจากชื่อ
    else {
      if (/\b(ear|otic)\b/i.test(name)) return 'ear';
      if (/\b(eye|ophth\w*|opht)\b/i.test(name)) return /oint|ointment|gel\b|ขี้ผึ้ง/i.test(name) ? 'eyeoint' : 'eye';
    }
    return null;
  }
  // ข้างที่ใช้จากวิธีใช้ภาษาไทย (ไม่อ่าน OD/OS เพราะ OD ซ้ำกับ "วันละครั้ง")
  function side(text) {
    const t = String(text || '');
    if (/ทั้ง\s*(2|สอง)\s*ข้าง|ทั้งสองข้าง|2\s*ข้าง/.test(t)) return 'B';
    const r = /ขวา/.test(t), l = /ซ้าย/.test(t);
    return r && l ? 'B' : r ? 'R' : l ? 'L' : '';
  }
  const fridge = it => /ตู้เย็น|2\s*[-–]\s*8\s*°?\s*c?/i.test([it.hint, it.advice, it.line1, it.line2, it.line3].filter(Boolean).join(' '));

  // o: { name, hn, drug, side: 'R'|'L'|'B'|'', fridge: bool } — ไม่ส่ง name/hn = ฉลากเปล่าให้เขียนเอง
  function html(kind, o) {
    o = o || {};
    const T = TEXT[kind]; if (!T) return '';
    const e = window.escHtml;
    const bx = on => `<span class="bx${on ? ' on' : ''}"></span>`;
    const sides = `<span class="sd">${bx(o.side === 'R')}ขวา ${bx(o.side === 'L')}ซ้าย ${bx(o.side === 'B')}2 ข้าง</span>`;
    const who = o.hn ? `<b>${e(o.name || '')}</b> HN ${e(o.hn)}${o.drug ? ' · ' + e(o.drug) : ''}`
      : `ชื่อ<span class="ln"></span>HN<span class="ln s"></span>`;
    return `<div class="eestk ee-${kind}"><div class="in">
      <div class="hd"><b>${T.title}</b>${sides}</div>
      <div class="who fit" style="font-size:8pt">${who}</div>
      <div class="bd"><div class="pic">${SVG[kind]}</div>
        <ol>${T.steps.map(s => `<li>${e(s)}</li>`).join('')}</ol></div>
      ${T.warn ? `<div class="wn">⚠ ${e(T.warn)}</div>` : ''}
      <div class="ft"><span>เปิดใช้แล้ว ใช้ได้ <b>1 เดือน</b> · วันที่เปิด<span class="ln m"></span></span></div>
      <div class="ft">${bx(o.fridge)}เก็บในตู้เย็น 2–8 °C ห้ามแช่แข็ง<span class="sp"></span>ห้ามใช้ร่วมกับผู้อื่น</div>
    </div></div>`;
  }
  const LABEL = { eye: '👁 หยอดตา', eyeoint: '👁 ป้ายตา', ear: '👂 หยอดหู' };
  window.TphEyeEar = { KINDS, TEXT, SVG, LABEL, detect, side, fridge, html };
})();
