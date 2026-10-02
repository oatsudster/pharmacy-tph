/* ai-assistant.js — ผู้ช่วย AI (Claude Haiku/Sonnet) ใช้ร่วมกันทุกหน้า
 *
 * ใช้งาน (ท้ายแต่ละหน้า):
 *   AiAssistant.init({
 *     title: 'ผู้ช่วย AI — งานคลินิก',
 *     context: 'คำอธิบายหน้านี้ให้ AI',
 *     suggestions: ['คำถามตัวอย่าง', ...],
 *     datasets: {
 *       visits: { label: 'บันทึกการเยี่ยม', description: '...', rows: () => [...], private: ['hn', 'name'] },
 *     },
 *   });
 *
 * AI ไม่เห็นข้อมูลทั้งก้อน — มันเรียกเครื่องมือ (query_data / export_report) ที่รันในเบราว์เซอร์
 * ผลลัพธ์ที่ส่งกลับไปให้ AI จะตัดฟิลด์ใน `private` ออก (ชื่อ/HN/AN) ส่วนไฟล์ Excel/PDF สร้างในเครื่อง
 * rows() ถ้ามีฟิลด์ `date` (YYYY-MM-DD) จะเติม `month` (YYYY-MM) และ `fiscal_year` (พ.ศ. ต.ค.–ก.ย.) ให้อัตโนมัติ
 */
'use strict';

