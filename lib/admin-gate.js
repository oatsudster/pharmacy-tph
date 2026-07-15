/**
 * Admin Gate — จำกัดสิทธิ์การลบ/รีเซ็ตข้อมูลทั้งหมดให้เฉพาะแอดมิน
 * ใช้งาน: requireAdmin(fn) — เรียก fn() ก็ต่อเมื่อยืนยัน id/รหัสแอดมินถูกต้อง
 *
 * รหัสผ่านถูกเก็บเป็น SHA-256 hash ของ "id:password" (ไม่เก็บ plain text ในซอร์ส)
 * เปลี่ยนรหัสได้โดยแก้ค่า ADMIN_HASH ด้านล่าง (คำนวณ hash ใหม่จาก id:password ที่ต้องการ)
 */
(function () {
  const ADMIN_HASH = '8da193366e1554c08b2870c50f737b9587c3372b656151c4a96028af26f51334'; // sha256("admin:admin")
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
      #ag-field { width:100%; padding:11px 14px; font-size:16px; font-family:inherit; border:2px solid #d1ddd6;
        border-radius:9px; outline:none; margin-bottom:10px; box-sizing:border-box; }
      #ag-pass { text-align:center; letter-spacing:.08em; }
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
        <div id="ag-title">🔒 ยืนยันสิทธิ์แอดมิน</div>
        <div id="ag-msg">การทำรายการนี้ (ลบ/รีเซ็ตข้อมูลทั้งหมด) จำกัดเฉพาะแอดมินเท่านั้น</div>
        <input id="ag-id"   class="ag-field" placeholder="รหัสผู้ใช้ (ID)" autocomplete="off" style="width:100%;padding:11px 14px;font-size:16px;font-family:inherit;border:2px solid #d1ddd6;border-radius:9px;outline:none;margin-bottom:10px;box-sizing:border-box">
        <input id="ag-pass" class="ag-field" type="password" placeholder="รหัสผ่าน" autocomplete="off" style="width:100%;padding:11px 14px;font-size:16px;font-family:inherit;border:2px solid #d1ddd6;border-radius:9px;outline:none;margin-bottom:10px;box-sizing:border-box;text-align:center;letter-spacing:.08em">
        <div id="ag-error"></div>
        <button type="button" id="ag-btn-ok">ยืนยัน</button>
        <button type="button" id="ag-btn-cancel">ยกเลิก</button>
      </div>`;
    (document.body || document.documentElement).appendChild(overlay);
  }

  function promptCredentials() {
    injectStyles();
    injectOverlay();
    return new Promise(resolve => {
      document.getElementById('ag-error').textContent = '';
      const overlay = document.getElementById('ag-overlay');
      const idInput = document.getElementById('ag-id');
      const pwInput = document.getElementById('ag-pass');
      const okBtn   = document.getElementById('ag-btn-ok');
      const cancel  = document.getElementById('ag-btn-cancel');
      idInput.value = ''; pwInput.value = '';
      overlay.classList.add('ag-show');
      setTimeout(() => idInput.focus(), 50);

      function cleanup(val) {
        okBtn.onclick = null; cancel.onclick = null; pwInput.onkeydown = null;
        overlay.classList.remove('ag-show');
        resolve(val);
      }
      okBtn.onclick   = () => cleanup({ id: idInput.value, pass: pwInput.value });
      cancel.onclick  = () => cleanup(null);
      pwInput.onkeydown = e => { if (e.key === 'Enter') cleanup({ id: idInput.value, pass: pwInput.value }); };
    });
  }

  async function verifyAdmin() {
    for (let tries = 0; tries < 3; tries++) {
      const cred = await promptCredentials();
      if (cred === null) return false;
      const hash = await sha256(cred.id + ':' + cred.pass);
      if (hash === ADMIN_HASH) return true;
      document.getElementById('ag-error').textContent = '❌ รหัสไม่ถูกต้อง';
      alert('❌ รหัสผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }
    return false;
  }

  window.requireAdmin = async function (actionFn) {
    if (typeof actionFn !== 'function') return;
    if (sessionStorage.getItem(UNLOCK_KEY) === '1') { actionFn(); return; }
    if (await verifyAdmin()) {
      sessionStorage.setItem(UNLOCK_KEY, '1');
      actionFn();
    }
  };
})();
