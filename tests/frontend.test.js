/* 프론트엔드 단위 검증 — 배포되는 index.html의 인라인 스크립트를 그대로 실행해서,
   서버 응답 → 공구건 객체 변환 → 등급 산정 → 시트 기록 payload 생성까지를 확인한다.
   네트워크는 _gasWrite를 가로채는 것으로만 대체하고, 나머지는 전부 실제 코드다.

   실행: node tests/frontend.test.js  (또는 node tests/run-all.js) */
const path = require('path');
const { loadFrontend } = require(path.join(__dirname, 'lib', 'front-sandbox.js'));

const PROJ = process.argv[2] || path.join(__dirname, '..');
const { ctx, X } = loadFrontend(PROJ);

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

(async () => {
  console.log('\n[1] 스크립트가 예외 없이 로드되고 주요 함수가 존재');
  ['syncTiersToSheet', '_collectTierWrites', '_tierCellsFor', '_dealFieldsFromNext',
   '_snapshotDeal', '_restoreDeal', '_tiersForSave', '_presetTierRows', 'isDealSaving']
    .forEach(fn => check(fn + ' 정의됨', typeof ctx[fn] === 'function', typeof ctx[fn]));
  /* 두 버전 문자열은 일부러 독립이다 — DASHBOARD_VERSION은 프론트 전용이고,
     REQUIRED_SCRIPT_VERSION은 "이 프론트가 의존하는 최소 Apps Script 배포본"이다.
     프론트만 고친 경우에도 GAS 재배포를 강요하지 않으려고 분리해 둔 것이라, 둘이 같은지를
     단언하면 안 된다. 여기서는 "둘 다 채워져 있는지"만 본다. */
  check('버전 문자열이 둘 다 설정됨',
    !!X.DASHBOARD_VERSION && !!X.REQUIRED_SCRIPT_VERSION,
    { dash: X.DASHBOARD_VERSION, req: X.REQUIRED_SCRIPT_VERSION });

  console.log('\n[2] adaptGAS가 서버 tierRows를 그대로 받아옴');
  const payload = {
    purchases: [
      { id: 3, dealId: 'D1', brand: 'Minix', product: '더 플렌더', channel: '채널A', platform: '인스타',
        start: '2026-01-10', end: '2026-01-15', status: '완료', qty: 300, sale: 100000, revenue: 300000000,
        followers: 250000, codes: ['AAA', 'BBB'], rowCount: 2, tierRows: [[3, '', ''], [4, '', '']] },
      { id: 5, dealId: 'D2', brand: 'Minix', product: '더 시프트', channel: '채널B', platform: '유튜브',
        start: '2026-02-01', end: '2026-02-05', status: '완료', qty: 100, sale: 50000, revenue: 5000000,
        codes: ['CCC'], rowCount: 1, tierRows: [[5, '', '']] },
      { id: 7, dealId: 'D3', brand: 'Minix', product: '더 플렌더', channel: '채널A', platform: '인스타',
        start: '2026-03-01', end: '2026-03-05', status: '예정', codes: ['DDD'], rowCount: 1, tierRows: [[7, '', '']] }
    ],
    calendarEvents: []
  };
  const adapted = ctx.adaptGAS(payload);
  check('_tierRows 전달됨',
    JSON.stringify(adapted[0]._tierRows) === JSON.stringify([[3, '', ''], [4, '', '']]), adapted[0]._tierRows);
  check('tierRows 없는 응답이면 빈 배열',
    JSON.stringify(ctx.adaptGAS({ purchases: [{ id: 1 }] })[0]._tierRows) === '[]');

  console.log('\n[3] 내용 기준으로 병합된 건도 모든 행을 유지');
  const merged = ctx._mergeDuplicateCodeRows(ctx.adaptGAS({
    purchases: [
      { id: 10, dealId: 'X1', brand: 'Minix', product: '더 슬림', channel: '채널C',
        start: '2026-04-01', end: '2026-04-02', codes: ['A'], rowCount: 1, tierRows: [[10, '', '']] },
      { id: 11, dealId: 'X2', brand: 'Minix', product: '더 슬림', channel: '채널C',
        start: '2026-04-01', end: '2026-04-02', codes: ['B'], rowCount: 1, tierRows: [[11, '', '']] }
    ]
  }));
  check('내용 기준 병합 후 1건', merged.length === 1, merged.length);
  check('두 dealId의 행이 모두 살아남음',
    JSON.stringify(merged[0]._tierRows) === JSON.stringify([[10, '', ''], [11, '', '']]), merged[0]._tierRows);

  console.log('\n[4] _collectTierWrites — 채널의 모든 행에 같은 등급');
  const DATA = X.DATA;
  DATA.splice(0, DATA.length, ...ctx._mergeDuplicateCodeRows(adapted));
  ctx.invalidateTierStats();
  const stA = ctx.tierStatOf('채널A'), stB = ctx.tierStatOf('채널B');
  console.log('    채널A: 매출등급=' + stA.effective + ' 팔로워등급=' + stA.followerTier +
              ' / 채널B: 매출등급=' + stB.effective + ' 팔로워등급=' + stB.followerTier);
  const writes = ctx._collectTierWrites();
  const byRow = {}; writes.forEach(w => { byRow[w.rowIndex] = [w.salesTier, w.followerTier]; });
  check('채널A 3행 + 채널B 1행 = 4행', writes.length === 4, writes.length);
  check('3·4·7행(채널A)이 전부 같은 값',
    JSON.stringify(byRow[3]) === JSON.stringify(byRow[4]) &&
    JSON.stringify(byRow[4]) === JSON.stringify(byRow[7]), byRow);
  check('채널A 매출등급 = 산정값과 일치', byRow[3][0] === stA.effective, byRow[3]);
  check('채널A 팔로워등급 = 매크로(25만)', byRow[3][1] === '매크로', byRow[3][1]);
  check('채널B 팔로워 미입력 → 빈 문자열', byRow[5][1] === '', byRow[5]);
  check('진행예정 건의 행도 채널 등급을 받음', byRow[7] !== undefined, Object.keys(byRow));

  console.log('\n[5] 전송 payload 형태 + 성공 후 재전송 없음');
  let sent = null;
  X.setSyncReady(true);
  ctx._getGasUrl = () => 'https://example.test/exec';
  ctx._gasWrite = async (url, action, data) => { sent = { url, action, data }; return { success: true, written: data.rows.length }; };
  await ctx.syncTiersToSheet();
  check('action = writeTiers', sent && sent.action === 'writeTiers', sent && sent.action);
  check('payload = {rows:[{rowIndex,salesTier,followerTier}]}',
    sent && Array.isArray(sent.data.rows) && sent.data.rows.length === 4 &&
    Object.keys(sent.data.rows[0]).sort().join(',') === 'followerTier,rowIndex,salesTier',
    sent && sent.data.rows[0]);
  check('내부용 _cell은 payload에 안 실림', sent && sent.data.rows[0]._cell === undefined);

  sent = null;
  await ctx.syncTiersToSheet();
  check('두 번째 호출은 보낼 게 없어 요청 자체가 안 나감', sent === null, sent);

  console.log('\n[6] 실패해도 조용히 1회 재시도 후 경고만');
  let attempts = 0;
  ctx._gasWrite = async () => { attempts++; return { error: '일시 실패' }; };
  DATA[0]._tierRows[0][1] = '엉뚱한값'; // 다시 보낼 거리를 만듦
  let threw = false;
  try { await ctx.syncTiersToSheet(); } catch (e) { threw = true; }
  check('예외가 밖으로 새지 않음', !threw);
  check('정확히 2회 시도(최초 + 재시도 1회)', attempts === 2, attempts);

  console.log('\n[7] fetchLive 성공 전에는 시트에 쓰지 않음');
  X.setSyncReady(false);
  attempts = 0;
  await ctx.syncTiersToSheet();
  check('_tierSyncReady=false면 요청 없음', attempts === 0, attempts);

  console.log('\n--------------------------------\n통과 ' + pass + ' / 실패 ' + fail);
  process.exit(fail ? 1 : 0);
})();
