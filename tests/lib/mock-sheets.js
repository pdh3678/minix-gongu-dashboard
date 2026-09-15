// 얇은 Google Sheets 목 + Sheets API 왕복 카운터.
// Apps Script 저장이 느린 이유는 거의 전부 "Sheets RPC 개수"라서, 이 카운터가 곧 성능 지표다.
// (문서상 getRange 자체는 지연 호출이라 공짜에 가깝고, 실제 왕복이 생기는 건
//  getValues/setValues/setValue/getRichTextValues/getTextStyles/insertRows/flush 같은 실행 시점.)
const STATS = {
  reads: 0, readCells: 0, writes: 0, writeCells: 0,
  flush: 0, getSheetByName: 0, cacheGet: 0, cachePut: 0, cacheRemove: 0,
  detail: []
};
function resetStats() {
  STATS.reads = 0; STATS.readCells = 0; STATS.writes = 0; STATS.writeCells = 0;
  STATS.flush = 0; STATS.getSheetByName = 0;
  STATS.cacheGet = 0; STATS.cachePut = 0; STATS.cacheRemove = 0;
  STATS.detail.length = 0;
}
function note(kind, op, cells) {
  STATS.detail.push(op + (cells != null ? '(' + cells + '셀)' : ''));
  if (kind === 'r') { STATS.reads++; STATS.readCells += cells || 1; }
  else if (kind === 'w') { STATS.writes++; STATS.writeCells += cells || 1; }
}

function makeSheet(name, grid) {
  const calls = [];
  function width() { return grid.reduce((m, r) => Math.max(m, r.length), 0); }
  function cell(r, c) {
    while (grid.length < r) grid.push([]);
    const row = grid[r - 1];
    while (row.length < c) row.push('');
    return row;
  }
  function range(r, c, nr, nc) {
    nr = nr == null ? 1 : nr; nc = nc == null ? 1 : nc;
    const api = {
      getValues() {
        note('r', 'getValues', nr * nc);
        const out = [];
        for (let i = 0; i < nr; i++) {
          const row = cell(r + i, c + nc - 1);
          out.push(row.slice(c - 1, c - 1 + nc).map(v => v === undefined ? '' : v));
        }
        return out;
      },
      setValues(vals) {
        note('w', 'setValues', nr * nc);
        calls.push({ op: 'setValues', r, c, nr, nc });
        for (let i = 0; i < nr; i++) {
          const row = cell(r + i, c + nc - 1);
          for (let j = 0; j < nc; j++) row[c - 1 + j] = vals[i][j];
        }
        return api;
      },
      getValue() { note('r', 'getValue', 1); return cell(r, c)[c - 1]; },
      setValue(v) { note('w', 'setValue', 1); calls.push({ op: 'setValue', r, c, v }); cell(r, c)[c - 1] = v; return api; },
      setNote(n) { note('w', 'setNote', 1); calls.push({ op: 'setNote', r, c, note: n }); return api; },
      setNumberFormat() { note('w', 'setNumberFormat', nr * nc); return api; },
      setFormula(f) { note('w', 'setFormula', 1); calls.push({ op: 'setFormula', r, c, f }); cell(r, c)[c - 1] = f; return api; },
      setRichTextValue() { note('w', 'setRichTextValue', 1); calls.push({ op: 'setRichTextValue', r, c }); return api; },
      setRichTextValues() { note('w', 'setRichTextValues', nr * nc); calls.push({ op: 'setRichTextValues', r, c, nr, nc }); return api; },
      getRichTextValue() { note('r', 'getRichTextValue', 1); return null; },
      getRichTextValues() { note('r', 'getRichTextValues', nr * nc); return null; },
      getTextStyles() { note('r', 'getTextStyles', nr * nc); throw new Error('no styles'); },
      getA1Notation() { return 'R' + r + 'C' + c + ':R' + (r + nr - 1) + 'C' + (c + nc - 1); },
      copyTo() { note('w', 'copyTo', nr * nc); return api; }
    };
    return api;
  }
  return {
    _grid: grid, _calls: calls,
    getName: () => name,
    getLastColumn: width, getMaxColumns: width,
    getLastRow: () => grid.length, getMaxRows: () => grid.length,
    getRange: (r, c, nr, nc) => range(r, c, nr, nc),
    getDataRange: () => range(1, 1, grid.length, width()),
    insertRowsAfter(after, n) {
      note('w', 'insertRowsAfter', n);
      calls.push({ op: 'insertRowsAfter', after, n });
      const w = width();
      for (let i = 0; i < n; i++) grid.splice(after + i, 0, new Array(w).fill(''));
    },
    deleteRow(r) { note('w', 'deleteRow', 1); calls.push({ op: 'deleteRow', r }); grid.splice(r - 1, 1); },
    hideColumns() {}, insertColumnsAfter() {}, copyTo() {},
    getConditionalFormatRules: () => { note('r', 'getConditionalFormatRules', 1); return []; },
    setConditionalFormatRules(rules) { note('w', 'setConditionalFormatRules', rules.length); calls.push({ op: 'setConditionalFormatRules', n: rules.length }); }
  };
}

