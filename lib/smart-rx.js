// Smart Pharmacy — ตรวจใบสั่งยา visit วันนี้ของผู้ป่วย 1 คน สำหรับหน้าต่างลอยจ่ายยาของเภสัชกร (clinic.html)
//   1) ยาที่เปลี่ยนจาก visit ก่อน: ยาใหม่ / หยุดยา / เปลี่ยนความแรง / เพิ่ม-ลดขนาด / เปลี่ยนวิธีใช้
//   2) ความเหมาะสมเทียบกับ lab + สัญญาณชีพ (K, eGFR/Cr, HbA1c/FBS, LDL/TG, ALT, Hb/Plt, uric, TSH, BP, ชีพจร, ตั้งครรภ์)
//      + ผลจาก lib/rx-check.js (ขนาดยา ยาซ้ำ ยาตีกัน แพ้ยา Beers) ถ้าโหลดไว้
//   3) aiReview: ส่งข้อมูลที่ตัดชื่อ/HN ออกแล้วให้ AI (Groq ผ่าน Worker admin-error-classify) ช่วยทบทวน
// ข้อมูลจาก HOSxP Bridge: /db/order (วันนี้), /db/visits (6 visit ก่อน), /db/smartrx (lab สัญญาณชีพ แพ้ยา วินิจฉัย)
// ผลทั้งหมดเป็นตัวช่วยคัดกรอง เภสัชกรต้องพิจารณาเอง — level 'high' (ควรปรึกษาแพทย์), 'warn' (ควรตรวจสอบ), 'info'
(function () {
  'use strict';
  const AI_URL = 'https://admin-error-classify.oatsudster.workers.dev';
  const AI_TOKEN = 'x9kQm2vLpR7wZaN4tY8bJ3cH';

  // ── กลุ่มยาที่ใช้กับกฎ lab ──
  const TAGS = {
    acei: /enalap|captop|lisinop|ramipril|perindop/i,
    arb: /losart|cozaar|valsart|candesart|telmisart|irbesart/i,
    ksparing: /spironol|aldactone|amiloride|eplerenone/i,
    ksupp: /potassium\s*chl|\bKCL\b|K\s*elixir|elixir\s*KCL|kalium/i,
    diuretic: /furosem|lasix|HCTZ|hydrochlorothiaz|indapamide|chlorthalid/i,
    metformin: /metform|glucophage/i,
    su: /glipiz|minidiab|glibencl|daonil|gliclaz|diamicron|glimepir|amaryl/i,
    glibenclamide: /glibencl|daonil/i,
    sglt2: /gliflozin|forxiga|jardiance/i,
    pio: /pioglit/i,
    insulin: /insulin|mixtard|lantus|glargine|novomix|novorapid|humulin|gensulin|actrapid|insulatard|levemir|toujeo|tresiba|อินซูลิน/i,
    statin: /statin|zocor|lipitor|crestor/i,
    fibrate: /gemfibro|lopid|fenofib/i,
    nsaid: /ibuprof|brufen|diclofen|voltaren|naproxen|mefenam|ponstan|etoricox|arcoxia|celecox|celebrex|piroxic|meloxic|indometh/i,
    antiplatelet: /aspirin|aspent|\bASA\b|clopidog|plavix|ticagrel|cilostaz/i,
    anticoag: /warfarin|orfarin|rivaroxab|apixab|dabigat/i,
    allopurinol: /allopur|zyloric/i,
    colchicine: /colchic/i,
    levothyroxine: /levothyrox|eltroxin|euthyrox|thyroxine/i,
    antithyroid: /methimaz|thiamaz|propylthiou|\bPTU\b/i,
    digoxin: /digoxin|lanoxin/i,
    betablocker: /atenolol|propranolol|metoprolol|carvedilol|bisoprolol|nebivolol/i,
    ccb: /amlodip|norvas|nifedip|manidip|felodip|diltiaz|verapam/i,
    otherAntiHT: /hydralaz|doxazos|prazos|methyldopa|terazos/i,
    gabapentinoid: /gabapent|pregabal|lyrica|neurontin/i,
    h2: /famotid|ranitid|cimetid/i,
    tb: /isoniazid|\bINH\b|rifamp|pyrazinam|ethambut/i,
    methotrexate: /methotrex/i,
    ferrous: /ferrous|\bFBC\b|triferdine/i,
  };
  const ANTI_HT = ['acei', 'arb', 'ksparing', 'diuretic', 'betablocker', 'ccb', 'otherAntiHT'];
  const DM = ['metformin', 'su', 'sglt2', 'pio', 'insulin'];
  const tagsOf = d => Object.keys(TAGS).filter(k => TAGS[k].test(String(d.name || '')));
  const withTag = (drugs, ...tags) => drugs.filter(d => d._tags.some(t => tags.includes(t)));
  const names = ds => [...new Set(ds.map(d => shortName(d)))].join(', ');
  const shortName = d => String(d.name || '').replace(/\s+/g, ' ').trim();
  const fullName = d => [d.name, d.strength].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const isOldMed = d => /^ยาเดิม/.test(String(d.name || '').trim());   // ยาที่ผู้ป่วยนำมาเอง (ชื่อจริงอยู่ในวิธีใช้)

  // ── วิธีใช้ → ปริมาณ/วัน (ใช้ lib/rx-check.js ถ้ามี) ──
  const RX = () => window.tphRxCheck;
  const rxItem = d => ({ icode: d.icode, drug: fullName(d), strength: d.strength, units: d.units, form: d.form, qty: d.qty, usage: d.usage });
  // ใช้ parseUsage ของ clinic.html ถ้ามี (อ่าน "รับประทาน ครึ่งเม็ด", "เช้า 2 เม็ด เย็น 1 เม็ด" ได้ครบกว่า)
  function perDayInfo(d) {
    if (!RX()) return {};
    const it = rxItem(d), u = RX().usage(it), st = RX().strength(it);
    let units = u.amount != null && u.perDay ? u.amount * u.perDay : null, unit = u.unit || '', solid = u.solidUnit;
    if (typeof window.parseUsage === 'function') {
      const p = window.parseUsage(String(d.usage || ''));
      if (p.perDay != null) { units = p.perDay; unit = p.unit || unit; solid = /เม็ด|แคป/.test(unit) || (!unit && /^(tab|cap)/i.test(d.form || '')); }
    }
    const mg = units != null && st.perUnit && solid ? st.perUnit * units : units != null && st.perMl && u.ml != null && u.perDay ? st.perMl * u.ml * u.perDay : null;
    return { units, mg, unit, prn: !!u.prn };
  }
  // วิธีใช้ที่ความหมายเท่ากัน แค่เขียนต่างกัน ("ครั้งละ 1 เม็ด วันละ 2 เวลา" = "1 เม็ด วันละ 2 ครั้ง") ไม่นับว่าเปลี่ยน
  const normUse = s => String(s || '').replace(/ครั้งละ|ทีละ/g, '').replace(/เวลา/g, 'ครั้ง').replace(/อาหาร/g, '')
    .replace(/[\s.\-–,。]+/g, '').replace(/ครั้งครั้ง/g, 'ครั้ง');
  const fmt = (n, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toLocaleString('th-TH');

  // ตัวยาเดียวกันต่างความแรง/ต่าง icode: เทียบคำภาษาอังกฤษคำหลักของชื่อ (ไม่นับชื่อเกลือ)
  const SALT = /^(SODIUM|POTASSIUM|CALCIUM|HYDROCHLORIDE|CHLORIDE|CARBONATE|SULFATE|SULPHATE|MALEATE|CITRATE|ACETATE|PHOSPHATE|TARTRATE|SUCCINATE|FUMARATE|BESYLATE|MESYLATE|ACID|TABLET|TABLETS|CAPSULE)$/;
  function coreKey(d) {
    const t = (String(d.name || '').toUpperCase().match(/[A-Z]{4,}/g) || []).filter(x => !SALT.test(x));
    return t[0] || normUse(d.name).toUpperCase();
  }

  // ── 1) เทียบกับ visit ก่อน ──
  function compare(today, prev) {
    const out = [];
    if (!prev) return out;
    const usedPrev = new Set();
    const findPrev = d => {
      let i = prev.drugs.findIndex((p, k) => !usedPrev.has(k) && p.icode === d.icode);
      if (i < 0) i = prev.drugs.findIndex((p, k) => !usedPrev.has(k) && !isOldMed(p) && coreKey(p) === coreKey(d));
      return i;
    };
    today.forEach(d => {
      if (isOldMed(d)) return;
      const i = findPrev(d);
      if (i < 0) { out.push({ type: 'new', drug: d, text: `ยาใหม่: ${fullName(d)}`, detail: d.usage || '' }); return; }
      usedPrev.add(i);
      const p = prev.drugs[i];
      const a = perDayInfo(p), b = perDayInfo(d);
      if (p.icode !== d.icode) {
        out.push({ type: 'strength', drug: d, text: `เปลี่ยนความแรง/ชนิด: ${fullName(p)} → ${fullName(d)}`,
          detail: doseText(a, b) || (normUse(p.usage) !== normUse(d.usage) ? `วิธีใช้: ${p.usage || '-'} → ${d.usage || '-'}` : '') });
        return;
      }
      if (normUse(p.usage) === normUse(d.usage)) return;
      const up = a.units != null && b.units != null ? Math.sign(b.units - a.units) : 0;
      out.push({ type: up > 0 ? 'up' : up < 0 ? 'down' : 'usage', drug: d,
        text: `${up > 0 ? 'เพิ่มขนาด' : up < 0 ? 'ลดขนาด' : 'เปลี่ยนวิธีใช้'}: ${fullName(d)}`,
        detail: `เดิม "${p.usage || '-'}" → ใหม่ "${d.usage || '-'}"${doseText(a, b) ? ' (' + doseText(a, b) + ')' : ''}` });
    });
    prev.drugs.forEach((p, k) => {
      if (usedPrev.has(k) || isOldMed(p)) return;
      out.push({ type: 'stop', drug: p, text: `ไม่ได้รับครั้งนี้ (หยุดยา?): ${fullName(p)}`, detail: p.usage || '' });
    });
    const order = { new: 0, stop: 1, strength: 2, up: 3, down: 4, usage: 5 };
    return out.sort((x, y) => order[x.type] - order[y.type]);
  }
  function doseText(a, b) {
    if (a.mg != null && b.mg != null && Math.abs(a.mg - b.mg) > 1e-6) return `${fmt(a.mg)} → ${fmt(b.mg)} mg/วัน`;
    if (a.units != null && b.units != null && Math.abs(a.units - b.units) > 1e-6) return `${fmt(a.units, 2)} → ${fmt(b.units, 2)} ${b.unit || 'หน่วย'}/วัน`;
    return '';
  }

  // visit ก่อนที่ควรใช้เทียบ = visit ล่าสุดที่มียาตรงกับวันนี้มากพอ (≥ 60% ของ visit ที่ตรงมากที่สุด)
  // ไม่ใช่แค่ตรง 1 ตัว — ไม่งั้น visit ตา/ฟันที่มียาซ้ำตัวเดียวจะถูกเลือกแทน visit คลินิกโรคเรื้อรัง
  function pickPrev(today, visits) {
    if (!visits || !visits.length) return null;
    const ic = new Set(today.map(d => d.icode)), ck = new Set(today.map(coreKey));
    const ov = visits.map(v => v.drugs.filter(p => ic.has(p.icode) || ck.has(coreKey(p))).length);
    const max = Math.max(...ov);
    if (!max) return visits[0];
    return visits[ov.findIndex(n => n >= Math.max(1, Math.ceil(max * 0.6)))];
  }

  // ── 2) lab / สัญญาณชีพ ──
  const num = v => { const m = String(v == null ? '' : v).replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };
  function lab(info, k, i = 0) {
    const a = info && info.labs && info.labs[k];
    if (!a || !a[i]) return null;
    const v = num(a[i].value);
    return v == null ? null : { v, date: a[i].date, raw: a[i].value };
  }
  const daysAgo = iso => Math.round((Date.now() - new Date(iso + 'T00:00:00')) / 864e5);
  const thd = iso => window.tphHosxp ? tphHosxp.thDate(iso) : iso;
  const at = l => ` (${thd(l.date)}${daysAgo(l.date) > 180 ? ' — ผลเก่ากว่า 6 เดือน' : ''})`;

  function labAlerts(today, info, changes, todayIso) {
    const A = [];
    const add = (level, text) => { if (!A.some(a => a.text === text)) A.push({ level, text }); };
    const ds = today.filter(d => !isOldMed(d));
    const ageY = info && info.ageM != null ? Math.floor(+info.ageM / 12) : null;
    const changedIc = new Set(changes.filter(c => c.type !== 'stop').map(c => c.drug.icode));
    const unchanged = tags => withTag(ds, ...tags).length && !withTag(ds, ...tags).some(d => changedIc.has(d.icode))
      && !changes.some(c => c.type === 'stop' && c.drug._tags.some(t => tags.includes(t)));

    // โพแทสเซียม
    const k = lab(info, 'k');
    if (k) {
      const raise = withTag(ds, 'acei', 'arb', 'ksparing', 'ksupp');
      if (k.v >= 5.5 && raise.length) add('high', `K ${k.v}${at(k)} สูง แต่ได้ ${names(raise)} ซึ่งเพิ่ม K — ควรแจ้งแพทย์`);
      else if (k.v > 5.0 && raise.length) add('warn', `K ${k.v}${at(k)} ค่อนข้างสูง + ได้ ${names(raise)} — ติดตาม K`);
      if (withTag(ds, 'acei').length && withTag(ds, 'arb').length) add('high', `ได้ ACEI + ARB ร่วมกัน (${names(withTag(ds, 'acei', 'arb'))}) — เสี่ยง K สูง/ไตวาย ไม่แนะนำ`);
      const lower = withTag(ds, 'diuretic', 'digoxin');
      if (k.v < 3.5 && lower.length) add(k.v < 3.0 ? 'high' : 'warn', `K ${k.v}${at(k)} ต่ำ + ได้ ${names(lower)}${withTag(ds, 'digoxin').length ? ' (K ต่ำเพิ่มพิษ digoxin)' : ''} — พิจารณาเสริม K`);
    } else if (withTag(ds, 'acei', 'arb', 'ksparing').length) add('info', `ได้ ${names(withTag(ds, 'acei', 'arb', 'ksparing'))} แต่ไม่มีผล K ใน 1 ปี — ควรตรวจ K/Cr`);

    // การทำงานของไต
    const eg = lab(info, 'egfr') || (() => { const v = (info.vitals || []).find(x => +x.egfr > 0); return v ? { v: +v.egfr, date: v.date } : null; })();
    if (eg) {
      const e = eg.v, w = at(eg);
      withTag(ds, 'metformin').forEach(d => {
        const mg = perDayInfo(d).mg;
        if (e < 30) add('high', `eGFR ${fmt(e, 0)}${w}: ${shortName(d)} ห้ามใช้เมื่อ eGFR < 30`);
        else if (e < 45 && (mg == null || mg > 1000)) add('warn', `eGFR ${fmt(e, 0)}${w}: ${shortName(d)}${mg ? ` ${fmt(mg, 0)} mg/วัน` : ''} — ควรไม่เกิน 1,000 mg/วัน`);
      });
      if (e < 60 && withTag(ds, 'glibenclamide').length) add('warn', `eGFR ${fmt(e, 0)}${w}: glibenclamide เสี่ยงน้ำตาลต่ำ — พิจารณา glipizide แทน`);
      const nsaid = withTag(ds, 'nsaid');
      if (e < 60 && nsaid.length) add(e < 30 ? 'high' : 'warn', `eGFR ${fmt(e, 0)}${w}: ${names(nsaid)} (NSAID) ${e < 30 ? 'หลีกเลี่ยง' : 'ระวัง'} — ไตเสื่อมเพิ่ม`);
      if (e < 30 && withTag(ds, 'ksparing').length) add('high', `eGFR ${fmt(e, 0)}${w}: ${names(withTag(ds, 'ksparing'))} เสี่ยง K สูง — ไม่แนะนำเมื่อ eGFR < 30`);
      if (e < 25 && withTag(ds, 'sglt2').length) add('info', `eGFR ${fmt(e, 0)}${w}: ${names(withTag(ds, 'sglt2'))} ไม่ควรเริ่มใหม่เมื่อ eGFR < 25 (ใช้ต่อได้เพื่อไต/หัวใจ)`);
      withTag(ds, 'allopurinol').forEach(d => {
        const mg = perDayInfo(d).mg, cap = e < 30 ? 100 : e < 60 ? 200 : null;
        if (cap && mg && mg > cap) add('warn', `eGFR ${fmt(e, 0)}${w}: allopurinol ${fmt(mg, 0)} mg/วัน — ขนาดเริ่มต้นไม่ควรเกิน ${cap} mg/วัน (ปรับขึ้นช้าๆ ได้)`);
      });
      if (e < 30 && withTag(ds, 'colchicine').length) add('warn', `eGFR ${fmt(e, 0)}${w}: colchicine ควรลดขนาด/ระวังพิษ`);
      if (e < 60 && withTag(ds, 'gabapentinoid').length) add('warn', `eGFR ${fmt(e, 0)}${w}: ${names(withTag(ds, 'gabapentinoid'))} ต้องปรับขนาดตามไต`);
      if (e < 50 && withTag(ds, 'digoxin').length) add('warn', `eGFR ${fmt(e, 0)}${w}: digoxin สะสมได้ — ระวังพิษ/พิจารณาลดขนาด`);
      if (e < 50 && withTag(ds, 'h2').length) add('info', `eGFR ${fmt(e, 0)}${w}: ${names(withTag(ds, 'h2'))} ควรลดขนาดตามไต`);
      const e2 = lab(info, 'egfr', 1);
      if (e2 && e2.v > 0 && (e2.v - e) / e2.v >= 0.25) add('warn', `eGFR ลดลง ${fmt(e2.v, 0)} → ${fmt(e, 0)} (${thd(e2.date)} → ${thd(eg.date)}) — ทบทวนยาที่มีผลต่อไต/ต้องปรับขนาด`);
    } else if (withTag(ds, 'metformin', 'nsaid', 'allopurinol', 'ksparing').length)
      add('info', `ได้ ${names(withTag(ds, 'metformin', 'nsaid', 'allopurinol', 'ksparing'))} แต่ไม่มีผล eGFR/Cr ใน 1 ปี`);
    // NSAID + ACEI/ARB + ยาขับปัสสาวะ (triple whammy)
    if (withTag(ds, 'nsaid').length && withTag(ds, 'acei', 'arb').length && withTag(ds, 'diuretic').length)
      add('high', `NSAID + ACEI/ARB + ยาขับปัสสาวะ (${names(withTag(ds, 'nsaid', 'acei', 'arb', 'diuretic'))}) — เสี่ยงไตวายเฉียบพลัน`);

    // เบาหวาน
    const a1c = lab(info, 'hba1c'), fbs = lab(info, 'fbs'), dm = withTag(ds, ...DM), hypo = withTag(ds, 'su', 'insulin');
    if (a1c && dm.length) {
      if (a1c.v >= 8 && unchanged(DM)) add('warn', `HbA1c ${a1c.v}%${at(a1c)} ยังสูงกว่าเป้า แต่ยาเบาหวานเหมือนเดิม — ตรวจสอบการใช้ยา/พิจารณาปรับยา`);
      else if (a1c.v >= 7 && unchanged(DM)) add('info', `HbA1c ${a1c.v}%${at(a1c)} สูงกว่าเป้า < 7% เล็กน้อย ยาเบาหวานเหมือนเดิม`);
      if (a1c.v < 6.5 && hypo.length && (ageY >= 65 || a1c.v < 6)) add('warn', `HbA1c ${a1c.v}%${at(a1c)} ต่ำ${ageY >= 65 ? ` ในผู้สูงอายุ ${ageY} ปี` : ''} + ได้ ${names(hypo)} — เสี่ยงน้ำตาลต่ำ พิจารณาลดยา`);
    } else if (dm.length && !a1c) add('info', `ได้ยาเบาหวาน แต่ไม่มีผล HbA1c ใน 1 ปี`);
    if (fbs && dm.length && fbs.v >= 250 && daysAgo(fbs.date) <= 30) add('warn', `FBS ${fbs.v}${at(fbs)} สูงมาก — ตรวจสอบการใช้ยา/อาการ และการปรับยาเบาหวานครั้งนี้`);
    if (fbs && hypo.length && fbs.v < 70) add('high', `FBS ${fbs.v}${at(fbs)} ต่ำ + ได้ ${names(hypo)} — ซักอาการน้ำตาลต่ำ/แจ้งแพทย์`);

    // ไขมัน
    const ldl = lab(info, 'ldl'), tg = lab(info, 'tg'), statin = withTag(ds, 'statin');
    const dx = new Set((info.dxHistory || []).map(x => x.code).concat((info.dxToday || []).map(x => String(x.code || '').slice(0, 3))));
    const highRisk = ['E11', 'E10', 'E14', 'I63', 'I69', 'I25', 'I21', 'I64'].some(c => dx.has(c)) || dm.length;
    if (ldl) {
      if (statin.length && ldl.v >= (highRisk ? 100 : 130) && unchanged(['statin'])) add('info', `LDL ${ldl.v}${at(ldl)} ยังไม่ถึงเป้า${highRisk ? ' (< 100, หลอดเลือดสมอง/หัวใจ < 70)' : ''} — ยา statin เหมือนเดิม`);
      if (!statin.length && highRisk && ldl.v >= 100) add('info', `LDL ${ldl.v}${at(ldl)} ในผู้ป่วยเบาหวาน/หลอดเลือด ยังไม่ได้ statin — พิจารณาเสนอแพทย์`);
    } else if (statin.length) add('info', `ได้ statin แต่ไม่มีผล LDL ใน 1 ปี`);
    if (tg && tg.v >= 500) add('warn', `TG ${tg.v}${at(tg)} สูงมาก — เสี่ยงตับอ่อนอักเสบ${withTag(ds, 'fibrate').length ? '' : ' (ยังไม่ได้ fibrate)'}`);

    // ตับ
    const alt = lab(info, 'alt'), hepato = withTag(ds, 'statin', 'tb', 'methotrexate', 'pio', 'fibrate');
    if (alt && alt.v > 120 && hepato.length) add(alt.v > 200 ? 'high' : 'warn', `ALT ${alt.v}${at(alt)} > 3 เท่าของค่าปกติ + ได้ ${names(hepato)} — พิจารณาหยุด/ปรับยา`);

    // เลือด
    const hb = lab(info, 'hb'), plt = lab(info, 'plt'), bleed = withTag(ds, 'antiplatelet', 'anticoag', 'nsaid');
    if (hb && hb.v < 10 && bleed.length) add(hb.v < 8 ? 'high' : 'warn', `Hb ${hb.v}${at(hb)} ต่ำ + ได้ ${names(bleed)} — ระวังเลือดออก`);
    if (plt && plt.v < 100 && bleed.length) add(plt.v < 50 ? 'high' : 'warn', `เกล็ดเลือด ${plt.v} พัน${at(plt)} ต่ำ + ได้ ${names(bleed)} — ระวังเลือดออก`);
    if (withTag(ds, 'anticoag').length && withTag(ds, 'antiplatelet', 'nsaid').length) add('warn', `ยาต้านการแข็งตัวของเลือด + ${names(withTag(ds, 'antiplatelet', 'nsaid'))} — เสี่ยงเลือดออก`);
    if (hb && hb.v >= 13 && withTag(ds, 'ferrous').length && unchanged(['ferrous']) && ageY >= 15) add('info', `Hb ${hb.v}${at(hb)} ปกติแล้ว — ทบทวนความจำเป็นของยาเสริมธาตุเหล็ก`);

    // ยูริก / ไทรอยด์
    const ur = lab(info, 'uric');
    if (ur && ur.v > 6 && withTag(ds, 'allopurinol').length && unchanged(['allopurinol'])) add('info', `Uric acid ${ur.v}${at(ur)} ยังไม่ถึงเป้า < 6 — allopurinol ขนาดเดิม`);
    const tsh = lab(info, 'tsh');
    if (tsh && withTag(ds, 'levothyroxine').length) {
      if (tsh.v > 4.5) add('info', `TSH ${tsh.v}${at(tsh)} สูง — levothyroxine อาจไม่พอ/ตรวจวิธีกิน (ก่อนอาหาร ห่างแคลเซียม/เหล็ก)`);
      if (tsh.v < 0.1) add('warn', `TSH ${tsh.v}${at(tsh)} ต่ำมาก — levothyroxine อาจมากเกิน`);
    }
    if (tsh && tsh.v > 4.5 && withTag(ds, 'antithyroid').length) add('warn', `TSH ${tsh.v}${at(tsh)} สูง + ได้ ${names(withTag(ds, 'antithyroid'))} — อาจได้ยาต้านไทรอยด์มากเกิน`);

    // สัญญาณชีพวันนี้
    const v0 = (info.vitals || [])[0], isToday = v0 && v0.date === todayIso;
    if (isToday) {
      const sbp = +v0.bps || 0, dbp = +v0.bpd || 0, pr = +v0.pulse || 0, aht = withTag(ds, ...ANTI_HT);
      if (sbp && aht.length && sbp < 100) add('warn', `BP วันนี้ ${sbp}/${dbp} ต่ำ + ได้ยาลดความดัน ${aht.length} ตัว — ซักอาการหน้ามืด`);
      if (sbp >= 160 || dbp >= 100) add(aht.length && unchanged(ANTI_HT) ? 'warn' : 'info', `BP วันนี้ ${sbp}/${dbp} สูง${aht.length ? (unchanged(ANTI_HT) ? ' แต่ยาความดันเหมือนเดิม' : '') : ' ยังไม่ได้ยาลดความดัน'}`);
      else if ((sbp >= 140 || dbp >= 90) && aht.length && unchanged(ANTI_HT)) add('info', `BP วันนี้ ${sbp}/${dbp} ยังไม่ถึงเป้า ยาความดันเหมือนเดิม`);
      if (pr && pr < 55 && withTag(ds, 'betablocker', 'digoxin').length) add('warn', `ชีพจร ${pr} ช้า + ได้ ${names(withTag(ds, 'betablocker', 'digoxin'))}`);
      if (/^(Y|1)$/.test(String(v0.pregnancy || ''))) {
        const bad = withTag(ds, 'acei', 'arb', 'statin', 'anticoag', 'methotrexate');
        if (bad.length) add('high', `ตั้งครรภ์: ${names(bad)} ห้ามใช้/ไม่แนะนำในหญิงตั้งครรภ์`);
      }
    }
    return A;
  }

  // ── รวม ──
  function analyze({ today, visits, info, prevVn }) {
    const todayIso = new Date().toISOString().slice(0, 10);
    const T = (today || []).map(d => Object.assign({}, d, { _tags: tagsOf(d) }));
    const V = (visits || []).map(v => Object.assign({}, v, { drugs: v.drugs.map(d => Object.assign({}, d, { _tags: tagsOf(d) })) }));
    const prev = (prevVn && V.find(v => v.vn === prevVn)) || pickPrev(T, V);
    const changes = compare(T, prev);
    let alerts = info ? labAlerts(T, info, changes, todayIso) : [];
    // ขนาดยา ยาซ้ำ ยาตีกัน (กับยาเดิมใน 6 visit ก่อน) แพ้ยา ผู้สูงอายุ จาก rx-check
    if (RX() && info) {
      const v0 = (info.vitals || [])[0] || {};
      const home = [];
      V.forEach(v => v.drugs.forEach(d => { if (!home.some(h => h.icode === d.icode)) home.push(Object.assign(rxItem(d), { hn: 'x', last: v.date })); }));
      const r = RX().checkPatient({ hn: 'x', items: T.map(d => Object.assign(rxItem(d), { date: todayIso })), ageM: info.ageM,
        bw: v0.date === todayIso ? v0.bw : null, egfr: null, pregnancy: v0.date === todayIso ? v0.pregnancy : null },
        { allergy: (info.allergy || []).map(a => Object.assign({}, a, { hn: 'x' })), home, ddi: info.ddi || [] });
      r.alerts.forEach(a => { if (!alerts.some(b => b.text === a.text)) alerts.push(a); });
    }
    const order = { high: 0, warn: 1, info: 2 };
    alerts.sort((a, b) => order[a.level] - order[b.level]);
    // ยาคู่เดียวกันตีกันทั้งจากตาราง รพ. และตารางใน rx-check — เก็บข้อความระดับสูงสุดอันเดียว
    const seen = new Set();
    alerts = alerts.filter(a => {
      const m = a.text.match(/^ยาตีกัน[^:]*:\s*(.+?)\s+\+\s+(.+?)(?:\s+\(ยาเดิม|\s+—)/);
      if (!m) return true;
      const k = [m[1], m[2]].sort().join('|');
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    return { prev, changes, alerts };
  }

  // lab ที่แสดงเป็นแถบสรุป: [key, ชื่อ, ผิดปกติเมื่อ]
  const LAB_SHOW = [
    ['egfr', 'eGFR', v => v < 60], ['cr', 'Cr', v => v > 1.3], ['k', 'K', v => v < 3.5 || v > 5.0], ['na', 'Na', v => v < 135 || v > 145],
    ['hba1c', 'HbA1c', v => v >= 7], ['fbs', 'FBS', v => v < 70 || v > 130], ['ldl', 'LDL', v => v >= 100], ['tg', 'TG', v => v >= 200],
    ['alt', 'ALT', v => v > 40], ['hb', 'Hb', v => v < 11], ['plt', 'Plt', v => v < 150], ['uric', 'Uric', v => v > 7],
    ['tsh', 'TSH', v => v < 0.4 || v > 4.5], ['uacr', 'UACR', v => v >= 30],
  ];
  function labSummary(info) {
    return LAB_SHOW.map(([k, label, bad]) => {
      const l = lab(info, k);
      if (!l) return null;
      const p = lab(info, k, 1);
      return { key: k, label, value: l.v, raw: l.raw, date: l.date, bad: bad(l.v), prev: p ? p.v : null, prevDate: p ? p.date : null };
    }).filter(Boolean);
  }

  // ── 3) AI ── ไม่ส่งชื่อ/HN — มีแค่อายุ เพศ โรค lab ยา
  function aiPayload(today, prev, info, res) {
    const L = [];
    const ageY = info.ageM != null ? Math.floor(+info.ageM / 12) : '?';
    L.push(`ผู้ป่วย: ${info.sex === '1' ? 'ชาย' : info.sex === '2' ? 'หญิง' : '-'} อายุ ${ageY} ปี`);
    const v0 = (info.vitals || [])[0];
    if (v0) L.push(`สัญญาณชีพ ${thd(v0.date)}: BP ${+v0.bps || '-'}/${+v0.bpd || '-'} ชีพจร ${+v0.pulse || '-'} น้ำหนัก ${+v0.bw || '-'} กก.${/^(Y|1)$/.test(String(v0.pregnancy || '')) ? ' ตั้งครรภ์' : ''}`);
    if ((info.dxHistory || []).length) L.push('โรคประจำตัว (ICD10): ' + info.dxHistory.map(x => `${x.code} ${x.name || ''}`.trim()).join('; '));
    if ((info.dxToday || []).length) L.push('วินิจฉัยวันนี้: ' + info.dxToday.map(x => `${x.code} ${x.name || ''}`.trim()).join('; '));
    L.push('แพ้ยา: ' + ((info.allergy || []).map(a => a.agent + (a.symptom ? ` (${a.symptom})` : '')).join(', ') || 'ไม่มีบันทึก'));
    const labs = Object.entries(info.labs || {}).map(([k, a]) => `${k} ${a.map(x => `${x.value} (${x.date})`).join(', ')}`);
    if (labs.length) L.push('Lab (ล่าสุดก่อน): ' + labs.join(' | '));
    L.push('ยา visit วันนี้:');
    today.forEach((d, i) => L.push(`${i + 1}. ${fullName(d)} — ${d.usage || '-'} — จำนวน ${d.qty || '-'} ${d.units || ''}`));
    if (prev) {
      L.push(`ยา visit ก่อน (${prev.date}${prev.dep ? ' ' + prev.dep : ''}):`);
      prev.drugs.forEach((d, i) => L.push(`${i + 1}. ${fullName(d)} — ${d.usage || '-'}`));
    }
    if (res.changes.length) L.push('ระบบพบการเปลี่ยนแปลง: ' + res.changes.map(c => c.text + (c.detail ? ` [${c.detail}]` : '')).join('; '));
    if (res.alerts.length) L.push('คำเตือนจากกฎ: ' + res.alerts.map(a => a.text).join('; '));
    let s = L.join('\n');
    return s.length > 4800 ? s.slice(0, 4800) + '\n…(ตัดข้อมูลบางส่วน)' : s;
  }
  const AI_SYSTEM =
    'บทบาท: เภสัชกรคลินิกผู้เชี่ยวชาญ ช่วยเภสัชกรโรงพยาบาลชุมชนทบทวนใบสั่งยาผู้ป่วยนอกก่อนจ่ายยา (Smart Pharmacy) ' +
    'ใช้เฉพาะข้อมูลที่ให้ ห้ามเดาค่าที่ไม่มี ถ้าข้อมูลไม่พอให้บอกว่าควรตรวจอะไรเพิ่ม ' +
    'ตอบภาษาไทย กระชับ เป็นหัวข้อย่อย ไม่เกิน ~15 บรรทัด ตามหัวข้อ: ' +
    '1) การเปลี่ยนแปลงยาจาก visit ก่อน และเหตุผลที่น่าจะเป็น (สัมพันธ์กับ lab/BP หรือไม่) ' +
    '2) ความเหมาะสมของยาเทียบกับ lab/การทำงานของไต-ตับ/อายุ (ขนาดยา ข้อห้าม ยาตีกัน ยาซ้ำซ้อน) ' +
    '3) ปัญหาที่ควรปรึกษาแพทย์ก่อนจ่าย (ถ้าไม่มีให้บอกว่าไม่พบ) ' +
    '4) ประเด็นสำคัญที่ควรแนะนำผู้ป่วย ' +
    'ระบุระดับความสำคัญด้วย 🔴 (ควรแจ้งแพทย์) 🟠 (ควรตรวจสอบ) 🟢 (ข้อสังเกต)\n\nข้อมูลผู้ป่วย:\n';
  async function aiReview(today, prev, info, res, model) {
    const body = JSON.stringify({ mode: 'chat', model: model || 'smart', system: AI_SYSTEM + aiPayload(today, prev, info, res),
      messages: [{ role: 'user', content: 'ช่วยทบทวนความเหมาะสมของใบสั่งยา visit นี้' }] });
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(AI_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-App-Token': AI_TOKEN }, body });
      const data = await r.json().catch(() => ({}));
      if (r.ok) return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim() || '(AI ไม่ได้ตอบ)';
      if (r.status === 429 && data.retry_after && attempt < 2) { await new Promise(ok => setTimeout(ok, data.retry_after * 1000)); continue; }
      throw new Error(data.error || ('HTTP ' + r.status));
    }
  }

  window.tphSmartRx = { analyze, labSummary, aiReview, coreKey };
})();
