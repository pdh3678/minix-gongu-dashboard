/* 저장 경로 통합 검증 — 프론트(index.html 인라인 스크립트)와 서버(apps-script.js)를 둘 다
   실제로 실행하고, 그 사이의 HTTP만 직결로 대체한다. 즉 낙관적 반영 → GAS 저장 → 응답 병합이
   진짜 코드 두 벌로 돌아간다.

   여기서 지키려는 성질:
     · 저장 클릭 시점에 이미 화면이 새 값이고, 요청은 1회만 나간다(재조회·writeTiers 없음)
     · 시트의 총매출 수식이 값으로 덮이지 않는다 (배치 쓰기가 범위를 잘못 묶으면 바로 깨짐)
     · 실패하면 완전히 롤백되고 사용자가 입력한 값은 남는다
     · 등급을 안 보낸 요청은 시트 G·H를 건드리지 않고, 건드린 척도 하지 않는다

   실행: node tests/save-path.test.js  (또는 node tests/run-all.js) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { makeSheet, installGlobals, STATS, resetStats } = require(path.join(__dirname, 'lib', 'mock-sheets.js'));
const HEADERS = require(path.join(__dirname, 'lib', 'real-headers.js'));
const { loadFrontend } = require(path.join(__dirname, 'lib', 'front-sandbox.js'));

const PROJ = process.argv[2] || path.join(__dirname, '..');

const C = { brand:1, product:2, channel:4, platform:5, salesTier:6, followerTier:7, code:9,
  salePrice:10, qty:11, revenue:12, year:14, startMD:15, endMD:16, status:17,
  targetQty:23, note:25, views:26, dealId:44, codeSeq:45, note2:53, tier:54, followers:55 };

function mkRow(o){ const r = new Array(HEADERS.length).fill(''); Object.keys(o).forEach(k => { r[k] = o[k]; }); return r; }
function buildSheet(){
  const grid = [new Array(HEADERS.length).fill(''), HEADERS.slice()];
  grid.push(mkRow({ [C.brand]:'미닉스', [C.product]:'더 플렌더', [C.channel]:'채널A', [C.platform]:'인스타',
    [C.code]:'AAA', [C.salePrice]:100000, [C.qty]:300, [C.year]:2026, [C.startMD]:'2026-01-10',
    [C.endMD]:'2026-01-15', [C.status]:'완료', [C.dealId]:'D1', [C.codeSeq]:1,
    [C.followers]:250000, [C.revenue]:'=L3*K3' }));   // 수식 보존 검증용
  grid.push(mkRow({ [C.brand]:'미닉스', [C.product]:'더 플렌더', [C.channel]:'채널A',
    [C.code]:'BBB', [C.dealId]:'D1', [C.codeSeq]:2 }));
  return makeSheet('실적통합', grid);
}

// ── 서버 컨텍스트 ──
const sheet = buildSheet();
installGlobals({ '실적통합': sheet }, {});
const gas = vm.createContext(global);
vm.runInContext(fs.readFileSync(path.join(PROJ, 'apps-script.js'), 'utf8'), gas, { filename: 'apps-script.js' });

// ── 프론트 컨텍스트 ──
const { ctx: front, X } = loadFrontend(PROJ);

// 프론트의 _gasWrite를 진짜 GAS 핸들러로 연결 (HTTP만 생략)
const sent = [];
front._getGasUrl = () => 'https://example.test/exec';
front._gasWrite = async (url, action, data) => {
  sent.push(action);
  resetStats();
  const out = JSON.parse(gas._handleWriteAction({ parameter: { action, payload: JSON.stringify(data) } }, ''));
  out.__rpc = { reads: STATS.reads, readCells: STATS.readCells, writes: STATS.writes };
  return out;
};
front.showToast = () => {}; front.closeSchModal = () => {}; front.closeDealForm = () => {};
front.setLoad = () => {}; front._refreshModalHeader = () => {};
front._openRegisteredModal = d => { front.__reopened = d; };
front._reopenDealFormWith = d => { front.__reopenedForm = d; };

let pass = 0, fail = 0;
function check(l, c, extra) {
  if (c) { pass++; console.log('  PASS  ' + l); }
  else { fail++; console.log('  FAIL  ' + l + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

(async () => {
  gas._resolveCols(sheet);
  const parsed = gas.parseMainSheet(sheet);
  const DATA = X.DATA;
  DATA.splice(0, DATA.length, ...front._mergeDuplicateCodeRows(front.adaptGAS({ purchases: parsed.deals, calendarEvents: [] })));
  X.setSyncReady(true);
  front.invalidateTierStats();

  console.log('\n[1] 수정 저장 — 낙관적 반영이 즉시, 요청은 1회');
  const d = DATA[0];
  sent.length = 0;
  const next = { product:'더 플렌더 mini', channel:d.ch, platform:'틱톡', vendor:'', link:'', marketingLink:'',
    start:d.start, end:d.end, format:'', composition:'', targetQty:700, qty:d.qty, option2:'', firstCome:'',
    firstComeQty:'', note:'NPAY 5만원', giftItem1:'', giftQty1:'', giftItem2:'', giftQty2:'', giftItem3:'',
    giftQty3:'', extraQty:null, tier:'', followers:d.followers, sale:d.s.sale, comm:d.s.comm, note2:'수정비고' };
  const changes = { product:next.product, platform:next.platform, targetQty:700, note:next.note, note2:'수정비고' };

  // saveSchemeModal 내부가 실제로 수행하는 순서를 그대로 재현(DOM 의존부만 제외)
  const snap = front._snapshotDeal(d);
  X.savingDeals.set(d.dealId, { snap, at: Date.now() }); // 잠금 값은 {snap, at} 형태
  Object.assign(d, front._dealFieldsFromNext(next, d.codes, false, d.reels, false, null));
  d._saving = true;
  front.invalidateTierStats();
  const tiers = front._tiersForSave(next.channel);
  front._presetTierRows(d, tiers);
  check('모달 닫히는 시점에 목록이 이미 새 값', d.product === '더 플렌더 mini', d.product);
  check('저장 중 표시', front._savingChip(d).indexOf('저장 중') >= 0);
  check('저장 중인 건은 잠김', front.isDealSaving(d.dealId));

  const res = await front._gasWrite('u', 'updateDeal', { dealId:d.dealId, changes, codes:d.codes, tiers });
  check('요청 1회만 나감(재조회·writeTiers 없음)', sent.length === 1 && sent[0] === 'updateDeal', sent);
  check('서버 성공', res.success === true, res);
  check('timings 반환', res.timings && typeof res.timings.total === 'number', res.timings);
  check('행 정보 반환(rowIndex/tierRows)',
    res.rowIndex === 3 && Array.isArray(res.tierRows) && res.tierRows.length === 2, { r:res.rowIndex, t:res.tierRows });
  check('시트 제품명 반영', sheet._grid[2][C.product] === '더 플렌더 mini', sheet._grid[2][C.product]);
  check('시트 등급 G·H 같은 실행에서 기록',
    sheet._grid[2][C.salesTier] === tiers.salesTier && sheet._grid[2][C.followerTier] === tiers.followerTier,
    [sheet._grid[2][C.salesTier], sheet._grid[2][C.followerTier]]);
  check('보조 코드행에도 등급', sheet._grid[3][C.salesTier] === tiers.salesTier);
  check('총매출 수식 보존(값으로 덮이지 않음)', String(sheet._grid[2][C.revenue]).charAt(0) === '=', sheet._grid[2][C.revenue]);
  console.log('    updateDeal RPC:', res.__rpc);

  d._tierRows = res.tierRows; delete d._saving; X.savingDeals.delete(d.dealId);
  check('저장 후 잠금 해제', !front.isDealSaving(d.dealId));

  console.log('\n[2] 저장 직후 등급 동기화가 추가 요청을 만들지 않음');
  front.invalidateTierStats();
  check('보낼 등급 행 0개', front._collectTierWrites().length === 0, front._collectTierWrites());

  console.log('\n[3] 실패 시 롤백 + 입력값 유지 재오픈');
  const d2 = DATA[0];
  const before = front._snapshotDeal(d2);
  X.savingDeals.set(d2.dealId, { snap: before, at: Date.now() });
  Object.assign(d2, front._dealFieldsFromNext({ ...next, product:'더 시프트' }, d2.codes, false, d2.reels, false, null));
  d2._saving = true;
  const attempted = Object.assign({}, d2, { codes:d2.codes, reels:d2.reels });
  front._restoreDeal(d2, before);
  X.savingDeals.delete(d2.dealId);
  check('롤백되어 이전 값 복원', d2.product === '더 플렌더 mini', d2.product);
  check('_saving 플래그 제거', !d2._saving);
  check('재오픈용 객체는 시도값 보존', attempted.product === '더 시프트', attempted.product);

  console.log('\n[4] 신규 등록 — 임시 건은 등급 기록 대상에서 제외');
  const tmp = { dealId:'__tmp_x', id:-1, brand:'Minix', product:'더 시프트', ch:'새채널', influencer:'새채널',
    start:'2026-09-15', end:'2026-09-20', status:'예정', codes:['N1'], reels:[], _saving:true, _tierRows:[],
    s:{ sale:70000, comm:30, note:'' } };
  DATA.push(tmp);
  front.invalidateTierStats();
  check('임시 건(_tierRows 비어있음)은 writeTiers 대상 아님',
    front._collectTierWrites().every(p => p.rowIndex > 0));

  sent.length = 0;
  const newTiers = front._tiersForSave('새채널');
  const addRes = await front._gasWrite('u', 'addSalesRow', Object.assign({}, tmp, { tiers:newTiers }));
  check('등록 요청 1회', sent.length === 1 && sent[0] === 'addSalesRow', sent);
  check('행 번호/등급행 반환', addRes.rowIndex > 0 && addRes.tierRows.length === 1, { r:addRes.rowIndex, t:addRes.tierRows });
  const newRow = sheet._grid[addRes.rowIndex - 1];
  check('신규 행에 제품명', newRow[C.product] === '더 시프트', newRow[C.product]);
  check('신규 행 G·H = 프론트가 보낸 등급 (신규 채널은 미산정이라 빈칸이 정상)',
    newRow[C.salesTier] === newTiers.salesTier && newRow[C.followerTier] === newTiers.followerTier,
    { sheet:[newRow[C.salesTier], newRow[C.followerTier]], sent:newTiers });
  console.log('    addSalesRow RPC:', addRes.__rpc);

  console.log('\n[5] 연달아 저장해도 서로 침범하지 않음');
  const rA = await front._gasWrite('u', 'updateDeal', { dealId:'D1', changes:{ note:'A' }, codes:['AAA','BBB'] });
  const rB = await front._gasWrite('u', 'updateDeal', { dealId:addRes.dealId, changes:{ note:'B' }, codes:['N1'] });
  check('두 저장 모두 성공', rA.success === true && rB.success === true);
  check('각자 자기 행에만 기록',
    sheet._grid[2][C.note] === 'A' && sheet._grid[addRes.rowIndex - 1][C.note] === 'B',
    [sheet._grid[2][C.note], sheet._grid[addRes.rowIndex - 1][C.note]]);

  console.log('\n[6] tiers 없이 저장하면 tierRows를 만들지 않음 (불필요한 writeTiers 방지)');
  const beforeRows = JSON.stringify(DATA[0]._tierRows);
  const beforeSheetTier = sheet._grid[2][C.salesTier];
  const rNo = await front._gasWrite('u', 'updateDeal', { dealId:'D1', changes:{ note:'NOTIER' }, codes:['AAA','BBB'] });
  check('성공', rNo.success === true, rNo);
  check('tierRows를 돌려주지 않음(null)', rNo.tierRows == null, rNo.tierRows);
  check('시트 G·H는 손대지 않음', sheet._grid[2][C.salesTier] === beforeSheetTier, sheet._grid[2][C.salesTier]);
  if (rNo && Array.isArray(rNo.tierRows) && rNo.tierRows.length) DATA[0]._tierRows = rNo.tierRows; // 프론트 병합 규칙 그대로
  check('로컬 _tierRows 유지', JSON.stringify(DATA[0]._tierRows) === beforeRows, DATA[0]._tierRows);
  front.invalidateTierStats();
  check('추가 writeTiers 대기 없음', front._collectTierWrites().length === 0, front._collectTierWrites());


  console.log('\n[7] 릴스 — 실제로 바뀐 경우에만 한 요청에 실려 감');
  check('같은 내용이면 변경 아님',
    front._reelsChanged([{url:'u1',views:3,thumb:''}], [{url:'u1',views:3,thumb:''}]) === false);
  check('조회수가 다르면 변경', front._reelsChanged([{url:'u1',views:3}], [{url:'u1',views:5}]) === true);
  check('개수가 다르면 변경', front._reelsChanged([{url:'u1',views:3}], []) === true);
  check('둘 다 비어 있으면 변경 아님', front._reelsChanged([], []) === false);
  check('빈 배열 vs undefined도 변경 아님', front._reelsChanged(undefined, []) === false);

  // 릴스를 실어 보내면 같은 실행에서 기록된다
  sent.length = 0;
  const rReel = await front._gasWrite('u', 'updateDeal', {
    dealId:'D1', changes:{ note:'릴스같이' }, codes:['AAA','BBB'], tiers,
    reels:[{ url:'https://r1', views:4, thumb:'' }, { url:'', views:6, thumb:'' }]
  });
  check('요청은 여전히 1회(saveReels 별도 호출 없음)', sent.length === 1 && sent[0] === 'updateDeal', sent);
  // 슬롯0은 URL이 있어 하이퍼링크(setRichTextValue)로 들어가고, 목은 그 호출만 기록한다 —
  // 그리드 값으로는 확인할 수 없으므로 "올바른 열에 리치텍스트를 썼는지"로 본다.
  const reelRich = sheet._calls.filter(x => x.op === 'setRichTextValue' && x.r === 3);
  check('슬롯0은 하이퍼링크로 기록(릴스 시작 열)',
    reelRich.some(x => x.c === C.views + 2), reelRich.map(x => x.c));
  check('슬롯1은 값으로 기록', sheet._grid[2][C.views + 2] === 6, sheet._grid[2][C.views + 2]);
  check('조회수 합계 갱신(4+6=10)', sheet._grid[2][C.views] === 10, sheet._grid[2][C.views]);
  check('reelsSaved 보고', rReel.reelsSaved === 2, rReel.reelsSaved);

  // 릴스를 안 실어 보내면 슬롯도 합계도 그대로여야 한다 (여기가 깨지면 조회수가 조용히 사라진다)
  const viewsBefore = sheet._grid[2][C.views];
  const slot1Before = sheet._grid[2][C.views + 1];
  const rNoReel = await front._gasWrite('u', 'updateDeal', {
    dealId:'D1', changes:{ note:'릴스없이' }, codes:['AAA','BBB'], tiers
  });
  check('reels 없으면 reelsSaved=null', rNoReel.reelsSaved === null, rNoReel.reelsSaved);
  check('조회수 합계 보존', sheet._grid[2][C.views] === viewsBefore, [sheet._grid[2][C.views], viewsBefore]);
  check('릴스 슬롯 보존', sheet._grid[2][C.views + 1] === slot1Before, [sheet._grid[2][C.views + 1], slot1Before]);
  check('본문 변경은 반영됨', sheet._grid[2][C.note] === '릴스없이', sheet._grid[2][C.note]);
  console.log('\n--------------------------------\n통과 ' + pass + ' / 실패 ' + fail);
  process.exit(fail ? 1 : 0);
})();
