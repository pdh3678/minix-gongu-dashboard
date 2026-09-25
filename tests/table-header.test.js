/* 표 헤더 공용 컴포넌트(sortableThHtml) — 두 줄 헤더(subLabel) 지원

   배경: 정렬 가능한 <th>를 만드는 코드가 세 군데에 흩어져 있었다. 채널별 성과 표는 아예
   HTML에 <th> 11개가 박혀 있었고(정렬 아이콘만 id로 찾아 갈아끼움), 개별 공구 건 표와 실적
   표는 각자 거의 같은 문자열을 조립했다. 그래서 헤더에 무언가를 하나 추가하려면 세 군데를
   따로 고쳐야 했고, 실제로 "공구 횟수 (기간 내)"처럼 라벨이 긴 컬럼을 두 줄로 쪼개려면
   한 표에만 손대는 것으로는 끝나지 않았다.

   지키려는 것:
     · 세 표가 모두 sortableThHtml 하나를 거친다(어느 표든 subLabel을 붙이면 바로 동작)
     · subLabel이 있으면 둘째 줄이 작은 회색 글씨로 붙고 th에 th-2line(최소 폭)이 걸린다
     · 정렬 아이콘(⇕)과 ⓘ는 **첫 줄 끝**에 남는다 — 보조 라벨이 아이콘을 아래로 밀지 않는다
     · 한 줄 헤더의 마크업은 예전 그대로다(이번 변경이 다른 표의 모양을 바꾸지 않는다)
     · 데이터가 비어도 헤더는 그려지고, 빈 안내행의 colspan이 컬럼 수와 일치한다

   실행: node tests/table-header.test.js  (또는 node tests/run-all.js) */
const fs = require('fs'), path = require('path');
const { loadFrontend, stubNode, readFrontSource } = require(path.join(__dirname, 'lib', 'front-sandbox.js'));

const PROJ = process.argv[2] || path.join(__dirname, '..');
const SHIM = `
  get DASH_CHANNEL_COLS(){return DASH_CHANNEL_COLS;},
  get DASH_SEL_COLS(){return DASH_SEL_COLS;},
  get SALES_COLS(){return SALES_COLS;}`;

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

// 값을 기억하는 DOM(innerHTML을 읽어야 함). 모르는 속성은 샌드박스 만능 스텁으로 넘긴다.
function makeDom() {
  const els = {};
  const mk = id => {
    const real = { id, value: '', textContent: '', innerHTML: '', style: {}, dataset: {},
      classList: { _s: new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);},
        contains(c){return this._s.has(c);}, toggle(c){this._s.has(c)?this._s.delete(c):this._s.add(c);} } };
    return new Proxy(real, { get: (t, k) => (k in t ? t[k] : stubNode()), set: (t, k, v) => { t[k] = v; return true; } });
  };
  return { els, get: id => (els[id] = els[id] || mk(id)) };
}

const { ctx, X } = loadFrontend(PROJ, SHIM);
const dom = makeDom();
ctx.document.getElementById = dom.get;

// <th ...>…</th> 하나를 쪼개 본다
function thParts(html) {
  const m = html.match(/^<th class="([^"]*)"([^>]*)>([\s\S]*)<\/th>$/);
  return m ? { cls: m[1], attrs: m[2], inner: m[3] } : null;
}

