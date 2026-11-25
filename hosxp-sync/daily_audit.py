"""ตรวจระบบเองทุกเช้า (ผู้ใช้ขอ 2026-11-25) — ไม่ต้องรอคนหน้างานจดเคสมาแจ้ง

ตรวจวันคลินิกล่าสุดก่อนวันนี้ (ovst.main_dep='001' ≥ 5 ราย ย้อนไม่เกิน 7 วัน) ที่ยังไม่เคยตรวจ:
  1. ยาเดิม (หน้าต่างบันทึกคลินิก ลอย) — รันโค้ดจริงของ clinic.html กับ /db/meds?before=วันนั้น แล้วเทียบกับใบสั่งยาวันนั้น
     แจ้งเฉพาะที่น่าสงสัย:
       • ขาด: ยาเรื้อรังในใบสั่งที่ไม่ถูกดึง ทั้งที่จ่าย ≥ 28 วันตั้งแต่แหล่งยาเดิมล่าสุด (ยาใหม่/ยาที่หยุดแล้วกลับมาสั่งไม่นับ)
       • เกิน: ยาที่ถูกดึงมาจากแหล่งเก่า (ไม่อยู่ในแหล่งล่าสุด) และวันนั้นแพทย์ก็ไม่ได้สั่ง = น่าจะหยุดไปแล้ว
     ยาที่ "หยุดวันนั้น" (อยู่ในแหล่งล่าสุดแต่ไม่ได้สั่ง) ไม่แจ้ง — เป็นยาเดิมจริง คนไข้อาจมียาเหลือ
  2. จ่ายเกินวันนัด — ยาเม็ดเรื้อรัง จำนวน > (วันถึงนัด + 1) × ใช้/วัน เกิน 20% และเกิน 30 เม็ด (เผื่อปัดซอง/แผง)
  3. HOSxP Bridge เครื่องนี้ — ทำงานอยู่ ต่อฐานข้อมูลได้ เวอร์ชันตรงกับบนเว็บ /db/meds ไม่ช้าเกิน 5 วินาที

ผลส่ง Telegram แชทงานส่วนตัว (TASKS_CHAT_ID) ผ่าน Worker /pc-report — มีแค่ HN + ชื่อยา ไม่มีชื่อผู้ป่วย
รายงานเต็มเก็บที่ %LOCALAPPDATA%\\HOSxPBridge\\audit\\YYYY-MM-DD.txt

  python daily_audit.py                 # Task Scheduler ทุกเช้า
  python daily_audit.py --date 2026-11-25 --port 8766 --dry   # ตรวจวันที่กำหนดกับ bridge ทดสอบ ไม่ส่ง Telegram
ตั้งค่า: %LOCALAPPDATA%\\HOSxPBridge\\audit-report.json = { "url": "https://.../pc-report", "key": "...", "node": "C:\\...\\node.exe" }
"""
import argparse
import datetime as dt
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hosxp_monthly_sync as hx  # noqa: E402  (db.json / log ร่วมกัน)

HERE = os.path.dirname(os.path.abspath(__file__))
HOME = hx.HOME
AUDIT_DIR = os.path.join(HOME, 'audit')
STATE_FILE = os.path.join(AUDIT_DIR, 'state.json')
CONFIG_FILE = os.path.join(HOME, 'audit-report.json')
hx.LOG_FILE = os.path.join(HOME, 'audit.log')
log = hx.log
s = hx.s

MIN_PATIENTS = 5
LOOKBACK_DAYS = 7
SLOW_SEC = 5
OVER_RATIO, OVER_ABS = 1.2, 30
TG_MAX = 3800


