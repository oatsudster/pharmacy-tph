"""ค้นประวัติยาเดิม + วันนัด นอกเวลา ผ่านบอท Telegram (TPH RxBot) — ผู้ใช้ขอ 2026-11-27

ห้องยาปิด 20:00 น. แต่ รพ.อื่นในกลุ่มไลน์เภสัชนครศรีฯ ขอประวัติยาเดิมได้ทั้งคืน
  เภสัช (มือถือ) → /med <HN | เลขบัตร 13 หลัก | ชื่อ สกุล> ในแชทส่วนตัวกับบอท (TASKS_CHAT_ID เท่านั้น)
  → Worker เก็บคำขอไว้ในคิว (Durable Object) → สคริปต์นี้บนเครื่องใน รพ. ถามคิวทุก 4 วินาที (ออกไปหาเอง ไม่เปิดพอร์ต)
  → ค้น HOSxP (read-only) → ส่งข้อความผลกลับ → Worker ตอบในแชท (ลบข้อความผลเองหลัง 1 ชม.)

ยาเดิม = กฎเดียวกับ MR ใน rx-sticker (/db/mrmeds) นับถึงวันนี้: visit ล่าสุดที่มียาของแต่ละคลินิกนัด (ทุกคลินิก)
  ใน 1 ปี + ยากลับบ้าน (HMe) ของการนอน รพ. ครั้งล่าสุด + visit OPD ทั่วไปที่ใหม่กว่า visit คลินิกล่าสุด (แบบ /db/meds)
วันนัด = oapp ที่ยังไม่ถึง (ไม่นับยกเลิก) แบบ DbAppts ใน bridge

  pythonw med_remote.py           # Task Scheduler ตอน logon + ทุก 5 นาที (ตัวที่รันอยู่แล้วกันซ้ำด้วยพอร์ต 127.0.0.1:8791)
  python med_remote.py --once "4700684"   # ทดสอบค้นในเครื่อง พิมพ์ผล ไม่ส่งไปไหน
ตั้งค่า: ใช้ %LOCALAPPDATA%\\HOSxPBridge\\audit-report.json เดิม ({ "url": ".../pc-report", "key": ... })
log: %LOCALAPPDATA%\\HOSxPBridge\\med-remote.log (ใครค้นอะไร เมื่อไร — มีแค่คำค้น/HN ไม่มีรายการยา)
"""
import argparse
import datetime as dt
import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hosxp_monthly_sync as hx  # noqa: E402

HOME = hx.HOME
CONFIG_FILE = os.path.join(HOME, 'audit-report.json')
hx.LOG_FILE = os.path.join(HOME, 'med-remote.log')
log = hx.log
LOCK_PORT = 8791
POLL_SEC = 4
NODE = 'node'   # main() ใช้ "node" ใน audit-report.json ถ้ามี
TH_MONTH = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
PREFIX_RE = re.compile(r'^(นาย|นางสาว|น\.ส\.|นส\.?|นาง|ด\.ช\.|ด\.ญ\.|เด็กชาย|เด็กหญิง|ดช\.?|ดญ\.?|Mr\.?|Mrs\.?|Miss|Ms\.?)\s*', re.I)

# เหมือน $DRUG_COLS / $DRUG_JOIN ใน hosxp-bridge.ps1 — วิธีใช้ที่แก้ใน HOSxP ก่อน แล้ว sp_use แล้วรหัสวิธีใช้ปกติ
DRUG_COLS = ("d.icode, d.name, d.strength, d.units, d.dosageform, TRIM(IFNULL(d.name_print,'')) AS name_print, r.qty, r.item_no, "
             "TRIM(IF(od.usage_lock='Y', CONCAT_WS(' ', od.usage_line1, od.usage_line2, od.usage_line3), "
             "IF(r.sp_use IS NOT NULL AND r.sp_use<>'', CONCAT_WS(' ', s.name1, s.name2, s.name3), "
             "CONCAT_WS(' ', u.name1, u.name2, u.name3)))) AS usage_text")