(async () => {
  console.log('\n[1] 한 줄 헤더 — 기존 마크업이 그대로 유지된다');
  {
    const h = ctx.sortableThHtml({ key: 'rev', lb: '누적 매출', num: true },
      { sorted: false, dir: 1, onclick: "sortX('rev')" });
    const p = thParts(h);
    check('<th>로 감싸짐', !!p, h);
    check('sortable + num-col 클래스', /\bsortable\b/.test(p.cls) && /\bnum-col\b/.test(p.cls), p.cls);
    check('두 줄용 클래스는 안 붙음', !/\bth-2line\b/.test(p.cls), p.cls);
    check('th-lb 래퍼 없이 평문 라벨', p.inner.indexOf('th-lb') === -1 && p.inner.indexOf('누적 매출') === 0, p.inner);
    check('정렬 아이콘 ⇕', p.inner.includes('<span class="sort-ic">⇕</span>'), p.inner);
    check('onclick 유지', p.attrs.includes(`onclick="sortX('rev')"`), p.attrs);
  }

  console.log('\n[2] subLabel — 두 줄 헤더가 되고 최소 폭 클래스가 붙는다');
  {
    const h = ctx.sortableThHtml({ key: 'count', lb: '공구 횟수', subLabel: '(기간 내)', num: true },
      { sorted: false, dir: 1, onclick: "sortX('count')" });
    const p = thParts(h);
    check('th-2line 클래스(최소 폭)', /\bth-2line\b/.test(p.cls), p.cls);
    check('num-col도 함께 유지', /\bnum-col\b/.test(p.cls), p.cls);
    check('th-lb 래퍼로 감쌈', p.inner.includes('<span class="th-lb">'), p.inner);
    check('첫 줄 = 공구 횟수', p.inner.includes('공구 횟수'), p.inner);
    check('둘째 줄 = (기간 내), th-sub', p.inner.includes('<span class="th-sub">(기간 내)</span>'), p.inner);

    /* 핵심: 정렬 아이콘이 보조 라벨보다 **앞**에 있어야 첫 줄 끝에 붙는다.
       순서가 뒤집히면 ⇕가 둘째 줄로 내려가 다른 헤더들과 높이가 어긋난다. */
    check('정렬 아이콘이 보조 라벨보다 앞(=첫 줄 끝)',
      p.inner.indexOf('sort-ic') < p.inner.indexOf('th-sub'),
      { sortIc: p.inner.indexOf('sort-ic'), sub: p.inner.indexOf('th-sub') });
  }

  console.log('\n[3] ⓘ 툴팁 — 문자열/함수 모두 받고, 아이콘 순서는 라벨 → ⓘ → ⇕');
  {
    const h = ctx.sortableThHtml({ key: 'a', lb: '팔로워 수', info: '셀을 클릭하면 수정' },
      { sorted: false, dir: 1, onclick: "x()" });
    check('ⓘ가 title과 함께 붙음', h.includes('class="hd-info" title="셀을 클릭하면 수정"'), h);
    check('ⓘ 클릭이 정렬로 새지 않음', h.includes('onclick="event.stopPropagation()"'), h);
    check('라벨 → ⓘ → ⇕ 순서',
      h.indexOf('팔로워 수') < h.indexOf('hd-info') && h.indexOf('hd-info') < h.indexOf('sort-ic'), h);

    const hf = ctx.sortableThHtml({ key: 'b', lb: '팔로워등급', info: () => '동적 문구' }, {});
    check('info에 함수를 주면 렌더 시점에 호출', hf.includes('title="동적 문구"'), hf);

    const both = ctx.sortableThHtml({ key: 'c', lb: '라벨', subLabel: '(보조)', info: '설명' },
      { sorted: true, dir: -1, onclick: "x()" });
    check('두 줄 + ⓘ + 정렬 아이콘이 모두 첫 줄 끝에',
      both.indexOf('hd-info') < both.indexOf('sort-ic') && both.indexOf('sort-ic') < both.indexOf('th-sub'), both);
    check('내림차순이면 ▼', both.includes('>▼<'), both);
    check('정렬 중이면 sorted 클래스', /\bsorted\b/.test(thParts(both).cls), thParts(both).cls);
  }

  console.log('\n[4] 채널별 성과 표 — 정의 배열에서 헤더가 생성된다');
  {
    ctx._renderDashChannelHead();
    const html = dom.els.dashChannelHead.innerHTML;
    const ths = html.match(/<th\b/g) || [];
    check('컬럼 수만큼 <th> 생성', ths.length === X.DASH_CHANNEL_COLS.length, { th: ths.length, cols: X.DASH_CHANNEL_COLS.length });
    check('"공구 횟수 (기간 내)" 한 줄 라벨이 사라짐', html.indexOf('공구 횟수 (기간 내)') === -1);
    check('공구 횟수가 두 줄로 표시됨',
      html.includes('공구 횟수') && html.includes('<span class="th-sub">(기간 내)</span>'), html.slice(0, 200));
    // 두 줄인 컬럼은 정확히 '공구 횟수' 하나 — 나머지 헤더 모양은 그대로여야 한다
    const twoLine = (html.match(/th-2line/g) || []).length;
    check('두 줄 헤더는 공구 횟수 하나뿐', twoLine === 1, twoLine);
    check('팔로워등급 툴팁이 기준 문구로 채워짐',
      /팔로워등급<span class="hd-info" title="[^"]+"/.test(html), html.match(/팔로워등급[^<]*<span[^>]*>/));
    check('모든 헤더가 정렬 가능(onclick)',
      (html.match(/onclick="_sortDashChannelTable\(/g) || []).length === X.DASH_CHANNEL_COLS.length);
    check('숫자 컬럼은 num-col 유지', (html.match(/num-col/g) || []).length === X.DASH_CHANNEL_COLS.filter(c => c.num).length);
  }

  console.log('\n[5] 데이터가 없어도 헤더는 남고, 빈 안내행 colspan이 컬럼 수와 맞는다');
  {
    X.DATA.splice(0, X.DATA.length); // 빈 상태로 만들어 early return 경로를 태움
    ctx.renderDashChannelAnalytics();
    const html = dom.els.dashChannelHead.innerHTML;
    check('빈 데이터에서도 헤더가 그려짐', (html.match(/<th\b/g) || []).length === X.DASH_CHANNEL_COLS.length, html.length);
    const body = dom.els.dashChannelBody.innerHTML;
    const cs = (body.match(/colspan="(\d+)"/) || [])[1];
    check('빈 안내행 colspan == 컬럼 수', Number(cs) === X.DASH_CHANNEL_COLS.length, { colspan: cs, cols: X.DASH_CHANNEL_COLS.length });
  }

  console.log('\n[6] 다른 두 표(개별 공구 건 / 실적 표)도 같은 컴포넌트를 쓴다');
  {
    // 소스에서 세 렌더 지점이 모두 sortableThHtml을 거치는지 먼저 확인
    const src = readFrontSource(PROJ);
    check('sortableThHtml 호출이 3곳(채널/개별 공구 건/실적 표)',
      (src.match(/sortableThHtml\(/g) || []).length === 4, // 정의 1 + 호출 3
      (src.match(/sortableThHtml\(/g) || []).length);
    check('예전 <th> 문자열 조립이 남아있지 않음',
      !/<th class="sortable\$\{sorted/.test(src));
    check('채널 표 헤더가 HTML에 하드코딩돼 있지 않음', src.indexOf('id="dashChHdCount"') === -1);

    /* 실제로 붙여 보고 확인한다 — 두 표의 컬럼 정의에 subLabel을 끼워 넣은 뒤 다시 그려서
       두 줄 헤더가 나오는지 본다(끝나면 원복). */
    const selCol = X.DASH_SEL_COLS.find(c => c.key === 'rev');
    selCol.subLabel = '(완료+진행중)';
    ctx.renderDashList();
    const selHtml = dom.els.dashSelHead.innerHTML;
    check('개별 공구 건 표에서 subLabel이 두 줄로 나옴',
      selHtml.includes('<span class="th-sub">(완료+진행중)</span>') && selHtml.includes('th-2line'), selHtml);
    delete selCol.subLabel;
    ctx.renderDashList();
    check('원복하면 다시 한 줄', dom.els.dashSelHead.innerHTML.indexOf('th-sub') === -1);

    const salesCol = X.SALES_COLS.find(c => c.key === 'rev');
    salesCol.subLabel = '(부가세 포함)';
    ctx.renderTbl();
    const salesHtml = dom.els.tHead.innerHTML;
    check('실적 표에서도 subLabel이 두 줄로 나옴',
      salesHtml.includes('<span class="th-sub">(부가세 포함)</span>') && salesHtml.includes('th-2line'), salesHtml.slice(0, 300));
    check('실적 표의 sticky 컬럼 클래스가 유지됨',
      salesHtml.includes('sticky-col1') && salesHtml.includes('sticky-col2'));
    delete salesCol.subLabel;
    ctx.renderTbl();
    check('원복하면 다시 한 줄', dom.els.tHead.innerHTML.indexOf('th-sub') === -1);
  }

  console.log('\n[7] CSS — 두 줄 헤더의 모양과 최소 폭');
  {
    const css = readFrontSource(PROJ);
    check('헤더 셀이 상단 정렬(vertical-align:top) — 주 라벨들이 첫 줄에서 맞음',
      /thead th\{[^}]*vertical-align:top/.test(css));
    check('보조 라벨 래퍼도 같은 기준(top)이라 첫 줄이 어긋나지 않음',
      /\.th-lb\{[^}]*vertical-align:top/.test(css));
    check('th-2line 최소 폭 72px', /th\.th-2line\{[^}]*min-width:72px/.test(css));
    const sub = (css.match(/\.th-sub\{([^}]*)\}/) || [])[1] || '';
    check('보조 라벨이 작은 글씨', /font-size:9px/.test(sub), sub);
    check('보조 라벨이 회색(보조 표기)', /color:var\(--text-3\)/.test(sub), sub);
    check('보조 라벨은 대문자 변환/자간 상속을 끊음',
      /text-transform:none/.test(sub) && /letter-spacing:0/.test(sub), sub);
    check('보조 라벨이 블록이라 줄바꿈됨', /display:block/.test(sub), sub);
  }

  console.log('\n' + '─'.repeat(50));
  console.log('통과 ' + pass + ' / 실패 ' + fail);
  process.exit(fail ? 1 : 0);
})();
