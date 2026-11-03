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
  function scan(root) { (root || document).querySelectorAll('[onclick]').forEach(fix); }
  let t = 0;
  function start() {
    scan();
    new MutationObserver(() => { if (!t) t = setTimeout(() => { t = 0; scan(); }, 120); })
      .observe(document.body, { childList: true, subtree: true });
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start();
  window.TphUi = { scan };
})();
