// ตรวจสอบใบสั่งยา: ขนาดยา (โดยเฉพาะเด็ก mg/kg) ยาซ้ำซ้อน ยาตีกัน (ในใบสั่ง + กับยาเดิม 180 วัน) แพ้ยา
// ผู้สูงอายุ (Beers) ตั้งครรภ์ และไตเสื่อม (eGFR) — ใช้ข้อมูลจาก HOSxP Bridge /db/nightmeds
// ผลเป็นคำเตือนให้เภสัชตรวจซ้ำ ไม่ใช่คำตัดสิน: level 'high' (ควรติดต่อแพทย์/แก้ไข), 'warn' (ควรตรวจสอบ), 'info'
(function () {
  // ── ตัวยา → ชื่อสามัญ + กลุ่ม (ใช้ทั้งตรวจขนาด ยาซ้ำ ยาตีกัน แพ้ยา) ──
  const ING = [
    ['paracetamol', /paracetamol|acetaminophen|\bPCM\b|tylenol|sara\b/i, ['analgesic']],
    ['ibuprofen', /ibuprofen|brufen/i, ['nsaid']],
    ['diclofenac', /diclofenac|voltaren|fenac/i, ['nsaid']],
    ['naproxen', /naproxen|naprosyn/i, ['nsaid']],
    ['mefenamic', /mefenamic|ponstan/i, ['nsaid']],
    ['etoricoxib', /etoricoxib|arcoxia/i, ['nsaid']],
    ['celecoxib', /celecoxib|celebrex/i, ['nsaid']],
    ['piroxicam', /piroxicam|feldene/i, ['nsaid']],
    ['aspirin', /aspirin|\bASA\b|aspent/i, ['antiplatelet', 'salicylate']],
    ['amoxicillin-clavulanate', /augmentin|clavul/i, ['penicillin', 'betalactam']],
    ['amoxicillin', /amox/i, ['penicillin', 'betalactam']],
    ['dicloxacillin', /dicloxacillin/i, ['penicillin', 'betalactam']],
    ['cloxacillin', /\bcloxacillin/i, ['penicillin', 'betalactam']],
    ['ampicillin', /ampicillin/i, ['penicillin', 'betalactam']],
    ['penicillin', /penicillin|benzathine|\bPGS\b/i, ['penicillin', 'betalactam']],
    ['cephalexin', /cephalexin|cefalexin/i, ['cephalosporin', 'betalactam']],
    ['ceftriaxone', /ceftriax|CEF-3/i, ['cephalosporin', 'betalactam']],
    ['cefazolin', /cefazolin/i, ['cephalosporin', 'betalactam']],
    ['ceftazidime', /ceftazid/i, ['cephalosporin', 'betalactam']],
    ['cefdinir', /cefdinir|omnicef/i, ['cephalosporin', 'betalactam']],
    ['cotrimoxazole', /co-?trimox|bactrim|sulfameth/i, ['sulfa']],
    ['ciprofloxacin', /cipro/i, ['quinolone', 'qt']],
    ['norfloxacin', /norflox|lexinor/i, ['quinolone']],
    ['levofloxacin', /levoflox/i, ['quinolone', 'qt']],
    ['ofloxacin', /\bofloxacin|tarivid/i, ['quinolone', 'qt']],
    ['roxithromycin', /roxithro|rulid/i, ['macrolide', 'qt']],
    ['erythromycin', /erythro/i, ['macrolide', 'qt', 'cyp3a4inh']],
    ['clarithromycin', /clarithro|klacid/i, ['macrolide', 'qt', 'cyp3a4inh']],
    ['azithromycin', /azithro|zithromax/i, ['macrolide', 'qt']],
    ['doxycycline', /doxycyc/i, ['tetracycline']],
    ['tetracycline', /\btetracycl/i, ['tetracycline']],
    ['metronidazole', /metronid|flagyl/i, []],
    ['fluconazole', /flucon/i, ['azole', 'qt', 'cyp3a4inh']],
    ['ketoconazole', /ketocon|nizoral/i, ['azole', 'qt', 'cyp3a4inh']],
    ['gentamicin', /gentam/i, ['aminoglycoside']],
    ['chlorpheniramine', /\bCPM\b|chlorphen|piriton/i, ['sedating_ah', 'anticholinergic']],
    ['hydroxyzine', /hydroxyz|atarax/i, ['sedating_ah', 'anticholinergic']],
    ['dimenhydrinate', /dimenhyd|dramamine/i, ['sedating_ah', 'anticholinergic']],
    ['cyproheptadine', /cyprohept|periactin/i, ['sedating_ah', 'anticholinergic']],
    ['promethazine', /prometh|phenergan/i, ['sedating_ah', 'anticholinergic']],
    ['cetirizine', /cetiriz|alerest|zyrtec/i, ['antihistamine']],
    ['loratadine', /loratad|clarityne/i, ['antihistamine']],
    ['fexofenadine', /fexofen|telfast/i, ['antihistamine']],
    ['domperidone', /domperid|motilium/i, ['d2', 'qt']],
    ['metoclopramide', /metoclop|plasil/i, ['d2']],
    ['ondansetron', /ondans/i, ['qt']],
    ['hyoscine', /hyoscine|hyosicne|buscopan/i, ['anticholinergic']],
    ['orphenadrine', /orphenadrine|norgesic/i, ['anticholinergic', 'muscle_relaxant']],
    ['guaifenesin', /guaifen|glyceryl guaiac|\(GG\)|\bGG\b/i, []],
    ['dextromethorphan', /dextrometh/i, []],
    ['salbutamol', /salbutamol|ventolin/i, []],
    ['theophylline', /theophyl/i, []],
    ['prednisolone', /prednisol/i, ['steroid']],
    ['dexamethasone', /dexameth/i, ['steroid']],
    ['hydrocortisone', /hydrocort/i, ['steroid']],
    ['tramadol', /tramadol|tramal/i, ['opioid', 'serotonergic']],
    ['morphine', /morphine|\bMST\b/i, ['opioid']],
    ['pethidine', /pethid/i, ['opioid', 'serotonergic']],
    ['codeine', /codeine/i, ['opioid']],
    ['diazepam', /diazepam|valium/i, ['benzo']],
    ['lorazepam', /loraze/i, ['benzo']],
    ['clonazepam', /clonaz|rivotril/i, ['benzo']],
    ['clorazepate', /cloraze|trancon/i, ['benzo']],
    ['amitriptyline', /amitrip|tripta/i, ['tca', 'serotonergic', 'anticholinergic', 'qt']],
    ['imipramine', /imipram|tofranil/i, ['tca', 'serotonergic', 'anticholinergic']],
    ['fluoxetine', /fluoxet/i, ['ssri', 'serotonergic']],
    ['sertraline', /sertral/i, ['ssri', 'serotonergic']],
    ['haloperidol', /haloper/i, ['antipsychotic', 'qt', 'd2']],
    ['chlorpromazine', /chlorpromaz|\bCPZ\b/i, ['antipsychotic', 'd2']],
    ['risperidone', /risperid/i, ['antipsychotic', 'd2']],
    ['warfarin', /warfarin|orfarin/i, ['anticoagulant']],
    ['clopidogrel', /clopidog|plavix/i, ['antiplatelet']],
    ['omeprazole', /omepraz|losec|miracid/i, ['ppi']],
    ['simvastatin', /simvast|zocor/i, ['statin']],
    ['atorvastatin', /atorvast|lipitor/i, ['statin']],
    ['enalapril', /enalap/i, ['acei']],
    ['captopril', /captop/i, ['acei']],
    ['losartan', /losart|cozaar/i, ['arb']],
    ['spironolactone', /spironol|aldactone/i, ['k_sparing']],
    ['potassium', /potassium|\bKCL\b|K\s*elixir/i, ['potassium']],
    ['furosemide', /furosem|lasix/i, ['diuretic']],
    ['hydrochlorothiazide', /HCTZ|hydrochlorothiaz/i, ['diuretic']],
    ['metformin', /metform|glucophage/i, []],
    ['glipizide', /glipiz|minidiab/i, ['sulfonylurea']],
    ['glibenclamide', /glibencl|daonil/i, ['sulfonylurea']],
    ['amlodipine', /amlodip|norvas/i, ['ccb']],
    ['digoxin', /digoxin|lanoxin/i, []],
    ['amiodarone', /amiodar|cordarone/i, ['qt']],
    ['phenytoin', /phenytoin|dilantin/i, []],
    ['carbamazepine', /carbamaz|tegretol/i, []],
    ['valproate', /valpro|depakin/i, []],
    ['phenobarbital', /phenobarb/i, []],
    ['lithium', /lithium/i, []],
    ['methotrexate', /methotrex/i, []],
    ['colchicine', /colchic/i, []],
    ['allopurinol', /allopur|zyloric/i, []],
    ['loperamide', /loperam|imodium/i, []],
    ['antacid', /antacid|alum milk|alumina|magnesia|\bMOM\b|sodamint|calcium carb|CaCO3/i, ['cation']],
    ['ferrous', /ferrous|\bFBC\b|triferdine/i, ['cation']],
    ['ergotamine', /cafergot|ergotam/i, []],
  ];
  // Norgesic = orphenadrine 35 mg + paracetamol 500 mg ต่อเม็ด
  const COMBO = [[/norgesic/i, [['orphenadrine', 35], ['paracetamol', 500]]], [/tylenol\s*cold/i, [['paracetamol', 500]]]];

  function ingredients(name) {
    const n = String(name || '');
    const combo = COMBO.find(c => c[0].test(n));
    if (combo) return combo[1].map(([id, mg]) => ({ id, mg, cls: (ING.find(x => x[0] === id) || [, , []])[2] }));
    const out = [];
    for (const [id, re, cls] of ING) {
      if (re.test(n) && !out.some(o => o.id === id || (id === 'amoxicillin' && o.id === 'amoxicillin-clavulanate'))) out.push({ id, cls });
    }
    return out;
  }
  const isInhaled = it => /\bNB\b|\bMDI\b|inhaler|nebul|BERODUAL|พ่น/i.test([it.drug, it.form, it.units, it.usage].join(' '));
  const isTopical = it => /CREAM|OINT|LOTION|GEL|calamine|ทา(?:บาง|บริเวณ|ยา|\s)|EYE|EAR|หยอด(?:ตา|หู)|VAG|SUPP|เหน็บ|ป้าย/i.test([it.drug, it.form, it.usage].join(' '));
  const isLiquid = it => /SYRUP|SUSP|SOLUTION|ELIXIR|DRY|DROP|MIXT/i.test(String(it.form || '')) || /ซีซี|\bml\b|มล|ขวด/i.test(String(it.units || ''));
  const isSolid = it => /TABLET|CAPSULE/i.test(String(it.form || ''));
  const isInjection = it => /INJECT|INTRAVENOUS/i.test(String(it.form || '')) || /\b(vial|amp)/i.test(String(it.units || ''));

  // ── ความแรง → mg ต่อเม็ด / mg ต่อ ml ──
  function num(s) { return parseFloat(String(s).replace(/,/g, '')); }
  function strength(it) {
    const s = String(it.strength || '') + ' ' + String(it.drug || '');
    const toMg = (v, u) => /^g/i.test(u) ? v * 1000 : /mcg|µg/i.test(u) ? v / 1000 : v;
    let m = s.match(/([\d.,]+)\s*(mg|มก|g|mcg)\.?\s*\/\s*([\d.]*)\s*(ml|มล|cc|ซีซี)/i);
    if (m) return { perMl: toMg(num(m[1]), m[2]) / (num(m[3]) || 1) };
    m = String(it.strength || '').match(/^\s*([\d.,]+)\s*(mg|มก|g|mcg)\b/i) || s.match(/[([]\s*([\d.]+)\s*[)\]]/) && [0, s.match(/[([]\s*([\d.]+)\s*[)\]]/)[1], 'mg'];
    if (m) return { perUnit: toMg(num(m[1]), m[2]) };
    return {};
  }
  // ── วิธีใช้ → ปริมาณต่อครั้ง + จำนวนครั้งต่อวัน ──
  const FRAC = { '½': 0.5, 'ครึ่ง': 0.5, '1/2': 0.5, '1/4': 0.25, '¼': 0.25, '3/4': 0.75 };
  function usage(it) {
    const u = String(it.usage || '').replace(/\s+/g, ' ');
    const r = { text: u };
    const m = u.match(/(?:ครั้งละ|ทีละ)\s*(ครึ่ง|½|¼|\d+\s*\/\s*\d+|[\d.]+)\s*(เม็ด|แคปซูล|แคป|ซีซี|cc|ml|มล\.?|ช้อนชา|ช้อนโต๊ะ|หยด|ซอง|ขวด)/i);
    if (m) {
      const a = m[1].replace(/\s/g, '');
      r.amount = FRAC[a] != null ? FRAC[a] : /\//.test(a) ? num(a.split('/')[0]) / num(a.split('/')[1]) : num(a);
      r.unit = m[2];
      r.ml = /ช้อนชา/.test(r.unit) ? r.amount * 5 : /ช้อนโต๊ะ/.test(r.unit) ? r.amount * 15 : /ซีซี|cc|ml|มล/i.test(r.unit) ? r.amount : null;
      r.liquidUnit = r.ml != null;
      r.solidUnit = /เม็ด|แคป/.test(r.unit);
    }
    const d = u.match(/วันละ\s*(\d+)/), h = u.match(/ทุก\s*(\d+)(?:\s*-\s*(\d+))?\s*(?:ชั่วโมง|ชม)/);
    if (d) r.perDay = num(d[1]);
    else if (h) r.perDay = Math.floor(24 / num(h[1]));
    else if (/ก่อนนอน/.test(u)) r.perDay = 1;
    else if (+it.iperday > 0) r.perDay = +it.iperday;
    r.prn = /เวลา\s*(ปวด|มีไข้|ไข้|คัน|ไอ|อาเจียน|คลื่นไส้|ท้องเสีย|นอนไม่หลับ)|เมื่อ(มี)?อาการ|\bprn\b/i.test(u);
    // ยาฉีด/ใช้ครั้งเดียว: ขนาดเป็น mg ในข้อความ เช่น "100mgiv"
    const mg = u.match(/([\d.]+)\s*(mg|มก)/i);
    if (mg && r.amount == null) r.mgText = num(mg[1]);
    return r;
  }

  // ── เกณฑ์ขนาดยา (ผู้ใหญ่ maxDay mg/วัน; เด็ก mg/kg) อ้างอิงขนาดมาตรฐานทั่วไป (Lexicomp/BNFc/คู่มือยาเด็ก) ──
  // dose: [ต่ำสุด, สูงสุด] mg/kg/ครั้ง, day: [ต่ำสุด, สูงสุด] mg/kg/วัน, minAgeM: อายุต่ำสุด (เดือน)
  const RULES = {
    paracetamol: { ped: { dose: [10, 15], day: [0, 75] }, adult: { maxDay: 4000 } },
    ibuprofen: { minAgeM: 6, ped: { dose: [5, 10], day: [0, 40] }, adult: { maxDay: 2400 } },
    diclofenac: { minAgeM: 12, ped: { day: [0, 3] }, adult: { maxDay: 150 } },
    naproxen: { minAgeM: 24, ped: { day: [0, 15] }, adult: { maxDay: 1500 } },
    mefenamic: { minAgeM: 168, adult: { maxDay: 1500 } },
    etoricoxib: { minAgeM: 192, adult: { maxDay: 120 } },
    amoxicillin: { ped: { day: [20, 100] }, adult: { maxDay: 4000 } },
    'amoxicillin-clavulanate': { ped: { day: [20, 95] }, adult: { maxDay: 4000 } },
    dicloxacillin: { ped: { day: [12.5, 100] }, adult: { maxDay: 4000 } },
    cephalexin: { ped: { day: [25, 100] }, adult: { maxDay: 4000 } },
    ceftriaxone: { ped: { day: [50, 100] }, adult: { maxDay: 4000 } },
    roxithromycin: { ped: { day: [5, 8.5] }, adult: { maxDay: 300 } },
    erythromycin: { ped: { day: [30, 55] }, adult: { maxDay: 4000 } },
    azithromycin: { ped: { day: [5, 12] }, adult: { maxDay: 500 } },
    ciprofloxacin: { adult: { maxDay: 1500 } },
    norfloxacin: { adult: { maxDay: 800 } },
    doxycycline: { minAgeM: 96, adult: { maxDay: 200 } },
    metronidazole: { ped: { day: [15, 50] }, adult: { maxDay: 4000 } },
    chlorpheniramine: { minAgeM: 24, ped: { day: [0, 0.5] }, adult: { maxDay: 24 }, ageMax: [[72, 6], [144, 12]] },
    hydroxyzine: { minAgeM: 24, ped: { day: [0, 2.5] }, adult: { maxDay: 100 } },
    dimenhydrinate: { minAgeM: 24, ped: { day: [0, 5.5] }, adult: { maxDay: 400 }, ageMax: [[72, 75], [144, 150]] },
    cyproheptadine: { minAgeM: 24, ped: { day: [0, 0.3] }, adult: { maxDay: 32 } },
    promethazine: { minAgeM: 24, ped: { dose: [0, 1] }, adult: { maxDay: 100 } },
    cetirizine: { minAgeM: 6, adult: { maxDay: 10 }, ageMax: [[24, 5], [72, 5]] },
    loratadine: { minAgeM: 24, adult: { maxDay: 10 }, ageMax: [[72, 5]] },
    domperidone: { ped: { dose: [0, 0.3], day: [0, 0.8] }, adult: { maxDay: 30 } },
    metoclopramide: { minAgeM: 12, ped: { dose: [0, 0.2], day: [0, 0.5] }, adult: { maxDay: 30 } },
    hyoscine: { adult: { maxDay: 100 } },
    guaifenesin: { minAgeM: 24, adult: { maxDay: 2400 }, ageMax: [[72, 600], [144, 1200]] },
    dextromethorphan: { minAgeM: 48, adult: { maxDay: 120 } },
    salbutamol: { ped: { dose: [0, 0.2] }, adult: { maxDay: 32 } },
    prednisolone: { ped: { day: [0, 2.2] }, adult: {}, pedAbsMaxDay: 60 },
    dexamethasone: { ped: { dose: [0, 0.65] } },
    hydrocortisone: { ped: { dose: [0, 5] } },
    tramadol: { minAgeM: 144, adult: { maxDay: 400 } },
    codeine: { minAgeM: 144, adult: { maxDay: 240 } },
    morphine: { ped: { dose: [0, 0.2] } },
    ondansetron: { ped: { dose: [0, 0.2] }, adult: { maxDay: 24 } },
    loperamide: { minAgeM: 24, adult: { maxDay: 16 } },
    omeprazole: { ped: { day: [0, 3.5] }, adult: { maxDay: 80 } },
    orphenadrine: { minAgeM: 144, adult: { maxDay: 300 } },
  };
  const MIN_AGE_NOTE = {
    chlorpheniramine: 'ไม่ควรใช้ยาแก้แพ้กลุ่ม sedating ในเด็ก < 2 ปี (กดการหายใจ)',
    dimenhydrinate: 'ไม่แนะนำในเด็ก < 2 ปี', cyproheptadine: 'ไม่แนะนำในเด็ก < 2 ปี', hydroxyzine: 'ไม่แนะนำในเด็ก < 2 ปี',
    promethazine: 'ห้ามใช้ในเด็ก < 2 ปี (กดการหายใจรุนแรง)', metoclopramide: 'ห้ามใช้ในเด็ก < 1 ปี (EPS)',
    tramadol: 'ห้ามใช้ในเด็ก < 12 ปี (กดการหายใจ)', codeine: 'ห้ามใช้ในเด็ก < 12 ปี (กดการหายใจ)',
    ibuprofen: 'ไม่แนะนำในทารก < 6 เดือน', doxycycline: 'หลีกเลี่ยงในเด็ก < 8 ปี (ฟันเปลี่ยนสี)',
    loperamide: 'ห้ามใช้ในเด็ก < 2 ปี', dextromethorphan: 'ไม่แนะนำยาแก้ไอในเด็ก < 4 ปี', guaifenesin: 'ไม่แนะนำในเด็ก < 2 ปี',
  };

  // ── ยาตีกัน (ระดับกลุ่ม/ตัวยา) — เสริมจากตารางยาตีกันของ รพ. ใน HOSxP ──
  // [ซ้าย, ขวา, level, ข้อความ] ซ้าย/ขวา = ชื่อสามัญ หรือ '@กลุ่ม'
  const DDI = [
    ['warfarin', '@nsaid', 'high', 'เพิ่มความเสี่ยงเลือดออก (NSAID + warfarin)'],
    ['warfarin', 'aspirin', 'high', 'เพิ่มความเสี่ยงเลือดออก'],
    ['warfarin', 'metronidazole', 'high', 'metronidazole ยับยั้งการทำลาย warfarin → INR สูง เลือดออก'],
    ['warfarin', 'cotrimoxazole', 'high', 'co-trimoxazole เพิ่มฤทธิ์ warfarin → INR สูง'],
    ['warfarin', '@azole', 'high', 'azole antifungal เพิ่มฤทธิ์ warfarin → INR สูง'],
    ['warfarin', '@quinolone', 'warn', 'quinolone อาจเพิ่ม INR — ติดตาม INR'],
    ['warfarin', '@macrolide', 'warn', 'macrolide อาจเพิ่ม INR — ติดตาม INR'],
    ['clopidogrel', 'omeprazole', 'warn', 'omeprazole ลดการออกฤทธิ์ของ clopidogrel (CYP2C19) — พิจารณา pantoprazole'],
    ['@nsaid', '@antiplatelet', 'warn', 'เพิ่มความเสี่ยงเลือดออกในทางเดินอาหาร'],
    ['@nsaid', '@acei', 'warn', 'NSAID ลดฤทธิ์ลดความดัน และเสี่ยงไตวาย/K สูง'],
    ['@nsaid', '@arb', 'warn', 'NSAID ลดฤทธิ์ลดความดัน และเสี่ยงไตวาย/K สูง'],
    ['@nsaid', '@diuretic', 'warn', 'NSAID ลดฤทธิ์ขับปัสสาวะ เสี่ยงไตวาย'],
    ['@nsaid', '@steroid', 'warn', 'NSAID + steroid เพิ่มความเสี่ยงแผล/เลือดออกในกระเพาะ — พิจารณาให้ PPI'],
    ['@nsaid', 'lithium', 'high', 'NSAID เพิ่มระดับ lithium'],
    ['@nsaid', 'methotrexate', 'high', 'NSAID เพิ่มพิษของ methotrexate'],
    ['@quinolone', '@cation', 'warn', 'antacid/เหล็ก/แคลเซียม จับ quinolone ลดการดูดซึม — ให้ห่างกัน ≥ 2 ชม. ก่อน/6 ชม. หลัง'],
    ['@tetracycline', '@cation', 'warn', 'antacid/เหล็ก/แคลเซียม จับ tetracycline ลดการดูดซึม — ให้ห่างกัน 2–3 ชม.'],
    ['ciprofloxacin', 'theophylline', 'high', 'ciprofloxacin เพิ่มระดับ theophylline (ชัก/หัวใจเต้นผิดจังหวะ)'],
    ['simvastatin', 'erythromycin', 'high', 'เพิ่มระดับ simvastatin → rhabdomyolysis (ห้ามใช้ร่วม)'],
    ['simvastatin', 'clarithromycin', 'high', 'เพิ่มระดับ simvastatin → rhabdomyolysis (ห้ามใช้ร่วม)'],
    ['simvastatin', '@azole', 'high', 'เพิ่มระดับ simvastatin → rhabdomyolysis'],
    ['simvastatin', 'roxithromycin', 'warn', 'อาจเพิ่มระดับ simvastatin — ระวัง myopathy'],
    ['atorvastatin', 'clarithromycin', 'warn', 'เพิ่มระดับ atorvastatin — จำกัดขนาด ≤ 20 mg'],
    ['simvastatin', 'amlodipine', 'info', 'amlodipine เพิ่มระดับ simvastatin — simvastatin ไม่ควรเกิน 20 mg/วัน'],
    ['@serotonergic', '@serotonergic', 'high', 'เสี่ยง serotonin syndrome / ชัก (เช่น tramadol + SSRI/TCA)'],
    ['@opioid', '@benzo', 'high', 'กดการหายใจ/ง่วงซึมมาก (opioid + benzodiazepine)'],
    ['@opioid', '@sedating_ah', 'warn', 'ง่วงซึม กดการหายใจเพิ่มขึ้น'],
    ['@acei', '@k_sparing', 'high', 'เสี่ยงโพแทสเซียมสูง'],
    ['@arb', '@k_sparing', 'high', 'เสี่ยงโพแทสเซียมสูง'],
    ['@acei', '@potassium', 'warn', 'เสี่ยงโพแทสเซียมสูง — ติดตาม K'],
    ['@arb', '@potassium', 'warn', 'เสี่ยงโพแทสเซียมสูง — ติดตาม K'],
    ['@acei', '@arb', 'high', 'ACEI + ARB เพิ่มความเสี่ยง K สูง ความดันต่ำ ไตเสื่อม'],
    ['domperidone', '@cyp3a4inh', 'high', 'ห้ามใช้ร่วม: เพิ่มระดับ domperidone → QT ยาว/หัวใจเต้นผิดจังหวะ'],
    ['domperidone', 'metoclopramide', 'warn', 'ยากลุ่ม D2 antagonist ซ้ำซ้อน — เสี่ยง EPS/QT'],
    ['@d2', '@antipsychotic', 'warn', 'เพิ่มความเสี่ยง EPS / NMS'],
    ['digoxin', '@macrolide', 'warn', 'macrolide เพิ่มระดับ digoxin'],
    ['digoxin', 'amiodarone', 'high', 'amiodarone เพิ่มระดับ digoxin — ลดขนาด digoxin ลงครึ่งหนึ่ง'],
    ['carbamazepine', '@macrolide', 'warn', 'macrolide เพิ่มระดับ carbamazepine'],
    ['carbamazepine', 'fluconazole', 'warn', 'fluconazole เพิ่มระดับ carbamazepine'],
    ['phenytoin', 'fluconazole', 'warn', 'fluconazole เพิ่มระดับ phenytoin'],
    ['colchicine', 'clarithromycin', 'high', 'เพิ่มพิษ colchicine (อาจถึงชีวิต)'],
    ['colchicine', 'erythromycin', 'high', 'เพิ่มพิษ colchicine'],
    ['@sulfonylurea', 'cotrimoxazole', 'warn', 'เสี่ยงน้ำตาลต่ำ'],
    ['@sulfonylurea', 'fluconazole', 'warn', 'เสี่ยงน้ำตาลต่ำ'],
    ['methotrexate', 'cotrimoxazole', 'high', 'เพิ่มพิษไขกระดูกของ methotrexate'],
    ['lithium', '@acei', 'warn', 'เพิ่มระดับ lithium'],
    ['lithium', '@diuretic', 'warn', 'เพิ่มระดับ lithium'],
    ['gentamicin', 'furosemide', 'warn', 'เพิ่มพิษต่อหูและไต'],
    ['ergotamine', '@cyp3a4inh', 'high', 'ห้ามใช้ร่วม: ergotism'],
    ['@qt', '@qt', 'info', 'ยาที่ทำให้ QT ยาวมากกว่า 1 ตัว — ระวังในผู้ป่วยหัวใจ/K, Mg ต่ำ'],
  ];

  const norm = s => String(s || '').toUpperCase().replace(/ยาเดิม/g, '').replace(/[^A-Z0-9ก-๙]/g, '');
  const hasIng = (ings, key) => key[0] === '@' ? ings.some(i => i.cls.includes(key.slice(1))) : ings.some(i => i.id === key);
  const label = it => { const n = String(it.drug || '').replace(/\s+/g, ' ').trim(), m = n.match(/^ยาเดิม\s*\((.*)\)\s*$/); return m ? m[1] : n; };
  const fmt = (n, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toLocaleString('th-TH');
  const ageText = m => m == null ? '' : m < 24 ? `${m} เดือน` : `${Math.floor(m / 12)} ปี`;

  // ตรวจ 1 ใบสั่ง: pt = { items, hn, ageM, bw, egfr, pregnancy }, ctx = { allergy, home, ddi }
  function checkPatient(pt, ctx) {
    const alerts = [];
    const add = (level, text) => { if (!alerts.some(a => a.text === text)) alerts.push({ level, text }); };
    const ageM = pt.ageM != null && pt.ageM !== '' ? +pt.ageM : null;
    const bw = +pt.bw > 0 ? +pt.bw : null;
    const child = ageM != null && (ageM < 144 || (ageM < 216 && bw && bw < 40));
    const elderly = ageM != null && ageM >= 780;
    const drugs = pt.items.filter(it => it.form && !/^ยาเดิม/.test(String(it.drug || '').trim()));
    const rx = drugs.map(it => ({ it, ings: ingredients(it.drug), u: usage(it), st: strength(it), inhaled: isInhaled(it), topical: isTopical(it) }));
    const doseInfo = {}; // icode → ข้อความขนาดยาที่คำนวณได้ (แสดงในตาราง)

    // 1) วิธีใช้ไม่ตรงรูปแบบยา
    rx.forEach(r => {
      if (r.inhaled || r.topical) return;
      if (isSolid(r.it) && r.u.liquidUnit) add('warn', `${label(r.it)}: เป็นยาเม็ด แต่วิธีใช้ระบุ "${r.u.amount} ${r.u.unit}" — ตรวจสอบวิธีใช้/ฉลาก`);
      if (isLiquid(r.it) && r.u.solidUnit && !isInjection(r.it)) add('warn', `${label(r.it)}: เป็นยาน้ำ แต่วิธีใช้ระบุเป็น "เม็ด" — ตรวจสอบวิธีใช้/ฉลาก`);
    });

    // 2) ขนาดยา: รวม mg/วัน ต่อตัวยา (รวมยาสูตรผสม เช่น Norgesic มี paracetamol)
    const perIng = {};
    rx.forEach(r => {
      if (r.inhaled || r.topical) return;
      r.ings.forEach(ing => {
        let mgDose = null;
        if (ing.mg != null && r.u.amount != null && r.u.solidUnit) mgDose = ing.mg * r.u.amount;
        else if (r.st.perUnit && r.u.amount != null && r.u.solidUnit) mgDose = r.st.perUnit * r.u.amount;
        else if (r.st.perMl && r.u.ml != null) mgDose = r.st.perMl * r.u.ml;
        else if (r.u.mgText != null && isInjection(r.it)) mgDose = r.u.mgText;
        else if (isInjection(r.it) && r.st.perUnit && +r.it.qty > 0 && +r.it.qty <= 2 && !r.u.amount) mgDose = r.st.perUnit * +r.it.qty;
        const perDay = r.u.perDay || (isInjection(r.it) ? 1 : null);
        const route = isInjection(r.it) ? 'inj' : 'oral';
        const e = perIng[ing.id + '|' + route] || (perIng[ing.id + '|' + route] = { id: ing.id, items: [], dose: [], day: 0, dayKnown: true });
        e.items.push(r.it);
        if (mgDose != null) {
          e.dose.push(mgDose);
          if (perDay) e.day += mgDose * perDay; else e.dayKnown = false;
          doseInfo[r.it.icode] = `${fmt(mgDose)} mg/ครั้ง${perDay ? ` × ${perDay}${r.u.prn ? ' (สูงสุด)' : ''}/วัน` : ''}` +
            (child && bw ? ` = ${fmt(mgDose / bw, 2)} mg/kg/ครั้ง${perDay ? ` (${fmt(mgDose * perDay / bw, 1)} mg/kg/วัน)` : ''}` : '');
        } else e.dayKnown = false;
      });
    });
    Object.values(perIng).forEach(e => {
      e.items = [...new Map(e.items.map(x => [x.icode, x])).values()];
      const rule = RULES[e.id];
      const names = [...new Set(e.items.map(label))].join(' + ');
      const over = e.day && rule && rule.adult && rule.adult.maxDay && e.day > rule.adult.maxDay * 1.01;
      if (e.items.length > 1) add(over ? 'high' : 'warn',
        `ได้ ${e.id} ซ้ำ ${e.items.length} รายการ (${names})` + (e.day ? ` รวมสูงสุด ${fmt(e.day, 0)} mg/วัน` : '') +
        (over ? ` เกินขนาดสูงสุด ${rule.adult.maxDay} mg/วัน` : ''));
      if (!rule) return;
      if (rule.minAgeM && ageM != null && ageM < rule.minAgeM)
        add('high', `${names}: ผู้ป่วยอายุ ${ageText(ageM)} — ${MIN_AGE_NOTE[e.id] || `ไม่แนะนำในเด็กอายุต่ำกว่า ${ageText(rule.minAgeM)}`}`);
      if (child) {
        if (!bw) return; // แจ้งรวมด้านล่าง
        const ped = rule.ped || {};
        const maxDose = e.dose.length ? Math.max(...e.dose) : null;
        if (ped.dose && maxDose != null) {
          const k = maxDose / bw;
          if (k > ped.dose[1] * 1.1) add('high', `${names}: ${fmt(maxDose)} mg/ครั้ง = ${fmt(k, 2)} mg/kg/ครั้ง สูงกว่าขนาดเด็ก ${ped.dose[0]}–${ped.dose[1]} mg/kg/ครั้ง (น้ำหนัก ${fmt(bw)} กก.)`);
          else if (ped.dose[0] && k < ped.dose[0] * 0.7) add('warn', `${names}: ${fmt(k, 2)} mg/kg/ครั้ง ต่ำกว่าขนาดเด็ก ${ped.dose[0]}–${ped.dose[1]} mg/kg/ครั้ง`);
        }
        if (ped.day && e.day && e.dayKnown) {
          const k = e.day / bw;
          if (k > ped.day[1] * 1.1) add('high', `${names}: ${fmt(e.day, 0)} mg/วัน = ${fmt(k, 1)} mg/kg/วัน สูงกว่าขนาดเด็ก ${ped.day[0] ? ped.day[0] + '–' : '≤ '}${ped.day[1]} mg/kg/วัน (น้ำหนัก ${fmt(bw)} กก.)`);
          else if (ped.day[0] && k < ped.day[0] * 0.8) add('warn', `${names}: ${fmt(k, 1)} mg/kg/วัน ต่ำกว่าขนาดเด็ก ${ped.day[0]}–${ped.day[1]} mg/kg/วัน (อาจไม่พอรักษา)`);
        }
        if (rule.pedAbsMaxDay && e.day > rule.pedAbsMaxDay) add('warn', `${names}: ${fmt(e.day, 0)} mg/วัน เกินขนาดสูงสุดในเด็ก ${rule.pedAbsMaxDay} mg/วัน`);
      }
      const ageCap = (rule.ageMax || []).find(([m]) => ageM != null && ageM < m);
      const maxDay = ageCap ? ageCap[1] : rule.adult && rule.adult.maxDay;
      if (maxDay && e.day && e.day > maxDay * 1.01 && !(e.items.length > 1 && !ageCap))
        add(e.day > maxDay * 1.25 ? 'high' : 'warn', `${names}: รวม ${fmt(e.day, 0)} mg/วัน เกินขนาดสูงสุด ${maxDay} mg/วัน${ageCap ? ` (อายุ ${ageText(ageM)})` : ''}`);
    });
    if (child && !bw && Object.keys(perIng).some(id => RULES[id] && (RULES[id].ped || RULES[id].minAgeM)))
      add('warn', `ผู้ป่วยเด็กอายุ ${ageText(ageM)} ไม่มีน้ำหนักใน HOSxP — ตรวจขนาดยาตามน้ำหนักไม่ได้ ควรชั่งน้ำหนัก/ตรวจเอง`);

    // 3) ยาซ้ำซ้อนในกลุ่มเดียวกัน
    const nowIngs = rx.filter(r => !r.inhaled).flatMap(r => r.ings.map(i => Object.assign({ it: r.it }, i)));
    const byCls = c => [...new Map(nowIngs.filter(i => i.cls.includes(c)).map(i => [i.id, i])).values()];
    const nsaid = byCls('nsaid').filter(i => i.id !== 'aspirin');
    if (nsaid.length > 1) add('high', `NSAIDs ซ้ำซ้อน: ${nsaid.map(i => label(i.it)).join(' + ')} — เสี่ยงแผลในกระเพาะ/ไตวาย`);
    const sah = byCls('sedating_ah');
    if (sah.length > 1) add('warn', `ยาแก้แพ้/แก้เวียนกลุ่มง่วงซึมซ้ำซ้อน: ${sah.map(i => label(i.it)).join(' + ')}`);

    // 4) ยาตีกัน: ในใบสั่งเดียวกัน และกับยาเดิมที่ได้ใน 180 วัน
    const home = (ctx.home || []).filter(h => h.hn === pt.hn && !drugs.some(d => d.icode === h.icode) &&
        !isInjection(h) && !isInhaled(h) && !/^ยาเดิม\.*$/.test(String(h.drug || '').trim()))
      .map(h => ({ it: h, ings: ingredients(h.drug), home: true }));
    const nowList = rx.filter(r => !r.inhaled && !r.topical);
    const pairs = [];
    nowList.forEach((a, i) => nowList.slice(i + 1).forEach(b => pairs.push([a, b])));
    nowList.forEach(a => home.forEach(b => pairs.push([a, b])));
    const seen = new Set();
    // ยาเดิมที่ได้ครั้งสุดท้ายเกิน 90 วัน อาจหยุดไปแล้ว → ลดระดับคำเตือนลง 1 ขั้น
    const ref = (pt.items[0] && pt.items[0].date) || new Date().toISOString().slice(0, 10);
    const stale = (b, level) => b.home && b.it.last && (new Date(ref) - new Date(b.it.last)) / 864e5 > 90
      ? (level === 'high' ? 'warn' : 'info') : level;
    pairs.forEach(([a, b]) => {
      const where = b.home ? ` (ยาเดิม ${label(b.it)} ได้ล่าสุด ${b.it.last ? tphThDate(b.it.last) : ''})` : '';
      DDI.forEach(([x, y, level, msg]) => {
        const hit = (hasIng(a.ings, x) && hasIng(b.ings, y)) || (hasIng(a.ings, y) && hasIng(b.ings, x));
        if (!hit) return;
        if (x === y && x[0] === '@' && a.ings.some(i => b.ings.some(j => j.id === i.id))) return; // ตัวยาเดียวกัน แจ้งเรื่องซ้ำไปแล้ว
        const k = [label(a.it), label(b.it), msg].sort().join('|');
        if (seen.has(k)) return; seen.add(k);
        if (level === 'info' && b.home) return;
        add(stale(b, level), `ยาตีกัน: ${label(a.it)} + ${label(b.it)}${where} — ${msg}`);
      });
      (ctx.ddi || []).forEach(r => {
        const na = norm(a.it.drug), nb = norm(b.it.drug), x = norm(r.a), y = norm(r.b);
        if (x.length < 4 || y.length < 4) return;
        const m = (p, q) => p && q && (p.includes(q) || q.includes(p));
        if (!((m(na, x) && m(nb, y)) || (m(na, y) && m(nb, x)))) return;
        const k = [label(a.it), label(b.it), 'hos'].sort().join('|');
        if (seen.has(k)) return; seen.add(k);
        add(stale(b, r.notAllow === 'Y' ? 'high' : +r.severity > 0 ? 'warn' : 'info'), `ยาตีกัน (ตาราง รพ.): ${label(a.it)} + ${label(b.it)}${where}${r.note ? ' — ' + String(r.note).replace(/\s+/g, ' ').trim().slice(0, 140) : ''}`);
      });
    });

    // 5) แพ้ยา
    (ctx.allergy || []).filter(a => a.hn === pt.hn && a.agent).forEach(a => {
      const ai = ingredients(a.agent), an = norm(a.agent).replace(/\(.*$/, '');
      nowList.forEach(r => {
        const same = r.ings.some(i => ai.some(j => j.id === i.id)) || (an.length >= 5 && norm(r.it.drug).includes(an.slice(0, 8)));
        const sym = a.symptom ? ` (อาการ: ${String(a.symptom).slice(0, 60)})` : '';
        if (same) return add('high', `แพ้ยา! ${label(r.it)} — มีประวัติแพ้ ${a.agent}${sym}`);
        const cls = c => ai.some(j => j.cls.includes(c)) && r.ings.some(i => i.cls.includes(c));
        if (cls('penicillin')) add('high', `แพ้ยากลุ่ม penicillin (${a.agent}) แต่ได้ ${label(r.it)}${sym}`);
        else if (ai.some(j => j.cls.includes('penicillin')) && r.ings.some(i => i.cls.includes('cephalosporin')))
          add('warn', `มีประวัติแพ้ ${a.agent} (penicillin) แต่ได้ ${label(r.it)} (cephalosporin) — มี cross-reactivity ได้ ตรวจชนิดการแพ้${sym}`);
        else if (cls('sulfa')) add('high', `แพ้ยากลุ่ม sulfa (${a.agent}) แต่ได้ ${label(r.it)}${sym}`);
        else if (cls('nsaid') || (ai.some(j => j.cls.includes('nsaid')) && r.ings.some(i => i.id === 'aspirin')))
          add('high', `แพ้ NSAID (${a.agent}) แต่ได้ ${label(r.it)} — อาจแพ้ข้ามกลุ่ม${sym}`);
        else if (cls('quinolone')) add('high', `แพ้ยากลุ่ม quinolone (${a.agent}) แต่ได้ ${label(r.it)}${sym}`);
      });
    });

    // 6) ผู้สูงอายุ (Beers criteria), ตั้งครรภ์, ไต
    if (elderly) {
      const beers = nowIngs.filter(i => i.cls.includes('sedating_ah') || i.cls.includes('benzo') || i.cls.includes('tca') || i.id === 'orphenadrine');
      [...new Map(beers.map(i => [i.id, i])).values()].forEach(i =>
        add('warn', `ผู้สูงอายุ ${ageText(ageM)}: ${label(i.it)} อยู่ใน Beers criteria (ง่วง สับสน หกล้ม ปัสสาวะคั่ง) — พิจารณาขนาดต่ำ/ยาทางเลือก`));
    }
    if (pt.pregnancy === 'Y' || pt.pregnancy === '1') {
      nowIngs.forEach(i => {
        if (i.cls.includes('nsaid')) add('high', `ตั้งครรภ์: ${label(i.it)} (NSAID) หลีกเลี่ยงโดยเฉพาะไตรมาส 3`);
        if (i.cls.some(c => ['quinolone', 'tetracycline', 'acei', 'arb', 'statin', 'anticoagulant'].includes(c)))
          add('high', `ตั้งครรภ์: ${label(i.it)} ไม่แนะนำในหญิงตั้งครรภ์`);
      });
    }
    const egfr = +pt.egfr > 0 ? +pt.egfr : null;
    if (egfr != null) {
      nowIngs.forEach(i => {
        if (i.cls.includes('nsaid') && egfr < 60) add(egfr < 30 ? 'high' : 'warn', `eGFR ${fmt(egfr, 0)}: ${label(i.it)} (NSAID) ${egfr < 30 ? 'หลีกเลี่ยง' : 'ระวัง'} — ไตเสื่อมเพิ่ม`);
        if (i.id === 'metformin' && egfr < 45) add(egfr < 30 ? 'high' : 'warn', `eGFR ${fmt(egfr, 0)}: metformin ${egfr < 30 ? 'ห้ามใช้' : 'ลดขนาด ≤ 1,000 mg/วัน'}`);
        if (['norfloxacin', 'ciprofloxacin', 'cotrimoxazole', 'gentamicin'].includes(i.id) && egfr < 30) add('warn', `eGFR ${fmt(egfr, 0)}: ${label(i.it)} ควรปรับขนาดตามการทำงานของไต`);
      });
    }
    if (child) nowIngs.forEach(i => {
      if (i.cls.includes('quinolone')) add('warn', `เด็กอายุ ${ageText(ageM)}: ${label(i.it)} (quinolone) ไม่แนะนำในเด็ก < 18 ปี ยกเว้นจำเป็น`);
      if (i.id === 'aspirin' && ageM < 192) add('warn', `เด็กอายุ ${ageText(ageM)}: aspirin เสี่ยง Reye's syndrome (ยกเว้นข้อบ่งใช้เฉพาะ)`);
    });

    const order = { high: 0, warn: 1, info: 2 };
    alerts.sort((a, b) => order[a.level] - order[b.level]);
    return { alerts, doseInfo, child, elderly, ageM, bw };
  }

  function tphThDate(iso) {
    const TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${+m[3]} ${TH[+m[2] - 1]} ${String(+m[1] + 543).slice(-2)}` : '';
  }

  window.tphRxCheck = { checkPatient, ingredients, usage, strength, ageText };
})();
