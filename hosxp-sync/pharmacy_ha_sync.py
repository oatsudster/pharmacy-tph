"""ตัวชี้วัดงานเภสัชกรรมตามมาตรฐาน HA (ระบบจัดการด้านยา) จาก HOSxP → Firestore pharmacy_tph/pharmacy_ha → หน้า pharmacy-ha.html

รันด้วย Task Scheduler บนเครื่อง รพ. ที่ต่อฐานข้อมูล HOSxP ได้ (ใช้ db.json เดียวกับ HOSxP Bridge, SELECT อย่างเดียว)
คำนวณใหม่ทั้งหมดทุกครั้งตั้งแต่ปีงบ 2568 (ต.ค. 67) — รหัสโรคที่ลงย้อนหลังจึงเข้ามาเอง

  rdu      : ตัวชี้วัด RDU Hospital 12 ตัว (อย. ปีงบ 2566 ใช้ 2565-2569) + ตัวเฝ้าระวัง (ยา/ครั้ง, ยาบัญชีหลัก, ADE trigger)
             นิยาม รหัสโรค กลุ่มยา ATC และเป้าหมาย อ่านจากตาราง rdu_* ของ HOSxP เอง (edition FY2566)
             รายการยาของ รพ. ยังไม่มี atc_code → จับคู่ชื่อยากับ rdu_tmt_substance_atc + NAME_RULES (+ ha_atc_overrides.json แก้เอง)
  allergy  : จ่ายยาที่ผู้ป่วยมีประวัติแพ้ (opd_allergy ที่ไม่ใช่ Type A และไม่ถูกยกเลิก) หลังวันที่บันทึกแพ้ — เป้าหมาย 0
  medrec   : ผู้ป่วยในที่ทำ Medication reconciliation (med_recon / medication_reconciliation) ต่อจำนวน admit
  wait     : เวลารอรับยา OPD = เข้าคิวห้องจ่ายยา (opd_dep_queue 030) → บันทึกจ่ายยา (rx_dispenser_detail 030)

Firestore เก็บเฉพาะตัวเลขรวมและรายการยา (ไม่มี HN/ชื่อ/VN) — รายเคสที่ต้องทบทวนเก็บในเครื่องที่
%LOCALAPPDATA%\\HOSxPBridge\\ha-cases.json ให้ HOSxP Bridge เปิดให้หน้าเว็บอ่านที่ /db/hacases (เฉพาะเครื่องที่รันสคริปต์นี้)

ใช้: python pharmacy_ha_sync.py [--dry-run] [--atc-report]
"""
import argparse
import datetime as dt
import json
import os
import re
import sys
import time
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hosxp_monthly_sync as hx  # noqa: E402  (ใช้ db_connect / Firestore REST ร่วมกัน)

START_MONTH = '2024-10'  # ปีงบ 2568
LOOKBACK_DAYS = 183  # ตัวชี้วัดที่ย้อนดู 6 เดือน (eGFR, ตั้งครรภ์)
EDITION = 'FY2566'
SCORED = ['RI', 'AD', 'FTW', 'APL', 'RAS', 'NSAID-CKD', 'METFORMIN', 'NSAID-DUP', 'ICS', 'LA-BZD', 'NSAH', 'PREG']
WATCH = ['M-DRUGS-PER-VISIT', 'M-NLEM-SHARE', 'M-ADE-STEROID', 'M-ADE-NSAID-GIB', 'M-ADE-AKI', 'M-ADE-ALLERGY',
         'M-ADE-WARFARIN-BLEED']
PREG_END_SET = 'RDU-LABOUR-ABORTION-ICD10'
HOSPITAL_LEVEL = 'F2'  # รพช. ขนาดกลาง — ใช้เลือกเป้าหมายจาก target_by_level (F1-F3 เป้าเท่ากันทุกตัว)
EGFR_LAB = '3189'
PHARMACY_DEP = '030'
MEDREC_PRIOR_DAYS = 180
DOC = 'pharmacy_ha'
HOME = hx.HOME
CASES_FILE = os.path.join(HOME, 'ha-cases.json')
LOCK_FILE = os.path.join(HOME, 'ha-sync.lock')
OVERRIDES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ha_atc_overrides.json')
hx.LOG_FILE = os.path.join(HOME, 'ha-sync.log')
log = hx.log
s = hx.s

# ชื่อยาใน รพ. ที่ไม่ตรงกับชื่อสาร TMT → ATC (เพิ่มจากการจับคู่ชื่อ ไม่ทับ)
NAME_RULES = [
    (r'amox', ['J01CA04']),
    (r'augmentin|clavul', ['J01CR02']),
    (r'cloraz', ['N05BA05']),
    (r'cafergot|ergotamine', ['N02CA52']),
    (r'seroflo|seretide', ['R03AK06']),
    (r'symbicort', ['R03AK07']),
    (r'berodual', ['R03AL01']),
    (r'acyclovir', ['J05AB01']),
    (r'\bcpm\b|piriton', ['R06AB04']),
    (r'hyoscine|hyosicne|buscopan', ['A03BB01']),
]
# บันทึกแพ้ที่ระบุว่าแพ้เฉพาะยี่ห้อ / ยี่ห้ออื่นกินได้ / เคยได้ยาแล้วไม่มีอาการ → ไม่นับเป็นแพ้ยาซ้ำ (แสดงแยก)
BRAND_ONLY = re.compile(r'ยี่ห้อ|เฉพาะ|กินได้|ทานได้|ใช้ได้|สามารถ|ไม่มีอาการ|ไม่แพ้|บริษัท|\(R\)|®')
CLS_RANK = {'count': 0, 'unspec': 1, 'brand': 2, 'watch': 3}
# ชื่อกลุ่มยาที่บันทึกแพ้ (agent) → ATC ทั้งกลุ่ม
ALLERGY_CLASSES = [
    (r'penicillin|penicilin', ('J01C',)),
    (r'cephalo|cephem|cef\b', ('J01DB', 'J01DC', 'J01DD', 'J01DE')),
    (r'sulfa|sulpha|sulfonamide', ('J01E',)),
    (r'quinolone', ('J01M',)),
    (r'nsaid', ('M01A',)),
    (r'macrolide', ('J01FA',)),
    (r'tetracycline', ('J01AA',)),
]


