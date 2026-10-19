"""ดึงข้อมูล HOSxP เข้า web app อัตโนมัติรายเดือน (รันด้วย Task Scheduler บนเครื่อง รพ. ที่ต่อฐานข้อมูล HOSxP ได้)

ทุกวันที่ 1 ดึงข้อมูลของเดือนก่อนหน้า (เริ่มที่ ต.ค. 69 = 2026-10) ลง Firestore (pharmacy_tph):
  - hosxp_records : รายงาน Medication error OPD/IPD (HOSxP > Pharmacy > Medication error = med_error)
  - adr_records   : รายงาน ADR (HOSxP > Pharmacy > Adverse drug reactions = patient_adr)
  - hosxp_denom   : ตัวหาร ME — OPD = จำนวน visit (ovst), IPD = วันนอนของผู้ป่วยที่จำหน่ายในเดือนนั้น (an_stat.admdate)

กฎเดียวกับปุ่ม "🗄 ดึงจาก HOSxP" ในหน้าเว็บ: รายการที่มีอยู่แล้วไม่ลงซ้ำ แค่ผูกกับรายงาน HOSxP แล้วเติมช่องที่ยังว่าง
ตัวหารของเดือนตั้งแต่ 2026-10 เป็นของ HOSxP (เขียนทับเสมอ — หน้าเว็บไม่ให้กรอกเองแล้ว)
วันที่ 1–7 ของเดือนดึงเดือนก่อนซ้ำทุกวัน เผื่อมีคนลงรายงานย้อนหลัง; เครื่องปิดวันที่ 1 ก็ตามเก็บเดือนที่ยังไม่ได้ดึงให้เอง

ทุกรอบ (ทุกวัน): ใบสั่งยา ER ประจำวัน (er_records.rxDaily) — เภสัชกรอกเองเป็นหลัก วันไหนไม่ได้กรอกภายใน 24 ชม.
(เกิน 08:00 ของวันถัดไป) โปรแกรมนับผู้ป่วย ER ทุกคน 19:30 คืนก่อน → 08:00 วันนั้น (รวมคนที่ไม่มียา) แล้วเติมให้
เป็นแถว hasME=false + rxAuto=true (หน้าเว็บแสดง 🗄 และถ้าเภสัชกรอกเองทีหลัง ค่าที่กรอกเองชนะ)

ทุกรอบ (ทุกวัน): จำนวนคนไข้ HT บ่าย (clinic_data.sessionRecords pmOnly) — ผู้ป่วยนัดคลินิก HT ที่คีย์จ่ายยาหลัง 12:00
และไม่มีบันทึกในหน้าคลินิกวันนั้น (= ไม่ได้พบเภสัช) เติมเป็นแถว htPmAuto=true; คิดใหม่ย้อนหลัง 14 วัน; ถ้ากรอกเอง ค่าที่กรอกเองชนะ

ทุกรอบ (ทุกวัน): DRP ที่เภสัชพิมพ์ใน COUNSELLING น้อยกว่า 30 นาที (ช่องวิธีใช้) ย้อนหลัง 14 วันถึงเมื่อวาน → clinic_YYYY-MM
มีบันทึกคลินิก HN+วันเดียวกันแล้วแค่แนบข้อความ (เติม DRP เฉพาะที่ยังว่าง) ไม่งั้นเพิ่มบันทึกใหม่ source='hosxp' drpAuto=true

ใช้: python hosxp_monthly_sync.py [--month YYYY-MM] [--dry-run]
ฐานข้อมูล: %LOCALAPPDATA%\\HOSxPBridge\\db.json (SELECT อย่างเดียว) · log/state อยู่โฟลเดอร์เดียวกัน
"""
import argparse
import datetime as dt
import json
import os
import random
import re
import string
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import pymysql

START_MONTH = '2026-10'
ER_RX_START = '2026-10-01'  # วันแรกที่เติมใบสั่งยา ER ให้อัตโนมัติ (เปลี่ยนด้วย --er-from)
HT_PM_START = '2026-10-01'  # วันแรกที่เติมจำนวนคนไข้ HT บ่ายให้อัตโนมัติ (เปลี่ยนด้วย --ht-from)
COUNSEL_START = '2026-10-16'  # วันแรกที่ดึง DRP จาก COUNSELLING ให้อัตโนมัติ (ก่อนหน้านี้ดึงย้อนหลังครั้งเดียวแล้ว; --counsel-from)
FS = 'https://firestore.googleapis.com/v1/projects/pharmacy-tph/databases/(default)/documents/pharmacy_tph/'
FS_KEY = 'AIzaSyDHiTSM7fz1FihDLyb_QxLGheo_6CuNXIE'
CLASSIFY_URL = 'https://admin-error-classify.oatsudster.workers.dev'
CLASSIFY_TOKEN = 'x9kQm2vLpR7wZaN4tY8bJ3cH'
HOME = os.path.join(os.environ.get('LOCALAPPDATA', '.'), 'HOSxPBridge')
STATE_FILE = os.path.join(HOME, 'monthly-sync-state.json')
LOG_FILE = os.path.join(HOME, 'monthly-sync.log')
LOCK_FILE = os.path.join(HOME, 'monthly-sync.lock')

# ต้องตรงกับ adr.html
TYPE_A_SYMPTOMS = ['Agitation', 'Bradycardia', 'Constipation', 'Drug induced hepatitis', 'Dry cough', 'Flushing', 'Edema',
                   'Hypoglycemia', 'Hepatitis', 'Lactic acidosis', 'Myalgia', 'Muscle cramps', 'Orthostatic hypotension',
                   'Thrombocytopenia', 'Transaminitis', 'กล้ามเนื้อเกร็งทั้งตัว', 'คลื่นไส้อาเจียน', 'ใจสั่น', 'ปวดศีรษะ',
                   'หน้ามืด', 'นอนไม่หลับ', 'ท้องเสีย', 'เวียนศีรษะ']
TYPE_B_SYMPTOMS = ['Anaphylaxis shock', 'Angioedema', 'คัน แต่ไม่มีผื่น', 'Erythema multiforme (EM)', 'Fixed drug eruption',
                   'Purpura Rash', 'MP rash', 'Mucosal drug allergy', 'ริมผีปากดำ', 'Stevens-Johnson Syndrome (SJS)',
                   'ปากบวม ปวด/แสบบริเวณลิ้น ปาก', 'Urticaria']
G6PD_SYMPTOMS = ['Hemolytic anemia', 'Methemoglobinemia']
ADR_SEV_OPTIONS = ['ไม่ร้ายแรง (Non-serious)', 'ร้ายแรง - เสียชีวิต (Death)', 'ร้ายแรง - อันตรายถึงชีวิต (Life-threatening)',
                   'ร้ายแรง - ต้องเข้ารับการรักษาในโรงพยาบาล (Hospitalization-initial)',
                   'ร้ายแรง - ทำให้เพิ่มระยะเวลาในการรักษานานขึ้น (Hospitalization-prolonged)', 'ร้ายแรง - พิการ (Disability)',
                   'ร้ายแรง - เป็นเหตุให้เกิดความผิดปกติแต่กำเนิด (Congenital anomaly)', 'ยังไม่ทราบ']


def log(msg):
    line = f"{dt.datetime.now():%Y-%m-%d %H:%M:%S} {msg}"
    print(line)
    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(line + '\n')
    except OSError:
        pass


