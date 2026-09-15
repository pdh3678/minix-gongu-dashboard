/* 인플루언서 링크 자동 생성 — 플랫폼 ID를 입력하면 프로필 URL을 만들어 준다.

   끊겼던 원인(2026-09-15): ID 칸이 인스타/유튜브로 갈리면서 "플랫폼이 정확히 '인스타그램'일 때만"
   링크를 만들도록 바뀌었는데, 시트의 플랫폼 값은 '인스타'·'IG'처럼 표기가 제각각이다. select에
   없는 값을 넣으면 value가 ''이 되므로 판정이 늘 실패했고, ID를 아무리 쳐도 링크가 안 생겼다.

   지키려는 성질:
     · URL 형식은 기존 그대로 — 인스타 https://www.instagram.com/{id}, 유튜브 https://www.youtube.com/@{id}
     · 플랫폼 표기가 흔들려도('인스타', 'IG', '유튜브 쇼츠') 같은 플랫폼으로 본다
     · 사람이 직접 고친 링크는 덮어쓰지 않는다. 뱃지로 자동/수동을 보여주고, 누르면 다시 자동
     · ID 칸에 주소를 통째로 붙여넣으면 ID만 뽑고 링크는 그 주소를 유지
     · 모달과 등록 폼이 같은 코드로 같은 동작

   실행: node tests/channel-link.test.js  (또는 node tests/run-all.js) */
const path = require('path');
const { loadFrontend } = require(path.join(__dirname, 'lib', 'front-sandbox.js'));
const PROJ = process.argv[2] || path.join(__dirname, '..');

