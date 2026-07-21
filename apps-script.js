/**
 * 미닉스 공동구매 자동화 대시보드 — Google Apps Script 연동 코드
 * 데이터 소스: "앳홈 공동구매 총괄 시트" → 실적통합 탭 (한 행 = 공구 1건, 미닉스+톰+기타 브랜드 혼재 → 미닉스만 필터링)
 * 캘린더 "프로모션/이벤트 일정"은 같은 스프레드시트의 "캘린더이벤트" 탭에 별도 저장 (실적통합과 무관, 실적/KPI 집계 제외)
 *
 * ★ 배포 방법 (반드시 "앳홈 공동구매 총괄 시트"에서 배포):
 * 1. 해당 스프레드시트 → 확장 프로그램 → Apps Script
 * 2. 이 파일 내용 전체 붙여넣기 후 저장
 * 3. 배포 → 기존 배포 관리 → 새 버전으로 배포 (URL 유지)
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── CONFIGURATION ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 배포본 확인용 버전 문자열 — 이 파일을 수정할 때마다 값을 바꿔서, doGet 응답에 포함시켜
// 프론트(DASHBOARD_VERSION)와 대조하면 "로컬 파일 = 실제 배포본"인지 바로 확인 가능
var SCRIPT_VERSION = 'reels-fix-2026-07-13-05-thumbproxy';

// 메인 데이터 시트명 — 실제 탭명으로 수정하세요 (대소문자·띄어쓰기 포함)
// ※ "앳홈 공동구매 총괄 시트"의 실제 탭명은 '실적통합' (통합실적 아님)
var MAIN_SHEET = '실적통합';

// 데이터 시작 행 (3행부터 데이터 → 0-based index = 2)
var DATA_START_ROW = 2;

// 열 인덱스 (0-based: A=0, B=1, C=2 ...)
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
  startMD:    11,  // L: 시작일 (Date 셀. 드물게 "M/D" 텍스트인 경우 K열 연도와 조합)
  endMD:      12,  // M: 종료일 (Date 셀. 드물게 "M/D" 텍스트인 경우 K열 연도와 조합)
  status:     13,  // N: 진행상태 (종료/진행중/예정, 수식으로 자동 계산됨)
  format:     14,  // O: 포맷 (릴스/유튜브/게시물)
  // P: 릴스 조회수 합계. 값이 이미 "만" 단위로 저장됨 (예: 3.4 = 3.4만 = 34,000회)
  // "조회수" 헤더가 P~Z에 병합돼 있어 헤더 텍스트로는 열을 찾을 수 없음 → 고정 인덱스(P, 16번째 열)로 읽음
  // Q~Z열은 릴스별 개별 조회수+링크(하이퍼링크) — 모달의 "릴스 관리"에서 읽고 씀 (REEL_COL_START 참고)
  views:      15,  // P
  // AC/AD/AE: 대시보드에서 새로 추가한 열 (원본 시트엔 없던 컬럼 — "새 공구건 등록" 폼용)
  code:        28,  // AC: 상품코드
  targetQty:   29,  // AD: 목표수량
  composition: 30,  // AE: 구성
  link:        31,  // AF: 채널 링크 (모달에서 직접 수정)
  thumbs:      32,  // AG: 릴스별 썸네일 URL 목록 (JSON 배열, Q~Z 순서와 매칭)
  // AH: 출처 — 이 실적통합 행이 어느 브랜드 시트의 몇 번째 행에서 왔는지("시트명!행번호") 기록하는
  // 내부용 연결고리. 브랜드 시트 매칭(제품명+채널명+시작일)을 대체하는 값이라 사람이 건드리면 안 되므로 숨김 처리함.
  source:      33,  // AH: 출처 (예: "1) 더 플렌더!15")
};

// 릴스별 조회수/링크를 담는 열 범위: Q~Z (10칸). 셀 값=조회수(만 단위), 링크=해당 셀의 하이퍼링크.
// P열(조회수 합계)은 이 10개 칸의 합으로 대시보드가 직접 계산해 덮어씀 (기존 SUM(Q:W) 수식 대체)
var REEL_COL_START = 17; // Q (1-based)
var REEL_SLOT_COUNT = 10;

// 접근 제어
var REQUIRE_AUTH   = true;
var ALLOWED_DOMAIN = 'athomecorp.com';

// 이 대시보드는 Minix 전용입니다 — 브랜드열 값이 아래 목록에 없으면 해당 행은 제외됩니다
// (톰/프로티원 등 타 브랜드 행은 자동으로 걸러집니다)
var MINIX_ALIASES = { '미닉스': true, 'minix': true, 'Minix': true, 'MINIX': true };

// 캘린더 "프로모션/이벤트 일정" 전용 시트 — 실적통합과 완전히 분리되어 실적/KPI/품목별 실적에 집계되지 않음
// 탭이 없으면 최초 저장 시 _ensureEventSheet가 헤더까지 자동 생성함
var EVENT_SHEET = '캘린더이벤트';
var EVENT_COL = { name: 0, start: 1, end: 2, note: 3 }; // A 이벤트명 / B 시작일 / C 종료일 / D 메모
var EVENT_DATA_START_ROW = 1; // 0-based index — 1행(index 0)은 헤더, 2행부터 데이터

// doGet 응답 캐시 — 실적통합+브랜드 시트 3개(릴스 하이퍼링크 포함) 파싱이 무거워서(수 초~십수 초),
// 여러 사용자가 짧은 간격으로 새로고침/동시 접속할 때 실행 시간·동시 실행 한도 부담이 커짐.
// 계산 결과를 스크립트 캐시에 잠깐 담아두고 그 안에서는 재계산 없이 그대로 돌려줌.
// 데이터를 실제로 바꾸는 doPost 액션은 저장 성공 시 _invalidateDashboardCache()로 즉시 무효화함.
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

    // 시트 탐색 (설정명 우선, 없으면 유사 이름 시도)
    var sheet = ss.getSheetByName(MAIN_SHEET);
    if (!sheet) {
      var fallbacks = ['실적통합', '통합실적', '공동구매통합', '공동구매 통합', '실적'];
      for (var f = 0; f < fallbacks.length; f++) {
        sheet = ss.getSheetByName(fallbacks[f]);
        if (sheet) { Logger.log('시트 자동 감지: ' + fallbacks[f]); break; }
      }
    }
    if (!sheet) {
      var allNames = ss.getSheets().map(function(s) { return s.getName(); });
      throw new Error('데이터 시트를 찾을 수 없습니다. 현재 시트 목록: ' + allNames.join(', '));
    }

    // 디버그 모드: ?debug=1 로 호출 시 316행 근처 원본 P~V열 값을 그대로 반환 (조회수 파싱 확인용)
    if (e && e.parameter && e.parameter.debug === '1') {
      return _json(_debugViewsRaw(sheet));
    }

    // 디버그 모드: ?debug=reels&row=123 으로 호출 시 해당 행의 Q~Z(릴스 URL/조회수)와
    // AG(썸네일 JSON) 원본 상태를 그대로 반환 — 릴스 저장이 실제로 시트에 반영됐는지 확인용
    if (e && e.parameter && e.parameter.debug === 'reels' && e.parameter.row) {
      return _json(_debugReelsRaw(sheet, parseInt(e.parameter.row, 10)));
    }

    // ?nocache=1이면 캐시를 건너뛰고 항상 새로 계산(수동 새로고침 버튼용)
    var noCache = !!(e && e.parameter && e.parameter.nocache === '1');
    var cache = CacheService.getScriptCache();
    var cacheKey = _dashboardCacheKey();
    var payload = noCache ? null : _cacheGetJSON(cache, cacheKey);
    var fromCache = !!payload;

    if (!payload) {
      // 브랜드 시트 ↔ 실적통합 연결고리를 UUID 기반으로 자동 전환 — 아직 구버전(행번호 기반) 출처가
      // 남아있으면 브랜드 시트 행이 삽입/삭제될 때마다 조인이 밀려서 엉뚱한 행과 매칭됨
      _autoMigrateLegacyLinks(ss);

      var result = parseMainSheet(sheet, ss);
      // id는 parseMainSheet에서 이미 실제 시트 행 번호로 부여됨 (내용 기반 재번호 금지)

      var calendarEvents = _loadCalendarEvents(ss);

      // 출처("시트명!행번호")로 인덱싱한 실적통합 맵 — 브랜드 시트 행에 판매수량/매출/조회수/릴스를 조인할 때 사용
      var perfMap = {};
      for (var pi = 0; pi < result.deals.length; pi++) {
        var pd = result.deals[pi];
        if (pd.source) perfMap[pd.source] = pd;
      }
      var brandDeals = [];
      try { brandDeals = _readBrandSheets(ss, perfMap); } catch (brandErr) { Logger.log('브랜드 시트 로드 실패 (무시): ' + brandErr); }

      payload = { purchases: result.deals, brandDeals: brandDeals, calendarEvents: calendarEvents, updatedAt: new Date().toISOString(), codeMatchStats: result.codeStats, version: SCRIPT_VERSION };
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

// ── 디버그: 316행 근처 5개 행의 P~V열 원시값 그대로 반환 ──
function _debugViewsRaw(sheet) {
  var data = sheet.getDataRange().getValues();
  var centerRow1based = 316;
  var startIdx = Math.max(DATA_START_ROW, centerRow1based - 3); // 0-based
  var endIdx = Math.min(data.length, startIdx + 5);
  var cols = ['P', 'Q', 'R', 'S', 'T', 'U', 'V']; // 15~21 (0-based)
  var rows = [];
  for (var i = startIdx; i < endIdx; i++) {
    var row = data[i];
    var vals = {};
    for (var c = 0; c < cols.length; c++) {
      var cellVal = row[15 + c];
      vals[cols[c]] = {
        value: cellVal,
        type: Object.prototype.toString.call(cellVal),
        asString: String(cellVal)
      };
    }
    rows.push({ row: i + 1, brand: row[COL.brand], product: row[COL.product], cols: vals });
  }
  return { debug: true, sheetName: sheet.getName(), totalDataRows: data.length, rows: rows };
}

// ── 디버그: 특정 행의 릴스 저장 상태(Q~Z 하이퍼링크 + AG 썸네일 JSON) 원본 그대로 반환 ──
// 저장 직후 이 값들이 비어있으면 쓰기(doPost/_saveReels) 문제, 값은 있는데 대시보드에 안 보이면
// 읽기(parseMainSheet)/프론트 문제로 원인을 좁힐 수 있음
function _debugReelsRaw(sheet, row) {
  if (!row || row < DATA_START_ROW + 1 || row > sheet.getLastRow()) {
    return { debug: true, error: '잘못된 행 번호: ' + row + ' (유효 범위 ' + (DATA_START_ROW + 1) + '~' + sheet.getLastRow() + ')' };
  }
  var rowVals = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
  var richRow = sheet.getRange(row, REEL_COL_START, 1, REEL_SLOT_COUNT).getRichTextValues()[0];
  var slots = [];
  for (var i = 0; i < REEL_SLOT_COUNT; i++) {
    var rc = richRow[i];
    slots.push({ col: String.fromCharCode(81 + i), text: rc ? rc.getText() : '', linkUrl: rc ? rc.getLinkUrl() : null });
  }
  var thumbsRaw = rowVals[COL.thumbs];
  var thumbs;
  try { thumbs = JSON.parse(thumbsRaw || '[]'); } catch (e) { thumbs = { parseError: String(e), raw: thumbsRaw }; }
  return {
    debug: true, row: row,
    product: rowVals[COL.product], channel: rowVals[COL.channel],
    viewsTotal_P: rowVals[COL.views],
    reelSlots_Q_to_Z: slots,
    thumbsJson_AG_raw: thumbsRaw,
    thumbsJson_AG_parsed: thumbs
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── 브랜드별 일정 시트 → 상품코드 매칭 ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 실적통합엔 상품코드 컬럼이 없어서, 브랜드별 일정 시트(구조 동일: 3행 헤더, 4행부터 데이터)에서
// 채널명(인플루언서)+시작일(월/일)로 매칭해 가져옴. 셋 다 열 구조가 같음:
// A연도 B월 C브랜드 D제품명 E인플루언서 F벤더사 G링크 H상품코드 I상태 J시작일 K마감일 ...
var SCHEDULE_SHEETS = ['1) 더 플렌더', '2) 더 시프트 / 더 슬림', '3) 더 에어드라이'];
// 전체 열 구조(A~U, 실제 시트에서 확인됨):
// A연도 B월 C브랜드 D제품명 E인플루언서 F벤더사 G링크 H상품코드 I상태 J시작일 K마감일 L일
// M공구가 N수수료율 O구성 P추가옵션1 Q추가옵션2 R선착순 S목표(1차물량) T추가물량 U비고
// V공구ID(신설, 내부용 UUID) — 실적통합 출처(AH)가 이 값으로 브랜드 시트 행을 가리킴.
// 행 번호가 아니라 UUID로 연결하기 때문에, 브랜드 시트에서 행이 삭제/삽입돼도 다른 행들의
// 연결이 어긋나지 않음(행 삭제 시 밀림 문제 회피). migrateToUuidLinks()로 기존 행에 일괄 부여.
var SCHED_COL = {
  year: 0, month: 1, brand: 2, product: 3, channel: 4, vendor: 5, link: 6, code: 7, status: 8,
  start: 9, end: 10, days: 11, price: 12, commission: 13, composition: 14, targetQty: 18, dealId: 21
};
var SCHED_START_ROW = 3; // 0-based (4행부터 데이터)

// 채널명 정규화: 공백 제거 + "재이맘 (단독일정)"처럼 괄호가 붙으면 괄호 앞부분만 사용
function _normChannel(s) {
  return String(s || '').split('(')[0].replace(/\s/g, '').toLowerCase().trim();
}

// 더 플렌더는 모델(PRO/MAX/mini)까지 구분, 나머지는 제품 단위로 묶음
// ※ 실적통합엔 "더 에어드라이"가 구형 명칭인 "미니건조기"로 남아있는 행이 있어 별칭 처리
function _scheduleProductKey(p) {
  var np = _normProd(p);
  if (np.indexOf('플렌더') >= 0) {
    if (np.slice(-3) === 'pro') return '플렌더PRO';
    if (np.slice(-3) === 'max') return '플렌더MAX';
    return '플렌더MINI';
  }
  if (np === '더시프트') return '시프트';
  if (np === '더슬림') return '슬림';
  if (np.indexOf('에어드라이') >= 0 || np === '미니건조기') return '에어드라이';
  return np;
}

// 매칭 키: "제품명 + 채널명 + 시작일(월/일)" — 브랜드별 일정 시트 매칭·상품코드 매칭 공통으로 사용
function _scheduleMatchKey(product, channel, md) {
  return _scheduleProductKey(product) + '__' + _normChannel(channel) + '__' + md;
}

// 매칭 결과를 디버그 응답에 표시할 때 어느 일정 시트 그룹에 속하는지 라벨링
function _scheduleGroupLabel(product) {
  var key = _scheduleProductKey(product);
  if (key.indexOf('플렌더') === 0) return SCHEDULE_SHEETS[0];
  if (key === '시프트' || key === '슬림') return SCHEDULE_SHEETS[1];
  if (key === '에어드라이') return SCHEDULE_SHEETS[2];
  return '기타';
}

function _cellToMD(cell) {
  if (cell instanceof Date && !isNaN(cell.getTime())) {
    return _pad(cell.getMonth() + 1) + '-' + _pad(cell.getDate());
  }
  return null;
}

// 인플루언서명 셀의 하이퍼링크(인스타그램 프로필 등) 중 첫 번째로 발견되는 링크를 반환
// (셀 전체에 링크가 걸려 있으면 getLinkUrl()로 바로 잡히고, 일부 텍스트에만 걸린 경우엔 getRuns()를 훑어야 함)
function _firstLinkUrl(richTextValue) {
  if (!richTextValue) return '';
  var direct = richTextValue.getLinkUrl();
  if (direct) return direct;
  var runs = richTextValue.getRuns();
  for (var r = 0; r < runs.length; r++) {
    var u = runs[r].getLinkUrl();
    if (u) return u;
  }
  return '';
}

// 브랜드별 일정 시트 3개를 훑어서 { productKey__채널__MM-DD(시작일) : [{code, endMD, link, price, commission, targetQty}] } 맵으로 만듦
// (인플루언서명 열의 하이퍼링크는 시트당 한 번에 getRichTextValues()로 읽음 — 셀 단위 반복 호출 금지)
function _loadScheduleCodeMap(ss) {
  var map = {};
  for (var s = 0; s < SCHEDULE_SHEETS.length; s++) {
    var sheet = ss.getSheetByName(SCHEDULE_SHEETS[s]);
    if (!sheet) { Logger.log('일정 시트를 찾을 수 없음: ' + SCHEDULE_SHEETS[s]); continue; }
    var data = sheet.getDataRange().getValues();
    var rowCount = data.length - SCHED_START_ROW;

    var channelLinks = [];
    if (rowCount > 0) {
      var richCol = sheet.getRange(SCHED_START_ROW + 1, SCHED_COL.channel + 1, rowCount, 1).getRichTextValues();
      channelLinks = richCol.map(function (r) { return _firstLinkUrl(r[0]); });
    }

    for (var i = SCHED_START_ROW; i < data.length; i++) {
      var row = data[i];
      var product = String(row[SCHED_COL.product] || '').trim();
      var channel = String(row[SCHED_COL.channel] || '').trim();
      if (!product || !channel) continue;
      var startMD = _cellToMD(row[SCHED_COL.start]);
      if (!startMD) continue;
      var endMD = _cellToMD(row[SCHED_COL.end]) || startMD;
      var codeRaw = String(row[SCHED_COL.code] || '').trim();
      var code = (codeRaw && codeRaw.toUpperCase() !== 'X') ? codeRaw : '';
      var profileLink = channelLinks[i - SCHED_START_ROW] || '';
      var key = _scheduleMatchKey(product, channel, startMD);
      if (!map[key]) map[key] = [];
      // sheetName/row는 마이그레이션(migrateSourceLinks)에서 "출처" 값을 만들 때 필요
      // price/commission은 진짜 중복 후보(같은 채널+시작일+종료일)를 추가로 좁히는 타이브레이커용,
      // targetQty는 좁혀도 안 갈리는 진짜 중복일 때 합산해서 보여주는 용도
      // commission은 실적통합 쪽과 비교 기준을 맞추기 위해 항상 "%" 스케일(0.11 → 11)로 정규화해서 저장
      var schedCommission = _numOrNull(row[SCHED_COL.commission]);
      if (schedCommission != null && schedCommission <= 1) schedCommission = Math.round(schedCommission * 1000) / 10;
      map[key].push({
        code: code, endMD: endMD, link: profileLink, sheetName: SCHEDULE_SHEETS[s], row: i + 1,
        dealId: String(row[SCHED_COL.dealId] || '').trim(),
        price: _numOrNull(row[SCHED_COL.price]),
        commission: schedCommission,
        targetQty: _numOrNull(row[SCHED_COL.targetQty])
      });
    }
  }
  return map;
}

function _scheduleMatchResult(c) {
  return { code: c.code, matched: true, link: c.link || '', sheetName: c.sheetName, row: c.row, dealId: c.dealId || '' };
}

// 진짜 중복(제품+채널+시작일+종료일+공구가+수수료율까지 전부 같아서 하나로 못 좁히는 경우):
// 상품코드는 콤마로 나열, 목표수량은 합산해서 하나의 값으로 돌려줌.
// 출처(sheetName/row)는 대표로 첫 번째 후보 것을 사용(품목별 실적 조인용 — 나머지 후보는 조인되지 않음)
function _scheduleMergedMatchResult(list) {
  var codes = [], targetQtySum = 0, hasTargetQty = false, link = '';
  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    if (c.code) codes.push(c.code);
    if (c.targetQty != null) { targetQtySum += c.targetQty; hasTargetQty = true; }
    if (!link && c.link) link = c.link;
  }
  return {
    code: codes.join(', '),
    matched: true,
    merged: true,
    link: link,
    targetQtySum: hasTargetQty ? targetQtySum : null,
    sheetName: list[0].sheetName,
    row: list[0].row,
    dealId: list[0].dealId || ''
  };
}

// 실적통합 한 행에 대해 상품코드+프로필 링크(+매칭된 브랜드 시트 위치)를 찾음.
// 후보가 여러 개면 종료일(월/일) → 공구가 → 수수료율 순으로 좁히고,
// 그래도 안 갈리면 진짜 중복으로 보고 합쳐서 반환(_scheduleMergedMatchResult)
function _matchScheduleCode(scheduleMap, product, channel, startDate, endDate, salePrice, commission) {
  if (!scheduleMap || !startDate) return { code: '', matched: false, link: '' };
  var sMD = startDate.slice(5);
  var key = _scheduleMatchKey(product, channel, sMD);
  var candidates = scheduleMap[key] || [];
  if (candidates.length === 0) return { code: '', matched: false, link: '' };
  if (candidates.length === 1) return _scheduleMatchResult(candidates[0]);

  var eMD = (endDate || startDate).slice(5);
  var narrowed = candidates.filter(function (c) { return c.endMD === eMD; });
  if (narrowed.length === 0) return { code: '', matched: false, link: '' };
  if (narrowed.length === 1) return _scheduleMatchResult(narrowed[0]);

  if (salePrice != null) {
    var byPrice = narrowed.filter(function (c) { return c.price != null && Math.abs(c.price - salePrice) < 1; });
    if (byPrice.length === 1) return _scheduleMatchResult(byPrice[0]);
    if (byPrice.length > 0) narrowed = byPrice;
  }

  if (commission != null) {
    var byComm = narrowed.filter(function (c) { return c.commission != null && Math.abs(c.commission - commission) < 0.1; });
    if (byComm.length === 1) return _scheduleMatchResult(byComm[0]);
    if (byComm.length > 0) narrowed = byComm;
  }

  return _scheduleMergedMatchResult(narrowed);
}

// 품목(더플렌더/더시프트/더슬림/더에어드라이)에 대응하는 브랜드 시트명을 돌려줌 (등록 폼에서 새 행을 어디에 쓸지 결정할 때 사용)
function _scheduleSheetForProduct(product) {
  return _scheduleGroupLabel(product);
}

// 브랜드 시트 3개를 "품목별 실적" 화면의 기준 레코드로 파싱함.
// perfMap(실적통합을 출처값으로 인덱싱한 맵, key="시트명!행번호")이 있으면 판매수량/매출/조회수/릴스를 조인해 붙임.
// 매칭되는 실적통합 행이 없으면 해당 값들은 비워둔 채 브랜드 시트 원본 정보만 반환.
function _readBrandSheets(ss, perfMap) {
  var out = [];
  for (var s = 0; s < SCHEDULE_SHEETS.length; s++) {
    var sheetName = SCHEDULE_SHEETS[s];
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) { Logger.log('브랜드 시트를 찾을 수 없음: ' + sheetName); continue; }
    var data = sheet.getDataRange().getValues();
    var rowCount = data.length - SCHED_START_ROW;

    // 인플루언서명 셀에 걸린 프로필 링크(하이퍼링크) — 매칭된 실적통합 행이 없을 때의 대체 링크용
    var channelLinks = [];
    if (rowCount > 0) {
      var richCol = sheet.getRange(SCHED_START_ROW + 1, SCHED_COL.channel + 1, rowCount, 1).getRichTextValues();
      channelLinks = richCol.map(function (r) { return _firstLinkUrl(r[0]); });
    }

    for (var i = SCHED_START_ROW; i < data.length; i++) {
      var row = data[i];
      var product = String(row[SCHED_COL.product] || '').trim();
      var channel = String(row[SCHED_COL.channel] || '').trim();
      if (!product || !channel) continue;

      var rowNum = i + 1; // 1-based 물리 행 번호
      var dealId = String(row[SCHED_COL.dealId] || '').trim();
      // dealId(UUID)가 있으면 그걸로 조인(행이 밀려도 안전), 아직 없는(구버전) 행만 행 번호로 폴백
      var sourceKey = dealId ? (sheetName + '!' + dealId) : (sheetName + '!' + rowNum);
      var perf = (perfMap && perfMap[sourceKey]) || null;
      // 행 번호 폴백으로 찾은 결과는 그 사이 브랜드 시트 행이 삽입/삭제돼 밀렸으면 완전히 다른
      // 채널(심하면 다른 모델)의 실적통합 행을 가리킬 수 있음 — 채널명이 실제로 일치할 때만 신뢰하고,
      // 다르면 미매칭으로 처리(품목별 실적 표를 클릭했을 때 엉뚱한 건의 모달이 뜨는 걸 방지)
      if (perf && !dealId && _normChannel(perf.channel) !== _normChannel(channel)) perf = null;

      var year = _numOrNull(row[SCHED_COL.year]);
      var startDate = _parseDate(row[SCHED_COL.start], year);
      var endDate = _parseDate(row[SCHED_COL.end], year) || startDate;
      endDate = _fixYearWrap(startDate, endDate);

      var commission = _numOrNull(row[SCHED_COL.commission]);
      if (commission != null && commission <= 1) commission = Math.round(commission * 1000) / 10;

      out.push({
        // 매칭된 실적통합 행이 있으면 그 행 번호(=기존 openM 모달이 찾는 id)를 그대로 사용,
        // 없으면 실적통합 id(항상 양수)와 절대 겹치지 않는 음수 합성 id 부여
        id:          perf ? perf.id : -(100000 * (s + 1) + rowNum),
        mainId:      perf ? perf.id : null,
        sheetName:   sheetName,
        row:         rowNum,
        brand:       'Minix',
        product:     product,
        channel:     channel,
        vendor:      String(row[SCHED_COL.vendor] || '').trim(),
        code:        String(row[SCHED_COL.code] || '').trim(),
        status:      String(row[SCHED_COL.status] || '').trim() || '예정',
        start:       startDate || '',
        end:         endDate   || '',
        sale:        _numOrNull(row[SCHED_COL.price]),
        commission:  commission,
        composition: String(row[SCHED_COL.composition] || '').trim(),
        targetQty:   _numOrNull(row[SCHED_COL.targetQty]),
        link:        (perf && perf.link) || channelLinks[i - SCHED_START_ROW] || '',
        format:      perf ? perf.format : '',
        qty:         perf ? perf.qty : null,
        revenue:     perf ? perf.revenue : null,
        views:       perf ? perf.views : null,
        reels:       perf ? perf.reels : []
      });
    }
  }
  return out;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── 메인 시트 파싱 (한 행 = 공구 1건) ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function parseMainSheet(sheet, ss) {
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

  // 릴스별 조회수/링크(Q~Z, 하이퍼링크 포함) — 한 번에 읽어서 행별로 매칭
  var reelRich = null;
  try {
    if (data.length > DATA_START_ROW) {
      reelRich = sheet.getRange(DATA_START_ROW + 1, REEL_COL_START, data.length - DATA_START_ROW, REEL_SLOT_COUNT).getRichTextValues();
    }
  } catch (e) {
    Logger.log('릴스 링크 읽기 실패 (무시): ' + e);
  }

  // 브랜드별 일정 시트 → 상품코드 매칭용 맵 (실패해도 파싱은 계속, 전부 미매칭 처리)
  var scheduleMap = null;
  try {
    scheduleMap = _loadScheduleCodeMap(ss || sheet.getParent());
  } catch (e) {
    Logger.log('상품코드 매칭용 일정 시트 로드 실패 (무시): ' + e);
  }
  var codeStats = { total: 0, matched: 0, unmatched: 0, byGroup: {}, failedRows: [] };
  var CODE_FAIL_SAMPLE_LIMIT = 50;

  var today = new Date();
  today.setHours(0, 0, 0, 0);

  var deals = [];

  for (var i = DATA_START_ROW; i < data.length; i++) {
    var row = data[i];

    // 취소된 행 제외
    if (strikeMap[i]) continue;

    var brand   = String(row[COL.brand]   || '').trim();
    var product = String(row[COL.product] || '').trim();

    // 제품명이 없으면 빈 행/구분용 행("2025년" 등 연도 구분 행 포함)으로 간주하고 제외
    if (!product) continue;

    // Minix 전용 대시보드 — 다른 브랜드(톰/프로티원 등) 행은 제외
    if (!MINIX_ALIASES[brand]) continue;

    var vendor     = String(row[COL.vendor]   || '').trim();
    var channel    = String(row[COL.channel]  || '').trim();
    var platform   = String(row[COL.platform] || '').trim();
    var salePrice  = _numOrNull(row[COL.salePrice]);
    var qty        = _numOrNull(row[COL.qty]);
    var revenue    = _numOrNull(row[COL.revenue]);
    var commission = _numOrNull(row[COL.commission]);
    // 시트에는 35% 같은 값이 0.35 형태의 소수로 저장되어 있음 → 표시용으로 100배 환산
    if (commission != null && commission <= 1) commission = Math.round(commission * 1000) / 10;
    var year       = _numOrNull(row[COL.year]);
    var startCell  = row[COL.startMD];
    var endCell    = row[COL.endMD];
    var statusRaw  = String(row[COL.status]  || '').trim();
    var format     = String(row[COL.format]  || '').trim();

    // 조회수: P열(고정 인덱스) 값 그대로 사용 — 이미 "만" 단위 (예: 3.4 = 3.4만회)
    var views = _numOrNull(row[COL.views]);
    if (views === 0) views = null; // 0/빈값은 프론트에서 "—"로 표시

    // 릴스별 URL/조회수(Q~Z, 하이퍼링크 포함) + 썸네일(AG, JSON) 조합
    var reels = [];
    if (reelRich) {
      var richRow = reelRich[i - DATA_START_ROW];
      var thumbsArr = [];
      try { thumbsArr = JSON.parse(row[COL.thumbs] || '[]'); } catch (e) {}
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

    // 날짜 생성: L/M열은 보통 실제 날짜 셀(Date)이며, 드물게 "M/D" 텍스트 + K(연도)로 입력된 경우도 처리
    // 다른 행의 날짜는 절대 참조하지 않음 — 오직 이 행의 K/L/M열만 사용
    var startDate = _parseDate(startCell, year);
    var endDate   = _parseDate(endCell, year) || startDate;
    // 연도 넘김: 같은 행 안에서 종료일의 월이 시작일의 월보다 앞서면(예: 12월→1월) 종료일에 +1년
    endDate = _fixYearWrap(startDate, endDate);

    // 진행상태: N열 우선, 비어있으면 날짜 계산
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

    // 상품코드: 우리가 새로 추가한 AC열에 값이 있으면 그걸 우선 사용하고,
    // 없으면 브랜드별 일정 시트에서 채널명+시작일(월/일)로 매칭 (모호하면 종료일까지 비교)
    // 인플루언서 프로필 링크도 같은 매칭 결과에서 가져옴 (상품코드 보유 여부와 무관하게 항상 시도)
    var code = String(row[COL.code] || '').trim();
    var schedMatch = _matchScheduleCode(scheduleMap, product, channel, startDate, endDate, salePrice, commission);
    if (!code) {
      codeStats.total++;
      var grp = _scheduleGroupLabel(product);
      if (!codeStats.byGroup[grp]) codeStats.byGroup[grp] = { total: 0, matched: 0, unmatched: 0 };
      codeStats.byGroup[grp].total++;
      // 일정 행을 찾았어도 그 행의 상품코드 자체가 비어있으면("X" 포함) 실질적으론 미매칭으로 집계
      if (schedMatch.matched && schedMatch.code) {
        code = schedMatch.code; codeStats.matched++; codeStats.byGroup[grp].matched++;
      } else {
        codeStats.unmatched++; codeStats.byGroup[grp].unmatched++;
        if (codeStats.failedRows.length < CODE_FAIL_SAMPLE_LIMIT) {
          codeStats.failedRows.push({ product: product, channel: channel, start: startDate || '' });
        }
      }
    }
    var profileLink = schedMatch.link || '';

    // 목표수량: AD열에 이미 값이 있으면 그걸 우선 사용하고, 비어있는데 브랜드 시트에서 진짜 중복(합쳐진 매칭)이
    // 나왔으면 그 중복 행들의 목표수량 합계를 대신 보여줌 (시트에 쓰는 건 아니고 화면 표시용)
    var targetQty = _numOrNull(row[COL.targetQty]);
    if (targetQty == null && schedMatch.merged && schedMatch.targetQtySum != null) {
      targetQty = schedMatch.targetQtySum;
    }

    deals.push({
      id:         i + 1, // 실적통합 시트의 실제 물리 행 번호(1-based) — 채널명 등 내용 기반 키는 절대 사용하지 않음
      brand:      'Minix',
      product:    product,
      channel:    channel,
      influencer: channel,
      profileLink: profileLink,
      vendor:     vendor,
      platform:   platform,
      format:     format,
      start:      startDate || '',
      end:        endDate   || '',
      targetQty:  targetQty,
      status:     status,
      views:      views,
      qty:        qty,
      revenue:    revenue,
      code:        code,
      composition: String(row[COL.composition] || '').trim(),
      link:        String(row[COL.link] || '').trim(),
      reels:       reels,
      retail:      null,
      sale:        salePrice,
      commission:  commission,
      openTime:    '',
      note:        '',
      source:      String(row[COL.source] || '').trim(), // "시트명!행번호" — 브랜드 시트와의 연결고리
    });
  }

  Logger.log('파싱 완료: ' + deals.length + '건 / 시트: ' + sheet.getName() + ' / 상품코드 매칭: ' + codeStats.matched + '/' + codeStats.total);
  return { deals: deals, codeStats: codeStats };
}

// ── 날짜 파싱: Date 셀 → "YYYY-MM-DD" (연도 + "M/D" 텍스트 형식도 폴백 지원) ──
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
// 실제로는 해를 넘긴 일정으로 보고 종료일 연도를 +1 함. 서로 다른 해로 이미 파싱된 경우는 건드리지 않음
// (해당 행의 날짜 자체가 잘못 입력된 경우까지 임의로 "고치지" 않기 위함 — 그런 행은 그대로 노출해 발견 가능하게 둠)
function _fixYearWrap(startDate, endDate) {
  if (!startDate || !endDate) return endDate;
  var sy = parseInt(startDate.slice(0, 4), 10), sm = parseInt(startDate.slice(5, 7), 10);
  var ey = parseInt(endDate.slice(0, 4), 10), em = parseInt(endDate.slice(5, 7), 10);
  if (sy === ey && em < sm) return (ey + 1) + endDate.slice(4);
  return endDate;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── doPost: 공구 추가 / 실적 기입 ──
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
    // 시트를 바꾸는 액션이 예외 없이 끝나면 캐시를 무효화 — 다음 doGet이 방금 바뀐 값을 바로 반영하게 함
    // (uploadThumbnail처럼 실적통합/브랜드 시트를 직접 바꾸지 않는 액션까지 포함해도, 한 번 더 재계산되는 것 외엔 부작용 없음)
    _invalidateDashboardCache();
    return resp;
  } catch (err) {
    return _json({ error: err.toString() });
  }
}

// 새 공구건 등록 → 브랜드 시트(원본 입력)와 실적통합(집계·KPI용) 양쪽에 동시에 행을 추가하고
// 두 행을 "출처" 연결고리로 이어줌. 두 시트에 각각 기록된 행 번호를 응답에 포함해 대시보드에서 확인 가능하게 함.
function _addDeal(ss, data) {
  var brandInfo = null;
  try {
    brandInfo = _addBrandRow(ss, data);
  } catch (e) {
    // 브랜드 시트 기록이 실패해도 실적통합 기록(핵심 KPI 데이터)은 계속 진행 — 사람이 나중에 수동 보완 가능
    Logger.log('브랜드 시트 기록 실패 (무시, 실적통합 기록은 계속 진행): ' + e);
  }
  var sourceRef = brandInfo ? (brandInfo.sheetName + '!' + brandInfo.dealId) : '';
  var mainRow = _addSalesRow(ss, data, sourceRef);

  return _json({
    success:    true,
    mainRow:    mainRow,
    brandSheet: brandInfo ? brandInfo.sheetName : '',
    brandRow:   brandInfo ? brandInfo.row : null
  });
}

// 브랜드 시트(1) 더 플렌더 / 2) 더 시프트 / 더 슬림 / 3) 더 에어드라이)에 새 행 추가.
// 실제 열 구조(A~U, SCHED_COL 참고)에 맞춰 폼 필드를 매핑하고, 대응하는 폼 필드가 없는 열
// (추가옵션1/2, 선착순, 추가물량, 비고 등)은 비워둬 사람이 나중에 채우도록 함.
function _addBrandRow(ss, data) {
  var sheetName = _scheduleSheetForProduct(data.product);
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) { Logger.log('브랜드 시트를 찾을 수 없음: ' + sheetName); return null; }

  var startDate = data.start ? new Date(data.start) : null;
  var endDate   = data.end   ? new Date(data.end)   : startDate;
  var days = (startDate && endDate) ? Math.round((endDate - startDate) / 86400000) + 1 : null;
  var scheme = data.s || {};

  var row = [];
  row[SCHED_COL.year]        = startDate ? startDate.getFullYear() : '';
  row[SCHED_COL.month]       = startDate ? startDate.getMonth() + 1 : '';
  row[SCHED_COL.brand]       = '미닉스';
  row[SCHED_COL.product]     = data.product || '';
  row[SCHED_COL.channel]     = data.ch || '';
  row[SCHED_COL.vendor]      = data.vendor || '';
  row[SCHED_COL.code]        = data.code || '';
  row[SCHED_COL.status]      = data.status || '예정';
  row[SCHED_COL.start]       = startDate || '';
  row[SCHED_COL.end]         = endDate   || '';
  row[SCHED_COL.days]        = days != null ? (days + '일') : '';
  row[SCHED_COL.price]       = scheme.sale != null ? scheme.sale : '';
  row[SCHED_COL.commission]  = scheme.comm != null ? scheme.comm / 100 : ''; // 화면은 %, 시트는 0.35 형태 소수
  row[SCHED_COL.composition] = data.composition || '';
  row[SCHED_COL.targetQty]   = data.targetQty != null ? data.targetQty : '';
  var dealId = Utilities.getUuid();
  row[SCHED_COL.dealId]      = dealId;
  for (var i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';

  sheet.appendRow(row);
  return { sheetName: sheet.getName(), row: sheet.getLastRow(), dealId: dealId };
}

// 새 공구건 등록 → 실적통합 시트에 새 행 추가 (브랜드별 실적 표에 쓰이는 필드 전부 채움 + 출처 연결고리)
function _addSalesRow(ss, data, sourceRef) {
  var sheet = ss.getSheetByName(MAIN_SHEET);
  if (!sheet) throw new Error('실적통합 시트를 찾을 수 없습니다.');

  _ensureExtraHeaders(sheet);

  var scheme = data.s || {};
  var startDate = data.start ? new Date(data.start) : null;
  var endDate   = data.end   ? new Date(data.end)   : startDate;

  var row = [];
  row[COL.brand]      = '미닉스';
  row[COL.product]    = data.product || '';
  row[COL.vendor]     = data.vendor || '';
  row[COL.channel]    = data.ch || '';
  row[COL.platform]   = data.platform || '';
  row[COL.salePrice]  = scheme.sale != null ? scheme.sale : '';
  row[COL.commission] = scheme.comm != null ? scheme.comm / 100 : ''; // 화면은 %, 시트는 0.35 형태 소수
  row[COL.year]       = startDate ? startDate.getFullYear() : '';
  row[COL.startMD]    = startDate || '';
  row[COL.endMD]      = endDate   || '';
  row[COL.status]     = data.status || '예정';
  row[COL.format]     = data.format || '';
  row[COL.code]        = data.code || '';
  row[COL.targetQty]   = data.targetQty != null ? data.targetQty : '';
  row[COL.composition] = data.composition || '';
  row[COL.link]        = data.link || '';
  row[COL.source]      = sourceRef || '';
  for (var i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';

  sheet.appendRow(row);
  return sheet.getLastRow();
}

// 대시보드에서 새로 쓰는 AC~AH열에 헤더가 없으면 채워줌 (원본 시트엔 없던 컬럼이라 최초 1회만 필요)
function _ensureExtraHeaders(sheet) {
  var headers = [
    [COL.code, '상품코드'],
    [COL.targetQty, '목표수량'],
    [COL.composition, '구성'],
    [COL.link, '채널 링크'],
    [COL.thumbs, '릴스 썸네일(JSON)'],
    [COL.source, '출처(내부용, 수동 수정 금지)']
  ];
  for (var i = 0; i < headers.length; i++) {
    var cell = sheet.getRange(2, headers[i][0] + 1);
    if (!cell.getValue()) cell.setValue(headers[i][1]);
  }
  // 출처 열은 매칭 키를 대체하는 내부 연결고리라 사람이 보는 화면에서는 숨겨둠
  try { sheet.hideColumns(COL.source + 1); } catch (e) { Logger.log('출처 열 숨기기 실패 (무시): ' + e); }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── 캘린더 "프로모션/이벤트 일정" (캘린더이벤트 시트) ──
// 공동구매 실적과는 무관한 특별 프로모션/이벤트(세일즈 페스타, 라이브 방송 등)를
// 캘린더에만 표시하기 위한 별도 데이터 — 실적통합 시트는 절대 건드리지 않음
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 시트가 없으면 헤더(이벤트명/시작일/종료일/메모)까지 포함해 최초 저장 시 자동 생성
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
// (실적통합의 _rowByNumber와 같은 목적 — 그 사이 행이 삭제/이동됐으면 엉뚱한 행을 고치지 않도록 방어)
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

// 클라이언트가 보낸 물리 행 번호(1-based, doGet에서 부여한 id와 동일)로 행을 찾음.
// 같은 제품+채널 조합이 여러 행에 존재하는 경우가 실제로 매우 흔해서(같은 인플루언서 재진행 등)
// 내용 기반 매칭(_findDataRow, 구버전)은 항상 첫 번째 일치 행만 찾아 다른 회차를 잘못 덮어쓸 수 있었음.
// 행 번호를 신뢰하되, 클라이언트 데이터가 오래되어 행이 바뀌었을 가능성에 대비해 제품+채널 일치 여부를 한 번 더 확인함.
function _rowByNumber(all, row, product, channel) {
  if (!row) return -1;
  var idx = row - 1; // 1-based → 0-based
  if (idx < DATA_START_ROW || idx >= all.length) return -1;
  var np = _normProd(String(all[idx][COL.product] || ''));
  var nc = _normProd(String(all[idx][COL.channel] || ''));
  if (np !== _normProd(product || '') || nc !== _normProd(channel || '')) return -1;
  return idx;
}

// 실적 기입 → 실적통합 시트 해당 행 업데이트
function _addPerf(ss, data) {
  var sheet = ss.getSheetByName(MAIN_SHEET);
  if (!sheet) return _json({ error: '실적통합 시트를 찾을 수 없습니다.' });

  var all = sheet.getDataRange().getValues();
  var rowIdx = _rowByNumber(all, data.row, data.product, data.channel);
  if (rowIdx < 0) return _json({ error: '해당 공구 행을 찾을 수 없습니다. 새로고침 후 다시 시도해주세요.' });

  var sheetRow = rowIdx + 1; // 1-based
  if (data.qty     != null) sheet.getRange(sheetRow, COL.qty     + 1).setValue(data.qty);
  if (data.revenue != null) sheet.getRange(sheetRow, COL.revenue + 1).setValue(data.revenue);
  if (data.views   != null) sheet.getRange(sheetRow, COL.views   + 1).setValue(data.views);

  return _json({ success: true });
}

// 모달의 릴스 관리 저장 → 채널 링크(AF) + 릴스별 URL/조회수(Q~Z, 하이퍼링크 포함) + 썸네일(AG) + 조회수 합계(P)
function _saveReels(ss, data) {
  var sheet = ss.getSheetByName(MAIN_SHEET);
  if (!sheet) return _json({ error: '실적통합 시트를 찾을 수 없습니다.' });

  _ensureExtraHeaders(sheet);

  var all = sheet.getDataRange().getValues();
  var rowIdx = _rowByNumber(all, data.row, data.product, data.channel);
  if (rowIdx < 0) return _json({ error: '해당 공구 행을 찾을 수 없습니다. 새로고침 후 다시 시도해주세요.' });
  var sheetRow = rowIdx + 1; // 1-based

  sheet.getRange(sheetRow, COL.link + 1).setValue(data.link || '');

  // data.reels가 배열로 명시된 경우에만 Q~Z/P/썸네일을 갱신함
  // (원래 릴스가 없던 건에서 링크만 고치고 저장한 경우 기존 조회수 데이터를 실수로 지우지 않기 위함)
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
        // setLinkUrl은 URL 형식이 이상하면 예외를 던짐 — 한 슬롯 실패로 나머지 릴스/합계/썸네일까지
        // 통째로 저장되지 않는 것을 막기 위해 슬롯 단위로 격리
        try {
          if (r.url) {
            // "7.8"처럼 숫자로만 보이는 텍스트에 링크를 걸면 시트가 셀을 자동으로 숫자 타입으로
            // 인식해 리치텍스트/하이퍼링크 정보를 통째로 버림 — 텍스트 서식을 먼저 강제해야 함
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
    // P열(조회수 합계) — 기존 SUM(Q:W) 수식을 대체해 직접 계산한 값을 기록
    sheet.getRange(sheetRow, COL.views + 1).setValue(total || '');
    sheet.getRange(sheetRow, COL.thumbs + 1).setValue(JSON.stringify(thumbs));
  }

  return _json({ success: true, count: savedCount });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── 출처(AH) 값 → 브랜드 시트의 현재 물리 행 찾기 ──
// UUID 기반으로 찾으므로, 그 사이 브랜드 시트에 행이 추가/삭제돼도 항상 정확한 행을 가리킴.
// 아직 migrateToUuidLinks()를 안 돌린 구버전 출처("시트명!행번호")는 행 번호로 폴백.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function _isUuidToken(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s || '');
}

// expectedChannel: 구버전(행 번호 기반) 폴백 경로에서만 사용 — 그 사이 브랜드 시트 행이 밀렸을 수
// 있으므로, 채널명이 실제로 일치하는지 검증하고 다르면 그 연결을 신뢰하지 않음(null 반환). 이게 없으면
// 완전히 다른 인플루언서/모델의 행과 잘못 연결된 걸 그대로 믿고 보여주거나 덮어쓰게 됨.
function _resolveSource(ss, sourceRef, expectedChannel) {
  var s = String(sourceRef || '').trim();
  if (!s) return null;
  var idx = s.lastIndexOf('!');
  if (idx < 0) return null;
  var sheetName = s.slice(0, idx);
  var token = s.slice(idx + 1);
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return null;

  if (_isUuidToken(token)) {
    var data = sheet.getDataRange().getValues();
    for (var i = SCHED_START_ROW; i < data.length; i++) {
      if (String(data[i][SCHED_COL.dealId] || '').trim() === token) {
        return { sheet: sheet, row: i + 1, dealId: token };
      }
    }
    return null; // UUID인데 못 찾음 — 그 사이 삭제됐을 수 있음
  }

  // 구버전 폴백: 순수 행 번호(마이그레이션 전)
  var rowNum = parseInt(token, 10);
  if (isNaN(rowNum) || rowNum <= SCHED_START_ROW || rowNum > sheet.getLastRow()) return null;
  if (expectedChannel) {
    var candidateChannel = String(sheet.getRange(rowNum, SCHED_COL.channel + 1).getValue() || '').trim();
    if (_normChannel(candidateChannel) !== _normChannel(expectedChannel)) return null;
  }
  var existingDealId = String(sheet.getRange(rowNum, SCHED_COL.dealId + 1).getValue() || '').trim();
  return { sheet: sheet, row: rowNum, dealId: existingDealId || null };
}

// 공구건 상세 모달 저장 → 실적통합 해당 행 + 출처로 연결된 브랜드 시트 행에 "바뀐 필드만" 반영.
// data.changes에 있는 키만 쓰고 나머지 열은 그대로 둠(부분 업데이트). 브랜드 시트는 출처(UUID)로
// 다시 찾으므로, 그 사이 다른 행이 삭제/삽입돼서 행 번호가 밀렸어도 정확한 행에 반영됨.
function _updateDeal(ss, data) {
  var sheet = ss.getSheetByName(MAIN_SHEET);
  if (!sheet) return _json({ error: '실적통합 시트를 찾을 수 없습니다.' });

  var row = data.row;
  if (!row || row <= DATA_START_ROW || row > sheet.getLastRow()) {
    return _json({ error: '해당 공구 행을 찾을 수 없습니다. 새로고침 후 다시 시도해주세요.' });
  }
  var brandCell = String(sheet.getRange(row, COL.brand + 1).getValue() || '').trim();
  if (!MINIX_ALIASES[brandCell]) {
    return _json({ error: '해당 행이 더 이상 유효한 공구 행이 아닙니다. 새로고침 후 다시 시도해주세요.' });
  }
  // 브랜드 시트 연결 검증용 — 아래에서 채널명을 바꿔 쓰기 전에, 원래 채널명을 먼저 저장해둠
  var originalChannel = String(sheet.getRange(row, COL.channel + 1).getValue() || '').trim();

  var c = data.changes || {};
  var newStart = c.start !== undefined ? (c.start ? new Date(c.start) : null) : undefined;
  var newEnd   = c.end   !== undefined ? (c.end   ? new Date(c.end)   : null) : undefined;

  var MAIN_SIMPLE_COLS = {
    product: COL.product, channel: COL.channel, platform: COL.platform, vendor: COL.vendor,
    link: COL.link, code: COL.code, format: COL.format, composition: COL.composition
  };
  for (var k in MAIN_SIMPLE_COLS) {
    if (c[k] !== undefined) sheet.getRange(row, MAIN_SIMPLE_COLS[k] + 1).setValue(c[k] || '');
  }
  if (c.targetQty !== undefined) sheet.getRange(row, COL.targetQty + 1).setValue(c.targetQty != null ? c.targetQty : '');
  if (c.qty !== undefined) sheet.getRange(row, COL.qty + 1).setValue(c.qty != null ? c.qty : '');
  if (c.sale !== undefined) sheet.getRange(row, COL.salePrice + 1).setValue(c.sale != null ? c.sale : '');
  if (c.comm !== undefined) sheet.getRange(row, COL.commission + 1).setValue(c.comm != null ? c.comm / 100 : '');
  if (newStart !== undefined) {
    sheet.getRange(row, COL.startMD + 1).setValue(newStart || '');
    if (newStart) sheet.getRange(row, COL.year + 1).setValue(newStart.getFullYear());
  }
  if (newEnd !== undefined) sheet.getRange(row, COL.endMD + 1).setValue(newEnd || '');

  if (c.sale !== undefined || c.qty !== undefined) {
    var revCell = sheet.getRange(row, COL.revenue + 1);
    if (!revCell.getFormula()) {
      var effSale = c.sale !== undefined ? c.sale : _numOrNull(sheet.getRange(row, COL.salePrice + 1).getValue());
      var effQty  = c.qty  !== undefined ? c.qty  : _numOrNull(sheet.getRange(row, COL.qty + 1).getValue());
      if (effSale != null && effQty != null) revCell.setValue(effSale * effQty);
    }
  }

  // 브랜드 시트 쪽도 같이 반영 — 출처(AH)를 UUID로 다시 찾으므로 행 번호가 밀렸어도 안전
  var sourceRef = String(sheet.getRange(row, COL.source + 1).getValue() || '').trim();
  var resolved = sourceRef ? _resolveSource(ss, sourceRef, originalChannel) : null;
  if (resolved) {
    var bs = resolved.sheet, brow = resolved.row;
    var BRAND_SIMPLE_COLS = {
      product: SCHED_COL.product, channel: SCHED_COL.channel, vendor: SCHED_COL.vendor,
      link: SCHED_COL.link, code: SCHED_COL.code, composition: SCHED_COL.composition
    };
    for (var k2 in BRAND_SIMPLE_COLS) {
      if (c[k2] !== undefined) bs.getRange(brow, BRAND_SIMPLE_COLS[k2] + 1).setValue(c[k2] || '');
    }
    if (c.targetQty !== undefined) bs.getRange(brow, SCHED_COL.targetQty + 1).setValue(c.targetQty != null ? c.targetQty : '');
    if (c.sale !== undefined) bs.getRange(brow, SCHED_COL.price + 1).setValue(c.sale != null ? c.sale : '');
    if (c.comm !== undefined) bs.getRange(brow, SCHED_COL.commission + 1).setValue(c.comm != null ? c.comm / 100 : '');

    if (newStart !== undefined || newEnd !== undefined) {
      var curStart = bs.getRange(brow, SCHED_COL.start + 1).getValue();
      var curEnd = bs.getRange(brow, SCHED_COL.end + 1).getValue();
      var finalStart = newStart !== undefined ? newStart : (curStart instanceof Date ? curStart : null);
      var finalEnd = newEnd !== undefined ? newEnd : (curEnd instanceof Date ? curEnd : null);
      if (newStart !== undefined) {
        bs.getRange(brow, SCHED_COL.start + 1).setValue(finalStart || '');
        if (finalStart) {
          bs.getRange(brow, SCHED_COL.year + 1).setValue(finalStart.getFullYear());
          bs.getRange(brow, SCHED_COL.month + 1).setValue(finalStart.getMonth() + 1);
        }
      }
      if (newEnd !== undefined) bs.getRange(brow, SCHED_COL.end + 1).setValue(finalEnd || '');
      if (finalStart && finalEnd) {
        var days = Math.round((finalEnd - finalStart) / 86400000) + 1;
        bs.getRange(brow, SCHED_COL.days + 1).setValue(days + '일');
      }
    }
  } else if (sourceRef) {
    Logger.log('updateDeal 행 ' + row + ': 출처(' + sourceRef + ')에 연결된 브랜드 시트 행을 찾지 못해 실적통합만 반영함');
  }

  return _json({ success: true, brandSynced: !!resolved });
}

// 공구건 삭제 — 실적통합 행 + 출처로 연결된 브랜드 시트 행을 실제로 삭제(하드 삭제).
// 릴스 데이터는 별도 탭이 아니라 실적통합 행 자체(Q~Z 조회수/링크 + AG열 썸네일 JSON)에 들어있어서
// 행을 삭제하면 자동으로 함께 없어짐 — 별도 캐스케이드 삭제가 필요 없음.
// 출처가 UUID 기반이라 브랜드 시트 삭제로 행 번호가 밀려도 다른 행들의 연결이 어긋나지 않음
// (단, 아직 migrateToUuidLinks()를 안 돌려서 구버전 "시트명!행번호" 출처가 남아있는 행이 있다면,
//  그 상태에서 브랜드 시트 행을 삭제하면 그 이후 행들을 가리키던 구버전 출처가 틀어질 수 있음 —
//  삭제 기능을 쓰기 전에 migrateToUuidLinks()를 한 번 실행해서 전부 UUID로 전환해둘 것).
function _deleteDeal(ss, data) {
  var sheet = ss.getSheetByName(MAIN_SHEET);
  if (!sheet) return _json({ error: '실적통합 시트를 찾을 수 없습니다.' });

  var row = data.row;
  if (!row || row <= DATA_START_ROW || row > sheet.getLastRow()) {
    return _json({ error: '해당 공구 행을 찾을 수 없습니다. 새로고침 후 다시 시도해주세요.' });
  }
  var brandCell = String(sheet.getRange(row, COL.brand + 1).getValue() || '').trim();
  if (!MINIX_ALIASES[brandCell]) {
    return _json({ error: '해당 행이 더 이상 유효한 공구 행이 아닙니다. 새로고침 후 다시 시도해주세요.' });
  }

  var expectedChannel = String(sheet.getRange(row, COL.channel + 1).getValue() || '').trim();
  var sourceRef = String(sheet.getRange(row, COL.source + 1).getValue() || '').trim();
  var resolved = sourceRef ? _resolveSource(ss, sourceRef, expectedChannel) : null;

  sheet.deleteRow(row);
  if (resolved) {
    resolved.sheet.deleteRow(resolved.row);
  } else if (sourceRef) {
    Logger.log('deleteDeal 행 ' + row + ': 출처(' + sourceRef + ')에 연결된 브랜드 시트 행을 찾지 못해 실적통합만 삭제됨 — 브랜드 시트는 수동 확인 필요');
  }

  return _json({ success: true, brandDeleted: !!resolved });
}

// 릴스 썸네일 사진 업로드 → 구글 드라이브에 저장 후 공개 보기 링크 반환
// (인스타그램은 썸네일 자동 수집이 불가능해서, 사용자가 직접 캡쳐/선택한 사진을 저장하는 용도)
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

// 1회성 마이그레이션: 출처 연결고리 백필
// 자동 실행되지 않음 — Apps Script 에디터에서 수동으로 한 번 실행하는 용도.
// 출처 열이 생기기 전에 등록된 실적통합 행들은 "출처"가 비어있으므로, 기존 매칭 로직
// (제품명+채널명+시작일, 모호하면 종료일까지 비교)으로 브랜드 시트 위치를 찾아 출처를 채워줌.
// 매칭 실패 건은 실행 로그에 행 번호/제품명/채널명/시작일을 남기니, 그 목록을 보고 시트에서 수동으로 채우면 됨.
function migrateSourceLinks() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MAIN_SHEET);
  if (!sheet) { Logger.log('실적통합 시트를 찾을 수 없습니다.'); return; }

  _ensureExtraHeaders(sheet);

  var scheduleMap = _loadScheduleCodeMap(ss);
  var all = sheet.getDataRange().getValues();

  var success = 0, failed = 0, skipped = 0;
  var failedList = [];

  for (var i = DATA_START_ROW; i < all.length; i++) {
    var row = all[i];
    var product = String(row[COL.product] || '').trim();
    if (!product) continue; // 빈 행/구분용 행

    if (!MINIX_ALIASES[String(row[COL.brand] || '').trim()]) continue; // Minix 전용

    var existingSource = String(row[COL.source] || '').trim();
    if (existingSource) { skipped++; continue; } // 이미 연결된 행은 건드리지 않음

    var channel = String(row[COL.channel] || '').trim();
    var year = _numOrNull(row[COL.year]);
    var startDate = _parseDate(row[COL.startMD], year);
    var endDate = _parseDate(row[COL.endMD], year) || startDate;
    endDate = _fixYearWrap(startDate, endDate);

    var salePrice = _numOrNull(row[COL.salePrice]);
    var commission = _numOrNull(row[COL.commission]);
    if (commission != null && commission <= 1) commission = Math.round(commission * 1000) / 10;

    var match = _matchScheduleCode(scheduleMap, product, channel, startDate, endDate, salePrice, commission);
    // dealId(UUID)가 없으면(migrateToUuidLinks 실행 전) 아직 안전하게 연결할 수 없으므로 미매칭으로 남겨둠
    if (match.matched && match.sheetName && match.dealId) {
      var sourceRef = match.sheetName + '!' + match.dealId;
      sheet.getRange(i + 1, COL.source + 1).setValue(sourceRef);
      // 진짜 중복(합쳐진 매칭)이면 상품코드(AC)는 콤마 나열, 목표수량(AD)은 합산값으로 채움 — 단, 이미 값이 있으면 건드리지 않음
      if (match.merged) {
        var existingCode = String(row[COL.code] || '').trim();
        if (!existingCode && match.code) sheet.getRange(i + 1, COL.code + 1).setValue(match.code);
        var existingTargetQty = _numOrNull(row[COL.targetQty]);
        if (existingTargetQty == null && match.targetQtySum != null) sheet.getRange(i + 1, COL.targetQty + 1).setValue(match.targetQtySum);
      }
      success++;
    } else {
      failed++;
      failedList.push({ row: i + 1, product: product, channel: channel, start: startDate || '' });
      Logger.log('[매칭 실패] 행 ' + (i + 1) + ' 제품=' + product + ' 채널=' + channel + ' 시작일=' + (startDate || ''));
    }
  }

  Logger.log('=== migrateSourceLinks 완료: 성공 ' + success + '건 / 실패 ' + failed + '건 / 이미 연결됨(스킵) ' + skipped + '건 ===');
  Logger.log('실패 목록(JSON): ' + JSON.stringify(failedList));
  return { success: success, failed: failed, skipped: skipped, failedList: failedList };
}

// 1회성 마이그레이션: 브랜드 시트 행에 고유 ID(UUID, V열 "공구ID") 부여 + 실적통합 출처(AH)를
// UUID 기반으로 전환. 자동 실행되지 않음 — Apps Script 에디터에서 수동으로 한 번 실행하는 용도.
//
// ⚠ 공구건 삭제/수정(updateDeal·deleteDeal) 기능을 쓰기 전에 반드시 먼저 실행해야 함.
// 지금까지 출처(AH)는 "시트명!행번호" 형태였는데, 이 상태에서 브랜드 시트 행을 삭제하면
// 그 아래 행들이 한 칸씩 밀리면서 다른 실적통합 행들의 출처가 엉뚱한 행을 가리키게 됨.
// 이 함수를 실행하면 출처가 "시트명!UUID"로 바뀌어서, 이후 어떤 행이 삭제/삽입돼도 안전함.
//
// 여러 번 실행해도 안전(멱등): 이미 공구ID가 있는 행/이미 UUID로 전환된 출처는 건드리지 않음.
function migrateToUuidLinks() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1) 브랜드 시트 3개의 모든 데이터 행에 공구ID(UUID)가 없으면 새로 발급
  var assigned = 0;
  for (var s = 0; s < SCHEDULE_SHEETS.length; s++) {
    var sheet = ss.getSheetByName(SCHEDULE_SHEETS[s]);
    if (!sheet) { Logger.log('브랜드 시트를 찾을 수 없음: ' + SCHEDULE_SHEETS[s]); continue; }
    var lastRow = sheet.getLastRow();
    if (lastRow <= SCHED_START_ROW) continue;
    var rowCount = lastRow - SCHED_START_ROW;
    var idRange = sheet.getRange(SCHED_START_ROW + 1, SCHED_COL.dealId + 1, rowCount, 1);
    var ids = idRange.getValues();
    var sheetAssigned = 0;
    for (var i = 0; i < ids.length; i++) {
      if (!String(ids[i][0] || '').trim()) { ids[i][0] = Utilities.getUuid(); sheetAssigned++; }
    }
    idRange.setValues(ids);
    assigned += sheetAssigned;
    Logger.log(SCHEDULE_SHEETS[s] + ': ' + rowCount + '행 중 신규 공구ID 발급 ' + sheetAssigned + '건');

    // 헤더 라벨 채우고 내부용 열이라 숨김(사람이 보는 화면에는 노출 안 함)
    var headerCell = sheet.getRange(SCHED_START_ROW, SCHED_COL.dealId + 1);
    if (!headerCell.getValue()) headerCell.setValue('공구ID(내부용)');
    try { sheet.hideColumns(SCHED_COL.dealId + 1); } catch (e) { Logger.log('공구ID 열 숨기기 실패 (무시): ' + e); }
  }

  // 2) 실적통합의 구버전 출처("시트명!행번호")를 방금 부여한 공구ID 기반("시트명!UUID")으로 전환
  var mainSheet = ss.getSheetByName(MAIN_SHEET);
  if (!mainSheet) { Logger.log('실적통합 시트를 찾을 수 없습니다.'); return { assigned: assigned }; }
  var all = mainSheet.getDataRange().getValues();
  var converted = 0, alreadyUuid = 0, unresolved = 0;
  var unresolvedList = [];

  for (var r = DATA_START_ROW; r < all.length; r++) {
    var sourceRef = String(all[r][COL.source] || '').trim();
    if (!sourceRef) continue;
    var idx = sourceRef.lastIndexOf('!');
    if (idx < 0) continue;
    var token = sourceRef.slice(idx + 1);
    if (_isUuidToken(token)) { alreadyUuid++; continue; }

    // 행 번호 폴백 경로로 현재 행을 찾되, 채널명이 실제로 일치하는 경우에만 신뢰함 — 그 사이 브랜드
    // 시트 행이 삽입/삭제돼 밀렸다면, 채널명이 다른 엉뚱한(예: 다른 모델) 행을 그대로 "UUID로 확정"
    // 해버려 잘못된 연결을 영구히 고정시킬 수 있기 때문(완료 기준: 이런 행은 반드시 미전환으로 남겨서
    // 사람이 fixBrokenSource()로 직접 확인하게 함).
    var expectedChannel = String(all[r][COL.channel] || '').trim();
    var resolved = _resolveSource(ss, sourceRef, expectedChannel);
    if (resolved && resolved.dealId) {
      var newRef = resolved.sheet.getName() + '!' + resolved.dealId;
      mainSheet.getRange(r + 1, COL.source + 1).setValue(newRef);
      converted++;
    } else {
      unresolved++;
      unresolvedList.push({ row: r + 1, source: sourceRef, channel: expectedChannel });
      Logger.log('[전환 실패] 실적통합 행 ' + (r + 1) + ' 채널=' + expectedChannel + ' 출처=' + sourceRef + ' — 브랜드 시트에서 채널명이 일치하는 해당 행을 찾지 못함(행이 삭제됐거나, 그 사이 밀려서 다른 채널의 행과 연결돼 있었을 수 있음 — fixBrokenSource()로 직접 확인 필요)');
    }
  }

  Logger.log('=== migrateToUuidLinks 완료: 공구ID 신규발급 ' + assigned + '건 / 출처 전환 ' + converted + '건 / 이미 UUID ' + alreadyUuid + '건 / 전환 실패 ' + unresolved + '건 ===');
  if (unresolvedList.length) Logger.log('전환 실패 목록(JSON): ' + JSON.stringify(unresolvedList));
  return { assigned: assigned, converted: converted, alreadyUuid: alreadyUuid, unresolved: unresolved, unresolvedList: unresolvedList };
}

// doGet이 캐시 미스일 때마다 자동으로 호출 — migrateToUuidLinks()를 사람이 Apps Script 에디터에서
// 수동으로 실행해줘야 한다는 전제가 실제로는 지켜지지 않아서(그 사이 브랜드 시트 행이 삽입/삭제되면)
// "품목별 실적 표에서 행을 클릭하면 인접 행의 모달이 열리는" 버그가 재발했음. 매번 전체 스캔하는
// 대신, 완전히 전환 완료된 뒤에는 스크립트 속성에 플래그를 남겨 그 다음부터는 스캔 자체를 건너뜀.
function _autoMigrateLegacyLinks(ss) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('uuidMigrationDone') === 'true') return;
  try {
    var res = migrateToUuidLinks();
    if (res && res.unresolved === 0) props.setProperty('uuidMigrationDone', 'true');
  } catch (e) {
    Logger.log('_autoMigrateLegacyLinks 실패 (무시하고 기존 방식으로 계속 진행): ' + e);
  }
}

// 1회성 진단용: migrateToUuidLinks에서 전환 실패한 실적통합 행(출처가 존재하지 않는 브랜드 시트 행을
// 가리킴)의 실제 내용과, 같은 채널명을 가진 브랜드 시트 후보들을 나란히 보여줌.
// 로그를 보고 어느 후보가 맞는지 사람이 판단한 뒤, fixBrokenSource()로 직접 연결해주면 됨.
// Apps Script 에디터의 "실행" 버튼은 인자를 못 넘기므로, 대상 행 번호는 아래 ROW에서 직접 수정.
function debugBrokenSource() {
  var ROW = 349;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MAIN_SHEET);
  var all = sheet.getDataRange().getValues();
  var row = ROW;
  var r = all[row - 1];
  if (!r) { Logger.log('실적통합 행 ' + row + ': 존재하지 않음'); return; }

  var product = String(r[COL.product] || '').trim();
  var channel = String(r[COL.channel] || '').trim();
  var year = _numOrNull(r[COL.year]);
  var startDate = _parseDate(r[COL.startMD], year);
  var endDate = _parseDate(r[COL.endMD], year) || startDate;
  endDate = _fixYearWrap(startDate, endDate);
  var salePrice = _numOrNull(r[COL.salePrice]);
  var commission = _numOrNull(r[COL.commission]);
  if (commission != null && commission <= 1) commission = Math.round(commission * 1000) / 10;
  var brokenSource = String(r[COL.source] || '').trim();

  Logger.log('실적통합 행 ' + row + ': 제품="' + product + '" 채널="' + channel + '" 시작일=' + startDate + ' 종료일=' + endDate +
    ' 공구가=' + salePrice + ' 수수료율=' + commission + '% 현재(끊긴) 출처=' + brokenSource);

  var normCh = _normChannel(channel);
  var candidates = [];
  for (var s = 0; s < SCHEDULE_SHEETS.length; s++) {
    var bs = ss.getSheetByName(SCHEDULE_SHEETS[s]);
    if (!bs) continue;
    var data = bs.getDataRange().getValues();
    for (var i = SCHED_START_ROW; i < data.length; i++) {
      var brow = data[i];
      if (_normChannel(brow[SCHED_COL.channel]) !== normCh) continue;
      candidates.push({
        sheetName: SCHEDULE_SHEETS[s], row: i + 1,
        product: brow[SCHED_COL.product], channel: brow[SCHED_COL.channel],
        start: _cellToMD(brow[SCHED_COL.start]), end: _cellToMD(brow[SCHED_COL.end]),
        price: brow[SCHED_COL.price], commission: brow[SCHED_COL.commission],
        dealId: String(brow[SCHED_COL.dealId] || '').trim()
      });
    }
  }
  Logger.log('채널명 "' + channel + '" 기준 브랜드 시트 후보(' + candidates.length + '건): ' + JSON.stringify(candidates));
}

// debugBrokenSource()로 정답 후보를 확인한 뒤, 실적통합 행의 출처를 해당 브랜드 시트 행으로 직접 연결.
// sheetName은 SCHEDULE_SHEETS에 있는 정확한 이름("1) 더 플렌더" 등), brandRow는 그 시트의 물리 행 번호.
function fixBrokenSource(mainRow, sheetName, brandRow) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var mainSheet = ss.getSheetByName(MAIN_SHEET);
  var bs = ss.getSheetByName(sheetName);
  if (!bs) { Logger.log('브랜드 시트를 찾을 수 없음: ' + sheetName); return; }
  var dealId = String(bs.getRange(brandRow, SCHED_COL.dealId + 1).getValue() || '').trim();
  if (!dealId) { Logger.log(sheetName + ' ' + brandRow + '행에 공구ID가 없습니다. migrateToUuidLinks()를 먼저 실행하세요.'); return; }
  var newRef = sheetName + '!' + dealId;
  mainSheet.getRange(mainRow, COL.source + 1).setValue(newRef);
  Logger.log('실적통합 행 ' + mainRow + ' 출처를 "' + newRef + '"로 갱신했습니다.');
}

// fixBrokenSource도 인자가 있어 에디터 "실행" 버튼으로 못 돌리므로, 이번 건(행 349)만 값을 박아서 실행하는 래퍼.
// 실행 후에는 지워도 되고 남겨둬도 무해함(다시 실행해도 같은 값으로 덮어쓸 뿐).
function fixRow349() {
  fixBrokenSource(349, '1) 더 플렌더', 257);
}

// 1회성 진단용: migrateSourceLinks에서 매칭 실패한 특정 행들을 골라, 왜 실패했는지 구체적으로 보여줌.
// - 후보 0개: 브랜드 시트에 해당 채널명이 아예 없음 (날짜가 달라도 채널명만 맞으면 잡아서 보여줌)
// - 후보 1개 이상인데 매칭 실패: 종료일(MM-DD)이 달라서 좁혀지지 않은 경우 → 그 후보의 실제 값을 비교해서 보여줌
// 실행 후 로그(실행 → 실행 로그)를 그대로 복사해서 확인하면 됨. 대상 행 번호는 아래 TARGET_ROWS에서 수정.
function debugScheduleMatchFailures() {
  var TARGET_ROWS = [266, 276, 279, 280, 289, 314, 318, 348];

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MAIN_SHEET);
  if (!sheet) { Logger.log('실적통합 시트를 찾을 수 없습니다.'); return; }

  var scheduleMap = _loadScheduleCodeMap(ss);
  var all = sheet.getDataRange().getValues();

  for (var t = 0; t < TARGET_ROWS.length; t++) {
    var rowNum = TARGET_ROWS[t];
    var row = all[rowNum - 1];
    if (!row) { Logger.log('행 ' + rowNum + ': 실적통합 시트에 존재하지 않음'); continue; }

    var product = String(row[COL.product] || '').trim();
    var channel = String(row[COL.channel] || '').trim();
    var year = _numOrNull(row[COL.year]);
    var startDate = _parseDate(row[COL.startMD], year);
    var endDate = _parseDate(row[COL.endMD], year) || startDate;
    endDate = _fixYearWrap(startDate, endDate);

    var sMD = startDate ? startDate.slice(5) : null;
    var productKey = _scheduleProductKey(product);
    var normCh = _normChannel(channel);
    var exactKey = productKey + '__' + normCh + '__' + sMD;
    var exactCandidates = scheduleMap[exactKey] || [];

    Logger.log('──── 행 ' + rowNum + ' ────');
    Logger.log('제품="' + product + '" → productKey="' + productKey + '" / 채널="' + channel + '" → normChannel="' + normCh + '" / 시작일=' + startDate + '(MD=' + sMD + ') 종료일=' + endDate);
    Logger.log('정확 키="' + exactKey + '" 후보수=' + exactCandidates.length);
    if (exactCandidates.length > 0) {
      Logger.log('후보 상세: ' + JSON.stringify(exactCandidates));
    }

    // 채널명만 일치하는 근처 후보(제품/날짜 무시)를 스캔 — 표기 차이나 날짜 오입력 여부 확인용
    var nearMatches = [];
    for (var key in scheduleMap) {
      if (key.indexOf('__' + normCh + '__') >= 0) {
        nearMatches.push({ key: key, candidates: scheduleMap[key] });
      }
    }
    Logger.log('채널명 "' + normCh + '" 기준 근처 후보(' + nearMatches.length + '건): ' + JSON.stringify(nearMatches));
  }
}

function _normProd(s) {
  return String(s || '').replace(/[\s ]/g, '').toLowerCase();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── 권한 승인용 (에디터에서 직접 실행) ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Apps Script 에디터에서 이 함수를 한 번 실행하면 Drive 권한 승인 창이 뜸
function authorizeDrive() {
  var folders = DriveApp.getFoldersByName("테스트");
  Logger.log("드라이브 권한 OK");
}

// 337행(이제이쿡)에 릴스 1건을 저장하는 실제 doPost 흐름(_saveReels)을 그대로 실행 —
// Cloud 로그가 꺼져있어도 에디터에서 직접 실행하면 하단 "실행 로그" 창에 Logger.log가 바로 찍힘.
// _saveReels 내부의 [릴스 Q~Z 사전확인]/[릴스 Q~Z 보호범위 확인]/[릴스 슬롯 검증] 로그로
// Q~Z만 저장 안 되는 원인(기존 수식/보호범위/쓰기 자체 실패 여부)을 확인하기 위한 테스트
function testReelsSave() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var testData = {
    row: 337,
    product: '더 플렌더 MAX',
    channel: '이제이쿡',
    link: 'https://www.instagram.com/ej_cook_/',
    reels: [
      {
        url: 'https://www.instagram.com/reel/TEST_REEL_ID/',
        views: 7.8,
        thumb: 'https://drive.google.com/thumbnail?id=1VF4bq3mf5WEVyXE6dRQskpoxiIt3bVN1&sz=w400'
      }
    ]
  };

  Logger.log('=== testReelsSave 시작: row=' + testData.row + ' product=' + testData.product + ' channel=' + testData.channel + ' ===');
  var result = _saveReels(ss, testData);
  Logger.log('=== testReelsSave 응답: ' + result.getContent() + ' ===');

  // 저장 직후 실제로 시트에 반영됐는지 doGet과 같은 방식으로 한 번 더 확인
  var sheet = ss.getSheetByName(MAIN_SHEET);
  var verify = _debugReelsRaw(sheet, testData.row);
  Logger.log('=== testReelsSave 저장 후 시트 상태: ' + JSON.stringify(verify) + ' ===');
}
