// ธีมกลาง + แก้จากรายงานตรวจ UI (2026-11-03): ทุกหน้าโหลด lib/theme.css + lib/tph-ui.js, ปีงบ ME คำนวณจากวันที่,
// สถานะซิงค์ ME/DM ไม่อ้างว่าซิงค์แล้วเมื่อเป็นข้อมูลจาก cache, คีย์บอร์ดใช้การ์ด/เมนูที่เป็น div ได้, contrast ปุ่มทอง
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT } from '../helpers.mjs';

let browser;
test.before(async () => { browser = await chromium.launch(); });
test.after(async () => { await browser.close(); });

async function open(file, viewport = { width: 1366, height: 800 }, now) {
  const ctx = await browser.newContext({ viewport });
  await ctx.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await ctx.addInitScript(t => {
    try { localStorage.setItem('tph_auth_v1', '1'); } catch (e) {}
    if (t) { const T = new Date(t).getTime(), D = Date; window.Date = class extends D { constructor(...a) { super(...(a.length ? a : [T])); } static now() { return T; } }; }
  }, now || null);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(path.join(ROOT, file)).href);
  return { ctx, page, errors };
}

test('ทุกหน้าโหลดธีมกลางและตัวช่วยคีย์บอร์ด', () => {
  const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
  assert.ok(pages.length >= 15);
  for (const f of pages) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.match(s, /<link rel="stylesheet" href="lib\/theme\.css">\s*<\/head>/, f);
    assert.match(s, /<script src="lib\/tph-ui\.js"><\/script>/, f);
  }
});

test('ME: ปีงบประมาณคำนวณจากวันที่ (พ.ย. 2569 = 2570, ก.ย. 2570 = 2570)', async () => {
  for (const [now, fy] of [['2026-11-03T09:00:00+07:00', '2570'], ['2027-09-30T09:00:00+07:00', '2570'], ['2027-10-01T09:00:00+07:00', '2571']]) {
    const { ctx, page, errors } = await open('ME_Dashboard.html', undefined, now);
    await page.waitForFunction(f => document.getElementById('topbar-fy').textContent.includes(f), fy);
    assert.equal(await page.textContent('#nav-year'), fy);
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});

test('ME + DM: ต่อ server ไม่ได้ → ไม่ขึ้น "ซิงค์แล้ว" / "Realtime"', async () => {
  const me = await open('ME_Dashboard.html');
  await me.page.waitForFunction(() => document.getElementById('fb-sync-badge'), null, { timeout: 25000 }).catch(() => {});
  await me.page.waitForTimeout(12000);
  const meTxt = await me.page.evaluate(() => (document.getElementById('fb-sync-badge') || {}).textContent || '');
  assert.doesNotMatch(meTxt, /ซิงค์แล้ว/);
  await me.ctx.close();
  const dm = await open('dm-remission.html');
  await dm.page.waitForTimeout(12000);
  assert.doesNotMatch(await dm.page.textContent('#sync-status-btn'), /Realtime/);
  await dm.ctx.close();
});

test('คีย์บอร์ด: การ์ด OPD ใน ME กด Enter เข้าแผนก · การ์ดกรองสถานะ expiry และหัวตารางกด Tab เข้าได้ · ยาเหลือสะสม clinic กด Space ติ๊ก', async () => {
  const me = await open('ME_Dashboard.html');
  await me.page.waitForSelector('.landing-card[tabindex="0"][role="button"]');
  await me.page.focus('.landing-card');
  await me.page.keyboard.press('Enter');
  await me.page.waitForFunction(() => document.getElementById('section-opd').classList.contains('active'));
  assert.equal(await me.page.getAttribute('#nav-ipd', 'tabindex'), '0');
  assert.deepEqual(me.errors, []);
  await me.ctx.close();

  const ex = await open('expiry-tracker.html');
  await ex.page.waitForSelector('.kpi-card[tabindex="0"]');
  assert.equal(await ex.page.getAttribute('th[onclick]', 'tabindex'), '0');
  await ex.ctx.close();

  const cl = await open('clinic.html');
  await cl.page.focus('#drp-quick-label');
  await cl.page.keyboard.press(' ');
  assert.equal(await cl.page.getAttribute('#drp-quick-label', 'aria-checked'), 'true');
  assert.equal(await cl.page.textContent('#drp-quick-icon'), '☑');
  assert.deepEqual(cl.errors, []);
  await cl.ctx.close();
});

test('contrast: ปุ่มทองใช้ตัวเขียวเข้ม · หัวกลุ่มแถบซ้ายไม่จางเกิน', async () => {
  const { ctx, page } = await open('rx-sticker.html');
  assert.equal(await page.evaluate(() => { const b = document.createElement('button'); b.className = 'btn btn-gold'; document.body.appendChild(b); return getComputedStyle(b).color; }), 'rgb(13, 51, 32)');
  await ctx.close();
  const c = await open('clinic.html');
  const col = await c.page.evaluate(() => getComputedStyle(document.querySelector('.tph-lbl')).color);
  const a = +((col.match(/rgba\([^)]*,\s*([\d.]+)\)/) || [])[1] || 1);
  assert.ok(a >= 0.6, col);
  await c.ctx.close();
});

