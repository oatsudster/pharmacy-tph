/* แถบหัวข้อด้านซ้าย — pattern เดียวกันทุกหน้า (ผู้ใช้ขอ 2026-11-03: ย้าย tab ย่อยทุกหน้าไปไว้ซ้ายมือ แบบ insurance.html)
 *
 * ใช้ปุ่ม tab เดิมของหน้า (onclick/คลาส active เดิมทำงานเหมือนเดิม) — สร้างปุ่มในแถบซ้ายที่กดแล้วไปกดปุ่มเดิมให้
 * แล้วซ่อนแถบ tab เดิม · ปุ่มในแถบซ้ายตามสถานะปุ่มเดิมเอง (active/on/aria-selected = เลือกอยู่, ปุ่มเดิมถูกซ่อน = ซ่อน, ข้อความเปลี่ยน = เปลี่ยนตาม)
 * ปุ่มที่หน้าเว็บสร้างใหม่ทีหลัง (innerHTML) ก็ตามได้ — ใส่ tabs เป็นฟังก์ชันหรือ selector แล้วสคริปต์หาใหม่ทุกครั้งที่หน้าเปลี่ยน
 *
 *   TphSideTabs.mount({
 *     tabs:  '.tabbar' | () => element   แถบ tab เดิม (ปุ่ม = ลูกที่เป็น button/a)
 *     start: '.wrap'                      จุดเริ่มเนื้อหาที่ย้ายไปอยู่ขวาของแถบ (ลูกของ body) — ไม่ใส่ = ลูกของ body ที่มีแถบ tab อยู่
 *     group: 'รายงาน'                     หัวกลุ่มในแถบซ้าย (ไม่ใส่ได้)
 *     when:  () => true                   แสดงกลุ่มนี้เมื่อไหร่ (เช่น เฉพาะตอนอยู่หน้ารายงาน)
 *   })
 *
 * จอแคบ (≤ 860 px) แถบซ้ายกลายเป็นแถบปุ่มเลื่อนแนวนอนติดบนจอ · พิมพ์ = ไม่แสดงแถบ
 * ไม่ย้าย: script/style/datalist/template, #print-area, modal/toast และอะไรที่ position: fixed
 */