DRUG_JOIN = ("FROM opitemrece r JOIN drugitems d ON d.icode=r.icode "
             "LEFT JOIN drugusage u ON u.drugusage=r.drugusage LEFT JOIN sp_use s ON s.sp_use=r.sp_use "
             "LEFT JOIN opi_dispense od ON od.hos_guid=r.hos_guid")


def th_date(v):
    if not v:
        return '-'
    if isinstance(v, str):
        v = dt.date.fromisoformat(v[:10])
    return f'{v.day} {TH_MONTH[v.month]} {(v.year + 543) % 100:02d}'


def clean(v):
    return re.sub(r'\s+', ' ', hx.s(v)).strip()


def qty_str(v):
    try:
        f = float(v)
        return str(int(f)) if f == int(f) else f'{f:g}'
    except (TypeError, ValueError):
        return clean(v)


# ── ค้นผู้ป่วย ──────────────────────────────────────────────────────────────────────
def find_patients(db, text):
    t = text.strip()
    digits = re.sub(r'[\s-]', '', t)
    if re.fullmatch(r'\d{13}', digits):
        return hx.q(db, 'SELECT hn, pname, fname, lname, birthday FROM patient WHERE cid=%s LIMIT 5', (digits,)), 'เลขบัตร'
    if re.fullmatch(r'\d{1,9}', digits):
        return hx.q(db, 'SELECT hn, pname, fname, lname, birthday FROM patient WHERE hn IN (%s,%s) LIMIT 5',
                    (digits, digits.zfill(7))), 'HN'
    name = PREFIX_RE.sub('', t)
    parts = name.split()
    if not parts or len(parts[0]) < 2:
        return [], 'ชื่อ'
    if len(parts) == 1:
        rows = hx.q(db, 'SELECT hn, pname, fname, lname, birthday FROM patient WHERE fname LIKE %s OR lname LIKE %s '
                        'ORDER BY fname, lname LIMIT 16', (parts[0] + '%', parts[0] + '%'))
    else:
        rows = hx.q(db, 'SELECT hn, pname, fname, lname, birthday FROM patient WHERE fname LIKE %s AND lname LIKE %s '
                        'ORDER BY fname, lname LIMIT 16', (parts[0] + '%', ' '.join(parts[1:]) + '%'))
    return rows, 'ชื่อ'


def age_of(b):
    if not b:
        return ''
    if isinstance(b, str):
        try:
            b = dt.date.fromisoformat(b[:10])
        except ValueError:
            return ''
    t = dt.date.today()
    return str(t.year - b.year - ((t.month, t.day) < (b.month, b.day)))


def full_name(p):
    return clean(f"{hx.s(p.get('pname'))}{hx.s(p.get('fname'))} {hx.s(p.get('lname'))}")


