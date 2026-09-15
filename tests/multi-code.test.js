/* 다중 상품코드 — "한 공구건이 상품코드 수만큼 행을 차지한다"는 기존 구조를 고정한다.

   구조 요약(공구그룹ID 없이 원래부터 있던 방식):
     · 같은 공구건의 행들은 dealId가 같고, 코드순번(codeSeq)이 1..n 으로 들어간다
     · 코드순번 1이 대표 행 — 실적(판매수량·총매출·조회수)과 조건 값은 대표 행에만 둔다
     · 공통 필드(브랜드·제품·채널·벤더·등급)는 그룹의 모든 행에 같은 값으로 미러링한다
     · 상품코드를 늘리면 행이 늘고, 줄이면 초과 행이 삭제된다

   여기서 검증하는 건 "그 구조대로 실제로 쓰는가"다. 공구그룹ID를 되돌린 뒤 이 구조가
   유일한 다중 코드 표현이 되었으므로, 깨지면 러브지나·하늘마켓 같은 건이 다시 저장 불가가 된다.

   실행: node tests/multi-code.test.js  (또는 node tests/run-all.js) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { makeSheet, installGlobals } = require(path.join(__dirname, 'lib', 'mock-sheets.js'));
const GAS_PATH = process.argv[2] || path.join(__dirname, '..', 'apps-script.js');
const HEADERS = require(path.join(__dirname, 'lib', 'real-headers.js'));

const C = { brand: 1, product: 2, vendor: 3, channel: 4, platform: 5, salesTier: 6, followerTier: 7,
  code: 9, salePrice: 10, qty: 11, revenue: 12, commission: 13, year: 14,
  startMD: 15, endMD: 16, status: 17, targetQty: 23, note: 25, views: 26,
  igId: 39, ytId: 40, link: 41,
  dealId: 44, codeSeq: 45, tier: 54, followers: 55 };

function mkRow(o) { const r = new Array(HEADERS.length).fill(''); Object.keys(o).forEach(k => { r[k] = o[k]; }); return r; }
function load(sheet) {
  installGlobals({ '실적통합': sheet }, {});
  const ctx = vm.createContext(global);
  vm.runInContext(fs.readFileSync(GAS_PATH, 'utf8'), ctx, { filename: 'apps-script.js' });
  ctx._resolveCols(sheet);
  return ctx;
}
function act(ctx, action, payload) {
  return JSON.parse(ctx._handleWriteAction({ parameter: { action, payload: JSON.stringify(payload) } }, ''));
}
// 하늘마켓처럼 "상품코드 3개 = 3행"인 건 하나
function multiSheet(opts) {
  opts = opts || {};
  const g = [new Array(HEADERS.length).fill(''), HEADERS.slice()];
  g.push(mkRow({ [C.brand]: '미닉스', [C.product]: '더 플렌더 MAX', [C.channel]: '하늘마켓',
    [C.platform]: '인스타그램', [C.code]: 'H-1', [C.salePrice]: 10000, [C.qty]: 100, [C.revenue]: 1000000,
    [C.year]: 2026, [C.startMD]: '2026-02-01', [C.endMD]: '2026-02-03', [C.status]: '완료',
    [C.dealId]: 'D-H', [C.codeSeq]: 1, [C.followers]: 120000 }));
  g.push(mkRow({ [C.brand]: '미닉스', [C.product]: '더 플렌더 MAX', [C.channel]: '하늘마켓',
    [C.code]: 'H-2', [C.dealId]: 'D-H', [C.codeSeq]: 2,
    [C.qty]: opts.qtyOnOthers ? 50 : '', [C.revenue]: opts.qtyOnOthers ? 500000 : '' }));
  g.push(mkRow({ [C.brand]: '미닉스', [C.product]: '더 플렌더 MAX', [C.channel]: '하늘마켓',
    [C.code]: 'H-3', [C.dealId]: 'D-H', [C.codeSeq]: 3 }));
  // 비교용 단독 건
  g.push(mkRow({ [C.brand]: '미닉스', [C.product]: '더 시프트', [C.channel]: '채널B', [C.code]: 'S1',
    [C.salePrice]: 5000, [C.qty]: 10, [C.year]: 2026, [C.startMD]: '2026-05-01', [C.endMD]: '2026-05-03',
    [C.dealId]: 'D-S', [C.codeSeq]: 1 }));
  return makeSheet('실적통합', g);
}

let pass = 0, fail = 0;
function check(l, c, extra) {
  if (c) { pass++; console.log('  PASS  ' + l); }
  else { fail++; console.log('  FAIL  ' + l + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

console.log('\n[1] 신규 등록 — 상품코드 3개면 같은 dealId로 3행');
{
  const sheet = multiSheet(); const ctx = load(sheet);
  const before = sheet._grid.length;
  const r = act(ctx, 'addSalesRow', {
    brand: '미닉스', product: '더 슬림', ch: '새채널', platform: '인스타그램',
    codes: ['N-1', 'N-2', 'N-3'], sale: 20000, comm: 10, qty: 70, views: 3,
    year: 2026, start: '2026-07-01', end: '2026-07-05', followers: 50000,
    tiers: { salesTier: '메가', followerTier: '나노' }
  });
  check('등록 성공', r.success === true, r);
  check('3행 추가', sheet._grid.length === before + 3, [sheet._grid.length, before]);
  const rows = sheet._grid.slice(before);
  check('dealId가 모두 같음', rows.every(x => x[C.dealId] && x[C.dealId] === rows[0][C.dealId]),
    rows.map(x => x[C.dealId]));
  check('코드순번 1,2,3', rows.map(x => x[C.codeSeq]).join(',') === '1,2,3', rows.map(x => x[C.codeSeq]));
  check('상품코드가 행마다', rows.map(x => x[C.code]).join(',') === 'N-1,N-2,N-3', rows.map(x => x[C.code]));
  check('공통 필드는 모든 행에',
    rows.every(x => x[C.product] === '더 슬림' && x[C.channel] === '새채널'),
    rows.map(x => [x[C.product], x[C.channel]]));
  check('등급 결과도 모든 행에', rows.every(x => x[C.salesTier] === '메가' && x[C.followerTier] === '나노'),
    rows.map(x => [x[C.salesTier], x[C.followerTier]]));
  check('실적은 대표 행에만', rows[0][C.qty] === 70 && !rows[1][C.qty] && !rows[2][C.qty],
    rows.map(x => x[C.qty]));
  check('조회수도 대표 행에만', rows[0][C.views] === 3 && !rows[1][C.views], rows.map(x => x[C.views]));
  check('팔로워 수도 대표 행에만', rows[0][C.followers] === 50000 && !rows[1][C.followers],
    rows.map(x => x[C.followers]));
  check('응답에 dealId', !!r.dealId, r);
}

console.log('\n[2] 읽기 — 3행이 1건으로, 상품코드는 모두 노출');
{
  const sheet = multiSheet(); const ctx = load(sheet);
  const deals = ctx.parseMainSheet(sheet).deals;
  const h = deals.filter(d => d.channel === '하늘마켓');
  check('1건으로 묶임', h.length === 1, h.length);
  check('상품코드 3개', (h[0].codes || []).join(',') === 'H-1,H-2,H-3', h[0].codes);
  check('시트 행 수 보고', h[0].rowCount === 3, h[0].rowCount);
  check('실적은 대표 행 값', h[0].qty === 100 && h[0].revenue === 1000000, [h[0].qty, h[0].revenue]);
  check('등급 기록 대상 행이 3개', (h[0].tierRows || []).length === 3, h[0].tierRows);
  check('단독 건은 그대로 1건', deals.filter(d => d.dealId === 'D-S').length === 1);
  check('전체 건수 = 2', deals.length === 2, deals.length);
}

console.log('\n[3] 수정 저장 — 공통 필드는 모든 행, 실적·조건은 대표 행에만');
{
  const sheet = multiSheet(); const ctx = load(sheet);
  const r = act(ctx, 'updateDeal', {
    dealId: 'D-H',
    changes: { product: '더 플렌더 PRO', vendor: '벤더A', tier: '메가', platform: '유튜브',
      targetQty: 900, sale: 12000, qty: 333, note: '메모' },
    tiers: { salesTier: '매크로', followerTier: '마이크로' }
  });
  check('저장 성공', r.success === true, r);
  const rows = [sheet._grid[2], sheet._grid[3], sheet._grid[4]];
  check('제품이 3행 모두', rows.every(x => x[C.product] === '더 플렌더 PRO'), rows.map(x => x[C.product]));
  check('벤더가 3행 모두', rows.every(x => x[C.vendor] === '벤더A'), rows.map(x => x[C.vendor]));
  check('등급(수동)이 3행 모두', rows.every(x => x[C.tier] === '메가'), rows.map(x => x[C.tier]));
  check('등급 결과 G·H가 3행 모두', rows.every(x => x[C.salesTier] === '매크로' && x[C.followerTier] === '마이크로'),
    rows.map(x => [x[C.salesTier], x[C.followerTier]]));
  check('플랫폼은 대표 행에만', rows[0][C.platform] === '유튜브' && !rows[1][C.platform],
    rows.map(x => x[C.platform]));
  check('목표수량은 대표 행에만', rows[0][C.targetQty] === 900 && !rows[1][C.targetQty],
    rows.map(x => x[C.targetQty]));
  check('판매수량은 대표 행에만', rows[0][C.qty] === 333 && !rows[1][C.qty] && !rows[2][C.qty],
    rows.map(x => x[C.qty]));
  check('공구가는 대표 행에만', rows[0][C.salePrice] === 12000 && !rows[1][C.salePrice],
    rows.map(x => x[C.salePrice]));
  check('상품코드는 건드리지 않음', rows.map(x => x[C.code]).join(',') === 'H-1,H-2,H-3', rows.map(x => x[C.code]));
  check('코드순번 유지', rows.map(x => x[C.codeSeq]).join(',') === '1,2,3', rows.map(x => x[C.codeSeq]));
  check('행 수 그대로', sheet._grid.length === 6, sheet._grid.length);
}

console.log('\n[4] 수정 저장 — 대표 행이 아닌 행의 실적을 덮어쓰지 않는다');
{
  // 시트에 사람이 직접 넣어 2·3행에도 실적이 있는 상태(운영 규칙 위반이지만 실제로 존재)
  const sheet = multiSheet({ qtyOnOthers: true }); const ctx = load(sheet);
  const r = act(ctx, 'updateDeal', { dealId: 'D-H', changes: { qty: 111, product: '더 플렌더 PRO' } });
  check('저장 성공', r.success === true, r);
  check('대표 행만 새 값', sheet._grid[2][C.qty] === 111, sheet._grid[2][C.qty]);
  check('2행 실적 보존', sheet._grid[3][C.qty] === 50, sheet._grid[3][C.qty]);
  check('2행 총매출 보존', sheet._grid[3][C.revenue] === 500000, sheet._grid[3][C.revenue]);
  check('공통 필드는 2행에도 반영', sheet._grid[3][C.product] === '더 플렌더 PRO', sheet._grid[3][C.product]);
}

console.log('\n[5] 상품코드 추가·삭제 — 행이 따라 늘고 준다');
{
  const sheet = multiSheet(); const ctx = load(sheet);
  let r = act(ctx, 'updateDeal', { dealId: 'D-H', codes: ['H-1', 'H-2', 'H-3', 'H-4'] });
  check('코드 추가 성공', r.success === true, r);
  const added = sheet._grid[sheet._grid.length - 1];
  check('행이 하나 늘어남', sheet._grid.length === 7, sheet._grid.length);
  check('추가 행의 dealId가 같음', added[C.dealId] === 'D-H', added[C.dealId]);
  check('추가 행의 코드순번 4', added[C.codeSeq] === 4, added[C.codeSeq]);
  check('추가 행에 공통 필드 복사', added[C.channel] === '하늘마켓' && added[C.product] === '더 플렌더 MAX',
    [added[C.channel], added[C.product]]);
  check('추가 행에 실적은 비어 있음', !added[C.qty], added[C.qty]);

  r = act(ctx, 'updateDeal', { dealId: 'D-H', codes: ['H-1', 'H-2'] });
  check('코드 삭제 성공', r.success === true, r);
  check('초과 행 2개 삭제', sheet._grid.length === 5, sheet._grid.length);
  const left = ctx.parseMainSheet(sheet).deals.filter(d => d.dealId === 'D-H');
  check('남은 코드 2개', (left[0].codes || []).join(',') === 'H-1,H-2', left[0].codes);
  check('대표 행 실적 유지', left[0].qty === 100, left[0].qty);
}

console.log('\n[6] 진단 — 다중 코드 건과 규칙 위반을 한 번에 본다');
{
  const sheet = multiSheet({ qtyOnOthers: true }); const ctx = load(sheet);
  const rep = ctx.reportMultiCodeDeals();
  check('다중 코드 건 1개 보고', rep.length === 1, rep.map(x => x.dealId));
  check('채널·제품 보고', rep[0].channel === '하늘마켓' && rep[0].product === '더 플렌더 MAX', rep[0]);
  check('행 번호 보고', rep[0].rows.join(',') === '3,4,5', rep[0].rows);
  check('상품코드 보고', rep[0].codes.join(',') === 'H-1,H-2,H-3', rep[0].codes);
  check('대표 행이 아닌 행의 실적을 경고', rep[0].strayPerf.indexOf(4) >= 0, rep[0].strayPerf);
  check('코드순번 이상 없음', rep[0].seqIssue === false, rep[0].seqIssue);
  check('진단은 시트를 바꾸지 않음', sheet._calls.filter(c => c.op === 'setValues').length === 0);

  // 코드순번이 비었거나 중복이면 짚어준다
  const s2 = multiSheet(); const c2 = load(s2);
  s2._grid[3][C.codeSeq] = 1;
  const rep2 = c2.reportMultiCodeDeals();
  check('코드순번 중복 감지', rep2[0].seqIssue === true, rep2[0]);
}


console.log('\n[7] 실적 합산 — 상품코드별로 실적이 나뉜 건도 빠짐없이 집계');
{
  const sheet = multiSheet({ qtyOnOthers: true }); const ctx = load(sheet);
  const h = ctx.parseMainSheet(sheet).deals.filter(d => d.channel === '하늘마켓')[0];
  check('판매수량 합산(100+50)', h.qty === 150, h.qty);
  check('총매출 합산(100만+50만)', h.revenue === 1500000, h.revenue);
  check('실적이 있는 행 수 보고', h.perfRows === 2, h.perfRows);

  const only = multiSheet(); const c2 = load(only);
  const h2 = c2.parseMainSheet(only).deals.filter(d => d.channel === '하늘마켓')[0];
  check('대표 행에만 있으면 예전과 같은 값', h2.qty === 100 && h2.revenue === 1000000, [h2.qty, h2.revenue]);
  check('그때는 실적 행 1개', h2.perfRows === 1, h2.perfRows);

  /* KPI 불변식: 대시보드 총매출(건별 합) = 시트의 모든 행 매출 합.
     대표 행만 읽던 시절에는 이 등식이 깨져서, 상품코드별로 나뉜 건의 매출이 조용히 빠졌다. */
  const s3 = multiSheet({ qtyOnOthers: true }); const c3 = load(s3);
  const deals = c3.parseMainSheet(s3).deals;
  const byDeal = deals.reduce((s, d) => s + (d.revenue || 0), 0);
  let bySheet = 0;
  for (let i = 2; i < s3._grid.length; i++) bySheet += Number(s3._grid[i][C.revenue]) || 0;
  check('건별 합 = 시트 행 합', byDeal === bySheet, [byDeal, bySheet]);
}


