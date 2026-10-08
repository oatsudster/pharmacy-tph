# HOSxP Bridge — ส่งข้อมูลผู้ป่วยที่เปิดอยู่ใน HOSxP XE ให้หน้าต่างลอยใน clinic.html
#   หน้าจ่ายยา       → หน้าต่างลอยยาคงเหลือ (HN, วันนัด, ตารางยา)
#   หน้า Patient EMR → หน้าต่างลอยบันทึกคลินิก (HN, ชื่อ) ที่เภสัชเปิดตอนลงคลินิก
#
# อ่านจากหน้าจอ HOSxP (Windows UI Automation + จับภาพ) ไม่กด/แก้อะไรใน HOSxP
# ถ้ามี db.json อยู่โฟลเดอร์เดียวกัน (host/port/user/password/database ของ MySQL HOSxP แบบ SELECT อย่างเดียว)
# จะอ่านวันนัด/ใบสั่งยา/ยาของ visit ก่อนๆ จากฐานข้อมูลแทน OCR — ตัวต่อ MySQL อยู่ใน hxdb.cs (ไม่มีคำสั่งเขียน มีแค่ SELECT)
# เปิดให้เฉพาะเครื่องนี้ (127.0.0.1) และรับเฉพาะหน้าเว็บของเรา (ALLOWED_ORIGINS):
#   /current  — JSON { ok, hn, name, active, apptDays, gridVer, gridCut, covered, emrHn, emrName, ts }
#               emrHn/emrName = คนไข้ใน Patient EMR ที่อยู่บนจอ (มีหลายหน้า EMR เลือกหน้าที่อยู่บนสุด)
#               ถ้าไม่มีหน้า EMR ไหนเห็นบนจอ คงคนล่าสุดไว้ ไม่มีหน้า EMR เปิดเลย = ค่าว่าง
#               active = หน้าบันทึกจ่ายยาอยู่บนจอจริง (ช่อง HN และตารางยาไม่ถูกหน้าอื่น/dialog ของ HOSxP ทับ)
#               ถ้าไม่ active จะไม่อ่านวันนัด/ตารางยา และหน้าเว็บจะไม่คำนวณ
#   /emrgrid.png — ภาพตารางยาของ visit ที่เลือกใน Patient EMR (emrGridVer/emrGridHash เปลี่ยนเมื่อภาพหรือ visit เปลี่ยน)
#                 emrVisit = "วันที่มา|เวลา|ห้องตรวจ" ของ visit นั้น
#   /grid.png — ภาพตารางใบสั่งยาล่าสุด หน้าเว็บเอาไป OCR ภาษาไทยเองด้วย Tesseract (Windows OCR ไม่มีภาษาไทย)
#   /db/order?hn=   — ใบสั่งยาของ visit วันนี้ (visit ล่าสุดของวันที่มียา) + นัดที่ยังไม่ถึง (ไม่นับยกเลิก/มาแล้ว)
#   /db/visits?hn=  — ยาของ visit ก่อนวันนี้ 6 visit ล่าสุดที่มียา (ใหม่ → เก่า)
#   /db/patient?hn= — คำนำหน้า ชื่อ สกุล วันเกิด เพศ
#   /db/denom       — ตัวหาร ME รายเดือน 24 เดือนล่าสุด: opd = จำนวน visit (ovst), ipd = วันนอน (an_stat.admdate ตามเดือนที่จำหน่าย)
#   /db/adr?from=YYYY-MM-DD — รายงาน ADR (Pharmacy > Adverse drug reactions = patient_adr) พร้อมรายละเอียดทุกช่องและรายการยา
#   /db/meds?hn=    — ยาเดิมสำหรับบันทึกยาคงเหลือ: visit ล่าสุด (ก่อนวันนี้) ที่มียา ของแต่ละคลินิกนัด DM/HT/COPD
#                     + ยากลับบ้าน (HMe) ของการนอน รพ. ครั้งล่าสุด — หน้าเว็บเลือก/รวมเอง
#   ทุกตัวคืน { ok:false, error } ถ้าไม่มี db.json หรือต่อฐานข้อมูลไม่ได้ — หน้าเว็บกลับไปใช้ OCR เอง
#   /current มี db (ต่อฐานข้อมูลได้) / dbErr และถ้า DB ใช้ได้ apptDays มาจากตาราง oapp ไม่ใช่ OCR
#
# ตำแหน่งข้อมูลในหน้าจ่ายยา (THOSxPDiepensingDispenseEntryFrame) ของ HOSxP XE 4:
#   HN / ชื่อ     — TcxDBTextEdit ที่อยู่ทางขวาของป้าย "HN" / "ชื่อ"
#   วันนัด        — THTMListBox ในกล่อง "ข้อมูลการนัดหมาย" แสดงเป็น "1.[119 วัน] 22 มกราคม 2570 ..."
#                   วาดข้อความเอง อ่านผ่าน API ไม่ได้ จึงจับภาพแล้ว OCR (อังกฤษพอ) เอาตัวเลขในวงเล็บ [..]
#   ใบสั่งยา       — TcxGridSite ใน THOSxPMedicationOrderFrame (DevExpress grid อ่านผ่าน API ไม่ได้เช่นกัน)
# Patient EMR (TPtEMRForm) — ส่วนหัวไม่มีป้ายกำกับ อ่านตามตำแหน่ง: HN = ช่อง TcxTextEdit ที่เป็นตัวเลขล้วน
#   แถวบนสุด (7 หลัก, แถวล่างลงไปเป็นเลขบัตรประชาชน/โทรศัพท์) ชื่อ = ช่องถัดไปทางขวาในแถวเดียวกัน
# HOSxP ไม่ตอบ PrintWindow จึงต้องจับภาพจากจอจริง — ถ้ามีหน้าต่างอื่นบังอยู่ (รวมถึงหน้าอื่นของ HOSxP
# เช่น "เปรียบเทียบประวัติ") จะไม่จับส่วนที่ถูกบัง และคงผลที่อ่านได้ล่าสุดของคนไข้คนนี้ไว้

$PORT = 8765
$ALLOWED_ORIGINS = @('https://oatsudster.github.io', 'null')   # 'null' = เปิดไฟล์ html จากเครื่องตรงๆ

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing, System.Runtime.WindowsRuntime
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class HxWin {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern bool IsChild(IntPtr parent, IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  // จุดบนจอนี้คือตัว control นั้นจริงหรือไม่ — ถ้ามีหน้าต่างอื่นบัง แม้เป็นของ HOSxP เอง
  // (เช่น "เปรียบเทียบประวัติ") ก็ถือว่าถูกบัง จะได้ไม่เอาภาพหน้านั้นไปอ่าน
  public static bool IsShowing(int x, int y, IntPtr target) {
    POINT p; p.X = x; p.Y = y;
    IntPtr h = WindowFromPoint(p);
    return h == target || IsChild(target, h);
  }
}
"@
# ใช้พิกัดจอจริง เครื่องที่ตั้งขนาดหน้าจอ 125%/150% ตำแหน่งจาก UI Automation จะได้ตรงกับภาพที่จับ
[void][HxWin]::SetProcessDPIAware()
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]