def months_between(a, b):
    return hx.months_between(a, b)


def month_of(iso):
    return iso[:7]


def fy_of(month):  # '2026-10' → 2570 (ปีงบ พ.ศ.)
    y, m = map(int, month.split('-'))
    return y + 543 + (1 if m >= 10 else 0)


def fy_months(fy, last):
    y = fy - 543
    return [m for m in months_between(f'{y - 1}-10', f'{y}-09') if m <= last]


def add_days(iso, n):
    return (dt.date.fromisoformat(iso) + dt.timedelta(days=n)).isoformat()


def next_month(m):
    y, mo = map(int, m.split('-'))
    return f'{y + (mo == 12):04d}-{mo % 12 + 1:02d}'


# ── รายการยา → ATC ────────────────────────────────────────────────────────────
SALT = {'hcl', 'hydrochloride', 'sodium', 'potassium', 'calcium', 'magnesium', 'maleate', 'besylate', 'besilate',
        'mesylate', 'mesilate', 'succinate', 'tartrate', 'citrate', 'sulfate', 'sulphate', 'phosphate', 'acetate',
        'fumarate', 'bromide', 'chloride', 'disodium', 'dihydrate', 'trihydrate', 'monohydrate', 'anhydrous',
        'hydrobromide', 'dipropionate', 'propionate', 'furoate', 'xinafoate', 'base', 'free'}


def norm_words(text):
    return [w for w in re.sub(r'[^a-z]+', ' ', (text or '').lower()).split() if len(w) > 1]


def route_of(name, form):
    t = f'{name} {form}'.lower()
    if re.search(r'inj|vial|\bamp\b|ampoule|infusion|\bi\.?v\b', t):
        return 'INJ'
    if re.search(r'mdi|inhal|accuhaler|evohaler|turbuhaler|easyhaler|ellipta|respimat|rotacap|\bdpi\b|\bnb\b|nebu', t):
        return 'INHAL'
    if re.search(r'\beye|oph\b|\bear\b|\botic', t):
        return 'EYE_EAR'
    if re.search(r'cream|oint|\bgel\b|lotion|paint|topical|patch|shampoo|paste', t):
        return 'SKIN'
    if re.search(r'nasal|\bnose', t):
        return 'NASAL'
    if re.search(r'supp|enema|rectal|vag|pessary', t):
        return 'RECTAL'
    return 'ORAL'


def pick_atcs(cands, route):
    """ATC หลายรหัสของสารเดียวกัน (เช่น chloramphenicol J01/S01/D06) → เลือกตามรูปแบบยา"""
    if route in ('ORAL', 'INJ', 'RECTAL'):
        keep = [a for a in cands if not a.startswith(('D', 'S', 'R01', 'A01'))]
    elif route == 'EYE_EAR':
        keep = [a for a in cands if a.startswith('S')]
    elif route == 'SKIN':
        keep = [a for a in cands if a.startswith('D')]
    elif route == 'NASAL':
        keep = [a for a in cands if a.startswith('R01')]
    else:  # INHAL
        keep = [a for a in cands if a.startswith('R03')]
    return sorted(set(keep or ([] if route in ('EYE_EAR', 'SKIN', 'NASAL') else cands)))


def substance_index(db):
    subs = defaultdict(set)
    for r in hx.q(db, "SELECT substance_name, atc_code FROM rdu_tmt_substance_atc WHERE atc_code<>''", None):
        words = [w for w in norm_words(s(r['substance_name'])) if w not in SALT]
        if words:
            subs[' '.join(words)].add(s(r['atc_code']))
    syn = {}
    for r in hx.q(db, "SELECT synonym_name, inn_name FROM rdu_drug_name_synonym", None):
        a, b = ' '.join(norm_words(s(r['synonym_name']))), ' '.join(norm_words(s(r['inn_name'])))
        if a and b:
            syn[a] = b
    return subs, syn, sorted(subs, key=lambda k: -len(k))


def find_substances(text, syn, keys):
    t = ' ' + ' '.join(norm_words(text)) + ' '
    for a, b in syn.items():
        t = t.replace(f' {a} ', f' {a} {b} ')
    found = []
    for k in keys:  # ชื่อยาวก่อน (หลายคำ) แล้วตัดออก กันจับซ้ำเป็นชื่อสั้น
        if f' {k} ' in t:
            found.append(k)
            t = t.replace(f' {k} ', ' ')
    return found