test('หน้าหลัก: ปุ่ม "เปิดระบบ" เขียวสีเดียวทุกการ์ด · หัวขาว · การ์ด 4 ใบต่อแถวบนจอคอม', async () => {
  const { ctx, page, errors } = await open('index.html');
  const r = await page.evaluate(() => ({
    btn: [...new Set([...document.querySelectorAll('.open-btn')].map(b => getComputedStyle(b).backgroundColor))],
    hd: getComputedStyle(document.querySelector('.header')).backgroundColor,
    cols: getComputedStyle([...document.querySelectorAll('.cards-grid')].find(g => g.offsetWidth)).gridTemplateColumns.split(' ').length,   // กลุ่มรายการโปรดที่ว่างซ่อนอยู่
    n: document.querySelectorAll('.open-btn').length,
  }));
  assert.deepEqual(r.btn, ['rgb(26, 94, 56)']); assert.ok(r.n >= 10);
  assert.equal(r.hd, 'rgb(255, 255, 255)'); assert.equal(r.cols, 4);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('คลินิก: แถบ ล้างฟอร์ม/บันทึก ติดท้ายจอระหว่างเลื่อนฟอร์ม · หัวข้อมีเลข 1-3 · ปุ่มล้างฟอร์มยังทำงาน', async () => {
  const { ctx, page, errors } = await open('clinic.html', { width: 1408, height: 614 });
  await page.waitForSelector('.cl-savebar .btn-submit');
  const nums = await page.$$eval('.entry-col > .form-title, .lo-section-wrap > .form-title', a => a.map(e => getComputedStyle(e, '::before').content));
  assert.deepEqual(nums, Array(3).fill('counter(clsec)'));   // 3 หัวข้อมีเลขลำดับ (ภาพจริงขึ้น 1 2 3)
  // เลื่อนไปกลางฟอร์ม: ปุ่มบันทึกอยู่ในจอ (ติดล่าง)
  await page.evaluate(() => scrollTo(0, 300));
  const b = await page.evaluate(() => { const r = document.querySelector('.cl-savebar .btn-submit').getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
  assert.ok(b.bottom <= 614 && b.top > 450, JSON.stringify(b));
  await page.fill('#f-hn', '9999001');
  await page.click('.cl-savebar .btn-clear');
  await page.waitForFunction(() => document.getElementById('f-hn').value === '');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('ไอคอนเส้นแทน emoji ในแถบซ้าย/หัว/เมนู/การ์ดหน้าหลัก · ข้อความปุ่มคงเดิม · ปุ่มที่สคริปต์เปลี่ยนข้อความได้ไอคอนใหม่', async () => {
  const lead = /^\s*\p{Extended_Pictographic}/u;
  const c = await open('clinic.html');
  await c.page.waitForSelector('.tph-side .tph-it .tph-ic');
  const r = await c.page.evaluate(re => ({
    side: [...document.querySelectorAll('.tph-side .tph-it')].filter(e => !e.hidden).map(e => [!!e.querySelector('.tph-ic'), new RegExp(re, 'u').test(e.textContent)]),
    home: document.querySelector('.tph-hd-home').innerHTML.includes('tph-ic'),
    menuTxt: [...document.querySelectorAll('.tph-hd-menu .tph-hd-mi')].map(e => e.textContent.trim()),
  }), lead.source);
  assert.ok(r.side.length >= 5 && r.side.every(([ic, emo]) => ic && !emo), JSON.stringify(r.side));
  assert.equal(r.home, true);
  assert.ok(r.menuTxt.includes('Export รายงาน') && r.menuTxt.includes('ทะเบียนผู้ป่วย'), r.menuTxt.join('|'));
  await c.ctx.close();
  // ปุ่ม "ลงข้อมูลเอง" (ADR) สคริปต์เปลี่ยนข้อความ → ไอคอนกลับมาเอง ไม่มี emoji ค้าง
  const a = await open('adr.html');
  await a.page.evaluate(() => { const b = document.querySelector('.hx-manual-toggle'); b.textContent = '⚙️ ทดสอบเปลี่ยนข้อความ'; });
  await a.page.waitForFunction(() => { const b = document.querySelector('.hx-manual-toggle'); return b.querySelector('.tph-ic') && !/⚙/.test(b.textContent); });
  assert.deepEqual(a.errors, []);
  await a.ctx.close();
  const i = await open('index.html');
  await i.page.waitForSelector('.card-icon .tph-ic');
  assert.equal(await i.page.evaluate(() => [...document.querySelectorAll('.card-icon')].every(e => e.querySelector('.tph-ic'))), true);
  await i.ctx.close();
});

test('ยังไม่มีข้อมูล: HA และตรวจสอบที่มาตัวเลขแสดงกล่องอธิบายแทนการ์ด "—" · expiry สถานะเป็นป้าย ไม่ทาสีทั้งแถว', async () => {
  const h = await open('pharmacy-ha.html');
  await h.page.waitForFunction(() => !document.getElementById('ha-empty').hidden, null, { timeout: 25000 });
  assert.equal(await h.page.evaluate(() => [...document.querySelectorAll('.view')].every(v => getComputedStyle(v).display === 'none')), true);
  assert.deepEqual(h.errors, []);
  await h.ctx.close();
  const a = await open('insurance-audit.html');
  await a.page.waitForFunction(() => !document.getElementById('audit-empty').hidden, null, { timeout: 25000 });
  assert.equal(await a.page.isVisible('#tab-metrics .progress'), false);
  await a.ctx.close();
  const e = await open('expiry-tracker.html');
  await e.page.waitForSelector('#tbody tr.multi-lot');
  const r = await e.page.evaluate(() => ({
    lotBg: getComputedStyle(document.querySelector('#tbody tr.multi-lot:nth-child(odd) td:nth-child(2)')).backgroundColor,
    pill: getComputedStyle(document.querySelector('#tbody .status-cell')).backgroundColor,
    days: getComputedStyle(document.querySelector('#tbody .days-cell:not(.expired)')).color,
  }));
  assert.equal(r.lotBg, 'rgba(0, 0, 0, 0)');
  assert.notEqual(r.pill, 'rgba(0, 0, 0, 0)');
  assert.notEqual(r.days, 'rgb(21, 128, 61)');
  assert.deepEqual(e.errors, []);
  await e.ctx.close();
});

test('วันที่ พ.ศ.: ยาเวรบ่าย-ดึก ช่อง "เช้าวันที่" เป็น วว/ดด/ปปปป พ.ศ. · ยาใกล้หมดอายุ แสดง/รับ พ.ศ. (ปี ค.ศ. ก็ยังรับ)', async () => {
  const n = await open('night-meds.html', undefined, '2026-11-03T09:00:00+07:00');
  await n.page.waitForSelector('#f-date-be');
  assert.equal(await n.page.inputValue('#f-date-be'), '03/11/2569');
  await n.page.fill('#f-date-be', '1/11/69'); await n.page.dispatchEvent('#f-date-be', 'change');
  assert.equal(await n.page.evaluate(() => document.getElementById('f-date').value), '2026-11-01');
  assert.deepEqual(n.errors, []);
  await n.ctx.close();
  const e = await open('expiry-tracker.html');
  await e.page.waitForSelector('#tbody .edit-exp');
  const v = await e.page.evaluate(() => [...document.querySelectorAll('#tbody .edit-exp')].map(i => i.value).filter(Boolean).slice(0, 5));
  assert.ok(v.length && v.every(x => /^\d{2}\/\d{2}\/25\d\d$/.test(x)), v.join(','));
  assert.deepEqual(await e.page.evaluate(() => [thFullToISO('17/07/2569'), thFullToISO('17/07/2026'), thFullToISO('17/07/69'), thFullToISO('31/02/2569')]),
    ['2026-07-17', '2026-07-17', '2026-07-17', null]);
  assert.deepEqual(e.errors, []);
  await e.ctx.close();
});

test('ภาพ img/ui ที่หน้าเว็บอ้างถึงมีไฟล์จริง ขนาดไม่เกิน 150 KB และทุกหน้ามี favicon', () => {
  const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.html')).concat(['lib/hosxp-db.js']);
  const refs = new Set();
  for (const f of files) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of s.matchAll(/img\/ui\/([\w-]+\.png)/g)) refs.add(m[1]);
    if (f.endsWith('.html')) assert.match(s, /<link rel="icon"[^>]+img\/ui\/favicon-32\.png/, f);
  }
  assert.ok(refs.size >= 12, [...refs].join(','));
  for (const r of refs) {
    const p = path.join(ROOT, 'img/ui', r);
    assert.ok(fs.existsSync(p), r);
    assert.ok(fs.statSync(p).size < 150 * 1024, r + ' ใหญ่เกิน');
  }
});

// ── เก็บรายละเอียด UI จอเตี้ย (2026-11-04) ──
test('หน้าหลัก 1408×614: เห็นชื่อระบบและปุ่ม "เปิดระบบ" ของการ์ดแถวแรกโดยไม่ต้องเลื่อน · หมายเหตุที่มาข้อมูลกดเปิดได้', async () => {
  const { ctx, page, errors } = await open('index.html', { width: 1408, height: 614 });
  await page.waitForSelector('.home-group .app-card');
  const r = await page.evaluate(() => [...[...document.querySelectorAll('.home-group')].find(g => !g.hidden && g.querySelector('.app-card')).querySelectorAll('.app-card')].slice(0, 4).map(c => {
    const h = c.querySelector('h2').getBoundingClientRect(), b = c.querySelector('.open-btn').getBoundingClientRect();
    return { h2: h.top, btn: b.bottom, fs: parseFloat(getComputedStyle(c.querySelector('.card-desc')).fontSize) };
  }));
  assert.equal(r.length, 4);
  for (const c of r) { assert.ok(c.h2 > 0 && c.btn <= 614, JSON.stringify(c)); assert.ok(c.fs >= 13, 'ข้อความคำอธิบายไม่เล็กเกิน'); }
  assert.equal(await page.isVisible('.data-note > div'), false);
  await page.click('.data-note summary');
  assert.equal(await page.isVisible('.data-note > div'), true);
  await page.fill('#suite-search', 'สติกเกอร์');            // ค้นหายังเจอแม้ป้าย chip ถูกซ่อน
  assert.match(await page.textContent('#suite-search-status'), /^พบ [1-9]/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('ประกัน: สรุปสั้นๆ กับประมาณการอยู่แถวเดียวกัน (2:1) บนจอคอม · มือถือคอลัมน์เดียว ไม่ล้นจอ · ระบุปีที่มา', async () => {
  const d = await open('insurance.html', { width: 1366, height: 800 });
  await d.page.waitForSelector('.ov-top .hero-main');
  const [s, h] = await d.page.evaluate(() => ['#sum', '.ov-top .hero-main'].map(q => document.querySelector(q).getBoundingClientRect()).map(r => ({ x: r.left, y: r.top, w: r.width })));
  assert.equal(Math.round(s.y), Math.round(h.y));
  assert.ok(h.x > s.x && s.w > h.w * 1.6, JSON.stringify([s, h]));
  assert.match(await d.page.textContent('.hero-src'), /ปีงบ 2569/);
  assert.equal(await d.page.isVisible('#src-cards'), false);   // ไม่มีข้อมูล = ไม่มีการ์ดว่าง
  await d.page.click('.hero-more');
  assert.equal(await d.page.evaluate(() => document.querySelector('.view[data-view="opp"]').classList.contains('on')), true);
  assert.deepEqual(d.errors, []);
  await d.ctx.close();
  const m = await open('insurance.html', { width: 390, height: 844 });
  await m.page.waitForSelector('.ov-top .hero-main');
  const [ms, mh] = await m.page.evaluate(() => ['#sum', '.ov-top .hero-main'].map(q => document.querySelector(q).getBoundingClientRect().top));
  assert.ok(mh > ms);
  assert.ok(await m.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await m.ctx.close();
});

test('คลินิก: ปุ่มผู้ช่วย AI ห่างแถบบันทึก ≥ 16px · เลื่อนหา/โฟกัสช่องไหนก็ไม่ถูกแถบบันทึกหรือปุ่มผู้ช่วยบัง', async () => {
  for (const vp of [{ width: 1408, height: 614 }, { width: 390, height: 844 }]) {
    const { ctx, page, errors } = await open('clinic.html', vp);
    await page.waitForSelector('#aiw-fab');
    for (let i = 0; i < 4; i++) await page.evaluate(() => addLoRow());
    for (let i = 0; i < 2; i++) await page.evaluate(() => addDrpRow());
    const res = await page.evaluate(async () => {
      const bad = [];
      for (const e of document.querySelectorAll('.entry-col input:not([type=hidden]), .entry-col select, .entry-col textarea, .entry-col button')) {
        if (!e.offsetParent || e.closest('.cl-savebar')) continue;
        e.focus(); e.scrollIntoView({ block: 'nearest' });
        await new Promise(r => requestAnimationFrame(r));
        const r = e.getBoundingClientRect(); if (!r.width) continue;
        for (const x of [r.left + 4, r.left + r.width / 2, r.right - 4]) {
          const t = document.elementFromPoint(x, r.top + r.height / 2);
          if (t && t !== e && !e.contains(t) && !t.contains(e) && (t.closest('.cl-savebar') || t.closest('#aiw-fab'))) { bad.push(e.id || e.className); break; }
        }
      }
      // แถบบันทึกติดท้ายจอ → ระยะห่างจากปุ่มผู้ช่วย
      document.querySelector('.cl-savebar').scrollIntoView({ block: 'end' });
      await new Promise(r => requestAnimationFrame(r));
      const f = document.getElementById('aiw-fab').getBoundingClientRect();
      const btns = [...document.querySelectorAll('.cl-savebar button')].map(b => b.getBoundingClientRect());
      const gap = Math.min(...btns.map(b => Math.max(f.left - b.right, b.left - f.right, f.top - b.bottom, b.top - f.bottom)));
      return { bad, gap };
    });
    assert.deepEqual(res.bad, [], JSON.stringify(vp));
    assert.ok(res.gap >= 16, `${vp.width}: ปุ่มผู้ช่วยห่างปุ่มบันทึก ${res.gap}px`);
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});

test('ME หน้าแรก 1408×614: การ์ด OPD/IPD/ER เห็นครบทั้งใบ · hover ไม่ขยับการ์ด · มือถือการ์ดกดง่าย', async () => {
  const { ctx, page } = await open('ME_Dashboard.html', { width: 1408, height: 614 });
  await page.waitForSelector('.landing-card');
  const r = await page.evaluate(() => [...document.querySelectorAll('.landing-card')].map(c => c.getBoundingClientRect()).map(x => [x.top, x.bottom]));
  assert.equal(r.length, 3);
  for (const [t, b] of r) assert.ok(t > 56 && b <= 614, JSON.stringify(r));
  await page.hover('.landing-card');
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.landing-card')).transform), 'none');
  await ctx.close();
  const m = await open('ME_Dashboard.html', { width: 390, height: 844 });
  await m.page.waitForSelector('.landing-card');
  const hs = await m.page.evaluate(() => [...document.querySelectorAll('.landing-card')].map(c => c.getBoundingClientRect().height));
  for (const h of hs) assert.ok(h >= 100 && h <= 220, String(h));
  await m.ctx.close();
});

test('ปุ่มคำสั่งหลักในเนื้อหาใช้ไอคอนเส้นชุดเดียว 18px (ล้างฟอร์ม/บันทึก/วันนี้ ในคลินิก) · ปุ่ม ✕ รายแถวคง emoji', async () => {
  const { ctx, page } = await open('clinic.html');
  await page.waitForSelector('.cl-savebar .btn-submit .tph-ic');
  const r = await page.evaluate(() => ({
    sub: document.querySelector('.cl-savebar .btn-submit').textContent.trim(),
    clr: !!document.querySelector('.cl-savebar .btn-clear .tph-ic[data-ic="trash-2"]'),
    w: document.querySelector('.cl-savebar .btn-submit .tph-ic').getBoundingClientRect().width,
  }));
  assert.equal(r.sub, 'บันทึกการให้คำปรึกษา');
  assert.ok(r.clr);
  assert.ok(r.w >= 17 && r.w <= 20, String(r.w));
  await page.evaluate(() => addLoRow());
  assert.match(await page.textContent('#lo-list .btn-rm'), /✕/);
  await ctx.close();
});