$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
function ClassCond($cls) { New-Object System.Windows.Automation.PropertyCondition($AE::ClassNameProperty, $cls) }

$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
# วันนัดต้องการแค่ตัวเลขในวงเล็บ ใช้ OCR ภาษาอังกฤษของ Windows ได้
$ocr = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $ocr) { $ocr = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('en-US')) }
$md5 = [System.Security.Cryptography.MD5]::Create()

$state = [ordered]@{ ok = $false; hn = ''; name = ''; active = $false; apptDays = $null; db = $false; dbErr = ''; gridVer = 0; gridHash = ''; gridCut = $false; covered = $false; emrHn = ''; emrName = ''; emrGridVer = 0; emrGridHash = ''; emrVisit = ''; ts = 0 }
$cache = @{ hnEdit = $null; nameEdit = $null; apptList = $null; grid = $null; emr = @(); layout2 = $false }
$nextEmrScan = [DateTime]::MinValue; $nextFind = [DateTime]::MinValue
$nextCard = [DateTime]::MinValue
$apptByHn = @{}   # HN → จำนวนวันถึงนัดที่อ่านได้ล่าสุด (ล้างเมื่อปิด bridge)
$gridPng = $null; $gridHash = ''
$emrGridPng = $null; $emrGridRaw = ''; $nextEmrGrid = [DateTime]::MinValue
$lastHn = ''; $nextAppt = [DateTime]::MinValue; $nextGrid = [DateTime]::MinValue

# ── ฐานข้อมูล HOSxP (อ่านอย่างเดียว) ─────────────────────────
$db = $null
$dbFile = Join-Path $PSScriptRoot 'db.json'
if (Test-Path $dbFile) {
  try {
    Add-Type -Path (Join-Path $PSScriptRoot 'hxdb.cs')
    $cfg = Get-Content $dbFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $db = New-Object HxDb $cfg.host, ([int]$(if ($cfg.port) { $cfg.port } else { 3306 })), $cfg.user, $cfg.password, $(if ($cfg.database) { $cfg.database } else { 'hos' })
  } catch { $state.dbErr = "ตั้งค่าฐานข้อมูลไม่ได้: $($_.Exception.Message)" }
} else { $state.dbErr = 'ไม่มี db.json' }
$dbRetryAt = [DateTime]::MinValue
$apptDbAt = @{}   # HN → เวลาที่อ่านวันนัดจาก DB ล่าสุด

# รัน SELECT — ต่อไม่ได้ให้เว้น 30 วินาทีก่อนลองใหม่ (bridge ทำงานวนรอบเดียว จะได้ไม่ค้างรอ DB ทุกวินาที)
function DbQuery($sql) {
  if (-not $db) { throw $state.dbErr }
  if (-not $db.Connected -and (Get-Date) -lt $script:dbRetryAt) { throw $state.dbErr }
  try { $r = $db.Query($sql); $state.db = $true; $state.dbErr = ''; return , $r }
  catch {
    $msg = if ($_.Exception.InnerException) { $_.Exception.InnerException.Message } else { $_.Exception.Message }
    if (-not $db.Connected) { $state.db = $false; $script:dbRetryAt = (Get-Date).AddSeconds(30) }
    $state.dbErr = $msg; throw $msg
  }
}

# วิธีใช้: ข้อความวิธีใช้พิเศษ (sp_use) ถ้ามี ไม่งั้นรหัสวิธีใช้ปกติ — 3 บรรทัดต่อกันเหมือนบนฉลากยา
$DRUG_COLS = "d.icode, d.name, d.strength, d.units, d.dosageform, r.qty, r.item_no, " +
  "TRIM(IF(r.sp_use IS NOT NULL AND r.sp_use<>'', CONCAT_WS(' ', s.name1, s.name2, s.name3), CONCAT_WS(' ', u.name1, u.name2, u.name3))) AS usage_text"
$DRUG_JOIN = "FROM opitemrece r JOIN drugitems d ON d.icode=r.icode " +
  "LEFT JOIN drugusage u ON u.drugusage=r.drugusage LEFT JOIN sp_use s ON s.sp_use=r.sp_use"

# $hn ผ่าน [HxDb]::Digits มาแล้วทุกครั้ง (ตัวเลขล้วน) จึงใส่ใน SQL ได้ตรงๆ
function DbAppts($hn) {
  $rows = DbQuery ("SELECT a.nextdate, DATEDIFF(a.nextdate, CURDATE()) AS days, k.department AS clinic, a.app_cause " +
    "FROM oapp a LEFT JOIN kskdepartment k ON k.depcode=a.depcode " +
    "WHERE a.hn='$hn' AND a.nextdate>CURDATE() AND (a.oapp_status_id IS NULL OR a.oapp_status_id=1) ORDER BY a.nextdate")
  , @($rows | ForEach-Object { [ordered]@{ date = $_['nextdate']; days = [int]$_['days']; clinic = $_['clinic']; cause = $_['app_cause'] } })
}

function DrugRow($r) {
  [ordered]@{ icode = $r['icode']; name = $r['name']; strength = $r['strength']; units = $r['units']; form = $r['dosageform']; qty = $r['qty']; usage = $r['usage_text'] }
}

function DbOrder($hn) {
  $rows = DbQuery ("SELECT r.vn, o.vsttime, $DRUG_COLS $DRUG_JOIN JOIN ovst o ON o.vn=r.vn " +
    "WHERE r.hn='$hn' AND r.vstdate=CURDATE() AND (r.an IS NULL OR r.an='') ORDER BY r.vn DESC, r.item_no")
  $vn = if ($rows.Count) { $rows[0]['vn'] } else { '' }
  $appts = DbAppts $hn
  $max = if ($appts.Count) { ($appts | ForEach-Object { $_.days } | Measure-Object -Maximum).Maximum } else { $null }
  [ordered]@{ ok = $true; hn = $hn; vn = $vn; time = $(if ($rows.Count) { $rows[0]['vsttime'] } else { '' })
    drugs = @($rows | Where-Object { $_['vn'] -eq $vn } | ForEach-Object { DrugRow $_ }); appts = $appts; apptDays = $max }
}

