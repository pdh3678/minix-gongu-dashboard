/* 링크 → 플랫폼 ID 역추출(GAS) + 채널 정보 미입력 목록(프론트).

   배경: 인플루언서 링크 열(AP)에는 주소가 들어 있는데 인스타/유튜브 ID 열은 빈 채로 쌓인 행이
   많다. 링크가 곧 ID라서 사람이 다시 칠 이유가 없다 — 한 번에 역추출해 채운다.

   지키려는 성질:
     · 판정은 **주소의 호스트** 기준 — 플랫폼 열의 표기 흔들림('인스타'·'IG')과 무관해야 한다
     · 게시물/영상/단축 URL처럼 계정명이 아닌 주소는 **절대 쓰지 않고** 건너뛴 이유를 남긴다
     · 뽑은 값은 같은 채널(앞뒤 공백만 제거한 완전 일치)의 빈 칸에도 전파된다
     · 시트에 이미 값이 있으면 그 값이 이긴다 — 링크에서 뽑은 값이 달라도 덮지 않는다
     · Minix 외 행·다른 채널 행은 건드리지 않는다. 미리보기(dryRun)는 시트를 전혀 쓰지 않는다
     · 쓰기는 열(igId/ytId)마다 setValues 한 번
     · 프론트: ID가 한쪽만 있어도 "입력됨"으로 본다(채널은 보통 한 플랫폼이다)
     · 프론트: 미입력 목록은 공구 횟수 많은 순

   실행: node tests/id-from-link.test.js  (또는 node tests/run-all.js) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { makeSheet, installGlobals, STATS, resetStats } = require(path.join(__dirname, 'lib', 'mock-sheets.js'));
const BASE_HEADERS = require(path.join(__dirname, 'lib', 'real-headers.js'));
const { loadFrontend } = require(path.join(__dirname, 'lib', 'front-sandbox.js'));

const PROJ = process.argv[2] || path.join(__dirname, '..');
const GAS_PATH = path.join(PROJ, 'apps-script.js');

const HEADERS = BASE_HEADERS;
const C = { brand:1, product:2, channel:4, platform:5, igId:39, ytId:40, link:41,
  dealId:44, codeSeq:45, followers:55 };

let pass = 0, fail = 0;
function check(l, c, extra) {
  if (c) { pass++; console.log('  PASS  ' + l); }
  else { fail++; console.log('  FAIL  ' + l + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

/* 링크만 있고 ID는 빈 행들 — 뽑히는 것/안 뽑히는 것/시트 값이 이기는 것을 한 시트에 모아둔다.
   행 번호는 3부터(2행이 헤더). */
function buildSheet() {
  const w = HEADERS.length;
  const row = o => { const r = new Array(w).fill(''); Object.keys(o).forEach(k => { r[k] = o[k]; }); return r; };
  const g = [new Array(w).fill(''), HEADERS.slice()];
  const add = (brand, product, ch, extra) =>
    g.push(row(Object.assign({ [C.brand]:brand, [C.product]:product, [C.channel]:ch,
      [C.dealId]:product, [C.codeSeq]:1 }, extra || {})));

  // 3행: 인스타 프로필 주소 — 뽑힌다
  add('미닉스', 'P1', '하늘마켓', { [C.link]:'https://www.instagram.com/haneul_market/', [C.platform]:'인스타' });
  // 4행: 같은 채널인데 링크도 ID도 없다 — 전파로 채워져야 한다
  add('미닉스', 'P2', '하늘마켓', {});
  // 5행: 유튜브 핸들 + 쿼리스트링 — 뽑힌다
  add('미닉스', 'P3', '이제이쿡', { [C.link]:'https://www.youtube.com/@cookej?si=abc', [C.platform]:'유튜브 쇼츠' });
  // 6행: 인스타 게시물 주소 — 건너뛴다
  add('미닉스', 'P4', '게시물채널', { [C.link]:'https://www.instagram.com/p/Cabc123/' });
  // 7행: 단축 URL — 건너뛴다
  add('미닉스', 'P5', '단축채널', { [C.link]:'https://bit.ly/xyz' });
  // 8행: 링크에서는 from_link가 나오지만…
  add('미닉스', 'P6', '수동채널', { [C.link]:'https://www.instagram.com/from_link/' });
  // 9행: …같은 채널의 다른 행에 사람이 넣은 값이 있다 — 이쪽이 이긴다
  add('미닉스', 'P7', '수동채널', { [C.igId]:'manual_id' });
  // 10행: 타사 행 — 채널명이 같아도 건드리지 않는다
  add('타사', 'P8', '하늘마켓', { [C.link]:'https://www.instagram.com/other/' });
  // 11행: /channel/ 형태 — 뽑힌다
  add('미닉스', 'P9', '채널형', { [C.link]:'https://www.youtube.com/channel/UC123abc' });
  // 12행: 영상 주소 — 건너뛴다
  add('미닉스', 'P10', '영상채널', { [C.link]:'https://www.youtube.com/watch?v=abc' });
  return makeSheet('실적통합', g);
}
function load(sheet) {
  installGlobals({ '실적통합': sheet }, {});
  const ctx = vm.createContext(global);
  vm.runInContext(fs.readFileSync(GAS_PATH, 'utf8'), ctx, { filename: 'apps-script.js' });
  ctx._resolveCols(sheet);
  return ctx;
}
const cell = (sheet, r, c) => sheet.getRange(r, c + 1).getValue();

