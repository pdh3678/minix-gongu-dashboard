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
  // Q~Z열은 릴스별 개별 조회수+링크(하이퍼링크) — 모달의 "릴스 관리"에서 읽고 씀 (REEL_COL_START 참고)
  views:      15,  // P
  // AC/AD/AE: 대시보드에서 새로 추가한 열 (원본 시트엔 없던 컬럼 — "새 공구건 등록" 폼용)
  code:        28,  // AC: 상품코드
  targetQty:   29,  // AD: 목표수량
  composition: 30,  // AE: 구성
  link:        31,  // AF: 채널 링크 (모달에서 직접 수정)
  thumbs:      32,  // AG: 릴스별 썸네일 URL 목록 (JSON 배열, Q~Z 순서와 매칭)
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

    var result = parseMainSheet(sheet, ss);
    result.deals.forEach(function(p, idx) { p.id = idx + 1; });

    return _json({ purchases: result.deals, updatedAt: new Date().toISOString(), codeMatchStats: result.codeStats });
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
// ── 브랜드별 일정 시트 → 상품코드 매칭 ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 실적통합엔 상품코드 컬럼이 없어서, 브랜드별 일정 시트(구조 동일: 3행 헤더, 4행부터 데이터)에서
// 채널명(인플루언서)+시작일(월/일)로 매칭해 가져옴. 셋 다 열 구조가 같음:
// A연도 B월 C브랜드 D제품명 E인플루언서 F벤더사 G링크 H상품코드 I상태 J시작일 K마감일 ...
var SCHEDULE_SHEETS = ['1) 더 플렌더', '2) 더 시프트  더 슬림', '3) 더 에어드라이'];
var SCHED_COL = { product: 3, channel: 4, code: 7, start: 9, end: 10 };
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

// 브랜드별 일정 시트 3개를 훑어서 { productKey__채널__MM-DD(시작일) : [{code, endMD, link}] } 맵으로 만듦
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
      map[key].push({ code: code, endMD: endMD, link: profileLink });
    }
  }
  return map;
}