function DbVisits($hn) {
  $rows = DbQuery ("SELECT r.vn, r.vstdate, o.vsttime, k.department, $DRUG_COLS $DRUG_JOIN JOIN ovst o ON o.vn=r.vn " +
    "LEFT JOIN kskdepartment k ON k.depcode=o.main_dep " +
    "WHERE r.hn='$hn' AND r.vstdate<CURDATE() AND r.vstdate>=CURDATE()-INTERVAL 2 YEAR AND (r.an IS NULL OR r.an='') " +
    "ORDER BY r.vstdate DESC, r.vn DESC, r.item_no LIMIT 300")
  $visits = New-Object System.Collections.ArrayList; $cur = $null
  foreach ($r in $rows) {
    if (-not $cur -or $cur.vn -ne $r['vn']) {
      if ($visits.Count -ge 6) { break }
      $cur = [ordered]@{ vn = $r['vn']; date = $r['vstdate']; time = $r['vsttime']; dep = $r['department']; drugs = New-Object System.Collections.ArrayList }
      [void]$visits.Add($cur)
    }
    [void]$cur.drugs.Add((DrugRow $r))
  }
  [ordered]@{ ok = $true; hn = $hn; visits = $visits }
}

# คลินิกนัดที่ใช้หายาเดิม: คลินิคเบาหวานนัดLAB, โรคเบาหวาน(DM), คลีนิคความดันนัดLAB, โรคความดัน(HT), โรคถุงลมโปงพอง(COPD)
$MED_CLINICS = "'023','001','024','002','013'"
function DbMeds($hn) {
  # visit ที่มาตามนัดของคลินิกเหล่านี้ — ผูกกับนัดด้วย visit_vn ถ้าไม่ได้ผูก ใช้ visit ของ HN นี้ในวันนัด
  $vis = DbQuery ("SELECT a.clinic, c.name AS clinic_name, o.vn, o.vstdate, o.vsttime FROM oapp a " +
    "JOIN clinic c ON c.clinic=a.clinic " +
    "JOIN ovst o ON o.vn=a.visit_vn OR ((a.visit_vn IS NULL OR a.visit_vn='') AND o.hn=a.hn AND o.vstdate=a.nextdate) " +
    "WHERE a.hn='$hn' AND a.clinic IN ($MED_CLINICS) AND a.nextdate>=CURDATE()-INTERVAL 2 YEAR AND o.vstdate<CURDATE() " +
    "ORDER BY o.vstdate DESC, o.vn DESC LIMIT 40")
  $drugs = @{}
  if ($vis.Count) {
    $vns = ($vis | ForEach-Object { "'" + [HxDb]::Digits($_['vn']) + "'" } | Select-Object -Unique) -join ','
    foreach ($r in (DbQuery "SELECT r.vn, $DRUG_COLS $DRUG_JOIN WHERE r.vn IN ($vns) AND (r.an IS NULL OR r.an='') ORDER BY r.item_no")) {
      if (-not $drugs.ContainsKey($r['vn'])) { $drugs[$r['vn']] = New-Object System.Collections.ArrayList }
      [void]$drugs[$r['vn']].Add((DrugRow $r))
    }
  }
  # แต่ละคลินิกเอา visit ล่าสุดที่มียา (นัด LAB บางครั้งไม่มียา ข้ามไป visit ก่อนหน้าของคลินิกนั้น)
  $visits = New-Object System.Collections.ArrayList; $seen = @{}
  foreach ($v in $vis) {
    if ($seen.ContainsKey($v['clinic']) -or -not $drugs.ContainsKey($v['vn'])) { continue }
    $seen[$v['clinic']] = $true
    [void]$visits.Add([ordered]@{ clinic = $v['clinic']; clinicName = $v['clinic_name']; vn = $v['vn']; date = $v['vstdate']; time = $v['vsttime']; drugs = $drugs[$v['vn']] })
  }
  # ยากลับบ้านของการนอน รพ. ครั้งล่าสุดที่จำหน่ายแล้ว
  $dc = $null
  $ipt = DbQuery "SELECT an, regdate, dchdate, dchtime FROM ipt WHERE hn='$hn' AND dchdate IS NOT NULL AND dchdate<=CURDATE() AND dchdate>=CURDATE()-INTERVAL 2 YEAR ORDER BY dchdate DESC, dchtime DESC LIMIT 1"
  if ($ipt.Count) {
    $an = [HxDb]::Digits($ipt[0]['an'])
    $hme = DbQuery ("SELECT $DRUG_COLS $DRUG_JOIN JOIN ipt_order_no n ON n.an=r.an AND n.order_no=r.order_no " +
      "WHERE r.an='$an' AND n.order_type='HMe' ORDER BY r.item_no")
    $dc = [ordered]@{ an = $an; regdate = $ipt[0]['regdate']; dchdate = $ipt[0]['dchdate']; dchtime = $ipt[0]['dchtime']
      drugs = @($hme | ForEach-Object { DrugRow $_ }) }
  }
  [ordered]@{ ok = $true; hn = $hn; visits = $visits; discharge = $dc }
}

# ตัวหาร ME — นับแบบเดียวกับที่กรอกมือมาตลอด (ตรวจแล้วตรงกับที่กรอกไว้ ต.ค. 68 – ก.ย. 69)
function DbDenom {
  $from = "DATE_FORMAT(CURDATE() - INTERVAL 24 MONTH, '%Y-%m-01')"
  $months = [ordered]@{}
  foreach ($r in (DbQuery "SELECT DATE_FORMAT(vstdate, '%Y-%m') AS m, COUNT(*) AS n FROM ovst WHERE vstdate>=$from GROUP BY 1")) {
    $months[$r['m']] = [ordered]@{ opd = [int]$r['n']; ipd = $null }
  }
  foreach ($r in (DbQuery "SELECT DATE_FORMAT(dchdate, '%Y-%m') AS m, SUM(admdate) AS n FROM an_stat WHERE dchdate>=$from AND dchdate<=CURDATE() GROUP BY 1")) {
    if (-not $months.Contains($r['m'])) { $months[$r['m']] = [ordered]@{ opd = $null; ipd = $null } }
    $months[$r['m']].ipd = [int]$r['n']
  }
  [ordered]@{ ok = $true; months = $months }
}