console.log('\n[8] dealId 통일 — 미리보기는 아무것도 쓰지 않는다');
{
  // 러브지나처럼 "같은 건인데 행마다 dealId가 다른" 3행 + 무관한 건 1행
  const g = [new Array(HEADERS.length).fill(''), HEADERS.slice()];
  const lz = (code, qty, rev, id) => mkRow({ [C.brand]: '미닉스', [C.product]: '더 플렌더 MAX',
    [C.channel]: '러브지나', [C.code]: code, [C.salePrice]: 10000, [C.qty]: qty, [C.revenue]: rev,
    [C.year]: 2026, [C.startMD]: '2026-04-06', [C.endMD]: '2026-04-08', [C.status]: '완료',
    [C.dealId]: id, [C.codeSeq]: 1 });
  g.push(lz('LZ-A', 100, 1000000, 'D-A'));
  g.push(lz('LZ-B', 50, 500000, 'D-B'));
  g.push(lz('LZ-C', 20, 200000, 'D-C'));
  g.push(mkRow({ [C.brand]: '미닉스', [C.product]: '더 시프트', [C.channel]: '채널B', [C.code]: 'S1',
    [C.qty]: 9, [C.revenue]: 90000, [C.year]: 2026, [C.startMD]: '2026-05-01', [C.endMD]: '2026-05-02',
    [C.dealId]: 'D-S', [C.codeSeq]: 1 }));
  const sheet = makeSheet('실적통합', g);
  const ctx = load(sheet);

  const before = JSON.stringify(sheet._grid.map(r => [r[C.dealId], r[C.codeSeq]]));
  const pv = ctx.previewUnifyDealIds([[3, 4, 5]]);
  check('미리보기 플래그', pv.dryRun === true, pv.dryRun);
  check('묶음 1개 처리', pv.groups === 1, pv.groups);
  // 4·5행의 dealId 2개 + 코드순번 2개 = 4셀
  check('바뀔 셀 4개 보고', pv.edits.length === 4, pv.edits);
  check('셀마다 행·열·전후값', pv.edits[0].row === 4 && pv.edits[0].col === '공구건ID' &&
    pv.edits[0].from === 'D-B' && pv.edits[0].to === 'D-A', pv.edits[0]);
  check('코드순번도 대상', pv.edits.some(e => e.col === '코드순번' && e.row === 5 && e.to === 3), pv.edits);
  check('미리보기는 시트를 바꾸지 않음',
    JSON.stringify(sheet._grid.map(r => [r[C.dealId], r[C.codeSeq]])) === before);
  check('미리보기는 쓰기 호출 없음', sheet._calls.filter(c => c.op === 'setValues').length === 0);
}

