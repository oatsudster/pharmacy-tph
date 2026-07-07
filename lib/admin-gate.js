/**
 * Admin Gate — จำกัดสิทธิ์การลบ/รีเซ็ตข้อมูลทั้งหมดให้เฉพาะแอดมิน
 * ใช้งาน: requireAdmin(fn) — เรียก fn() ก็ต่อเมื่อยืนยันรหัสแอดมินถูกต้อง
 *
 * รหัสแอดมินจะถูกตั้งค่าครั้งแรกโดยผู้ใช้เอง (ไม่มีรหัสฝังในซอร์สโค้ด)
 * เก็บเป็น SHA-256 hash ใน localStorage ของเครื่อง/เบราว์เซอร์นั้นๆ
 */
(function () {
  const HASH_KEY   = 'tph_admin_hash_v1';
  const UNLOCK_KEY = 'tph_admin_unlock_v1'; // sessionStorage — ต้องยืนยันใหม่ทุกครั้งที่เปิดเบราว์เซอร์ใหม่

  async function sha256(msg) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function injectStyles() {
    if (document.getElementById('ag-style')) return;
    const style = document.createElement('style');
    style.id = 'ag-style';
    style.textContent = `
      #ag-overlay { display:none; position:fixed; inset:0; z-index:100000; background:rgba(0,0,0,.55);
        align-items:center; justify-content:center; font-family:'Noto Sans Thai','Sarabun',sans-serif; }
      #ag-overlay.ag-show { display:flex; }
      #ag-box { background:#fff; border-radius:16px; padding:28px 26px; max-width:340px; width:90%;
        box-shadow:0 8px 32px rgba(0,0,0,.22); box-sizing:border-box; }
      #ag-title { font-size:1.05rem; font-weight:700; color:#1C2B22; margin-bottom:8px; }
      #ag-msg { font-size:.85rem; color:#3D5A47; margin-bottom:16px; line-height:1.55; }
      #ag-input { width:100%; padding:11px 14px; font-size:16px; font-family:inherit; border:2px solid #d1ddd6;
        border-radius:9px; outline:none; text-align:center; letter-spacing:.08em; margin-bottom:10px; box-sizing:border-box; }
      #ag-error { color:#b91c1c; font-size:.8rem; font-weight:600; margin-bottom:8px; min-height:16px; }
      #ag-btn-ok { display:block; width:100%; padding:11px; background:#1A5E38; color:#fff; border:none;
        border-radius:9px; font-size:.95rem; font-family:inherit; font-weight:600; cursor:pointer; margin-bottom:8px; }
      #ag-btn-ok:hover { background:#124228; }
      #ag-btn-cancel { display:block; width:100%; background:none; border:none; color:#7A9A85; font-size:.8rem;
        font-family:inherit; cursor:pointer; text-decoration:underline; padding:4px; }
    `;
    document.head.appendChild(style);
  }

  function injectOverlay() {
    if (document.getElementById('ag-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'ag-overlay';
    overlay.innerHTML = `
      <div id="ag-box">
        <div id="ag-title"></div>
        <div id="ag-msg"></div>
        <input id="ag-input" type="password" placeholder="รหัสแอดมิน" autocomplete="off">
        <div id="ag-error"></div>
        <button type="button" id="ag-btn-ok"></button>
        <button type="button" id="ag-btn-cancel">ยกเลิก</button>
      </div>`;
    (document.body || document.documentElement).appendChild(overlay);
  }

  function promptOnce(title, msg, btnLabel) {
    injectStyles();
    injectOverlay();
    return new Promise(resolve => {
      document.getElementById('ag-title').textContent = title;
      document.getElementById('ag-msg').textContent = msg;
      document.getElementById('ag-btn-ok').textContent = btnLabel;
      document.getElementById('ag-error').textContent = '';
      const overlay = document.getElementById('ag-overlay');
      const input   = document.getElementById('ag-input');
      const okBtn   = document.getElementById('ag-btn-ok');
      const cancel  = document.getElementById('ag-btn-cancel');
      input.value = '';
      overlay.classList.add('ag-show');
      setTimeout(() => input.focus(), 50);

      function cleanup(val) {
        okBtn.onclick = null; cancel.onclick = null; input.onkeydown = null;
        overlay.classList.remove('ag-show');
        resolve(val);
      }
      okBtn.onclick    = () => cleanup(input.value);
      cancel.onclick   = () => cleanup(null);
      input.onkeydown  = e => { if (e.key === 'Enter') cleanup(input.value); };
    });
  }

  async function setupAdminPin() {
    const p1 = await promptOnce(
      '🆕 ตั้งค่ารหัสแอดมิน',
      'ยังไม่มีการตั้งค่ารหัสแอดมินในเครื่องนี้ — เฉพาะหัวหน้ากลุ่มงาน/ผู้ดูแลระบบเท่านั้นที่ควรเป็นผู้ตั้งค่านี้ กรุณาตั้งรหัสผ่านใหม่:',
      'ตั้งรหัสนี้'
    );
    if (p1 === null || !p1.trim()) return false;
    const p2 = await promptOnce('🆕 ยืนยันรหัสแอดมิน', 'กรุณากรอกรหัสเดิมอีกครั้งเพื่อยืนยัน:', 'ยืนยัน');
    if (p2 === null) return false;
    if (p1 !== p2) { alert('รหัสไม่ตรงกัน กรุณาลองใหม่อีกครั้ง'); return false; }
    localStorage.setItem(HASH_KEY, await sha256(p1));
    return true;
  }

  async function verifyAdminPin() {
    const storedHash = localStorage.getItem(HASH_KEY);
    if (!storedHash) return setupAdminPin();
    for (let tries = 0; tries < 3; tries++) {
      const pin = await promptOnce(
        '🔒 ยืนยันสิทธิ์แอดมิน',
        'การทำรายการนี้ (ลบ/รีเซ็ตข้อมูลทั้งหมด) จำกัดเฉพาะแอดมินเท่านั้น กรุณากรอกรหัสแอดมิน:',
        'ยืนยัน'
      );
      if (pin === null) return false;
      if ((await sha256(pin)) === storedHash) return true;
      alert('❌ รหัสแอดมินไม่ถูกต้อง');
    }
    return false;
  }

  window.requireAdmin = async function (actionFn) {
    if (typeof actionFn !== 'function') return;
    if (sessionStorage.getItem(UNLOCK_KEY) === '1') { actionFn(); return; }
    if (await verifyAdminPin()) {
      sessionStorage.setItem(UNLOCK_KEY, '1');
      actionFn();
    }
  };
})();