# รายงาน ADR ของห้องยา พร้อมรายละเอียดที่ต้องกดเข้าไปดูทีละคนใน HOSxP
# ชนิด Type A/B ไม่มีใน patient_adr — ใช้ของ opd_allergy (ประวัติแพ้ยา) ของคนเดียวกันที่บันทึกใกล้วันรายงานที่สุด (±60 วัน)
function DbAdr($path) {
  $from = '2025-01-01'
  if ($path -match '[?&]from=(\d{4}-\d{2}-\d{2})') { $from = $Matches[1] }
  $rows = DbQuery ("SELECT a.patient_adr_id, a.hn, CONCAT(IFNULL(p.pname,''), IFNULL(p.fname,''), ' ', IFNULL(p.lname,'')) AS ptname, " +
    "a.department, a.an, a.report_date, a.adverse_effect_date, a.adverse_effect, a.other_dx, a.lab_pe_text, a.medication_list, " +
    "a.adr_dechallange, a.adr_rechallenge, a.adr_continue_rechallenge, a.adr_norechallenge, a.has_adr_history, " +
    "a.dx_doctor_name, a.dx_doctor_position, a.entry_officer_name, a.entry_officer_position, " +
    "pt.adr_product_type_name, se.adr_seriousness_name, oc.adr_outcome_name, po.adr_possibility_name, rt.adr_report_type_name, " +
    "ca.adr_cause_name, dt.adr_dechallenge_type_name, rct.adr_rechallenge_type_name, " +
    "(SELECT t.opd_allergy_type_name FROM opd_allergy x JOIN opd_allergy_type t ON t.opd_allergy_type_id=x.opd_allergy_type_id " +
    "  WHERE x.hn=a.hn AND ABS(DATEDIFF(x.report_date, a.report_date))<=60 ORDER BY ABS(DATEDIFF(x.report_date, a.report_date)) LIMIT 1) AS allergy_type " +
    "FROM patient_adr a LEFT JOIN patient p ON p.hn=a.hn " +
    "LEFT JOIN adr_product_type pt ON pt.adr_product_type_id=a.adr_product_type_id " +
    "LEFT JOIN adr_seriousness se ON se.adr_seriousness_id=a.adr_seriousness_id " +
    "LEFT JOIN adr_outcome oc ON oc.adr_outcome_id=a.adr_outcome_id " +
    "LEFT JOIN adr_possibility po ON po.adr_possibility_id=a.adr_possibility_id " +
    "LEFT JOIN adr_report_type rt ON rt.adr_report_type_id=a.adr_report_type_id " +
    "LEFT JOIN adr_cause ca ON ca.adr_cause_id=a.adr_cause_id " +
    "LEFT JOIN adr_dechallenge_type dt ON dt.adr_dechallenge_type_id=a.adr_dechallenge_type_id " +
    "LEFT JOIN adr_rechallenge_type rct ON rct.adr_rechallenge_type_id=a.adr_rechallenge_type_id " +
    "WHERE a.report_date>='$from' ORDER BY a.report_date DESC, a.patient_adr_id DESC LIMIT 500")
  $meds = @{}
  if ($rows.Count) {
    $ids = ($rows | ForEach-Object { [HxDb]::Digits($_['patient_adr_id']) } | Where-Object { $_ }) -join ','
    foreach ($m in (DbQuery ("SELECT m.patient_adr_id, t.adr_medication_type_name, m.medication_name, m.medication_begin_date, m.medication_end_date, m.medication_icd, m.medication_idr " +
        "FROM patient_adr_medication m LEFT JOIN adr_medication_type t ON t.adr_medication_type_id=m.adr_medication_type_id WHERE m.patient_adr_id IN ($ids) ORDER BY m.patient_adr_medication_id"))) {
      $k = $m['patient_adr_id']
      if (-not $meds.ContainsKey($k)) { $meds[$k] = New-Object System.Collections.ArrayList }
      [void]$meds[$k].Add([ordered]@{ role = $m['adr_medication_type_name']; name = $m['medication_name']; begin = $m['medication_begin_date']
        end = $m['medication_end_date']; indication = $m['medication_icd']; usage = $m['medication_idr'] })
    }
  }
  $items = @($rows | ForEach-Object {
    [ordered]@{ id = $_['patient_adr_id']; hn = $_['hn']; name = $_['ptname'].Trim(); dept = $_['department']; an = $_['an']
      reportDate = $_['report_date']; onsetDate = $_['adverse_effect_date']; effect = $_['adverse_effect']; otherDx = $_['other_dx']
      labPe = $_['lab_pe_text']; drugs = $_['medication_list']; productType = $_['adr_product_type_name']; seriousness = $_['adr_seriousness_name']
      outcome = $_['adr_outcome_name']; possibility = $_['adr_possibility_name']; reportType = $_['adr_report_type_name']; cause = $_['adr_cause_name']
      dechallenge = $_['adr_dechallange']; dechallengeType = $_['adr_dechallenge_type_name']; rechallenge = $_['adr_rechallenge']
      rechallengeType = $_['adr_rechallenge_type_name']; continueRechallenge = $_['adr_continue_rechallenge']; noRechallenge = $_['adr_norechallenge']
      hasHistory = $_['has_adr_history']; doctor = $_['dx_doctor_name']; doctorPosition = $_['dx_doctor_position']
      officer = $_['entry_officer_name']; officerPosition = $_['entry_officer_position']; allergyType = $_['allergy_type']
      meds = @(if ($meds.ContainsKey($_['patient_adr_id'])) { $meds[$_['patient_adr_id']] }) }
  })
  [ordered]@{ ok = $true; items = $items }
}

function DbPatient($hn) {
  $rows = DbQuery "SELECT pname, fname, lname, birthday, sex FROM patient WHERE hn='$hn' LIMIT 1"
  if (-not $rows.Count) { return [ordered]@{ ok = $false; hn = $hn; error = 'ไม่พบ HN นี้' } }
  $p = $rows[0]
  [ordered]@{ ok = $true; hn = $hn; pname = $p['pname']; fname = $p['fname']; lname = $p['lname']; birthday = $p['birthday']; sex = $p['sex'] }
}

# วันนัดจาก DB แทน OCR: อ่านเมื่อเปลี่ยนคนไข้ แล้วทุก 20 วินาที (เผื่อเพิ่งลงนัดใน HOSxP) — DB ใช้ไม่ได้ค่อยกลับไป OCR
function ApptFromDb($hn) {
  if (-not $db -or -not $hn) { return $false }
  if ($apptDbAt.ContainsKey($hn) -and ((Get-Date) - $apptDbAt[$hn]).TotalSeconds -lt 20) { return $true }
  try {
    $a = DbAppts $hn
    $apptDbAt[$hn] = Get-Date
    $d = if ($a.Count) { ($a | ForEach-Object { $_.days } | Measure-Object -Maximum).Maximum } else { $null }
    $state.apptDays = $d; $script:apptByHn[$hn] = $d
    return $true
  } catch { return $false }
}

function DbEndpoint($path) {
  # endpoint ที่ไม่ใช้ HN
  if ($path -like '/db/denom*' -or $path -like '/db/adr*') {
    try { $res = if ($path -like '/db/denom*') { DbDenom } else { DbAdr $path } }
    catch { $res = [ordered]@{ ok = $false; error = "$_" } }
    return [HxDb]::Json($res)
  }
  $hn = $null
  if ($path -match '[?&]hn=([^&]*)') { $hn = [HxDb]::Digits([Uri]::UnescapeDataString($Matches[1])) }
  try {
    if (-not $hn) { throw 'ต้องระบุ hn เป็นตัวเลข' }
    $res = if ($path -like '/db/order*') { DbOrder $hn } elseif ($path -like '/db/visits*') { DbVisits $hn }
      elseif ($path -like '/db/meds*') { DbMeds $hn }
      elseif ($path -like '/db/patient*') { DbPatient $hn } else { throw 'ไม่รู้จัก endpoint' }
  } catch { $res = [ordered]@{ ok = $false; error = "$_" } }
  return [HxDb]::Json($res)
}