console.log('\n[9] dealId 통일 — 실행 후 한 건으로 보이고 합계는 그대로');
{
  const g = [new Array(HEADERS.length).fill(''), HEADERS.slice()];
  const lz = (code, qty, rev, id) => mkRow({ [C.brand]: '미닉스', [C.product]: '더 플렌더 MAX',
    [C.channel]: '러브지나', [C.code]: code, [C.salePrice]: 10000, [C.qty]: qty, [C.revenue]: rev,
    [C.year]: 2026, [C.startMD]: '2026-04-06', [C.endMD]: '2026-04-08', [C.status]: '완료',
    [C.dealId]: id, [C.codeSeq]: 1 });
  g.push(lz('LZ-A', 100, 1000000, 'D-A'));
  g.push(lz('LZ-B', 50, 500000, 'D-B'));
  g.push(lz('LZ-C', 20, 200000, 'D-C'));
  const sheet = makeSheet('실적통합', g);
  const ctx = load(sheet);

  const sumBefore = ctx.parseMainSheet(sheet).deals.reduce((s, d) => s + (d.revenue || 0), 0);
  const cntBefore = ctx.parseMainSheet(sheet).deals.length;
  check('정리 전에는 3건', cntBefore === 3, cntBefore);

  const res = ctx.applyUnifyDealIds([[3, 4, 5]]);
  check('실행 플래그', res.dryRun === false);
  check('행을 삭제하지 않음', sheet._grid.length === 5, sheet._grid.length);
  check('dealId가 첫 행 값으로 통일', [2, 3, 4].every(i => sheet._grid[i][C.dealId] === 'D-A'),
    [2, 3, 4].map(i => sheet._grid[i][C.dealId]));
  check('코드순번 1,2,3', [2, 3, 4].map(i => sheet._grid[i][C.codeSeq]).join(',') === '1,2,3',
    [2, 3, 4].map(i => sheet._grid[i][C.codeSeq]));
  check('실적은 행마다 그대로', [2, 3, 4].map(i => sheet._grid[i][C.qty]).join(',') === '100,50,20',
    [2, 3, 4].map(i => sheet._grid[i][C.qty]));

  const after = ctx.parseMainSheet(sheet).deals;
  check('1건으로 보임', after.length === 1, after.length);
  check('상품코드 3개', (after[0].codes || []).join(',') === 'LZ-A,LZ-B,LZ-C', after[0].codes);
  check('판매수량 합산', after[0].qty === 170, after[0].qty);
  check('총매출 합계 불변', after.reduce((s, d) => s + (d.revenue || 0), 0) === sumBefore,
    [after.reduce((s, d) => s + (d.revenue || 0), 0), sumBefore]);
  check('실적 행 3개로 보고', after[0].perfRows === 3, after[0].perfRows);

  // 재실행해도 안전
  const again = ctx.applyUnifyDealIds([[3, 4, 5]]);
  check('재실행 시 바뀔 셀 없음', again.edits.length === 0, again.edits);
}