# ── Firestore REST (กฎ Firestore อนุญาตเขียนเฉพาะ doc ของแอป) ─────────────────────
def to_fs(v):
    if v is None:
        return {'nullValue': None}
    if isinstance(v, bool):
        return {'booleanValue': v}
    if isinstance(v, int):
        return {'integerValue': str(v)}
    if isinstance(v, float):
        return {'doubleValue': v}
    if isinstance(v, str):
        return {'stringValue': v}
    if isinstance(v, list):
        return {'arrayValue': {'values': [to_fs(x) for x in v]}}
    if isinstance(v, dict):
        return {'mapValue': {'fields': {k: to_fs(x) for k, x in v.items()}}}
    return {'stringValue': str(v)}


def from_fs(x):
    k, val = next(iter(x.items()))
    if k == 'mapValue':
        return {a: from_fs(b) for a, b in val.get('fields', {}).items()}
    if k == 'arrayValue':
        return [from_fs(b) for b in val.get('values', [])]
    if k == 'integerValue':
        return int(val)
    if k == 'doubleValue':
        return float(val)
    if k == 'nullValue':
        return None
    return val


def http(method, url, body=None):
    data = json.dumps(body, ensure_ascii=False).encode('utf-8') if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={'Content-Type': 'application/json; charset=utf-8'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode('utf-8'))