function FieldRightOf($frame, $labelText) {
  $label = $frame.FindAll($TS::Descendants, (ClassCond 'TcxLabel')) | Where-Object { $_.Current.Name -eq $labelText } | Select-Object -First 1
  if (-not $label) { return $null }
  $lr = $label.Current.BoundingRectangle
  $frame.FindAll($TS::Descendants, (ClassCond 'TcxDBTextEdit')) |
    Where-Object { $r = $_.Current.BoundingRectangle; [Math]::Abs($r.Y - $lr.Y) -lt 12 -and $r.X -gt $lr.X } |
    Sort-Object { $_.Current.BoundingRectangle.X } | Select-Object -First 1
}

# หน้าจอ จพ.เภสัช (DoctorWorkBenchQueueForm → บันทึกใบสั่งยา) ไม่ใช่หน้าจ่ายยาของเภสัช: ไม่มีป้าย HN/ชื่อ
#   HN   = TcxDBTextEdit ใน TPatientInformationType2Frame (ซ่อนอยู่นอกจอ แต่ UI Automation อ่านค่าได้)
#   ชื่อ = ชื่อของ TcxTabSheet ที่ครอบหน้านั้น เช่น "นายสายันต์ ทิพย์สว่าง [9]" (ตัด [คิว] ออก)
# เปิดได้หลายแท็บคนไข้ จึงเลือกหน้าที่ตารางใบสั่งยาอยู่บนจอจริง และค้นใหม่ทุก ~1.5 วินาที
function FindDispenseScreen2($main) {
  $best = $null
  foreach ($f in $main.FindAll($TS::Descendants, (ClassCond 'THOSxPDispensingEntryFrame'))) {
    $order = $f.FindFirst($TS::Descendants, (ClassCond 'THOSxPMedicationOrderFrame'))
    $grid = if ($order) { $order.FindFirst($TS::Descendants, (ClassCond 'TcxGridSite')) } else { $null }
    $info = $f.FindFirst($TS::Descendants, (ClassCond 'TPatientInformationType2Frame'))
    $hn = if ($info) { FieldRightOf $info 'HN' } else { $null }   # ใกล้ป้าย HN ที่สุด (ในกรอบมีเบอร์โทร/เลขบัตรด้วย จะหยิบผิดถ้าดูแค่ตัวเลข)
    if (-not $hn -or $hn.Current.Name.Trim() -notmatch '^\d{5,10}$') { continue }
    $cand = @{ hn = $hn; grid = $grid; frame = $f }
    if (-not $best) { $best = $cand }
    if ($grid -and (ElShowing $grid)) { $best = $cand; break }
  }
  if (-not $best) { return $false }
  $cache.hnEdit = $best.hn; $cache.grid = $best.grid; $cache.layout2 = $true
  $cache.apptLabel = $best.frame.FindAll($TS::Descendants, (ClassCond 'TcxLabel')) | Where-Object { $_.Current.Name -eq 'นัดครั้งหน้า' } | Select-Object -First 1
  $sheet = [System.Windows.Automation.TreeWalker]::RawViewWalker.GetParent($best.frame)
  $cache.nameEdit = if ($sheet -and $sheet.Current.ClassName -eq 'TcxTabSheet') { $sheet } else { $null }
  return $true
}

function FindDispenseScreen {
  $cache.hnEdit = $null; $cache.nameEdit = $null; $cache.apptList = $null; $cache.grid = $null; $cache.layout2 = $false; $cache.apptLabel = $null
  $proc = Get-Process HOSxPXE4 -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $proc) { return }
  $main = $AE::RootElement.FindFirst($TS::Children, (New-Object System.Windows.Automation.PropertyCondition($AE::ProcessIdProperty, [int]$proc.Id)))
  if (-not $main) { return }
  $frame = $main.FindFirst($TS::Descendants, (ClassCond 'THOSxPDiepensingDispenseEntryFrame'))
  if (-not $frame) { [void](FindDispenseScreen2 $main); return }
  $cache.hnEdit = FieldRightOf $frame 'HN'
  $cache.nameEdit = FieldRightOf $frame 'ชื่อ'
  $cache.apptList = $frame.FindFirst($TS::Descendants, (ClassCond 'THTMListBox'))
  $order = $frame.FindFirst($TS::Descendants, (ClassCond 'THOSxPMedicationOrderFrame'))
  if ($order) { $cache.grid = $order.FindFirst($TS::Descendants, (ClassCond 'TcxGridSite')) }
}

function HosxpMain {
  $proc = Get-Process HOSxPXE4 -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $proc) { return $null }
  $AE::RootElement.FindFirst($TS::Children, (New-Object System.Windows.Automation.PropertyCondition($AE::ProcessIdProperty, [int]$proc.Id)))
}

# หาหน้า Patient EMR ทุกหน้าที่เปิดอยู่ พร้อมช่อง HN/ชื่อ ของแต่ละหน้า (ค้นทั้งต้นไม้ช้า ~0.3 วินาที ทำทุก 3 วินาที)
function ScanEmr {
  $list = @()
  $main = HosxpMain
  if ($main) {
    foreach ($emr in $main.FindAll($TS::Descendants, (ClassCond 'TPtEMRForm'))) {
      $edits = @($emr.FindAll($TS::Descendants, (ClassCond 'TcxTextEdit')))
      $hn = $edits | Where-Object { $_.Current.Name.Trim() -match '^\d{5,10}$' } |
        Sort-Object { $_.Current.BoundingRectangle.Y }, { $_.Current.BoundingRectangle.X } | Select-Object -First 1
      if (-not $hn) { continue }
      $hr = $hn.Current.BoundingRectangle
      $name = $edits | Where-Object { $r = $_.Current.BoundingRectangle; [Math]::Abs($r.Y - $hr.Y) -lt 6 -and $r.X -gt $hr.X } |
        Sort-Object { $_.Current.BoundingRectangle.X } | Select-Object -First 1
      # ตารางยาของ visit ที่เลือก (แท็บ "รายการยา" → TcxGridSite) มีเฉพาะตอนแท็บนั้นเปิดอยู่
      $sheet = $emr.FindAll($TS::Descendants, (ClassCond 'TcxTabSheet')) | Where-Object { $_.Current.Name -eq 'รายการยา' } | Select-Object -First 1
      $grid = if ($sheet) { $sheet.FindFirst($TS::Descendants, (ClassCond 'TcxGridSite')) } else { $null }
      $list += , @{ form = $emr; hn = $hn; name = $name; grid = $grid }
    }
  }
  $cache.emr = $list
  if (-not $list.Count) { $state.emrHn = ''; $state.emrName = '' }
}