console.log('\n[1] 주소 한 줄 → ID (호스트 기준 판정)');
{
  const ctx = load(buildSheet());
  const ex = ctx._extractIdFromLinkGas;
  const ok = (url, kind, id) => {
    const g = ex(url);
    check(url + ' → ' + kind + '/' + id, g.kind === kind && g.id === id, g);
  };
  const no = (url, hint) => {
    const g = ex(url);
    check(url + ' → 건너뜀' + (hint ? ' (' + hint + ')' : ''),
      g.kind === '' && !!g.reason && (!hint || g.reason.indexOf(hint) >= 0), g);
  };
  ok('https://www.instagram.com/haneul_market/', 'ig', 'haneul_market');
  ok('instagram.com/abc', 'ig', 'abc');                         // 프로토콜 없이도
  ok('https://instagram.com/abc?igsh=xyz', 'ig', 'abc');        // 쿼리스트링 제거
  ok('https://www.instagram.com/@abc', 'ig', 'abc');            // 앞의 @ 제거
  ok('https://www.instagram.com/abc/reel/C123/', 'ig', 'abc');  // 계정 하위 경로는 계정명이 앞에 온다
  ok('https://www.youtube.com/@cookej', 'yt', 'cookej');
  ok('https://m.youtube.com/@cookej/videos', 'yt', 'cookej');
  ok('https://www.youtube.com/channel/UC123abc', 'yt', 'UC123abc');
  ok('https://www.youtube.com/c/SomeName', 'yt', 'SomeName');
  ok('https://www.youtube.com/user/SomeName', 'yt', 'SomeName');

  no('https://www.instagram.com/p/Cabc123/', '게시물');
  no('https://www.instagram.com/reel/Cabc123/', '게시물');
  no('https://www.instagram.com/stories/abc/1/', '게시물');
  no('https://www.instagram.com/', '계정명이 없음');
  no('https://www.instagram.com/한글계정/', '형식이 아님');     // 인스타 ID는 영문·숫자·._만
  no('https://www.youtube.com/watch?v=abc', '채널 주소가 아님');
  no('https://www.youtube.com/shorts/abc', '채널 주소가 아님');
  no('https://youtu.be/abc', '영상 단축');
  no('https://bit.ly/xyz', '아님');
  no('https://blog.naver.com/abc', '아님');
  no('', '링크 없음');

  // _buildChannelLinkGas(정방향)이 만든 주소는 반드시 같은 ID로 되돌아와야 한다
  ['minnie.life', 'abc_123'].forEach(id => {
    const back = ex(ctx._buildChannelLinkGas('인스타그램', id, ''));
    check('왕복(인스타) ' + id, back.kind === 'ig' && back.id === id, back);
  });
  ['everyday_fit', 'Cook-EJ'].forEach(id => {
    const back = ex(ctx._buildChannelLinkGas('유튜브', '', id));
    check('왕복(유튜브) ' + id, back.kind === 'yt' && back.id === id, back);
  });
}

console.log('\n[2] 미리보기(dryRun) — 세어만 보고 시트는 건드리지 않는다');
{
  const sheet = buildSheet();
  const ctx = load(sheet);
  resetStats();
  const r = ctx._extractIdsFromLinks(true);
  check('dryRun 표시', r.dryRun === true);
  check('링크에서 ID를 뽑은 채널 4개(하늘마켓·이제이쿡·수동채널·채널형)', r.channels === 4, r.channels);
  check('채울 칸 5개', r.filled === 5, { filled: r.filled, sample: r.sample });
  check('  인스타 3칸(3·4·8행)', r.igFilled === 3, r.igFilled);
  check('  유튜브 2칸(5·11행)', r.ytFilled === 2, r.ytFilled);
  check('건너뛴 링크 3개(게시물·단축·영상)', r.skipped.length === 3, r.skipped.map(s => s.sheetRow));
  check('건너뛴 행마다 이유가 붙는다', r.skipped.every(s => !!s.reason), r.skipped);
  check('샘플은 5개까지', r.sample.length <= 5 && r.sample.length > 0, r.sample.length);
  check('시트에 아무것도 쓰지 않음', STATS.writes === 0, STATS.detail);
  check('시트 값 그대로', cell(sheet, 3, C.igId) === '' && cell(sheet, 5, C.ytId) === '');
}