# ── ยาเดิม (กฎเดียวกับ DbMrMeds นับถึงวันนี้) ─────────────────────────────────────────
def old_meds(db, hn):
    groups = []   # (หัวข้อ, วันที่, [rows])
    vis = hx.q(db, "SELECT a.clinic, c.name AS clinic_name, o.vn, o.vstdate FROM oapp a JOIN clinic c ON c.clinic=a.clinic "
                   "JOIN ovst o ON o.vn=a.visit_vn OR o.vn=a.vn OR ((a.visit_vn IS NULL OR a.visit_vn='') AND o.hn=a.hn AND o.vstdate=a.nextdate) "
                   "WHERE a.hn=%s AND o.hn=%s AND o.vstdate>=CURDATE()-INTERVAL 365 DAY AND o.vstdate<=CURDATE() "
                   "ORDER BY o.vstdate DESC, o.vn DESC LIMIT 40", (hn, hn))
    used = set()
    latest_clinic = None
    if vis:
        vns = list(dict.fromkeys(v['vn'] for v in vis))
        ph = ','.join(['%s'] * len(vns))
        rows = hx.q(db, f"SELECT r.vn, {DRUG_COLS} {DRUG_JOIN} WHERE r.vn IN ({ph}) AND (r.an IS NULL OR r.an='') "
                        "ORDER BY r.item_no", vns)
        by_vn = {}
        for r in rows:
            by_vn.setdefault(r['vn'], []).append(r)
        seen = set()
        for v in vis:
            if v['clinic'] in seen or v['vn'] not in by_vn:
                continue
            seen.add(v['clinic'])
            if v['vn'] in used:
                continue
            used.add(v['vn'])
            groups.append((f"นัด{clean(v['clinic_name'])}", v['vstdate'], by_vn[v['vn']]))
            latest_clinic = max(latest_clinic or v['vstdate'], v['vstdate'])
    # visit OPD ทั่วไปที่มียา หลัง visit คลินิกล่าสุด (ไม่มีนัดคลินิกเลย = visit ล่าสุดที่มียา 1 ครั้ง)
    after = latest_clinic or (dt.date.today() - dt.timedelta(days=365))
    ov = hx.q(db, "SELECT o.vn, o.vstdate, k.department FROM ovst o LEFT JOIN kskdepartment k ON k.depcode=o.main_dep "
                  "WHERE o.hn=%s AND o.vstdate>%s AND o.vstdate<=CURDATE() ORDER BY o.vstdate DESC, o.vn DESC LIMIT 10", (hn, after))
    ov = [v for v in ov if v['vn'] not in used]
    if ov:
        vns = [v['vn'] for v in ov]
        ph = ','.join(['%s'] * len(vns))
        rows = hx.q(db, f"SELECT r.vn, {DRUG_COLS} {DRUG_JOIN} WHERE r.vn IN ({ph}) AND (r.an IS NULL OR r.an='') "
                        "ORDER BY r.item_no", vns)
        by_vn = {}
        for r in rows:
            by_vn.setdefault(r['vn'], []).append(r)
        for v in ov:
            if v['vn'] in by_vn:
                groups.append((f"OPD {clean(v['department'])}".strip(), v['vstdate'], by_vn[v['vn']]))
                if not latest_clinic:
                    break
    # ยากลับบ้านของการนอน รพ. ครั้งล่าสุดใน 1 ปี
    ipt = hx.q(db, "SELECT an, regdate, dchdate FROM ipt WHERE hn=%s AND dchdate IS NOT NULL AND dchdate>=CURDATE()-INTERVAL 365 DAY "
                   "ORDER BY dchdate DESC, dchtime DESC LIMIT 1", (hn,))
    admitted = hx.q(db, "SELECT an, regdate FROM ipt WHERE hn=%s AND dchdate IS NULL ORDER BY regdate DESC LIMIT 1", (hn,))
    if ipt:
        hme = hx.q(db, f"SELECT {DRUG_COLS} {DRUG_JOIN} JOIN ipt_order_no n ON n.an=r.an AND n.order_no=r.order_no "
                       "WHERE r.an=%s AND n.order_type='HMe' ORDER BY r.item_no", (ipt[0]['an'],))
        if hme:
            groups.append((f"ยากลับบ้าน (admit {th_date(ipt[0]['regdate'])} – D/C)", ipt[0]['dchdate'], hme))
    groups.sort(key=lambda g: g[1], reverse=True)
    return groups, admitted


def appts(db, hn):
    return hx.q(db, "SELECT a.nextdate, DATEDIFF(a.nextdate, CURDATE()) AS days, k.department AS dep, c.name AS clinic_name, a.app_cause "
                    "FROM oapp a LEFT JOIN kskdepartment k ON k.depcode=a.depcode LEFT JOIN clinic c ON c.clinic=a.clinic "
                    "WHERE a.hn=%s AND a.nextdate>=CURDATE() AND (a.oapp_status_id IS NULL OR a.oapp_status_id=1) "
                    "ORDER BY a.nextdate LIMIT 6", (hn,))


