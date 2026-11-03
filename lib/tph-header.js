/* แถบหัวขาวแบบเดียวทุกหน้า (UI ขั้นที่ 2, 2026-11-03) — แทนหัวเดิมที่มีทั้งขาว/เขียวเข้ม/ไล่สี สูง 56–109 px
 *
 *   [🏠 หน้าหลัก] [ชื่อหน้า / คำอธิบาย] ............ [สถานะ] [ปุ่มคำสั่ง] [⋯ เครื่องมือเพิ่มเติม ▾]
 *
 * ย้าย "ของจริง" จากหัวเดิมมาใส่ (ชื่อหน้า, ป้ายซิงค์, ปุ่ม, ช่องเลือก) — id/onclick/ข้อความที่สคริปต์ของหน้าอัปเดตยังทำงานเหมือนเดิม
 * แล้วซ่อนหัวเดิม · ปุ่มหน้าหลักสร้างใหม่จาก href/ข้อความ/คลาสของลิงก์เดิม (ไม่พาสไตล์พื้นเข้มมาด้วย)
 * ปุ่มรองเกิน 2 ปุ่ม → รวมในเมนู "เครื่องมือเพิ่มเติม" (Esc / คลิกข้างนอก / เลือกแล้ว = ปิด)
 *
 *   TphHeader.mount({
 *     from: '.topbar',            หัวเดิม
 *     home: 'a.topbar-home',      ลิงก์กลับ (null = ไม่มี)
 *     title: 'h1', sub: '.sub',   ย้ายมาทั้ง element
 *     status: [...], actions: [...], primary: '#run-btn', more: [..., 'label:หัวกลุ่ม', ...],
 *     (ของที่ไม่ได้ระบุอยู่ในหัวเดิมที่ซ่อนไว้ — ไม่ลบ สคริปต์ที่อ้างถึงยังเจอ)
 *     sticky: true                ติดบนจอ (insurance ใช้ false — แถบซ้ายของหน้านั้นติดบนสุดเอง)
 *   })
 * เรียกก่อน TphSideTabs.mount (แถบซ้ายคำนวณระยะใต้หัวที่ติดบนจอ)
 */
(function () {
  if (window.TphHeader) return;
  const $ = (root, sel) => sel ? root.querySelector(sel) : null;
  let openMenu = null;
  function closeMenu() {
    if (!openMenu) return;
    openMenu.menu.hidden = true; openMenu.btn.setAttribute('aria-expanded', 'false'); openMenu = null;
  }
  document.addEventListener('click', e => { if (openMenu && !openMenu.wrap.contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && openMenu) { const b = openMenu.btn; closeMenu(); b.focus(); } });

  function mount(o) {
    const old = document.querySelector(o.from);
    if (!old || old.dataset.tphHd) return null;
    old.dataset.tphHd = '1';
    const hd = document.createElement('header');
    hd.className = 'tph-hd' + (o.sticky === false ? ' tph-hd-static' : '');
    // ปุ่มกลับหน้าหลัก
    const h0 = o.home === null ? null : $(old, o.home || 'a[href$="index.html"]');
    if (h0) {
      const a = document.createElement('a');
      a.href = h0.getAttribute('href'); a.className = 'tph-hd-home ' + [...h0.classList].filter(c => /-only$/.test(c)).join(' ');
      a.textContent = h0.textContent.trim().replace(/\s+/g, ' ');
      if (h0.title) a.title = h0.title;
      hd.appendChild(a);
    }
    // ชื่อหน้า + คำอธิบาย
    const tw = document.createElement('div'); tw.className = 'tph-hd-title';
    const t = $(old, o.title || 'h1');
    if (t) { t.classList.add('tph-hd-h'); tw.appendChild(t); }
    const sb = $(old, o.sub);
    if (sb) { sb.classList.add('tph-hd-sub'); tw.appendChild(sb); }
    hd.appendChild(tw);
    // ด้านขวา: สถานะ · ปุ่มคำสั่ง · เมนูเพิ่มเติม
    const right = document.createElement('div'); right.className = 'tph-hd-right';
    const take = sels => (sels || []).map(s => s.startsWith('label:') ? s : $(old, s)).filter(Boolean);
    const st = take(o.status);
    if (st.length) { const g = document.createElement('div'); g.className = 'tph-hd-status'; st.forEach(e => g.appendChild(e)); right.appendChild(g); }
    const act = take(o.actions);
    const prim = $(old, o.primary);
    let more = take(o.more);
    // เมนูเฉพาะเมื่อปุ่มรองมีมากกว่า 2 — น้อยกว่านั้นวางเป็นปุ่มรองในแถบเลย
    if (more.filter(e => typeof e !== 'string').length <= 2) { act.push(...more.filter(e => typeof e !== 'string')); more = []; }
    if (act.length || prim) {
      const g = document.createElement('div'); g.className = 'tph-hd-actions';
      act.forEach(e => g.appendChild(e));
      if (prim) { prim.classList.add('tph-hd-primary'); g.appendChild(prim); }
      right.appendChild(g);
    }
    if (more.length) {
      const wrap = document.createElement('div'); wrap.className = 'tph-hd-more';
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'tph-hd-morebtn'; btn.setAttribute('aria-haspopup', 'true'); btn.setAttribute('aria-expanded', 'false');
      btn.innerHTML = '<span aria-hidden="true">⋯</span> เครื่องมือเพิ่มเติม <span class="tph-hd-caret" aria-hidden="true">▾</span>';
      const menu = document.createElement('div'); menu.className = 'tph-hd-menu'; menu.hidden = true;
      more.forEach(e => {
        if (typeof e === 'string') { const l = document.createElement('div'); l.className = 'tph-hd-mlbl'; l.textContent = e.slice(6); menu.appendChild(l); return; }
        e.classList.add('tph-hd-mi'); menu.appendChild(e);
      });
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (openMenu && openMenu.menu === menu) { closeMenu(); return; }
        closeMenu(); menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); openMenu = { menu, btn, wrap };
        const first = menu.querySelector('.tph-hd-mi:not([hidden])'); if (first) first.focus();
      });
      // เลือกรายการแล้วปิดเมนู (คำสั่งของปุ่มเดิมทำงานก่อน)
      menu.addEventListener('click', e => { if (e.target.closest('.tph-hd-mi')) setTimeout(closeMenu, 0); });
      menu.addEventListener('keydown', e => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        const items = [...menu.querySelectorAll('.tph-hd-mi')].filter(i => i.offsetParent);
        const i = items.indexOf(document.activeElement);
        if (items.length) { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); }
      });
      wrap.append(btn, menu);
      right.appendChild(wrap);
    }
    hd.appendChild(right);
    old.parentNode.insertBefore(hd, old);
    old.classList.add('tph-hd-old');
    return hd;
  }
  window.TphHeader = { mount, close: closeMenu };
})();