# เลือกหน้า EMR ที่อยู่บนสุด (กลางหน้านั้นไม่ถูกหน้าต่างอื่นบัง) ถ้าไม่มี ใช้หน้าที่ยังเห็นช่อง HN
function ReadEmr {
  $best = $null
  foreach ($e in $cache.emr) {
    try {
      $fr = $e.form.Current.BoundingRectangle
      if ([HxWin]::IsShowing([int]($fr.X + $fr.Width / 2), [int]($fr.Y + $fr.Height / 2), [IntPtr]$e.form.Current.NativeWindowHandle)) { $best = $e; break }
      if (-not $best -and (ElShowing $e.hn)) { $best = $e }
    } catch {}
  }
  if (-not $best) { return }
  $hn = $best.hn.Current.Name.Trim()
  if ($hn -notmatch '^\d{5,10}$') { return }
  $state.emrHn = $hn
  $state.emrName = if ($best.name) { $best.name.Current.Name.Trim() } else { '' }
  if ((Get-Date) -ge $script:nextEmrGrid) {
    $script:nextEmrGrid = (Get-Date).AddSeconds(2)
    CaptureEmrGrid $best.grid $hn $best.form
  }
}

# จับภาพตารางยาของ visit ที่เภสัชเลือกใน Patient EMR ให้หน้าต่างลอยบันทึกคลินิก OCR เอาชื่อยาไปใส่ช่องยาคงเหลือ
# ภาพเปลี่ยน (เลือก visit อื่น) → emrGridVer เพิ่ม; แฮชรวม HN ไว้ด้วย คนละคนที่บังเอิญภาพเหมือนกันจะได้ไม่ถือว่าซ้ำ
# visit ที่เปิดอยู่ใน Patient EMR (แท็บ Screen & ตรวจรักษา) — ช่องไม่มีป้ายกำกับ อ่านตามรูปแบบ/ตำแหน่ง:
#   วันที่มา = ช่องที่เป็น "20 พฤษภาคม 2569" (บนสุด), เวลา = ช่อง "07:48:22" แถวเดียวกัน
#   ห้องตรวจ = ช่องขวาสุดของแถวถัดลงมา (แถว สิทธิการรักษา / เลขที่ / ห้องตรวจ)
# คืน "วันที่|เวลา|ห้องตรวจ" หรือ '' ถ้าหาไม่เจอ
function ReadEmrVisit($form) {
  $sheet = $form.FindAll($TS::Descendants, (ClassCond 'TcxTabSheet')) | Where-Object { $_.Current.Name -like 'Screen*' } | Select-Object -First 1
  $root = if ($sheet) { $sheet } else { $form }
  $edits = @($root.FindAll($TS::Descendants, (ClassCond 'TcxTextEdit')) | ForEach-Object { @{ t = $_.Current.Name.Trim(); r = $_.Current.BoundingRectangle } })
  $date = $edits | Where-Object { $_.t -match '^\d{1,2}\s+\S+\s+\d{4}$' } | Sort-Object { $_.r.Y } | Select-Object -First 1
  if (-not $date) { return '' }
  $dr = $date.r
  $time = $edits | Where-Object { [Math]::Abs($_.r.Y - $dr.Y) -lt 6 -and $_.t -match '^\d{1,2}:\d{2}' } | Select-Object -First 1
  $room = $edits | Where-Object { $_.r.Y -gt $dr.Y + 10 -and $_.r.Y -lt $dr.Y + 40 -and $_.r.X -gt $dr.X + 300 } |
    Sort-Object { $_.r.Y }, { -$_.r.X } | Select-Object -First 1
  return ($date.t + '|' + $(if ($time) { $time.t } else { '' }) + '|' + $(if ($room) { $room.t } else { '' }))
}

function CaptureEmrGrid($grid, $hn, $form) {
  if (-not $grid -or -not (ElShowing $grid)) { return }
  $r = $grid.Current.BoundingRectangle
  if ($r.Width -le 0 -or $r.Height -le 0) { return }
  $vis = VisibleWidth $r $grid
  if ($vis -lt 300) { return }
  $bmp = CaptureScreen ([int]$r.X) ([int]$r.Y) $vis ([int]$r.Height)
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  $bytes = $ms.ToArray(); $ms.Dispose()
  $visit = ''
  try { $visit = ReadEmrVisit $form } catch {}
  # รวม visit ไว้ในแฮช — เปิด visit อื่นที่ยาเหมือนกันทุกตัว หน้าเว็บก็ต้องรู้ว่าเป็นคนละ visit
  $raw = $hn + '|' + $visit + '|' + [BitConverter]::ToString($md5.ComputeHash($bytes))
  if ($raw -ne $script:emrGridRaw) {
    $script:emrGridRaw = $raw; $script:emrGridPng = $bytes; $state.emrGridVer++; $state.emrVisit = $visit
    $state.emrGridHash = ([BitConverter]::ToString($md5.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($raw))) -replace '-', '').Substring(0, 16)
  }
}

# ความกว้างจากขอบซ้ายของ control ที่มองเห็นจริง (ไม่ถูกหน้าต่างอื่นบัง) — สุ่มตรวจเป็นจุดๆ
function VisibleWidth($r, $el) {
  $hwnd = [IntPtr]$el.Current.NativeWindowHandle
  $ys = @([int]($r.Y + 4), [int]($r.Y + $r.Height / 2), [int]($r.Y + $r.Height - 4))
  for ($x = [int]$r.X + 4; $x -lt $r.X + $r.Width; $x += 30) {
    foreach ($y in $ys) { if (-not [HxWin]::IsShowing($x, $y, $hwnd)) { return [int]($x - $r.X - 4) } }
  }
  return [int]$r.Width
}

# control นี้อยู่บนจอให้เห็นจริงไหม (ตรวจจุดใกล้มุมซ้ายบน ซึ่งหน้าต่างลอยที่วางทางขวาไม่บัง)
function ElShowing($el) {
  if (-not $el) { return $false }
  $r = $el.Current.BoundingRectangle
  if ($r.IsEmpty -or $r.Width -le 0 -or $el.Current.IsOffscreen) { return $false }
  return [HxWin]::IsShowing([int]($r.X + 8), [int]($r.Y + [Math]::Min(8, $r.Height / 2)), [IntPtr]$el.Current.NativeWindowHandle)
}

function CaptureScreen($x, $y, $w, $h) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($x, $y, 0, 0, $bmp.Size); $g.Dispose()
  return $bmp
}