let pass = 0, fail = 0;
function check(l, c, extra) {
  if (c) { pass++; console.log('  PASS  ' + l); }
  else { fail++; console.log('  FAIL  ' + l + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

// 입력칸 흉내 — value/classList/title/disabled만 있으면 충분하다
function makeDom(vals) {
  const els = {};
  const mk = id => ({
    id, value: vals[id] != null ? vals[id] : '', textContent: '', title: '', disabled: false, style: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    closest: () => null, parentElement: null, querySelector: () => null, querySelectorAll: () => []
  });
  return { els, get: id => (els[id] = els[id] || mk(id)) };
}
function setup(vals) {
  const { ctx } = loadFrontend(PROJ);
  const dom = makeDom(vals || {});
  ctx.document.getElementById = dom.get;
  ctx._syncPlatformIdMarks = () => {};
  ctx.showToast = () => {};
  return { ctx, els: dom.els, get: dom.get };
}

console.log('\n[1] URL 형식은 기존 그대로');
{
  const { ctx } = setup();
  check('인스타', ctx.buildChannelLink('인스타그램', 'minnie.life') === 'https://www.instagram.com/minnie.life',
    ctx.buildChannelLink('인스타그램', 'minnie.life'));
  check('유튜브', ctx.buildChannelLink('유튜브', 'everyday_fit') === 'https://www.youtube.com/@everyday_fit',
    ctx.buildChannelLink('유튜브', 'everyday_fit'));
  check('앞의 @ 제거', ctx.buildChannelLink('인스타그램', '@minnie.life') === 'https://www.instagram.com/minnie.life');
  check('앞뒤 공백 제거', ctx.buildChannelLink('인스타그램', '  minnie.life  ') === 'https://www.instagram.com/minnie.life');
  check('유튜브는 @ 하나만', ctx.buildChannelLink('유튜브', '@everyday_fit') === 'https://www.youtube.com/@everyday_fit');
  check('ID 없으면 빈 문자열', ctx.buildChannelLink('인스타그램', '') === '');
  check('플랫폼 모르면 빈 문자열', ctx.buildChannelLink('블로그', 'someone') === '');
}

console.log('\n[2] 플랫폼 표기가 흔들려도 같은 플랫폼으로 (끊긴 원인)');
{
  const { ctx } = setup();
  ['인스타그램', '인스타', 'IG', 'ig', '인스타그램 릴스', 'Instagram'].forEach(p => {
    check('"' + p + '" → 인스타 링크',
      ctx.buildChannelLink(p, 'abc') === 'https://www.instagram.com/abc', [p, ctx.buildChannelLink(p, 'abc')]);
  });
  ['유튜브', 'YT', 'YouTube', '유튜브 쇼츠'].forEach(p => {
    check('"' + p + '" → 유튜브 링크',
      ctx.buildChannelLink(p, 'abc') === 'https://www.youtube.com/@abc', [p, ctx.buildChannelLink(p, 'abc')]);
  });
  check('빈 플랫폼은 생성 안 함', ctx.buildChannelLink('', 'abc') === '');
}

console.log('\n[3] 모달 — ID를 치면 링크가 만들어진다');
{
  const { ctx, els, get } = setup({ mPlatform: '인스타그램' });
  get('mLinkInput'); get('mIgId'); get('mYtId'); get('mLinkAuto');
  els.mIgId.value = 'minnie.life';
  ctx.mOnChannelIdChange('ig');
  check('링크 생성', els.mLinkInput.value === 'https://www.instagram.com/minnie.life', els.mLinkInput.value);
  check('뱃지는 자동', els.mLinkAuto.textContent === '자동', els.mLinkAuto.textContent);

  // 한 글자씩 고쳐도 계속 따라온다(직전 자동값과 같으면 우리 것으로 본다)
  els.mIgId.value = 'minnie.life2';
  ctx.mOnChannelIdChange('ig');
  check('ID를 고치면 링크도 갱신', els.mLinkInput.value === 'https://www.instagram.com/minnie.life2', els.mLinkInput.value);

  // 시트 표기가 '인스타'여도 동작해야 한다
  const b = setup({ mPlatform: '인스타' });
  b.get('mLinkInput'); b.els.mIgId = b.get('mIgId'); b.get('mYtId'); b.get('mLinkAuto');
  b.els.mIgId.value = 'sheet.style';
  b.ctx.mOnChannelIdChange('ig');
  check("플랫폼이 '인스타'여도 생성", b.els.mLinkInput.value === 'https://www.instagram.com/sheet.style',
    b.els.mLinkInput.value);
}

console.log('\n[4] 플랫폼을 바꾸면 그쪽 ID 기준으로 다시 만든다');
{
  const { ctx, els, get } = setup({ mPlatform: '인스타그램' });
  get('mLinkInput'); get('mYtId'); get('mLinkAuto');
  get('mIgId').value = 'insta.id';
  ctx.mOnChannelIdChange('ig');
  check('먼저 인스타 링크', els.mLinkInput.value.indexOf('instagram.com/insta.id') >= 0, els.mLinkInput.value);

  els.mYtId.value = 'yt.id';
  els.mPlatform.value = '유튜브';
  ctx.mOnPlatformChange();
  check('유튜브로 교체', els.mLinkInput.value === 'https://www.youtube.com/@yt.id', els.mLinkInput.value);

  // 플랫폼이 유튜브인데 인스타 ID를 고쳐도 링크는 그대로
  els.mIgId.value = 'other.insta';
  ctx.mOnChannelIdChange('ig');
  check('다른 쪽 ID는 링크를 바꾸지 않음', els.mLinkInput.value === 'https://www.youtube.com/@yt.id', els.mLinkInput.value);
}

console.log('\n[5] 직접 고친 링크는 덮어쓰지 않는다');
{
  const { ctx, els, get } = setup({ mPlatform: '인스타그램' });
  get('mLinkInput'); get('mYtId'); get('mLinkAuto');
  get('mIgId').value = 'auto.id';
  ctx.mOnChannelIdChange('ig');
  check('자동 생성됨', els.mLinkInput.value === 'https://www.instagram.com/auto.id');

  els.mLinkInput.value = 'https://linktr.ee/custom';   // 사용자가 직접 교체
  ctx._refreshLinkAutoBadge('m');
  check('뱃지가 수동으로', els.mLinkAuto.textContent === '수동', els.mLinkAuto.textContent);

  els.mIgId.value = 'changed.id';
  ctx.mOnChannelIdChange('ig');
  check('ID를 고쳐도 링크 유지', els.mLinkInput.value === 'https://linktr.ee/custom', els.mLinkInput.value);

  // 뱃지를 누르면 다시 자동
  ctx.relinkChannel('m');
  check('뱃지 클릭 → 재생성', els.mLinkInput.value === 'https://www.instagram.com/changed.id', els.mLinkInput.value);
  check('뱃지가 자동으로 복귀', els.mLinkAuto.textContent === '자동', els.mLinkAuto.textContent);
}

console.log('\n[6] ID 칸에 주소를 통째로 붙여넣으면 ID만 뽑고 링크는 그 주소를 유지');
{
  const { ctx, els, get } = setup({ mPlatform: '인스타그램' });
  get('mLinkInput'); get('mYtId'); get('mLinkAuto');
  els.mIgId = get('mIgId');
  els.mIgId.value = 'https://www.instagram.com/pasted.id/';
  ctx.mOnChannelIdChange('ig');
  check('ID 칸엔 ID만', els.mIgId.value === 'pasted.id', els.mIgId.value);
  check('링크는 붙여넣은 주소 그대로', els.mLinkInput.value === 'https://www.instagram.com/pasted.id/', els.mLinkInput.value);

  const y = setup({ mPlatform: '유튜브' });
  y.get('mLinkInput'); y.get('mIgId'); y.get('mLinkAuto');
  const ytEl = y.get('mYtId');
  ytEl.value = 'https://www.youtube.com/@pasted_yt';
  y.ctx.mOnChannelIdChange('yt');
  check('유튜브도 ID만 추출', ytEl.value === 'pasted_yt', ytEl.value);
  check('유튜브 링크 유지', y.els.mLinkInput.value === 'https://www.youtube.com/@pasted_yt', y.els.mLinkInput.value);

  // 프로토콜 없는 주소도
  const n = setup({ mPlatform: '인스타그램' });
  n.get('mLinkInput'); n.get('mYtId'); n.get('mLinkAuto');
  const igEl = n.get('mIgId');
  igEl.value = 'instagram.com/noproto';
  n.ctx.mOnChannelIdChange('ig');
  check('프로토콜 없는 주소도 처리', igEl.value === 'noproto' && n.els.mLinkInput.value === 'https://instagram.com/noproto',
    [igEl.value, n.els.mLinkInput.value]);
}

console.log('\n[7] 링크를 직접 입력하면 ID 칸도 맞춰준다');
{
  const { ctx, els, get } = setup({ mPlatform: '인스타그램' });
  get('mIgId'); get('mYtId'); get('mLinkAuto');
  get('mLinkInput').value = 'https://www.instagram.com/from.link/';
  ctx.mOnLinkInputChange();
  check('ID 칸 채워짐', els.mIgId.value === 'from.link', els.mIgId.value);
  check('끝 슬래시 차이는 같은 링크로 봄(자동 유지)', els.mLinkAuto.textContent === '자동', els.mLinkAuto.textContent);
}

console.log('\n[8] 기존 건 — ID는 있는데 링크가 비어 있으면 열 때 채운다');
{
  const { ctx, els, get } = setup({ mPlatform: '유튜브', mYtId: 'legacy_yt', mLinkInput: '' });
  get('mIgId'); get('mLinkAuto');
  ctx._initLinkAuto('m');
  check('링크 자동 채움', els.mLinkInput.value === 'https://www.youtube.com/@legacy_yt', els.mLinkInput.value);
  check('뱃지 자동', els.mLinkAuto.textContent === '자동');

  // 이미 수동 링크가 있으면 건드리지 않는다
  const b = setup({ mPlatform: '인스타그램', mIgId: 'someone', mLinkInput: 'https://brand.example/shop' });
  b.get('mYtId'); b.get('mLinkAuto');
  b.ctx._initLinkAuto('m');
  check('기존 수동 링크 유지', b.els.mLinkInput.value === 'https://brand.example/shop', b.els.mLinkInput.value);
  check('뱃지 수동', b.els.mLinkAuto.textContent === '수동', b.els.mLinkAuto.textContent);
}

console.log('\n[9] 등록 폼도 같은 동작');
{
  const { ctx, els, get } = setup({ fPlatform: '인스타그램' });
  get('fLink'); get('fYtId'); get('fLinkAuto');
  get('fIgId').value = 'new.channel';
  ctx.onChannelIdChange('ig');
  check('등록 폼 링크 생성', els.fLink.value === 'https://www.instagram.com/new.channel', els.fLink.value);

  els.fLink.value = 'https://custom.example';
  ctx._refreshLinkAutoBadge('f');
  els.fIgId.value = 'other';
  ctx.onChannelIdChange('ig');
  check('수동 링크는 유지', els.fLink.value === 'https://custom.example', els.fLink.value);
  ctx.relinkChannel('f');
  check('뱃지로 재생성', els.fLink.value === 'https://www.instagram.com/other', els.fLink.value);

  // 플랫폼 변경
  els.fYtId.value = 'tube';
  els.fPlatform.value = '유튜브';
  ctx.onPlatformChange();
  check('플랫폼 변경 반영', els.fLink.value === 'https://www.youtube.com/@tube', els.fLink.value);
}

console.log('\n[10] 마크업 — 두 폼 모두 핸들러가 걸려 있다');
{
  const fs = require('fs');
  const html = fs.readFileSync(path.join(PROJ, 'index.html'), 'utf8');
  check('모달 인스타 ID oninput', html.indexOf(`id="mIgId" placeholder="예: minnie.life" oninput="mOnChannelIdChange('ig')"`) >= 0);
  check('모달 유튜브 ID oninput', html.indexOf(`id="mYtId"`) >= 0 && html.indexOf(`mOnChannelIdChange('yt')`) >= 0);
  check('모달 링크 뱃지', html.indexOf(`id="mLinkAuto"`) >= 0 && html.indexOf(`relinkChannel('m')`) >= 0);
  check('등록 폼 링크 뱃지', html.indexOf(`id="fLinkAuto"`) >= 0 && html.indexOf(`relinkChannel('f')`) >= 0);
  check('열기 버튼은 링크 칸 값을 연다', html.indexOf('function openModalLink') >= 0 &&
    html.slice(html.indexOf('function openModalLink')).indexOf("getElementById('mLinkInput')") < 200);
  check('안내 placeholder 복원', (html.match(/ID 입력 시 자동 생성 \(직접 수정 가능\)/g) || []).length === 2,
    (html.match(/ID 입력 시 자동 생성 \(직접 수정 가능\)/g) || []).length);
}

console.log('\n--------------------------------\n통과 ' + pass + ' / 실패 ' + fail);
process.exit(fail ? 1 : 0);
