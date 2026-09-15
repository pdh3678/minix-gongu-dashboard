/* 채널 단위 필드 — 프론트 동작 검증(모델·전파 계획·불일치 판정·로컬 반영).
   index.html의 인라인 스크립트를 그대로 실행한다.

   실행: node tests/channel-front.test.js  (또는 node tests/run-all.js) */
const path = require('path');
const { loadFrontend } = require(path.join(__dirname, 'lib', 'front-sandbox.js'));

const PROJ = process.argv[2] || path.join(__dirname, '..');
const { ctx, X } = loadFrontend(PROJ);

let pass = 0, fail = 0;
function check(l, c, extra) {
  if (c) { pass++; console.log('  PASS  ' + l); }
  else { fail++; console.log('  FAIL  ' + l + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

// 채널A 3건(값 있음 / 빈칸 / 다른 값), 채널B 1건, 띄어쓰기 변형 1건
function seed() {
  const DATA = X.DATA;
  DATA.splice(0, DATA.length, ...ctx.adaptGAS({ purchases: [
    { id:3, dealId:'A1', brand:'Minix', product:'P1', channel:'채널A', start:'2026-01-10', end:'2026-01-15',
      status:'완료', qty:10, sale:1000, revenue:10000, igId:'a_insta', followers:250000, codes:['x'], rowCount:1, tierRows:[[3,'','']] },
    { id:4, dealId:'A2', brand:'Minix', product:'P2', channel:'채널A', start:'2026-02-10', end:'2026-02-15',
      status:'완료', codes:['y'], rowCount:1, tierRows:[[4,'','']] },
    { id:5, dealId:'A3', brand:'Minix', product:'P3', channel:'채널A', start:'2026-03-10', end:'2026-03-15',
      status:'완료', igId:'old_insta', codes:['z'], rowCount:1, tierRows:[[5,'','']] },
    { id:6, dealId:'B1', brand:'Minix', product:'P4', channel:'채널B', start:'2026-01-20', end:'2026-01-25',
      status:'완료', igId:'b_insta', codes:['w'], rowCount:1, tierRows:[[6,'','']] },
    { id:7, dealId:'S1', brand:'Minix', product:'P5', channel:'채널 A', start:'2026-01-30', end:'2026-02-02',
      status:'완료', codes:['v'], rowCount:1, tierRows:[[7,'','']] }
  ], calendarEvents: [] }));
  ctx.invalidateChannelInfo();
  return DATA;
}

console.log('\n[1] 채널 판정 — 앞뒤 공백만 제거한 완전 일치');
{
  seed();
  const a = ctx.channelInfoOf('채널A');
  check('채널A 3건으로 집계', a.total === 3, a.total);
  check('앞뒤 공백은 같은 채널로 취급', ctx.channelInfoOf('  채널A  ').total === 3);
  check('띄어쓰기 변형은 다른 채널', ctx.channelInfoOf('채널 A').total === 1, ctx.channelInfoOf('채널 A').total);
  check('없는 채널은 null', ctx.channelInfoOf('없음') === null);
}

console.log('\n[2] 필드별 현황 — 최근 값 / 빈칸 / 충돌');
{
  seed();
  const f = ctx.channelInfoOf('채널A').fields.igId;
  check('최근 값 = 가장 나중 건의 값', f.latest === 'old_insta', f.latest);
  check('값이 있는 건 2건', f.filled === 2, f.filled);
  check('빈 건 1건', f.empty === 1, f.empty);
  check('최근 값과 다른 건 1건(a_insta)', f.conflicts.length === 1 && f.conflicts[0].value === 'a_insta', f.conflicts);
  const fo = ctx.channelInfoOf('채널A').fields.followers;
  check('팔로워 최근 값', fo.latest === '250000', fo.latest);
  check('팔로워 빈 건 2건', fo.empty === 2, fo.empty);
}

console.log('\n[3] 불일치 판정 + 배지');
{
  seed();
  check('채널A는 불일치', ctx.channelInfoOf('채널A').mismatch === true);
  check('채널B는 불일치 아님(1건뿐)', ctx.channelInfoOf('채널B').mismatch === false);
  check('배지 노출', ctx._chMismatchBadge('채널A').indexOf('채널 정보 불일치') > 0);
  check('정상 채널은 배지 없음', ctx._chMismatchBadge('채널B') === '');
  // 값이 아무 데도 없으면 "불일치"가 아니라 그냥 미입력
  check('전부 비어 있으면 불일치 아님', ctx.channelInfoOf('채널 A').mismatch === false);
}

console.log('\n[4] 값 정규화 — 비교 기준이 시트와 같아야 함');
{
  check('@와 공백 제거, 대소문자 보존', ctx._chFieldNorm('igId', '  @Minnie.Life ') === 'Minnie.Life');
  check('팔로워는 콤마 제거 후 정수 문자열', ctx._chFieldNorm('followers', '1,200,000') === '1200000');
  check('빈값은 빈 문자열', ctx._chFieldNorm('followers', '') === '' && ctx._chFieldNorm('igId', null) === '');
  check('음수 팔로워는 무효', ctx._chFieldNorm('followers', '-5') === '');
}

console.log('\n[5] 전파 계획 — 충돌 없으면 묻지 않고 빈 칸만');
{
  seed();
  // 충돌 0건인 상황을 만든다: 최근 값과 같은 값으로 채우는 경우
  const plan = { igId: { empty: 2, conflicts: [] } };
  check('충돌 없으면 fillEmpty로 자동 결정', ctx._askChannelPropagateMode('채널A', plan, 3) === 'fillEmpty');
}

console.log('\n[6] 확인 팝업 — 충돌이 있으면 물어보고 선택을 그대로 반영');
{
  seed();
  const plan = { igId: { empty: 1, conflicts: [{ dealId:'A1', product:'P1', start:'2026-01-10', end:'2026-01-15', value:'a_insta' }] } };
  let asked = [];
  ctx.confirm = (m) => { asked.push(m); return true; };            // 첫 confirm = 전체 덮어쓰기
  check('전체 덮어쓰기 선택', ctx._askChannelPropagateMode('채널A', plan, 3) === 'overwrite');
  check('문구에 건수 안내', /같은 채널 공구건 3건 중 빈 칸 1건에 반영됩니다/.test(asked[0]), asked[0]);
  check('문구에 덮어쓸 건수', /다른 값이 있는 1건도 덮어쓸까요/.test(asked[0]));
  check('충돌 행의 기간·현재값 표시', asked[0].indexOf('a_insta') > 0 && asked[0].indexOf('P1') > 0, asked[0]);

  asked = [];
  let n = 0;
  ctx.confirm = () => { n++; return n !== 1; };                     // 1번째 취소, 2번째 확인 → 빈 칸만
  check('빈 칸만 선택', ctx._askChannelPropagateMode('채널A', plan, 3) === 'fillEmpty');

  n = 0;
  ctx.confirm = () => false;                                       // 둘 다 취소 → 이 건만
  check('이 건만 선택', ctx._askChannelPropagateMode('채널A', plan, 3) === 'thisOnly');
}

console.log('\n[7] 로컬 전파 — 서버와 같은 규칙');
{
  const DATA = seed();
  ctx._applyChannelFieldsLocally('채널A', { igId: 'newid' }, 'fillEmpty', 'A1');
  check('빈 건은 채워짐', DATA.find(d => d.dealId === 'A2').igId === 'newid');
  check('다른 값 있는 건은 유지', DATA.find(d => d.dealId === 'A3').igId === 'old_insta');
  check('편집 중인 건은 항상 반영', DATA.find(d => d.dealId === 'A1').igId === 'newid');
  check('다른 채널은 그대로', DATA.find(d => d.dealId === 'B1').igId === 'b_insta');
  check('띄어쓰기 변형 채널은 그대로', DATA.find(d => d.dealId === 'S1').igId === '');

  seed();
  ctx._applyChannelFieldsLocally('채널A', { igId: 'uni' }, 'overwrite', null);
  check('overwrite는 전부 덮어씀',
    ['A1','A2','A3'].every(id => X.DATA.find(d => d.dealId === id).igId === 'uni'));
  check('overwrite도 다른 채널은 안 건드림', X.DATA.find(d => d.dealId === 'B1').igId === 'b_insta');
}

console.log('\n[8] 통일 후에는 불일치가 사라짐');
{
  seed();
  check('통일 전 불일치', ctx.channelInfoOf('채널A').mismatch === true);
  ctx._applyChannelFieldsLocally('채널A', { igId: 'old_insta', followers: '250000' }, 'overwrite', null);
  ctx.invalidateChannelInfo();
  check('통일 후 불일치 해소', ctx.channelInfoOf('채널A').mismatch === false, ctx.channelInfoOf('채널A').fields);
  check('배지도 사라짐', ctx._chMismatchBadge('채널A') === '');
}

console.log('\n[9] 등급 행 선반영 — 전파 후 불필요한 writeTiers가 안 나가야 함');
{
  seed();
  X.setSyncReady(true);
  ctx.invalidateTierStats();
  const tiers = ctx._tiersForSave('채널A');
  ctx._presetChannelTierRows('채널A', tiers);
  const pending = ctx._collectTierWrites().filter(w => [3,4,5].indexOf(w.rowIndex) >= 0);
  check('채널A 행들은 보낼 것이 없음', pending.length === 0, pending);
}

console.log('\n--------------------------------\n통과 ' + pass + ' / 실패 ' + fail);
process.exit(fail ? 1 : 0);