function ReadApptDays {
  $list = $cache.apptList
  if (-not $list -or -not $ocr) { return $null }
  $r = $list.Current.BoundingRectangle
  # คนไข้บางคนมีหลายนัด (เช่น นัด LAB 7 วัน + นัดพบแพทย์ 126 วัน) อ่านทุกบรรทัดในกล่อง แล้วใช้วันนัดที่ไกลที่สุด
  $w = [int]$r.Width; $h = [int][Math]::Min($r.Height, 150)
  if ($w -le 0 -or $h -le 0) { return $null }
  $vis = VisibleWidth (New-Object System.Windows.Rect $r.X, $r.Y, $w, $h) $list
  if ($vis -lt 250) { $state.covered = $true; return $null }   # "1.[119 วัน] 22 ..." อยู่ต้นบรรทัด เห็นแค่ช่วงแรกก็พอ
  return OcrDays ([int]$r.X) ([int]$r.Y) $vis $h
}

# หน้า "ข้อมูลทั่วไป" ของ จพ.: วันนัดเป็นข้อความที่วาดเอง "นัดครั้งหน้า[126 วัน] 4 กุมภาพันธ์ ..." อยู่ถัดจากป้าย "นัดครั้งหน้า"
# อ่านผ่าน API ไม่ได้ จึง OCR แถบทางขวาของป้ายเฉพาะตอนป้ายนั้นอยู่บนจอ (ถ้าถูกบัง OCR จะไม่เจอเลข ก็คงค่าเดิมไว้)
# คนไข้ที่มีหลายนัด มีบรรทัดที่สองใต้ป้าย "วันนัดอื่นๆ [119 วัน]" (ขึ้นต้นตรงแนวป้าย) — อ่านแยกอีกแถบ แล้วใช้นัดที่ไกลที่สุด
# (อ่านรวมสองบรรทัดในภาพเดียวไม่ได้ OCR ทิ้ง "[8 วัน]" สีแดงตัวเล็กของบรรทัดแรกไป)
function ReadApptCard {
  $lb = $cache.apptLabel
  if (-not $lb -or -not (ElShowing $lb)) { return $null }
  $r = $lb.Current.BoundingRectangle
  $x = [int]($r.X + $r.Width + 2); $y = [int]($r.Y - 2); $h = [int]($r.Height + 4)
  $first = OcrDays $x $y 380 $h $true
  $other = $null
  try { $other = OcrDays ([int]$r.X) ([int]($r.Y + $r.Height - 6)) 300 ([int]($r.Height + 4)) } catch {}
  if ($other -ne $null -and ($first -eq $null -or $other -gt $first)) { return $other }
  return $first
}

# OCR ภาษาอังกฤษของ Windows อ่านแถบข้อความ เอาตัวเลขในวงเล็บ [N วัน]
function OcrDays($x, $y, $vis, $h, [bool]$loose = $false) {
  $bmp = CaptureScreen $x $y $vis $h
  # ขยาย 2 เท่า OCR อ่านตัวเลขเล็กๆ ได้แม่นขึ้น
  $big = New-Object System.Drawing.Bitmap ($vis * 2), ($h * 2)
  $g2 = [System.Drawing.Graphics]::FromImage($big)
  $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g2.DrawImage($bmp, 0, 0, $vis * 2, $h * 2); $g2.Dispose(); $bmp.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $big.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $big.Dispose()
  $ms.Position = 0
  $ras = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($ms)
  $dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ras)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $sb = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $res = Await ($ocr.RecognizeAsync($sb)) ([Windows.Media.Ocr.OcrResult])
  $ms.Dispose()
  if (-not $loose) {
    # กล่อง "ข้อมูลการนัดหมาย": ทุกบรรทัดขึ้นต้น "N.[X วัน]" เอา X ที่มากที่สุด (นัดไกลสุด)
    $days = @($res.Lines | ForEach-Object { if ($_.Text -match '\[\s*(\d{1,4})') { [int]$Matches[1] } })
    if ($days.Count) { return ($days | Measure-Object -Maximum).Maximum }
    return $null
  }
  foreach ($line in $res.Lines) {
    if ($line.Text -match '\[\s*(\d{1,4})') { return [int]$Matches[1] }
  }
  # OCR บางครั้งทิ้ง "[" หรืออ่านเป็น "1"/"I" เช่น "126 วัน" → "126" หรือ "1126" — ใช้เลขชุดแรกต้นบรรทัด
  # วันนัดเกิน 999 วันไม่มีจริง ถ้าได้ 4 หลักแปลว่าวงเล็บถูกอ่านเป็นเลข 1 ตัดหลักหน้าออก
  if (-not $loose) { return $null }   # กล่อง "ข้อมูลการนัดหมาย" ขึ้นต้นด้วยลำดับ "1." เลขชุดแรกจึงไม่ใช่วัน ใช้เฉพาะแถบนัดครั้งหน้า
  foreach ($line in $res.Lines) {
    if ($line.Text -match '^\W*(\d{1,4})\b') {
      $n = [int]$Matches[1]
      if ($n -ge 1000) { $n = $n % 1000 }
      if ($n -gt 0) { return $n }
    }
  }
  return $null
}

# จับภาพตารางใบสั่งยา เปลี่ยนเลข gridVer เมื่อภาพเปลี่ยน หน้าเว็บจะได้ OCR ใหม่เฉพาะตอนจำเป็น
function CaptureGrid {
  $grid = $cache.grid
  if (-not $grid) { return }
  $r = $grid.Current.BoundingRectangle
  if ($r.Width -le 0 -or $r.Height -le 0) { return }
  $vis = VisibleWidth $r $grid
  $state.gridCut = $vis -lt $r.Width
  if ($vis -lt 300) { $state.covered = $true; return }
  $bmp = CaptureScreen ([int]$r.X) ([int]$r.Y) $vis ([int]$r.Height)
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  $bytes = $ms.ToArray(); $ms.Dispose()
  $hash = [BitConverter]::ToString($md5.ComputeHash($bytes))
  # gridHash ให้หน้าเว็บจำผล OCR ตามภาพ (HN เดิม+ภาพเดิม = ไม่ต้อง OCR ซ้ำ ตอนสลับหน้าไปมา)
  if ($hash -ne $script:gridHash) { $script:gridHash = $hash; $script:gridPng = $bytes; $state.gridVer++; $state.gridHash = ($hash -replace '-', '').Substring(0, 16) }
}

