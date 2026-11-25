// ส่วนประเมินของ daily_audit.py — รันฟังก์ชันจริงของ clinic.html (fcDbEmrDrugs, parseUsage, dbLeftoverDrug ...)
// ในเบราว์เซอร์ที่บล็อกทุก request ออกเน็ต แล้วคืนผลเป็น JSON
//   node daily_audit_eval.mjs <in.json> <out.json>
//   in  = { hn: { meds: /db/meds, order: /db/order } }
//   out = { hn: { picked, top, order: [{ key, chronic, insulin, perDay, qty, icode, form }], msg } }
// playwright มาจาก tests/node_modules (ชุดทดสอบของ repo) — ไม่ต้องติดตั้งเพิ่ม
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'tests', 'package.json'));
const { chromium } = require('playwright');

const [inFile, outFile] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext();
  await ctx.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem('tph_auth_v1', '1'); } catch (e) {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(path.join(ROOT, 'clinic.html')).href);
  await page.waitForFunction(() => typeof fcDbEmrDrugs === 'function' && typeof dbMedSources === 'function' && typeof tphHosxp === 'object', null, { timeout: 30000 });
  const res = await page.evaluate(async data => {
    const out = {};
    renderFloatClinic = () => {}; fcRenderEmrMsg = () => {};
    clinicWin = { closed: false, document };
    const keyOf = d => hxExactKey(dbDrugName(d)) || dbDrugName(d);
    for (const hn of Object.keys(data)) {
      const { meds, order } = data[hn];
      document.querySelectorAll('#lo-list .lo-row').forEach(r => r.remove());
      document.getElementById('f-hn').value = hn;
      fcDbEmrHn = ''; fcDbEmrOk = false; fcDbEmrFail = 0; fcDbEmrBusy = false; fcEmrMsg = '';
      tphHosxp.meds = async () => meds;
      await fcDbEmrDrugs(hn);
      const picked = [...document.querySelectorAll('#lo-list .lo-drug')].map(e => e.value);
      // แหล่งอ้างอิง (แหล่งล่าสุดที่มียาเรื้อรัง) — ใช้แยกยาที่ดึงมาจากแหล่งเก่า
      const { srcs, top } = dbMedSources(meds);
      // วันอ้างอิงของการตรวจ "ยาขาด" = visit ล่าสุด (ไม่นับยากลับบ้าน) ที่มียาเรื้อรัง — ยาที่ยากลับบ้านตัดทิ้งยังถูกตรวจ
      const ref = srcs.find(x => !x.dc && x.drugs.some(dbLeftoverDrug));
      // ตรวจ "ยาเกิน" เทียบกับรายการยาครบชุดล่าสุด (คลินิก/ยากลับบ้าน) + visit OPD หลังจากนั้น — OPD มีแค่ยาที่จ่ายวันนั้น
      //   ยาที่ไม่อยู่ใน OPD จึงไม่ได้แปลว่าหยุด
      const full = srcs.find(x => !x.opd && x.drugs.some(dbLeftoverDrug));
      const recent = full ? srcs.filter(x => x.sort >= full.sort).flatMap(x => x.drugs.map(keyOf)) : [];
      out[hn] = {
        picked,
        top: top ? top.drugs.map(keyOf) : [], topDate: ref ? ref.sort.slice(0, 10) : '',
        msg: fcEmrMsg.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        order: (order.drugs || []).map(d => {
          const name = dbDrugName(d);
          return { key: keyOf(d), name, icode: d.icode, form: d.form || '', qty: +d.qty || 0, usage: d.usage || '',
            chronic: dbLeftoverDrug(d), insulin: isInsulin(name), perDay: parseUsage(d.usage || '').perDay };
        }),
      };
      // เทียบชื่อด้วย drugMatches ของหน้าเว็บ (ต่างความแรง/ชื่อการค้า) — ฝั่ง Python ไม่ต้องรู้กติกาชื่อยา
      out[hn].pickedMatch = out[hn].order.map(o => picked.some(p => p === o.key || drugMatches(p, o.key)));
      out[hn].pickedInOrder = picked.map(p => out[hn].order.some(o => o.chronic && (p === o.key || drugMatches(p, o.key))));
      out[hn].pickedInTop = picked.map(p => recent.some(k => p === k || drugMatches(p, k)));
    }
    return out;
  }, data);
  fs.writeFileSync(outFile, JSON.stringify({ ok: true, errors, res }));
} catch (e) {
  fs.writeFileSync(outFile, JSON.stringify({ ok: false, error: String(e && e.message || e) }));
  process.exitCode = 1;
} finally {
  await browser.close();
}