console.log('\n[10] dealId 통일 — 같은 건이 아니면 건드리지 않는다');
{
  const g = [new Array(HEADERS.length).fill(''), HEADERS.slice()];
  g.push(mkRow({ [C.brand]: '미닉스', [C.product]: '더 플렌더 MAX', [C.channel]: '러브지나',
    [C.code]: 'A', [C.year]: 2026, [C.startMD]: '2026-04-06', [C.endMD]: '2026-04-08',
    [C.dealId]: 'D-A', [C.codeSeq]: 1 }));
  g.push(mkRow({ [C.brand]: '미닉스', [C.product]: '더 플렌더 MAX', [C.channel]: '다른채널',
    [C.code]: 'B', [C.year]: 2026, [C.startMD]: '2026-04-06', [C.endMD]: '2026-04-08',
    [C.dealId]: 'D-B', [C.codeSeq]: 1 }));
  const sheet = makeSheet('실적통합', g);
  const ctx = load(sheet);
  const res = ctx.applyUnifyDealIds([[3, 4]]);
  check('채널이 다르면 건너뜀', res.groups === 0 && res.skipped.length === 1, res);
  check('건너뛴 이유 보고', res.skipped[0].reason.indexOf('채널·제품·기간이 다릅니다') >= 0, res.skipped[0]);
  check('시트를 바꾸지 않음', sheet._grid[3][C.dealId] === 'D-B', sheet._grid[3][C.dealId]);
  check('범위 밖 행도 건너뜀', ctx.applyUnifyDealIds([[3, 999]]).skipped.length === 1);
}