(function () {
  if (window.TphSideTabs) return;
  const CSS = `
.tph-sl { display: grid; grid-template-columns: 236px minmax(0, 1fr); align-items: start; }
.tph-main { min-width: 0; }
.tph-sl.tph-empty { display: block; }
.tph-sl.tph-empty > .tph-side { display: none; }
.tph-side { position: sticky; top: var(--tph-top, 0px); max-height: calc(100vh - var(--tph-top, 0px)); overflow-y: auto; box-sizing: border-box;
  padding: 14px 10px 24px; display: flex; flex-direction: column; gap: 2px; border-right: 1px solid #D6E4DA; background: #fff;
  min-height: calc(100vh - var(--tph-top, 0px)); font-family: 'Noto Sans Thai', 'Sarabun', sans-serif; z-index: 4; }
.tph-grp { display: flex; flex-direction: column; gap: 2px; }
.tph-grp[hidden] { display: none; }
.tph-grp + .tph-grp { margin-top: 6px; }
.tph-lbl { font-size: 11.5px; font-weight: 700; color: #8A9A90; letter-spacing: .02em; padding: 10px 10px 4px; }
.tph-grp:first-child .tph-lbl { padding-top: 0; }
.tph-it { font: inherit; font-size: 14px; line-height: 1.35; display: flex; gap: 8px; align-items: center; text-align: left; border: 0; background: none;
  color: #4A5A50; padding: 9px 10px; border-radius: 8px; cursor: pointer; width: 100%; box-sizing: border-box; }
.tph-it:hover { background: #E8F2EC; color: #124228; }
.tph-it.on { background: var(--primary, #1A5E38); color: #fff; font-weight: 700; }
.tph-it[hidden] { display: none; }
.tph-it:disabled { opacity: .5; cursor: default; }
.tph-it { flex-wrap: wrap; }
.tph-it small { font-weight: 400 !important; font-size: 11.5px !important; opacity: .8; flex-basis: 100%; padding-left: 30px; margin-top: -2px; }
.tph-it .cnt, .tph-it .badge { margin-left: auto; }
.tph-src-hidden { display: none !important; }
@media (max-width: 860px) {
  .tph-sl { display: block; }
  .tph-side { flex-direction: row; overflow-x: auto; overflow-y: hidden; max-height: none; min-height: 0; padding: 8px 12px; gap: 6px;
    border-right: 0; border-bottom: 1px solid #D6E4DA; scrollbar-width: thin; z-index: 20; }
  .tph-grp { display: contents; }
  .tph-grp[hidden] { display: none; }
  .tph-lbl { display: none; }
  .tph-it { width: auto; white-space: nowrap; flex: none; border: 1px solid #D6E4DA; border-radius: 999px; padding: 6px 12px; font-size: 13px; }
  .tph-it small { display: none; }
}
@media print { .tph-side { display: none !important; } .tph-sl { display: block; } }`;

  let layout = null, side = null, main = null;
  const groups = [];
  const KEEP = 'script, style, link, template, datalist, #print-area, .modal-overlay, .modal, .toast, #toast, [data-side-keep]';
  const keep = n => n.nodeType === 1 && (n.matches(KEEP) || getComputedStyle(n).position === 'fixed');
  const resolve = t => typeof t === 'function' ? t() : (t ? document.querySelector(t) : null);

  function ensureLayout(start) {
    if (layout) return;
    const st = document.createElement('style'); st.id = 'tph-side-css'; st.textContent = CSS; document.head.appendChild(st);
    layout = document.createElement('div'); layout.className = 'tph-sl';
    side = document.createElement('nav'); side.className = 'tph-side'; side.setAttribute('aria-label', 'หัวข้อ');
    main = document.createElement('div'); main.className = 'tph-main';
    start.parentNode.insertBefore(layout, start);
    layout.append(side, main);
    for (let n = layout.nextSibling; n;) { const nx = n.nextSibling; if (!keep(n)) main.appendChild(n); n = nx; }
    document.body.classList.add('tph-has-side');
    topOffset(); addEventListener('resize', topOffset);
  }
  // หัวหน้าที่ติดบนจอ (sticky/fixed top) อยู่เหนือแถบ → แถบซ้ายติดใต้หัวนั้น
  function topOffset() {
    let h = 0;
    for (let n = layout.previousElementSibling; n; n = n.previousElementSibling) {
      const cs = getComputedStyle(n);
      if ((cs.position === 'sticky' || cs.position === 'fixed') && parseFloat(cs.top) === 0 && cs.display !== 'none') h = Math.max(h, n.offsetHeight);
    }
    document.documentElement.style.setProperty('--tph-top', h + 'px');
  }

  const ACTIVE = /(^|\s)(active|on|selected|current)(\s|$)/;
  function mount(opts) {
    const src0 = resolve(opts.tabs);
    let start = resolve(opts.start);
    if (!start && src0) { start = src0; while (start.parentElement && start.parentElement !== document.body) start = start.parentElement; }
    if (!layout) { if (!start) return; ensureLayout(start); }
    const g = document.createElement('div'); g.className = 'tph-grp';
    if (opts.group) { const l = document.createElement('div'); l.className = 'tph-lbl'; l.textContent = opts.group; g.appendChild(l); }
    side.appendChild(g);
    const grp = { opts, g, src: null, items: [] };
    groups.push(grp);
    syncAll();
    return grp;
  }
  function build(grp, src) {
    grp.items.forEach(p => p.remove());
    grp.items = [];
    grp.src = src;
    if (!src) return;
    src.classList.add('tph-src-hidden');
    [...src.children].filter(e => e.matches('button, a')).forEach(o => {
      const p = document.createElement('button');
      p.type = 'button'; p.className = 'tph-it'; p._o = o;
      p.addEventListener('click', () => { p._o.click(); requestAnimationFrame(syncAll); });
      grp.g.appendChild(p); grp.items.push(p);
    });
  }
  function sync(grp) {
    const src = resolve(grp.opts.tabs);
    const btns = src ? [...src.children].filter(e => e.matches('button, a')) : [];
    if (src !== grp.src || btns.length !== grp.items.length || btns.some((b, i) => grp.items[i]._o !== b)) build(grp, src);
    else if (src && !src.classList.contains('tph-src-hidden')) src.classList.add('tph-src-hidden');
    grp.items.forEach(p => {
      const o = p._o;
      // สำเนาไม่เอา id (ไม่ให้ getElementById ของหน้าไปเจอปุ่มในแถบซ้ายแทนของเดิม)
      const cl = o.cloneNode(true);
      cl.querySelectorAll('[id]').forEach(e => e.removeAttribute('id'));
      const html = cl.innerHTML.replace(/<br\s*\/?>/gi, ' ');
      if (p._h !== html) { p.innerHTML = html; p._h = html; }
      const t = o.getAttribute('title') || '';
      if ((p.getAttribute('title') || '') !== t) t ? p.setAttribute('title', t) : p.removeAttribute('title');
      const on = ACTIVE.test(o.className) || o.getAttribute('aria-selected') === 'true';
      if (p.classList.contains('on') !== on) { p.classList.toggle('on', on); on ? p.setAttribute('aria-current', 'page') : p.removeAttribute('aria-current'); }
      const hid = o.hidden || getComputedStyle(o).display === 'none';
      if (p.hidden !== hid) p.hidden = hid;
      if (p.disabled !== !!o.disabled) p.disabled = !!o.disabled;
    });
    const show = grp.items.some(p => !p.hidden) && (!grp.opts.when || !!grp.opts.when());
    if (grp.g.hidden === show) grp.g.hidden = !show;
  }
  let raf = 0;
  function syncAll() {
    raf = 0; groups.forEach(sync);
    // ยังไม่มีหัวข้อให้แสดง (เช่น ยังไม่โหลดข้อมูล) → ไม่เว้นที่แถบซ้าย
    if (layout) { const empty = !groups.some(g => !g.g.hidden); if (layout.classList.contains('tph-empty') !== empty) { layout.classList.toggle('tph-empty', empty); topOffset(); } }
  }
  new MutationObserver(ms => {
    if (raf || ms.every(m => side && side.contains(m.target))) return;
    raf = requestAnimationFrame(syncAll);
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-selected', 'disabled', 'title'] });

  window.TphSideTabs = { mount, sync: syncAll };
})();