def build_atc_map(db, subs, syn, keys):
    """icode → {name, strength, route, atcs[], subst[], nlem, active}"""
    try:
        with open(OVERRIDES_FILE, encoding='utf-8') as f:
            over = json.load(f).get('icode', {})
    except (OSError, ValueError):
        over = {}
    out = {}
    for r in hx.q(db, "SELECT icode, name, generic_name, strength, dosageform, drugaccount, istatus FROM drugitems", None):
        icode, name, form = s(r['icode']), s(r['name']), s(r['dosageform'])
        found = find_substances(f"{name} {s(r['generic_name'])}", syn, keys)
        route = route_of(name, form)
        atcs = {a for k in found for a in pick_atcs(sorted(subs[k]), route)}
        low = name.lower()
        for pat, extra in NAME_RULES:
            if re.search(pat, low):
                atcs.update(extra)
        atcs = sorted(atcs)
        o = over.get(icode)
        if isinstance(o, dict):
            atcs, route = o.get('atc', atcs), o.get('route', route)
        out[icode] = {'name': name.strip(), 'strength': s(r['strength']).strip(), 'route': route, 'atcs': atcs,
                      'subst': found, 'nlem': s(r['drugaccount']).strip() not in ('', '-'), 'active': s(r['istatus']) == 'Y'}
    return out


# ── นิยามตัวชี้วัดจาก HOSxP ──────────────────────────────────────────────────────
def load_spec(db):
    inds = {}
    for r in hx.q(db, "SELECT * FROM rdu_indicator WHERE edition_code=%s AND active='Y'", (EDITION,)):
        r = {k: s(v) for k, v in r.items()}
        if r['indicator_code'] in SCORED + WATCH:
            inds[r['indicator_code']] = r
    sets = defaultdict(list)
    for r in hx.q(db, "SELECT c.set_code, i.code_from, i.code_to, i.is_exclude FROM rdu_code_set c "
                      "JOIN rdu_code_set_item i ON i.rdu_code_set_id=c.rdu_code_set_id WHERE c.active='Y'", None):
        sets[s(r['set_code'])].append((s(r['code_from']).upper(), s(r['code_to']).upper(), s(r['is_exclude']) == 'Y'))
    groups = defaultdict(list)
    for r in hx.q(db, "SELECT g.group_code, m.* FROM rdu_drug_group g JOIN rdu_drug_group_member m "
                      "ON m.rdu_drug_group_id=g.rdu_drug_group_id WHERE g.active='Y'", None):
        groups[s(r['group_code'])].append({k: s(r[k]) for k in ('member_kind', 'member_code', 'sub_class', 'route_scope',
                                                                 'except_code_set', 'is_exclude', 'member_name')})
    ed = hx.q(db, "SELECT edition_name, pass_min_count, pass_rule_text FROM rdu_indicator_edition WHERE edition_code=%s", (EDITION,))
    edition = {k: s(v) for k, v in ed[0].items()} if ed else {}
    return inds, dict(sets), dict(groups), edition


def in_set(code, items):
    code = (code or '').upper().replace('.', '')
    hit = False
    for a, b, excl in items:
        if b:
            n = len(a)
            ok = a <= code[:n] <= b[:n] if len(b) == n else (a <= code[:n] and code[:len(b)] <= b)
        else:
            ok = code.startswith(a)
        if ok:
            if excl:
                return False
            hit = True
    return hit


def group_icodes(groups, atc_map):
    """group_code → {icode: sub_class} (ตาม ATC + route_scope, ตัดสมาชิก is_exclude)"""
    out = {}
    for g, members in groups.items():
        sel = {}
        for icode, d in atc_map.items():
            inc, sub = False, ''
            for mem in members:
                if mem['member_kind'] != 'ATC' or not any(a.startswith(mem['member_code']) for a in d['atcs']):
                    continue
                scope = [x for x in mem['route_scope'].split(',') if x]
                if scope and d['route'] not in scope:
                    continue
                if mem['is_exclude'] == 'Y':
                    inc = False
                    break
                inc, sub = True, mem['sub_class'] or sub
            if inc:
                sel[icode] = sub
        out[g] = sel
    return out


def target_of(ind):
    for part in (ind.get('target_by_level') or '').split(';'):
        m = re.match(r'([A-Z0-9,]+)\s*(<=|>=|<|>|=)\s*([\d.]+)', part.strip())
        if m and HOSPITAL_LEVEL in m.group(1).split(','):
            return m.group(2), float(m.group(3))
    if ind.get('target_value'):
        return ind.get('target_operator') or '<=', float(ind['target_value'])
    return '', None


# ── ดึงข้อมูลดิบ ────────────────────────────────────────────────────────────────
def dx_regexp(sets, names):
    pre = set()
    for n in names:
        for a, b, _ in sets.get(n, []):
            pre.add(a[:3])
            if b:
                pre.add(b[:3])
                # ช่วงรหัสระดับ 3 ตัวอักษร เช่น S07-S11, X00-X19 → ใส่ทุกรหัสในช่วง
                if len(a) >= 3 and a[0] == b[0] and a[1:3].isdigit() and b[1:3].isdigit():
                    for i in range(int(a[1:3]), int(b[1:3]) + 1):
                        pre.add(f'{a[0]}{i:02d}')
    return '^(' + '|'.join(sorted(pre)) + ')'


