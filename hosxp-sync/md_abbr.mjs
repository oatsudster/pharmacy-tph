// ชื่อยา + วิธีใช้ย่อ + หน่วย แบบใบสรุปรายการยา OPD / ยากลับบ้าน (rx-sticker.html hmeDrug + mdAbbr + hmeUnit)
// รันโค้ดจริงจาก rx-sticker.html ช่วง // @shared-md-begin … end และ // @shared-hme-begin … end — ไม่เขียนกติกาซ้ำ
//   node md_abbr.mjs < in.json > out.json
//   in  = [{ icode, name, strength, namePrint, usage, units, form }]
//   out = [{ name, use, unit, skip }]   skip = แอลกอฮอล์ (ใบสรุปไม่นับเป็นรายการยา)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'rx-sticker.html'), 'utf8');
const region = (tag) => {
  const a = html.indexOf(`// @shared-${tag}-begin`), b = html.indexOf(`// @shared-${tag}-end`);
  if (a < 0 || b < a) throw new Error(`rx-sticker.html ไม่มี @shared-${tag}`);
  return html.slice(a, b);
};
const ctx = vm.createContext({});
vm.runInContext(region('md') + '\n' + region('hme') +
  '\n;globalThis.__f = { hmeDrug, hmeUnit, HME_SKIP };', ctx);
const { hmeDrug, hmeUnit, HME_SKIP } = ctx.__f;

const items = JSON.parse(fs.readFileSync(0, 'utf8') || '[]');
const out = items.map((d) => {
  try {
    const r = hmeDrug({ icode: d.icode, name: d.name, strength: d.strength, namePrint: d.namePrint, line1: d.usage });
    return { name: r.name, use: r.use, unit: hmeUnit(d.units, d), skip: HME_SKIP.test(d.name || '') };
  } catch (e) {
    return { name: '', use: '', unit: '', skip: false, error: String(e && e.message || e) };
  }
});
process.stdout.write(JSON.stringify(out));
