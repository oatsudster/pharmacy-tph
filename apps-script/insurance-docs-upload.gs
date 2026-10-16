/**
 * รับไฟล์เอกสารแนวทางเคลมจากหน้า insurance-audit.html แล้วเก็บลงโฟลเดอร์ Google Drive ของเรื่องนั้น
 * (+ ส่งแจ้งเตือน Telegram เมื่อมีคนกด "ไม่ถูกต้อง/ไม่แน่ใจ" — ถ้าตั้งค่า TELEGRAM_TOKEN และ TELEGRAM_CHAT_ID ไว้)
 *
 * ติดตั้ง (ครั้งเดียว ~5 นาที) ด้วยบัญชี Google ที่เป็นเจ้าของโฟลเดอร์ "เอกสารแนวทางเคลม":
 *   1. เปิด https://script.google.com → New project → ลบโค้ดเดิม วางไฟล์นี้ทั้งไฟล์ → ตั้งชื่อ "TPH insurance docs upload" → Save
 *   2. Deploy → New deployment → ⚙ Select type: Web app
 *        Execute as: Me   ·   Who has access: Anyone   → Deploy → Authorize access (อนุญาต Google Drive)
 *   3. คัดลอก "Web app URL" (ลงท้าย /exec) ส่งให้ Claude ตั้งค่าในหน้าเว็บ
 *   (ไม่บังคับ) Project Settings → Script properties: TELEGRAM_TOKEN = token ของบอต, TELEGRAM_CHAT_ID = id กลุ่ม
 *
 * ถ้าแก้โค้ดภายหลัง: Deploy → Manage deployments → ✎ → Version: New version → Deploy (URL เดิม)
 *
 * ติดตั้งแล้ว 16 ต.ค. 69: โปรเจกต์ "TPH insurance docs upload" (บัญชี oatsudster@gmail.com)
 *   Web app URL: https://script.google.com/macros/s/AKfycby2B61x1fFa-dnLGTp6-wfI-QIvkKCdLSWvgaC0QLMnZm_vgOsAbPPom1Cgl6RUpLvl/exec
 *   (ตั้งไว้ใน Firestore pharmacy_tph/insurance_audit_docs.config.upload_url)
 */
const ROOT_FOLDER_ID = '1uEP8MvtPHtjNlQgjH8ks1RWpJqGedV9P'; // เอกสารแนวทางเคลม (อัปโหลดที่นี่)
const TOKEN = 'l8414Q4jaSghbJsM5_xvFMkh';                  // ต้องตรงกับ insurance_audit_docs.config.token ใน Firestore
const SHARE_WITH_LINK = true; // ให้ทีมที่ไม่มีบัญชี Google เปิดดูไฟล์จากหน้าเว็บได้ (เฉพาะคนที่มีลิงก์) — ห้ามอัปโหลดข้อมูลผู้ป่วย
const MAX_BYTES = 20 * 1024 * 1024;

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.token !== TOKEN) return out({ ok: false, error: 'token ไม่ถูกต้อง' });
    if (d.action === 'upload') return upload(d);
    if (d.action === 'notify') return notify(d);
    return out({ ok: false, error: 'ไม่รู้จัก action' });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

function doGet() {
  return out({ ok: true, service: 'TPH insurance docs upload' });
}

function upload(d) {
  const folder = DriveApp.getFolderById(d.folderId);
  if (d.folderId !== ROOT_FOLDER_ID) { // รับเฉพาะโฟลเดอร์ย่อยของ ROOT
    let ok = false;
    const ps = folder.getParents();
    while (ps.hasNext()) if (ps.next().getId() === ROOT_FOLDER_ID) ok = true;
    if (!ok) return out({ ok: false, error: 'โฟลเดอร์ไม่อยู่ในเอกสารแนวทางเคลม' });
  }
  const bytes = Utilities.base64Decode(d.data);
  if (bytes.length > MAX_BYTES) return out({ ok: false, error: 'ไฟล์ใหญ่เกิน 20 MB' });
  const name = String(d.name || 'เอกสาร').replace(/[\\/:*?"<>|]/g, '_').slice(0, 180);
  const f = folder.createFile(Utilities.newBlob(bytes, d.mime || 'application/octet-stream', name));
  f.setDescription('อัปโหลดโดย ' + (d.by || '-') + ' ผ่าน insurance-audit.html' + (d.note ? ' · ' + d.note : ''));
  if (SHARE_WITH_LINK) f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return out({ ok: true, id: f.getId(), url: f.getUrl(), name: f.getName(), size: f.getSize() });
}

function notify(d) {
  const p = PropertiesService.getScriptProperties();
  const tok = p.getProperty('TELEGRAM_TOKEN'), chat = p.getProperty('TELEGRAM_CHAT_ID');
  if (!tok || !chat) return out({ ok: false, error: 'ยังไม่ได้ตั้งค่า Telegram' });
  UrlFetchApp.fetch('https://api.telegram.org/bot' + tok + '/sendMessage', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ chat_id: chat, text: String(d.text || '').slice(0, 3500), disable_web_page_preview: true }),
  });
  return out({ ok: true });
}

// รันฟังก์ชันนี้ครั้งแรกในตัวแก้ไข เพื่ออนุญาตสิทธิ์ Drive / UrlFetch
function authorize() {
  DriveApp.getFolderById(ROOT_FOLDER_ID).getName();
  UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
