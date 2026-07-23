/**
 * 미닉스 공동구매 자동화 대시보드 — Google Apps Script 연동 코드
 * 데이터 소스: 새 스프레드시트("앳홈 공동구매 총괄 시트 대시보드 연결용") → "실적통합" 탭 하나만 사용.
 * (구버전은 브랜드 시트 3개 + 실적통합, 총 4개 시트를 매칭/조인해서 썼으나, 이제 사용자가 시트 자체를
 *  단일 탭으로 통합해서 그 매칭 로직 전부가 필요 없어짐 — 이 파일은 그 단일 시트 기준으로 새로 작성됨)
 * 캘린더 "프로모션/이벤트 일정"은 같은 스프레드시트의 "캘린더이벤트" 탭에 별도 저장(최초 저장 시 자동 생성).
 *
 * ★ 배포 방법 (반드시 새 스프레드시트에서):
 * 1. 새 스프레드시트 → 확장 프로그램 → Apps Script
 * 2. 이 파일 내용 전체 붙여넣기 후 저장
 * 3. 배포 → 새 배포 → 웹 앱으로 배포 → 새 URL 발급
 * 4. 대시보드 연결 설정에 새 URL 입력
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── CONFIGURATION ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 배포본 확인용 버전 문자열 — 이 파일을 수정할 때마다 값을 바꿔서, doGet 응답에 포함시켜
// 프론트(DASHBOARD_VERSION)와 대조하면 "로컬 파일 = 실제 배포본"인지 바로 확인 가능
var SCRIPT_VERSION = 'single-sheet-2026-07-23-01';

// 메인 데이터 시트명 — 새 스프레드시트의 실제 탭명
var MAIN_SHEET = '실적통합';

// 데이터 시작 행 (2행이 헤더 → 3행부터 데이터, 0-based index = 2)
var DATA_START_ROW = 2;

// 열 인덱스 (0-based: A=0, B=1, C=2 ...) — 새 스프레드시트 "실적통합" 탭 실제 헤더 기준으로 확정됨
var COL = {
  brand:      1,   // B: 브랜드
  product:    2,   // C: 제품명
  vendor:     3,   // D: 소속(벤더사)
  channel:    4,   // E: 채널명(인플루언서)
  platform:   5,   // F: 플랫폼
  salePrice:  6,   // G: 공동구매가
  qty:        7,   // H: 판매수량
  revenue:    8,   // I: 총매출
  commission: 9,   // J: 수수료율 (0.35 = 35% 형태의 소수로 저장됨)
  year:       10,  // K: 연도
  startMD:    11,  // L: 시작일
  endMD:      12,  // M: 종료일
  status:     13,  // N: 진행상태
  format:     14,  // O: 포맷
  composition: 15, // P: 구성 (같은 헤더가 AL에도 있지만 그건 무시 — 여기가 실제 사용 열)
  // Q:추가옵션1 R:추가옵션2 S:선착순 U:추가물량 V:비고 — 대시보드가 다루지 않는 필드, 손대지 않음
  targetQty:  19,  // T: "목 표" (헤더에 공백 포함) — AK열 "목표수량"은 중복이라 무시
  // W~AG(11칸)이 "조회수" 병합 헤더: W=합계, X~AG=릴스별 슬롯(REEL_COL_START/REEL_SLOT_COUNT 참고)
  views:      22,  // W: 조회수 합계 (이미 "만" 단위로 저장됨, 예: 3.4 = 3.4만회)
  // AH~AI: "성과 (대표 게시물 기준)" — 용도 불명, 대시보드가 읽지도 쓰지도 않음(그대로 둠)
  code:       35,  // AJ: 상품코드
  // AK:목표수량(중복,무시) AL:구성(중복,무시)
  link:       38,  // AM: 채널 링크
  thumbs:     39,  // AN: 릴스 썸네일(JSON)
  source:     40,  // AO: 출처(레거시, 브랜드 시트 없어져서 이제 무의미 — 절대 안 읽음)
  dealId:     41,  // AP: 공구건 유일 식별자(UUID) — 조회/저장/삭제는 전부 이 값 기준
  codeSeq:    42,  // AQ: 코드순번(1~5) — 같은 dealId를 공유하는 행들 중 순서/대표행 구분용. 1이 대표 행.
};

// 릴스별 조회수/링크를 담는 열 범위: X~AG (10칸). 셀 값=조회수(만 단위), 링크=해당 셀의 하이퍼링크.
// W열(조회수 합계)은 이 10개 칸의 합으로 대시보드가 직접 계산해 덮어씀
var REEL_COL_START = 24; // X (1-based)
var REEL_SLOT_COUNT = 10;

// 상품코드 최대 개수(그룹당 최대 행 수)
var MAX_CODES = 5;

// 접근 제어
var REQUIRE_AUTH   = true;
var ALLOWED_DOMAIN = 'athomecorp.com';

// 관리자 전용 기능(시트 연결/디버그 정보 노출)을 쓸 수 있는 계정 — 나중에 추가할 수 있게 배열로 관리.
// 프론트의 ADMIN_EMAILS(index.html)와 반드시 같은 값으로 유지할 것 — 여긴 실제 서버 검증용, 그쪽은 UI 표시용.
var ADMIN_EMAILS = ['p_dh_3678@athomecorp.com'];

// 이 대시보드는 Minix 전용입니다 — 브랜드열 값이 아래 목록에 없으면 해당 행은 제외됩니다
var MINIX_ALIASES = { '미닉스': true, 'minix': true, 'Minix': true, 'MINIX': true };

// 캘린더 "프로모션/이벤트 일정" 전용 시트 — 실적통합과 완전히 분리되어 실적/KPI/품목별 실적에 집계되지 않음
// 탭이 없으면 최초 저장 시 _ensureEventSheet가 헤더까지 자동 생성함
var EVENT_SHEET = '캘린더이벤트';
var EVENT_COL = { name: 0, start: 1, end: 2, note: 3 }; // A 이벤트명 / B 시작일 / C 종료일 / D 메모
var EVENT_DATA_START_ROW = 1; // 0-based index — 1행(index 0)은 헤더, 2행부터 데이터

// doGet 응답 캐시 — 실적통합 파싱이 무거워서(수 초), 여러 사용자가 짧은 간격으로 새로고침할 때
// 실행 시간·동시 실행 한도 부담이 커짐. 계산 결과를 스크립트 캐시에 잠깐 담아두고 그 안에서는
// 재계산 없이 그대로 돌려줌. 데이터를 바꾸는 doPost 액션은 성공 시 _invalidateDashboardCache()로 즉시 무효화함.
var DASHBOARD_CACHE_TTL_SEC = 90;
var CACHE_CHUNK_SIZE = 30000; // CacheService 값 상한(100KB/키)을 한글 멀티바이트 감안해 안전하게 피하려고 청크 분할

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── 인증 ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function _verifyAuth(idToken) {
  if (!REQUIRE_AUTH) return true;
  if (!idToken || typeof idToken !== 'string') return false;
  try {
    var parts = idToken.split('.');
    if (parts.length !== 3) return false;
    var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var payload = JSON.parse(
      Utilities.newBlob(Utilities.base64Decode(b64)).getDataAsString()
    );
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return false;
    return (payload.email || '').endsWith('@' + ALLOWED_DOMAIN);
  } catch (e) {
    return false;
  }
}

// idToken이 유효하고(_verifyAuth와 동일 검증) 그 이메일이 ADMIN_EMAILS에 있을 때만 true.
// 시트 연결정보/원시 데이터를 노출하는 디버그 엔드포인트(?debug=...)를 막는 용도.
function _isAdmin(idToken) {
  if (!idToken || typeof idToken !== 'string') return false;
  try {
    var parts = idToken.split('.');
    if (parts.length !== 3) return false;
    var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var payload = JSON.parse(
      Utilities.newBlob(Utilities.base64Decode(b64)).getDataAsString()
    );
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return false;
    return ADMIN_EMAILS.indexOf(payload.email || '') >= 0;
  } catch (e) {
    return false;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── doGet ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function doGet(e) {
  var _t0 = Date.now();
  try {
    var idToken = (e && e.parameter) ? (e.parameter.idToken || '') : '';
    if (!_verifyAuth(idToken)) return _json({ error: 'AUTH_REQUIRED' });

    // 썸네일 프록시: 개별 Drive 파일을 사용자에게 직접 공유하는 대신, 스크립트 소유자 권한으로
    // 파일을 읽어 그대로 내려줌 — 조직 정책(링크 공유 차단)과 무관하게 항상 접근 가능
    if (e && e.parameter && e.parameter.thumb) {
      return DriveApp.getFileById(e.parameter.thumb).getBlob();
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    var sheet = ss.getSheetByName(MAIN_SHEET);
    if (!sheet) {
      var allNames = ss.getSheets().map(function (s) { return s.getName(); });
      throw new Error('데이터 시트를 찾을 수 없습니다. 현재 시트 목록: ' + allNames.join(', '));
    }

    // 디버그 엔드포인트(?debug=...)는 시트 연결정보/원시 데이터를 그대로 노출하므로 관리자 전용.
    if (e && e.parameter && e.parameter.debug) {
      if (!_isAdmin(idToken)) return _json({ error: 'ADMIN_REQUIRED' });

      // ?debug=reels&row=123 으로 호출 시 해당 행의 릴스 슬롯/썸네일 원본 상태를 그대로 반환
      if (e.parameter.debug === 'reels' && e.parameter.row) {
        return _json(_debugReelsRaw(sheet, parseInt(e.parameter.row, 10)));
      }

      // ?debug=1 — 이 배포본이 실제로 어느 스프레드시트/탭을 읽고 있는지, 원시 헤더/데이터 몇 줄,
      // 필터링 통계(브랜드/제품 없음으로 제외된 행 수 등)를 그대로 보여줌. 데이터가 안 나올 때 1차 진단용.
      if (e.parameter.debug === '1') {
        return _json(_debugRawDump(ss, sheet));
      }
    }

    // ?nocache=1이면 캐시를 건너뛰고 항상 새로 계산(수동 새로고침 버튼용)
    var noCache = !!(e && e.parameter && e.parameter.nocache === '1');
    var cache = CacheService.getScriptCache();
    var cacheKey = _dashboardCacheKey();
    var payload = noCache ? null : _cacheGetJSON(cache, cacheKey);
    var fromCache = !!payload;

    if (!payload) {
      _ensureExtraHeaders(sheet);

      var result = parseMainSheet(sheet);

      // dealId 없는 행 자동 백필 — 사람이 시트에 직접 새 행을 추가한 경우(dealId 미기입) 대비.
      // 이 시점엔 이미 각 행이 parseMainSheet에서 "단독 그룹"으로 취급됐으므로, 그 자리에 새
      // dealId+codeSeq=1을 채워주기만 하면 됨(다른 행과의 관계를 새로 계산할 필요 없음).
      _autoFillMissingDealIds(sheet, result.deals);

      var calendarEvents = _loadCalendarEvents(ss);

      payload = { purchases: result.deals, calendarEvents: calendarEvents, updatedAt: new Date().toISOString(), version: SCRIPT_VERSION };
      _cachePutJSON(cache, cacheKey, payload, DASHBOARD_CACHE_TTL_SEC);
    }

    payload.cached = fromCache;
    payload.execMs = Date.now() - _t0;
    Logger.log('doGet 완료: ' + payload.execMs + 'ms' + (fromCache ? ' (캐시 히트, TTL ' + DASHBOARD_CACHE_TTL_SEC + '초)' : ' (새로 계산)'));
    return _json(payload);
  } catch (err) {
    return _json({ error: err.toString(), purchases: [], execMs: Date.now() - _t0 });
  }
}

// ── doGet 응답 캐시(CacheService) — 100KB/키 제한을 피하려고 청크로 쪼개서 저장 ──
function _dashboardCacheKey() {
  return 'dashboardData_' + SCRIPT_VERSION;
}

function _cachePutJSON(cache, key, obj, ttlSec) {
  try {
    var str = JSON.stringify(obj);
    var chunks = [];
    for (var i = 0; i < str.length; i += CACHE_CHUNK_SIZE) chunks.push(str.slice(i, i + CACHE_CHUNK_SIZE));
    var payload = {};
    payload[key + ':meta'] = String(chunks.length);
    for (var c = 0; c < chunks.length; c++) payload[key + ':' + c] = chunks[c];
    cache.putAll(payload, ttlSec);
  } catch (e) {
    Logger.log('캐시 저장 실패 (무시): ' + e);
  }
}

function _cacheGetJSON(cache, key) {
  try {
    var metaStr = cache.get(key + ':meta');
    if (!metaStr) return null;
    var n = parseInt(metaStr, 10);
    var keys = [];
    for (var c = 0; c < n; c++) keys.push(key + ':' + c);
    var got = cache.getAll(keys);
    var parts = [];
    for (var c2 = 0; c2 < n; c2++) {
      var part = got[key + ':' + c2];
      if (part == null) return null; // 일부 청크만 만료/누락이면 전체를 무효로 취급
      parts.push(part);
    }
    return JSON.parse(parts.join(''));
  } catch (e) {
    Logger.log('캐시 조회 실패 (무시): ' + e);
    return null;
  }
}

// 데이터를 바꾸는 doPost 액션이 성공하면 호출 — 다음 doGet이 방금 바뀐 값을 바로 반영하게 함
function _invalidateDashboardCache() {
  try {
    var cache = CacheService.getScriptCache();
    var metaKey = _dashboardCacheKey() + ':meta';
    var metaStr = cache.get(metaKey);
    if (!metaStr) return;
    var n = parseInt(metaStr, 10);
    var keys = [metaKey];
    for (var c = 0; c < n; c++) keys.push(_dashboardCacheKey() + ':' + c);
    cache.removeAll(keys);
  } catch (e) {
    Logger.log('캐시 무효화 실패 (무시): ' + e);
  }
}

// ── 디버그: 특정 행의 릴스 저장 상태(릴스 슬롯 하이퍼링크 + 썸네일 JSON) 원본 그대로 반환 ──
function _debugReelsRaw(sheet, row) {
  if (!row || row < DATA_START_ROW + 1 || row > sheet.getLastRow()) {
    return { debug: true, error: '잘못된 행 번호: ' + row + ' (유효 범위 ' + (DATA_START_ROW + 1) + '~' + sheet.getLastRow() + ')' };
  }
  var rowVals = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
  var richRow = sheet.getRange(row, REEL_COL_START, 1, REEL_SLOT_COUNT).getRichTextValues()[0];
  var slots = [];
  for (var i = 0; i < REEL_SLOT_COUNT; i++) {
    var rc = richRow[i];
    slots.push({ text: rc ? rc.getText() : '', linkUrl: rc ? rc.getLinkUrl() : null });
  }
  var thumbsRaw = rowVals[COL.thumbs];
  var thumbs;
  try { thumbs = JSON.parse(thumbsRaw || '[]'); } catch (e) { thumbs = { parseError: String(e), raw: thumbsRaw }; }
  return {
    debug: true, row: row,
    product: rowVals[COL.product], channel: rowVals[COL.channel],
    viewsTotal: rowVals[COL.views],
    reelSlots: slots,
    thumbsJson_raw: thumbsRaw,
    thumbsJson_parsed: thumbs
  };
}

// ── 디버그: 이 배포본이 실제로 어느 스프레드시트/탭을 읽는지 + 원시 헤더/데이터 몇 줄 +
// 필터링 통계(브랜드/제품 없음으로 제외된 행 수)를 그대로 보여줌. 데이터가 안 나올 때 1차 진단용.
function _debugRawDump(ss, sheet) {
  var data = sheet.getDataRange().getValues();
  var headerRow = data.length > 1 ? data[1] : []; // 2행(0-based index 1)이 헤더

  var totalDataRows = Math.max(0, data.length - DATA_START_ROW);
  var withProduct = 0, withoutProduct = 0;
  var brandCounts = {}; // 실제로 등장하는 브랜드 값별 건수(오타/공백 차이 확인용)
  var passMinixFilter = 0;

  var sampleRows = [];
  for (var i = DATA_START_ROW; i < data.length; i++) {
    var row = data[i];
    var brand = String(row[COL.brand] || '').trim();
    var product = String(row[COL.product] || '').trim();
    if (!product) { withoutProduct++; continue; }
    withProduct++;
    brandCounts[brand || '(빈값)'] = (brandCounts[brand || '(빈값)'] || 0) + 1;
    if (MINIX_ALIASES[brand]) passMinixFilter++;

    if (sampleRows.length < 5) {
      sampleRows.push({
        row: i + 1,
        brand: brand, product: product,
        channel: String(row[COL.channel] || '').trim(),
        dealId: String(row[COL.dealId] || '').trim(),
        codeSeq: row[COL.codeSeq],
        code: String(row[COL.code] || '').trim(),
        startMD_raw: String(row[COL.startMD] || ''),
        qty: row[COL.qty]
      });
    }
  }

  return {
    debug: true,
    scriptUrl: ScriptApp.getService().getUrl(), // 대시보드 연결 설정에 저장된 URL과 이 값이 같아야 함
    spreadsheetId: ss.getId(),
    spreadsheetName: ss.getName(),
    sheetNameConfigured: MAIN_SHEET, // 코드(MAIN_SHEET 상수)가 찾으려는 탭명
    sheetNameActuallyFound: sheet.getName(), // 실제로 찾아서 읽고 있는 탭명(위와 같아야 정상)
    allSheetNamesInThisSpreadsheet: ss.getSheets().map(function (s) { return s.getName(); }),
    dataStartRowConfig_0based: DATA_START_ROW, // 3행부터 데이터로 간주(0-based 2)
    headerRow2_raw: headerRow,
    totalRowsInSheet: data.length,
    totalDataRows: totalDataRows,
    withProduct: withProduct,
    withoutProduct_excluded: withoutProduct,
    brandValueCounts: brandCounts, // 여기 키가 "미닉스"/"Minix" 등과 다르면 MINIX_ALIASES 필터에서 전부 걸러짐
    passMinixFilter: passMinixFilter, // 최종적으로 대시보드에 나와야 할 건수
    sampleFirst5DataRows: sampleRows
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── 메인 시트 파싱 (dealId로 그룹핑 → 그룹당 "공구건" 1개) ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 상품코드가 여러 개인 공구건은 같은 dealId를 공유하는 여러 행(코드순번 1~5)으로 저장됨.
// 코드순번=1(또는 그룹 내 최솟값) 행이 "대표 행" — 판매수량/매출/조회수/릴스/기간/공구가/수수료/
// 목표수량/상태 등 실적·조건 값은 대표 행에만 있고, 나머지 행은 상품코드만 의미 있음(나머지 칸은 빈값).
// 제품명/채널명/브랜드/벤더사는 그룹의 모든 행에 동일하게 들어있어 그대로 사용.
function parseMainSheet(sheet) {
  var data = sheet.getDataRange().getValues();

  // 취소선 감지 (B열 기준, 실패해도 파싱은 계속)
  var strikeMap = {};
  try {
    var styles = sheet.getDataRange().getTextStyles();
    for (var r = DATA_START_ROW; r < styles.length; r++) {
      if (styles[r] && styles[r][COL.brand] && styles[r][COL.brand].isStrikethrough()) {
        strikeMap[r] = true;
      }
    }
  } catch (e) {
    Logger.log('취소선 감지 실패 (무시): ' + e);
  }

  // 릴스별 조회수/링크(하이퍼링크 포함) — 한 번에 읽어서 행별로 매칭
  var reelRich = null;
  try {
    if (data.length > DATA_START_ROW) {
      reelRich = sheet.getRange(DATA_START_ROW + 1, REEL_COL_START, data.length - DATA_START_ROW, REEL_SLOT_COUNT).getRichTextValues();
    }
  } catch (e) {
    Logger.log('릴스 링크 읽기 실패 (무시): ' + e);
  }

  var today = new Date();
  today.setHours(0, 0, 0, 0);

  // 1차 패스: 유효한 행만 골라 dealId로 그룹핑. dealId가 비어있으면(사람이 새로 추가한 행 등)
  // 서로 다른 빈 문자열끼리 잘못 뭉치지 않도록 물리 행 번호 기반의 고유 키를 대신 사용함
  // (실제로 노출되는 deal.dealId 필드는 그대로 빈 문자열로 두고, doGet이 이후 _autoFillMissingDealIds로 채움).
  var groups = {}; // key -> [{rowIdx, row}]
  var groupOrder = [];

  for (var i = DATA_START_ROW; i < data.length; i++) {
    if (strikeMap[i]) continue;
    var row = data[i];
    var brand = String(row[COL.brand] || '').trim();
    var product = String(row[COL.product] || '').trim();
    if (!product) continue; // 빈 행/구분용 행("2025년" 등) 제외
    if (!MINIX_ALIASES[brand]) continue; // Minix 전용 대시보드

    var dealId = String(row[COL.dealId] || '').trim();
    var key = dealId || ('__ROW' + i);
    if (!groups[key]) { groups[key] = []; groupOrder.push(key); }
    groups[key].push({ rowIdx: i, row: row });
  }

  var deals = [];

  for (var g = 0; g < groupOrder.length; g++) {
    var members = groups[groupOrder[g]];
    // 코드순번 오름차순 정렬(값이 없거나 이상하면 맨 뒤로) — 가장 앞이 대표 행
    members.sort(function (a, b) {
      var sa = _numOrNull(a.row[COL.codeSeq]); if (sa == null) sa = 999;
      var sb = _numOrNull(b.row[COL.codeSeq]); if (sb == null) sb = 999;
      return sa - sb;
    });
    var primary = members[0];
    var pRow = primary.row;
    var pIdx = primary.rowIdx;

    var codes = [];
    for (var m = 0; m < members.length; m++) {
      var c = String(members[m].row[COL.code] || '').trim();
      if (c) codes.push(c);
    }

    var vendor     = String(pRow[COL.vendor]   || '').trim();
    var channel    = String(pRow[COL.channel]  || '').trim();
    var product    = String(pRow[COL.product]  || '').trim();
    var platform   = String(pRow[COL.platform] || '').trim();
    var salePrice  = _numOrNull(pRow[COL.salePrice]);
    var qty        = _numOrNull(pRow[COL.qty]);
    var revenue    = _numOrNull(pRow[COL.revenue]);
    var commission = _numOrNull(pRow[COL.commission]);
    if (commission != null && commission <= 1) commission = Math.round(commission * 1000) / 10;
    var year       = _numOrNull(pRow[COL.year]);
    var startCell  = pRow[COL.startMD];
    var endCell    = pRow[COL.endMD];
    var statusRaw  = String(pRow[COL.status] || '').trim();
    var format     = String(pRow[COL.format] || '').trim();
    var targetQty  = _numOrNull(pRow[COL.targetQty]);

    var views = _numOrNull(pRow[COL.views]);
    if (views === 0) views = null;

    var reels = [];
    if (reelRich) {
      var richRow = reelRich[pIdx - DATA_START_ROW];
      var thumbsArr = [];
      try { thumbsArr = JSON.parse(pRow[COL.thumbs] || '[]'); } catch (e) {}
      for (var k = 0; k < REEL_SLOT_COUNT; k++) {
        var rc = richRow ? richRow[k] : null;
        var txt = rc ? rc.getText() : '';
        var linkUrl = rc ? rc.getLinkUrl() : null;
        var v = txt ? _numOrNull(txt) : null;
        if (v != null || linkUrl) {
          reels.push({ views: v, url: linkUrl || '', thumb: thumbsArr[k] || '' });
        }
      }
    }

    var startDate = _parseDate(startCell, year);
    var endDate   = _parseDate(endCell, year) || startDate;
    endDate = _fixYearWrap(startDate, endDate);

    var status;
    var sn = statusRaw.replace(/\s/g, '');
    if      (sn === '종료' || sn === '완료') status = '완료';
    else if (sn === '진행중')                 status = '진행중';
    else if (sn === '예정')                   status = '예정';
    else if (startDate) {
      var sd = new Date(startDate + 'T00:00:00');
      var ed = new Date((endDate || startDate) + 'T00:00:00');
      if (ed < today)       status = '완료';
      else if (sd <= today) status = '진행중';
      else                  status = '예정';
    } else {
      status = '예정';
    }

    deals.push({
      id:          pIdx + 1, // 대표 행의 실제 물리 행 번호(1-based) — 리스트 렌더링 key 용도로만 사용, 식별자는 dealId
      dealId:      String(pRow[COL.dealId] || '').trim(),
      brand:       'Minix',
      product:     product,
      channel:     channel,
      influencer:  channel,
      vendor:      vendor,
      platform:    platform,
      format:      format,
      start:       startDate || '',
      end:         endDate   || '',
      targetQty:   targetQty,
      status:      status,
      views:       views,
      qty:         qty,
      revenue:     revenue,
      codes:       codes,
      composition: String(pRow[COL.composition] || '').trim(),
      link:        String(pRow[COL.link] || '').trim(),
      reels:       reels,
      sale:        salePrice,
      commission:  commission,
      note:        ''
    });
  }

  Logger.log('파싱 완료: ' + deals.length + '건 / 시트: ' + sheet.getName());
  return { deals: deals };
}

// 대시보드에서 쓰는 dealId/codeSeq 열에 헤더가 없으면 채워줌(원본 시트 열이 부족하면 확장도 함)
function _ensureExtraHeaders(sheet) {
  var maxColNeeded = COL.codeSeq + 1;
  if (sheet.getMaxColumns() < maxColNeeded) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), maxColNeeded - sheet.getMaxColumns());
  }
  var headers = [
    [COL.dealId, 'dealId(내부용, 수동 수정 금지)'],
    [COL.codeSeq, '코드순번(내부용, 수동 수정 금지)']
  ];
  for (var i = 0; i < headers.length; i++) {
    var cell = sheet.getRange(2, headers[i][0] + 1);
    if (!cell.getValue()) cell.setValue(headers[i][1]);
  }
  try { sheet.hideColumns(COL.dealId + 1); } catch (e) { Logger.log('dealId 열 숨기기 실패 (무시): ' + e); }
  try { sheet.hideColumns(COL.codeSeq + 1); } catch (e) { Logger.log('코드순번 열 숨기기 실패 (무시): ' + e); }
}

// dealId가 비어있는 행(사람이 시트에 직접 새 행을 추가한 경우 등)에 새 UUID+codeSeq=1을 발급해 기록함.
// parseMainSheet 단계에서 이미 "단독 그룹"으로 취급됐으므로 다른 행과의 관계를 새로 계산할 필요 없음.
function _autoFillMissingDealIds(sheet, deals) {
  var filled = 0;
  for (var i = 0; i < deals.length; i++) {
    var d = deals[i];
    if (d.dealId) continue;
    var newId = Utilities.getUuid();
    sheet.getRange(d.id, COL.dealId + 1).setValue(newId);
    sheet.getRange(d.id, COL.codeSeq + 1).setValue(1);
    d.dealId = newId;
    filled++;
  }
  if (filled > 0) Logger.log('[dealId 자동 백필] ' + filled + '건에 새 dealId 발급함');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── dealId 그룹 조회/조작 공통 헬퍼 ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 해당 dealId를 가진 모든 물리 행을 코드순번 오름차순으로 반환. [0]이 항상 대표 행.
// 반환 항목: {row: 1-based 물리 행 번호, codeSeq: 숫자}
function _findGroupRows(sheet, dealId) {
  if (!dealId) return [];
  var all = sheet.getDataRange().getValues();
  var out = [];
  for (var i = DATA_START_ROW; i < all.length; i++) {
    if (String(all[i][COL.dealId] || '').trim() === dealId) {
      var seq = _numOrNull(all[i][COL.codeSeq]);
      out.push({ row: i + 1, codeSeq: seq == null ? 999 : seq });
    }
  }
  out.sort(function (a, b) { return a.codeSeq - b.codeSeq; });
  return out;
}

// 그룹 전체(모든 코드순번 행)에 동일하게 반영하는 필드 — 사람이 시트를 훑어볼 때 헷갈리지 않도록
var GROUP_MIRROR_COLS = { brand: COL.brand, product: COL.product, channel: COL.channel, vendor: COL.vendor };

// 대표 행(코드순번=1)에만 반영하는 필드 — 실적/조건 값은 그룹당 하나만 존재해야 하므로 중복 저장 금지
var PRIMARY_ONLY_COLS = {
  platform: COL.platform, link: COL.link, format: COL.format, composition: COL.composition,
  targetQty: COL.targetQty
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── doPost: 공구 추가 / 수정 / 삭제 / 실적 기입 ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var idToken = body.idToken || (e.parameter ? e.parameter.idToken : '') || '';
    if (!_verifyAuth(idToken)) return _json({ error: 'AUTH_REQUIRED' });
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var resp;
    if (body.action === 'addSalesRow') resp = _addDeal(ss, body.data);
    else if (body.action === 'addPerf') resp = _addPerf(ss, body.data);
    else if (body.action === 'addCalendarEvent') resp = _addCalendarEvent(ss, body.data);
    else if (body.action === 'updateCalendarEvent') resp = _updateCalendarEvent(ss, body.data);
    else if (body.action === 'deleteCalendarEvent') resp = _deleteCalendarEvent(ss, body.data);
    else if (body.action === 'saveReels') resp = _saveReels(ss, body.data);
    else if (body.action === 'updateDeal') resp = _updateDeal(ss, body.data);
    else if (body.action === 'deleteDeal') resp = _deleteDeal(ss, body.data);
    else if (body.action === 'uploadThumbnail') resp = _uploadThumbnail(body.data);
    else throw new Error('Unknown action: ' + body.action);
    _invalidateDashboardCache();
    return resp;
  } catch (err) {
    return _json({ error: err.toString() });
  }
}

// 새 공구건 등록 — 상품코드 개수만큼(1~5) 같은 dealId를 공유하는 행을 만듦.
// 첫 행(코드순번=1)이 대표 행 — 실적/조건 값 전부 여기에만 기록. 나머지 행은 공통 필드(제품/채널/
// 브랜드/벤더사)+해당 코드만 채우고 나머지는 비움.
function _addDeal(ss, data) {
  var sheet = ss.getSheetByName(MAIN_SHEET);
  if (!sheet) throw new Error('실적통합 시트를 찾을 수 없습니다.');
  _ensureExtraHeaders(sheet);

  var codes = (Array.isArray(data.codes) ? data.codes : []).map(function (c) { return String(c || '').trim(); }).filter(function (c) { return c; });
  if (!codes.length) codes = [''];
  codes = codes.slice(0, MAX_CODES);

  var dealId = Utilities.getUuid();
  var scheme = data.s || {};
  var startDate = data.start ? new Date(data.start) : null;
  var endDate   = data.end   ? new Date(data.end)   : startDate;
  var mainRow = null;

  for (var i = 0; i < codes.length; i++) {
    var row = [];
    row[COL.brand]   = '미닉스';
    row[COL.product] = data.product || '';
    row[COL.channel] = data.ch || '';
    row[COL.vendor]  = data.vendor || '';
    row[COL.code]    = codes[i];
    row[COL.dealId]  = dealId;
    row[COL.codeSeq] = i + 1;
    if (i === 0) {
      row[COL.platform]   = data.platform || '';
      row[COL.salePrice]  = scheme.sale != null ? scheme.sale : '';
      row[COL.commission] = scheme.comm != null ? scheme.comm / 100 : '';
      row[COL.year]       = startDate ? startDate.getFullYear() : '';
      row[COL.startMD]    = startDate || '';
      row[COL.endMD]      = endDate   || '';
      row[COL.status]     = data.status || '예정';
      row[COL.format]     = data.format || '';
      row[COL.targetQty]  = data.targetQty != null ? data.targetQty : '';
      row[COL.composition] = data.composition || '';
      row[COL.link]        = data.link || '';
    }
    for (var c = 0; c < row.length; c++) if (row[c] === undefined) row[c] = '';
    sheet.appendRow(row);
    if (i === 0) mainRow = sheet.getLastRow();
  }

  return _json({ success: true, mainRow: mainRow, dealId: dealId });
}

// 공구건 상세 모달 저장 — dealId 그룹 전체에 반영.
// data.changes: 공통 필드(GROUP_MIRROR_COLS)는 그룹의 모든 행에 동일 반영, 나머지(PRIMARY_ONLY_COLS +
// sale/comm/start/end/status)는 대표 행에만 반영.
// data.codes: 최신 상품코드 배열(1~5개) — 그룹 행 수와 비교해 부족하면 append, 남으면 delete.
function _updateDeal(ss, data) {
  var sheet = ss.getSheetByName(MAIN_SHEET);
  if (!sheet) return _json({ error: '실적통합 시트를 찾을 수 없습니다.' });

  var groupRows = _findGroupRows(sheet, data.dealId);
  if (!groupRows.length) return _json({ error: '해당 공구 행을 찾을 수 없습니다. 새로고침 후 다시 시도해주세요.' });

  var primaryRow = groupRows[0].row;
  var brandCell = String(sheet.getRange(primaryRow, COL.brand + 1).getValue() || '').trim();
  if (!MINIX_ALIASES[brandCell]) {
    return _json({ error: '해당 행이 더 이상 유효한 공구 행이 아닙니다. 새로고침 후 다시 시도해주세요.' });
  }

  var c = data.changes || {};

  // 공통 필드 — 그룹의 모든 행에 동일 반영
  for (var k in GROUP_MIRROR_COLS) {
    if (c[k] !== undefined) {
      for (var g = 0; g < groupRows.length; g++) {
        sheet.getRange(groupRows[g].row, GROUP_MIRROR_COLS[k] + 1).setValue(c[k] || '');
      }
    }
  }

  // 대표 행 전용 필드
  for (var k2 in PRIMARY_ONLY_COLS) {
    if (c[k2] !== undefined) sheet.getRange(primaryRow, PRIMARY_ONLY_COLS[k2] + 1).setValue(c[k2] != null ? c[k2] : '');
  }
  if (c.sale !== undefined) sheet.getRange(primaryRow, COL.salePrice + 1).setValue(c.sale != null ? c.sale : '');
  if (c.comm !== undefined) sheet.getRange(primaryRow, COL.commission + 1).setValue(c.comm != null ? c.comm / 100 : '');
  if (c.qty !== undefined) sheet.getRange(primaryRow, COL.qty + 1).setValue(c.qty != null ? c.qty : '');

  var newStart = c.start !== undefined ? (c.start ? new Date(c.start) : null) : undefined;
  var newEnd   = c.end   !== undefined ? (c.end   ? new Date(c.end)   : null) : undefined;
  if (newStart !== undefined) {
    sheet.getRange(primaryRow, COL.startMD + 1).setValue(newStart || '');
    if (newStart) sheet.getRange(primaryRow, COL.year + 1).setValue(newStart.getFullYear());
  }
  if (newEnd !== undefined) sheet.getRange(primaryRow, COL.endMD + 1).setValue(newEnd || '');

  if (c.sale !== undefined || c.qty !== undefined) {
    var revCell = sheet.getRange(primaryRow, COL.revenue + 1);
    if (!revCell.getFormula()) {
      var effSale = c.sale !== undefined ? c.sale : _numOrNull(sheet.getRange(primaryRow, COL.salePrice + 1).getValue());
      var effQty  = c.qty  !== undefined ? c.qty  : _numOrNull(sheet.getRange(primaryRow, COL.qty + 1).getValue());
      if (effSale != null && effQty != null) revCell.setValue(effSale * effQty);
    }
  }

  // 상품코드 배열 반영 — 행 수를 codes.length에 맞춤
  if (Array.isArray(data.codes)) {
    var codes = data.codes.map(function (x) { return String(x || '').trim(); }).filter(function (x) { return x; }).slice(0, MAX_CODES);
    if (!codes.length) codes = [''];

    // 기존 행에 codes를 순서대로 덮어씀(공유 개수만큼)
    var shared = Math.min(groupRows.length, codes.length);
    for (var s = 0; s < shared; s++) {
      sheet.getRange(groupRows[s].row, COL.code + 1).setValue(codes[s]);
    }

    if (codes.length > groupRows.length) {
      // 부족한 만큼 그룹 끝에 새 행 추가(공통 필드는 대표 행 현재 값을 복사, 실적/조건 값은 비움)
      var mirrorVals = {};
      for (var mk in GROUP_MIRROR_COLS) mirrorVals[mk] = sheet.getRange(primaryRow, GROUP_MIRROR_COLS[mk] + 1).getValue();
      for (var add = groupRows.length; add < codes.length; add++) {
        var newRow = [];
        for (var mk2 in GROUP_MIRROR_COLS) newRow[GROUP_MIRROR_COLS[mk2]] = mirrorVals[mk2];
        newRow[COL.code] = codes[add];
        newRow[COL.dealId] = data.dealId;
        newRow[COL.codeSeq] = add + 1;
        for (var ci = 0; ci < newRow.length; ci++) if (newRow[ci] === undefined) newRow[ci] = '';
        sheet.appendRow(newRow);
      }
    } else if (codes.length < groupRows.length) {
      // 초과 행 삭제 — 물리 행 번호 내림차순으로 지워야 인덱스가 안 밀림
      var toDelete = groupRows.slice(codes.length).map(function (x) { return x.row; }).sort(function (a, b) { return b - a; });
      for (var d = 0; d < toDelete.length; d++) sheet.deleteRow(toDelete[d]);
    }
  }

  return _json({ success: true });
}

// 공구건 삭제 — dealId 그룹의 모든 행을 하드 삭제(릴스 데이터도 대표 행에 같이 있어 함께 삭제됨)
function _deleteDeal(ss, data) {
  var sheet = ss.getSheetByName(MAIN_SHEET);
  if (!sheet) return _json({ error: '실적통합 시트를 찾을 수 없습니다.' });

  var groupRows = _findGroupRows(sheet, data.dealId);
  if (!groupRows.length) return _json({ error: '해당 공구 행을 찾을 수 없습니다. 새로고침 후 다시 시도해주세요.' });

  var brandCell = String(sheet.getRange(groupRows[0].row, COL.brand + 1).getValue() || '').trim();
  if (!MINIX_ALIASES[brandCell]) {
    return _json({ error: '해당 행이 더 이상 유효한 공구 행이 아닙니다. 새로고침 후 다시 시도해주세요.' });
  }

  var rowsDesc = groupRows.map(function (x) { return x.row; }).sort(function (a, b) { return b - a; });
  for (var i = 0; i < rowsDesc.length; i++) sheet.deleteRow(rowsDesc[i]);

  return _json({ success: true });
}

// 실적 기입 → 대표 행에만 판매수량/총매출/조회수 반영
function _addPerf(ss, data) {
  var sheet = ss.getSheetByName(MAIN_SHEET);
  if (!sheet) return _json({ error: '실적통합 시트를 찾을 수 없습니다.' });

  var groupRows = _findGroupRows(sheet, data.dealId);
  if (!groupRows.length) return _json({ error: '해당 공구 행을 찾을 수 없습니다. 새로고침 후 다시 시도해주세요.' });
  var primaryRow = groupRows[0].row;

  if (data.qty     != null) sheet.getRange(primaryRow, COL.qty     + 1).setValue(data.qty);
  if (data.revenue != null) sheet.getRange(primaryRow, COL.revenue + 1).setValue(data.revenue);
  if (data.views   != null) sheet.getRange(primaryRow, COL.views   + 1).setValue(data.views);

  return _json({ success: true });
}

// 모달의 릴스 관리 저장 → 채널 링크 + 릴스별 URL/조회수(하이퍼링크 포함) + 썸네일(JSON) + 조회수 합계.
// 전부 대표 행에만 반영(릴스는 공구건 단위 데이터, 코드별로 나뉘지 않음).
function _saveReels(ss, data) {
  var sheet = ss.getSheetByName(MAIN_SHEET);
  if (!sheet) return _json({ error: '실적통합 시트를 찾을 수 없습니다.' });

  var groupRows = _findGroupRows(sheet, data.dealId);
  if (!groupRows.length) return _json({ error: '해당 공구 행을 찾을 수 없습니다. 새로고침 후 다시 시도해주세요.' });
  var sheetRow = groupRows[0].row;

  sheet.getRange(sheetRow, COL.link + 1).setValue(data.link || '');

  var savedCount = 0;
  if (data.reels != null) {
    var reels = data.reels;
    var thumbs = [];
    var total = 0;
    for (var i = 0; i < REEL_SLOT_COUNT; i++) {
      var cell = sheet.getRange(sheetRow, REEL_COL_START + i);
      var r = reels[i];
      if (r && (r.url || r.views != null)) {
        var text = r.views != null ? String(r.views) : ' ';
        try {
          if (r.url) {
            cell.setNumberFormat('@');
            var rtv = SpreadsheetApp.newRichTextValue().setText(text).setLinkUrl(0, text.length, r.url).build();
            cell.setRichTextValue(rtv);
          } else {
            cell.setValue(r.views != null ? r.views : '');
          }
        } catch (linkErr) {
          cell.setNumberFormat('@');
          cell.setValue(text);
          Logger.log('릴스 링크 저장 실패 (텍스트만 저장): row=' + sheetRow + ' slot=' + i + ' url=' + r.url + ' err=' + linkErr);
        }
        if (r.views != null) total += Number(r.views);
        thumbs.push(r.thumb || '');
        savedCount++;
      } else {
        cell.setNumberFormat('General');
        cell.setValue('');
        thumbs.push('');
      }
    }
    sheet.getRange(sheetRow, COL.views + 1).setValue(total || '');
    sheet.getRange(sheetRow, COL.thumbs + 1).setValue(JSON.stringify(thumbs));
  }

  return _json({ success: true, count: savedCount });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── 캘린더 "프로모션/이벤트 일정" (캘린더이벤트 시트) ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function _ensureEventSheet(ss) {
  var sheet = ss.getSheetByName(EVENT_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(EVENT_SHEET);
    sheet.getRange(1, 1, 1, 4).setValues([['이벤트명', '시작일', '종료일', '메모']]);
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
  }
  return sheet;
}

function _eventDateStr(cell) {
  if (cell instanceof Date && !isNaN(cell.getTime())) {
    return cell.getFullYear() + '-' + _pad(cell.getMonth() + 1) + '-' + _pad(cell.getDate());
  }
  var s = String(cell || '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

// doGet에서 호출 — 시트가 아직 없으면(한 번도 저장 안 됨) 그냥 빈 배열 반환 (여기서 시트를 생성하지 않음)
function _loadCalendarEvents(ss) {
  var sheet = ss.getSheetByName(EVENT_SHEET);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  var events = [];
  for (var i = EVENT_DATA_START_ROW; i < data.length; i++) {
    var row = data[i];
    var name = String(row[EVENT_COL.name] || '').trim();
    var start = _eventDateStr(row[EVENT_COL.start]);
    if (!name || !start) continue;
    events.push({
      id: i + 1, // 캘린더이벤트 시트의 실제 물리 행 번호(1-based)
      name: name,
      start: start,
      end: _eventDateStr(row[EVENT_COL.end]) || start,
      note: String(row[EVENT_COL.note] || '').trim()
    });
  }
  return events;
}

// 클라이언트가 모달을 연 시점의 이벤트명(origName)이 현재 시트 값과 일치하는지 확인
// (그 사이 행이 삭제/이동됐으면 엉뚱한 행을 고치지 않도록 방어)
function _eventRowValid(sheet, row, origName) {
  if (!row || row <= EVENT_DATA_START_ROW || row > sheet.getLastRow()) return false;
  var actual = String(sheet.getRange(row, EVENT_COL.name + 1).getValue() || '').trim();
  return actual === String(origName || '').trim();
}

function _addCalendarEvent(ss, data) {
  var name = String((data && data.name) || '').trim();
  var start = data && data.start ? new Date(data.start) : null;
  if (!name) return _json({ error: '이벤트명을 입력하세요.' });
  if (!start) return _json({ error: '시작일을 입력하세요.' });
  var end = data.end ? new Date(data.end) : start;

  var sheet = _ensureEventSheet(ss);
  sheet.appendRow([name, start, end, data.note || '']);
  return _json({ success: true });
}

function _updateCalendarEvent(ss, data) {
  var sheet = ss.getSheetByName(EVENT_SHEET);
  if (!sheet) return _json({ error: '캘린더이벤트 시트를 찾을 수 없습니다.' });
  if (!_eventRowValid(sheet, data.row, data.origName)) {
    return _json({ error: '해당 이벤트를 찾을 수 없습니다. 새로고침 후 다시 시도해주세요.' });
  }
  var name = String((data && data.name) || '').trim();
  var start = data && data.start ? new Date(data.start) : null;
  if (!name) return _json({ error: '이벤트명을 입력하세요.' });
  if (!start) return _json({ error: '시작일을 입력하세요.' });
  var end = data.end ? new Date(data.end) : start;

  var row = data.row;
  sheet.getRange(row, EVENT_COL.name + 1).setValue(name);
  sheet.getRange(row, EVENT_COL.start + 1).setValue(start);
  sheet.getRange(row, EVENT_COL.end + 1).setValue(end);
  sheet.getRange(row, EVENT_COL.note + 1).setValue(data.note || '');
  return _json({ success: true });
}

function _deleteCalendarEvent(ss, data) {
  var sheet = ss.getSheetByName(EVENT_SHEET);
  if (!sheet) return _json({ error: '캘린더이벤트 시트를 찾을 수 없습니다.' });
  if (!_eventRowValid(sheet, data.row, data.origName)) {
    return _json({ error: '해당 이벤트를 찾을 수 없습니다. 새로고침 후 다시 시도해주세요.' });
  }
  sheet.deleteRow(data.row);
  return _json({ success: true });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── 릴스 썸네일 업로드(Drive) ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

var THUMB_FOLDER_NAME = '공동구매_릴스_썸네일';

function _uploadThumbnail(data) {
  if (!data || !data.base64) return _json({ error: '업로드할 이미지 데이터가 없습니다.' });
  try {
    var folder = _getThumbFolder();
    var bytes = Utilities.base64Decode(data.base64);
    var mimeType = data.mimeType || 'image/jpeg';
    var blob = Utilities.newBlob(bytes, mimeType, 'thumb_' + Date.now() + '.jpg');
    var file = folder.createFile(blob);

    // 조직 정책이 "링크가 있는 모든 사용자" 공유를 막고 있어 개별 파일 공유는 신뢰할 수 없음(403).
    // 대신 파일은 비공개로 두고, doGet의 ?thumb=<fileId> 프록시로 스크립트 소유자 권한으로 내려줌.
    var url = ScriptApp.getService().getUrl() + '?thumb=' + file.getId();
    return _json({ success: true, url: url });
  } catch (err) {
    return _json({ error: '이미지 업로드 실패: ' + err.toString() });
  }
}

function _getThumbFolder() {
  var it = DriveApp.getFoldersByName(THUMB_FOLDER_NAME);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(THUMB_FOLDER_NAME);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── 유틸리티 ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function _pad(n) { return n < 10 ? '0' + n : String(n); }

function _numOrNull(v) {
  if (v === null || v === '' || v === undefined) return null;
  var n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? null : n;
}

// 날짜 파싱: Date 셀 → "YYYY-MM-DD" (연도 + "M/D" 텍스트 형식도 폴백 지원)
function _parseDate(cell, year) {
  if (cell instanceof Date && !isNaN(cell.getTime())) {
    return cell.getFullYear() + '-' + _pad(cell.getMonth() + 1) + '-' + _pad(cell.getDate());
  }
  var s = String(cell || '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  var m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})$/);
  if (m && year) {
    var mo = parseInt(m[1], 10);
    var da = parseInt(m[2], 10);
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) return parseInt(year, 10) + '-' + _pad(mo) + '-' + _pad(da);
  }
  return null;
}

// 연도 넘김 보정: 시작일/종료일이 같은 해로 파싱됐는데 종료월이 시작월보다 앞서면(예: 12월→1월)
// 실제로는 해를 넘긴 일정으로 보고 종료일 연도를 +1 함.
function _fixYearWrap(startDate, endDate) {
  if (!startDate || !endDate) return endDate;
  var sy = parseInt(startDate.slice(0, 4), 10), sm = parseInt(startDate.slice(5, 7), 10);
  var ey = parseInt(endDate.slice(0, 4), 10), em = parseInt(endDate.slice(5, 7), 10);
  if (sy === ey && em < sm) return (ey + 1) + endDate.slice(4);
  return endDate;
}