console.log('\n[3] 실행 — 링크에서 뽑고, 같은 채널의 빈 칸에 전파');
{
  const sheet = buildSheet();
  const ctx = load(sheet);
  resetStats();
  const r = ctx._extractIdsFromLinks(false);
  check('3행 하늘마켓 igId', cell(sheet, 3, C.igId) === 'haneul_market', cell(sheet, 3, C.igId));
  check('4행 — 링크가 없어도 같은 채널이라 전파됨', cell(sheet, 4, C.igId) === 'haneul_market', cell(sheet, 4, C.igId));
  check('5행 이제이쿡 ytId', cell(sheet, 5, C.ytId) === 'cookej', cell(sheet, 5, C.ytId));
  check('11행 /channel/ 형태도 ytId', cell(sheet, 11, C.ytId) === 'UC123abc', cell(sheet, 11, C.ytId));
  check('igId를 넣은 행의 ytId는 비운 채로 둔다', cell(sheet, 3, C.ytId) === '', cell(sheet, 3, C.ytId));
  check('반환값 filled=5', r.filled === 5, r.filled);
}

console.log('\n[4] 건드리면 안 되는 것들');
{
  const sheet = buildSheet();
  const ctx = load(sheet);
  ctx._extractIdsFromLinks(false);
  check('6행 인스타 게시물 주소 — 그대로 빈칸', cell(sheet, 6, C.igId) === '' && cell(sheet, 6, C.ytId) === '');
  check('7행 단축 URL — 그대로 빈칸', cell(sheet, 7, C.igId) === '' && cell(sheet, 7, C.ytId) === '');
  check('12행 영상 주소 — 그대로 빈칸', cell(sheet, 12, C.ytId) === '' && cell(sheet, 12, C.igId) === '');
  check('10행 타사 — 채널명이 같아도 안 건드림', cell(sheet, 10, C.igId) === '', cell(sheet, 10, C.igId));
  check('링크 열은 한 칸도 안 바뀜',
    cell(sheet, 3, C.link) === 'https://www.instagram.com/haneul_market/' && cell(sheet, 4, C.link) === '');
}

console.log('\n[5] 시트에 이미 있는 값이 링크보다 우선');
{
  const sheet = buildSheet();
  const ctx = load(sheet);
  const r = ctx._extractIdsFromLinks(false);
  check('9행 사람이 넣은 값은 그대로', cell(sheet, 9, C.igId) === 'manual_id', cell(sheet, 9, C.igId));
  check('8행에는 링크값(from_link)이 아니라 시트값이 전파됨',
    cell(sheet, 8, C.igId) === 'manual_id', cell(sheet, 8, C.igId));
  check('어긋난 채널을 불일치로 보고', r.conflicts.length === 1 && r.conflicts[0].indexOf('수동채널') === 0, r.conflicts);
  check('  보고에 두 값이 다 담김',
    r.conflicts[0].indexOf('manual_id') > 0 && r.conflicts[0].indexOf('from_link') > 0, r.conflicts[0]);
}

console.log('\n[6] 쓰기 횟수 — 열마다 setValues 한 번');
{
  const sheet = buildSheet();
  const ctx = load(sheet);
  resetStats();
  ctx._extractIdsFromLinks(false);
  const sets = STATS.detail.filter(d => d.indexOf('setValues') === 0);
  check('setValues 2회(igId 열 + ytId 열)', sets.length === 2, STATS.detail);

  // 두 번째 실행은 채울 칸이 없으므로 아무것도 쓰지 않는다(멱등)
  resetStats();
  const again = ctx._extractIdsFromLinks(false);
  check('다시 돌려도 채울 칸 0', again.filled === 0, again.filled);
  check('다시 돌리면 쓰기 0회', STATS.writes === 0, STATS.detail);
}

console.log('\n[7] 열이 없는 시트에서도 안전');
{
  const w = HEADERS.length;
  const noId = HEADERS.map(h => (h === '인스타 ID' || h === '유튜브 ID') ? '' : h);
  const g = [new Array(w).fill(''), noId];
  const r0 = new Array(w).fill('');
  r0[C.brand] = '미닉스'; r0[C.product] = 'P1'; r0[C.channel] = '하늘마켓';
  r0[C.link] = 'https://www.instagram.com/haneul_market/';
  g.push(r0);
  const sheet = makeSheet('실적통합', g);
  const ctx = load(sheet);
  resetStats();
  const r = ctx._extractIdsFromLinks(false);
  check('ID 열이 없으면 null을 반환하고 조용히 끝난다', r === null, r);
  check('아무것도 쓰지 않음', STATS.writes === 0, STATS.detail);
}

