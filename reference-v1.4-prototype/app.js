(() => {
  'use strict';

  const DB_NAME = 'state-observer-db';
  const DB_VERSION = 3;
  const STORE = 'daily_records';
  const LABEL_STORE = 'period_labels';
  const app = document.getElementById('app');
  const { QUESTIONS, OPTIONAL_QUESTIONS, FIELD_MAP, SCHEMA_VERSION } = window.StateObserverQuestions;
  const Engine = window.StateObserverEngine;
  const Summary = window.StateObserverSummary;

  function pad2(n) { return String(n).padStart(2, '0'); }
  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  function prettyDate(key) {
    const [y, m, d] = key.split('-');
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(date);
    return `${y}.${m}.${d} · ${weekday}`;
  }
  function moodEmoji(v) { return ({ 1: '😞', 2: '🙁', 3: '😐', 4: '🙂', 5: '😄' })[v] || '—'; }
  function sleepLabel(min) {
    if (min == null) return '未记录';
    if (min < 300) return '＜5h';
    if (min < 360) return '5–6h';
    if (min < 420) return '6–7h';
    if (min < 480) return '7–8h';
    if (min < 540) return '8–9h';
    return '＞9h';
  }
  function recordField(id) { return FIELD_MAP[id] || id; }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'recordDate' });
          store.createIndex('recordingStatus', 'recordingStatus', { unique: false });
        } else {
          const store = req.transaction.objectStore(STORE);
          if (!store.indexNames.contains('recordingStatus')) store.createIndex('recordingStatus', 'recordingStatus', { unique: false });
        }
        if (!db.objectStoreNames.contains(LABEL_STORE)) {
          const labelStore = db.createObjectStore(LABEL_STORE, { keyPath: 'id' });
          labelStore.createIndex('startDate', 'startDate', { unique: false });
          labelStore.createIndex('endDate', 'endDate', { unique: false });
        } else {
          const labelStore = req.transaction.objectStore(LABEL_STORE);
          if (!labelStore.indexNames.contains('startDate')) labelStore.createIndex('startDate', 'startDate', { unique: false });
          if (!labelStore.indexNames.contains('endDate')) labelStore.createIndex('endDate', 'endDate', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getRecord(recordDate) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(recordDate);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveRecord(record) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getRecentRecords(limit = 7) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        const rows = (req.result || []).sort((a, b) => b.recordDate.localeCompare(a.recordDate));
        resolve(rows.slice(0, limit));
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllLabels() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LABEL_STORE, 'readonly');
      const req = tx.objectStore(LABEL_STORE).getAll();
      req.onsuccess = () => resolve((req.result || []).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate)));
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllRecords() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result || []).sort((a, b) => a.recordDate.localeCompare(b.recordDate)));
      req.onerror = () => reject(req.error);
    });
  }

  async function exportSnapshot() {
    const [records, labels] = await Promise.all([getAllRecords(), getAllLabels()]);
    return {
      backupType: 'personal-state-observer',
      backupVersion: 1,
      appVersion: '1.1',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      records,
      periodLabels: labels
    };
  }

  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function isValidDateKey(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  function validateSnapshot(data) {
    if (!data || data.backupType !== 'personal-state-observer') return { ok: false, message: '这不是个人状态观察器的备份文件。' };
    if (data.backupVersion !== 1) return { ok: false, message: '这个备份版本无法识别。' };
    if (!Array.isArray(data.records) || !Array.isArray(data.periodLabels)) return { ok: false, message: '备份内容不完整。' };
    if (data.records.some(r => !r || !isValidDateKey(r.recordDate) || !['draft', 'recorded', 'opted_out'].includes(r.recordingStatus))) {
      return { ok: false, message: '备份中的每日记录格式有问题。' };
    }
    if (data.periodLabels.some(label => !label || !label.id || !label.name || !isValidDateKey(label.startDate) || !isValidDateKey(label.endDate))) {
      return { ok: false, message: '备份中的时期标记格式有问题。' };
    }
    return { ok: true };
  }

  async function replaceFromSnapshot(data) {
    const validation = validateSnapshot(data);
    if (!validation.ok) throw new Error(validation.message);
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE, LABEL_STORE], 'readwrite');
      const recordStore = tx.objectStore(STORE);
      const labelStore = tx.objectStore(LABEL_STORE);
      recordStore.clear();
      labelStore.clear();
      for (const record of data.records) recordStore.put(record);
      for (const label of data.periodLabels) labelStore.put(label);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('恢复失败'));
    });
  }

  async function saveLabel(label) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LABEL_STORE, 'readwrite');
      tx.objectStore(LABEL_STORE).put(label);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function deleteLabel(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LABEL_STORE, 'readwrite');
      tx.objectStore(LABEL_STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  function datesOverlap(aStart, aEnd, bStart, bEnd) {
    return aStart <= bEnd && bStart <= aEnd;
  }

  function clampDate(date, min, max) {
    if (date < min) return min;
    if (date > max) return max;
    return date;
  }

  function labelRangeForMonth(label, days) {
    const monthStart = days[0];
    const monthEnd = days[days.length - 1];
    if (!datesOverlap(label.startDate, label.endDate, monthStart, monthEnd)) return null;
    const start = clampDate(label.startDate, monthStart, monthEnd);
    const end = clampDate(label.endDate, monthStart, monthEnd);
    return {
      startIndex: days.indexOf(start),
      endIndex: days.indexOf(end),
      clippedStart: start !== label.startDate,
      clippedEnd: end !== label.endDate
    };
  }

  function periodLabelRail(labels, days, selectedStart = null, selectedEnd = null) {
    const visible = labels.map(label => ({ label, range: labelRangeForMonth(label, days) })).filter(x => x.range);
    const selection = selectedStart ? { start: selectedStart, end: selectedEnd || selectedStart } : null;
    const selectionStart = selection ? clampDate(selection.start, days[0], days[days.length - 1]) : null;
    const selectionEnd = selection ? clampDate(selection.end, days[0], days[days.length - 1]) : null;
    const selectedStartIndex = selectionStart ? days.indexOf(selectionStart) : -1;
    const selectedEndIndex = selectionEnd ? days.indexOf(selectionEnd) : -1;
    const header = visible.length || selection ? `<div class="period-label-head"><span>时期标记</span><span class="subtle">你自己给这段时间的名字</span></div>` : '';
    const rows = visible.map(({ label, range }) => {
      const clipMark = `${range.clippedStart ? '‹ ' : ''}${range.clippedEnd ? ' ›' : ''}`;
      const name = `${clipMark}${escapeHtml(label.name)}`;
      return `<div class="period-label-row" style="--cols:${days.length}"><button class="period-label" data-label-id="${escapeHtml(label.id)}" style="grid-column:${range.startIndex + 1} / ${range.endIndex + 2}">${name}</button></div>`;
    }).join('');
    const selectionRow = selection ? `<div class="period-select-row" style="--cols:${days.length}"><span class="period-selection" style="grid-column:${selectedStartIndex + 1} / ${selectedEndIndex + 2}"></span></div>` : '';
    return header || rows || selectionRow ? `<section class="period-label-section">${header}<div class="period-label-rail">${rows}${selectionRow}</div></section>` : '';
  }

  function periodLabelYearBand(labels, year) {
    const monthRanges = Array.from({length:12}, (_, i) => {
      const start = `${year}-${pad2(i + 1)}-01`;
      const end = `${year}-${pad2(i + 1)}-${pad2(monthDays(`${year}-${pad2(i + 1)}`).length)}`;
      return { start, end, i };
    });
    const visible = labels.map(label => {
      const hits = monthRanges.filter(m => datesOverlap(label.startDate, label.endDate, m.start, m.end));
      if (!hits.length) return null;
      return { label, start: hits[0].i, end: hits[hits.length - 1].i };
    }).filter(Boolean);
    if (!visible.length) return '';
    return `<section class="timeline-section year-period-section"><div class="timeline-layer-head"><span>时期标记</span><span class="subtle">你留下的解释</span></div><div class="year-period-rail">${visible.map(({label,start,end}) => `<button class="period-label year-period-label" data-label-id="${escapeHtml(label.id)}" style="grid-column:${start+1} / ${end+2}">${escapeHtml(label.name)}</button>`).join('')}</div></section>`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  async function getAllRecords() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result || []).sort((a, b) => a.recordDate.localeCompare(b.recordDate)));
      req.onerror = () => reject(req.error);
    });
  }

  function monthKey(date = new Date()) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
  }

  function yearKey(date = new Date()) { return String(date.getFullYear()); }

  function yearLabel(key) { return `${key} 年`; }

  function yearDays(key) {
    const y = Number(key);
    const days = [];
    const start = new Date(y, 0, 1);
    const end = new Date(y + 1, 0, 1);
    for (const d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      days.push(`${y}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`);
    }
    return days;
  }

  function shiftYear(key, delta) { return String(Number(key) + delta); }

  function monthLabel(key) {
    const [y, m] = key.split('-').map(Number);
    return `${y} 年 ${m} 月`;
  }

  function monthDays(key) {
    const [y, m] = key.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    return Array.from({ length: last }, (_, i) => `${y}-${pad2(m)}-${pad2(i + 1)}`);
  }

  function shiftMonth(key, delta) {
    const [y, m] = key.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return monthKey(d);
  }

  function recordingSymbol(record) {
    if (!record) return '';
    if (record.recordingStatus === 'recorded') return '●';
    if (record.recordingStatus === 'opted_out') return '○';
    if (record.recordingStatus === 'draft') return '◐';
    return '';
  }

  function numericSeries(recordsByDate, days, field) {
    return days.map((date) => {
      const value = recordsByDate.get(date)?.[field];
      return typeof value === 'number' ? value : null;
    });
  }

  function buildPolyline(values, min, max, width, height, padX = 18, padY = 12) {
    const points = [];
    let last = null;
    values.forEach((v, i) => {
      if (v == null) { last = null; return; }
      const x = values.length === 1 ? width / 2 : padX + (i / (values.length - 1)) * (width - padX * 2);
      const safe = Math.max(min, Math.min(max, v));
      const y = padY + (1 - (safe - min) / (max - min)) * (height - padY * 2);
      if (last == null) points.push(`M ${x.toFixed(1)} ${y.toFixed(1)}`);
      else points.push(`L ${x.toFixed(1)} ${y.toFixed(1)}`);
      last = { x, y };
    });
    return points.join(' ');
  }

  function chartRow(recordsByDate, days, field, label, min, max) {
    const values = numericSeries(recordsByDate, days, field);
    const width = 720, height = 62, padX = 6, padY = 8;
    const path = buildPolyline(values, min, max, width, height, padX, padY);
    const dots = values.map((v, i) => {
      if (v == null) return '';
      const x = days.length === 1 ? width / 2 : padX + (i / (days.length - 1)) * (width - padX * 2);
      const y = padY + (1 - (Math.max(min, Math.min(max, v)) - min) / (max - min)) * (height - padY * 2);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" />`;
    }).join('');
    return `<div class="state-row">
      <div class="state-label"><span>${label}</span><small>${values.filter(v => v != null).length}天</small></div>
      <svg class="timeline-chart state-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">
        <line x1="6" y1="31" x2="714" y2="31" class="chart-mid"/>
        <path d="${path}" class="chart-line"/>
        ${dots}
      </svg>
    </div>`;
  }

  function yearChartRow(recordsByDate, days, field, label, min, max) {
    const values = numericSeries(recordsByDate, days, field);
    const width = 720, height = 66, padX = 4, padY = 8;
    const path = buildPolyline(values, min, max, width, height, padX, padY);
    const monthGuides = Array.from({length:12}, (_, m) => {
      const idx = days.findIndex(d => Number(d.slice(5,7)) === m + 1 && d.slice(8) === '01');
      if (idx < 0) return '';
      const x = padX + (idx / (days.length - 1)) * (width - padX * 2);
      return `<line x1="${x.toFixed(1)}" y1="4" x2="${x.toFixed(1)}" y2="60" class="year-month-guide"/>`;
    }).join('');
    return `<div class="year-state-row">
      <div class="state-label"><span>${label}</span><small>${values.filter(v => v != null).length}天</small></div>
      <svg class="timeline-chart year-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}全年">
        <line x1="4" y1="33" x2="716" y2="33" class="chart-mid"/>
        ${monthGuides}
        <path d="${path}" class="chart-line"/>
      </svg>
    </div>`;
  }

  function yearSleepBand(recordsByDate, days) {
    const width = 720, height = 52;
    const bars = days.map((d, i) => {
      const min = recordsByDate.get(d)?.sleepDurationMin;
      if (!(typeof min === 'number')) return '';
      const x = 4 + (i / (days.length - 1)) * (width - 8);
      const h = Math.max(2, Math.min(42, min / 540 * 42));
      const y = height - h - 4;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="1.6" height="${h.toFixed(1)}" rx=".8" class="year-sleep-bar"/>`;
    }).join('');
    const guides = Array.from({length:12}, (_, m) => {
      const idx = days.findIndex(d => Number(d.slice(5,7)) === m + 1 && d.slice(8) === '01');
      if (idx < 0) return '';
      const x = 4 + (idx / (days.length - 1)) * (width - 8);
      return `<line x1="${x.toFixed(1)}" y1="2" x2="${x.toFixed(1)}" y2="48" class="year-month-guide"/>`;
    }).join('');
    return `<svg class="timeline-chart year-sleep-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="全年睡眠时长">${guides}${bars}</svg>`;
  }

  function yearRecordingBand(recordsByDate, days) {
    const width = 720, height = 18;
    const marks = days.map((d, i) => {
      const r = recordsByDate.get(d);
      if (!r) return '';
      const x = 4 + (i / (days.length - 1)) * (width - 8);
      const symbol = recordingSymbol(r);
      const cls = symbol === '●' ? 'record-mark recorded' : symbol === '○' ? 'record-mark opted' : 'record-mark draft';
      return `<circle cx="${x.toFixed(1)}" cy="9" r="2.2" class="${cls}"/>`;
    }).join('');
    return `<svg class="timeline-chart year-recording-chart" viewBox="0 0 ${width} ${height}" aria-label="全年记录行为">${marks}</svg>`;
  }

  function yearMonthStrip(records, year) {
    const map = new Map(records.map(r => [r.recordDate, r]));
    return `<div class="year-month-grid">${Array.from({length:12}, (_, m) => {
      const key = `${year}-${pad2(m+1)}`;
      const days = monthDays(key);
      const monthRecords = days.map(d => map.get(d)).filter(Boolean);
      const recorded = monthRecords.filter(r => r.recordingStatus === 'recorded').length;
      const active = monthRecords.length;
      const moodVals = monthRecords.map(r => r.mood).filter(v => typeof v === 'number');
      const avg = moodVals.length ? (moodVals.reduce((a,b)=>a+b,0)/moodVals.length).toFixed(1) : '—';
      return `<button class="year-month-card" data-month="${key}"><div class="year-month-name">${m+1}月</div><div class="year-month-meta">${active ? `${active}次记录` : '—'}</div><div class="year-month-mood">${avg}</div><div class="year-month-mini">${days.map(d => { const r=map.get(d); return `<span class="${r ? (r.recordingStatus === 'recorded' ? 'active' : 'quiet') : ''}"></span>`; }).join('')}</div><div class="year-month-foot">${recorded ? `● ${recorded}` : '没有完成记录'}</div></button>`;
    }).join('')}</div>`;
  }

  function monthObservationCard(records, days, labels) {
    const summary = Summary.summarizeMonth(records, days, labels);
    const stateRows = [
      ['心情', Summary.formatAverage(summary.averageMood), summary.moodDays],
      ['精力', Summary.formatAverage(summary.averageEnergy), summary.energyDays],
      ['启动力', Summary.formatAverage(summary.averageDrive), summary.driveDays]
    ];
    return `<section class="month-observation-section">
      <div class="timeline-layer-head"><span>本月观察</span><span class="subtle">只陈述已经留下的数据</span></div>
      <div class="observation-card">
        <div class="observation-primary">
          <div><strong>${summary.recordedDays}</strong><span>天已记录</span></div>
          <div><strong>${summary.activeDays}</strong><span>天有活动</span></div>
        </div>
        <div class="observation-details">
          <div><span>睡眠</span><strong>${Summary.formatHours(summary.averageSleepHours)}</strong><small>${summary.sleepDays} 天有时长</small></div>
          <div><span>身体 / 生理事件</span><strong>${summary.eventDays} 天</strong><small>当前月内出现过记录</small></div>
          <div><span>时期标记</span><strong>${summary.periodLabelCount}</strong><small>你自己留下的解释</small></div>
        </div>
        <div class="observation-state">
          ${stateRows.map(([label, avg, count]) => `<div class="observation-state-row"><span>${label}</span><strong>${avg}</strong><small>${count} 天有数据</small></div>`).join('')}
        </div>
        <div class="observation-status">${summary.optedOutDays ? `○ ${summary.optedOutDays} 天主动不记录` : ''}${summary.optedOutDays && summary.draftDays ? '　' : ''}${summary.draftDays ? `◐ ${summary.draftDays} 天未完成` : ''}${!summary.optedOutDays && !summary.draftDays ? '本月没有主动不记录或未完成记录。' : ''}</div>
      </div>
    </section>`;
  }

  function dayAxis(days) {
    return `<div class="day-axis" aria-hidden="true">${days.map(d => `<span>${Number(d.slice(-2))}</span>`).join('')}</div>`;
  }

  function sleepGrid(recordsByDate, days) {
    return `<div class="sleep-grid">${days.map(d => {
      const r = recordsByDate.get(d);
      const h = r?.sleepDurationMin ? Math.max(5, Math.min(92, r.sleepDurationMin / 540 * 92)) : 0;
      return `<button class="day-column ${r ? 'has-record' : ''}" data-day="${d}" aria-label="${d}">
        <span class="sleep-bar-wrap"><span class="sleep-bar" style="height:${h}px"></span></span>
      </button>`;
    }).join('')}</div>`;
  }

  function eventGrid(recordsByDate, days) {
    return `<div class="event-grid">${days.map(d => {
      const r = recordsByDate.get(d);
      let mark = '';
      if (r?.bleedingLevel && r.bleedingLevel !== 'none') mark += '出';
      if (r?.dischargeAmount != null) mark += mark ? '·' : '分';
      if (r?.physicalDiscomfort != null && r.physicalDiscomfort >= 3) mark += mark ? '·' : '身';
      return `<button class="event-cell ${mark ? 'event-active' : ''}" data-day="${d}" aria-label="${d}"><b>${mark || '·'}</b></button>`;
    }).join('')}</div>`;
  }

  function recordingGrid(recordsByDate, days) {
    return `<div class="recording-grid">${days.map(d => {
      const r = recordsByDate.get(d);
      return `<button class="recording-cell" data-day="${d}" aria-label="${d}"><b>${recordingSymbol(r) || '·'}</b></button>`;
    }).join('')}</div>`;
  }

  function baseRecord(recordDate) {
    return {
      schemaVersion: SCHEMA_VERSION,
      recordDate,
      recordingStatus: 'draft',
      startedAt: new Date().toISOString(),
      completedAt: null,
      optedOutAt: null,
      updatedAt: new Date().toISOString(),
      currentPhase: null,
      lastQuestionId: null,
      mood: null,
      energy: null,
      drive: null,
      todayFlag: [],
      sleepQuality: null,
      sleepDurationMin: null,
      sleepProblem: [],
      sleepOnsetReason: [],
      wakeFatigue: null,
      dreamMemory: null,
      dreamFatigue: null,
      bedtimeUrinationDelay: null,
      nightHungerEvent: null,
      nightHungerIntake: null,
      nightHungerRelief: null,
      napDurationMin: null,
      napQuality: null,
      bedtimeTemperatureFeeling: null,
      basalTemperatureC: null,
      weightKg: null,
      morningAppetite: null,
      previousEveningFullness: null,
      bedtimeHunger: null,
      libido: null,
      cycleGateway: null,
      bleedingLevel: null,
      dischargeAmount: null,
      dischargeCharacter: [],
      physicalDiscomfort: null,
      discomfortArea: [],
      contextEvents: [],
      note: null
    };
  }

  function cloneRecord(record) { return structuredClone(record); }

  function normalize(record) {
    // Hidden branches are not negatives. Clear child answers when their parent no longer opens them.
    const q = id => QUESTIONS.find(item => item.id === id);
    const clears = [];
    QUESTIONS.forEach(question => {
      if (!question.showWhen || question.clearWhenHidden === false) return;
      if (!Engine.isVisible(record, FIELD_MAP, question)) clears.push(recordField(question.id));
    });

    clears.forEach(field => {
      if (Array.isArray(record[field])) record[field] = [];
      else record[field] = null;
    });

    if (Number(record.nightHungerEvent) < 2) {
      record.nightHungerIntake = null;
      record.nightHungerRelief = null;
    }
    if (Number(record.nightHungerIntake) < 1) record.nightHungerRelief = null;
    if (Number(record.napDurationMin) <= 0) record.napQuality = null;
    if (Number(record.morningAppetite) > 1) record.previousEveningFullness = null;
    if (record.cycleGateway !== 'bleeding') record.bleedingLevel = null;
    if (record.cycleGateway !== 'discharge') {
      record.dischargeAmount = null;
      record.dischargeCharacter = [];
    }
    if (Number(record.physicalDiscomfort) < 3) record.discomfortArea = [];

    return record;
  }

  function setAnswer(record, question, value) {
    const field = recordField(question.id);
    record[field] = value;
    record.updatedAt = new Date().toISOString();
    record.lastQuestionId = question.id;
    record.currentPhase = question.phase || record.currentPhase;
    normalize(record);
  }

  function markSkipped(record, question) {
    const field = recordField(question.id);
    record[field] = question.type === 'multiChoice' ? [] : null;
    record.updatedAt = new Date().toISOString();
    record.lastQuestionId = question.id;
    record.currentPhase = question.phase || record.currentPhase;
    normalize(record);
  }

  function hasMeaningfulAnswer(value) {
    if (value == null) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'string') return value.trim().length > 0;
    return true;
  }

  function countCoreAnswered(record) {
    return QUESTIONS.filter(q => !q.phaseBreak && hasMeaningfulAnswer(record[recordField(q.id)])).length;
  }

  function bottomNav(active) {
    const items = [
      ['today', '今天'],
      ['timeline', '时间轴'],
      ['data', '数据']
    ];
    return `<nav class="bottom-nav" aria-label="主导航">${items.map(([id, label]) => `<button class="nav-item ${active === id ? 'active' : ''}" id="nav${id[0].toUpperCase()}${id.slice(1)}" data-nav="${id}" aria-current="${active === id ? 'page' : 'false'}"><span>${label}</span></button>`).join('')}</nav>`;
  }

  function bindBottomNav() {
    app.querySelectorAll('[data-nav]').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.nav;
        if (target === 'today') renderCurrentHome();
        if (target === 'timeline') openTimeline();
        if (target === 'data') renderDataPage();
      });
    });
  }

  function renderHome(record, recent) {
    const date = todayKey();
    const status = record?.recordingStatus || 'none';
    let body = '';
    if (status === 'draft') {
      body = `<section class="hero"><div class="eyebrow">${prettyDate(date)}</div><h1>今天的记录还没完成</h1><p class="subtle">已经保存的内容还在。继续就好。</p><div class="action-stack"><button class="primary-action" id="continueRecord">继续记录</button></div></section>`;
    } else if (status === 'recorded') {
      body = `<section class="hero"><div class="eyebrow">${prettyDate(date)}</div><div class="status-big">${moodEmoji(record.mood)}</div><h1 style="margin-top:16px">今天已经留下了。</h1><p class="subtle">${countCoreAnswered(record)} 项核心信息已保存。</p><div class="action-stack"><button class="primary-action" id="viewToday">查看今天</button><button class="secondary-action" id="editToday">修改今天</button></div></section>`;
    } else if (status === 'opted_out') {
      body = `<section class="hero"><div class="eyebrow">${prettyDate(date)}</div><h1>今天不记录。</h1><p class="subtle">已经记下了。今天可以到这里。</p><div class="action-stack"><button class="secondary-action" id="resumeAfterOptOut">改为记录</button></div></section>`;
    } else {
      body = `<section class="hero"><div class="eyebrow">${prettyDate(date)}</div><h1>今天的你是什么样子？</h1><p class="subtle">不用把自己解释清楚，只留下今天。</p><div class="action-stack"><button class="primary-action" id="startRecord">去记录</button><button class="secondary-action" id="optOut">今天不记录</button></div></section>`;
    }

    const recentRows = recent.length ? recent.map(r => `<div class="recent-row"><div class="recent-date">${r.recordDate}</div><div class="recent-status">${r.recordingStatus === 'recorded' ? moodEmoji(r.mood) + ' 已记录' : r.recordingStatus === 'opted_out' ? '○ 不记录' : '◐ 未完成'}</div></div>`).join('') : `<div class="subtle" style="padding-top:12px">这里会慢慢长出你的时间轴。</div>`;
    app.innerHTML = `<div class="page-brand" aria-label="私人观察台"><span>私人观察台</span></div>${body}<section class="recent"><div class="section-label">最近记录</div>${recentRows}</section>${bottomNav('today')}`;

    document.getElementById('startRecord')?.addEventListener('click', () => startRecording(record));
    document.getElementById('continueRecord')?.addEventListener('click', () => startRecording(record));
    document.getElementById('optOut')?.addEventListener('click', confirmOptOut);
    document.getElementById('viewToday')?.addEventListener('click', () => renderDetail(record));
    document.getElementById('editToday')?.addEventListener('click', () => startRecording(record, true, updated => renderDetail(updated)));
    bindBottomNav();
    document.getElementById('resumeAfterOptOut')?.addEventListener('click', async () => {
      record.recordingStatus = 'draft';
      record.optedOutAt = null;
      record.updatedAt = new Date().toISOString();
      await saveRecord(record);
      startRecording(record);
    });
  }

  function renderDetail(record) {
    const rows = [
      ['心情', moodEmoji(record.mood)],
      ['精力', record.energy == null ? '—' : ['', '几乎没有', '比较低', '一般', '不错', '很有精神'][record.energy]],
      ['行动力', record.drive == null ? '—' : ['', '很难开始', '有点困难', '一般', '比较容易', '很容易'][record.drive]],
      ['睡眠', sleepLabel(record.sleepDurationMin)],
      ['睡眠质量', record.sleepQuality == null ? '—' : ['', '几乎没睡好', '不太好', '一般', '不错', '很好'][record.sleepQuality]],
      ['睡前尿意影响', record.bedtimeUrinationDelay == null ? '未展开' : ['', '有一点', '明显推迟', '反复明显影响'][record.bedtimeUrinationDelay]],
      ['夜间饥饿', record.nightHungerEvent == null ? '未展开' : ['没有', '有一点但没影响', '影响入睡', '明显影响睡眠'][record.nightHungerEvent]]
    ];
    app.innerHTML = `<div class="topbar"><button class="icon-button" id="backHome" aria-label="返回">‹</button><span>${prettyDate(record.recordDate)}</span><span></span></div><section class="home-section"><h1 style="font-size:30px;margin:0">${record.recordingStatus === 'opted_out' ? '今天不记录。' : '今天留下了。'}</h1><p class="subtle">${record.recordingStatus === 'opted_out' ? '这是一次主动的“不记录”。' : '这是今天保存下来的状态。'}</p></section><section class="summary">${rows.map(([k, v]) => `<div class="summary-row"><span class="key">${k}</span><span class="value">${v}</span></div>`).join('')}</section><div class="inline-actions">${record.recordingStatus !== 'opted_out' ? '<button class="secondary-action" id="editToday">修改今天</button>' : ''}</div>`;
    document.getElementById('backHome').addEventListener('click', renderCurrentHome);
    document.getElementById('editToday')?.addEventListener('click', () => startRecording(record, true, updated => renderDetail(updated)));
  }

  function renderCurrentHome() { Promise.all([getRecord(todayKey()), getRecentRecords()]).then(([r, recent]) => renderHome(r, recent)); }

  function confirmOptOut() {
    const sheet = document.createElement('div');
    sheet.className = 'confirm-sheet';
    sheet.innerHTML = `<h2>今天不记录？</h2><p>这是一个正常的选择。今天可以到这里。</p><div class="sheet-actions"><button class="secondary-action" id="cancelOptOut">返回</button><button class="primary-action" id="confirmOptOut">今天不记录</button></div>`;
    document.body.appendChild(sheet);
    document.getElementById('cancelOptOut').addEventListener('click', () => sheet.remove());
    document.getElementById('confirmOptOut').addEventListener('click', async () => {
      let record = await getRecord(todayKey());
      if (!record) record = baseRecord(todayKey());
      record.recordingStatus = 'opted_out';
      record.optedOutAt = new Date().toISOString();
      record.completedAt = null;
      record.updatedAt = new Date().toISOString();
      await saveRecord(record);
      sheet.remove();
      renderCurrentHome();
    });
  }

  function startRecording(existing, editing = false, afterLeave = null) {
    const record = existing ? cloneRecord(existing) : baseRecord(todayKey());
    const editingRecorded = editing && existing?.recordingStatus === 'recorded';
    if (!editingRecorded) record.recordingStatus = 'draft';
    record.optedOutAt = null;
    if (!record.startedAt) record.startedAt = new Date().toISOString();

    let currentId = 'mood';
    if (!editing && record.lastQuestionId) {
      const resume = Engine.getNextIncludingPhase(record, record.lastQuestionId, QUESTIONS, FIELD_MAP);
      currentId = resume && !resume.phaseBreak ? resume.id : (Engine.getNext(record, null, QUESTIONS, FIELD_MAP)?.id || 'mood');
    }
    normalize(record);
    renderRecordQuestion(record, currentId, 'forward', editing, afterLeave);
  }

  function questionOptionsHtml(q, currentValue) {
    return q.options.map(option => {
      const selected = q.type === 'multiChoice'
        ? Array.isArray(currentValue) && currentValue.includes(option.value)
        : String(currentValue) === String(option.value);
      return `<button class="choice ${selected ? 'selected' : ''}" data-value="${encodeURIComponent(String(option.value))}"><span class="emoji">${option.icon || ''}</span><span class="label">${option.label}</span></button>`;
    }).join('');
  }

  function decodeValue(encoded) { return decodeURIComponent(encoded); }
  function coerceOptionValue(q, raw) {
    const all = (q.options || []).map(o => o.value);
    const target = String(raw);
    return all.find(v => String(v) === target);
  }

  async function nextAfterAnswer(record, q, editing = false, afterLeave = null) {
    const next = Engine.getNextIncludingPhase(record, q.id, QUESTIONS, FIELD_MAP);
    if (!next) return finishRecord(record, editing, afterLeave);
    if (next.phaseBreak) return renderRecordQuestion(record, next.id, 'forward', editing, afterLeave);
    renderRecordQuestion(record, next.id, 'forward', editing, afterLeave);
  }

  function renderRecordQuestion(record, questionId, direction = 'forward', editing = false, afterLeave = null) {
    const q = QUESTIONS.find(item => item.id === questionId);
    if (!q) return finishRecord(record, editing, afterLeave);

    if (q.phaseBreak) {
      const next = Engine.getNextIncludingPhase(record, q.id, QUESTIONS, FIELD_MAP);
      return next ? renderRecordQuestion(record, next.id, direction, editing, afterLeave) : finishRecord(record, editing, afterLeave);
    }

    const visible = Engine.visibleQuestions(record, QUESTIONS, FIELD_MAP).filter(x => !x.phaseBreak);
    const { position, total } = Engine.progress(record, q.id, QUESTIONS, FIELD_MAP);
    const field = recordField(q.id);
    const value = record[field];
    const isMulti = q.type === 'multiChoice';

    app.innerHTML = `<div class="record-screen" data-direction="${direction}">
      <div class="topbar"><button class="icon-button" id="exitRecord" aria-label="退出">×</button><span>${editing ? '修改 · ' : ''}${q.phase}</span><span class="progress-caption">${position} / ${total}</span></div>
      <div class="question-wrap question"><h1>${q.text}</h1>${q.helper ? `<div class="helper">${q.helper}</div>` : ''}<div class="options" data-multi="${isMulti}">${questionOptionsHtml(q, value)}</div></div>
      <div class="record-footer"><button class="text-button" id="prevQuestion" ${position === 1 ? 'disabled style="visibility:hidden"' : ''}>‹ 返回</button><div class="progress-track"><div class="progress-fill" style="width:${Math.round((position / total) * 100)}%"></div></div><button class="text-button" id="skipQuestion">${isMulti && hasMeaningfulAnswer(value) ? '下一项' : '暂不记录'}</button></div>
    </div>`;

    wireExit(record, editing, afterLeave);
    const optionButtons = app.querySelectorAll('.choice');
    optionButtons.forEach(btn => btn.addEventListener('click', async () => {
      const raw = decodeValue(btn.dataset.value);
      const optionValue = coerceOptionValue(q, raw);
      if (isMulti) {
        const current = Array.isArray(record[field]) ? [...record[field]] : [];
        const index = current.findIndex(v => String(v) === String(optionValue));
        if (index >= 0) current.splice(index, 1); else current.push(optionValue);
        setAnswer(record, q, current);
        await saveRecord(record);
        btn.classList.toggle('selected', current.includes(optionValue));
        const footer = document.getElementById('skipQuestion');
        footer.textContent = current.length ? '下一项' : '暂不记录';
        if (current.length) footer.dataset.hasAnswer = 'true';
        return;
      }
      setAnswer(record, q, optionValue);
      await saveRecord(record);
      await nextAfterAnswer(record, q, editing, afterLeave);
    }));

    document.getElementById('skipQuestion').addEventListener('click', async () => {
      if (isMulti && document.getElementById('skipQuestion').dataset.hasAnswer === 'true') {
        const next = Engine.getNextIncludingPhase(record, q.id, QUESTIONS, FIELD_MAP);
        if (!next) return finishRecord(record);
        return renderRecordQuestion(record, next.id, 'forward', editing, afterLeave);
      }
      markSkipped(record, q);
      await saveRecord(record);
      await nextAfterAnswer(record, q);
    });

    document.getElementById('prevQuestion').addEventListener('click', () => {
      const prev = Engine.getPrevious(record, q.id, QUESTIONS, FIELD_MAP);
      if (prev) renderRecordQuestion(record, prev.id, 'back', editing, afterLeave);
    });
  }

  function wireExit(record, editing = false, afterLeave = null) {
    document.getElementById('exitRecord')?.addEventListener('click', () => showExitSheet(record, editing, afterLeave));
  }

  async function leaveRecording(record, afterLeave = null) {
    await saveRecord(record);
    if (afterLeave) return afterLeave(record);
    renderCurrentHome();
  }

  function showExitSheet(record, editing = false, afterLeave = null) {
    const sheet = document.createElement('div');
    sheet.className = 'confirm-sheet';
    const title = editing ? '修改先到这里？' : '这次记录先到这里？';
    const copy = editing
      ? '已经改动的内容会即时保存。还没改到的地方不会替你填写。'
      : '已经填写的会保留。还没回答的不会替你填写。';
    const keepLabel = editing ? '继续修改' : '继续记录';
    sheet.innerHTML = `<h2>${title}</h2><p>${copy}</p><div class="sheet-actions"><button class="secondary-action" id="keepGoing">${keepLabel}</button><button class="primary-action" id="leaveRecord">保存并离开</button></div>`;
    document.body.appendChild(sheet);
    document.getElementById('keepGoing').addEventListener('click', () => sheet.remove());
    document.getElementById('leaveRecord').addEventListener('click', async () => { await leaveRecording(record, afterLeave); sheet.remove(); });
  }

  async function finishRecord(record, editing = false, afterLeave = null) {
    record.recordingStatus = 'recorded';
    record.completedAt = new Date().toISOString();
    record.updatedAt = new Date().toISOString();
    record.lastQuestionId = null;
    record.currentPhase = null;
    normalize(record);
    await saveRecord(record);

    if (editing) {
      if (afterLeave) return afterLeave(record);
      return renderDetail(record);
    }
    renderCompletion(record);
  }

  function optionalVisible(record, q) {
    if (!q.showWhen) return true;
    return Engine.matchesGroup(record, FIELD_MAP, q.showWhen);
  }

  function renderCompletion(record) {
    app.innerHTML = `<section class="completion"><div><div class="completion-mark">${moodEmoji(record.mood)}</div><h1>今天留下了。</h1><p class="subtle" style="margin-top:8px">${prettyDate(record.recordDate)}</p><div class="summary"><div class="summary-row"><span class="key">心情</span><span class="value">${moodEmoji(record.mood)}</span></div><div class="summary-row"><span class="key">精力</span><span class="value">${record.energy == null ? '未记录' : ['', '几乎没有', '比较低', '一般', '不错', '很有精神'][record.energy]}</span></div><div class="summary-row"><span class="key">行动力</span><span class="value">${record.drive == null ? '未记录' : ['', '很难开始', '有点困难', '一般', '比较容易', '很容易'][record.drive]}</span></div><div class="summary-row"><span class="key">睡眠</span><span class="value">${sleepLabel(record.sleepDurationMin)}</span></div></div><div class="action-stack"><button class="primary-action" id="openMore">还想记录一些东西</button><button class="secondary-action" id="afterFinish">回到今天</button></div></div></section>`;
    document.getElementById('afterFinish').addEventListener('click', renderCurrentHome);
    document.getElementById('openMore').addEventListener('click', () => renderOptionalMenu(record));
  }

  function renderOptionalMenu(record) {
    const available = OPTIONAL_QUESTIONS.filter(q => optionalVisible(record, q));
    app.innerHTML = `<div class="topbar"><button class="icon-button" id="backCompletion" aria-label="返回">‹</button><span>更多记录</span><span></span></div><section class="home-section"><h1 style="font-size:30px;margin:0">还想留下什么？</h1><p class="subtle">只记录现在对你有意义的东西。</p><div class="more-grid">${available.map(q => `<button class="more-card" data-more-id="${q.id}"><span>${q.label}</span><span class="more-value">${displayOptionalValue(record, q)}</span></button>`).join('')}</div></section><div class="inline-actions"><button class="secondary-action" id="doneMore">今天已经够了</button></div>`;
    document.getElementById('backCompletion').addEventListener('click', () => renderCompletion(record));
    document.getElementById('doneMore').addEventListener('click', renderCurrentHome);
    app.querySelectorAll('[data-more-id]').forEach(btn => btn.addEventListener('click', () => renderOptionalQuestion(record, OPTIONAL_QUESTIONS.find(q => q.id === btn.dataset.moreId))));
  }

  function displayOptionalValue(record, q) {
    const value = record[recordField(q.id)];
    if (!hasMeaningfulAnswer(value)) return '未记录';
    if (q.type === 'number') return `${value}${q.unit ? ` ${q.unit}` : ''}`;
    if (q.options) {
      const labels = q.options.filter(o => Array.isArray(value) ? value.includes(o.value) : String(value) === String(o.value)).map(o => o.label);
      return labels.join('、') || '已记录';
    }
    return '已记录';
  }

  function renderOptionalQuestion(record, q) {
    if (!q) return renderOptionalMenu(record);
    const field = recordField(q.id);
    const value = record[field];
    const isMulti = q.type === 'multiChoice';
    app.innerHTML = `<div class="record-screen"><div class="topbar"><button class="icon-button" id="backMore" aria-label="返回">‹</button><span>更多记录</span><span></span></div><div class="question-wrap question"><h1>${q.label}</h1>${q.unit ? `<div class="helper">单位：${q.unit}</div>` : ''}${q.type === 'number' ? `<input class="number-input" id="moreNumber" type="number" inputmode="decimal" value="${value ?? ''}" placeholder="可留空" />` : q.type === 'text' ? `<textarea class="note-input" id="moreText" maxlength="${q.maxLength || 500}" placeholder="写一点也可以，什么都不写也可以">${value || ''}</textarea>` : `<div class="options" data-multi="${isMulti}">${questionOptionsHtml(q, value)}</div>`}</div><div class="record-footer"><button class="text-button" id="skipMore">清除这项</button><div></div><button class="primary-action compact-action" id="saveMore">保存</button></div></div>`;
    document.getElementById('backMore').addEventListener('click', () => renderOptionalMenu(record));
    document.getElementById('skipMore').addEventListener('click', async () => { record[field] = Array.isArray(value) ? [] : null; normalize(record); await saveRecord(record); renderOptionalMenu(record); });
    document.getElementById('saveMore').addEventListener('click', async () => {
      let nextValue = value;
      if (q.type === 'number') nextValue = document.getElementById('moreNumber').value === '' ? null : Number(document.getElementById('moreNumber').value);
      else if (q.type === 'text') nextValue = document.getElementById('moreText').value.trim() || null;
      else if (isMulti) nextValue = Array.from(app.querySelectorAll('.choice.selected')).map(btn => coerceOptionValue(q, decodeValue(btn.dataset.value)));
      if (q.type === 'choice') { const selected = app.querySelector('.choice.selected'); nextValue = selected ? coerceOptionValue(q, decodeValue(selected.dataset.value)) : null; }
      record[field] = nextValue; record.updatedAt = new Date().toISOString(); normalize(record); await saveRecord(record); renderOptionalMenu(record);
    });
    app.querySelectorAll('.choice').forEach(btn => btn.addEventListener('click', () => {
      const optionValue = coerceOptionValue(q, decodeValue(btn.dataset.value));
      if (isMulti) btn.classList.toggle('selected');
      else { app.querySelectorAll('.choice').forEach(x => x.classList.remove('selected')); btn.classList.add('selected'); }
    }));
  }

  async function promptPeriodLabel(startDate, endDate, labels) {
    const sheet = document.createElement('div');
    sheet.className = 'day-sheet-backdrop';
    sheet.innerHTML = `<div class="day-sheet period-label-sheet"><div class="sheet-handle"></div><div class="topbar"><span>标记一段时期</span><button class="icon-button" id="closePeriodLabel">×</button></div><div class="sheet-copy"><h2>给这段时间起个名字。</h2><p class="subtle">这是你的解释，不是系统的判断。</p></div><div class="period-date-range"><span>${startDate.replaceAll('-', '.')}</span><span>—</span><span>${endDate.replaceAll('-', '.')}</span></div><input id="periodLabelName" class="note-input period-name-input" maxlength=30 placeholder="例如：冬眠期、状态很活跃" autocomplete="off"><div class="sheet-actions"><button class="secondary-action" id="cancelPeriodLabel">取消</button><button class="primary-action" id="savePeriodLabel">留下这个标记</button></div></div>`;
    document.body.appendChild(sheet);
    const close = () => sheet.remove();
    document.getElementById('closePeriodLabel').addEventListener('click', close);
    document.getElementById('cancelPeriodLabel').addEventListener('click', close);
    document.getElementById('savePeriodLabel').addEventListener('click', async () => {
      const input = document.getElementById('periodLabelName');
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      const label = { id: `label_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, name, startDate, endDate, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), kind: 'user_period' };
      // Keep overlapping labels allowed: different interpretations may coexist.
      await saveLabel(label);
      close();
      openTimeline();
    });
    document.getElementById('periodLabelName').focus();
  }

  async function showPeriodLabelSheet(label, afterClose = null) {
    const sheet = document.createElement('div');
    sheet.className = 'day-sheet-backdrop';
    sheet.innerHTML = `<div class="day-sheet"><div class="sheet-handle"></div><div class="topbar"><span>时期标记</span><button class="icon-button" id="closeLabelDetail">×</button></div><section class="label-detail"><div class="label-detail-name">${escapeHtml(label.name)}</div><div class="subtle">${label.startDate.replaceAll('-', '.')} — ${label.endDate.replaceAll('-', '.')}</div><p class="label-detail-note">这是一段由你自己命名的时间。系统不会把它解释成诊断或结论。</p></section><div class="inline-actions"><button class="secondary-action" id="deletePeriodLabel">删除这个标记</button></div></div>`;
    document.body.appendChild(sheet);
    const close = () => { sheet.remove(); if (afterClose) afterClose(); };
    document.getElementById('closeLabelDetail').addEventListener('click', close);
    sheet.addEventListener('click', e => { if (e.target === sheet) close(); });
    document.getElementById('deletePeriodLabel').addEventListener('click', async () => {
      await deleteLabel(label.id);
      close();
    });
  }

  async function renderTimeline(records, requestedMonth = monthKey(), requestedView = 'month') {
    const labels = await getAllLabels();
    let currentMonth = requestedMonth;
    let currentYear = requestedMonth.length === 4 ? requestedMonth : requestedMonth.slice(0, 4);
    let view = requestedView;
    let selectingPeriod = false;
    let selectedStart = null;
    const render = () => {
      const recordsByDate = new Map(records.map(r => [r.recordDate, r]));
      if (view === 'year') {
        const days = yearDays(currentYear);
        const hasAny = days.some(d => recordsByDate.has(d));
        app.innerHTML = `<div class="topbar timeline-topbar">
            <button class="icon-button" id="timelinePrev" aria-label="上一年">‹</button>
            <span>${yearLabel(currentYear)}</span>
            <button class="icon-button" id="timelineNext" aria-label="下一年">›</button>
          </div>
          <section class="timeline-header">
            <div class="eyebrow">时间轴 / 年</div>
            <h1>看一整年的形状。</h1>
            <p class="subtle">先看长期起伏，再放大某一个月。</p>
            <div class="timeline-view-toggle" role="tablist" aria-label="时间轴尺度">
              <button class="view-tab" id="showMonth">月</button><button class="view-tab active" id="showYear">年</button>
            </div>
            <button class="secondary-action period-add-action" id="addPeriodLabel">标记一段时期</button>
          </section>

          ${periodLabelYearBand(labels, currentYear)}
          <section class="timeline-section year-overview-section">
            <div class="timeline-layer-head"><span>主观状态</span><span class="subtle">一年里的起伏</span></div>
            ${yearChartRow(recordsByDate, days, 'mood', '心情', 1, 5)}
            ${yearChartRow(recordsByDate, days, 'energy', '精力', 1, 5)}
            ${yearChartRow(recordsByDate, days, 'drive', '启动力', 1, 5)}
            <div class="year-month-labels">${Array.from({length:12},(_,i)=>`<span>${i+1}月</span>`).join('')}</div>
          </section>

          <section class="timeline-section">
            <div class="timeline-layer-head"><span>睡眠</span><span class="subtle">每天的时长</span></div>
            ${yearSleepBand(recordsByDate, days)}
          </section>

          <section class="timeline-section">
            <div class="timeline-layer-head"><span>记录行为</span><span class="subtle">留下 / 不记录 / 未完成</span></div>
            ${yearRecordingBand(recordsByDate, days)}
          </section>

          <section class="timeline-section year-month-section">
            <div class="timeline-layer-head"><span>按月放大</span><span class="subtle">点击进入月视图</span></div>
            ${yearMonthStrip(records, currentYear)}
          </section>

          ${hasAny ? '' : `<div class="timeline-empty"><div class="empty-mark">—</div><h2>这一年还没有留下记录。</h2><p class="subtle">开始之后，这里会慢慢长出属于这一年的形状。</p></div>`}
          ${bottomNav('timeline')}`;

        document.getElementById('timelinePrev').addEventListener('click', () => { currentYear = shiftYear(currentYear, -1); render(); });
        document.getElementById('timelineNext').addEventListener('click', () => { currentYear = shiftYear(currentYear, 1); render(); });
        document.getElementById('showMonth').addEventListener('click', () => { view = 'month'; currentMonth = currentYear + '-01'; render(); });
        document.getElementById('showYear').addEventListener('click', () => { view = 'year'; render(); });
        document.getElementById('addPeriodLabel').addEventListener('click', () => { view = 'month'; currentMonth = `${currentYear}-01`; selectingPeriod = true; selectedStart = null; render(); });
        bindBottomNav();
        document.querySelectorAll('[data-label-id]').forEach(el => el.addEventListener('click', async (e) => { e.stopPropagation(); const label = labels.find(x => x.id === el.dataset.labelId); if (label) await showPeriodLabelSheet(label, render); }));
        document.querySelectorAll('[data-month]').forEach(el => el.addEventListener('click', () => { currentMonth = el.dataset.month; view = 'month'; render(); }));
        return;
      }

      const days = monthDays(currentMonth);
      const hasAny = days.some(d => recordsByDate.has(d));
      app.innerHTML = `<div class="topbar timeline-topbar">
          <button class="icon-button" id="timelinePrev" aria-label="上个月">‹</button>
          <span>${monthLabel(currentMonth)}</span>
          <button class="icon-button" id="timelineNext" aria-label="下个月">›</button>
        </div>
        <section class="timeline-header">
          <div class="eyebrow">时间轴 / 月</div>
          <h1>看看这一段时间。</h1>
          <p class="subtle">同一天的变化，会在不同层里彼此对应。</p>
          <div class="timeline-view-toggle" role="tablist" aria-label="时间轴尺度">
            <button class="view-tab active" id="showMonth">月</button><button class="view-tab" id="showYear">年</button>
          </div>
          <button class="secondary-action period-add-action" id="addPeriodLabel">${selectingPeriod ? '取消标记' : '标记一段时期'}</button>
          ${selectingPeriod ? `<div class="period-select-hint">${selectedStart ? `已选择 ${selectedStart.replaceAll('-', '.')}，再点一天作为结束日期。` : '先点这段时期的第一天。'} </div>` : ''}
        </section>

        ${monthObservationCard(records, days, labels)}

        ${periodLabelRail(labels, days, selectedStart, selectedStart)}

        <section class="timeline-section state-section">
          <div class="timeline-layer-head"><span>主观状态</span><span class="subtle">三条线分别保留</span></div>
          ${dayAxis(days)}
          ${chartRow(recordsByDate, days, 'mood', '心情', 1, 5)}
          ${chartRow(recordsByDate, days, 'energy', '精力', 1, 5)}
          ${chartRow(recordsByDate, days, 'drive', '启动力', 1, 5)}
        </section>

        <section class="timeline-section">
          <div class="timeline-layer-head"><span>睡眠</span><span class="subtle">时长</span></div>
          ${dayAxis(days)}
          ${sleepGrid(recordsByDate, days)}
          <div class="timeline-note">睡眠时长越长，柱越高；没有记录的日期保持空白。</div>
        </section>

        <section class="timeline-section">
          <div class="timeline-layer-head"><span>生理 / 身体事件</span><span class="subtle">出 · 分 · 身</span></div>
          ${dayAxis(days)}
          ${eventGrid(recordsByDate, days)}
          <div class="timeline-note">出：出血　分：分泌物　身：明显身体不适</div>
        </section>

        <section class="timeline-section recording-section">
          <div class="timeline-layer-head"><span>记录行为</span><span class="subtle">主动记录也属于数据</span></div>
          ${dayAxis(days)}
          ${recordingGrid(recordsByDate, days)}
          <div class="recording-legend"><span>● 记录</span><span>○ 不记录</span><span>◐ 未完成</span><span>· 无活动</span></div>
        </section>

        ${hasAny ? '' : `<div class="timeline-empty"><div class="empty-mark">—</div><h2>这里还没有留下记录。</h2><p class="subtle">开始记录后，这一页会慢慢长出你的时间轴。</p></div>`}
        ${bottomNav('timeline')}`;

      document.getElementById('timelinePrev').addEventListener('click', () => { currentMonth = shiftMonth(currentMonth, -1); render(); });
      document.getElementById('timelineNext').addEventListener('click', () => { currentMonth = shiftMonth(currentMonth, 1); render(); });
      document.getElementById('showMonth').addEventListener('click', () => { view = 'month'; render(); });
      document.getElementById('showYear').addEventListener('click', () => { view = 'year'; currentYear = currentMonth.slice(0,4); render(); });
      document.getElementById('addPeriodLabel').addEventListener('click', () => { selectingPeriod = !selectingPeriod; selectedStart = null; render(); });
      bindBottomNav();
      document.querySelectorAll('[data-label-id]').forEach(el => el.addEventListener('click', async (e) => { e.stopPropagation(); const label = labels.find(x => x.id === el.dataset.labelId); if (label) await showPeriodLabelSheet(label, render); }));
      document.querySelectorAll('[data-day]').forEach(el => el.addEventListener('click', () => {
        const day = el.dataset.day;
        if (selectingPeriod) {
          if (!selectedStart) { selectedStart = day; render(); return; }
          const start = selectedStart <= day ? selectedStart : day;
          const end = selectedStart <= day ? day : selectedStart;
          selectingPeriod = false;
          selectedStart = null;
          promptPeriodLabel(start, end, labels);
          return;
        }
        const r = recordsByDate.get(day);
        showTimelineDay(r || { recordDate: day, recordingStatus: 'none' }, currentMonth, records);
      }));
    };
    render();
  }
  function showTimelineDay(record, currentMonth, allRecords) {
    const existing = document.querySelector('.day-sheet');
    existing?.remove();
    const inactive = record.recordingStatus === 'none';
    const title = record.recordDate.replaceAll('-', '.');
    const rows = inactive ? [['记录', '这一天没有打开观察器。']] : [
      ['记录', record.recordingStatus === 'recorded' ? '已记录' : record.recordingStatus === 'opted_out' ? '主动不记录' : '未完成'],
      ['心情', moodEmoji(record.mood)],
      ['精力', record.energy == null ? '未记录' : ['', '几乎没有', '比较低', '一般', '不错', '很有精神'][record.energy]],
      ['启动力', record.drive == null ? '未记录' : ['', '很难开始', '有点困难', '一般', '比较容易', '很容易'][record.drive]],
      ['睡眠', record.sleepDurationMin == null ? '未记录' : sleepLabel(record.sleepDurationMin)],
      ['睡眠质量', record.sleepQuality == null ? '未记录' : ['', '几乎没睡好', '不太好', '一般', '不错', '很好'][record.sleepQuality]],
      ['生理', record.bleedingLevel && record.bleedingLevel !== 'none' ? `出血：${record.bleedingLevel}` : record.dischargeAmount != null ? '有分泌物记录' : '无相关记录'],
    ];
    const sheet = document.createElement('div');
    sheet.className = 'day-sheet-backdrop';
    sheet.innerHTML = `<div class="day-sheet"><div class="sheet-handle"></div><div class="topbar"><span>${title}</span><button class="icon-button" id="closeDaySheet">×</button></div><div class="day-sheet-content">${rows.map(([k,v]) => `<div class="summary-row"><span class="key">${k}</span><span class="value">${v}</span></div>`).join('')}<div class="inline-actions">${!inactive && record.recordingStatus !== 'opted_out' ? '<button class="secondary-action" id="editTimelineDay">修改这一天</button>' : ''}</div></div></div>`;
    document.body.appendChild(sheet);
    document.getElementById('closeDaySheet').addEventListener('click', () => sheet.remove());
    sheet.addEventListener('click', e => { if (e.target === sheet) sheet.remove(); });
    document.getElementById('editTimelineDay')?.addEventListener('click', () => { sheet.remove(); startRecording(record, true, updated => renderDetail(updated)); });
  }

  async function renderDataPage() {
    const [records, labels] = await Promise.all([getAllRecords(), getAllLabels()]);
    const recorded = records.filter(r => r.recordingStatus === 'recorded').length;
    const optedOut = records.filter(r => r.recordingStatus === 'opted_out').length;
    const drafts = records.filter(r => r.recordingStatus === 'draft').length;
    const dates = records.map(r => r.recordDate).sort();
    const range = dates.length ? `${dates[0].replaceAll('-', '.')} — ${dates[dates.length - 1].replaceAll('-', '.')}` : '还没有记录';
    app.innerHTML = `
      <div class="topbar"><button class="icon-button" id="backDataHome" aria-label="返回">‹</button><span>数据</span><span></span></div>
      <section class="hero data-hero"><div class="eyebrow">私人观察台</div><h1>你的数据留在这里。</h1><p class="subtle">目前的记录全部保存在这台设备的本地数据库里。这里可以把它完整带走，也可以从备份恢复。</p></section>
      <section class="data-section">
        <div class="section-label">本机记录</div>
        <div class="data-stat-grid">
          <div><strong>${recorded}</strong><span>已记录</span></div>
          <div><strong>${optedOut}</strong><span>主动不记录</span></div>
          <div><strong>${drafts}</strong><span>未完成</span></div>
          <div><strong>${labels.length}</strong><span>时期标记</span></div>
        </div>
        <div class="data-range">数据范围　${range}</div>
      </section>
      <section class="data-section">
        <div class="section-label">带走数据</div>
        <div class="data-card">
          <h2>导出完整备份</h2>
          <p class="subtle">生成一个 JSON 文件，包含每日记录、时期标记和版本信息。它不会上传到任何服务器。</p>
          <button class="primary-action" id="exportBackup">导出 JSON 备份</button>
        </div>
      </section>
      <section class="data-section">
        <div class="section-label">恢复数据</div>
        <div class="data-card">
          <h2>从备份恢复</h2>
          <p class="subtle">选择之前导出的 JSON。系统会先检查并展示内容，确认后才会替换本机记录。</p>
          <button class="secondary-action" id="chooseBackup">选择备份文件</button>
          <input id="backupFileInput" type="file" accept="application/json,.json" hidden>
        </div>
      </section>
      <section class="data-note"><strong>数据主权</strong><p>没有账号、没有云端同步、没有自动上传。删除浏览器站点数据会同时删除本机记录，所以请把 JSON 备份保存到你自己控制的位置。</p></section>
      ${bottomNav('data')}`;

    document.getElementById('backDataHome').addEventListener('click', renderCurrentHome);
    bindBottomNav();
    document.getElementById('exportBackup').addEventListener('click', async () => {
      const snapshot = await exportSnapshot();
      const stamp = snapshot.exportedAt.slice(0, 10);
      downloadJson(`personal-state-observer-backup-${stamp}.json`, snapshot);
    });
    const input = document.getElementById('backupFileInput');
    document.getElementById('chooseBackup').addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const check = validateSnapshot(data);
        if (!check.ok) throw new Error(check.message);
        showRestorePreview(data);
      } catch (error) {
        alert(error.message || '无法读取这个备份文件。');
      }
    });
  }

  function showRestorePreview(data) {
    const existing = document.querySelector('.day-sheet-backdrop');
    existing?.remove();
    const dates = data.records.map(r => r.recordDate).sort();
    const range = dates.length ? `${dates[0].replaceAll('-', '.')} — ${dates[dates.length - 1].replaceAll('-', '.')}` : '没有每日记录';
    const sheet = document.createElement('div');
    sheet.className = 'day-sheet-backdrop';
    sheet.innerHTML = `<div class="day-sheet data-restore-sheet"><div class="sheet-handle"></div><div class="topbar"><span>检查备份</span><button class="icon-button" id="closeRestore">×</button></div><section class="sheet-copy"><h2>这个备份包含：</h2><div class="restore-preview"><div><strong>${data.records.length}</strong><span>条每日记录</span></div><div><strong>${data.periodLabels.length}</strong><span>个时期标记</span></div></div><p class="subtle">数据范围：${range}</p><p class="subtle">导出时间：${data.exportedAt ? new Date(data.exportedAt).toLocaleString('zh-CN') : '未知'}</p><div class="restore-warning">恢复后，本机现有记录会被这个备份替换。若本机有新数据，请先导出一次。</div></section><div class="sheet-actions"><button class="secondary-action" id="cancelRestore">取消</button><button class="primary-action" id="confirmRestore">替换本机数据</button></div></div>`;
    document.body.appendChild(sheet);
    const close = () => sheet.remove();
    document.getElementById('closeRestore').addEventListener('click', close);
    document.getElementById('cancelRestore').addEventListener('click', close);
    sheet.addEventListener('click', e => { if (e.target === sheet) close(); });
    document.getElementById('confirmRestore').addEventListener('click', async () => {
      try {
        await replaceFromSnapshot(data);
        close();
        await renderDataPage();
        alert('备份已恢复。');
      } catch (error) {
        alert(error.message || '恢复失败。');
      }
    });
  }

  async function openTimeline() {
    const records = await getAllRecords();
    renderTimeline(records);
  }

  async function init() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
    const [record, recent] = await Promise.all([getRecord(todayKey()), getRecentRecords()]);
    renderHome(record, recent);
  }

  init().catch(error => {
    console.error(error);
    app.innerHTML = `<section class="hero"><h1>页面暂时无法打开。</h1><p class="subtle">本地数据初始化失败。请刷新后再试。</p></section>`;
  });
})();
