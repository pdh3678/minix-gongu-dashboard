/**
 * 미닉스 공동구매 자동화 대시보드 — Google Apps Script 연동 코드
 * 데이터 소스: "앳홈 공동구매 총괄 시트" → 실적통합 탭 (한 행 = 공구 1건, 미닉스+톰+기타 브랜드 혼재 → 미닉스만 필터링)
 *
 * ★ 배포 방법 (반드시 "앳홈 공동구매 총괄 시트"에서 배포):
 * 1. 해당 스프레드시트 → 확장 프로그램 → Apps Script
 * 2. 이 파일 내용 전체 붙여넣기 후 저장
 * 3. 배포 → 기존 배포 관리 → 새 버전으로 배포 (URL 유지)
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── CONFIGURATION ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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
  // Q~V열은 회차별 개별 조회수(하이퍼링크 포함)이므로 사용하지 않음
  views:      15,  // P
};

// 접근 제어
var REQUIRE_AUTH   = true;
var ALLOWED_DOMAIN = 'athomecorp.com';

// 이 대시보드는 Minix 전용입니다 — 브랜드열 값이 아래 목록에 없으면 해당 행은 제외됩니다
// (톰/프로티원 등 타 브랜드 행은 자동으로 걸러집니다)
var MINIX_ALIASES = { '미닉스': true, 'minix': true, 'Minix': true, 'MINIX': true };

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
  try {
    var idToken = (e && e.parameter) ? (e.parameter.idToken || '') : '';
    if (!_verifyAuth(idToken)) return _json({ error: 'AUTH_REQUIRED' });

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

    var purchases = parseMainSheet(sheet);
    purchases.forEach(function(p, idx) { p.id = idx + 1; });

    return _json({ purchases: purchases, updatedAt: new Date().toISOString() });
  } catch (err) {
    return _json({ error: err.toString(), purchases: [] });
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── 메인 시트 파싱 (한 행 = 공구 1건) ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

    // 조회수: P열(고정 인덱스) 값 그대로 사용 — 이미 "만" 단위 (예: 3.4 = 3.4만회). Q~V열(회차별)은 사용하지 않음
    var views = _numOrNull(row[COL.views]);
    if (views === 0) views = null; // 0/빈값은 프론트에서 "—"로 표시

    // 날짜 생성: L/M열은 보통 실제 날짜 셀(Date)이며, 드물게 "M/D" 텍스트 + K(연도)로 입력된 경우도 처리
    var startDate = _parseDate(startCell, year);
    var endDate   = _parseDate(endCell, year) || startDate;

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

    deals.push({
      id:         0,
      brand:      'Minix',
      product:    product,
      channel:    channel,
      influencer: channel,
      vendor:     vendor,
      platform:   platform,
      format:     format,
      start:      startDate || '',
      end:        endDate   || '',
      targetQty:  null,
      status:     status,
      views:      views,
      qty:        qty,
      revenue:    revenue,
      code:       '',
      retail:     null,
      sale:       salePrice,
      commission: commission,
      openTime:   '',
      note:       '',
    });
  }

  Logger.log('파싱 완료: ' + deals.length + '건 / 시트: ' + sheet.getName());
  return deals;
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── doPost: 공구 추가 / 실적 기입 ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var idToken = body.idToken || (e.parameter ? e.parameter.idToken : '') || '';
    if (!_verifyAuth(idToken)) return _json({ error: 'AUTH_REQUIRED' });
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (body.action === 'addDeal') return _addDeal(ss, body.data);
    if (body.action === 'addPerf') return _addPerf(ss, body.data);
    throw new Error('Unknown action: ' + body.action);
  } catch (err) {
    return _json({ error: err.toString() });
  }
}

// 새 공구건 추가 → 공구목록 시트에 기록
function _addDeal(ss, data) {
  var sheetName = '공구목록';
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(['브랜드','제품명','채널명','채널ID','벤더사','플랫폼','링크',
      '시작일','종료일','오픈시간','상품코드','공동구매가','수수료율',
      '구성','추가옵션1','추가옵션2','선착순이벤트','목표수량','상태','비고']);
  }
  var scheme = data.s || {};
  sheet.appendRow([
    data.brand||'', data.product||'', data.influencer||'', data.chId||'', data.vendor||'',
    data.platform||'', data.link||'', data.start||'', data.end||'',
    data.openTime||'', data.code||'', scheme.sale||'', scheme.comm||'',
    data.composition||'', data.option1||'', data.option2||'',
    data.firstCome||'', data.targetQty||'', data.status||'예정', scheme.note||''
  ]);
  return _json({ success: true });
}

// 실적 기입 → 실적통합 시트 해당 행 업데이트
function _addPerf(ss, data) {
  var sheet = ss.getSheetByName(MAIN_SHEET);
  if (!sheet) return _json({ error: '실적통합 시트를 찾을 수 없습니다.' });

  var all = sheet.getDataRange().getValues();
  var normTarget = _normProd(data.product || '') + '__' + _normProd(data.channel || '');

  var rowIdx = -1;
  for (var i = DATA_START_ROW; i < all.length; i++) {
    var np = _normProd(String(all[i][COL.product] || ''));
    var nc = _normProd(String(all[i][COL.channel] || ''));
    if (np + '__' + nc === normTarget) { rowIdx = i; break; }
  }

  if (rowIdx < 0) return _json({ error: '일치하는 공구 행을 찾을 수 없습니다.' });

  var sheetRow = rowIdx + 1; // 1-based
  if (data.qty     != null) sheet.getRange(sheetRow, COL.qty     + 1).setValue(data.qty);
  if (data.revenue != null) sheet.getRange(sheetRow, COL.revenue + 1).setValue(data.revenue);
  if (data.views   != null) sheet.getRange(sheetRow, COL.views   + 1).setValue(data.views);

  return _json({ success: true });
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

function _normProd(s) {
  return String(s || '').replace(/[\s ]/g, '').toLowerCase();
}
