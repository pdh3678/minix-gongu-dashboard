/* 공구그룹ID — 같은 공구건을 상품코드별로 여러 행에 기록한 경우의 정식 지원.

   지키려는 성질:
     · 그룹 키는 공구그룹ID > dealId > 행 단독 순 — 열이 없거나 비어 있으면 예전과 똑같이 동작한다
     · 그룹 건은 "건수 1건", 판매수량·총매출은 행 합산
     · 마이그레이션은 미리보기가 먼저이고, 시트 행을 절대 삭제하지 않으며, 재실행해도 안전하다
     · 그룹 저장은 공통 필드를 모든 행에, 실적은 행마다 쓴다. 단독 건 저장 경로는 그대로다
     · 총매출은 행마다 수식으로 남는다(값으로 박으면 수량·공구가 변경 시 재계산이 끊긴다)

   실행: node tests/deal-group.test.js  (또는 node tests/run-all.js) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { makeSheet, installGlobals, STATS, resetStats } = require(path.join(__dirname, 'lib', 'mock-sheets.js'));
const BASE = require(path.join(__dirname, 'lib', 'real-headers.js'));
const GAS_PATH = process.argv[2] || path.join(__dirname, '..', 'apps-script.js');

const HEADERS = BASE.concat(['공구그룹ID']);
const WITHOUT_GROUP = BASE.slice();
const C = { brand:1, product:2, channel:4, platform:5, code:9, salePrice:10, qty:11, revenue:12,
  year:14, startMD:15, endMD:16, status:17, targetQty:23, views:26,
  dealId:44, codeSeq:45, followers:55, groupId:56 };

function buildSheet(headers){
  headers = headers || HEADERS;
  const w = headers.length;
  const row = o => { const r = new Array(w).fill(''); Object.keys(o).forEach(k => { r[k] = o[k]; }); return r; };
  const g = [new Array(w).fill(''), headers.slice()];
  // 3~5행: 러브지나처럼 "제품·채널·기간이 같은데 dealId가 제각각"인 3행 (= 지금까지 내용 기준 병합 대상)
  [['LZ-A', 100, 1000000], ['LZ-B', 50, 500000], ['LZ-C', 20, 200000]].forEach(([code, qty, rev], i) => {
    g.push(row({ [C.brand]:'미닉스', [C.product]:'더 플렌더 MAX', [C.channel]:'러브지나',
      [C.platform]:'인스타그램', [C.code]:code, [C.salePrice]:10000, [C.qty]:qty, [C.revenue]:rev,
      [C.year]:2026, [C.startMD]:'2026-04-06', [C.endMD]:'2026-04-08', [C.status]:'완료',
      [C.dealId]:'D-LZ-' + i, [C.codeSeq]:1 }));
  });
  // 6행: 단독 건
  g.push(row({ [C.brand]:'미닉스', [C.product]:'더 시프트', [C.channel]:'채널B', [C.code]:'S1',
    [C.salePrice]:5000, [C.qty]:10, [C.revenue]:50000, [C.year]:2026,
    [C.startMD]:'2026-05-01', [C.endMD]:'2026-05-03', [C.status]:'완료',
    [C.dealId]:'D-SOLO', [C.codeSeq]:1 }));
  // 7~8행: 기존 dealId 그룹(한 건, 코드 2개) — 실적은 대표 행에만
  g.push(row({ [C.brand]:'미닉스', [C.product]:'더 슬림', [C.channel]:'채널C', [C.code]:'M1',
    [C.salePrice]:3000, [C.qty]:7, [C.revenue]:21000, [C.year]:2026,
    [C.startMD]:'2026-06-01', [C.endMD]:'2026-06-03', [C.status]:'완료',
    [C.dealId]:'D-MULTI', [C.codeSeq]:1 }));
  g.push(row({ [C.brand]:'미닉스', [C.product]:'더 슬림', [C.channel]:'채널C', [C.code]:'M2',
    [C.dealId]:'D-MULTI', [C.codeSeq]:2 }));
  return makeSheet('실적통합', g);
}
function load(sheet){
  installGlobals({ '실적통합': sheet }, {});
  const ctx = vm.createContext(global);
  vm.runInContext(fs.readFileSync(GAS_PATH, 'utf8'), ctx, { filename: 'apps-script.js' });
  ctx._resolveCols(sheet);
  return ctx;
}
function act(ctx, action, payload){
  return JSON.parse(ctx._handleWriteAction({ parameter: { action, payload: JSON.stringify(payload) } }, ''));
}

let pass = 0, fail = 0;
function check(l, c, extra) {
  if (c) { pass++; console.log('  PASS  ' + l); }
  else { fail++; console.log('  FAIL  ' + l + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

console.log('\n[1] 그룹ID 열이 없어도 예전과 똑같이 동작 (배포 → 마이그레이션 순서 안전)');
{
  const sheet = buildSheet(WITHOUT_GROUP); const ctx = load(sheet);
  check('groupId 미해석(-1)', ctx.COL.groupId === -1, ctx.COL.groupId);
  const deals = ctx.parseMainSheet(sheet).deals;
  // 그룹ID가 없으면 dealId 기준 → 러브지나 3행은 3건으로 보인다(마이그레이션 전 상태)
  check('러브지나가 아직 3건', deals.filter(d => d.channel === '러브지나').length === 3,
    deals.filter(d => d.channel === '러브지나').length);
  check('기존 dealId 그룹은 여전히 1건', deals.filter(d => d.dealId === 'D-MULTI').length === 1);
  check('codeRows는 열 없이도 내려감', Array.isArray(deals[0].codeRows) && deals[0].codeRows.length === 1);
}

console.log('\n[2] 마이그레이션 — 미리보기는 아무것도 쓰지 않음');
{
  const sheet = buildSheet(); const ctx = load(sheet);
  const before = sheet._grid.map(r => r[C.groupId]);
  const res = ctx.previewDealGroupIds();
  check('묶일 그룹 1개 발견(러브지나)', res.groups.length === 1, res.groups.map(g => g.channel));
  check('그 그룹의 행이 3개', res.groups[0].rows.length === 3, res.groups[0].rows);
  check('상품코드 목록 보고', res.groups[0].codes.join(',') === 'LZ-A,LZ-B,LZ-C', res.groups[0].codes);
  check('기존 dealId 3개를 묶는다고 보고', res.groups[0].dealIds.length === 3, res.groups[0].dealIds);
  check('미리보기는 시트를 건드리지 않음',
    JSON.stringify(sheet._grid.map(r => r[C.groupId])) === JSON.stringify(before));
  check('dryRun 플래그', res.dryRun === true);
}

console.log('\n[3] 마이그레이션 — 실제 기록');
{
  const sheet = buildSheet(); const ctx = load(sheet);
  const rowsBefore = sheet._grid.length;
  const res = ctx.applyDealGroupIds();
  check('행을 삭제하지 않음', sheet._grid.length === rowsBefore, [sheet._grid.length, rowsBefore]);
  const gids = [2,3,4].map(i => sheet._grid[i][C.groupId]);
  check('러브지나 3행이 같은 그룹ID', gids[0] && gids[0] === gids[1] && gids[1] === gids[2], gids);
  check('단독 건은 자기 dealId', sheet._grid[5][C.groupId] === 'D-SOLO', sheet._grid[5][C.groupId]);
  check('기존 dealId 그룹도 자기 dealId', sheet._grid[6][C.groupId] === 'D-MULTI' && sheet._grid[7][C.groupId] === 'D-MULTI');
  check('그룹ID 열은 한 번의 setValues로', sheet._calls.filter(c => c.op === 'setValues' && c.c === C.groupId + 1).length === 1);

  // 재실행해도 안전해야 한다
  const again = ctx.applyDealGroupIds();
  check('재실행 시 바뀔 것 없음', again.changed === 0, again.changed);
  check('재실행해도 그룹ID 유지', sheet._grid[2][C.groupId] === gids[0]);
}

console.log('\n[4] 마이그레이션 후 — 1건으로 묶이고 실적은 합산');
{
  const sheet = buildSheet(); const ctx = load(sheet);
  ctx.applyDealGroupIds();
  const deals = ctx.parseMainSheet(sheet).deals;
  const lz = deals.filter(d => d.channel === '러브지나');
  check('러브지나가 1건', lz.length === 1, lz.length);
  check('판매수량 합산(100+50+20)', lz[0].qty === 170, lz[0].qty);
  check('총매출 합산(170만)', lz[0].revenue === 1700000, lz[0].revenue);
  check('시트 행 수 보고', lz[0].rowCount === 3, lz[0].rowCount);
  check('codeRows 3개', lz[0].codeRows.length === 3, lz[0].codeRows.length);
  check('codeRows에 행별 상품코드·실적', lz[0].codeRows[0].code === 'LZ-A' && lz[0].codeRows[1].qty === 50,
    lz[0].codeRows.map(r => [r.code, r.qty]));
  check('codeRows에 시트 행 번호', lz[0].codeRows.map(r => r.rowIndex).join(',') === '3,4,5',
    lz[0].codeRows.map(r => r.rowIndex));
  check('groupId 노출', !!lz[0].groupId, lz[0].groupId);

  // 전체 합계가 마이그레이션 전후로 같아야 한다(KPI 총매출 불변)
  const sheet2 = buildSheet(); const ctx2 = load(sheet2);
  const sumBefore = ctx2.parseMainSheet(sheet2).deals.reduce((s, d) => s + (d.revenue || 0), 0);
  const sumAfter = deals.reduce((s, d) => s + (d.revenue || 0), 0);
  check('총매출 합계가 마이그레이션 전후 동일', sumBefore === sumAfter, [sumBefore, sumAfter]);
  check('건수는 3건 줄어든 자리에 1건', deals.length === 3, deals.length); // 러브지나1 + 단독1 + 멀티1
}

console.log('\n[5] 그룹 저장 — 공통 필드는 모든 행, 실적은 행마다');
{
  const sheet = buildSheet(); const ctx = load(sheet);
  ctx.applyDealGroupIds();
  const gid = sheet._grid[2][C.groupId];
  const r = act(ctx, 'updateDeal', {
    dealId:'D-LZ-0', groupId:gid,
    changes:{ platform:'유튜브', targetQty:900, sale:12000 },
    codeRows:[
      { rowIndex:3, code:'LZ-A2', qty:111, status:'완료' },
      { rowIndex:4, code:'LZ-B',  qty:222, status:'완료' },
      { rowIndex:5, code:'LZ-C',  qty:333, status:'진행중' }
    ]
  });
  check('성공', r.success === true, r);
  check('codeRows 3행 반영 보고', r.codeRowsApplied === 3, r.codeRowsApplied);
  check('공통 필드(플랫폼)가 3행 모두에',
    [2,3,4].every(i => sheet._grid[i][C.platform] === '유튜브'), [2,3,4].map(i => sheet._grid[i][C.platform]));
  check('공통 필드(목표수량)도 3행 모두에', [2,3,4].every(i => sheet._grid[i][C.targetQty] === 900));
  check('공구가도 3행 모두에', [2,3,4].every(i => sheet._grid[i][C.salePrice] === 12000));
  check('실적(판매수량)은 행마다 다르게',
    sheet._grid[2][C.qty] === 111 && sheet._grid[3][C.qty] === 222 && sheet._grid[4][C.qty] === 333,
    [2,3,4].map(i => sheet._grid[i][C.qty]));
  check('상품코드도 행마다', sheet._grid[2][C.code] === 'LZ-A2' && sheet._grid[4][C.code] === 'LZ-C');
  check('진행상태도 행마다', sheet._grid[4][C.status] === '진행중', sheet._grid[4][C.status]);
  check('총매출은 행마다 수식으로 남음',
    [2,3,4].every(i => String(sheet._grid[i][C.revenue]).charAt(0) === '='),
    [2,3,4].map(i => sheet._grid[i][C.revenue]));

  // 저장 후 다시 읽으면 합산이 새 값으로
  const deals2 = ctx.parseMainSheet(sheet).deals;
  const lz2 = deals2.find(d => d.channel === '러브지나');
  check('합산 판매수량 갱신(111+222+333)', lz2.qty === 666, lz2.qty);
}

console.log('\n[6] 단독 건 저장 경로는 그대로');
{
  const sheet = buildSheet(); const ctx = load(sheet);
  ctx.applyDealGroupIds();
  const r = act(ctx, 'updateDeal', { dealId:'D-SOLO', changes:{ platform:'틱톡', qty:99 } });
  check('성공', r.success === true, r);
  check('codeRows 없으면 그룹 모드 아님', r.codeRowsApplied === 0, r.codeRowsApplied);
  check('단독 행에 반영', sheet._grid[5][C.platform] === '틱톡' && sheet._grid[5][C.qty] === 99,
    [sheet._grid[5][C.platform], sheet._grid[5][C.qty]]);
  check('다른 건은 안 건드림', sheet._grid[2][C.platform] === '인스타그램');
}

console.log('\n[7] 그룹 저장이 남의 행을 건드리지 않음');
{
  const sheet = buildSheet(); const ctx = load(sheet);
  ctx.applyDealGroupIds();
  const gid = sheet._grid[2][C.groupId];
  act(ctx, 'updateDeal', {
    dealId:'D-LZ-0', groupId:gid, changes:{},
    codeRows:[ { rowIndex:6, qty:9999 }, { rowIndex:3, qty:5 } ] // 6행은 이 그룹 소속이 아님
  });
  check('그룹 밖 행은 무시', sheet._grid[5][C.qty] === 10, sheet._grid[5][C.qty]);
  check('그룹 안 행만 반영', sheet._grid[2][C.qty] === 5, sheet._grid[2][C.qty]);
}


console.log('\n[8] 묶기 후보 진단 — 왜 자동으로 안 묶였는지');
{
  const w = HEADERS.length;
  const row = o => { const r = new Array(w).fill(''); Object.keys(o).forEach(k => { r[k] = o[k]; }); return r; };
  const g = [new Array(w).fill(''), HEADERS.slice()];
  // 하늘마켓: 기간 같고 제품만 다름
  g.push(row({ [C.brand]:'미닉스', [C.product]:'더 플렌더 PRO', [C.channel]:'하늘마켓', [C.code]:'H1',
    [C.year]:2026, [C.startMD]:'2026-02-01', [C.endMD]:'2026-02-03', [C.dealId]:'H-1', [C.codeSeq]:1 }));
  g.push(row({ [C.brand]:'미닉스', [C.product]:'더 플렌더 MAX', [C.channel]:'하늘마켓', [C.code]:'H2',
    [C.year]:2026, [C.startMD]:'2026-02-01', [C.endMD]:'2026-02-03', [C.dealId]:'H-2', [C.codeSeq]:1 }));
  // 이제이쿡: 제품 같고 종료일만 하루 다름
  g.push(row({ [C.brand]:'미닉스', [C.product]:'더 시프트', [C.channel]:'이제이쿡', [C.code]:'E1',
    [C.year]:2026, [C.startMD]:'2026-01-07', [C.endMD]:'2026-01-09', [C.dealId]:'E-1', [C.codeSeq]:1 }));
  g.push(row({ [C.brand]:'미닉스', [C.product]:'더 시프트', [C.channel]:'이제이쿡', [C.code]:'E2',
    [C.year]:2026, [C.startMD]:'2026-01-07', [C.endMD]:'2026-01-10', [C.dealId]:'E-2', [C.codeSeq]:1 }));
  // 채널명 공백만 다른 쌍
  g.push(row({ [C.brand]:'미닉스', [C.product]:'더 슬림', [C.channel]:'밥심', [C.code]:'B1',
    [C.year]:2026, [C.startMD]:'2026-03-01', [C.endMD]:'2026-03-02', [C.dealId]:'B-1', [C.codeSeq]:1 }));
  g.push(row({ [C.brand]:'미닉스', [C.product]:'더 슬림', [C.channel]:'밥 심', [C.code]:'B2',
    [C.year]:2026, [C.startMD]:'2026-03-01', [C.endMD]:'2026-03-02', [C.dealId]:'B-2', [C.codeSeq]:1 }));
  // 기간이 멀어 후보가 아닌 쌍(같은 채널)
  g.push(row({ [C.brand]:'미닉스', [C.product]:'더 슬림', [C.channel]:'먼채널', [C.code]:'F1',
    [C.year]:2026, [C.startMD]:'2026-01-01', [C.endMD]:'2026-01-02', [C.dealId]:'F-1', [C.codeSeq]:1 }));
  g.push(row({ [C.brand]:'미닉스', [C.product]:'더 슬림', [C.channel]:'먼채널', [C.code]:'F2',
    [C.year]:2026, [C.startMD]:'2026-03-01', [C.endMD]:'2026-03-02', [C.dealId]:'F-2', [C.codeSeq]:1 }));

  const sheet = makeSheet('실적통합', g);
  const ctx = load(sheet);
  const found = ctx.reportUngroupedCandidates();
  const byCh = {};
  found.forEach(f => { byCh[f.channel] = f; });
  check('하늘마켓 후보 검출', !!byCh['하늘마켓'], Object.keys(byCh));
  check('하늘마켓 이유 = 제품 다름', byCh['하늘마켓'].reasons.join(' ').indexOf('제품 다름') >= 0, byCh['하늘마켓'].reasons);
  check('하늘마켓 행 번호 보고', byCh['하늘마켓'].rows.join(',') === '3,4', byCh['하늘마켓'].rows);
  check('이제이쿡 후보 검출', !!byCh['이제이쿡']);
  check('이제이쿡 이유 = 종료일 다름', byCh['이제이쿡'].reasons.join(' ').indexOf('종료일 다름') >= 0, byCh['이제이쿡'].reasons);
  check('채널 공백 차이도 이유로 보고', (byCh['밥심'] || byCh['밥 심']).reasons.join(' ').indexOf('채널명 표기 차이') >= 0);
  check('기간이 먼 쌍은 후보 아님', !byCh['먼채널'], byCh['먼채널']);
  check('진단은 시트를 건드리지 않음', sheet._calls.filter(c => c.op === 'setValues').length === 0);

  // 채널 필터
  const only = ctx.reportUngroupedCandidates(['하늘마켓']);
  check('채널 필터 동작', only.length === 1 && only[0].channel === '하늘마켓', only.map(x => x.channel));
}

console.log('\n[9] 수동 묶기 / 해제');
{
  const sheet = buildSheet(); const ctx = load(sheet);
  ctx.applyDealGroupIds();
  // 6행(단독 D-SOLO)과 7·8행(D-MULTI)을 묶어본다 — 채널이 다르므로 거부돼야 한다
  let r = act(ctx, 'groupDealRows', { rowIndexes: [6, 7] });
  check('채널이 다르면 거부', !!r.error && r.error.indexOf('채널이 서로 다릅니다') >= 0, r.error);

  // 같은 채널 두 행을 새로 만들어 묶기
  const w = HEADERS.length;
  const mk = o => { const x = new Array(w).fill(''); Object.keys(o).forEach(k => { x[k] = o[k]; }); return x; };
  sheet._grid.push(mk({ [C.brand]:'미닉스', [C.product]:'P-A', [C.channel]:'수동채널', [C.code]:'MA',
    [C.year]:2026, [C.startMD]:'2026-07-05', [C.endMD]:'2026-07-07', [C.dealId]:'MAN-1', [C.codeSeq]:1, [C.groupId]:'MAN-1' }));
  sheet._grid.push(mk({ [C.brand]:'미닉스', [C.product]:'P-B', [C.channel]:'수동채널', [C.code]:'MB',
    [C.year]:2026, [C.startMD]:'2026-07-03', [C.endMD]:'2026-07-07', [C.dealId]:'MAN-2', [C.codeSeq]:1, [C.groupId]:'MAN-2' }));
  const rowA = sheet._grid.length - 1, rowB = sheet._grid.length;
  r = act(ctx, 'groupDealRows', { rowIndexes: [rowA, rowB] });
  check('같은 채널이면 묶임', r.success === true, r);
  check('두 행이 같은 그룹ID', sheet._grid[rowA - 1][C.groupId] === sheet._grid[rowB - 1][C.groupId],
    [sheet._grid[rowA - 1][C.groupId], sheet._grid[rowB - 1][C.groupId]]);
  check('대표 행은 시작일이 가장 빠른 행', r.primaryRow === rowB, { got: r.primaryRow, want: rowB });
  check('행을 삭제하지 않음', sheet._grid.length === rowB, sheet._grid.length);

  // 묶인 뒤엔 한 건으로 파싱된다
  const deals = ctx.parseMainSheet(sheet).deals;
  const man = deals.filter(d => d.channel === '수동채널');
  check('한 건으로 묶여 파싱', man.length === 1 && man[0].rowCount === 2, man.map(d => d.rowCount));

  // 해제
  const gid = sheet._grid[rowA - 1][C.groupId];
  const u = act(ctx, 'ungroupDeal', { groupId: gid });
  check('해제 성공', u.success === true && u.count === 2, u);
  check('그룹ID가 각자 dealId로', sheet._grid[rowA - 1][C.groupId] === 'MAN-1' && sheet._grid[rowB - 1][C.groupId] === 'MAN-2',
    [sheet._grid[rowA - 1][C.groupId], sheet._grid[rowB - 1][C.groupId]]);
  const deals2 = ctx.parseMainSheet(sheet).deals;
  check('다시 2건으로 분리', deals2.filter(d => d.channel === '수동채널').length === 2);
  check('해제해도 행은 그대로', sheet._grid.length === rowB, sheet._grid.length);

  check('1개만 선택하면 거부', !!act(ctx, 'groupDealRows', { rowIndexes: [rowA] }).error);
}

console.log('\n[10] 부분 해제 — 고른 행만 그룹에서 빼낸다');
{
  const sheet = buildSheet(); const ctx = load(sheet);
  ctx.applyDealGroupIds();
  const gid = sheet._grid[2][C.groupId];           // 러브지나 3행의 공통 그룹ID
  const rowsBefore = sheet._grid.length;

  // 3행 그룹에서 5행만 빼기 → 3·4행은 묶인 채로 남는다
  let r = act(ctx, 'ungroupRows', { rowIndexes: [5] });
  check('부분 해제 성공', r.success === true && r.count === 1, r);
  check('뺀 행은 자기 dealId로', sheet._grid[4][C.groupId] === 'D-LZ-2', sheet._grid[4][C.groupId]);
  check('남은 행은 그룹 유지', sheet._grid[2][C.groupId] === gid && sheet._grid[3][C.groupId] === gid,
    [sheet._grid[2][C.groupId], sheet._grid[3][C.groupId]]);
  check('행을 삭제하지 않음', sheet._grid.length === rowsBefore, sheet._grid.length);
  let lz = ctx.parseMainSheet(sheet).deals.filter(d => d.channel === '러브지나');
  check('2행 건 + 1행 건으로 갈림', lz.length === 2 && lz.map(d => d.rowCount).sort().join(',') === '1,2',
    lz.map(d => d.rowCount));

  // 남은 2행 중 하나를 더 빼면, 혼자 남는 행도 그룹이 아니게 정리된다
  r = act(ctx, 'ungroupRows', { rowIndexes: [4] });
  check('혼자 남는 행도 정리 대상', (r.freed || []).indexOf(3) >= 0, r.freed);
  check('혼자 남은 행의 그룹ID = 자기 dealId', sheet._grid[2][C.groupId] === 'D-LZ-0', sheet._grid[2][C.groupId]);
  check('러브지나가 3건으로', ctx.parseMainSheet(sheet).deals.filter(d => d.channel === '러브지나').length === 3);
}

console.log('\n[11] 부분 해제 — dealId가 같은 행들이라 새 ID가 필요한 경우');
{
  const sheet = buildSheet(); const ctx = load(sheet);
  ctx.applyDealGroupIds();
  // 7·8행은 예전부터 같은 dealId(D-MULTI)로 묶여 있던 건이다.
  // 그룹ID를 dealId로 되돌리기만 하면 값이 같아 분리가 되지 않으므로 새 ID를 발급해야 한다.
  const r = act(ctx, 'ungroupRows', { rowIndexes: [8] });
  check('성공', r.success === true, r);
  check('뺀 행에 새 dealId 발급', sheet._grid[7][C.dealId] && sheet._grid[7][C.dealId] !== 'D-MULTI',
    sheet._grid[7][C.dealId]);
  check('새 dealId와 그룹ID가 일치', sheet._grid[7][C.groupId] === sheet._grid[7][C.dealId],
    [sheet._grid[7][C.groupId], sheet._grid[7][C.dealId]]);
  check('남은 행은 그대로 D-MULTI', sheet._grid[6][C.dealId] === 'D-MULTI' && sheet._grid[6][C.groupId] === 'D-MULTI');
  const multi = ctx.parseMainSheet(sheet).deals.filter(d => d.product === '더 슬림');
  check('실제로 2건으로 분리', multi.length === 2 && multi.every(d => d.rowCount === 1), multi.map(d => d.rowCount));
}

console.log('\n[12] 부분 해제 — 잘못된 요청은 아무것도 쓰지 않는다');
{
  const sheet = buildSheet(); const ctx = load(sheet);
  ctx.applyDealGroupIds();
  const snap = JSON.stringify(sheet._grid.map(r => r[C.groupId]));
  check('행 지정이 없으면 거부', !!act(ctx, 'ungroupRows', { rowIndexes: [] }).error);
  check('묶이지 않은 행은 거부', !!act(ctx, 'ungroupRows', { rowIndexes: [6] }).error,
    act(ctx, 'ungroupRows', { rowIndexes: [6] }));
  check('헤더 행 번호는 무시', !!act(ctx, 'ungroupRows', { rowIndexes: [2] }).error);
  check('거부된 요청은 시트를 바꾸지 않음',
    JSON.stringify(sheet._grid.map(r => r[C.groupId])) === snap);
}

console.log('\n[13] 그룹 전체를 한 번에 빼면 전체 해제와 같아진다');
{
  const sheet = buildSheet(); const ctx = load(sheet);
  ctx.applyDealGroupIds();
  // 7·8행은 dealId가 둘 다 D-MULTI라, 한꺼번에 빼면 빼낸 행끼리도 값이 겹친다
  const r = act(ctx, 'ungroupRows', { rowIndexes: [7, 8] });
  check('성공', r.success === true && r.count === 2, r);
  check('두 행의 그룹ID가 서로 다름', sheet._grid[6][C.groupId] !== sheet._grid[7][C.groupId],
    [sheet._grid[6][C.groupId], sheet._grid[7][C.groupId]]);
  check('두 행의 dealId도 서로 다름', sheet._grid[6][C.dealId] !== sheet._grid[7][C.dealId],
    [sheet._grid[6][C.dealId], sheet._grid[7][C.dealId]]);
  const multi = ctx.parseMainSheet(sheet).deals.filter(d => d.product === '더 슬림');
  check('2건으로 분리', multi.length === 2 && multi.every(d => d.rowCount === 1), multi.map(d => d.rowCount));
}
console.log('\n--------------------------------\n통과 ' + pass + ' / 실패 ' + fail);
process.exit(fail ? 1 : 0);
