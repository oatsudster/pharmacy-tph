/* ใช้คีย์บอร์ดกับส่วนที่คลิกได้แต่ไม่ใช่ปุ่ม (div/th/tr/label/a ไม่มี href ที่มี onclick) — ทุกหน้าโหลดไฟล์นี้ท้าย <body>
 * (รายงานตรวจ UI 2026-11-03: การ์ด OPD/IPD/ER + เมนู ME, การ์ดกรองสถานะ/หัวตาราง expiry, ช่องยาเหลือสะสม clinic กด Tab เข้าไม่ได้)
 * ทำให้: Tab เข้าได้ (tabindex=0), โปรแกรมอ่านจอรู้ว่าเป็นปุ่ม (role=button ถ้ายังไม่มี role), Enter/Space = คลิก
 * ไม่แตะ: ปุ่ม/ลิงก์/ช่องกรอกจริง, พื้นหลัง modal (overlay/ปิดเมื่อคลิกนอกกรอบ), ส่วนที่มีแค่ event.stopPropagation()
 * ส่วนที่หน้าเว็บสร้างใหม่ทีหลัง (innerHTML) ก็ได้ด้วย — ตรวจซ้ำเมื่อ DOM เปลี่ยน
 */
(function () {
  if (window.TphUi) return;
  const SKIP_TAG = /^(BUTTON|INPUT|SELECT|TEXTAREA|OPTION|BODY|HTML|SUMMARY|DETAILS)$/;
  const SKIP_CODE = /^\s*(event\.stopPropagation\(\)\s*;?\s*)$|event\.target\s*===?\s*this/;
  function fix(el) {
    if (el.dataset.tphKb || SKIP_TAG.test(el.tagName) || (el.tagName === 'A' && el.hasAttribute('href'))) return;
    const code = el.getAttribute('onclick') || '';
    if (SKIP_CODE.test(code) || /overlay|backdrop/i.test(el.className)) return;
    el.dataset.tphKb = '1';
    if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
    if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
    el.addEventListener('keydown', e => {
      if (e.target !== el || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
    });
  }
  // ── ช่องวันที่ วว/ดด/ปปปป (พ.ศ.) แทนช่องวันที่ของเบราว์เซอร์ (ที่แสดงตามภาษาเครื่อง เช่น Mac ขึ้น 11/13/2026)
  //   ใส่ class="be" ที่ <input type="date"> — ช่องเดิมซ่อนอยู่ .value ยังเป็น YYYY-MM-DD ค.ศ. โค้ดของหน้าไม่ต้องแก้
  //   พิมพ์ 13/11/2569, 13112569, 13/11/69 หรือปี ค.ศ. ก็ได้ · ปุ่ม 📅 เปิดปฏิทินของเบราว์เซอร์ · วันที่ผิด = ขอบแดง ค่าเดิมไม่เปลี่ยน
  const beText = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${+m[1] + 543}` : ''; };
  function beParse(t) {
    t = String(t || '').trim(); if (!t) return '';
    const m = /^(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{2}|\d{4})$/.exec(t) || /^(\d{2})(\d{2})(\d{4}|\d{2})$/.exec(t);
    if (!m) return null;
    const d = +m[1], mo = +m[2]; let y = +m[3];
    if (y < 100) y += 2500;
    if (y >= 2400) y -= 543;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (y < 1900 || y > 2200 || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  function beEnhance(root) {
    (root || document).querySelectorAll('input[type=date].be:not([data-be])').forEach(el => {
      el.dataset.be = '1';
      const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      const wrap = document.createElement('span'); wrap.className = 'be-wrap';
      const tx = document.createElement('input');
      tx.type = 'text'; tx.className = 'be-txt' + (el.classList.contains('mdx-in') ? ' mdx-in' : ''); tx.inputMode = 'numeric';
      tx.placeholder = 'วว/ดด/ปปปป'; tx.autocomplete = 'off'; tx.maxLength = 10; tx.title = 'วัน/เดือน/ปี พ.ศ. เช่น 13/11/2569';
      if (el.id) tx.id = el.id + '-be';
      const bt = document.createElement('button');
      bt.type = 'button'; bt.className = 'be-cal'; bt.textContent = '📅'; bt.title = 'เลือกจากปฏิทิน'; bt.tabIndex = -1;
      el.parentNode.insertBefore(wrap, el); wrap.append(tx, bt, el);
      el.tabIndex = -1; el.setAttribute('aria-hidden', 'true');
      // ตั้ง .value จากโค้ด → ช่องพิมพ์เปลี่ยนตาม
      Object.defineProperty(el, 'value', { configurable: true, get() { return proto.get.call(this); },
        set(v) { proto.set.call(this, v); tx.value = beText(proto.get.call(this)); tx.classList.remove('bad'); } });
      tx.value = beText(el.value);
      tx.addEventListener('input', e => {
        if (e.inputType === 'insertText' && /^(\d{2}|\d{2}\/\d{2})$/.test(tx.value)) tx.value += '/';
        tx.classList.remove('bad');
      });
      const commit = () => {
        const iso = beParse(tx.value);
        if (iso === null) { tx.classList.add('bad'); return; }
        tx.value = beText(iso);
        if (iso !== el.value) { el.value = iso; el.dispatchEvent(new Event('change', { bubbles: true })); }
      };
      tx.addEventListener('change', commit);
      tx.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); });
      el.addEventListener('change', () => { tx.value = beText(el.value); tx.classList.remove('bad'); });
      bt.onclick = () => { try { el.showPicker(); } catch (e) { tx.focus(); } };
    });
  }
  function scan(root) { (root || document).querySelectorAll('[onclick]').forEach(fix); beEnhance(root); }
  let t = 0;
  function start() {
    scan();
    new MutationObserver(() => { if (!t) t = setTimeout(() => { t = 0; scan(); }, 120); })
      .observe(document.body, { childList: true, subtree: true });
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start();
  window.TphUi = { scan, beDate: beEnhance, beText, beParse };
})();
