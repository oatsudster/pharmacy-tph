// ตัวช่วยทดสอบ: โหลด lib/*.js หรือดึงฟังก์ชันจากหน้า HTML มารันใน vm พร้อมนาฬิกาจำลอง
// ข้อมูลทดสอบทั้งหมดเป็นข้อมูลสมมติ (HN 9999xxx, ชื่อ "ทดสอบ") — ห้ามใส่ข้อมูลผู้ป่วยจริง
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// TPH_TEST_ROOT = รันชุดทดสอบเดียวกันกับโค้ดอีกชุด (เช่น worktree ของ commit ก่อนแก้ เพื่อยืนยันว่าเทสต์จับบั๊กได้จริง)
export const ROOT = process.env.TPH_TEST_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// Date ที่ "ตอนนี้" ตายตัว (new Date() / Date.now()) — ส่วนอื่นทำงานเหมือน Date จริง
export function fixedDate(iso) {
  const T = new Date(iso).getTime();
  class FixedDate extends Date {
    constructor(...a) { super(...(a.length ? a : [T])); }
    static now() { return T; }
  }
  return FixedDate;
}

// สร้าง context ที่มี window = globalThis ของ vm แล้วรันไฟล์ lib ตามลำดับ
export function makeContext(extra = {}) {
  const ctx = vm.createContext(Object.assign({ console, Intl, setTimeout, clearTimeout, setInterval: () => 0 }, extra));
  ctx.window = ctx;
  return ctx;
}
export function loadLib(ctx, ...files) { files.forEach(f => vm.runInContext(read(f), ctx, { filename: f })); return ctx; }

// ดึงซอร์สของ function ชื่อ name จากไฟล์ HTML (นับวงเล็บปีกกา) — ทดสอบโค้ดในหน้าจริง ไม่ใช่สำเนา
export function extractFn(file, name) {
  const src = read(file);
  const m = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(src);
  if (!m) throw new Error(`ไม่พบ function ${name} ใน ${file}`);
  let i = src.indexOf('{', m.index), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(m.index, i + 1);
}