function UpdateState {
  $hn = ''; $name = ''
  try {
    # หน้าจอ จพ. เปิดหลายแท็บได้ ค้นใหม่บ่อยเพื่อตามแท็บที่อยู่บนจอ
    if (-not $cache.hnEdit -or ($cache.layout2 -and (Get-Date) -ge $script:nextFind)) {
      FindDispenseScreen; $script:nextFind = (Get-Date).AddMilliseconds(1500)
    }
    if ($cache.hnEdit) {
      $hn = $cache.hnEdit.Current.Name.Trim()
      if ($cache.nameEdit) { $name = ($cache.nameEdit.Current.Name.Trim() -replace '\s*\[\d+\]\s*$', '') }
    }
  } catch {
    # หน้าจ่ายยาถูกปิด/สร้างใหม่ — element เดิมใช้ไม่ได้แล้ว ค้นหาใหม่
    FindDispenseScreen
    if ($cache.hnEdit) { try { $hn = $cache.hnEdit.Current.Name.Trim() } catch {} }
  }

  if ($hn -ne $script:lastHn) {
    # จำวันนัดที่เคยอ่านได้ของ HN นี้ไว้ (จพ. ดูวันนัดที่หน้าหนึ่งแล้วสลับไปหน้าสั่งยา ซึ่งอ่านวันนัดไม่ได้)
    $script:lastHn = $hn; $state.apptDays = if ($hn -and $script:apptByHn.ContainsKey($hn)) { $script:apptByHn[$hn] } else { $null }
    $script:gridPng = $null; $script:gridHash = ''; $state.gridHash = ''; $state.gridVer++
    $script:nextAppt = [DateTime]::MinValue; $script:nextGrid = [DateTime]::MinValue
  }
  $active = $false
  # หน้าจอ จพ. ช่อง HN ซ่อนนอกจอเสมอ ใช้ตารางใบสั่งยาที่เห็นบนจอเป็นตัวบอกว่าอยู่หน้าบันทึกใบสั่งยา
  if ($hn) { try { $active = if ($cache.layout2) { ElShowing $cache.grid } else { (ElShowing $cache.hnEdit) -and (ElShowing $cache.grid) } } catch {} }
  $state.active = $active
  # หน้า "ข้อมูลทั่วไป" ของ จพ. (กรอบข้อมูลผู้ป่วยอยู่บนจอ ตารางยาอาจไม่เต็ม) อ่านวันนัดแล้วจำตาม HN ไว้ใช้ตอนสลับไปหน้าสั่งยา
  $apptDb = $false
  if ($hn) { $apptDb = ApptFromDb $hn }
  if ($hn -and -not $apptDb -and $cache.layout2 -and (Get-Date) -ge $script:nextCard) {
    $script:nextCard = (Get-Date).AddSeconds(2)
    try { $d = ReadApptCard; if ($d -ne $null) { $state.apptDays = $d; $script:apptByHn[$hn] = $d } } catch {}
  }
  if ($active) {
    $state.covered = $false
    # วันนัดอ่านซ้ำทุก 5 วินาที ตารางยาทุก 2 วินาที เผื่อข้อมูลโหลดขึ้นมาทีหลัง หรือเพิ่งเลื่อนหน้าต่างที่บังออก
    if (-not $apptDb -and (Get-Date) -ge $script:nextAppt) {
      try { $d = ReadApptDays; if ($d -ne $null) { $state.apptDays = $d; $script:apptByHn[$hn] = $d } } catch {}
      $script:nextAppt = (Get-Date).AddSeconds(5)
    }
    if ((Get-Date) -ge $script:nextGrid) {
      try { CaptureGrid } catch {}
      $script:nextGrid = (Get-Date).AddSeconds(2)
    }
  }
  if ((Get-Date) -ge $script:nextEmrScan) {
    try { ScanEmr } catch { $cache.emr = @() }
    $script:nextEmrScan = (Get-Date).AddSeconds(3)
  }
  try { ReadEmr } catch {}
  $state.ok = [bool]$cache.hnEdit
  $state.hn = $hn; $state.name = $name
  $state.ts = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
}

function Respond($client) {
  $stream = $client.GetStream()
  $stream.ReadTimeout = 1000
  $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII)
  $first = $reader.ReadLine(); $origin = ''
  while (($line = $reader.ReadLine())) { if ($line -match '^Origin:\s*(.+)$') { $origin = $Matches[1].Trim() } }
  $method = ($first -split ' ')[0]; $path = ($first -split ' ')[1]
  $cors = ''
  if ($ALLOWED_ORIGINS -contains $origin) {
    $cors = "Access-Control-Allow-Origin: $origin`r`nAccess-Control-Allow-Private-Network: true`r`nAccess-Control-Allow-Methods: GET`r`nAccess-Control-Expose-Headers: X-Grid-Hash`r`nVary: Origin`r`n"
  }
  $type = 'application/json; charset=utf-8'; $bytes = [byte[]]@()
  if ($method -eq 'OPTIONS') { $status = '204 No Content' }
  elseif ($path -like '/current*') { $status = '200 OK'; $bytes = [System.Text.Encoding]::UTF8.GetBytes(($state | ConvertTo-Json -Compress)) }
  elseif ($path -like '/db/*') { $status = '200 OK'; $bytes = [System.Text.Encoding]::UTF8.GetBytes((DbEndpoint $path)) }
  elseif ($path -like '/grid.png*' -and $script:gridPng) { $status = '200 OK'; $type = 'image/png'; $bytes = $script:gridPng }
  elseif ($path -like '/emrgrid.png*' -and $script:emrGridPng) { $status = '200 OK'; $type = 'image/png'; $bytes = $script:emrGridPng }
  else { $status = '404 Not Found' }
  $extra = if ($path -like '/grid.png*' -and $state.gridHash) { "X-Grid-Hash: $($state.gridHash)`r`n" }
    elseif ($path -like '/emrgrid.png*' -and $state.emrGridHash) { "X-Grid-Hash: $($state.emrGridHash)`r`n" } else { '' }
  $head = "HTTP/1.1 $status`r`nContent-Type: $type`r`nCache-Control: no-store`r`n$cors$extra" + "Content-Length: $($bytes.Length)`r`nConnection: close`r`n`r`n"
  $hb = [System.Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($hb, 0, $hb.Length)
  if ($bytes.Length) { $stream.Write($bytes, 0, $bytes.Length) }
  $client.Close()
}

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $PORT)
try { $listener.Start() } catch { Write-Host "เปิดพอร์ต $PORT ไม่ได้ — อาจมี HOSxP Bridge เปิดอยู่แล้ว"; exit 1 }
Write-Host "HOSxP Bridge ทำงานแล้ว ที่ http://127.0.0.1:$PORT/current  (ปิดหน้าต่างนี้เพื่อหยุด)"
if ($db) { try { [void](DbQuery 'SELECT 1'); Write-Host "เชื่อมฐานข้อมูล HOSxP แล้ว" } catch { Write-Host "ยังเชื่อมฐานข้อมูลไม่ได้: $_ (ใช้ OCR แทน)" } }
else { Write-Host "ไม่ได้ตั้งฐานข้อมูล ($($state.dbErr)) — ใช้ OCR" }
$nextPoll = [DateTime]::MinValue
while ($true) {
  if ((Get-Date) -ge $nextPoll) { UpdateState; $nextPoll = (Get-Date).AddSeconds(1) }
  while ($listener.Pending()) { try { Respond $listener.AcceptTcpClient() } catch {} }
  Start-Sleep -Milliseconds 100
}