def allergies(db, hn):
    return hx.q(db, "SELECT agent, symptom FROM opd_allergy WHERE hn=%s AND IFNULL(allergy_cancel_status,'')<>'Y' "
                    "ORDER BY report_date", (hn,))


def abbr_all(rows):
    """ชื่อยา/วิธีใช้ย่อ/หน่วย แบบใบสรุปรายการยา OPD + ยากลับบ้าน — รันโค้ดจริงของ rx-sticker.html ผ่าน md_abbr.mjs
    Node ใช้ไม่ได้ = None (ใช้ชื่อ/วิธีใช้เต็มจาก HOSxP แทน)"""
    inp = [{'icode': hx.s(r['icode']), 'name': clean(r['name']), 'strength': clean(r['strength']), 'namePrint': clean(r['name_print']),
            'usage': clean(r['usage_text']), 'units': clean(r['units']), 'form': clean(r['dosageform'])} for r in rows]
    try:
        p = subprocess.run([NODE, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'md_abbr.mjs')],
                           input=json.dumps(inp, ensure_ascii=False).encode('utf-8'), capture_output=True, timeout=20,
                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        out = json.loads(p.stdout.decode('utf-8'))
        return out if len(out) == len(rows) else None
    except Exception as e:  # noqa: BLE001
        log(f'md_abbr ใช้ไม่ได้ ({e.__class__.__name__}: {e}) — ใช้วิธีใช้เต็ม')
        return None


def report(db, p):
    hn = p['hn']
    groups, admitted = old_meds(db, hn)
    allrows = [r for g in groups for r in g[2]]
    ab = abbr_all(allrows)
    abm = {id(r): ab[i] for i, r in enumerate(allrows)} if ab else {}
    ap = appts(db, hn)
    al = allergies(db, hn)
    now = dt.datetime.now()
    out = [f"💊 ประวัติยา รพ.ถ้ำพรรณรา (ข้อมูล ณ {th_date(now.date())} {now:%H:%M} น.)",
           f"{full_name(p)}  อายุ {age_of(p.get('birthday'))} ปี  HN {hn}"]
    if al:
        out.append('⚠️ แพ้ยา: ' + '; '.join(clean(a['agent']) + (f" ({clean(a['symptom'])})" if clean(a['symptom']) else '') for a in al))
    else:
        out.append('แพ้ยา: ไม่มีบันทึก')
    if admitted:
        out.append(f"🛏️ ขณะนี้นอน รพ. อยู่ (admit {th_date(admitted[0]['regdate'])})")
    out.append('')
    if not groups:
        out.append('ไม่พบการจ่ายยาใน 1 ปีที่ผ่านมา')
    for i, (title, d, rows) in enumerate(groups):
        out.append(f"▪ {title} {th_date(d)}" + (' (ล่าสุด)' if i == 0 and len(groups) > 1 else ''))
        seen = set()
        n = 0
        # ใบยากลับบ้านบางใบคีย์จำนวน 1 ทุกรายการ (ไม่ใช่จำนวนจริง) — ไม่แสดงจำนวนทั้งกลุ่ม
        noqty = len(rows) > 1 and all(qty_str(r['qty']) in ('0', '1', '') for r in rows)
        for r in rows:
            key = (r['icode'], clean(r['usage_text']))
            if key in seen:
                continue
            seen.add(key)
            n += 1
            a = abm.get(id(r))
            if a and a.get('skip'):
                n -= 1
                continue
            if a and a.get('name'):
                drug, use, unit = a['name'], a.get('use', ''), a.get('unit', '')
            else:
                drug, use, unit = clean(f"{hx.s(r['name'])} {hx.s(r['strength'])}"), clean(r['usage_text']), ''
            out.append(f"{n}. {drug}" + (f"  {use}" if use else '') + ('' if noqty else f"  #{qty_str(r['qty'])}" + (f" {unit}" if unit else '')))
        out.append('')
    if ap:
        out.append('📅 นัดครั้งต่อไป')
        for a in ap:
            where = clean(a['clinic_name']) or clean(a['dep'])
            cause = clean(a['app_cause'])
            out.append(f"• {th_date(a['nextdate'])} ({a['days']} วัน) {where}" + (f" — {cause}" if cause and cause != where else ''))
    else:
        out.append('📅 ไม่มีนัดที่ยังไม่ถึง')
    return '\n'.join(out).strip()