function installGlobals(sheets, opts) {
  opts = opts || {};
  const cacheStore = opts.cacheStore || {};
  global.Logger = { log: opts.log ? console.log : () => {} };
  global.SpreadsheetApp = {
    getActiveSpreadsheet: () => ({
      getSheetByName: n => { STATS.getSheetByName++; return sheets[n] || null; },
      getSheets: () => Object.values(sheets),
      getId: () => 'mock', getName: () => 'mock-ss'
    }),
    newConditionalFormatRule: () => {
      const o = {};
      const b = {
        whenTextEqualTo(t) { o.text = t; return b; },
        setBackground(v) { o.bg = v; return b; },
        setFontColor(v) { o.fg = v; return b; },
        setRanges(r) { o.ranges = r; return b; },
        build() { return { getRanges: () => o.ranges, _o: o }; }
      };
      return b;
    },
    newRichTextValue: () => { const b = { setText() { return b; }, setLinkUrl() { return b; }, build: () => ({}) }; return b; },
    CopyPasteType: { PASTE_FORMAT: 1, PASTE_DATA_VALIDATION: 2 },
    flush() { STATS.flush++; }
  };
  global.PropertiesService = {
    getDocumentProperties: () => { const m = opts.docProps || {}; return { getProperty: k => m[k] || null, setProperty: (k, v) => { m[k] = v; } }; }
  };
  global.CacheService = {
    getScriptCache: () => ({
      get: k => { STATS.cacheGet++; return k in cacheStore ? cacheStore[k] : null; },
      put: (k, v) => { STATS.cachePut++; cacheStore[k] = String(v); },
      getAll: ks => { STATS.cacheGet++; const o = {}; ks.forEach(k => { if (k in cacheStore) o[k] = cacheStore[k]; }); return o; },
      putAll: o => { STATS.cachePut++; Object.keys(o).forEach(k => { cacheStore[k] = String(o[k]); }); },
      remove: k => { STATS.cacheRemove++; delete cacheStore[k]; },
      removeAll: ks => { STATS.cacheRemove++; ks.forEach(k => { delete cacheStore[k]; }); }
    })
  };
  global.LockService = {
    getScriptLock: () => ({ tryLock: () => true, waitLock: () => true, releaseLock() {} })
  };
  global.Utilities = { getUuid: () => 'uuid-fixed', formatDate: () => '20260915_000000' };
  global.ScriptApp = { getService: () => ({ getUrl: () => 'mock' }) };
  global.Session = { getScriptTimeZone: () => 'Asia/Seoul', getActiveUser: () => ({ getEmail: () => 'p_dh_3678@athomecorp.com' }) };
  global.ContentService = { createTextOutput: t => ({ setMimeType: () => t }), MimeType: { JSON: 'json' } };
  return cacheStore;
}
module.exports = { makeSheet, installGlobals, STATS, resetStats };
