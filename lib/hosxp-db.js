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
    // ทุก visit OPD ที่มียา + ยากลับบ้านทุกครั้ง ใน 1 ปีก่อน admit { visits:[{vn,date,dep,pdx,items:[...]}] } — เลือกดึงยาเดิมจาก visit อื่นเพิ่ม
    mrVisits: (hn, an) => /^\d+$/.test(String(an || '')) ? get('mrvisits', hn, '&an=' + an) : Promise.resolve(null),
    // คีย์ยาเดิมจาก รพ.อื่น ในใบ MR { drugs:[{icode,name,strength,units,form,active}], usages:[{id,code,text}] } (code = รหัสย่อ HOSxP เช่น "11pt (1เม็ด * 1pc)")
    mrDict: () => getPath('mrdict'),
    // ใบสั่งยากลับบ้าน (HMe) วันนี้/เมื่อวาน { orders:[{an,orderNo,date,time,hn,name,ward,bed,lastmod,items:[...]}], now }
    hme: () => getPath('hme'),
    // Smart Pharmacy: { sex, ageM, vitals:[{date,bps,bpd,pulse,bw,pregnancy,egfr}], labs:{cr:[{date,value}],...}, allergy, dxToday, dxHistory, ddi }
    smartRx: hn => get('smartrx', hn),
    // รายเคสตัวชี้วัด HA ที่ pharmacy_ha_sync.py เขียนไว้ (เฉพาะเครื่องที่รันสคริปต์) { data:{generated, allergy:[...], RAS:[...], PREG:[...]} }
    haCases: () => getPath('hacases'),
    // { version, latest, outdated, os, installed, dev } | { old:true } (bridge รุ่นก่อนมีระบบอัปเดต) | null (ไม่มี bridge)
    bridgeVersion: () => bridgeVersion(true),
    bridgeUpdate: () => bridgeUpdate(true),
    thDate,
  };

  // ── อัปเดต HOSxP Bridge อัตโนมัติ ─────────────────────────
  // เปิดหน้าไหนก็ตามที่โหลดไฟล์นี้: ถ้า bridge เครื่องนี้ไม่ตรงกับไฟล์ล่าสุดบนเว็บ สั่ง /update ให้เลย
  // (bridge ดาวน์โหลดไฟล์ใหม่ สำรองของเดิม แล้วเปิดตัวใหม่เองภายในไม่กี่วินาที — เปิดไม่ขึ้นคืนของเดิมให้เอง)
  const BRIDGE = 'http://127.0.0.1:8765/';
  const LOCK_KEY = 'tph_bridge_updating', OLD_KEY = 'tph_bridge_old_dismiss', NONE_KEY = 'tph_bridge_none_dismiss';
  async function bridgeFetch(path, ms) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
    try { return await fetch(BRIDGE + path, { cache: 'no-store', targetAddressSpace: 'loopback', signal: ctl.signal }); }
    finally { clearTimeout(t); }
  }
  async function bridgeVersion(check) {
    try {
      const res = await bridgeFetch('version' + (check ? '?check=1' : ''), check ? 30000 : 3000);
      if (res.status === 404) return { old: true };
      return res.ok ? await res.json() : null;
    } catch (e) { return null; }
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} }

  let toastEl = null, hideTimer = 0;
  function toast(html, kind, hideMs) {
    if (!document.body) return;
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.setAttribute('role', 'status');
      toastEl.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483000;max-width:min(420px,calc(100vw - 32px));' +
        'padding:10px 14px;border-radius:10px;font:14px/1.45 "Noto Sans Thai","Sarabun",sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.18);' +
        'display:flex;gap:10px;align-items:flex-start';
      document.body.appendChild(toastEl);
    }
    const c = { info: ['#E8F2EC', '#124228', '#1A5E38'], ok: ['#E8F2EC', '#124228', '#1A5E38'], warn: ['#FFF6E0', '#5C4300', '#C49A22'], err: ['#FDECEC', '#7A1C1C', '#C0392B'] }[kind] || [];
    toastEl.style.background = c[0]; toastEl.style.color = c[1]; toastEl.style.border = '1px solid ' + c[2];
    toastEl.innerHTML = '<div style="flex:1">' + html + '</div><button type="button" aria-label="ปิด" style="border:0;background:none;color:inherit;font-size:16px;cursor:pointer;padding:0 2px">✕</button>';
    toastEl.lastChild.onclick = () => { if (kind === 'warn' && toastEl.dataset.old) lsSet(OLD_KEY, new Date().toISOString().slice(0, 10)); hideToast(); };
    toastEl.dataset.old = '';
    clearTimeout(hideTimer);
    if (hideMs) hideTimer = setTimeout(hideToast, hideMs);
    return toastEl;
  }
  function hideToast() { if (toastEl) { toastEl.remove(); toastEl = null; } }

  // คำสั่งเดียวผ่าน Win+R: web-install.ps1 โหลดไฟล์จากเว็บแล้วรัน install.ps1 เอง (ไม่ต้อง Unblock/แตก zip, ใช้ db.json เดิมในเครื่อง)
  // zip ยังเก็บไว้เผื่อเครื่องที่ IT ปิด Win+R
  const INSTALL_CMD = `powershell -ep bypass -c "[Net.ServicePointManager]::SecurityProtocol=3072;iex(New-Object Net.WebClient).DownloadString('${new URL('hosxp-bridge/web-install.ps1', location.href).href}')"`;
  const INSTALL_HTML =
    '1. <button type="button" data-hxb-copy style="font:inherit;font-weight:700;padding:3px 10px;border-radius:6px;border:1px solid #C49A22;background:#fff;color:inherit;cursor:pointer">📋 คัดลอกคำสั่งติดตั้ง</button><br>' +
    '2. กดปุ่ม <b>Windows + R</b> &nbsp;3. กด <b>Ctrl + V</b> แล้ว <b>Enter</b> — ติดตั้งเองจนเสร็จ (ตอบคำถามวันเปิดเครื่อง 1 ครั้ง)<br>' +
    `<span style="font-size:12px;opacity:.8">ถ้าใช้ Win+R ไม่ได้: <a href="${new URL('hosxp-bridge/HOSxPBridge-update.zip', location.href).href}" download style="color:inherit">ดาวน์โหลด zip</a> > Extract All > ดับเบิลคลิก install.cmd</span>`;
  function wireCopy(el) {
    const b = el.querySelector('[data-hxb-copy]');
    if (b) b.onclick = async () => {
      try { await navigator.clipboard.writeText(INSTALL_CMD); }
      catch (e) { const ta = document.createElement('textarea'); ta.value = INSTALL_CMD; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
      b.textContent = '✅ คัดลอกแล้ว — กด Windows + R';
    };
  }
  // เบราว์เซอร์บล็อกการเชื่อม 127.0.0.1 (Chrome: "Apps on device" / "Local network") — fetch ล้มเหลวเหมือนไม่มี bridge
  async function localBlocked() {
    for (const name of ['loopback-network', 'local-network-access', 'local-network']) {
      try { if ((await navigator.permissions.query({ name })).state === 'denied') return true; } catch (e) {}
    }
    return false;
  }
  // ไม่พบ bridge — บอกวันละครั้ง; เครื่องนอกห้องยากด "ไม่ต้องเตือนอีก" ได้ถาวร
  async function noBridgeNotice() {
    const d = lsGet(NONE_KEY);
    if (d === 'never' || d === new Date().toISOString().slice(0, 10)) return;
    const blocked = await localBlocked();
    const el = toast('<b>เครื่องนี้ยังไม่ได้เชื่อม HOSxP</b> (ไม่พบ HOSxP Bridge)<br>' +
      (blocked
        ? 'เบราว์เซอร์ไม่อนุญาตให้หน้าเว็บคุยกับ bridge — คลิกไอคอนตั้งค่าซ้ายของช่อง URL > ตั้ง <b>Apps on device</b> และ <b>Local network</b> เป็น Allow แล้วรีเฟรชหน้า<br>ถ้ายังไม่ได้ ติดตั้งใหม่:<br>'
        : 'ถ้าเคยติดตั้งแล้ว อาจยังไม่ได้เปิด (บางเครื่องตั้งให้เปิดเองแค่วันพุธ-พฤหัส) — ติดตั้ง/ลงทับด้วยคำสั่งนี้จะเปิดให้เลย:<br>') +
      INSTALL_HTML +
      '<br><button type="button" data-hxb-never style="font:inherit;font-size:12px;border:0;background:none;color:inherit;text-decoration:underline;cursor:pointer;padding:0">ไม่ใช่เครื่องห้องยา — ไม่ต้องเตือนอีก</button>', 'warn');
    if (!el) return;
    wireCopy(el);
    el.lastChild.onclick = () => { lsSet(NONE_KEY, new Date().toISOString().slice(0, 10)); hideToast(); };
    el.querySelector('[data-hxb-never]').onclick = () => { lsSet(NONE_KEY, 'never'); hideToast(); };
  }

  let updating = null;
  function bridgeUpdate(manual) {
    if (!updating) updating = doUpdate(manual).finally(() => { updating = null; });
    return updating;
  }
  async function doUpdate(manual) {
    const v = await bridgeVersion(true);
    if (!v) {
      if (manual) lsSet(NONE_KEY, null);
      await noBridgeNotice();
      return { ok: false, error: 'no bridge' };
    }
    if (v.old) {
      // bridge รุ่นก่อนมีระบบอัปเดต — ต้องลงใหม่อีกครั้งเดียว (บอกวันละครั้ง)
      if (manual || lsGet(OLD_KEY) !== new Date().toISOString().slice(0, 10)) {
        const el = toast('<b>HOSxP Bridge เครื่องนี้เป็นรุ่นเก่า</b> — ลงทับอีกครั้งเดียว ต่อไปหน้าเว็บอัปเดตให้เองอัตโนมัติ<br>' + INSTALL_HTML, 'warn');
        if (el) { el.dataset.old = '1'; wireCopy(el); }
      }
      return { ok: false, error: 'old bridge' };
    }
    if (v.dev || !v.outdated) {
      if (manual) toast(v.checkError ? 'ตรวจเวอร์ชันไม่ได้: ' + v.checkError : `HOSxP Bridge เป็นรุ่นล่าสุดแล้ว (${v.version})`, v.checkError ? 'err' : 'ok', 6000);
      return { ok: !v.checkError, updated: false, version: v.version };
    }
    // ชุดนี้เคยอัปเดตแล้วเปิดไม่ขึ้น (bridge คืนตัวเดิมแล้ว) — ไม่สั่งซ้ำเอง รอชุดใหม่บนเว็บ หรือสั่งเองด้วย tphHosxp.bridgeUpdate()
    if (v.failed && !manual) return { ok: false, error: 'failed before' };
    // หลายแท็บเปิดพร้อมกัน ให้แท็บเดียวสั่งอัปเดต
    const lock = +lsGet(LOCK_KEY) || 0;
    if (!manual && Date.now() - lock < 90000) return { ok: false, error: 'busy' };
    lsSet(LOCK_KEY, String(Date.now()));
    toast(`⏳ กำลังอัปเดต HOSxP Bridge (${v.version} → ${v.latest}) …`, 'info');
    try {
      let r;
      try { r = await (await bridgeFetch('update', 60000)).json(); } catch (e) { r = { ok: false, error: 'bridge ไม่ตอบ' }; }
      if (!r.ok) { toast('อัปเดต HOSxP Bridge ไม่สำเร็จ: ' + (r.error || ''), 'err', 15000); return r; }
      if (!r.updated) { hideToast(); return r; }
      // รอตัวใหม่เปิดขึ้นมา (ตัวเก่าจะคืนไฟล์เดิมให้เองถ้าตัวใหม่เปิดไม่ขึ้นใน 40 วินาที)
      for (let i = 0; i < 60; i++) {
        await new Promise(res => setTimeout(res, 1000));
        const n = await bridgeVersion(false);
        if (n && !n.old && n.version === r.version) {
          toast(`✅ อัปเดต HOSxP Bridge เป็นรุ่นล่าสุดแล้ว (${r.version})`, 'ok', 6000);
          return { ok: true, updated: true, version: r.version };
        }
        if (n && !n.old && n.version === v.version) break;   // คืนไฟล์เดิมแล้ว
      }
      toast('อัปเดต HOSxP Bridge ไม่สำเร็จ — ตัวใหม่เปิดไม่ขึ้น ใช้ตัวเดิมต่อไปก่อน', 'err', 15000);
      return { ok: false, error: 'restart failed' };
    } finally { lsSet(LOCK_KEY, null); }
  }
  // ไม่ใช่หน้าที่เปิดจากเว็บของ รพ. (เปิดไฟล์จากเครื่อง) bridge จะไม่ยอมอัปเดตอยู่แล้ว
  if (location.protocol === 'https:') setTimeout(() => bridgeUpdate(false), 4000);
})();