console.log('\n[14] 인플루언서 링크 일괄 채움');
{
  const g = [new Array(HEADERS.length).fill(''), HEADERS.slice()];
  const row = o => mkRow(Object.assign({ [C.brand]: '미닉스', [C.product]: '더 플렌더',
    [C.year]: 2026, [C.startMD]: '2026-04-01', [C.endMD]: '2026-04-03', [C.codeSeq]: 1 }, o));
  g.push(row({ [C.channel]: '밈채',   [C.platform]: '인스타그램', [C.igId]: 'meme.ch', [C.dealId]: 'D1' }));
  g.push(row({ [C.channel]: '브론테', [C.platform]: '유튜브',     [C.ytId]: 'bronte',  [C.dealId]: 'D2' }));
  g.push(row({ [C.channel]: '표기흔들', [C.platform]: 'IG',       [C.igId]: 'wobbly',  [C.dealId]: 'D3' }));
  // 이미 링크가 있는 행 — 건드리면 안 된다
  g.push(row({ [C.channel]: '기존링크', [C.platform]: '인스타그램', [C.igId]: 'has.link',
    [C.link]: 'https://linktr.ee/custom', [C.dealId]: 'D4' }));
  // ID가 없는 행 — 만들 수 없다
  g.push(row({ [C.channel]: 'ID없음', [C.platform]: '인스타그램', [C.dealId]: 'D5' }));
  // 플랫폼이 비었지만 ID가 한쪽에만 있는 행
  g.push(row({ [C.channel]: '플랫폼없음', [C.platform]: '', [C.igId]: 'onlyig', [C.dealId]: 'D6' }));
  const sheet = makeSheet('실적통합', g);
  const ctx = load(sheet);

  const pv = ctx.previewInfluencerLinks();
  check('미리보기 플래그', pv.dryRun === true);
  check('대상 4행', pv.count === 4, pv.count);
  check('샘플 5개까지 보고', pv.sample.length === 4, pv.sample.length);
  check('미리보기는 쓰지 않음', sheet._calls.filter(c => c.op === 'setValues').length === 0);
  check('미리보기 후 시트 그대로', !sheet._grid[2][C.link], sheet._grid[2][C.link]);

  const res = ctx.fillInfluencerLinks();
  check('4행 기록', res.count === 4, res.count);
  check('인스타 링크', sheet._grid[2][C.link] === 'https://www.instagram.com/meme.ch', sheet._grid[2][C.link]);
  check('유튜브 링크', sheet._grid[3][C.link] === 'https://www.youtube.com/@bronte', sheet._grid[3][C.link]);
  check('플랫폼 표기가 달라도 생성', sheet._grid[4][C.link] === 'https://www.instagram.com/wobbly', sheet._grid[4][C.link]);
  check('기존 링크는 그대로', sheet._grid[5][C.link] === 'https://linktr.ee/custom', sheet._grid[5][C.link]);
  check('ID 없는 행은 비어 있음', !sheet._grid[6][C.link], sheet._grid[6][C.link]);
  check('플랫폼 없어도 ID 하나면 생성', sheet._grid[7][C.link] === 'https://www.instagram.com/onlyig', sheet._grid[7][C.link]);
  check('한 번의 setValues로', sheet._calls.filter(c => c.op === 'setValues' && c.c === C.link + 1).length === 1);

  // 재실행하면 더 채울 것이 없다
  check('재실행 시 대상 0', ctx.fillInfluencerLinks().count === 0);
}