def pull(db, a, b, need_sets, sets, drug_any, gi_union, ab_icodes):
    """ข้อมูลดิบช่วง [a, b): OPD visit + dx + ยา, IPD admission + dx + ยาปฏิชีวนะ, eGFR"""
    rx = dx_regexp(sets, need_sets)
    opd = {}
    for r in hx.q(db, "SELECT o.vn, o.hn, DATE_FORMAT(o.vstdate,'%%Y-%%m-%%d') d, TIMESTAMPDIFF(YEAR,p.birthday,o.vstdate) age, "
                      "p.sex FROM ovst o LEFT JOIN patient p ON p.hn=o.hn WHERE o.vstdate>=%s AND o.vstdate<%s", (a, b)):
        opd[s(r['vn'])] = {'hn': s(r['hn']), 'd': s(r['d']), 'age': r['age'], 'sex': s(r['sex']), 'pdx': [], 'dx': [],
                           'items': 0, 'nlem': 0, 'g': {}}
    for r in hx.q(db, "SELECT vn, icd10, diagtype FROM ovstdiag WHERE vstdate>=%s AND vstdate<%s AND icd10 REGEXP %s",
                  (a, b, rx)):
        v = opd.get(s(r['vn']))
        if v:
            c = s(r['icd10']).upper()
            v['dx'].append(c)
            if s(r['diagtype']) == '1':
                v['pdx'].append(c)
    # จำนวน 0 = แพทย์คีย์ไว้กันลืม/สั่งหยุด (วิธีใช้ "off") ไม่ได้จ่ายจริง → ไม่นับทุกตัวชี้วัด
    for r in hx.q(db, "SELECT vn, icode, SUM(qty) q FROM opitemrece WHERE vstdate>=%s AND vstdate<%s AND vn IS NOT NULL "
                      "AND vn<>'' AND icode LIKE '1%%' GROUP BY vn, icode HAVING SUM(qty)>0", (a, b)):
        v, ic = opd.get(s(r['vn'])), s(r['icode'])
        if v and ic in drug_any:
            v['items'] += 1
            v['nlem'] += 1 if drug_any[ic]['nlem'] else 0
            if ic in gi_union:
                v['g'][ic] = float(r['q'] or 0)
    ipd = {}
    for r in hx.q(db, "SELECT a.an, a.hn, DATE_FORMAT(a.dchdate,'%%Y-%%m-%%d') d, p.sex FROM an_stat a LEFT JOIN patient p "
                      "ON p.hn=a.hn WHERE a.dchdate>=%s AND a.dchdate<%s", (a, b)):
        ipd[s(r['an'])] = {'hn': s(r['hn']), 'd': s(r['d']), 'sex': s(r['sex']), 'dx': [], 'ab': False}
    if ipd:
        ans = list(ipd)
        for i in range(0, len(ans), 500):
            chunk = ans[i:i + 500]
            ph = ','.join(['%s'] * len(chunk))
            for r in hx.q(db, f"SELECT an, icd10 FROM iptdiag WHERE an IN ({ph}) AND icd10 REGEXP %s", (*chunk, rx)):
                ipd[s(r['an'])]['dx'].append(s(r['icd10']).upper())
            if ab_icodes:
                ph2 = ','.join(['%s'] * len(ab_icodes))
                for r in hx.q(db, f"SELECT DISTINCT an FROM opitemrece WHERE an IN ({ph}) AND icode IN ({ph2}) AND qty>0",
                              (*chunk, *ab_icodes)):
                    ipd[s(r['an'])]['ab'] = True
    egfr = []
    for r in hx.q(db, "SELECT h.hn, DATE_FORMAT(h.order_date,'%%Y-%%m-%%d') d, o.lab_order_result v FROM lab_head h "
                      "JOIN lab_order o ON o.lab_order_number=h.lab_order_number WHERE h.order_date>=%s AND h.order_date<%s "
                      "AND o.lab_items_code=%s", (a, b, EGFR_LAB)):
        m = re.match(r'\s*([\d.]+)', s(r['v']))
        if m:
            egfr.append((s(r['hn']), s(r['d']), float(m.group(1))))
    return opd, ipd, egfr