def handle(db, text):
    text = (text or '').strip()
    if not text:
        return 'พิมพ์ /med ตามด้วย HN, เลขบัตรประชาชน 13 หลัก หรือ ชื่อ สกุล', ''
    rows, kind = find_patients(db, text)
    if not rows:
        return f'❌ ไม่พบผู้ป่วยจาก{kind} "{text}"', ''
    if len(rows) == 1:
        return report(db, rows[0]), rows[0]['hn']
    lines = [f'พบ {len(rows) if len(rows) < 16 else "15+"} คน — แตะ HN เพื่อดูประวัติยา']
    for p in rows[:15]:
        lines.append(f"/med_{p['hn']}  {full_name(p)}  อายุ {age_of(p.get('birthday'))} ปี")
    return '\n'.join(lines), ''


# ── คิวบน Worker ────────────────────────────────────────────────────────────────────
def worker_call(cfg, path, body=None, timeout=20):
    base = cfg['url'].rsplit('/pc-report', 1)[0]
    data = json.dumps(body, ensure_ascii=False).encode('utf-8') if body is not None else None
    req = urllib.request.Request(base + path, data=data, method='POST' if data else 'GET',
                                 headers={'X-Report-Key': cfg['key'], 'Content-Type': 'application/json; charset=utf-8',
                                          'User-Agent': 'tph-med-remote'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8'))


def loop(cfg):
    db = None
    fails = 0
    log('เริ่มทำงาน')
    while True:
        try:
            jobs = worker_call(cfg, '/med/poll').get('jobs', [])
            fails = 0
        except Exception as e:  # noqa: BLE001
            fails += 1
            if fails in (1, 10) or fails % 150 == 0:
                log(f'ถามคิวไม่ได้ ({e.__class__.__name__}: {e})')
            time.sleep(min(60, POLL_SEC * fails))
            continue
        for j in jobs:
            text, hn = '', ''
            for attempt in range(2):
                try:
                    if db is None:
                        db = hx.db_connect()
                    db.ping(reconnect=True)
                    text, hn = handle(db, j.get('q', ''))
                    break
                except Exception as e:  # noqa: BLE001
                    db = None
                    text = f'⚠️ ค้นฐานข้อมูล HOSxP ไม่ได้: {e.__class__.__name__}'
                    log(f'DB error: {e}')
            log(f"ค้น id={j.get('id')} q={j.get('q', '')!r} → {hn or '-'}")
            try:
                worker_call(cfg, '/med/result', {'id': j.get('id'), 'chat': j.get('chat'), 'q': j.get('q', ''), 'text': text, 'hn': hn})
            except Exception as e:  # noqa: BLE001
                log(f'ส่งผลไม่ได้ ({e})')
        time.sleep(POLL_SEC)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--once', help='ค้นในเครื่องแล้วพิมพ์ผล ไม่ต่อ Worker')
    a = ap.parse_args()
    if a.once is not None:
        sys.stdout.reconfigure(encoding='utf-8')
        print(handle(hx.db_connect(), a.once)[0])
        return
    lock = socket.socket()
    try:
        lock.bind(('127.0.0.1', LOCK_PORT))
    except OSError:
        return   # มีตัวรันอยู่แล้ว (Task Scheduler ปลุกทุก 5 นาที)
    with open(CONFIG_FILE, encoding='utf-8-sig') as f:
        cfg = json.load(f)
    global NODE
    NODE = cfg.get('node') or NODE
    loop(cfg)


if __name__ == '__main__':
    main()