def load_json(path, default):
    try:
        with open(path, encoding='utf-8-sig') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def bridge_get(port, path, timeout=60):
    t = time.time()
    req = urllib.request.Request(f'http://127.0.0.1:{port}/{path}', headers={'Origin': 'https://tph-pharmacy.pages.dev'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8')), time.time() - t


def check_bridge(port):
    issues = []
    try:
        v, _ = bridge_get(port, 'version?check=1', 45)
        cur, _ = bridge_get(port, 'current', 10)
    except Exception as e:  # noqa: BLE001
        return [f'Bridge เครื่องนี้ไม่ตอบ ({e.__class__.__name__}) — ลอง start-bridge.bat']
    if not cur.get('db'):
        issues.append('Bridge ต่อฐานข้อมูล HOSxP ไม่ได้: ' + str(cur.get('dbErr') or '?'))
    if v.get('outdated'):
        issues.append(f"Bridge เครื่องนี้ยังเป็นรุ่นเก่า ({v.get('version')} → {v.get('latest')})"
                      + (' — อัปเดตเองไม่สำเร็จ' if v.get('failed') else '') + ' — กด 🔄 อัปเดต Bridge')
    return issues


def pick_date(db, state, forced):
    if forced:
        return forced
    today = dt.date.today()
    rows = hx.q(db, "SELECT vstdate, COUNT(DISTINCT hn) n FROM ovst WHERE main_dep='001' AND vstdate<%s AND vstdate>=%s "
                    "GROUP BY vstdate HAVING n>=%s ORDER BY vstdate DESC LIMIT 1",
                (today, today - dt.timedelta(days=LOOKBACK_DAYS), MIN_PATIENTS))
    if not rows:
        return None
    d = s(rows[0]['vstdate'])
    return None if d in state.get('done', []) else d


def long_supply_since(db, hn, icode, since, date, per_day):
    """จ่ายยานี้ (icode เดียวกัน) พอใช้ ≥ 28 วัน ตั้งแต่วันของแหล่งอ้างอิง (since) ถึงก่อน date หรือไม่
    — ยาที่จ่ายครั้งสุดท้ายก่อนแหล่งอ้างอิง = แพทย์หยุดไปแล้วค่อยกลับมาสั่ง ไม่ใช่บั๊กการดึงยาเดิม"""
    min_qty = 28 * per_day if per_day and per_day > 0 else 60
    rows = hx.q(db, "SELECT MAX(r.qty) mq FROM opitemrece r WHERE r.hn=%s AND r.icode=%s AND r.vstdate<%s AND r.vstdate>=%s",
                (hn, icode, date, since or date))
    mq = rows[0]['mq'] if rows else None
    return mq is not None and float(mq) >= min_qty


def run_eval(node, data):
    with tempfile.TemporaryDirectory() as tmp:
        fin, fout = os.path.join(tmp, 'in.json'), os.path.join(tmp, 'out.json')
        with open(fin, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False)
        p = subprocess.run([node, os.path.join(HERE, 'daily_audit_eval.mjs'), fin, fout], capture_output=True, text=True,
                           encoding='utf-8', errors='replace', timeout=900, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        out = load_json(fout, None)
        if not out or not out.get('ok'):
            raise RuntimeError('ประเมินด้วย clinic.html ไม่สำเร็จ: ' + ((out or {}).get('error') or p.stderr[-500:]))
        return out


def audit_day(db, port, node, date):
    pts = hx.q(db, "SELECT hn, MAX(vn) vn FROM ovst WHERE main_dep='001' AND vstdate=%s GROUP BY hn ORDER BY vn", (date,))
    data, slow, fail, outdated = {}, [], [], False
    for r in pts:
        hn, vn = s(r['hn']), s(r['vn'])
        try:
            meds, t = bridge_get(port, f'db/meds?hn={hn}&before={date}')
            order, _ = bridge_get(port, f'db/order?hn={hn}&vn={vn}')
        except Exception as e:  # noqa: BLE001
            fail.append(f'{hn} ({e.__class__.__name__})')
            continue
        if not meds.get('ok') or not order.get('ok'):
            fail.append(f"{hn} ({meds.get('error') or order.get('error')})")
            continue
        if meds.get('asOf') != date:
            outdated = True
            break
        if t > SLOW_SEC:
            slow.append(f'{hn} {t:.0f} วิ')
        data[hn] = {'meds': meds, 'order': order, 'vn': vn}
    if outdated:
        return {'n': len(pts), 'error': 'Bridge เครื่องนี้ยังไม่รองรับ /db/meds?before= — อัปเดต Bridge แล้วตรวจใหม่'}
    res = run_eval(node, {hn: {'meds': v['meds'], 'order': v['order']} for hn, v in data.items()}) if data else {'res': {}, 'errors': []}
    miss, extra, over = [], [], []
    d0 = dt.date.fromisoformat(date)
    for hn, r in res['res'].items():
        for o, matched in zip(r['order'], r['pickedMatch']):
            if o['chronic'] and not matched and o['qty'] > 0 and long_supply_since(db, hn, o['icode'], r['topDate'], date, o['perDay']):
                miss.append(f"{hn} {o['key']}")
        for p, in_order, in_top in zip(r['picked'], r['pickedInOrder'], r['pickedInTop']):
            if not in_order and not in_top:
                extra.append(f'{hn} {p}')
        # จ่ายเกินวันนัด: นัดไกลสุดที่ออกจาก visit นี้
        ap = hx.q(db, 'SELECT MAX(nextdate) nd FROM oapp WHERE vn=%s', (data[hn]['vn'],))
        nd = ap[0]['nd'] if ap and ap[0]['nd'] else None
        if not nd:
            continue
        days = (nd - d0).days if isinstance(nd, dt.date) else 0
        if days <= 0:
            continue
        for o in r['order']:
            if not o['chronic'] or o['insulin'] or not o['perDay'] or not o['form'].upper().startswith(('TAB', 'CAP')):
                continue
            need = (days + 1) * o['perDay']
            if o['qty'] > need * OVER_RATIO and o['qty'] - need > OVER_ABS:
                over.append(f"{hn} {o['key']} จ่าย {o['qty']:g} ควร ~{need:g} (นัด {days} วัน × {o['perDay']:g}/วัน)")
    return {'n': len(pts), 'checked': len(res['res']), 'miss': miss, 'extra': extra, 'over': over, 'slow': slow,
            'fail': fail, 'pageErrors': res.get('errors', [])}


def th_date(iso):
    y, m, d = iso.split('-')
    return f'{int(d)}/{int(m)}/{int(y) + 543 - 2500}'


def section(title, items, cap=12):
    if not items:
        return []
    lines = [f'{title} ({len(items)})'] + ['• ' + x for x in items[:cap]]
    if len(items) > cap:
        lines.append(f'… อีก {len(items) - cap} รายการ (ดูรายงานเต็มในเครื่อง)')
    return lines + ['']


def build_report(date, bridge_issues, a, full):
    cap = 10 ** 6 if full else 12
    lines = ['🩺 ตรวจระบบอัตโนมัติ' + (f' — คลินิกวันที่ {th_date(date)}' if date else ''), '']
    lines += section('⚠️ HOSxP Bridge', bridge_issues, cap)
    if a:
        if a.get('error'):
            lines += ['⚠️ ' + a['error'], '']
        else:
            lines.append(f"ตรวจยาเดิม {a['checked']}/{a['n']} ราย")
            lines.append('')
            lines += section('💊 ยาเดิมขาด (เคยจ่ายต่อเนื่องแต่ไม่ถูกดึง)', a['miss'], cap)
            lines += section('💊 ยาเดิมเกิน (จากแหล่งเก่า แพทย์ไม่ได้สั่งต่อ)', a['extra'], cap)
            lines += section('📦 จ่ายเกินวันนัด', a['over'], cap)
            lines += section('🐢 /db/meds ช้าเกิน 5 วิ', a['slow'], cap)
            lines += section('❌ ดึงข้อมูลไม่สำเร็จ', a['fail'], cap)
            lines += section('🐞 JS error ใน clinic.html', a['pageErrors'], cap)
            if not any(a[k] for k in ('miss', 'extra', 'over', 'slow', 'fail', 'pageErrors')):
                lines += ['✅ ไม่พบความผิดปกติ', '']
    return '\n'.join(lines).strip()


def send(cfg, text):
    body = json.dumps({'text': text[:TG_MAX]}).encode('utf-8')
    req = urllib.request.Request(cfg['url'], data=body, method='POST',
                                 # Cloudflare บล็อก User-Agent ปกติของ Python-urllib (error 1010) → 403
                                 headers={'Content-Type': 'application/json', 'X-Report-Key': cfg['key'],
                                          'User-Agent': 'tph-daily-audit/1.0'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--date', help='วันที่ตรวจ YYYY-MM-DD (ไม่ระบุ = วันคลินิกล่าสุดที่ยังไม่ตรวจ)')
    ap.add_argument('--port', type=int, default=8765)
    ap.add_argument('--dry', action='store_true', help='ไม่ส่ง Telegram ไม่บันทึกสถานะ')
    args = ap.parse_args()
    os.makedirs(AUDIT_DIR, exist_ok=True)
    cfg = load_json(CONFIG_FILE, {})
    state = load_json(STATE_FILE, {'done': []})
    node = cfg.get('node') or shutil.which('node') or r'C:\Program Files\nodejs\node.exe'

    bridge_issues = check_bridge(args.port)
    db = hx.db_connect()
    try:
        date = pick_date(db, state, args.date)
        a = None
        if date and not any('ไม่ตอบ' in x for x in bridge_issues):
            log(f'ตรวจวันที่ {date}')
            try:
                a = audit_day(db, args.port, node, date)
            except Exception as e:  # noqa: BLE001
                a = {'error': f'ตรวจไม่สำเร็จ: {e}'}
    finally:
        db.close()

    if not date and not bridge_issues:
        log('ไม่มีวันคลินิกใหม่ให้ตรวจ และ bridge ปกติ')
        return
    full = build_report(date, bridge_issues, a, True)
    short = build_report(date, bridge_issues, a, False)
    stamp = date or dt.date.today().isoformat()
    with open(os.path.join(AUDIT_DIR, f'{stamp}.txt'), 'w', encoding='utf-8') as f:
        f.write(full + '\n')
    print(full)
    if args.dry:
        return
    # bridge ผิดปกติแต่ไม่มีวันใหม่ → แจ้งวันละครั้ง
    today = dt.date.today().isoformat()
    if not date and state.get('bridgeNotified') == today:
        return
    if cfg.get('url') and cfg.get('key'):
        send(cfg, short)
        log('ส่ง Telegram แล้ว')
    else:
        log('ยังไม่ได้ตั้งค่า audit-report.json — ไม่ได้ส่ง Telegram')
    if date and a and not a.get('error'):
        state['done'] = (state.get('done', []) + [date])[-60:]
    if bridge_issues:
        state['bridgeNotified'] = today
    with open(STATE_FILE, 'w', encoding='utf-8') as f:
        json.dump(state, f)


if __name__ == '__main__':
    try:
        main()
    except Exception as e:  # noqa: BLE001
        log(f'ผิดพลาด: {e!r}')
        raise