# ── คำนวณ RDU ──────────────────────────────────────────────────────────────────
class Rdu:
    def __init__(self, inds, sets, gic, opd, ipd, egfr, names):
        self.inds, self.sets, self.gic, self.names = inds, sets, gic, names
        self.cases = defaultdict(list)  # code → รายเคส (มี HN) ของช่วงที่ขอ collect
        self.opd, self.ipd = opd, ipd
        self.egfr = defaultdict(list)
        for hn, d, v in egfr:
            self.egfr[hn].append((d, v))
        self.by_month = defaultdict(list)
        for vn, v in opd.items():
            self.by_month[v['d'][:7]].append(vn)
        self.ipd_month = defaultdict(list)
        for an, v in ipd.items():
            self.ipd_month[v['d'][:7]].append(an)
        self.mech_valve = {v['hn'] for v in opd.values() if any(in_set(c, sets.get('RDU-MECH-VALVE-ICD10', [])) for c in v['dx'])}

    def has(self, v, group):
        g = self.gic.get(group, {})
        return any(ic in g for ic in v['g'])

    def subs(self, v, group):
        g = self.gic.get(group, {})
        return {g[ic] or ic for ic in v['g'] if ic in g and not self.stat_dose(ic, v['g'][ic])}

    def stat_dose(self, ic, qty):
        # RAS 2 ชนิด: ไม่นับ captopril ที่ให้ครั้งเดียว (stat) — ไม่มีข้อมูลวิธีใช้ ใช้จำนวน ≤ 2 เม็ด
        return 'captopril' in self.names.get(ic, '') and qty <= 2

    def dx_ok(self, v, set_code, scope):
        if not set_code:
            return True
        items = self.sets.get(set_code, [])
        return any(in_set(c, items) for c in (v['pdx'] if scope == 'PDX' else v['dx']))

    def denom_ok(self, ind, v):
        if ind['sex'] and v['sex'] != ind['sex']:
            return False
        if ind['age_from'] or ind['age_to']:
            if v['age'] is None:
                return False
            if ind['age_from'] and v['age'] < int(ind['age_from']):
                return False
            if ind['age_to'] and v['age'] > int(ind['age_to']):
                return False
        if not self.dx_ok(v, ind['denom_code_set'], ind['denom_dx_scope']):
            return False
        mode = ind['denom_drug_mode']
        if mode == 'ANY_DRUG' and not v['items']:
            return False
        if mode == 'HAS' and not self.has(v, ind['denom_drug_group']):
            return False
        return True

    def numer_visit(self, ind, v):
        mode, g = ind['numer_drug_mode'], ind['numer_drug_group']
        if mode == 'HAS':
            return self.has(v, g)
        if mode == 'TWO_OR_MORE':
            return len(self.subs(v, g)) >= 2
        return False

    def egfr_ok(self, hn, end, v_dx_ckd45):
        rs = [(d, x) for d, x in self.egfr.get(hn, []) if add_days(end, -LOOKBACK_DAYS) <= d <= end]
        if rs:
            return max(rs)[1] > 30
        return not v_dx_ckd45

    def evaluate(self, code, months, collect=False):
        ind = self.inds[code]
        kind, unit = ind['measure_kind'], ind['count_unit']
        vns = [vn for m in months for vn in self.by_month.get(m, [])]
        end = add_days(next_month(months[-1]) + '-01', -1)
        if kind == 'TRIGGER':
            n = 0
            for vn in vns:
                v = self.opd[vn]
                if self.dx_ok(v, ind['denom_code_set'], 'ANY') and self.dx_ok(v, ind['numer_code_set'], 'ANY'):
                    n += 1
            for an in (an for m in months for an in self.ipd_month.get(m, [])):
                v = self.ipd[an]
                vv = {'dx': v['dx'], 'pdx': []}
                if self.dx_ok(vv, ind['denom_code_set'], 'ANY') and self.dx_ok(vv, ind['numer_code_set'], 'ANY'):
                    n += 1
            return {'n': n}
        if code == 'APL':
            n = d = 0
            for an in (an for m in months for an in self.ipd_month.get(m, [])):
                v = self.ipd[an]
                if ind['sex'] and v['sex'] != ind['sex']:
                    continue
                if any(in_set(c, self.sets.get(ind['denom_code_set'], [])) for c in v['dx']):
                    d += 1
                    n += 1 if v['ab'] else 0
            return {'n': n, 'd': d}
        if code == 'PREG':
            return self.preg(ind, months, collect)
        if kind == 'MEAN':
            items = [self.opd[vn]['items'] for vn in vns if self.opd[vn]['items']]
            return {'n': sum(items), 'd': len(items)}
        if unit == 'ITEM':
            return {'n': sum(self.opd[vn]['nlem'] for vn in vns), 'd': sum(self.opd[vn]['items'] for vn in vns)}
        if unit == 'VISIT':
            n = d = 0
            for vn in vns:
                v = self.opd[vn]
                if self.denom_ok(ind, v):
                    d += 1
                    if self.numer_visit(ind, v):
                        n += 1
                        if collect:
                            self.cases[code].append({'hn': v['hn'], 'date': v['d'], 'vn': vn, 'age': v['age'],
                                                     'drugs': [self.names[ic] for ic in v['g'] if ic in self.gic.get(ind['numer_drug_group'], {})]})
            return {'n': n, 'd': d}
        # PATIENT: นับเป็น HN ในช่วงเวลา
        by_hn = defaultdict(list)
        for vn in vns:
            by_hn[self.opd[vn]['hn']].append(self.opd[vn])
        n = d = 0
        ckd45 = self.sets.get(ind['lab_alt_code_set'] or 'RDU-CKD45-ICD10', [])
        for hn, vs in by_hn.items():
            if not any(self.denom_ok(ind, v) for v in vs):
                continue
            if ind['lab_code'] == 'EGFR' and not self.egfr_ok(hn, end, any(in_set(c, ckd45) for v in vs for c in v['dx'])):
                continue
            d += 1
            if ind['numer_drug_mode'] == 'TWO_OR_MORE':  # NSAID ซ้ำซ้อน: ≥2 ตัวในวันเดียวกัน
                per_day = defaultdict(set)
                for v in vs:
                    for ic in v['g']:
                        if ic in self.gic.get(ind['numer_drug_group'], {}):
                            per_day[v['d']].add(ic)
                ok = any(len(x) >= 2 for x in per_day.values())
            else:
                ok = any(self.has(v, ind['numer_drug_group']) for v in vs)
            n += 1 if ok else 0
        return {'n': n, 'd': d}

    def preg(self, ind, months, collect=False):
        # การตั้งครรภ์สิ้นสุด: คลอด (O80, Z37) + แท้ง/คลอดทุกแบบ (O00-O08, O60-O84) — มีแท้งแล้วไม่นับว่ายังตั้งครรภ์
        preg_set = self.sets.get(ind['denom_code_set'], [])
        deliv = self.sets.get(ind['denom_exclude_code_set'], []) + self.sets.get(PREG_END_SET, [])
        gx = self.gic.get(ind['numer_drug_group'], {})
        preg_dates, deliv_dates = defaultdict(list), defaultdict(list)
        for v in self.opd.values():
            if any(in_set(c, preg_set) for c in v['dx']):
                preg_dates[v['hn']].append(v['d'])
            if any(in_set(c, deliv) for c in v['dx']):
                deliv_dates[v['hn']].append(v['d'])
        for v in self.ipd.values():
            if any(in_set(c, deliv) for c in v['dx']):
                deliv_dates[v['hn']].append(v['d'])
        hns = set()
        for vn in (vn for m in months for vn in self.by_month.get(m, [])):
            v = self.opd[vn]
            if v['sex'] != '2' or v['hn'] not in preg_dates:
                continue
            drugs = [ic for ic in v['g'] if ic in gx and not (gx[ic] == 'WARFARIN' and v['hn'] in self.mech_valve)]
            if not drugs:
                continue
            pd = [d for d in preg_dates[v['hn']] if add_days(v['d'], -LOOKBACK_DAYS) <= d <= v['d']]
            if pd and not any(max(pd) <= d <= v['d'] for d in deliv_dates[v['hn']]):
                hns.add(v['hn'])
                if collect:
                    self.cases['PREG'].append({'hn': v['hn'], 'date': v['d'], 'vn': vn, 'age': v['age'], 'pregDx': max(pd),
                                               'drugs': [self.names[ic] for ic in drugs]})
        return {'n': len(hns)}