def update_doc(doc, mutate, dry, mask=None):
    """อ่าน doc → mutate(fields) → เขียนกลับแบบมีเงื่อนไข updateTime (มีคนเขียนแทรกก็อ่านใหม่แล้วทำซ้ำ)
    mask = เขียนเฉพาะ field เหล่านี้ (ไม่แตะ field อื่นของ doc และไม่เติม updated ให้)"""
    for attempt in range(4):
        try:
            d = http('GET', f'{FS}{doc}?key={FS_KEY}')
            fields = {a: from_fs(b) for a, b in d.get('fields', {}).items()}
            pre = '&currentDocument.updateTime=' + urllib.parse.quote(d['updateTime'])
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
            fields, pre = {}, '&currentDocument.exists=false'
        result = mutate(fields)
        if not result.get('changed') or dry:
            return result
        if mask:
            pre += ''.join('&updateMask.fieldPaths=' + k for k in mask)
            fields = {k: fields[k] for k in mask if k in fields}
        else:
            fields['updated'] = dt.datetime.now(dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        try:
            http('PATCH', f'{FS}{doc}?key={FS_KEY}{pre}', {'fields': {k: to_fs(v) for k, v in fields.items()}})
            return result
        except urllib.error.HTTPError as e:
            if e.code in (400, 409, 412) and attempt < 3:
                log(f'{doc}: มีการแก้ไขพร้อมกัน ลองใหม่ ({e.code})')
                time.sleep(2 + attempt * 3)
                continue
            raise
    raise RuntimeError(f'{doc}: เขียนไม่สำเร็จ')


# ── HOSxP ────────────────────────────────────────────────────────────────────────
def db_connect():
    with open(os.path.join(HOME, 'db.json'), encoding='utf-8-sig') as f:
        c = {k.lower(): v for k, v in json.load(f).items()}
    db = pymysql.connect(host=c.get('host', '192.168.1.71'), port=int(c.get('port', 3306)), user=c['user'],
                         password=c.get('password') or c.get('pass') or '', database='hos', charset='utf8mb4',
                         connect_timeout=15, read_timeout=120, cursorclass=pymysql.cursors.DictCursor)
    with db.cursor() as cur:
        cur.execute('SET NAMES utf8mb4')
    return db


def q(db, sql, args=()):
    with db.cursor() as cur:
        cur.execute(sql, args)
        return cur.fetchall()


def s(v):
    if v is None:
        return ''
    if isinstance(v, (dt.date, dt.datetime)):
        return v.strftime('%Y-%m-%d %H:%M:%S') if isinstance(v, dt.datetime) else v.strftime('%Y-%m-%d')
    return str(v)


def month_range(m):
    y, mo = map(int, m.split('-'))
    a = dt.date(y, mo, 1)
    b = dt.date(y + (mo == 12), mo % 12 + 1, 1)
    return a.isoformat(), b.isoformat()


# ── ME OPD/IPD → hosxp_records (ตรงกับ syncMeFromHosxp ใน ME_Dashboard.html) ───────
def extract_severity(x):
    m = re.search(r'Category\s+([A-I]):', x or '', re.I)
    return m.group(1).upper() if m else ''


def extract_stage_short(x):
    x = x or ''
    if not x:
        return ''
    m = re.search(r'\(\s*(Pre-dispensing|Prescribing|Transcribing|Dispensing|Administration|Monitoring)[^)]*\)', x, re.I)
    if m:
        return m.group(1)
    for key, val in (('สั่งยา', 'Prescribing'), ('คัดลอก', 'Transcribing'), ('จ่ายยา', 'Pre-dispensing'),
                     ('Pre-dispensing', 'Pre-dispensing'), ('ให้ยา', 'Administration'), ('ติดตาม', 'Monitoring')):
        if key in x:
            return val
    return x.split('(')[0].strip()[:25]


def fetch_me(db, a, b):
    return q(db, """SELECT m.med_error_id, m.hn, m.dep_type, DATE_FORMAT(m.update_datetime,'%%Y-%%m-%%d') d,
        DATE_FORMAT(m.update_datetime,'%%H:%%i') t, TRIM(CONCAT(IFNULL(p.pname,''),IFNULL(p.fname,''),' ',IFNULL(p.lname,''))) pt,
        dr.name doctor, di.name drug, pt.med_error_process_type_name stage, rt.med_error_risk_type_name severity,
        et.med_error_type_name metype, m.med_error_note_text note, o.officer_name officer
      FROM med_error m LEFT JOIN patient p ON p.hn=m.hn LEFT JOIN doctor dr ON dr.code=m.doctor_code
      LEFT JOIN drugitems di ON di.icode=m.icode LEFT JOIN officer o ON o.officer_id=m.officer_id
      LEFT JOIN med_error_process_type pt ON pt.med_error_process_type_id=m.med_error_process_type_id
      LEFT JOIN med_error_risk_type rt ON rt.med_error_risk_type_id=m.med_error_risk_type_id
      LEFT JOIN med_error_type et ON et.med_error_type_id=m.med_error_type_id
      WHERE m.update_datetime>=%s AND m.update_datetime<%s ORDER BY m.update_datetime, m.med_error_id""", (a, b))


def merge_me(records, rows):
    added, filled, cnt = 0, 0, {'OPD': 0, 'IPD': 0}
    base_id = time.time() * 1000
    for it in rows:
        dept = s(it['dep_type']).upper().strip()
        if dept not in ('OPD', 'IPD'):
            continue
        hx = s(it['med_error_id'])
        rec = {'date': s(it['d']), 'time': s(it['t']), 'hn': s(it['hn']), 'patient': s(it['pt']), 'doctor': s(it['doctor']),
               'dept': dept, 'drug': s(it['drug']), 'stage': extract_stage_short(s(it['stage'])), 'stageRaw': s(it['stage']),
               'meType': s(it['metype']), 'severity': extract_severity(s(it['severity'])), 'severityRaw': s(it['severity']),
               'detail': s(it['note']), 'reporter': s(it['officer'])}
        ex = next((x for x in records if s(x.get('hxMeId')) == hx), None)
        if ex is None and rec['hn']:
            c = [x for x in records if not x.get('hxMeId') and x.get('dept') == dept and x.get('date') == rec['date']
                 and s(x.get('hn')) == rec['hn']]
            ex = next((x for x in c if x.get('drug') == rec['drug']), None) or next((x for x in c if x.get('time') == rec['time']), None) \
                or (c[0] if c else None)
        if ex is not None:
            ch = not ex.get('hxMeId')
            ex['hxMeId'] = hx
            for k, v in rec.items():
                if v and not ex.get(k):
                    ex[k] = v
                    ch = True
            filled += ch
            continue
        records.append({'id': base_id + random.random(), **rec, 'source': 'hosxp_db', 'hxMeId': hx})
        base_id += 1
        added += 1
        cnt[dept] += 1
    return added, filled, cnt


# ── ADR → adr_records (ตรงกับ syncAdrFromHosxp ใน adr.html) ─────────────────────────
def fetch_adr(db, a, b):
    rows = q(db, """SELECT a.patient_adr_id, a.hn, TRIM(CONCAT(IFNULL(p.pname,''),IFNULL(p.fname,''),' ',IFNULL(p.lname,''))) ptname,
        a.department, a.an, a.report_date, a.adverse_effect_date, a.adverse_effect, a.other_dx, a.lab_pe_text, a.medication_list,
        a.adr_dechallange, a.adr_rechallenge, a.adr_continue_rechallenge, a.adr_norechallenge, a.has_adr_history,
        a.dx_doctor_name, a.dx_doctor_position, a.entry_officer_name, a.entry_officer_position,
        pt.adr_product_type_name, se.adr_seriousness_name, oc.adr_outcome_name, po.adr_possibility_name, rt.adr_report_type_name,
        ca.adr_cause_name, dt.adr_dechallenge_type_name, rct.adr_rechallenge_type_name,
        (SELECT t.opd_allergy_type_name FROM opd_allergy x JOIN opd_allergy_type t ON t.opd_allergy_type_id=x.opd_allergy_type_id
          WHERE x.hn=a.hn AND ABS(DATEDIFF(x.report_date, a.report_date))<=60 ORDER BY ABS(DATEDIFF(x.report_date, a.report_date)) LIMIT 1) allergy_type,
        (SELECT x.symptom FROM opd_allergy x WHERE x.hn=a.hn AND ABS(DATEDIFF(x.report_date, a.report_date))<=60 AND x.symptom<>''
          ORDER BY ABS(DATEDIFF(x.report_date, a.report_date)) LIMIT 1) allergy_symptom
      FROM patient_adr a LEFT JOIN patient p ON p.hn=a.hn
      LEFT JOIN adr_product_type pt ON pt.adr_product_type_id=a.adr_product_type_id
      LEFT JOIN adr_seriousness se ON se.adr_seriousness_id=a.adr_seriousness_id
      LEFT JOIN adr_outcome oc ON oc.adr_outcome_id=a.adr_outcome_id
      LEFT JOIN adr_possibility po ON po.adr_possibility_id=a.adr_possibility_id
      LEFT JOIN adr_report_type rt ON rt.adr_report_type_id=a.adr_report_type_id
      LEFT JOIN adr_cause ca ON ca.adr_cause_id=a.adr_cause_id
      LEFT JOIN adr_dechallenge_type dt ON dt.adr_dechallenge_type_id=a.adr_dechallenge_type_id
      LEFT JOIN adr_rechallenge_type rct ON rct.adr_rechallenge_type_id=a.adr_rechallenge_type_id
      WHERE a.report_date>=%s AND a.report_date<%s ORDER BY a.report_date, a.patient_adr_id""", (a, b))
    meds = {}
    if rows:
        ids = ','.join(str(int(r['patient_adr_id'])) for r in rows)
        for m in q(db, f"""SELECT m.patient_adr_id, t.adr_medication_type_name, m.medication_name, m.medication_begin_date,
              m.medication_end_date, m.medication_icd, m.medication_idr FROM patient_adr_medication m
              LEFT JOIN adr_medication_type t ON t.adr_medication_type_id=m.adr_medication_type_id
              WHERE m.patient_adr_id IN ({ids}) ORDER BY m.patient_adr_medication_id"""):
            meds.setdefault(m['patient_adr_id'], []).append({
                'role': s(m['adr_medication_type_name']), 'name': s(m['medication_name']), 'begin': s(m['medication_begin_date']),
                'end': s(m['medication_end_date']), 'indication': s(m['medication_icd']), 'usage': s(m['medication_idr'])})
    items = []
    for r in rows:
        items.append({
            'id': s(r['patient_adr_id']), 'hn': s(r['hn']), 'name': s(r['ptname']), 'dept': s(r['department']), 'an': s(r['an']),
            'reportDate': s(r['report_date']), 'onsetDate': s(r['adverse_effect_date']), 'effect': s(r['adverse_effect']),
            'otherDx': s(r['other_dx']), 'labPe': s(r['lab_pe_text']), 'drugs': s(r['medication_list']),
            'productType': s(r['adr_product_type_name']), 'seriousness': s(r['adr_seriousness_name']), 'outcome': s(r['adr_outcome_name']),
            'possibility': s(r['adr_possibility_name']), 'reportType': s(r['adr_report_type_name']), 'cause': s(r['adr_cause_name']),
            'dechallenge': s(r['adr_dechallange']), 'dechallengeType': s(r['adr_dechallenge_type_name']),
            'rechallenge': s(r['adr_rechallenge']), 'rechallengeType': s(r['adr_rechallenge_type_name']),
            'continueRechallenge': s(r['adr_continue_rechallenge']), 'noRechallenge': s(r['adr_norechallenge']),
            'hasHistory': s(r['has_adr_history']), 'doctor': s(r['dx_doctor_name']), 'doctorPosition': s(r['dx_doctor_position']),
            'officer': s(r['entry_officer_name']), 'officerPosition': s(r['entry_officer_position']),
            'allergyType': s(r['allergy_type']), 'allergySymptom': s(r['allergy_symptom']),
            'meds': meds.get(r['patient_adr_id'], [])})
    return items


def adr_type(it):
    if re.search(r'G6PD|hemoly', (it['effect'] or '') + ' ' + (it['drugs'] or ''), re.I):
        return 'G6PD'
    t = it['allergyType'] or ''
    return 'A' if re.search(r'type\s*a', t, re.I) else 'B' if re.search(r'type\s*b', t, re.I) else ''


def adr_symptom_exact(typ, effect):
    lst = {'A': TYPE_A_SYMPTOMS, 'B': TYPE_B_SYMPTOMS, 'G6PD': G6PD_SYMPTOMS}.get(typ, [])
    e = (effect or '').strip().lower()
    return next((x for x in lst if x.lower() == e), '') if e else ''


def adr_severity(x):
    x = x or ''
    return next((o for o in ADR_SEV_OPTIONS if o == x or o.replace('อันตราย', 'อัตราย') == x), x or 'ยังไม่ทราบ')


def merge_adr(records, items):
    added, linked, new = 0, 0, []
    for it in items:
        hn, date = it['hn'].strip(), it['reportDate'][:10]
        suspected = [m['name'] for m in it['meds'] if re.search('suspect', m['role'] or '', re.I) and m['name']]
        drug = ', '.join(suspected) or it['drugs']
        typ = adr_type(it)
        # รายงาน ADR ที่ไม่ได้กรอกอาการ ใช้อาการจากประวัติแพ้ยา (opd_allergy) ของผู้ป่วยรายเดียวกันแทน
        diag = ' — '.join(x for x in (it['effect'] or it['allergySymptom'], it['otherDx']) if x)
        rec = next((r for r in records if s(r.get('hosxpId')) == it['id']), None) or next(
            (r for r in records if not r.get('hosxpId') and s(r.get('hn')).strip().zfill(7) == hn.zfill(7) and r.get('date') == date), None)
        if rec is not None:
            before = json.dumps(rec, ensure_ascii=False, sort_keys=True)
            rec['hosxpId'], rec['hosxp'] = it['id'], it
            if not rec.get('name') and it['name']:
                rec['name'] = it['name']
            if not rec.get('type') and typ:
                rec['type'] = typ
            if not rec.get('symptom'):
                x = adr_symptom_exact(rec.get('type') or typ, it['effect'])
                if x:
                    rec['symptom'] = x
            if not rec.get('drug') and drug:
                rec['drug'] = drug
            if not rec.get('diagnosis') and diag:
                rec['diagnosis'] = diag
            if rec.get('severity') in (None, '', 'ยังไม่ทราบ') and it['seriousness']:
                rec['severity'] = adr_severity(it['seriousness'])
            if json.dumps(rec, ensure_ascii=False, sort_keys=True) != before:
                linked += 1
            if not rec.get('symptom'):
                new.append(rec)
            continue
        uid = base36(int(time.time() * 1000)) + ''.join(random.choices(string.ascii_lowercase + string.digits, k=5))
        rec = {'id': uid, 'hosxpId': it['id'], 'date': date, 'hn': hn, 'name': it['name'],
               'dept': 'หอผู้ป่วยใน' if re.search(r'ipd|ward|หอ', it['dept'] or '', re.I) or it['an'] else (it['dept'] or 'OPD'),
               'an': it['an'], 'type': typ, 'symptom': adr_symptom_exact(typ, it['effect']), 'drug': drug,
               'productType': it['productType'] or 'ยา/วัตถุเสพติด', 'severity': adr_severity(it['seriousness']),
               'diagnosis': diag, 'source': 'hosxp-db', 'created': int(time.time() * 1000), 'hosxp': it}
        records.insert(0, rec)
        added += 1
        if not rec['symptom']:
            new.append(rec)
        time.sleep(0.002)
    return added, linked, new


def base36(n):
    d = string.digits + string.ascii_lowercase
    out = ''
    while n:
        n, r = divmod(n, 36)
        out = d[r] + out
    return out or '0'


def classify_adr(recs):
    """ระบุชนิด/ลักษณะอาการด้วย AI (Worker เดียวกับปุ่ม 🤖 ในหน้า ADR) — ไม่สำเร็จก็ปล่อยว่างไว้ให้เภสัชระบุเอง"""
    ctx = ('คุณเป็นเภสัชกรที่ช่วยจัดอาการไม่พึงประสงค์จากยา (ADR) ตามหลักวิชาการ: Type A = ผลข้างเคียงที่สัมพันธ์กับฤทธิ์ทางเภสัชวิทยา'
           'ของยา/ขึ้นกับขนาดยา, Type B = ปฏิกิริยาการแพ้ยา/idiosyncratic เลือกหมวด "ชนิด: ลักษณะอาการ" ที่ตรงที่สุด'
           'จากชื่อยาที่สงสัยและอาการที่บันทึกไว้')
    for typ in ('A', 'B', 'G6PD', ''):
        group = [r for r in recs if (r.get('type') or '') == typ and not r.get('symptom')]
        if not group:
            continue
        cats = {'A': TYPE_A_SYMPTOMS, 'B': TYPE_B_SYMPTOMS, 'G6PD': G6PD_SYMPTOMS}.get(typ)
        options = [f'{typ}: {x}' for x in cats] if cats else [f'A: {x}' for x in TYPE_A_SYMPTOMS] + [f'B: {x}' for x in TYPE_B_SYMPTOMS]
        for i in range(0, len(group), 60):
            batch = group[i:i + 60]
            body = {'items': [{'id': r['id'], 'text': ' — '.join(x for x in (r.get('drug'), r.get('diagnosis')) if x)} for r in batch],
                    'categories': options, 'context': ctx}
            try:
                req = urllib.request.Request(CLASSIFY_URL, data=json.dumps(body, ensure_ascii=False).encode('utf-8'), method='POST',
                                             headers={'Content-Type': 'application/json', 'X-App-Token': CLASSIFY_TOKEN})
                with urllib.request.urlopen(req, timeout=90) as res:
                    out = json.loads(res.read().decode('utf-8')).get('results', [])
            except Exception as e:  # noqa: BLE001
                log(f'ADR: AI ระบุอาการไม่สำเร็จ ({e}) — ปล่อยว่างไว้')
                return
            for o in out:
                if not o.get('category'):
                    continue
                r = next((x for x in batch if x['id'] == o['id']), None)
                t, _, sym = o['category'].partition(': ')
                if r and sym:
                    if not r.get('type'):
                        r['type'] = t
                    r['symptom'], r['symptomAI'] = sym, True
                    r['symptomAINote'] = 'AI จัดให้อัตโนมัติตอนดึงข้อมูลรายเดือนจาก HOSxP — โปรดตรวจสอบ'


# ── ตัวหาร → hosxp_denom ─────────────────────────────────────────────────────────
def fetch_denom(db, a, b):
    opd = q(db, 'SELECT COUNT(*) n FROM ovst WHERE vstdate>=%s AND vstdate<%s', (a, b))[0]['n']
    ipd = q(db, 'SELECT IFNULL(SUM(admdate),0) n FROM an_stat WHERE dchdate>=%s AND dchdate<%s', (a, b))[0]['n']
    return int(opd or 0), int(ipd or 0)


def sync_month(db, m, dry):
    a, b = month_range(m)
    me_rows = fetch_me(db, a, b)
    adr_items = fetch_adr(db, a, b)
    opd, ipd = fetch_denom(db, a, b)

    def mut_me(f):
        recs = f.setdefault('records', [])
        added, filled, cnt = merge_me(recs, me_rows)
        return {'changed': bool(added or filled), 'added': added, 'filled': filled, 'cnt': cnt}

    def mut_adr(f):
        recs = f.setdefault('records', [])
        added, linked, pending = merge_adr(recs, adr_items)
        if pending and not dry:
            classify_adr(pending)
        return {'changed': bool(added or linked or pending), 'added': added, 'linked': linked, 'ai': len(pending)}

    def mut_denom(f):
        data = f.setdefault('data', {})
        ch = []
        for dept, n in (('OPD', opd), ('IPD', ipd)):
            k = f'{m}_{dept}'
            # ก่อน START_MONTH เป็นตัวเลขที่กรอกเองมาตลอด — เติมเฉพาะเดือนที่ยังว่าง
            if n > 0 and data.get(k) != n and (m >= START_MONTH or not data.get(k)):
                ch.append(f'{dept} {data.get(k)}→{n}')
                data[k] = n
        return {'changed': bool(ch), 'ch': ch}

    r1 = update_doc('hosxp_records', mut_me, dry)
    r2 = update_doc('adr_records', mut_adr, dry)
    r3 = update_doc('hosxp_denom', mut_denom, dry)
    log(f'{m}: ME ใน HOSxP {len(me_rows)} → เพิ่ม {r1["added"]} (OPD {r1["cnt"]["OPD"]}, IPD {r1["cnt"]["IPD"]}) เติม {r1["filled"]} · '
        f'ADR ใน HOSxP {len(adr_items)} → เพิ่ม {r2["added"]} ผูก/เติม {r2["linked"]} AI ระบุอาการ {r2["ai"]} · '
        f'ตัวหาร OPD {opd:,} IPD {ipd:,} {"(" + ", ".join(r3["ch"]) + ")" if r3["ch"] else "(ไม่เปลี่ยน)"}'
        + (' [dry-run ไม่ได้เขียน]' if dry else ''))


def er_rx_counts(db, d_from, d_to):
    """{ 'YYYY-MM-DD': จำนวนผู้ป่วย ER ช่วง 19:30 คืนก่อน → 08:00 วันนั้น } ตามที่เภสัชนับใบสั่งยาเวรบ่าย-ดึก"""
    a = (dt.date.fromisoformat(d_from) - dt.timedelta(days=1)).isoformat()
    rows = q(db, "SELECT o.vstdate, o.vsttime FROM ovst o JOIN er_regist e ON e.vn=o.vn "
                 "WHERE o.vstdate>=%s AND o.vstdate<=%s", (a, d_to))
    out = {}
    for r in rows:
        t = dt.datetime.combine(r['vstdate'], dt.time()) + r['vsttime']
        if t.time() >= dt.time(19, 30):
            day = (t.date() + dt.timedelta(days=1)).isoformat()
        elif t.time() < dt.time(8, 0):
            day = t.date().isoformat()
        else:
            continue
        if d_from <= day <= d_to:
            out[day] = out.get(day, 0) + 1
    return out


def fill_er_rx(db, d_from, dry):
    # ครบ 24 ชม. หลังจบเวร (08:00 วันถัดไป) แล้วยังไม่มีใครกรอก จึงเติม
    now = dt.datetime.now()
    last = (now.date() - dt.timedelta(days=1 if now.time() >= dt.time(8, 0) else 2)).isoformat()
    counts = er_rx_counts(db, d_from, last) if last >= d_from else {}

    def mut(f):
        recs = f.setdefault('records', [])
        # วันที่เภสัชกรอกเองแล้ว → ลบแถวที่เคยเติมอัตโนมัติของวันนั้น (ใช้ค่าที่เภสัชกรอกเป็นหลัก)
        manual = {r.get('date') for r in recs if (r.get('rxDaily') or 0) > 0 and not r.get('rxAuto')}
        removed = [f"{r['date']}={r.get('rxDaily')}" for r in recs if r.get('rxAuto') and r.get('date') in manual]
        recs[:] = [r for r in recs if not (r.get('rxAuto') and r.get('date') in manual)]
        have = {r.get('date') for r in recs if (r.get('rxDaily') or 0) > 0}
        added = []
        base = int(time.time() * 1000)
        seq = max([r.get('seq') or 0 for r in recs] + [len(recs)])
        day = dt.date.fromisoformat(d_from)
        while day.isoformat() <= last:
            k = day.isoformat()
            n = counts.get(k, 0)
            if k not in have and n > 0:
                seq += 1
                recs.append({'id': base + len(added), 'seq': seq, 'date': k, 'time': '', 'hasME': False, 'rxType': 'ER',
                             'rxDaily': n, 'stage': '', 'meType': '', 'severity': '', 'drugs': [], 'drug': '', 'drugForm': '',
                             'ward': '', 'reporter': '', 'detail': '', 'intervention': '', 'source': 'hosxp_auto', 'rxAuto': True,
                             'rxAutoNote': f'เติมอัตโนมัติ {now:%Y-%m-%d %H:%M} — ไม่ได้กรอกภายใน 24 ชม.; ผู้ป่วย ER 19:30 คืนก่อน → 08:00 จาก HOSxP'})
                added.append(f'{k}={n}')
            day += dt.timedelta(days=1)
        return {'changed': bool(added or removed), 'added': added, 'removed': removed}

    r = update_doc('er_records', mut, dry)
    if r['removed']:
        log('ใบสั่งยา ER เภสัชกรอกเองแล้ว → ลบค่าที่เติมอัตโนมัติ ' + ', '.join(r['removed']) + (' [dry-run ไม่ได้เขียน]' if dry else ''))
    if r['added']:
        log('ใบสั่งยา ER ไม่ได้กรอกใน 24 ชม. → เติมให้ ' + ', '.join(r['added']) + (' [dry-run ไม่ได้เขียน]' if dry else ''))


def norm_hn(v):
    return str(v or '').strip().lstrip('0')


def ht_pm_counts(db, d_from, d_to):
    """{ 'YYYY-MM-DD': จำนวนผู้ป่วยนัดคลินิก HT (002 / 024 นัด LAB) ที่เภสัชกรคีย์จ่ายยา (ผู้จ่ายยา) ครั้งแรกหลัง 12:00
    และไม่มีบันทึกในหน้าคลินิก (clinic_YYYY-MM) วันนั้น } — นับเฉพาะวันที่มีคลินิก HT จริง (≥ 10 ราย)"""
    rows = q(db, """SELECT o.vstdate, o.hn, MIN(d.rx_dispenser_datetime) t FROM ovst o
      JOIN oapp a ON a.visit_vn=o.vn AND a.clinic IN ('002','024')
      JOIN rx_dispenser_detail d ON d.vn=o.vn AND d.rx_dispenser_type_id=4
      WHERE o.vstdate>=%s AND o.vstdate<=%s GROUP BY o.vstdate, o.hn""", (d_from, d_to))
    seen = {}  # วันที่ → HN ที่เภสัชบันทึกในหน้าคลินิกแล้ว (ได้พบเภสัช)
    for m in months_between(d_from[:7], d_to[:7]):
        try:
            d = http('GET', f'{FS}clinic_{m}?key={FS_KEY}')
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
            continue
        for r in from_fs(d.get('fields', {}).get('list', {'arrayValue': {}})):
            seen.setdefault(r.get('date'), set()).add(norm_hn(r.get('hn')))
    total, out = {}, {}
    for r in rows:
        k = s(r['vstdate'])
        total[k] = total.get(k, 0) + 1
        if r['t'].time() >= dt.time(12, 0) and norm_hn(r['hn']) not in seen.get(k, set()):
            out[k] = out.get(k, 0) + 1
    return {k: n for k, n in out.items() if total[k] >= 10}


def fill_ht_pm(db, d_from, dry):
    # คิดใหม่ย้อนหลัง 14 วันทุกรอบ เผื่อเภสัชบันทึกคลินิกตามทีหลัง (ค่าที่เติมอัตโนมัติปรับตาม; ค่าที่กรอกเองไม่แตะ)
    now = dt.datetime.now()
    last = (now.date() - dt.timedelta(days=1)).isoformat()
    first = max(d_from, (now.date() - dt.timedelta(days=14)).isoformat())
    if last < first:
        return
    counts = ht_pm_counts(db, first, last)

    def mut(f):
        recs = f.setdefault('sessionRecords', [])
        manual = {r.get('date') for r in recs if r.get('clinic') == 'HT' and r.get('pmOnly') and not r.get('htPmAuto')}
        removed = [r['date'] for r in recs if r.get('htPmAuto') and r.get('date') in manual]
        recs[:] = [r for r in recs if not (r.get('htPmAuto') and r.get('date') in manual)]
        auto = {r.get('date'): r for r in recs if r.get('htPmAuto')}
        added, changed = [], []
        for k in sorted(counts):
            n = counts[k]
            if k < first or k in manual:
                continue
            note = f'🗄 อัตโนมัติจาก HOSxP — นัด HT ที่จ่ายยาหลัง 12:00 และไม่มีบันทึกคลินิก ({now:%Y-%m-%d %H:%M})'
            if k in auto:
                if auto[k].get('htPmCount') != n:
                    changed.append(f"{k}={auto[k].get('htPmCount')}→{n}")
                    auto[k].update(htPmCount=n, notes=note)
                continue
            recs.append({'id': f'htpm-auto-{k}', 'date': k, 'clinic': 'HT', 'attended': None, 'pharmacist': '', 'reason': '',
                         'htPmCount': n, 'notes': note, 'pmOnly': True, 'htPmAuto': True, 'created': int(time.time() * 1000)})
            added.append(f'{k}={n}')
        if added or changed or removed:
            f['updated'] = int(time.time() * 1000)
        return {'changed': bool(added or changed or removed), 'added': added, 'ch': changed, 'removed': removed}

    r = update_doc('clinic_data', mut, dry, mask=['sessionRecords', 'updated'])
    tag = ' [dry-run ไม่ได้เขียน]' if dry else ''
    if r['removed']:
        log('HT บ่าย กรอกเองแล้ว → ลบค่าที่เติมอัตโนมัติ ' + ', '.join(r['removed']) + tag)
    if r['added'] or r['ch']:
        log('HT บ่าย เติมอัตโนมัติ ' + ', '.join(r['added'] + r['ch']) + tag)


# ── DRP จาก COUNSELLING ใน HOSxP → clinic_YYYY-MM ────────────────────────────────
# เภสัชพิมพ์ DRP ในช่องวิธีใช้ของรายการ "COUNSELLING น้อยกว่า 30 นาที" (icode 3000589) ข้อความอยู่ใน opi_dispense.usage_line1-4
# ทุกรอบดึงย้อนหลัง 14 วัน (ถึงเมื่อวาน ให้เภสัชลงหน้าคลินิกเองในวันนั้นก่อน):
#   - มีบันทึกคลินิก HN+วันเดียวกันแล้ว → แนบข้อความ HOSxP (hxNote) และเติม DRP เฉพาะรายการที่ยังไม่มี DRP
#   - ยังไม่มี → เพิ่มบันทึกใหม่ id 'hx<vn>' (source 'hosxp') — ถ้าเภสัชลบทิ้งแล้ว (deletedVisitIds) ไม่เพิ่มกลับ
# ข้ามข้อความที่ซ้ำกับครั้งก่อนของ HN เดียวกัน: แพทย์ re-med ใบสั่งยาเก่าแล้วรายการ COUNSELLING ติดมาด้วย
COUNSEL_ICODE = '3000589'
DRP_FULL = {
    'WT': 'รับประทานยาผิดวิธีใช้ (Improper Drug Use Technique)',
    'WD': 'รับประทานยาผิดขนาด (Incorrect Dose Taken by Patient)',
    'SA': 'ปรับขนาด/เวลารับประทานยาเอง (Self-Adjusted Dose or Timing – Nonadherence)',
    'NC': 'ไม่ใช้ยาตามแพทย์สั่ง (Noncompliance / Nonadherence)',
    'MD': 'ลืมรับประทานยาบางมื้อ/บางวัน (Missed Dose – Nonadherence)',
    'MEAL': 'ไม่ได้รับประทานอาหารเที่ยงจึงงดใช้ยา (Missed Dose Due to Skipped Meal)',
    'ADR': 'เกิดอาการไม่พึงประสงค์จากการใช้ยา (Adverse Drug Reaction, ADR)',
    'DI': 'เกิดปฏิกิริยาระหว่างยา (Drug Interaction)',
    'DUP': 'ได้รับยาซ้ำซ้อนจากหลายสถานพยาบาล (Therapeutic Duplication)',
    'TM': 'มีการปรับเปลี่ยนแผนการรักษาโดยแพทย์ (Therapy Modification)',
    'MF': 'มาผิดนัด/ขาดนัดติดตามการรักษา (Missed Follow-up Appointment)',
    'LO': 'มียาเหลือสะสม (Medication Nonadherence – Leftover Medication)',
    'ED': 'ยาหมดก่อนถึงวันนัด (Early Medication Depletion – Overuse)',
    'RXD': 'ได้รับยาผิดขนาดจากการสั่งจ่าย (Incorrect Dosage – Prescribing/Dispensing Error)',
    'OTH': 'อื่นๆ (Others)',
}
COUNSEL_PHARM = {'boom': 'ภก.พงศ์ไพสิฐ บรรจงเมือง', 'Pongsagorn': 'ภก.พงศกร นวเลิศปัญญา', 'Somruedee': 'ภญ.สมฤดี คงศรี',
                 'saranya': 'ภญ.ศรัญญา จันทร์ธิบดี'}
COUNSEL_CLINIC = {'001': 'DM', '023': 'DM', '002': 'HT', '024': 'HT', '013': 'COPD'}
DRP_SYM = 'แพทย์สั่งให้ทานทุกวัน แต่ผู้ป่วยทานเมื่อมีอาการเท่านั้น'
DRP_SADR = 'เกิด ADR หลังทานยา'
DRP_DOSE = r'\d(?:\.\d+|/\d)?\s*[x*\-]\s*\d[^>]{0,12}(?:-+\s*>|>>|→)'   # "1x4pc>>1x2pc", "2*4-->2*3", "18-0-12ac>>18-0-9"
DRP_WRONG = r'(ทาน|กิน|ใช้|ฉีด)(ยา)?\s?[^\s,]{0,20}\s?ผิด(?!นัด)|ผิดวิธี'
# (รหัส, เงื่อนไข, สาเหตุ) ตรวจทั้งข้อความ ได้หลาย DRP (ประเภทละครั้ง) — ตรงกับที่จัดเองทีละข้อความ 257/280 ข้อความของปีงบ 69
# ตามแบบที่ทีมใช้: "ทานยาผิด X 1x4>>1x2" = ผิดวิธีใช้, COPD "ไม่หอบเลยไม่ใช้ ICS" = ปรับยาเอง (ใช้เมื่อมีอาการ)
DRP_RULES = [
    ('DI', r'\bDI\b|interaction|ปฏิกิริยาระหว่างยา', ''),
    ('ADR', r'ADR|\bs/e\b|hypogly|น้ำตาลต่ำ|ไอแห้ง|dry cough|\bcough\b|เท้าบวม|ขาบวม|ผื่น|แพ้ยา|ใจสั่น|ง่วง|เวียนศีรษะ|เวียนหัว', ''),
    ('SA', r'ไม่(ค่อย)?หอบ.{0,6}ไม่(ค่อย)?(ได้)?ใช้|ไม่มีอาการ.{0,6}ไม่(ค่อย)?(ได้)?(ใช้|กิน|ทาน)|ดีขึ้น.{0,8}ไม่(ใช้|กิน|ทาน)|เมื่อมีอาการ|ตอนปวด', DRP_SYM),
    ('SA', r'วัดความดันที่บ้าน|BP ที่บ้าน|เจาะน้ำตาลที่บ้าน|DTX', 'ตรวจวัดความดัน/DTX เองที่บ้าน'),
    ('SA', r'คุมอาหาร(?!ไม่ได้)', 'ผู้ป่วยควบคุมอาหาร จึงไม่ทานยา'),
    ('SA', r'(ปรับ|ปรั|ลด|หยุด|เพิ่ม|กิน|ทาน)[^,.]{0,25}เอง|ญาติ(ลด|ปรับ)|ลูก(ลด|ปรับ)|คิดว่า(ทาน|กิน)(ยา)?มาก|(จะ|เลย|จึง)หยุด|เลือกกิน', ''),
    ('MF', r'ผิดนัด|ขาดนัด', ''),
    ('ED', r'หมดก่อน|ยาหาย', ''),
    ('LO', r'มียา(เดิม)?เหลือ|ยา(เดิม)?ที่เหลือ(?!ไม่ได้)|เหลือเยอะ|leftover', ''),
    ('MEAL', r'อาหารเที่ยงไม่|ไม่(ค่อย)?(ได้)?(กิน|ทาน)(ข้าว|อาหาร)?(มื้อ)?เที่ยง.{0,6}(จึง|เลย)|รวบมื้อ', ''),
    ('MD', r'ลืม|missed', ''),
    ('MD', r'ไม่(ค่อย)?(ได้)?(ทาน|กิน|ฉีด)(ยา)?.{0,30}(มื้อ|ก่อนนอน)|(เช้า|เที่ยง|เย็น)ไม่(ได้)?(ฉีด|ทาน|กิน)', ''),
    ('NC', r'ไม่สม่ำเสมอ|ไม่ส่ำเสมอ|ไม่สมำเสมอ|ไม่ค่อย(ทาน|กิน|ใช้|ฉีด)|ไม่(ทาน|กิน|ใช้|ฉีด)ยา|ไม่ยอม|ไม่สะดวกฉีด|ไม่ใช้ยาตามสั่ง|ใช้\s?\S*\s?สม่ำเสมอตามแพทย์สั่ง', ''),
    ('WD', r'ผิดขนาด', ''),
    ('WT', DRP_WRONG + '|' + DRP_DOSE + r'|\d\s*puff.{0,10}(->|>>)|อ่านหนังสือไม่ออก', ''),
    ('TM', r'consult.{0,15}(ปรับ|เปลี่ยน|off|เพิ่ม)|(แพทย์|รพ\.?\s?\S+|หมอ)\s*(ปรับ|เปลี่ยน|off|เพิ่ม)|\boff\b', ''),
    ('DUP', r'ร้านยา', ''),
    ('RXD', r'GFR.{0,20}(ขนาด|ไม่ควรเกิน|ลด)', ''),
    ('OTH', r'สมุนไพร|ยาชุด|ยาต้ม|ยาของ(ผู้อื่น|คนอื่น|น้อง|พี่|ลูก)|รพ\.?\s?สต|ไม่ทราบฉีด', ''),
]
DRP_LABEL = [(r'ไม่อ่านฉลาก', 'ไม่อ่านฉลาก'), (r'วิธีใช้เก่า|ฉลากเก่า|อ่านฉลากใหม่', 'ไม่อ่านฉลากเป็นปัจจุบัน'), (r'อ่านฉลากผิด', 'อ่านฉลากผิด')]


def classify_drp(text):
    """ข้อความ COUNSELLING → [{type, cause, causeNote}] ตามกฎคำหลัก ([] = ไม่ใช่ DRP เช่นให้คำแนะนำ/ข้อมูลยาจาก รพ. อื่น)"""
    t = text or ''
    out = []
    for code, rx, cause in DRP_RULES:
        if not any(c == code for c, _ in out) and re.search(rx, t, re.I):
            out.append((code, cause))
    has = lambda c: any(x == c for x, _ in out)  # noqa: E731
    drop = lambda c: [x for x in out if x[0] != c]  # noqa: E731
    wrong = re.search(DRP_WRONG, t)
    if has('ADR') and re.search(r'ไม่น่าจะ|ไม่ได้เกิดจาก', t):
        out = drop('ADR')
    # ปรับ/หยุดยาเองเพราะอาการข้างเคียง (ไม่ได้เขียนว่า ADR) → "ปรับยาเอง: เกิด ADR หลังทานยา" ข้อเดียว
    if has('SA') and has('ADR') and not re.search(r'ADR|s/e|hypogly', t, re.I):
        out = [(c, DRP_SADR if c == 'SA' and not k else k) for c, k in drop('ADR')]
    if (has('SA') or has('MD') or has('MEAL') or has('TM')) and has('WT') and not wrong:
        out = drop('WT')
    if has('WD'):
        out = drop('WT')
    if (has('MD') or has('SA') or has('MEAL')) and has('NC') and not re.search(r'ไม่ใช้ยาตามสั่ง', t):
        out = drop('NC')
    if has('MEAL'):
        out = drop('MD')
    if has('MD') and re.search(r'ทานยาสม่ำเสมอ|ไม่ขาดยา', t):
        out = drop('MD')
    if has('TM') and has('ADR') and re.search(r'off', t, re.I) and not re.search(r'ADR\s*[a-z]|เท้าบวม|ไอ', t, re.I):
        out = drop('ADR')
    if has('ED') and has('MF'):
        out = [(c, 'ผิดนัด' if c == 'ED' else k) for c, k in out]
    res = []
    for c, k in out:
        if c == 'WT' and not k:
            k = next((v for rx, v in DRP_LABEL if re.search(rx, t)), '')
        if c == 'MD' and not k:
            k = ('ไม่ได้ทานอาหารเช้า' if re.search(r'ไม่(ค่อย)?(ได้)?(ทาน|กิน)(อาหาร|ข้าว)?(มื้อ)?เช้า|ลืมมื้อเช้า', t) else
                 'ไม่ได้ทานอาหารเที่ยง' if re.search(r'ไม่(ได้)?(ทาน|กิน)(อาหาร|ข้าว)(มื้อ)?เที่ยง', t) else
                 'ลืมทานมื้อก่อนนอน' if re.search('ก่อนนอน', t) else '')
        res.append({'type': DRP_FULL[c], 'cause': k, 'causeNote': ''})
    return res


def counsel_rows(db, d_from, d_to):
    """ข้อความ COUNSELLING ช่วงวันที่ (ไม่รวมแถวว่าง = แค่คิดค่าบริการ และข้อความที่ re-med มาจากครั้งก่อน)"""
    txt = ("TRIM(CONCAT_WS(' ', NULLIF(TRIM(x.usage_line1),'.'), NULLIF(TRIM(x.usage_line2),'.'), NULLIF(TRIM(x.usage_line3),'.'), "
           "NULLIF(NULLIF(TRIM(x.usage_line4),'.'),'#')))")
    rows = q(db, f"""SELECT o.vn, o.hn, o.vstdate, o.staff, x.modify_staff ms, v.main_dep, {txt} t,
        TRIM(CONCAT(IFNULL(p.pname,''), IFNULL(p.fname,''), '  ', IFNULL(p.lname,''))) ptname
      FROM opitemrece o JOIN opi_dispense x ON x.hos_guid=o.hos_guid LEFT JOIN ovst v ON v.vn=o.vn LEFT JOIN patient p ON p.hn=o.hn
      WHERE o.icode=%s AND o.vstdate>=%s AND o.vstdate<=%s ORDER BY o.vstdate, o.vn""", (COUNSEL_ICODE, d_from, d_to))
    norm = lambda v: re.sub(r'\s+', ' ', v or '').strip()  # noqa: E731
    rows = [r for r in rows if norm(r['t'])]
    if not rows:
        return []
    hns = sorted({r['hn'] for r in rows})
    prior = q(db, f"""SELECT o.hn, MIN(o.vstdate) d, {txt} t FROM opitemrece o JOIN opi_dispense x ON x.hos_guid=o.hos_guid
      WHERE o.icode=%s AND o.hn IN ({','.join(['%s'] * len(hns))}) GROUP BY o.hn, t""", (COUNSEL_ICODE, *hns))
    first = {(p['hn'], norm(p['t'])): p['d'] for p in prior}
    out, seen = [], set()
    for r in rows:
        r['t'] = norm(r['t'])
        key = (r['hn'], s(r['vstdate']))
        if first.get((r['hn'], r['t']), r['vstdate']) < r['vstdate'] or key in seen:
            continue
        seen.add(key)
        appt = sorted({a['clinic'] for a in q(db, 'SELECT clinic FROM oapp WHERE hn=%s AND nextdate=%s', (r['hn'], r['vstdate']))})
        clinic = next((COUNSEL_CLINIC[c] for c in appt if c in COUNSEL_CLINIC), None)
        if not clinic and r['main_dep'] == '028':
            clinic = 'COPD'
        if not clinic and r['vn']:
            dx = [d['icd10'] or '' for d in q(db, 'SELECT icd10 FROM ovstdiag WHERE vn=%s', (r['vn'],))]
            clinic = next((c for pre, c in (('J44', 'COPD'), ('E1', 'DM'), ('I1', 'HT')) if any(d.startswith(pre) for d in dx)), None)
        r['clinic'] = clinic or 'HT'
        out.append(r)
    return out


def fill_counsel_drp(db, d_from, dry):
    today = dt.date.today()
    last = (today - dt.timedelta(days=1)).isoformat()
    first = max(d_from, (today - dt.timedelta(days=14)).isoformat())
    if last < first:
        return
    rows = counsel_rows(db, first, last)
    if not rows:
        return
    try:
        dead = set(from_fs(http('GET', f'{FS}clinic_data?key={FS_KEY}')['fields'].get('deletedVisitIds', {'arrayValue': {}})))
    except (urllib.error.HTTPError, KeyError):
        dead = set()
    tag = ' [dry-run ไม่ได้เขียน]' if dry else ''
    for m in sorted({s(r['vstdate'])[:7] for r in rows}):
        mine = [r for r in rows if s(r['vstdate']).startswith(m)]

        def mut(f, mine=mine):
            lst = f.setdefault('list', [])
            by_key = {}
            for v in lst:
                by_key.setdefault((norm_hn(v.get('hn')), v.get('date')), v)
            ids, vns = {v.get('id') for v in lst}, {v.get('hxVn') for v in lst if v.get('hxVn')}
            added, patched = [], []
            for r in mine:
                d, vn, drps = s(r['vstdate']), s(r['vn']), classify_drp(r['t'])
                v = by_key.get((norm_hn(r['hn']), d))
                if v:
                    if v.get('hxNote'):
                        continue
                    v['hxNote'], v['hxVn'] = r['t'], vn
                    if drps and not v.get('drps'):
                        v['drps'], v['drpAuto'] = drps, True
                    patched.append(f"{r['hn']}/{d}")
                    continue
                rid = 'hx' + (vn or f"{r['hn']}{d.replace('-', '')}")
                if rid in ids or rid in dead or (vn and vn in vns):
                    continue
                lst.append({'id': rid, 'date': d, 'clinic': r['clinic'], 'hn': r['hn'], 'name': r['ptname'] or '',
                            'pharmacist': COUNSEL_PHARM.get(r['ms']) or COUNSEL_PHARM.get(r['staff'], ''),
                            'notes': '', 'pharmNote': '', 'drps': drps, 'leftovers': [], 'totalSaving': 0,
                            'created': int(dt.datetime.fromisoformat(d + 'T10:00:00').timestamp() * 1000),
                            'source': 'hosxp', 'hxVn': vn, 'hxNote': r['t'], 'drpAuto': bool(drps)})
                added.append(f"{r['hn']}/{d}:{len(drps)}")
            if added or patched:
                f['updated'] = int(time.time() * 1000)
            return {'changed': bool(added or patched), 'added': added, 'patched': patched}

        r = update_doc(f'clinic_{m}', mut, dry, mask=['list', 'updated'])
        if r.get('added') or r.get('patched'):
            log(f"DRP COUNSELLING clinic_{m}: เพิ่ม {len(r['added'])} ราย ({', '.join(r['added'])})"
                f"; แนบข้อความให้บันทึกเดิม {len(r['patched'])} ราย{tag}")


def months_between(a, b):
    y, mo = map(int, a.split('-'))
    out = []
    while f'{y:04d}-{mo:02d}' <= b:
        out.append(f'{y:04d}-{mo:02d}')
        y, mo = (y + 1, 1) if mo == 12 else (y, mo + 1)
    return out


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:  # noqa: BLE001
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument('--month', help='ดึงเฉพาะเดือนนี้ (YYYY-MM)')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--er-from', default=ER_RX_START, help='เติมใบสั่งยา ER ที่ขาดตั้งแต่วันนี้ (YYYY-MM-DD)')
    ap.add_argument('--ht-from', default=HT_PM_START, help='เติมจำนวนคนไข้ HT บ่ายตั้งแต่วันนี้ (YYYY-MM-DD; คิดย้อนหลังสูงสุด 14 วัน)')
    ap.add_argument('--counsel-from', default=COUNSEL_START, help='ดึง DRP จาก COUNSELLING ตั้งแต่วันนี้ (YYYY-MM-DD; ย้อนหลังสูงสุด 14 วัน)')
    args = ap.parse_args()

    today = dt.date.today()
    prev = (today.replace(day=1) - dt.timedelta(days=1)).strftime('%Y-%m')
    try:
        with open(STATE_FILE, encoding='utf-8') as f:
            state = json.load(f)
    except (OSError, ValueError):
        state = {}
    done = state.setdefault('done', {})
    if args.month:
        months = [args.month]
    else:
        months = [m for m in months_between(START_MONTH, prev) if m not in done]
        if today.day <= 7 and prev >= START_MONTH and prev not in months:
            months.append(prev)

    try:  # กันรันซ้อน (ตอน logon กับรอบเช้าชนกัน)
        if os.path.exists(LOCK_FILE) and time.time() - os.path.getmtime(LOCK_FILE) < 3600:
            log('มีอีกรอบกำลังรันอยู่ — ข้าม')
            return
        open(LOCK_FILE, 'w').close()
    except OSError:
        pass
    try:
        db = db_connect()
        try:
            fill_er_rx(db, args.er_from, args.dry_run)
        except Exception as e:  # noqa: BLE001 — ไม่ให้ขวางการดึงรายเดือน
            log(f'ใบสั่งยา ER ผิดพลาด: {type(e).__name__}: {e}')
        try:  # ก่อน HT บ่าย: คนไข้ที่เภสัชให้คำปรึกษา (มีบันทึกคลินิก) ไม่นับเป็น HT บ่าย
            fill_counsel_drp(db, args.counsel_from, args.dry_run)
        except Exception as e:  # noqa: BLE001
            log(f'DRP COUNSELLING ผิดพลาด: {type(e).__name__}: {e}')
        try:
            fill_ht_pm(db, args.ht_from, args.dry_run)
        except Exception as e:  # noqa: BLE001
            log(f'HT บ่าย ผิดพลาด: {type(e).__name__}: {e}')
        for m in months:
            sync_month(db, m, args.dry_run)
            if not args.dry_run:
                done[m] = dt.datetime.now().isoformat(timespec='seconds')
                with open(STATE_FILE, 'w', encoding='utf-8') as f:
                    json.dump(state, f, ensure_ascii=False, indent=1)
        db.close()
    except Exception as e:  # noqa: BLE001
        log(f'ผิดพลาด: {type(e).__name__}: {e}')
        sys.exit(1)
    finally:
        try:
            os.remove(LOCK_FILE)
        except OSError:
            pass


if __name__ == '__main__':
    main()
