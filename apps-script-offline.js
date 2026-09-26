/**
 * 미닉스 오프라인 데이터 원장 — Google Apps Script
 * apps-script.js 와 **같은 Apps Script 프로젝트의 두 번째 파일**이다(전역을 공유한다).
 *
 * ★ 배포 방법
 * 1. Apps Script 편집기 → 파일 ＋ → 스크립트 → 이름 "offline" → 이 파일 내용 전체 붙여넣기 후 저장
 *    (apps-script.js 의 _authRequest / _json / _cachePutJSON / _cacheGetJSON 을 그대로 쓴다)
 * 2. 프로젝트 설정 → 스크립트 속성에 OFFLINE_SHEET_ID = 오프라인 스프레드시트 ID 추가
 * 3. 편집기에서 offline_setupSheets 를 1회 실행(권한 승인) — 여러 번 실행해도 안전하다
 * 4. 배포 관리 → 기존 웹앱 배포 편집 → "새 버전"으로 업데이트(URL 유지)
 *
 * 핵심 설계: 원장(판매원장·재고 탭)에는 **원본코드만** 저장한다. sku_id·재고구분은 읽을 때
 * 코드매핑으로 해석한다(프론트 src/features/offline/resolver.js). 그래야 매핑을 나중에 추가·수정해도
 * 과거 데이터에 즉시 반영된다. 매핑이 없는 코드도 원장에는 그대로 저장하고 미매칭코드 탭에 쌓는다.
 *
 * 파일 판별·파싱은 브라우저가 한다(src/features/offline/parsers.js). 여기로는 정규화된 레코드만 온다.
 * 이 파일은 "원장에 어떻게 반영하는가"(교체 범위·하이마트 차이 계산)만 책임진다.
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── 설정 ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 스프레드시트 ID는 코드에 두지 않는다 — 이 파일은 저장소 루트에 있어 공개 URL로 서빙된다.
var OFFLINE_SHEET_ID_PROP = 'OFFLINE_SHEET_ID';

// 품목군 — 프론트 src/shared/constants/products.js 의 PRODUCT_CATALOG 품목군 key와 **같은 목록**이어야 한다
// (tests/offline-gas.test.js 가 두 목록이 같은지 확인한다). 제품마스터 품목군은 이 값만 허용.
var OFFLINE_PRODUCT_LINES = ['더플렌더', '더시프트', '더슬림', '더에어드라이', '미니건조기', '미니식기세척기'];
var OFF_STOCK_TYPES = ['정상', '전시', '리퍼'];

// 파일 유형 → 채널과 반영 방식. period = 기간 교체형, snapshot = 스냅샷형, himart = 스냅샷형 + 누적 차이 계산
var OFF_FILE_TYPES = {
  EMART_STOCK:        { channelId: 'emart',  kind: 'snapshot' },
  EMART_DAILY_SALES:  { channelId: 'emart',  kind: 'period' },
  ETLAND_SALES:       { channelId: 'etland', kind: 'period' },
  ETLAND_STOCK:       { channelId: 'etland', kind: 'snapshot' },
  HIMART_SALES_STOCK: { channelId: 'himart', kind: 'himart' }
};

// 탭 정의 — headers 순서가 곧 시트 열 순서. text = 텍스트 서식(@)으로 고정하는 열(0-based).
// 날짜·코드 열을 텍스트로 두지 않으면 시트가 '2026-09-01'을 날짜로, 13자리 바코드를 지수표기로,
// '0012' 점포코드를 12로 바꿔 버린다.
var OFF_TABS = {
  readme:     { name: 'README', headers: ['탭', '설명'], text: [0, 1] },
  sku:        { name: '제품마스터', headers: ['sku_id', '표준명', '품목군', '모델', '옵션', '활성', '정렬순서', '비고'], text: [0, 1, 2, 3, 4, 5, 7] },
  channel:    { name: '채널마스터', headers: ['channel_id', '채널명', '유형', '활성', '정렬순서'], text: [0, 1, 2, 3] },
  mapping:    { name: '코드매핑', headers: ['channel_id', '원본코드', 'sku_id', '재고구분', '원본상품명', '등록일', '등록자', '비고'], text: [0, 1, 2, 3, 4, 5, 6, 7] },
  store:      { name: '점포마스터', headers: ['channel_id', '점포코드', '점포명', '지역', '최초등록일', '최근확인일'], text: [0, 1, 2, 3, 4, 5] },
  sales:      { name: '판매원장', headers: ['기간시작', '기간종료', '단위', 'channel_id', '점포코드', '원본코드', '수량', '설치완료수량', '출처', 'upload_id'], text: [0, 1, 2, 3, 4, 5, 8, 9] },
  stockDaily: { name: '재고_채널일별', headers: ['기준일', 'channel_id', '원본코드', '재고수량', '이동중수량', '예약수량', 'upload_id'], text: [0, 1, 2, 6] },
  stockStore: { name: '재고_점포최신', headers: ['기준일', 'channel_id', '점포코드', '원본코드', '재고수량', '이동중수량', '예약수량', '당월입고', '당월판매', 'upload_id'], text: [0, 1, 2, 3, 9] },
  himartSnap: { name: '하이마트_누적스냅샷', headers: ['기준일', '점포코드', '원본코드', '당월실판매', '당월판매', '금주판매', '당일판매', '잔여재고', 'upload_id'], text: [0, 1, 2, 8] },
  uploadLog:  { name: '업로드로그', headers: ['upload_id', '업로드시각', '업로더', '파일명', '파일유형', 'channel_id', '기준일/기간', '원본행수', '반영행수', '미매칭코드수', '경고', '상태'], text: [0, 1, 2, 3, 4, 5, 6, 10, 11] },
  unmatched:  { name: '미매칭코드', headers: ['channel_id', '원본코드', '원본상품명', '최초발견일', '최근발견일', '발견횟수'], text: [0, 1, 2, 3, 4] }
};
var OFF_TAB_ORDER = ['readme', 'sku', 'channel', 'mapping', 'store', 'sales', 'stockDaily', 'stockStore', 'himartSnap', 'uploadLog', 'unmatched'];

var OFF_CHANNEL_SEED = [
  ['himart', '하이마트', '전문점', 'Y', 1],
  ['etland', '전자랜드', '전문점', 'Y', 2],
  ['emart', '이마트', '할인점', 'Y', 3],
  ['traders', '트레이더스', '창고형', 'N', 4],
  ['shinsegae', '신세계', '백화점', 'N', 5],
  ['theablen', '디에이블앤', '폐쇄몰', 'N', 6],
  ['special', '기타 특판', '특판', 'N', 7]
];

// 하이마트 누적 스냅샷 보관 기간 — 차이 계산에는 "바로 이전 스냅샷"만 필요하다
var OFF_SNAPSHOT_KEEP_DAYS = 45;
var OFF_CACHE_TTL_SEC = 300;
var OFF_CACHE_KEYS = ['offline:masters', 'offline:status'];
// 공구 저장(_withStructLock)은 ScriptLock을 5초만 기다린다. 업로드가 그 락을 수십 초 잡으면 공구 저장이
// 실패하므로, 오프라인 쓰기는 **다른 락(DocumentLock)**으로 직렬화한다.
var OFF_LOCK_WAIT_MS = 30000;
var OFF_KEY_SEP = '\u0001';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── 시트 준비 ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/* 편집기에서 직접 실행. 탭이 없으면 헤더와 함께 만들고, 있으면 헤더만 검증한다(데이터는 건드리지 않음).
   여러 번 실행해도 안전하다. 반환값(과 실행 로그)에 만든 탭 / 확인한 탭 / 헤더가 다른 탭이 나온다. */