# ── แพ้ยาซ้ำ ────────────────────────────────────────────────────────────────────
def allergy_repeat(db, atc_map, syn, keys, since):
    rows = hx.q(db, "SELECT a.hn, a.agent, DATE_FORMAT(a.report_date,'%%Y-%%m-%%d') d, a.opd_allergy_type_id t, a.opd_allergy_alert_type_id al, a.symptom, "
                    "TRIM(CONCAT(IFNULL(p.pname,''),IFNULL(p.fname,''),' ',IFNULL(p.lname,''))) ptname FROM opd_allergy a "
                    "LEFT JOIN patient p ON p.hn=a.hn WHERE IFNULL(a.allergy_cancel_status,'')<>'Y' "
                    "AND IFNULL(a.opd_allergy_type_id,0)<>1 AND a.agent IS NOT NULL AND a.agent<>''", ())
    by_subst = defaultdict(set)
    for ic, d in atc_map.items():
        for k in d['subst']:
            by_subst[k].add(ic)
    pairs = defaultdict(list)  # hn → [(icodes, agent, report_date, symptom, ptname, cls)]
    unmatched = 0
    for r in rows:
        agent, hn = s(r['agent']).strip(), s(r['hn'])
        ics = set()
        for k in find_substances(agent, syn, keys):
            ics |= by_subst.get(k, set())
        low = agent.lower()
        for pat, pref in ALLERGY_CLASSES:
            if re.search(pat, low):
                ics |= {ic for ic, d in atc_map.items() if any(a.startswith(pref) for a in d['atcs'])}
        if not ics:
            unmatched += 1
            continue
        # ประเภทบันทึกใน HOSxP: 1 = แพ้ยา (นับ), 2 = เฝ้าระวังการใช้ยา (ผลข้างเคียง — สั่งต่อได้ ไม่นับ), ว่าง = ไม่ระบุ (ไม่นับ ให้แก้ข้อมูล)
        al = s(r['al'])
        cls = 'watch' if al == '2' else 'brand' if BRAND_ONLY.search(agent) else 'count' if al == '1' else 'unspec'
        pairs[hn].append((ics, agent, s(r['d']) or '0000-00-00', s(r['symptom']), s(r['ptname']), cls))
    events = {}
    hns = list(pairs)
    all_ics = sorted({ic for v in pairs.values() for p in v for ic in p[0]})
    for i in range(0, len(hns), 400):
        chunk = hns[i:i + 400]
        ph, ph2 = ','.join(['%s'] * len(chunk)), ','.join(['%s'] * len(all_ics))
        for r in hx.q(db, f"SELECT o.hn, o.vn, o.an, o.icode, DATE_FORMAT(IFNULL(o.rxdate,o.vstdate),'%%Y-%%m-%%d') d, "
                          f"k.department FROM opitemrece o LEFT JOIN kskdepartment k ON k.depcode=o.dep_code "
                          f"WHERE o.hn IN ({ph}) AND o.icode IN ({ph2}) AND o.qty>0 AND IFNULL(o.rxdate,o.vstdate)>=%s",
                      (*chunk, *all_ics, since)):
            hn, ic, d = s(r['hn']), s(r['icode']), s(r['d'])
            hits = [p for p in pairs[hn] if ic in p[0] and d > p[2]]
            if not hits:
                continue
            ics, agent, rd, sym, name, cls = min(hits, key=lambda p: CLS_RANK[p[5]])  # มีบันทึก "แพ้ยา" ตัวไหนตรง → นับ
            key = (hn, ic, d)
            if key not in events or CLS_RANK[cls] < CLS_RANK[events[key]['cls']]:
                events[key] = {'hn': hn, 'name': name, 'date': d, 'icode': ic, 'drug': atc_map[ic]['name'],
                               'agent': agent, 'allergyDate': rd, 'symptom': sym, 'vn': s(r['vn']), 'an': s(r['an']),
                               'setting': 'IPD' if s(r['an']) else 'OPD', 'dept': s(r['department']), 'cls': cls}
    return sorted(events.values(), key=lambda e: (e['date'], e['hn'])), unmatched, len(rows)