// 실적통합 한 행에 대해 상품코드+프로필 링크를 찾음. 후보가 여러 개면 종료일(월/일)까지 비교해 좁힘
function _matchScheduleCode(scheduleMap, product, channel, startDate, endDate) {
  if (!scheduleMap || !startDate) return { code: '', matched: false, link: '' };
  var sMD = startDate.slice(5);
  var key = _scheduleMatchKey(product, channel, sMD);
  var candidates = scheduleMap[key] || [];
  if (candidates.length === 1) return { code: candidates[0].code, matched: true, link: candidates[0].link || '' };
  if (candidates.length > 1) {
    var eMD = (endDate || startDate).slice(5);
    var narrowed = candidates.filter(function (c) { return c.endMD === eMD; });
    if (narrowed.length === 1) return { code: narrowed[0].code, matched: true, link: narrowed[0].link || '' };
  }
  return { code: '', matched: false, link: '' };
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

    // 상품코드: 우리가 새로 추가한 AC열에 값이 있으면 그걸 우선 사용하고,
    // 없으면 브랜드별 일정 시트에서 채널명+시작일(월/일)로 매칭 (모호하면 종료일까지 비교)
    // 인플루언서 프로필 링크도 같은 매칭 결과에서 가져옴 (상품코드 보유 여부와 무관하게 항상 시도)
    var code = String(row[COL.code] || '').trim();
    var schedMatch = _matchScheduleCode(scheduleMap, product, channel, startDate, endDate);
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

    deals.push({
      id:         0,
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
      targetQty:  _numOrNull(row[COL.targetQty]),
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── doPost: 공구 추가 / 실적 기입 ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var idToken = body.idToken || (e.parameter ? e.parameter.idToken : '') || '';
    if (!_verifyAuth(idToken)) return _json({ error: 'AUTH_REQUIRED' });
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (body.action === 'addSalesRow') return _addSalesRow(ss, body.data);
    if (body.action === 'addPerf') return _addPerf(ss, body.data);
    if (body.action === 'addCalendarRow') return _addCalendarRow(ss, body.data);
    if (body.action === 'saveReels') return _saveReels(ss, body.data);
    if (body.action === 'updateScheme') return _updateScheme(ss, body.data);
    if (body.action === 'uploadThumbnail') return _uploadThumbnail(body.data);
    throw new Error('Unknown action: ' + body.action);
  } catch (err) {
    return _json({ error: err.toString() });
  }
}

// 새 공구건 등록 → 실적통합 시트에 새 행 추가 (브랜드별 실적 표에 쓰이는 필드 전부 채움)
function _addSalesRow(ss, data) {
  var sheet = ss.getSheetByName(MAIN_SHEET);
  if (!sheet) return _json({ error: '실적통합 시트를 찾을 수 없습니다.' });

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
  for (var i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';

  sheet.appendRow(row);
  return _json({ success: true });
}

// 대시보드에서 새로 쓰는 AC~AG열에 헤더가 없으면 채워줌 (원본 시트엔 없던 컬럼이라 최초 1회만 필요)
function _ensureExtraHeaders(sheet) {
  var headers = [
    [COL.code, '상품코드'],
    [COL.targetQty, '목표수량'],
    [COL.composition, '구성'],
    [COL.link, '채널 링크'],
    [COL.thumbs, '릴스 썸네일(JSON)']
  ];
  for (var i = 0; i < headers.length; i++) {
    var cell = sheet.getRange(2, headers[i][0] + 1);
    if (!cell.getValue()) cell.setValue(headers[i][1]);
  }
}

// 공구 캘린더 "+ 행 추가" → 실적통합 시트에 새 행 추가
// (브랜드/제품명/채널명/시작일/종료일/판매수량만 채우고 나머지는 비워둠 — 이후 실적 기입으로 보완)
function _addCalendarRow(ss, data) {
  var sheet = ss.getSheetByName(MAIN_SHEET);
  if (!sheet) return _json({ error: '실적통합 시트를 찾을 수 없습니다.' });

  var startDate = data.start ? new Date(data.start) : null;
  var endDate   = data.end   ? new Date(data.end)   : startDate;
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var status = '예정';
  if (endDate && endDate < today) status = '완료';
  else if (startDate && startDate <= today) status = '진행중';

  var row = [];
  row[COL.brand]   = '미닉스';
  row[COL.product] = data.product || '';
  row[COL.channel] = data.channel || '';
  row[COL.qty]     = data.qty != null ? data.qty : '';
  row[COL.year]    = startDate ? startDate.getFullYear() : '';
  row[COL.startMD] = startDate || '';
  row[COL.endMD]   = endDate   || '';
  row[COL.status]  = status;
  for (var i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';

  sheet.appendRow(row);
  return _json({ success: true });
}

// 제품명+채널명으로 실적통합 시트에서 일치하는 행을 찾음 (0-based 행 인덱스, 못 찾으면 -1)
function _findDataRow(all, product, channel) {
  var normTarget = _normProd(product || '') + '__' + _normProd(channel || '');
  for (var i = DATA_START_ROW; i < all.length; i++) {
    var np = _normProd(String(all[i][COL.product] || ''));
    var nc = _normProd(String(all[i][COL.channel] || ''));
    if (np + '__' + nc === normTarget) return i;
  }
  return -1;
}

// 실적 기입 → 실적통합 시트 해당 행 업데이트
function _addPerf(ss, data) {
  var sheet = ss.getSheetByName(MAIN_SHEET);
  if (!sheet) return _json({ error: '실적통합 시트를 찾을 수 없습니다.' });

  var all = sheet.getDataRange().getValues();
  var rowIdx = _findDataRow(all, data.product, data.channel);
  if (rowIdx < 0) return _json({ error: '일치하는 공구 행을 찾을 수 없습니다.' });

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
  var rowIdx = _findDataRow(all, data.product, data.channel);
  if (rowIdx < 0) return _json({ error: '일치하는 공구 행을 찾을 수 없습니다.' });
  var sheetRow = rowIdx + 1; // 1-based

  sheet.getRange(sheetRow, COL.link + 1).setValue(data.link || '');

  // data.reels가 배열로 명시된 경우에만 Q~Z/P/썸네일을 갱신함
  // (원래 릴스가 없던 건에서 링크만 고치고 저장한 경우 기존 조회수 데이터를 실수로 지우지 않기 위함)
  if (data.reels != null) {
    var reels = data.reels;
    var thumbs = [];
    var total = 0;
    for (var i = 0; i < REEL_SLOT_COUNT; i++) {
      var cell = sheet.getRange(sheetRow, REEL_COL_START + i);
      var r = reels[i];
      if (r && (r.url || r.views != null)) {
        var text = r.views != null ? String(r.views) : ' ';
        if (r.url) {
          cell.setRichTextValue(SpreadsheetApp.newRichTextValue().setText(text).setLinkUrl(r.url).build());
        } else {
          cell.setValue(r.views != null ? r.views : '');
        }
        if (r.views != null) total += Number(r.views);
        thumbs.push(r.thumb || '');
      } else {
        cell.setValue('');
        thumbs.push('');
      }
    }
    // P열(조회수 합계) — 기존 SUM(Q:W) 수식을 대체해 직접 계산한 값을 기록
    sheet.getRange(sheetRow, COL.views + 1).setValue(total || '');
    sheet.getRange(sheetRow, COL.thumbs + 1).setValue(JSON.stringify(thumbs));
  }

  return _json({ success: true });
}

// 품목별 실적 모달(스킴 편집)에서 공동구매가(G)/판매수량(H)/수수료(J)/상품코드(AC)를 저장
// 총매출(I)은 수식이 있는 행이면 건드리지 않고, 값 행이면 공구가×판매수량으로 재계산해 기록
function _updateScheme(ss, data) {
  var sheet = ss.getSheetByName(MAIN_SHEET);
  if (!sheet) return _json({ error: '실적통합 시트를 찾을 수 없습니다.' });

  var all = sheet.getDataRange().getValues();
  var rowIdx = _findDataRow(all, data.product, data.channel);
  if (rowIdx < 0) return _json({ error: '일치하는 공구 행을 찾을 수 없습니다.' });
  var sheetRow = rowIdx + 1; // 1-based

  if (data.sale != null) sheet.getRange(sheetRow, COL.salePrice + 1).setValue(data.sale);
  if (data.qty != null) sheet.getRange(sheetRow, COL.qty + 1).setValue(data.qty);
  if (data.comm != null) sheet.getRange(sheetRow, COL.commission + 1).setValue(data.comm / 100);
  if (data.code != null) sheet.getRange(sheetRow, COL.code + 1).setValue(data.code);

  var revCell = sheet.getRange(sheetRow, COL.revenue + 1);
  if (!revCell.getFormula()) {
    var effSale = data.sale != null ? data.sale : _numOrNull(all[rowIdx][COL.salePrice]);
    var effQty = data.qty != null ? data.qty : _numOrNull(all[rowIdx][COL.qty]);
    if (effSale != null && effQty != null) revCell.setValue(effSale * effQty);
  }

  return _json({ success: true });
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
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var url = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w400';
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

function _normProd(s) {
  return String(s || '').replace(/[\s ]/g, '').toLowerCase();
}