function offline_setupSheets() {
  var ss = _offSS();
  var report = { created: [], verified: [], mismatched: [] };
  OFF_TAB_ORDER.forEach(function (key) {
    var def = OFF_TABS[key];
    var sheet = ss.getSheetByName(def.name);
    if (!sheet) {
      sheet = ss.insertSheet(def.name);
      _offFormatNewTab(sheet, def);
      report.created.push(def.name);
      if (key === 'readme') _offWriteBlock(sheet, def, 2, _offReadmeRows());
    } else {
      var W = def.headers.length;
      var actual = sheet.getRange(1, 1, 1, W).getValues()[0].map(function (v) { return String(v || '').trim(); });
      if (actual.join('|') === def.headers.join('|')) report.verified.push(def.name);
      else report.mismatched.push({ tab: def.name, expected: def.headers, actual: actual });
    }
    // 채널마스터 초기 데이터 — 데이터 행이 하나도 없을 때만(사람이 고친 값을 덮어쓰지 않는다)
    if (key === 'channel' && sheet.getLastRow() < 2) _offWriteBlock(sheet, def, 2, OFF_CHANNEL_SEED);
  });
  _offInvalidateCache();
  Logger.log('[offline_setupSheets] ' + JSON.stringify(report));
  return report;
}

function _offFormatNewTab(sheet, def) {
  var W = def.headers.length;
  sheet.getRange(1, 1, 1, W).setValues([def.headers]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  _offTextRuns(def).forEach(function (run) {
    sheet.getRange(1, run[0] + 1, sheet.getMaxRows(), run[1]).setNumberFormat('@');
  });
}

function _offReadmeRows() {
  return [
    ['⚠ 원장 탭은 직접 수정 금지', '판매원장·재고_채널일별·재고_점포최신·하이마트_누적스냅샷·업로드로그는 대시보드(데이터 업로드)에서만 반영한다. 손으로 고치면 다음 업로드가 그 범위를 다시 덮어쓴다.'],
    ['제품마스터', '표준 SKU. sku_id(SKU-0001)는 자동 부여. 품목군은 대시보드 품목 분류 상수의 값만 허용. 대시보드 코드 매핑 화면에서 만든다.'],
    ['채널마스터', '채널 목록. 활성=N 채널은 업로드 대상이 아니다.'],
    ['코드매핑', '(channel_id, 원본코드) → sku_id·재고구분(정상/전시/리퍼). 한 SKU에 여러 코드 가능. sku_id가 빈 행은 비활성화된 매핑.'],
    ['점포마스터', '업로드 때 자동 추가·갱신. 지역 = 지부·지사.'],
    ['판매원장', '판매 수량. 단위 day = 하루치(기간시작=기간종료), period = 여러 날 합. 원본코드만 저장하고 SKU는 읽을 때 코드매핑으로 해석. 설치완료수량은 하이마트만.'],
    ['재고_채널일별', '채널 전체 합계 재고, 기준일마다 누적(이력).'],
    ['재고_점포최신', '채널별 최신 기준일 1벌만 유지(0 재고 포함). 당월입고·당월판매는 파일에 있을 때만.'],
    ['하이마트_누적스냅샷', '하이마트 당월 누적 판매 스냅샷(판매 값이 있는 행만). 일별 판매 = 이웃 스냅샷의 차이. 최근 45일만 보관.'],
    ['업로드로그', '업로드 1건 = 1행. 반영 행수·미매칭 코드 수·경고.'],
    ['미매칭코드', '코드매핑이 없는 원본코드. 매핑하면 목록에서 빠진다.']
  ];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── 시트 입출력 헬퍼 (탭마다 한 번에 읽고 한 번에 쓴다 — 행 단위 쓰기 금지) ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function _offSS() {
  var id = PropertiesService.getScriptProperties().getProperty(OFFLINE_SHEET_ID_PROP);
  if (!id) throw new Error('Script Properties에 ' + OFFLINE_SHEET_ID_PROP + ' 가 없습니다 — 오프라인 스프레드시트 ID를 등록하세요.');
  return SpreadsheetApp.openById(id);
}

function _offSheet(ss, key) {
  var sheet = ss.getSheetByName(OFF_TABS[key].name);
  if (!sheet) throw new Error('오프라인 시트에 "' + OFF_TABS[key].name + '" 탭이 없습니다 — 편집기에서 offline_setupSheets를 먼저 실행하세요.');
  return sheet;
}

// 텍스트 열 인덱스를 연속 구간 [시작, 개수]로 묶는다 — 서식 지정 호출 수를 줄이려고
function _offTextRuns(def) {
  var runs = [];
  def.text.forEach(function (c) {
    var last = runs[runs.length - 1];
    if (last && last[0] + last[1] === c) last[1]++;
    else runs.push([c, 1]);
  });
  return runs;
}

function _offIsTextCol(def) {
  var t = {};
  def.text.forEach(function (c) { t[c] = true; });
  return t;
}

function _offStr(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd');
  return v == null ? '' : String(v).trim();
}

// 데이터 행 전체 → 2차원 배열. 텍스트 열은 문자열로, 숫자 열은 숫자(빈칸은 '' 유지 — '없음'과 0을 구분)
function _offReadRows(sheet, def) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var W = def.headers.length;
  var isText = _offIsTextCol(def);
  return sheet.getRange(2, 1, last - 1, W).getValues().map(function (r) {
    var o = [];
    for (var c = 0; c < W; c++) {
      var v = r[c];
      if (isText[c]) o.push(_offStr(v));
      else o.push(v === '' || v == null ? '' : (Number(v) || 0));
    }
    return o;
  });
}

function _offBlankRow(r) {
  for (var i = 0; i < r.length; i++) if (r[i] !== '' && r[i] != null) return false;
  return true;
}

// startRow(1-based)부터 rows를 한 번에 쓴다. 텍스트 열은 먼저 '@' 서식을 걸고 문자열로 넣는다.
function _offWriteBlock(sheet, def, startRow, rows) {
  if (!rows.length) return;
  var W = def.headers.length;
  var need = startRow + rows.length - 1;
  var max = sheet.getMaxRows();
  if (need > max) sheet.insertRowsAfter(max, need - max);
  var isText = _offIsTextCol(def);
  var out = rows.map(function (r) {
    var o = [];
    for (var c = 0; c < W; c++) {
      var v = r[c];
      o.push(v == null ? '' : (isText[c] ? String(v) : v));
    }
    return o;
  });
  _offTextRuns(def).forEach(function (run) {
    sheet.getRange(startRow, run[0] + 1, rows.length, run[1]).setNumberFormat('@');
  });
  sheet.getRange(startRow, 1, rows.length, W).setValues(out);
}

// 데이터 영역 전체를 rows로 바꾼다(작은 마스터 탭용). prevCount = 기존 데이터 행 수
function _offWriteAll(sheet, def, rows, prevCount) {
  _offWriteBlock(sheet, def, 2, rows);
  if (prevCount > rows.length) sheet.getRange(2 + rows.length, 1, prevCount - rows.length, def.headers.length).clearContent();
}

/* 원장 교체 — keep(row)가 false인 기존 행을 지우고 newRows를 뒤에 붙인다.
   전체를 다시 쓰지 않고 **처음으로 지워지는 행부터 끝까지만** 다시 쓴다. 업로드는 대개 최근 날짜라
   지워지는 행이 뒤쪽에 몰려 있어서, 원장이 커져도 쓰는 양은 거의 늘지 않는다.
   결과는 항상 "keep을 통과한 기존 행(원래 순서) + newRows"라, 같은 입력을 몇 번 넣어도 같다.
   완전히 빈 행(사람이 지운 흔적)은 이 기회에 같이 걷어낸다. */
function _offReplaceRows(sheet, def, oldRows, keep, newRows) {
  var ok = function (r) { return !_offBlankRow(r) && keep(r); };
  var first = 0;
  while (first < oldRows.length && ok(oldRows[first])) first++;
  var tail = [];
  for (var i = first; i < oldRows.length; i++) if (ok(oldRows[i])) tail.push(oldRows[i]);
  var removed = (oldRows.length - first) - tail.length;
  tail = tail.concat(newRows);
  var startRow = 2 + first;
  _offWriteBlock(sheet, def, startRow, tail);
  var oldTail = oldRows.length - first;
  if (oldTail > tail.length) sheet.getRange(startRow + tail.length, 1, oldTail - tail.length, def.headers.length).clearContent();
  return { removed: removed, added: newRows.length };
}

// ── 날짜 (모두 'YYYY-MM-DD' 문자열, 타임존 영향 없는 UTC 산술) ──
function _offToday() { return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd'); }
function _offIsDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function _offAddDays(s, n) {
  var d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + n));
  return d.getUTCFullYear() + '-' + _pad(d.getUTCMonth() + 1) + '-' + _pad(d.getUTCDate());
}

// ── 락 / 캐시 ──
function _offWithLock(fn) {
  var lock = LockService.getDocumentLock() || LockService.getScriptLock();
  if (!lock.tryLock(OFF_LOCK_WAIT_MS)) throw new Error('다른 오프라인 반영이 진행 중입니다. 잠시 후 다시 시도해주세요.');
  try {
    var out = fn();
    SpreadsheetApp.flush(); // 락을 풀기 전에 반영을 끝낸다 — 다음 실행이 반쯤 쓰인 시트를 읽지 않게
    return out;
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function _offInvalidateCache() {
  try { CacheService.getScriptCache().removeAll(OFF_CACHE_KEYS.map(function (k) { return k + ':meta'; })); }
  catch (e) { Logger.log('오프라인 캐시 무효화 실패 (무시): ' + e); }
}

// 활성 매핑(sku_id가 있는 행)의 (channel_id, 원본코드) 집합
function _offMappedKeys(mappingRows) {
  var set = {};
  mappingRows.forEach(function (r) { if (r[0] && r[1] && r[2]) set[r[0] + OFF_KEY_SEP + r[1]] = true; });
  return set;
}