# ── Medication reconciliation ───────────────────────────────────────────────────
def medrec(db, a, b):
    adm = {s(r['an']): {'hn': s(r['hn']), 'd': s(r['d'])} for r in hx.q(
        db, "SELECT an, hn, DATE_FORMAT(regdate,'%%Y-%%m-%%d') d FROM ipt WHERE regdate>=%s AND regdate<%s", (a, b))}
    if not adm:
        return {}
    done = set()
    ans = list(adm)
    for i in range(0, len(ans), 500):
        chunk = ans[i:i + 500]
        ph = ','.join(['%s'] * len(chunk))
        done |= {s(r['vn']) for r in hx.q(db, f"SELECT vn FROM med_recon WHERE dep_type='IPD' AND vn IN ({ph})", chunk)}
        done |= {s(r['an']) for r in hx.q(db, f"SELECT an FROM medication_reconciliation WHERE an IN ({ph})", chunk)}
    hns = sorted({v['hn'] for v in adm.values()})
    prior = defaultdict(set)
    for i in range(0, len(hns), 400):
        chunk = hns[i:i + 400]
        ph = ','.join(['%s'] * len(chunk))
        for r in hx.q(db, f"SELECT hn, DATE_FORMAT(vstdate,'%%Y-%%m-%%d') d FROM opitemrece WHERE hn IN ({ph}) "
                          f"AND vstdate>=%s AND vstdate<%s AND vn IS NOT NULL AND vn<>'' AND icode LIKE '1%%' AND qty>0 GROUP BY hn, vstdate",
                      (*chunk, add_days(a, -MEDREC_PRIOR_DAYS), b)):
            prior[s(r['hn'])].add(s(r['d']))
    out = defaultdict(lambda: {'adm': 0, 'done': 0, 'admMeds': 0, 'doneMeds': 0})
    for an, v in adm.items():
        m = out[v['d'][:7]]
        has_meds = any(add_days(v['d'], -MEDREC_PRIOR_DAYS) <= d < v['d'] for d in prior.get(v['hn'], ()))
        ok = an in done
        m['adm'] += 1
        m['done'] += ok
        m['admMeds'] += has_meds
        m['doneMeds'] += ok and has_meds
    return dict(out)