console.log('\n[15] 링크도 채널 단위로 전파된다');
{
  const g = [new Array(HEADERS.length).fill(''), HEADERS.slice()];
  const row = o => mkRow(Object.assign({ [C.brand]: '미닉스', [C.product]: '더 플렌더',
    [C.channel]: '같은채널', [C.platform]: '인스타그램', [C.year]: 2026,
    [C.startMD]: '2026-04-01', [C.endMD]: '2026-04-03', [C.codeSeq]: 1 }, o));
  g.push(row({ [C.dealId]: 'A', [C.igId]: 'same.ch', [C.link]: '' }));
  g.push(row({ [C.dealId]: 'B', [C.igId]: '', [C.link]: '' }));
  g.push(row({ [C.dealId]: 'C', [C.channel]: '다른채널', [C.link]: '' }));
  const sheet = makeSheet('실적통합', g);
  const ctx = load(sheet);

  check('전파 대상 목록에 link 포함', ctx.CHANNEL_FIELD_KEYS.indexOf('link') >= 0, ctx.CHANNEL_FIELD_KEYS);
  const r = act(ctx, 'updateDeal', {
    dealId: 'A', changes: {},
    channelFields: { channel: '같은채널', fields: { link: 'https://www.instagram.com/same.ch' }, mode: 'fillEmpty' }
  });
  check('저장 성공', r.success === true, r);
  check('같은 채널 2행에 반영',
    sheet._grid[2][C.link] === 'https://www.instagram.com/same.ch' &&
    sheet._grid[3][C.link] === 'https://www.instagram.com/same.ch',
    [sheet._grid[2][C.link], sheet._grid[3][C.link]]);
  check('다른 채널은 그대로', !sheet._grid[4][C.link], sheet._grid[4][C.link]);
  check('링크에서 @를 떼지 않음', ctx._normalizeChannelFieldValue('link', 'https://x.com/@abc') === 'https://x.com/@abc',
    ctx._normalizeChannelFieldValue('link', 'https://x.com/@abc'));
}

console.log('\n--------------------------------\n통과 ' + pass + ' / 실패 ' + fail);
process.exit(fail ? 1 : 0);