(function () {
  const AI_URL = 'https://ai-assistant.oatsudster.workers.dev';
  const AI_TOKEN = 'tphAi7Kq3mXv9RzLw2Ns5Yd8';
  const MODEL_KEY = 'tph_ai_model_v1';
  const MAX_STEPS = 8;
  const MAX_TOOL_CHARS = 8000;
  const MAX_EXPORT_ROWS = 5000;

  let cfg = null;
  let history = [];
  let busy = false;
  let model = 'sonnet';
  let exportsById = {};
  let exportSeq = 0;

  try { const m = localStorage.getItem(MODEL_KEY); if (m === 'haiku' || m === 'sonnet') model = m; } catch (e) { /* ignore */ }

  /* ══ DATA ══════════════════════════════════════════════════ */

  function prepRows(ds) {
    let rows = [];
    try { rows = ds.rows() || []; } catch (e) { console.error('ai rows()', e); }
    return rows.map(r => {
      const o = Object.assign({}, r);
      const d = typeof o.date === 'string' ? o.date : '';
      if (/^\d{4}-\d{2}/.test(d)) {
        const y = +d.slice(0, 4), mo = +d.slice(5, 7);
        o.month = d.slice(0, 7);
        o.fiscal_year = (mo >= 10 ? y + 1 : y) + 543;
      }
      return o;
    });
  }

  function isPrivate(ds, f) { return (ds.private || []).includes(f); }

  function dsOf(name) {
    const ds = cfg.datasets[name];
    if (!ds) throw new Error('ไม่พบชุดข้อมูล ' + name + ' (มี: ' + Object.keys(cfg.datasets).join(', ') + ')');
    return ds;
  }

  function cmp(a, b) {
    const na = typeof a === 'number' ? a : (a !== '' && a != null && !isNaN(+a) ? +a : NaN);
    const nb = typeof b === 'number' ? b : (b !== '' && b != null && !isNaN(+b) ? +b : NaN);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return String(a == null ? '' : a).localeCompare(String(b == null ? '' : b), 'th');
  }

  function matchFilter(row, f) {
    const v = row[f.field];
    const x = f.value;
    const sv = String(v == null ? '' : v).toLowerCase();
    switch (f.op) {
      case 'eq': return typeof v === 'number' ? v === +x : sv === String(x).toLowerCase();
      case 'ne': return typeof v === 'number' ? v !== +x : sv !== String(x).toLowerCase();
      case 'contains': return sv.includes(String(x).toLowerCase());
      case 'not_contains': return !sv.includes(String(x).toLowerCase());
      case 'gt': return v != null && v !== '' && cmp(v, x) > 0;
      case 'gte': return v != null && v !== '' && cmp(v, x) >= 0;
      case 'lt': return v != null && v !== '' && cmp(v, x) < 0;
      case 'lte': return v != null && v !== '' && cmp(v, x) <= 0;
      case 'in': return (Array.isArray(x) ? x : [x]).some(y => sv === String(y).toLowerCase());
      case 'empty': return v == null || v === '' || (Array.isArray(v) && !v.length);
      case 'not_empty': return !(v == null || v === '' || (Array.isArray(v) && !v.length));
      default: throw new Error('op ไม่รู้จัก: ' + f.op);
    }
  }

  function applyFilters(rows, filters) {
    const fs = Array.isArray(filters) ? filters : [];
    return rows.filter(r => fs.every(f => matchFilter(r, f)));
  }

  function stripPrivate(ds, row, fields) {
    const out = {};
    const keys = fields && fields.length ? fields : Object.keys(row);
    keys.forEach(k => { if (!isPrivate(ds, k) && k in row) out[k] = row[k]; });
    return out;
  }

  /* ══ TOOLS ═════════════════════════════════════════════════ */

  const FILTER_SCHEMA = {
    type: 'array',
    description: 'เงื่อนไขกรอง (AND ทั้งหมด) แต่ละข้อ {field, op, value} — op: eq, ne, contains, not_contains, gt, gte, lt, lte, in (value เป็น array), empty, not_empty. วันที่เทียบเป็นข้อความ YYYY-MM-DD ได้',
    items: {
      type: 'object',
      properties: {
        field: { type: 'string' },
        op: { type: 'string', enum: ['eq', 'ne', 'contains', 'not_contains', 'gt', 'gte', 'lt', 'lte', 'in', 'empty', 'not_empty'] },
        value: {},
      },
      required: ['field', 'op'],
    },
  };

  const TOOLS = [
    {
      name: 'list_datasets',
      description: 'ดูรายชื่อชุดข้อมูลในหน้านี้ พร้อมฟิลด์ ชนิด และตัวอย่างค่า — เรียกก่อนถ้าไม่แน่ใจชื่อฟิลด์',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'query_data',
      description: 'ค้นหา/นับ/รวมยอดข้อมูล. ไม่ใส่ group_by และ aggregate = ดึงรายการ (สูงสุด 40 แถว). ใส่ aggregate อย่างเดียว = ค่าสรุปรวม. ใส่ group_by (+aggregate, ค่าเริ่มต้น count) = สรุปแยกกลุ่ม',
      input_schema: {
        type: 'object',
        properties: {
          dataset: { type: 'string' },
          filters: FILTER_SCHEMA,
          group_by: { type: 'array', items: { type: 'string' }, description: 'ฟิลด์ที่ใช้แยกกลุ่ม (สูงสุด 2) ห้ามใช้ฟิลด์ที่ซ่อน' },
          aggregate: {
            type: 'object',
            properties: { op: { type: 'string', enum: ['count', 'sum', 'avg', 'min', 'max'] }, field: { type: 'string' } },
            required: ['op'],
          },
          fields: { type: 'array', items: { type: 'string' }, description: 'ฟิลด์ที่ต้องการเมื่อดึงรายการ' },
          sort_by: { type: 'string' },
          sort_dir: { type: 'string', enum: ['asc', 'desc'] },
          limit: { type: 'integer', description: 'จำนวนแถว/กลุ่มสูงสุด (ค่าเริ่มต้น 30, สูงสุด 40)' },
        },
        required: ['dataset'],
      },
    },
    {
      name: 'export_report',
      description: 'สร้างรายงานให้ดาวน์โหลด (Excel/PDF) จากชุดข้อมูลตามเงื่อนไข. ไฟล์สร้างในเครื่องผู้ใช้ และใส่ฟิลด์ที่ซ่อนได้. เมื่อเรียกแล้ว ระบบจะแสดงปุ่มดาวน์โหลดให้ผู้ใช้เอง ให้บอกผู้ใช้ให้กดปุ่มด้านล่าง',
      input_schema: {
        type: 'object',
        properties: {
          dataset: { type: 'string' },
          title: { type: 'string', description: 'ชื่อรายงานภาษาไทย' },
          filters: FILTER_SCHEMA,
          fields: { type: 'array', items: { type: 'string' }, description: 'คอลัมน์ที่ต้องการ (ตามลำดับ)' },
          sort_by: { type: 'string' },
          sort_dir: { type: 'string', enum: ['asc', 'desc'] },
        },
        required: ['dataset', 'title', 'fields'],
      },
    },
  ];

  function toolListDatasets() {
    const out = {};
    Object.entries(cfg.datasets).forEach(([name, ds]) => {
      const rows = prepRows(ds);
      const fields = {};
      const keys = new Set();
      rows.slice(0, 300).forEach(r => Object.keys(r).forEach(k => keys.add(k)));
      keys.forEach(k => {
        if (isPrivate(ds, k)) { fields[k] = 'ซ่อน (กรองด้วยค่าได้ แต่ไม่แสดงค่า)'; return; }
        const vals = rows.slice(0, 1000).map(r => r[k]).filter(v => v != null && v !== '');
        const type = vals.length && vals.every(v => typeof v === 'number') ? 'number' : 'text';
        let note = type;
        if (type === 'text') {
          const uniq = [...new Set(vals.map(v => String(v)))];
          if (uniq.length && uniq.length <= 15) note += ' ค่าที่พบ: ' + uniq.map(s => s.slice(0, 40)).join(' | ');
        } else if (vals.length) {
          note += ' ช่วง ' + Math.min(...vals) + '–' + Math.max(...vals);
        }
        if (ds.fields && ds.fields[k]) note += ' — ' + ds.fields[k];
        fields[k] = note;
      });
      out[name] = { label: ds.label, description: ds.description || '', rows: rows.length, fields };
    });
    return out;
  }

  function toolQuery(inp) {
    const ds = dsOf(inp.dataset);
    const all = prepRows(ds);
    const rows = applyFilters(all, inp.filters);
    const limit = Math.min(Math.max(parseInt(inp.limit) || 30, 1), 40);
    const dir = inp.sort_dir === 'asc' ? 1 : -1;
    const agg = inp.aggregate;
    const gb = Array.isArray(inp.group_by) ? inp.group_by.slice(0, 2) : [];
    gb.forEach(f => { if (isPrivate(ds, f)) throw new Error('ฟิลด์ ' + f + ' ถูกซ่อน ใช้แยกกลุ่มไม่ได้'); });
    if (agg && agg.field && isPrivate(ds, agg.field)) throw new Error('ฟิลด์ ' + agg.field + ' ถูกซ่อน');

    const calc = list => {
      const op = (agg && agg.op) || 'count';
      if (op === 'count') return list.length;
      const nums = list.map(r => parseFloat(r[agg.field])).filter(n => !isNaN(n));
      if (!nums.length) return null;
      const r2 = n => Math.round(n * 100) / 100;
      if (op === 'sum') return r2(nums.reduce((a, b) => a + b, 0));
      if (op === 'avg') return r2(nums.reduce((a, b) => a + b, 0) / nums.length);
      if (op === 'min') return Math.min(...nums);
      return Math.max(...nums);
    };

    if (gb.length) {
      const groups = new Map();
      rows.forEach(r => {
        const keyVals = gb.map(f => (r[f] == null || r[f] === '' ? '(ว่าง)' : r[f]));
        const k = JSON.stringify(keyVals);
        if (!groups.has(k)) groups.set(k, { keyVals, list: [] });
        groups.get(k).list.push(r);
      });
      let res = [...groups.values()].map(g => {
        const o = {};
        gb.forEach((f, i) => { o[f] = g.keyVals[i]; });
        o.value = calc(g.list);
        o.rows = g.list.length;
        return o;
      });
      const sk = inp.sort_by && (gb.includes(inp.sort_by) || inp.sort_by === 'value') ? inp.sort_by : 'value';
      const sd = inp.sort_by ? dir : -1;
      res.sort((a, b) => sd * cmp(a[sk], b[sk]));
      return { matched: rows.length, groups: res.length, aggregate: agg || { op: 'count' }, result: res.slice(0, limit) };
    }
    if (agg) return { matched: rows.length, aggregate: agg, value: calc(rows) };

    if (inp.sort_by) rows.sort((a, b) => dir * cmp(a[inp.sort_by], b[inp.sort_by]));
    return {
      matched: rows.length,
      shown: Math.min(rows.length, limit),
      rows: rows.slice(0, limit).map(r => stripPrivate(ds, r, inp.fields)),
    };
  }

  function toolExport(inp) {
    const ds = dsOf(inp.dataset);
    let rows = applyFilters(prepRows(ds), inp.filters);
    if (inp.sort_by) {
      const dir = inp.sort_dir === 'desc' ? -1 : 1;
      rows = rows.slice().sort((a, b) => dir * cmp(a[inp.sort_by], b[inp.sort_by]));
    }
    const fields = (inp.fields || []).filter(Boolean);
    if (!fields.length) throw new Error('ต้องระบุ fields');
    if (!rows.length) return { ok: false, message: 'ไม่พบข้อมูลตามเงื่อนไข จึงไม่สร้างรายงาน' };
    const id = 'x' + (++exportSeq);
    exportsById[id] = { title: inp.title || 'รายงาน', fields, labels: fields.map(f => (ds.fieldLabels && ds.fieldLabels[f]) || f), rows: rows.slice(0, MAX_EXPORT_ROWS), ds };
    pendingExportIds.push(id);
    return { ok: true, export_id: id, rows: rows.length, message: 'สร้างรายงานพร้อมแล้ว ผู้ใช้จะเห็นปุ่มดาวน์โหลด Excel/PDF ใต้ข้อความของคุณ' };
  }

  let pendingExportIds = [];

  function runTool(name, input) {
    try {
      let out;
      if (name === 'list_datasets') out = toolListDatasets();
      else if (name === 'query_data') out = toolQuery(input || {});
      else if (name === 'export_report') out = toolExport(input || {});
      else {
        const extra = (cfg.extraTools || []).find(t => t.name === name);
        if (!extra) throw new Error('ไม่มีเครื่องมือ ' + name);
        out = extra.run(input || {});
      }
      let s = JSON.stringify(out);
      if (s.length > MAX_TOOL_CHARS) s = s.slice(0, MAX_TOOL_CHARS) + '…(ตัดทอน ลดผลลัพธ์ด้วย filters/limit)';
      return { content: s };
    } catch (e) {
      return { content: 'ข้อผิดพลาด: ' + e.message, is_error: true };
    }
  }

  /* ══ EXPORT BUTTONS ════════════════════════════════════════ */

  function cellText(v) {
    if (v == null) return '';
    if (Array.isArray(v)) return v.map(cellText).join(', ');
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
  }

  function doExport(id, kind) {
    const ex = exportsById[id];
    if (!ex) return;
    const stamp = new Date().toISOString().slice(0, 10);
    const safe = ex.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
    if (kind === 'excel') {
      if (typeof expExcel !== 'function') { alert('ไม่พบตัวช่วย export Excel ในหน้านี้'); return; }
      const data = ex.rows.map(r => {
        const o = {};
        ex.fields.forEach((f, i) => { o[ex.labels[i]] = cellText(r[f]); });
        return o;
      });
      expExcel([{ name: ex.title.slice(0, 31), data }], safe + '_' + stamp);
    } else {
      if (typeof expPDF !== 'function') { alert('ไม่พบตัวช่วย export PDF ในหน้านี้'); return; }
      expPDF({
        title: ex.title,
        subtitle: 'สร้างโดยผู้ช่วย AI · ' + new Date().toLocaleDateString('th-TH'),
        headers: ex.labels,
        rows: ex.rows.map(r => ex.fields.map(f => cellText(r[f]))),
        landscape: ex.fields.length > 6,
      });
    }
  }

  /* ══ API LOOP ══════════════════════════════════════════════ */

  function systemPrompt() {
    const today = new Date().toISOString().slice(0, 10);
    return (cfg.context || '') +
      '\n\nวันนี้ ' + today + '. วันที่ในข้อมูลเก็บเป็น ISO YYYY-MM-DD (ค.ศ.) ผู้ใช้พูดเป็น พ.ศ. ให้แปลงเอง. ' +
      'ปีงบประมาณไทยเริ่ม 1 ต.ค. ถึง 30 ก.ย.; ฟิลด์ fiscal_year เป็น พ.ศ.; ฟิลด์ month เป็น YYYY-MM (ถ้าชุดข้อมูลมีฟิลด์ date). ' +
      'ชุดข้อมูลในหน้านี้: ' + Object.entries(cfg.datasets).map(([k, d]) => k + ' (' + d.label + ')').join(', ') + '. ' +
      'ถ้าไม่แน่ใจชื่อฟิลด์/ค่า ให้เรียก list_datasets ก่อน. ถ้าผู้ใช้ขอ "รายงาน/ไฟล์/Excel/PDF" ให้เรียก export_report. ' +
      'ตอบกระชับ ใช้ตารางหรือรายการเมื่อมีหลายค่า และระบุช่วงเวลา/เงื่อนไขที่ใช้คำนวณ.';
  }

  function trimmedHistory() {
    let h = history.slice(-30);
    while (h.length && !(h[0].role === 'user' && typeof h[0].content === 'string')) h.shift();
    return h;
  }

  async function callApi() {
    const tools = TOOLS.concat((cfg.extraTools || []).map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema })));
    const res = await fetch(AI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Token': AI_TOKEN },
      body: JSON.stringify({ model, system: systemPrompt(), messages: trimmedHistory(), tools }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  async function send(text) {
    if (busy || !text.trim()) return;
    busy = true;
    setBusy(true);
    addMsg('user', text);
    history.push({ role: 'user', content: text });
    const thinking = addMsg('bot', '', true);
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        pendingExportIds = [];
        const data = await callApi();
        const content = data.content || [];
        history.push({ role: 'assistant', content });
        const uses = content.filter(b => b.type === 'tool_use');
        if (data.stop_reason !== 'tool_use' || !uses.length) {
          const textOut = content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
          fillMsg(thinking, textOut || '(ไม่มีคำตอบ)', exportsFor(uses, content));
          return;
        }
        const results = uses.map(u => {
          setStatus(thinking, 'กำลังค้นข้อมูล (' + u.name + ')…');
          const r = runTool(u.name, u.input);
          const o = { type: 'tool_result', tool_use_id: u.id, content: r.content };
          if (r.is_error) o.is_error = true;
          return o;
        });
        // ปุ่มดาวน์โหลดที่สร้างในรอบนี้ ให้ผูกกับคำตอบสุดท้าย
        carriedExports = carriedExports.concat(pendingExportIds);
        history.push({ role: 'user', content: results });
      }
      fillMsg(thinking, 'ค้นหาหลายขั้นตอนเกินกำหนด ลองถามให้เจาะจงขึ้นนะครับ', exportsFor([], []));
    } catch (e) {
      console.error('ai-assistant', e);
      fillMsg(thinking, '❌ ใช้งานผู้ช่วย AI ไม่สำเร็จ: ' + e.message, []);
      // ตัดรอบที่ค้างออกจากประวัติ เพื่อไม่ให้รูปแบบข้อความเสีย
      while (history.length && !(history[history.length - 1].role === 'user' && typeof history[history.length - 1].content === 'string')) history.pop();
      history.pop();
    } finally {
      busy = false;
      setBusy(false);
    }
  }

  let carriedExports = [];
  function exportsFor() {
    const ids = carriedExports.concat(pendingExportIds);
    carriedExports = [];
    pendingExportIds = [];
    return ids;
  }

  /* ══ UI ════════════════════════════════════════════════════ */

  let els = {};

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function inline(s) {
    return esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }

  function renderMd(text) {
    const lines = text.split('\n');
    let html = '', i = 0, inList = false;
    const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
    while (i < lines.length) {
      const ln = lines[i];
      if (/^\s*\|.*\|\s*$/.test(ln)) {
        closeList();
        const block = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) block.push(lines[i++]);
        const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const rows = block.filter(l => !/^\s*\|[\s:|-]+\|\s*$/.test(l));
        const head = cells(rows[0]);
        html += '<div class="aiw-tbl"><table><thead><tr>' + head.map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>';
        rows.slice(1).forEach(r => { html += '<tr>' + cells(r).map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>'; });
        html += '</tbody></table></div>';
        continue;
      }
      const li = ln.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
      if (li) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += '<li>' + inline(li[1]) + '</li>';
      } else if (/^#{1,4}\s/.test(ln)) {
        closeList();
        html += '<div class="aiw-h">' + inline(ln.replace(/^#{1,4}\s*/, '')) + '</div>';
      } else if (!ln.trim()) {
        closeList();
      } else {
        closeList();
        html += '<p>' + inline(ln) + '</p>';
      }
      i++;
    }
    closeList();
    return html;
  }

  function injectStyles() {
    if (document.getElementById('aiw-style')) return;
    const st = document.createElement('style');
    st.id = 'aiw-style';
    st.textContent = `
#aiw-fab{position:fixed;right:18px;bottom:18px;z-index:9000;width:54px;height:54px;border-radius:50%;border:none;cursor:pointer;
  background:var(--primary,#1A5E38);color:#fff;font-size:26px;box-shadow:0 4px 16px rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center}
#aiw-fab:hover{background:var(--primary-dark,#124228)}
#aiw-panel{position:fixed;right:18px;bottom:84px;z-index:9001;width:400px;max-width:calc(100vw - 24px);height:min(600px,calc(100vh - 110px));
  background:#fff;border-radius:16px;box-shadow:0 8px 36px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden;
  font-family:'Noto Sans Thai','Sarabun',sans-serif;font-size:14px;color:#1C2B22}
#aiw-panel.aiw-open{display:flex}
.aiw-head{background:var(--primary,#1A5E38);color:#fff;padding:10px 12px;display:flex;align-items:center;gap:8px}
.aiw-head b{flex:1;font-size:14px;line-height:1.3}
.aiw-head select,.aiw-head button{font-family:inherit;font-size:12px;border-radius:6px;border:1px solid rgba(255,255,255,.4);background:rgba(255,255,255,.14);color:#fff;padding:3px 6px;cursor:pointer}
.aiw-head select option{color:#000}
.aiw-msgs{flex:1;overflow-y:auto;padding:12px;background:var(--bg,#F4F7F5);display:flex;flex-direction:column;gap:10px}
.aiw-m{max-width:92%;padding:9px 12px;border-radius:12px;line-height:1.55;word-break:break-word}
.aiw-m.user{align-self:flex-end;background:var(--primary,#1A5E38);color:#fff;white-space:pre-wrap}
.aiw-m.bot{align-self:flex-start;background:#fff;border:1px solid #dbe6df}
.aiw-m p{margin:0 0 6px}.aiw-m p:last-child{margin:0}
.aiw-m ul{margin:2px 0 6px 18px;padding:0}
.aiw-m code{background:#eef3f0;padding:1px 4px;border-radius:4px;font-size:12px}
.aiw-h{font-weight:700;color:var(--primary,#1A5E38);margin:4px 0}
.aiw-tbl{overflow-x:auto;margin:4px 0}
.aiw-tbl table{border-collapse:collapse;font-size:12px}
.aiw-tbl th{background:var(--primary,#1A5E38);color:#fff;padding:3px 7px;text-align:left;white-space:nowrap}
.aiw-tbl td{border-bottom:1px solid #e4e8e6;padding:3px 7px}
.aiw-dl{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.aiw-dl button{font-family:inherit;font-size:12px;padding:5px 10px;border-radius:8px;border:1px solid var(--primary,#1A5E38);background:#fff;color:var(--primary,#1A5E38);cursor:pointer;font-weight:600}
.aiw-dl button:hover{background:var(--primary,#1A5E38);color:#fff}
.aiw-status{color:#7A9A85;font-size:12px}
.aiw-sug{display:flex;gap:6px;flex-wrap:wrap;padding:0 12px 8px;background:var(--bg,#F4F7F5)}
.aiw-sug button{font-family:inherit;font-size:12px;padding:4px 9px;border-radius:14px;border:1px solid #c9d8cf;background:#fff;cursor:pointer;color:#3D5A47;text-align:left}
.aiw-sug button:hover{border-color:var(--primary,#1A5E38)}
.aiw-in{display:flex;gap:6px;padding:8px;border-top:1px solid #dbe6df;background:#fff}
.aiw-in textarea{flex:1;resize:none;font-family:inherit;font-size:16px;border:1.5px solid #d1ddd6;border-radius:9px;padding:7px 10px;height:40px;outline:none}
.aiw-in textarea:focus{border-color:var(--primary,#1A5E38)}
.aiw-in button{font-family:inherit;border:none;border-radius:9px;background:var(--primary,#1A5E38);color:#fff;padding:0 14px;font-weight:600;cursor:pointer}
.aiw-in button:disabled{opacity:.5;cursor:default}
.aiw-note{font-size:11px;color:#7A9A85;padding:0 12px 6px;background:var(--bg,#F4F7F5)}
@media(max-width:480px){#aiw-panel{right:8px;bottom:78px;width:calc(100vw - 16px)}}
@media print{#aiw-fab,#aiw-panel{display:none!important}}`;
    document.head.appendChild(st);
  }

  function buildUi() {
    const fab = document.createElement('button');
    fab.id = 'aiw-fab';
    fab.title = 'ผู้ช่วย AI';
    fab.setAttribute('aria-label', 'เปิดผู้ช่วย AI');
    fab.textContent = '🤖';
    const panel = document.createElement('div');
    panel.id = 'aiw-panel';
    panel.innerHTML = `
<div class="aiw-head"><b>${esc(cfg.title || 'ผู้ช่วย AI')}</b>
  <select id="aiw-model" title="เลือกรุ่น AI"><option value="haiku">Haiku เร็ว</option><option value="sonnet">Sonnet แม่น</option></select>
  <button id="aiw-clear" title="เริ่มคุยใหม่">ล้าง</button><button id="aiw-close" aria-label="ปิด">✕</button></div>
<div class="aiw-msgs" id="aiw-msgs"></div>
<div class="aiw-sug" id="aiw-sug"></div>
<div class="aiw-note">ชื่อ/HN/AN ผู้ป่วยไม่ถูกส่งให้ AI · ตรวจตัวเลขสำคัญกับข้อมูลจริงก่อนนำไปใช้</div>
<div class="aiw-in"><textarea id="aiw-input" rows="1" placeholder="ถามข้อมูล หรือสั่งสร้างรายงาน…"></textarea><button id="aiw-send">ส่ง</button></div>`;
    document.body.appendChild(fab);
    document.body.appendChild(panel);
    els = {
      fab, panel,
      msgs: panel.querySelector('#aiw-msgs'),
      sug: panel.querySelector('#aiw-sug'),
      input: panel.querySelector('#aiw-input'),
      send: panel.querySelector('#aiw-send'),
      model: panel.querySelector('#aiw-model'),
    };
    els.model.value = model;
    els.model.addEventListener('change', () => {
      model = els.model.value;
      try { localStorage.setItem(MODEL_KEY, model); } catch (e) { /* ignore */ }
    });
    fab.addEventListener('click', () => {
      panel.classList.toggle('aiw-open');
      if (panel.classList.contains('aiw-open')) els.input.focus();
    });
    panel.querySelector('#aiw-close').addEventListener('click', () => panel.classList.remove('aiw-open'));
    panel.querySelector('#aiw-clear').addEventListener('click', reset);
    els.send.addEventListener('click', submit);
    els.input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
    });
    // ปุ่มดาวน์โหลดในข้อความ
    els.msgs.addEventListener('click', e => {
      const b = e.target.closest('button[data-x]');
      if (b) doExport(b.dataset.x, b.dataset.k);
    });
    reset();
  }

  function reset() {
    if (busy) return;
    history = [];
    exportsById = {};
    els.msgs.innerHTML = '';
    addMsg('bot', 'สวัสดีครับ ถามข้อมูลของหน้านี้ได้เลย หรือสั่งให้สร้างรายงานเป็น Excel/PDF ก็ได้');
    els.sug.innerHTML = '';
    (cfg.suggestions || []).forEach(q => {
      const b = document.createElement('button');
      b.textContent = q;
      b.addEventListener('click', () => { els.input.value = q; submit(); });
      els.sug.appendChild(b);
    });
  }

  function addMsg(role, text, thinking) {
    const d = document.createElement('div');
    d.className = 'aiw-m ' + role;
    if (thinking) d.innerHTML = '<span class="aiw-status">กำลังคิด…</span>';
    else if (role === 'user') d.textContent = text;
    else d.innerHTML = renderMd(text);
    els.msgs.appendChild(d);
    els.msgs.scrollTop = els.msgs.scrollHeight;
    return d;
  }

  function setStatus(div, text) {
    div.innerHTML = '<span class="aiw-status">' + esc(text) + '</span>';
    els.msgs.scrollTop = els.msgs.scrollHeight;
  }

  function fillMsg(div, text, exportIds) {
    let html = renderMd(text);
    (exportIds || []).forEach(id => {
      const ex = exportsById[id];
      if (!ex) return;
      html += '<div class="aiw-dl"><span class="aiw-status" style="align-self:center">' + esc(ex.title) + ' (' + ex.rows.length + ' แถว)</span>' +
        '<button data-x="' + id + '" data-k="excel">⬇ Excel</button><button data-x="' + id + '" data-k="pdf">⬇ PDF</button></div>';
    });
    div.innerHTML = html;
    els.msgs.scrollTop = els.msgs.scrollHeight;
  }

  function setBusy(b) {
    els.send.disabled = b;
    els.input.disabled = b;
    if (!b) els.input.focus();
  }

  function submit() {
    const t = els.input.value.trim();
    if (!t || busy) return;
    els.input.value = '';
    els.sug.innerHTML = '';
    send(t);
  }

  /* ══ PUBLIC ════════════════════════════════════════════════ */

  window.AiAssistant = {
    init(config) {
      if (cfg) return;
      cfg = config;
      const go = () => { injectStyles(); buildUi(); };
      if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
    },
    _runTool: (n, i) => runTool(n, i),
  };
})();
