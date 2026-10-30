// F07 — ออกจากระบบแล้ว สิทธิ์แอดมินที่ปลดล็อกไว้ในแท็บเดิมต้องหายด้วย (หมดเวลา/กดออกเอง ให้ผลเหมือนกัน)
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { read, extractFn } from '../helpers.mjs';

function page(html = '<!doctype html><body></body>') {
  const vc = new VirtualConsole();   // jsdom ไม่รองรับ navigation (location.replace) — ไม่ต้องแสดง
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.test/clinic.html', virtualConsole: vc });
  return dom.window;
}

test('F07: logout (หมดเวลา/ปุ่มออก) ล้างสิทธิ์แอดมิน → ใช้ฟังก์ชันแอดมินต้องยืนยันใหม่', async () => {
  const w = page();
  w.localStorage.setItem('tph_auth_v1', '1');
  w.eval(read('lib/session-timeout.js'));
  w.eval(read('lib/admin-gate.js'));
  w.sessionStorage.setItem('tph_admin_unlock_v1', '1');   // เคยปลดล็อกแอดมินในแท็บนี้

  let ran = 0;
  await w.requireAdmin(() => ran++);
  assert.equal(ran, 1, 'ก่อน logout ใช้ได้ทันที');

  w.tphLogout();
  assert.equal(w.localStorage.getItem('tph_auth_v1'), null);
  assert.equal(w.sessionStorage.getItem('tph_admin_unlock_v1'), null);

  // login ใหม่ในแท็บเดิม แล้วเรียกฟังก์ชันแอดมิน → ต้องขึ้นหน้าต่างขอรหัส ไม่รันทันที
  w.localStorage.setItem('tph_auth_v1', '1');
  w.requireAdmin(() => ran++);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(ran, 1, 'หลัง logout ต้องยืนยันแอดมินใหม่');
});

test('F07: ใส่ PIN ผ่านในหน้าแรก = เริ่มสิทธิ์ใหม่ (ล้าง admin unlock ค้างจากคนก่อน)', async () => {
  const w = page('<!doctype html><body><div id="login-overlay"></div><input id="pin-input"><div id="pin-error"></div></body>');
  Object.defineProperty(w, 'crypto', { value: globalThis.crypto });   // jsdom ไม่มี crypto.subtle / TextEncoder
  w.TextEncoder = TextEncoder;
  w.sessionStorage.setItem('tph_admin_unlock_v1', '1');
  const src = read('index.html');
  const consts = src.match(/const PIN_HASH[\s\S]*?const LOCK_MS[^\n]*\n/)[0];
  // ทดสอบด้วย PIN สมมติ: แทน hash จริงด้วย hash ของ '0000' (ไม่ใช้/ไม่เปิดเผย PIN จริง)
  const fakeHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('0000')))].map(b => b.toString(16).padStart(2, '0')).join('');
  w.eval(consts.replace(/const PIN_HASH = '[0-9a-f]+'/, `const PIN_HASH = '${fakeHash}'`) +
    ['sha256', 'getFailState', 'setError', 'checkPin'].map(n => extractFn('index.html', n)).join('\n') + '; window.checkPin = checkPin;');
  w.document.getElementById('pin-input').value = '0000';
  await w.checkPin();
  assert.equal(w.localStorage.getItem('tph_auth_v1'), '1');
  assert.equal(w.sessionStorage.getItem('tph_admin_unlock_v1'), null);
});
