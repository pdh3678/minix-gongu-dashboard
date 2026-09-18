/* 등급 기준표 툴팁 — 매출등급/팔로워등급

   두 등급의 임계값은 TIER_RULES / FOLLOWER_RULES 상수에만 있고, 화면 문구는 거기서 만들어진다.
   문구를 손으로 적어두면 상수를 바꿨을 때 툴팁만 옛 숫자를 계속 보여주다가, 나중에 "기준이
   뭐였더라"를 화면에서 확인할 수 없게 된다. 이 스위트는 그 파생이 실제로 살아있는지를
   **상수를 바꿔 넣어 보고** 확인한다.

   함께 지키는 것:
     · 임계값 표기 — 매출은 억/천만, 팔로워는 정수 만("10.0만"이 아니라 "10만")
     · 두 툴팁의 구성이 같다(헤더 → 등급별 임계값 → 나머지 → 보조 설명)
     · 채널별 성과 표 헤더 ⓘ와 모달/등록 폼 ⓘ가 같은 함수에서 문구를 받는다

   실행: node tests/tier-tooltip.test.js  (또는 node tests/run-all.js) */
const fs = require('fs'), path = require('path');
const { loadFrontend, stubNode } = require(path.join(__dirname, 'lib', 'front-sandbox.js'));

const PROJ = process.argv[2] || path.join(__dirname, '..');
const SHIM = `
  get TIER_RULES(){return TIER_RULES;},
  get FOLLOWER_RULES(){return FOLLOWER_RULES;},
  get TIER_FALLBACK(){return TIER_FALLBACK;},
  get TIER_UNRATED(){return TIER_UNRATED;}`;

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

function makeDom() {
  const els = {};
  const mk = id => {
    const real = { id, title: '', value: '', textContent: '', innerHTML: '', style: {}, dataset: {},
      classList: { _s: new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);},
        contains(c){return this._s.has(c);}, toggle(c){this._s.has(c)?this._s.delete(c):this._s.add(c);} } };
    return new Proxy(real, { get: (t, k) => (k in t ? t[k] : stubNode()), set: (t, k, v) => { t[k] = v; return true; } });
  };
  return { els, get: id => (els[id] = els[id] || mk(id)) };
}

const { ctx, X } = loadFrontend(PROJ, SHIM);
const dom = makeDom();
ctx.document.getElementById = dom.get;
const lines = s => s.split('\n');

