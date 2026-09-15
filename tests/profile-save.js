/* 저장 경로 성능 프로파일러 — 테스트가 아니라 **측정 도구**다(run-all에 포함되지 않음).

   Apps Script가 느린 이유는 거의 전부 "Sheets API 왕복 개수와 읽는 셀 수"라서, 벽시계 대신
   이 둘을 센다. 실제 스프레드시트 없이도 재현 가능하고, 구조를 바꾸면 즉시 숫자로 나타난다.

   실행:  node tests/profile-save.js [행수]     기본 370행(2026-09 운영 규모)

   ⚠ 아래 BEFORE는 2026-09-15 최적화 **이전** 코드(커밋 9b48305)를 같은 프로파일러로 잰 실측값이다.
     기록용 상수이며 지금 코드에서 재계산되지 않는다 — 구조를 또 바꾸면 그때 다시 재서 갱신할 것. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { makeSheet, installGlobals, STATS, resetStats } = require(path.join(__dirname, 'lib', 'mock-sheets.js'));
const HEADERS = require(path.join(__dirname, 'lib', 'real-headers.js'));

const GAS_PATH = path.join(__dirname, '..', 'apps-script.js');
const DATA_ROWS = Number(process.argv[2] || 370);

const C = { brand:1, product:2, channel:4, platform:5, salesTier:6, followerTier:7, code:9,
  salePrice:10, qty:11, revenue:12, year:14, startMD:15, endMD:16, status:17,
  dealId:44, codeSeq:45, followers:55 };

function buildSheet(){
  const grid = [new Array(HEADERS.length).fill(''), HEADERS.slice()];
  for (let i = 0; i < DATA_ROWS; i++) {
    const r = new Array(HEADERS.length).fill('');
    r[C.brand]='미닉스'; r[C.product]='더 플렌더'; r[C.channel]='채널'+(i%60); r[C.platform]='인스타';
    r[C.code]='CODE'+i; r[C.salePrice]=100000; r[C.qty]=100+i;
    r[C.revenue]='=L'+(i+3)+'*K'+(i+3); r[C.year]=2026;
    r[C.startMD]='2026-0'+(1+(i%9))+'-10'; r[C.endMD]='2026-0'+(1+(i%9))+'-15'; r[C.status]='완료';
    r[C.dealId]='DEAL'+i; r[C.codeSeq]=1;
    if (i % 3 === 0) r[C.followers] = 50000 + i * 1000;
    grid.push(r);
  }
  return makeSheet('실적통합', grid);
}
function load(sheet, cacheStore){
  installGlobals({ '실적통합': sheet }, { cacheStore });
  const ctx = vm.createContext(global);
  vm.runInContext(fs.readFileSync(GAS_PATH, 'utf8'), ctx, { filename: 'apps-script.js' });
  return ctx;
}
function act(ctx, action, payload){
  return JSON.parse(ctx._handleWriteAction({ parameter: { action, payload: JSON.stringify(payload) } }, ''));
}
function measure(fn){ resetStats(); const r = fn(); return { r, s: { reads:STATS.reads, readCells:STATS.readCells, writes:STATS.writes, http:1 } }; }

const TIERS = { salesTier:'마이크로', followerTier:'나노' };
const now = {};

{ // 수정 저장 (콜드: dealId 행 맵 캐시 없음 / 웜: 같은 캐시 재사용)
  const sheet = buildSheet(), cache = {};
  const ctx = load(sheet, cache);
  now.update = measure(() => act(ctx, 'updateDeal',
    { dealId:'DEAL200', changes:{ product:'더 플렌더 mini', platform:'틱톡', note:'NPAY 5만원' }, tiers:TIERS })).s;
  const ctx2 = load(sheet, cache);
  now.updateWarm = measure(() => act(ctx2, 'updateDeal', { dealId:'DEAL201', changes:{ note:'NPAY 3만원' }, tiers:TIERS })).s;
  now.formulaKept = String(sheet._grid[203][C.revenue]).charAt(0) === '=';
  now.tierWritten = sheet._grid[202][C.salesTier] === '마이크로';
}
{ // 신규 등록
  const sheet = buildSheet(), cache = {};
  const ctx = load(sheet, cache);
  const m = measure(() => act(ctx, 'addSalesRow',
    { product:'더 시프트', ch:'채널1', platform:'유튜브', codes:['N1'], s:{ sale:70000, comm:30 },
      start:'2026-09-15', end:'2026-09-20', status:'예정', tiers:TIERS }));
  now.add = m.s;
  const nr = sheet._grid[m.r.rowIndex - 1];
  now.addTierWritten = nr[C.salesTier] === '마이크로' && nr[C.followerTier] === '나노';
}
{ // 캐시 부분 갱신이 실제로 동작하는지 / 파생값 변경 시 안전하게 전체 무효화로 떨어지는지
  const sheet = buildSheet(), cache = {};
  const ctx = load(sheet, cache);
  ctx._resolveCols(sheet);
  const cs = ctx.CacheService.getScriptCache();
  ctx._cachePutJSON(cs, ctx._dashboardCacheKey(), { purchases: ctx.parseMainSheet(sheet).deals, calendarEvents: [] }, 60);
  act(ctx, 'updateDeal', { dealId:'DEAL200', changes:{ product:'더 플렌더 mini', note:'NPAY 5만원' }, tiers:TIERS });
  const after = ctx._cacheGetJSON(cs, ctx._dashboardCacheKey());
  now.cachePatched = !!(after && after.purchases.find(x => x.dealId === 'DEAL200').product === '더 플렌더 mini');

  const sheet2 = buildSheet(), cache2 = {};
  const ctx2 = load(sheet2, cache2);
  ctx2._resolveCols(sheet2);
  const cs2 = ctx2.CacheService.getScriptCache();
  ctx2._cachePutJSON(cs2, ctx2._dashboardCacheKey(), { purchases: ctx2.parseMainSheet(sheet2).deals, calendarEvents: [] }, 60);
  act(ctx2, 'updateDeal', { dealId:'DEAL200', changes:{ sale:88000 }, tiers:TIERS });
  now.cacheInvalidatedOnDerived = ctx2._cacheGetJSON(cs2, ctx2._dashboardCacheKey()) === null;
}

// 2026-09-15 최적화 이전(커밋 9b48305) 실측값 — 저장 액션 + 저장 후 전체 재조회 + writeTiers 합계
const BEFORE = {
  update: { http:3, reads:10, readCells:66995, writes:7 },
  add:    { http:3, reads:11, readCells:46534, writes:14 }
};
const pct = (b, a) => (b === 0 ? '—' : (a <= b ? '-' : '+') + Math.round(Math.abs(1 - a / b) * 100) + '%');
const LABEL = { http:'HTTP 왕복(회)', reads:'읽기 RPC(회)', readCells:'읽은 셀(개)', writes:'쓰기 RPC(회)' };
function table(title, before, after) {
  console.log('\n■ ' + title);
  console.log('지표'.padEnd(20) + '개선전'.padStart(10) + '현재'.padStart(10) + '변화'.padStart(10));
  console.log('-'.repeat(50));
  ['http','reads','readCells','writes'].forEach(k => {
    console.log(LABEL[k].padEnd(20) + String(before[k]).padStart(10) + String(after[k]).padStart(10) + pct(before[k], after[k]).padStart(10));
  });
}

console.log('측정 조건: 데이터 ' + DATA_ROWS + '행 × ' + HEADERS.length + '열');
table('수정 저장 (모달 저장 클릭 → 완료)', BEFORE.update, now.update);
table('신규 등록', BEFORE.add, now.add);
console.log('\n■ 부가 확인');
console.log('  dealId 행 맵 캐시 적중 시 읽은 셀 : ' + now.updateWarm.readCells + ' (콜드 ' + now.update.readCells + ')');
console.log('  총매출 수식 보존                 : ' + (now.formulaKept ? 'OK' : '깨짐!'));
console.log('  등급 G·H 같은 실행에서 기록      : ' + (now.tierWritten ? 'OK' : '안됨!') + ' / 신규 등록 ' + (now.addTierWritten ? 'OK' : '안됨!'));
console.log('  캐시 부분 갱신(안전한 변경)      : ' + (now.cachePatched ? 'OK — 캐시 유지하고 그 건만 교체' : '실패'));
console.log('  파생값 변경 시 전체 무효화       : ' + (now.cacheInvalidatedOnDerived ? 'OK — 안전 쪽으로 떨어짐' : '안 떨어짐!'));
