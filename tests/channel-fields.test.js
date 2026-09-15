/* 채널 단위 필드(플랫폼 ID·팔로워 수) 전파 검증.

   지키려는 성질:
     · 채널명은 앞뒤 공백만 제거한 완전 일치 — 대소문자·띄어쓰기 변형은 다른 채널로 본다
     · fillEmpty는 빈 칸만, overwrite는 전부. 값이 안 바뀌면 시트를 건드리지 않는다
     · 쓰기는 필드(열)마다 setValues 한 번
     · Minix 외 행과 다른 채널 행은 절대 건드리지 않는다
     · 시트에 ID 열이 아직 없으면 그 필드만 조용히 건너뛰고 나머지는 정상 동작한다
     · 공구건 저장과 같은 실행에서 처리돼 HTTP 왕복이 늘지 않는다

   실행: node tests/channel-fields.test.js  (또는 node tests/run-all.js) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { makeSheet, installGlobals, STATS, resetStats } = require(path.join(__dirname, 'lib', 'mock-sheets.js'));
const BASE_HEADERS = require(path.join(__dirname, 'lib', 'real-headers.js'));

const GAS_PATH = process.argv[2] || path.join(__dirname, '..', 'apps-script.js');

// 운영 시트 헤더 + 이번에 추가하는 채널 속성 열 2개
const HEADERS = BASE_HEADERS.concat(['인스타 ID', '유튜브 ID']);
const C = { brand:1, product:2, channel:4, platform:5, salesTier:6, followerTier:7, code:9,
  salePrice:10, qty:11, year:14, startMD:15, endMD:16, status:17,
  dealId:44, codeSeq:45, followers:55, igId:56, ytId:57 };

function mkRow(o){ const r = new Array(HEADERS.length).fill(''); Object.keys(o).forEach(k => { r[k] = o[k]; }); return r; }

/* 채널A 3건(각기 다른 상태) + 채널B 1건 + 공백만 다른 유사 채널 + 타사 행 */
function buildSheet(headers){
  headers = headers || HEADERS;
  const w = headers.length;
  const row = o => { const r = new Array(w).fill(''); Object.keys(o).forEach(k => { r[k] = o[k]; }); return r; };
  const g = [new Array(w).fill(''), headers.slice()];
  g.push(row({ [C.brand]:'미닉스', [C.product]:'P1', [C.channel]:'채널A', [C.dealId]:'A1', [C.codeSeq]:1,
    [C.followers]:250000, [C.igId]:'a_insta' }));                       // 3행: 값 있음
  g.push(row({ [C.brand]:'미닉스', [C.product]:'P2', [C.channel]:'채널A', [C.dealId]:'A2', [C.codeSeq]:1 })); // 4행: 전부 빈칸
  g.push(row({ [C.brand]:'미닉스', [C.product]:'P3', [C.channel]:'채널A', [C.dealId]:'A3', [C.codeSeq]:1,
    [C.igId]:'old_insta' }));                                            // 5행: 다른 값
  g.push(row({ [C.brand]:'미닉스', [C.product]:'P4', [C.channel]:'채널B', [C.dealId]:'B1', [C.codeSeq]:1 })); // 6행: 다른 채널
  g.push(row({ [C.brand]:'미닉스', [C.product]:'P5', [C.channel]:'채널 A', [C.dealId]:'S1', [C.codeSeq]:1 })); // 7행: 띄어쓰기 변형
  g.push(row({ [C.brand]:'타사',   [C.product]:'P6', [C.channel]:'채널A', [C.dealId]:'X1', [C.codeSeq]:1 })); // 8행: Minix 아님
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

console.log('\n[1] 열 해석 — 새 ID 열이 인식됨');
{
  const sheet = buildSheet(); const ctx = load(sheet);
  check('인스타 ID 열', ctx.COL.igId === C.igId, ctx.COL.igId);
  check('유튜브 ID 열', ctx.COL.ytId === C.ytId, ctx.COL.ytId);
  check('기존 팔로워 열 그대로', ctx.COL.followers === C.followers, ctx.COL.followers);
}

console.log('\n[2] fillEmpty — 빈 칸만 채움');
{
  const sheet = buildSheet(); const ctx = load(sheet);
  const r = act(ctx, 'updateChannelFields', {
    channel:'채널A', mode:'fillEmpty', fields:{ igId:'new_insta', followers:300000 }
  });
  check('성공', r.success === true, r);
  check('3행 기존 ID 보존', sheet._grid[2][C.igId] === 'a_insta', sheet._grid[2][C.igId]);
  check('3행 기존 팔로워 보존', sheet._grid[2][C.followers] === 250000, sheet._grid[2][C.followers]);
  check('4행 빈칸 채워짐', sheet._grid[3][C.igId] === 'new_insta' && sheet._grid[3][C.followers] === 300000,
    [sheet._grid[3][C.igId], sheet._grid[3][C.followers]]);
  check('5행 다른 값은 유지', sheet._grid[4][C.igId] === 'old_insta', sheet._grid[4][C.igId]);
  check('5행 빈 팔로워는 채워짐', sheet._grid[4][C.followers] === 300000, sheet._grid[4][C.followers]);
  check('다른 채널(채널B) 무시', sheet._grid[5][C.igId] === '' && sheet._grid[5][C.followers] === '');
  check('띄어쓰기 변형(채널 A) 무시', sheet._grid[6][C.igId] === '', sheet._grid[6][C.igId]);
  check('Minix 외 행 무시', sheet._grid[7][C.igId] === '', sheet._grid[7][C.igId]);
}

console.log('\n[3] overwrite — 전부 덮어씀');
{
  const sheet = buildSheet(); const ctx = load(sheet);
  act(ctx, 'updateChannelFields', { channel:'채널A', mode:'overwrite', fields:{ igId:'uni', followers:900000 } });
  [2,3,4].forEach(i => check('행 ' + (i+1) + ' 통일', sheet._grid[i][C.igId] === 'uni' && sheet._grid[i][C.followers] === 900000,
    [sheet._grid[i][C.igId], sheet._grid[i][C.followers]]));
  check('다른 채널은 여전히 무시', sheet._grid[5][C.igId] === '');
  check('Minix 외 행도 여전히 무시', sheet._grid[7][C.igId] === '');
}

console.log('\n[4] 쓰기 횟수 — 필드(열)당 setValues 1회');
{
  const sheet = buildSheet(); const ctx = load(sheet);
  resetStats();
  act(ctx, 'updateChannelFields', { channel:'채널A', mode:'overwrite', fields:{ igId:'x', ytId:'y', followers:1 } });
  const sv = sheet._calls.filter(c => c.op === 'setValues');
  check('setValues 3회(필드 3개)', sv.length === 3, sv.map(x => x.c));
  check('셀 단위 setValue 없음', sheet._calls.filter(c => c.op === 'setValue').length === 0);
}

console.log('\n[5] 바뀔 값이 없으면 아무것도 쓰지 않음');
{
  const sheet = buildSheet(); const ctx = load(sheet);
  act(ctx, 'updateChannelFields', { channel:'채널A', mode:'overwrite', fields:{ igId:'same' } });
  sheet._calls.length = 0;
  const r = act(ctx, 'updateChannelFields', { channel:'채널A', mode:'overwrite', fields:{ igId:'same' } });
  check('written = 0', r.written === 0, r);
  check('setValues 0회', sheet._calls.filter(c => c.op === 'setValues').length === 0);
}

console.log('\n[6] ID 열이 아직 없는 시트 — 그 필드만 건너뛰고 나머지는 동작');
{
  const sheet = buildSheet(BASE_HEADERS); // 인스타/유튜브 ID 열 없음
  const ctx = load(sheet);
  check('igId 미해석(-1)', ctx.COL.igId === -1, ctx.COL.igId);
  const r = act(ctx, 'updateChannelFields', { channel:'채널A', mode:'overwrite', fields:{ igId:'x', followers:123000 } });
  check('성공(에러 아님)', r.success === true, r);
  check('건너뛴 필드 보고', (r.skippedFields || []).indexOf('igId') >= 0, r.skippedFields);
  check('팔로워는 정상 전파', sheet._grid[2][C.followers] === 123000 && sheet._grid[3][C.followers] === 123000,
    [sheet._grid[2][C.followers], sheet._grid[3][C.followers]]);
}

console.log('\n[7] 공구건 저장과 같은 실행에서 전파 (HTTP 왕복 1회 유지)');
{
  const sheet = buildSheet(); const ctx = load(sheet);
  const r = act(ctx, 'updateDeal', {
    dealId:'A1', changes:{ product:'P1x' }, codes:['' ],
    tiers:{ salesTier:'마이크로', followerTier:'매크로' },
    channelFields:{ channel:'채널A', mode:'overwrite', fields:{ igId:'merged', followers:500000 } }
  });
  check('저장 성공', r.success === true, r);
  check('본문 변경 반영', sheet._grid[2][C.product] === 'P1x', sheet._grid[2][C.product]);
  check('전파 결과 반환', r.channelFields && r.channelFields.written >= 2, r.channelFields);
  check('다른 건에도 전파', sheet._grid[3][C.igId] === 'merged' && sheet._grid[4][C.igId] === 'merged',
    [sheet._grid[3][C.igId], sheet._grid[4][C.igId]]);
  check('전파된 행에도 G·H 등급 기록', sheet._grid[3][C.salesTier] === '마이크로' && sheet._grid[3][C.followerTier] === '매크로',
    [sheet._grid[3][C.salesTier], sheet._grid[3][C.followerTier]]);
  check('편집한 건의 G·H도 기록', sheet._grid[2][C.salesTier] === '마이크로');
  check('전파 대상 dealId 목록 반환', (r.cachePatches || []).length >= 1, r.cachePatches);
}

console.log('\n[8] 팔로워 정규화 — 콤마 문자열, 빈값');
{
  const sheet = buildSheet(); const ctx = load(sheet);
  act(ctx, 'updateChannelFields', { channel:'채널A', mode:'overwrite', fields:{ followers:'1,200,000' } });
  check('콤마 제거 후 숫자', sheet._grid[2][C.followers] === 1200000, sheet._grid[2][C.followers]);
  act(ctx, 'updateChannelFields', { channel:'채널A', mode:'overwrite', fields:{ followers:'' } });
  check('빈값은 셀 비움', sheet._grid[2][C.followers] === '', sheet._grid[2][C.followers]);
}

console.log('\n[9] ID 정규화 — 앞의 @와 공백만 정리, 대소문자는 보존');
{
  const sheet = buildSheet(); const ctx = load(sheet);
  act(ctx, 'updateChannelFields', { channel:'채널A', mode:'overwrite', fields:{ igId:'  @Minnie.Life ' } });
  check('@와 공백 제거, 대소문자 보존', sheet._grid[2][C.igId] === 'Minnie.Life', sheet._grid[2][C.igId]);
}

console.log('\n[10] parseMainSheet가 ID를 내려줌');
{
  const sheet = buildSheet(); const ctx = load(sheet);
  const deals = ctx.parseMainSheet(sheet).deals;
  const a1 = deals.find(d => d.dealId === 'A1');
  check('igId 전달', a1.igId === 'a_insta', a1.igId);
  check('ytId 빈값', a1.ytId === '', a1.ytId);
}

console.log('\n--------------------------------\n통과 ' + pass + ' / 실패 ' + fail);
process.exit(fail ? 1 : 0);