(async () => {
  console.log('\n[1] 매출등급 기준표 — 요청한 문구 그대로');
  {
    const t = ctx.tierCriteriaText(), L = lines(t);
    check('첫 줄 = 매출등급 기준(필터 무관임을 밝힘)',
      L[0] === '매출등급 기준 (채널의 전체 기간 완료 건 매출, 필터와 무관)', L[0]);
    check('메가: 평균 1억 이상 또는 최대 10억 이상', L[1] === '메가: 평균 1억 이상 또는 최대 10억 이상', L[1]);
    check('매크로: 평균 5천만 이상 또는 최대 5억 이상', L[2] === '매크로: 평균 5천만 이상 또는 최대 5억 이상', L[2]);
    check('마이크로: 평균 2천만 이상 또는 최대 2억 이상', L[3] === '마이크로: 평균 2천만 이상 또는 최대 2억 이상', L[3]);
    check('나노: 그 외', L[4] === '나노: 그 외', L[4]);
    check('판정 규칙 줄', L[5] === '판정: 평균 기준 등급과 최대 기준 등급 중 높은 쪽', L[5]);
    /* 이 셋은 "A / B / C" 한 줄로 붙이지 않는다 — 네이티브 title 툴팁의 폭은 가장 긴 줄이
       정하는데, 붙이면 62자가 되어 팔로워등급 툴팁보다 두 배 넘게 넓어진다([6]이 그 폭을 지킨다). */
    check('잠정은 별도 줄', L[6] === '잠정: 완료 건이 1건일 때', L[6]);
    check('미산정은 별도 줄', L[7] === '미산정: 완료 건이 없을 때', L[7]);
    check('수동은 별도 줄', L[8] === '수동: 수동 지정 값이 자동 산정을 덮어쓴 경우', L[8]);
    check('총 9줄', L.length === 9, L.length);
    check('금액에 원 단위 원문(100000000 등)이 노출되지 않음', !/\d{7,}/.test(t), t.match(/\d{7,}/));
  }

  console.log('\n[2] ★ 상수를 바꾸면 문구가 따라온다 (TIER_RULES에서 파생)');
  {
    const mega = X.TIER_RULES[0];
    const before = { avg: mega.avg, max: mega.max };
    mega.avg = 300000000; mega.max = 2000000000;   // 3억 / 20억
    const after = lines(ctx.tierCriteriaText())[1];
    check('임계값을 바꾸면 툴팁도 바뀜', after === '메가: 평균 3억 이상 또는 최대 20억 이상', after);
    mega.avg = 40000000;                            // 4천만 — 천만 단위 표기 확인
    check('천만 단위도 따라옴', lines(ctx.tierCriteriaText())[1].startsWith('메가: 평균 4천만 이상'),
      lines(ctx.tierCriteriaText())[1]);
    mega.avg = before.avg; mega.max = before.max;   // 원복
    check('원복하면 원래 문구', lines(ctx.tierCriteriaText())[1] === '메가: 평균 1억 이상 또는 최대 10억 이상');
    // 등급 줄 수도 상수 길이를 따라간다
    check('등급 줄 수 = TIER_RULES 길이', lines(ctx.tierCriteriaText()).length === X.TIER_RULES.length + 6,
      { lines: lines(ctx.tierCriteriaText()).length, rules: X.TIER_RULES.length });
    check('나노(폴백)는 상수에서 옴', ctx.tierCriteriaText().includes(`${X.TIER_FALLBACK}: 그 외`));
    check('미산정 라벨도 상수에서 옴', ctx.tierCriteriaText().includes(`${X.TIER_UNRATED}: 완료 건이 없을 때`));
  }

  console.log('\n[3] 임계값 금액 표기 — 억 / 천만');
  {
    const c = ctx.tierAmountShort;
    [[100000000, '1억'], [1000000000, '10억'], [500000000, '5억'], [200000000, '2억'],
     [50000000, '5천만'], [20000000, '2천만'], [10000000, '1천만'], [150000000, '1.5억']]
      .forEach(([n, want]) => check(`tierAmountShort(${n}) = ${want}`, c(n) === want, c(n)));
    check('1천만 미만은 기존 wonShort로 폴백', c(5000000) === ctx.wonShort(5000000), c(5000000));
  }

  console.log('\n[4] 팔로워 임계값 — 정수 만 표기');
  {
    const t = ctx.followerCriteriaText(), L = lines(t);
    check('메가: 100만 이상', L[1] === '메가: 100만 이상', L[1]);
    check('매크로: 10만 이상 (10.0만 아님)', L[2] === '매크로: 10만 이상', L[2]);
    check('마이크로: 1만 이상 (1.0만 아님)', L[3] === '마이크로: 1만 이상', L[3]);
    check('소수점이 남아있지 않음', !/\d\.\d만/.test(t), t.match(/\d\.\d만/));
    // 상수 파생도 함께 확인
    const macro = X.FOLLOWER_RULES[1], before = macro.min;
    macro.min = 250000;
    check('FOLLOWER_RULES를 바꾸면 따라옴', lines(ctx.followerCriteriaText())[2] === '매크로: 25만 이상',
      lines(ctx.followerCriteriaText())[2]);
    macro.min = before;
  }

  console.log('\n[5] formatMan — 기본 표시는 그대로, 0자리는 옵션일 때만');
  {
    check('기본은 소수 1자리 유지(8.5만)', ctx.formatMan(85000) === '8.5만', ctx.formatMan(85000));
    check('기본 44.3만', ctx.formatMan(443000) === '44.3만', ctx.formatMan(443000));
    check('decimals:0이면 정수(9만)', ctx.formatMan(85000, { decimals: 0 }) === '9만', ctx.formatMan(85000, { decimals: 0 }));
    check('100만 이상은 원래부터 정수', ctx.formatMan(1520000) === '152만', ctx.formatMan(1520000));
    check('1만 미만은 콤마 그대로', ctx.formatMan(8500) === '8,500', ctx.formatMan(8500));
    check('null은 —', ctx.formatMan(null) === '—');
  }

  console.log('\n[6] 두 툴팁의 구성이 같다');
  {
    const a = lines(ctx.tierCriteriaText()), b = lines(ctx.followerCriteriaText());
    /* 네이티브 title 툴팁은 폰트·줄 간격·너비를 CSS로 정할 수 없다(브라우저/OS가 그린다).
       같은 메커니즘이라 폰트·줄 간격은 저절로 같고, 우리가 실제로 통제할 수 있는 건 **폭**뿐인데
       그 폭은 가장 긴 줄이 정한다. 두 상자를 나란히 띄웠을 때 따로 놀지 않도록 최장 줄을 맞춘다. */
    const maxLen = L => Math.max(...L.map(s => s.length));
    check('두 툴팁의 최장 줄 길이가 비슷함(폭이 따로 놀지 않게)',
      Math.abs(maxLen(a) - maxLen(b)) <= 12, { tier: maxLen(a), fol: maxLen(b) });
    check('매출등급에 지나치게 긴 줄이 없음(40자 이하)', maxLen(a) <= 40, maxLen(a));
    check('첫 줄은 둘 다 "…등급 기준 (…)"', /^매출등급 기준 \(.+\)$/.test(a[0]) && /^팔로워등급 기준 \(.+\)$/.test(b[0]));
    check('2~4줄은 둘 다 "등급: … 이상"', [1, 2, 3].every(i => /^[^:]+: .+ 이상$/.test(a[i]) && /^[^:]+: .+ 이상$/.test(b[i])));
    check('5줄은 둘 다 폴백("그 외")', a[4].endsWith(': 그 외') && b[4].endsWith(': 그 외'), [a[4], b[4]]);
    check('등급 이름 순서가 같음',
      JSON.stringify([1,2,3,4].map(i => a[i].split(':')[0])) === JSON.stringify([1,2,3,4].map(i => b[i].split(':')[0])),
      [[1,2,3,4].map(i => a[i].split(':')[0]), [1,2,3,4].map(i => b[i].split(':')[0])]);
  }

  console.log('\n[7] 채널별 성과 표 헤더 ⓘ — 매출등급도 기준표를 띄운다');
  {
    ctx._renderDashChannelHead();
    const html = dom.els.dashChannelHead.innerHTML;
    const thOf = lb => (html.split('</th>').find(s => s.includes('>' + lb)) || '');
    const tierTh = thOf('매출등급'), folTh = thOf('팔로워등급');
    check('매출등급 헤더에 ⓘ가 있음', tierTh.includes('class="hd-info"'), tierTh.slice(0, 120));
    check('매출등급 ⓘ에 기준표 첫 줄이 들어있음', tierTh.includes('매출등급 기준 (채널의 전체 기간'), tierTh.slice(0, 200));
    check('매출등급 ⓘ에 임계값이 들어있음', tierTh.includes('평균 1억 이상 또는 최대 10억 이상'));
    check('예전 한 줄 안내는 사라짐', html.indexOf('등급은 필터와 무관하게 채널의 전체 기간 실적으로 산정됩니다') === -1);
    check('팔로워등급 ⓘ도 그대로 기준표', folTh.includes('팔로워등급 기준 (채널의 가장 최근'), folTh.slice(0, 200));
    check('팔로워등급 ⓘ 임계값이 정수', folTh.includes('매크로: 10만 이상') && !/\d\.\d만/.test(folTh));
    // title 속성은 줄바꿈을 그대로 담는다(HTML 이스케이프로 깨지지 않아야 함)
    check('툴팁 줄바꿈이 title 안에 유지됨', /title="[^"]*\n[^"]*"/.test(tierTh));
  }

  console.log('\n[8] 모달/등록 폼 ⓘ — 표와 같은 문구를 재사용한다');
  {
    ctx._applyTierHelpTitles();
    const tier = ctx.tierCriteriaText(), fol = ctx.followerCriteriaText();
    ['mTierHelp', 'fTierHelp', 'mTier', 'fTier'].forEach(id =>
      check(`${id}: 매출등급 기준표`, dom.els[id].title === tier, dom.els[id].title.slice(0, 40)));
    ['mFollowerHelp', 'fFollowerHelp', 'mFollowers', 'fFollowers'].forEach(id =>
      check(`${id}: 팔로워등급 기준표`, dom.els[id].title === fol, dom.els[id].title.slice(0, 40)));
    // 등급 상태 박스는 두 등급을 함께 보여주므로 두 기준표를 이어 붙인다
    ['mTierStateHelp', 'fTierStateHelp'].forEach(id => {
      check(`${id}: 매출 + 팔로워 두 기준표`, dom.els[id].title === tier + '\n\n' + fol, dom.els[id].title.slice(0, 40));
    });
    check('tierAndFollowerCriteriaText는 두 문구를 그대로 재사용',
      ctx.tierAndFollowerCriteriaText().includes(tier) && ctx.tierAndFollowerCriteriaText().includes(fol));

    // '등급 상태' 라벨의 ⓘ가 HTML에 실제로 있어야 위 title이 붙을 자리가 생긴다
    const src = fs.readFileSync(path.join(PROJ, 'index.html'), 'utf8');
    check('모달 등급 상태 라벨에 ⓘ 추가됨', src.includes('id="mTierStateHelp"'));
    check('등록 폼 등급 상태 라벨에 ⓘ 추가됨', src.includes('id="fTierStateHelp"'));
    check('두 ⓘ 모두 기존 도움말과 같은 클래스(모양 통일)',
      (src.match(/class="f-info tier-help" id="[mf]TierStateHelp"/g) || []).length === 2);
  }

  console.log('\n' + '─'.repeat(50));
  console.log('통과 ' + pass + ' / 실패 ' + fail);
  process.exit(fail ? 1 : 0);
})();