/* ────────────────────────────── 프론트 ────────────────────────────── */
console.log('\n[8] 프론트 — ID 미입력 판정');
{
  const { ctx, X } = loadFrontend(PROJ);
  X.DATA.splice(0, X.DATA.length, ...ctx.adaptGAS({ purchases: [
    { id:1, dealId:'A1', brand:'Minix', product:'P1', channel:'둘다없음', platform:'인스타', status:'완료' },
    { id:2, dealId:'B1', brand:'Minix', product:'P2', channel:'인스타만', platform:'인스타', igId:'only_ig', status:'완료' },
    { id:3, dealId:'C1', brand:'Minix', product:'P3', channel:'유튜브만', platform:'유튜브', ytId:'only_yt', status:'완료' }
  ], calendarEvents: [] }));
  ctx.invalidateChannelInfo();
  check('둘 다 없으면 미입력', ctx._chIdMissing('둘다없음') === true);
  check('인스타만 있어도 입력된 것으로 본다', ctx._chIdMissing('인스타만') === false);
  check('유튜브만 있어도 입력된 것으로 본다', ctx._chIdMissing('유튜브만') === false);
  check('모르는 채널은 미입력 취급', ctx._chIdMissing('없는채널') === true);
}

console.log('\n[9] 프론트 — 채널 정보 미입력 목록');
{
  const { ctx, X } = loadFrontend(PROJ);
  const deal = (id, ch, extra) => Object.assign(
    { id, dealId: 'D' + id, brand:'Minix', product:'P' + id, channel: ch, platform:'인스타',
      start:'2026-0' + ((id % 9) + 1) + '-01', end:'2026-0' + ((id % 9) + 1) + '-05', status:'완료' }, extra || {});
  X.DATA.splice(0, X.DATA.length, ...ctx.adaptGAS({ purchases: [
    // ID·팔로워 모두 없음 · 공구 3건 → 맨 위
    deal(1, '많이한채널'), deal(2, '많이한채널'), deal(3, '많이한채널'),
    // ID 없음 · 공구 1건
    deal(4, '적게한채널'),
    // ID는 있는데 팔로워가 없음 → 목록에 남는다
    deal(5, '팔로워없음', { igId:'has_ig' }),
    // 둘 다 있음 → 목록에서 빠진다
    deal(6, '다채움', { igId:'done_ig', followers:120000 })
  ], calendarEvents: [] }));
  ctx.invalidateChannelInfo();

  const rows = ctx.pendingChannelInfo();
  const names = rows.map(r => r.ch);
  check('다 채운 채널은 목록에 없다', names.indexOf('다채움') === -1, names);
  check('ID는 있어도 팔로워가 없으면 남는다', names.indexOf('팔로워없음') >= 0, names);
  check('공구 횟수 많은 순', names[0] === '많이한채널', names);
  check('공구 횟수를 센다', rows[0].count === 3, rows[0].count);
  check('플랫폼을 같이 싣는다', rows[0].platforms.join('/') === '인스타', rows[0].platforms);
  check('이미 있는 값은 그대로 실린다',
    rows.find(r => r.ch === '팔로워없음').igId === 'has_ig', rows.find(r => r.ch === '팔로워없음'));
  check('비어 있는 값은 빈 문자열/null', rows[0].igId === '' && rows[0].followers === null, rows[0]);

  // 빈 칸만 편집 대상 — 값이 있는 칸은 클릭 핸들러가 붙지 않는다
  const empty = ctx._mgmtChCell('많이한채널', 'igId', '');
  const filledCell = ctx._mgmtChCell('팔로워없음', 'igId', 'has_ig');
  check('빈 칸은 인라인 편집 가능', empty.indexOf('_startChIdEdit') > 0 && empty.indexOf('chid-cell') > 0, empty);
  check('값 있는 칸은 편집 안 붙고 @표시', filledCell.indexOf('_startChIdEdit') === -1 && filledCell.indexOf('@has_ig') > 0, filledCell);
  check('팔로워 빈 칸도 인라인 편집 가능',
    ctx._mgmtChCell('많이한채널', 'followers', null).indexOf('_startChIdEdit') > 0);

  // 스텁 DOM 위에서도 두 탭 모두 그려진다(예외 없이 끝나는지만 본다)
  let threw = null;
  try { ctx._setMgmtTab('chinfo'); ctx.renderMgmtPage(); ctx._setMgmtTab('perf'); ctx.renderMgmtPage(); }
  catch (e) { threw = e; }
  check('탭 전환·렌더가 예외 없이 끝난다', threw === null, threw && threw.message);
}

console.log('\n' + '─'.repeat(52));
console.log('통과 ' + pass + ' / 실패 ' + fail);
process.exit(fail ? 1 : 0);