# ── เวลารอรับยา OPD ─────────────────────────────────────────────────────────────
def wait_times(db, a, b):
    rows = hx.q(db, "SELECT q.vn, q.queue_datetime t0, MIN(x.rx_dispenser_datetime) t1 FROM opd_dep_queue q "
                    "JOIN rx_dispenser_detail x ON x.vn=q.vn AND x.depcode=%s AND x.rx_dispenser_datetime>=q.queue_datetime "
                    "WHERE q.depcode=%s AND q.queue_datetime>=%s AND q.queue_datetime<%s GROUP BY q.vn, q.queue_datetime",
                (PHARMACY_DEP, PHARMACY_DEP, a, b))
    mins = defaultdict(list)
    seen = set()
    for r in sorted(rows, key=lambda r: r['t0']):
        if s(r['vn']) in seen or not r['t1']:
            continue
        seen.add(s(r['vn']))
        mn = (r['t1'] - r['t0']).total_seconds() / 60
        if 0 <= mn <= 240:  # เกิน 4 ชม. = ลืมกดคิว/กดจ่ายย้อนหลัง ไม่นับ
            mins[r['t0'].strftime('%Y-%m')].append(mn)
    total = {s(r['m']): int(r['n']) for r in hx.q(
        db, "SELECT DATE_FORMAT(rx_dispenser_datetime,'%%Y-%%m') m, COUNT(DISTINCT vn) n FROM rx_dispenser_detail "
            "WHERE depcode=%s AND rx_dispenser_datetime>=%s AND rx_dispenser_datetime<%s AND vn IS NOT NULL AND vn<>'' GROUP BY 1",
        (PHARMACY_DEP, a, b))}
    out = {}
    for m in sorted(set(mins) | set(total)):
        xs = sorted(mins.get(m, []))
        if xs:
            out[m] = {'n': len(xs), 'rx': total.get(m, 0), 'median': round(xs[len(xs) // 2], 1),
                      'p90': round(xs[min(len(xs) - 1, int(len(xs) * 0.9))], 1), 'mean': round(sum(xs) / len(xs), 1),
                      'le15': sum(x <= 15 for x in xs), 'le30': sum(x <= 30 for x in xs)}
        else:
            out[m] = {'n': 0, 'rx': total.get(m, 0)}
    return out


# ── main ───────────────────────────────────────────────────────────────────────
def compute(db):
    t0 = time.time()
    today = dt.date.today()
    last = today.strftime('%Y-%m')
    months = months_between(START_MONTH, last)
    subs, syn, keys = substance_index(db)
    atc_map = build_atc_map(db, subs, syn, keys)
    inds, sets, groups, edition = load_spec(db)
    gic = group_icodes(groups, atc_map)
    used_groups = {ind[k] for ind in inds.values() for k in ('denom_drug_group', 'numer_drug_group') if ind[k]}
    gi_union = {ic for g in used_groups for ic in gic.get(g, {})}
    need_sets = {ind[k] for ind in inds.values() for k in ('denom_code_set', 'numer_code_set', 'denom_exclude_code_set',
                                                            'lab_alt_code_set') if ind[k]} | {'RDU-MECH-VALVE-ICD10', PREG_END_SET}
    a = add_days(START_MONTH + '-01', -LOOKBACK_DAYS)
    b = next_month(last) + '-01'
    opd, ipd, egfr = pull(db, a, b, need_sets, sets, atc_map, gi_union, sorted(gic.get('RDU-AB-J01', {})))
    log(f'ดึงข้อมูลดิบ OPD {len(opd):,} visit, IPD {len(ipd):,} AN, eGFR {len(egfr):,} ผล ({time.time() - t0:.0f} วิ)')
    rdu = Rdu(inds, sets, gic, opd, ipd, egfr, {ic: d['name'].lower() for ic, d in atc_map.items()})
    periods = {m: [m] for m in months}
    for fy in sorted({fy_of(m) for m in months}):
        ms = fy_months(fy, last)
        periods[f'FY{fy}'] = ms
        h1, h2 = [m for m in ms if int(m[5:]) >= 10 or int(m[5:]) <= 3], [m for m in ms if 4 <= int(m[5:]) <= 9]
        if h1:
            periods[f'FY{fy}H1'] = h1
        if h2:
            periods[f'FY{fy}H2'] = h2
    res = {}
    for code in SCORED + WATCH:
        if code not in inds:
            continue
        keep = (f'FY{fy_of(last)}', f'FY{fy_of(last) - 1}')  # รายเคสของปีงบปัจจุบันและปีก่อน
        res[code] = {p: rdu.evaluate(code, ms, collect=(p in keep and code in ('RAS', 'PREG'))) for p, ms in periods.items()}
    defs = []
    for code in SCORED + WATCH:
        ind = inds.get(code)
        if not ind:
            continue
        op, val = target_of(ind)
        defs.append({'code': code, 'no': ind['indicator_no'], 'name': ind['indicator_name'], 'kind': ind['measure_kind'],
                     'unit': ind['count_unit'], 'mult': float(ind['rate_multiplier'] or 1), 'op': op, 'target': val,
                     'targetUnit': ind['target_unit'], 'better': ind['better_direction'], 'scored': code in SCORED,
                     'num': ind['numerator_text'], 'den': ind['denominator_text'], 'def': ind['definition_text']})
    # รายการยาที่นับในแต่ละกลุ่ม (ให้เภสัชตรวจการจับคู่ ATC)
    drug_groups = {}
    for g in sorted(used_groups):
        if g == 'RDU-ANY-DRUG':
            continue
        drug_groups[g] = sorted({f"{atc_map[ic]['name']} {atc_map[ic]['strength']}".strip() + ('' if atc_map[ic]['active'] else ' (เลิกใช้)')
                                 for ic in gic.get(g, {})})
    t1 = time.time()
    allergy_events, unmatched, n_allergy = allergy_repeat(db, atc_map, syn, keys, START_MONTH + '-01')
    mr = medrec(db, START_MONTH + '-01', b)
    wt = wait_times(db, START_MONTH + '-01', b)
    log(f'แพ้ยาซ้ำ {len(allergy_events)} ครั้ง, med rec {sum(v["adm"] for v in mr.values())} admit, '
        f'รอรับยา {sum(v["n"] for v in wt.values()):,} ใบ ({time.time() - t1:.0f} วิ)')
    allergy_month = defaultdict(lambda: {'n': 0, 'opd': 0, 'ipd': 0, 'brand': 0, 'watch': 0, 'unspec': 0})
    for e in allergy_events:
        x = allergy_month[e['date'][:7]]
        if e['cls'] != 'count':
            x[e['cls']] += 1
            continue
        x['n'] += 1
        x['ipd' if e['setting'] == 'IPD' else 'opd'] += 1
    data = {
        'generated': dt.datetime.now().isoformat(timespec='seconds'), 'months': months, 'level': HOSPITAL_LEVEL,
        'edition': EDITION, 'rdu': {'defs': defs, 'values': res, 'drugGroups': drug_groups,
                                    'editionName': edition.get('edition_name', ''), 'passText': edition.get('pass_rule_text', ''),
                                    'passMin': int(edition.get('pass_min_count') or 0)},
        'allergy': {'months': dict(allergy_month), 'allergies': n_allergy, 'unmatched': unmatched,
                    'events': [{k: e[k] for k in ('date', 'drug', 'agent', 'allergyDate', 'setting', 'dept', 'cls')}
                               for e in allergy_events]},
        'medrec': mr, 'wait': wt, 'priorDays': MEDREC_PRIOR_DAYS,
    }
    return data, {'allergy': allergy_events, 'RAS': rdu.cases['RAS'], 'PREG': rdu.cases['PREG']}


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:  # noqa: BLE001
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--atc-report', action='store_true', help='พิมพ์ผลจับคู่ยา → ATC ของยาที่ยังใช้อยู่ แล้วจบ')
    args = ap.parse_args()
    if args.atc_report:
        db = hx.db_connect()
        subs, syn, keys = substance_index(db)
        for icode, v in sorted(build_atc_map(db, subs, syn, keys).items(), key=lambda x: x[1]['name']):
            if v['active']:
                print(icode, v['route'], ','.join(v['atcs']) or '-', '|', v['name'], v['strength'])
        return
    try:
        if os.path.exists(LOCK_FILE) and time.time() - os.path.getmtime(LOCK_FILE) < 3600:
            log('มีอีกรอบกำลังรันอยู่ — ข้าม')
            return
        open(LOCK_FILE, 'w').close()
    except OSError:
        pass
    try:
        db = hx.db_connect()
        data, cases = compute(db)
        db.close()
        js = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
        if args.dry_run:
            print(json.dumps(data, ensure_ascii=False, indent=1)[:6000])
            log(f'[dry-run] ขนาด {len(js):,} ตัวอักษร ไม่ได้เขียน')
            return
        with open(CASES_FILE, 'w', encoding='utf-8') as f:
            json.dump({'generated': data['generated'], **cases}, f, ensure_ascii=False)
        hx.update_doc(DOC, lambda f: (f.update({'json': js}) or {'changed': True}), False)
        log(f'เขียน {DOC} แล้ว ({len(js):,} ตัวอักษร)')
    except Exception as e:  # noqa: BLE001
        log(f'ผิดพลาด: {type(e).__name__}: {e}')
        raise
    finally:
        try:
            os.remove(LOCK_FILE)
        except OSError:
            pass


if __name__ == '__main__':
    main()
