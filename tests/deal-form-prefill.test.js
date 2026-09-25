/* 새 공구건 등록 버튼·미리 채우기(0단계, 2026-09-25) 검증.

   지키려는 성질:
     · PageHeaderActions가 공용 버튼 묶음을 만든다(품목별 실적·공구 캘린더가 같은 함수를 씀)
     · 품목별 실적에서 열면 그 품목군을, 모델 탭이 골라져 있으면 그 모델까지 기본 선택
     · 캘린더 날짜 칸으로 열면 시작일(과 마감일)이 그 날짜
     · 미리 채운 값은 기본값일 뿐 — 품목군·제품을 바꾸거나 다른 품목 상품코드를 더해 저장할 수 있다
     · 등록 로직은 하나 — 전부 기존 openDealForm/saveDeal을 거친다
     · #gongu/new는 모달이 열린 동안 그 주소를 유지한다

   select는 옵션에 없는 값을 대입하면 조용히 빈 값이 된다 — 그래서 fLine/fModel만은 가짜 DOM에서도
   진짜 select처럼 동작시켜 "제품 드롭다운이 채워지기 전에 모델을 넣는" 순서 실수를 잡는다.

   실행: node tests/deal-form-prefill.test.js  (또는 node tests/run-all.js) */
const path = require('path');
const { loadFrontend, readFrontSource } = require(path.join(__dirname, 'lib', 'front-sandbox.js'));

const PROJ = process.argv[2] || path.join(__dirname, '..');
const html = readFrontSource(PROJ);
const SHIM = `get ST(){return ST;}, get currentPageHash(){return _currentPageHash;}`;

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

const SELECT_IDS = new Set(['fLine', 'fModel']);
function makeDom() {
  const els = {};
  function el(id) {
    if (els[id]) return els[id];
    const e = {
      id, innerHTML: '', textContent: '', style: {}, readOnly: ['fYear', 'fDuration', 'fProduct', 'fComposition'].includes(id),
      classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, dataset: {},
      querySelectorAll: () => [], querySelector: () => null, appendChild() {}, focus() {}, remove() {},
      closest: () => ({ querySelector: () => null, appendChild() {} }), parentElement: { querySelector: () => null, appendChild() {} }
    };
    if (SELECT_IDS.has(id)) {
      let v = '';
      Object.defineProperty(e, 'value', {
        get: () => v,
        set: nv => { const opts = [...e.innerHTML.matchAll(/<option value="([^"]*)"/g)].map(m => m[1]); v = opts.includes(String(nv)) ? String(nv) : ''; }
      });
    } else e.value = '';
    return (els[id] = e);
  }
  return { els, get: el };
}
function boot(opts) {
  const { ctx, X } = loadFrontend(PROJ, SHIM, opts);
  const dom = makeDom();
  ctx.document.getElementById = dom.get;
  ctx._renderLineOptions(); // 품목군 드롭다운 옵션 — 로드 시점엔 스텁 DOM에 그려졌으므로 다시 그린다
  ctx.render = () => {};
  return { ctx, X, dom };
}
const lastUrl = ctx => ctx.history._urls[ctx.history._urls.length - 1];

(async () => {
  console.log('\n[1] PageHeaderActions — 공용 버튼 묶음');
  {
    const { ctx } = boot();
    const out = ctx.PageHeaderActions([
      { label: '＋ 새 공구건 등록', onclick: 'openDealForm()' },
      { label: '보조 <b>', onclick: 'x("a")', kind: 'secondary', title: '설명' }
    ]);
    check('기본은 primary 버튼 + 인라인 핸들러', out.indexOf('<button type="button" class="btn-primary page-action-btn" onclick="openDealForm()">＋ 새 공구건 등록</button>') === 0, out);
    check('secondary·title 지원', out.indexOf('class="btn-cancel page-action-btn"') > 0 && out.indexOf('title="설명"') > 0, out);
    check('라벨·속성 이스케이프', out.indexOf('보조 &lt;b&gt;') > 0 && out.indexOf('onclick="x(&quot;a&quot;)"') > 0, out);
    const host = { innerHTML: '', classList: { _c: [], add(c) { this._c.push(c); } } };
    ctx.document.getElementById = id => (id === 'h' ? host : null);
    ctx.renderPageHeaderActions('h', [{ label: 'A', onclick: 'f()' }]);
    check('renderPageHeaderActions가 자리에 .page-actions와 버튼을 붙임', host.classList._c.includes('page-actions') && host.innerHTML.indexOf('>A</button>') > 0);
    ctx.renderPageHeaderActions('없는자리', [{ label: 'A', onclick: 'f()' }]);
    check('자리가 없으면 조용히 건너뜀', true);
  }

  console.log('\n[2] 버튼 위치 — 마크업과 호출');
  {
    const cal = html.slice(html.indexOf('id="page-calendar"'), html.indexOf('id="calPageBody"'));
    check('공구 캘린더: 카드 위 머리 줄에 #calPageActions', /<div class="page-head-row"><div id="calPageActions"><\/div><\/div>/.test(cal));
    const salesAt = html.indexOf('id="page-sales"');
    const sales = html.slice(salesAt, html.indexOf('기간 필터', salesAt));
    check('품목별 실적: 모델 탭(#subTabs)과 같은 줄 오른쪽에 #salesPageActions',
      /<div class="page-head-row">\s*<div class="subtabs" id="subTabs"><\/div>\s*<div id="salesPageActions"><\/div>\s*<\/div>/.test(sales));
    check('캘린더 버튼은 기존 openDealForm()을 부름', html.indexOf("renderPageHeaderActions('calPageActions',[{label:'＋ 새 공구건 등록',onclick:'openDealForm()'}])") > 0);
    check('품목별 실적 버튼은 _openDealFormFromSales()를 부름', html.indexOf("renderPageHeaderActions('salesPageActions',[{label:'＋ 새 공구건 등록',onclick:'_openDealFormFromSales()'}])") > 0);
    check('.page-actions가 오른쪽 끝(margin-left:auto)', /\.page-actions\{margin-left:auto/.test(html));
    // 등록 로직 복제 금지 — addSalesRow 요청(_gasWrite)을 보내는 곳은 saveDeal 하나뿐
    const code = html.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const sends = code.match(/_gasWrite\([^,]+,'addSalesRow'/g) || [];
    check('addSalesRow 요청 지점이 1곳(등록 로직 복제 없음)', sends.length === 1, sends.length);
  }

  console.log('\n[3] 모델 탭 값 → 제품 드롭다운 값');
  {
    const { ctx } = boot();
    const T = [
      ['더플렌더', 'all', ''], ['더플렌더', 'PRO', '더플렌더PRO'], ['더플렌더', 'MAX', '더플렌더MAX'],
      ['더플렌더', 'mini', '더플렌더mini'], ['더플렌더', 'NEXT', '더플렌더NEXT'], ['더플렌더', 'PLUS', ''],
      ['더시프트', '기본', '더시프트'], ['더시프트', 'PRO', '더시프트PRO'], ['더슬림', 'all', ''], ['', 'PRO', '']
    ];
    T.forEach(([line, tab, want]) => check(`${line || '(없음)'} / ${tab} → "${want}"`, ctx._dealFormModelForTab(line, tab) === want, ctx._dealFormModelForTab(line, tab)));
  }

  console.log('\n[4] 품목별 실적 4곳에서 열기 — 품목군(+모델) 기본 선택');
  {
    const CASES = [
      ['플렌더', 'all', '더플렌더', '', ''], ['플렌더', 'MAX', '더플렌더', '더플렌더MAX', '더 플렌더 MAX'],
      ['플렌더', 'mini', '더플렌더', '더플렌더mini', '더 플렌더 mini'],
      ['시프트', 'all', '더시프트', '', ''], ['시프트', 'PRO', '더시프트', '더시프트PRO', '더 시프트 PRO'],
      ['시프트', '기본', '더시프트', '더시프트', '더 시프트'],
      ['슬림', 'all', '더슬림', '', '더 슬림'], ['에어드라이', 'all', '더에어드라이', '', '더 에어드라이']
    ];
    CASES.forEach(([prod, model, wantLine, wantModel, wantProduct]) => {
      const { ctx, X, dom } = boot();
      X.ST.prod = prod; X.ST.model = model;
      ctx._openDealFormFromSales();
      const E = dom.els;
      check(`${prod}/${model} → 품목군 ${wantLine}, 제품 "${wantModel}", 제품명 "${wantProduct}"`,
        E.fLine.value === wantLine && E.fModel.value === wantModel && E.fProduct.value === wantProduct,
        { line: E.fLine.value, model: E.fModel.value, product: E.fProduct.value });
    });
  }

  console.log('\n[5] 캘린더 날짜 칸 → 시작일');
  {
    const { ctx, dom } = boot();
    const month = ctx.renderCalMonth(2026, 10);
    check('날짜 칸마다 openDealForm({start:날짜}) 핸들러', month.indexOf("onclick=\"openDealForm({start:'2026-10-05'})\"") > 0 &&
      month.indexOf("onclick=\"openDealForm({start:'2026-10-31'})\"") > 0);
    check('  ↳ 기존 공구 막대 클릭(openM)은 그대로 막대에만', month.indexOf('cal-date2') > 0 && !/cal-date2[^>]*openM/.test(month));
    ctx.openDealForm({ start: '2026-10-05' });
    const E = dom.els;
    check('시작일·마감일 = 2026-10-05', E.fStart.value === '2026-10-05' && E.fEnd.value === '2026-10-05', { s: E.fStart.value, e: E.fEnd.value });
    check('연·월도 시작일에서 파생(2026 / 10)', String(E.fYear.value) === '2026' && E.fMonth.value === '10', { y: E.fYear.value, m: E.fMonth.value });
    check('품목군은 비어 있음(캘린더는 품목을 고르지 않음)', E.fLine.value === '');
    check('주소는 #new-deal', /#new-deal$/.test(lastUrl(ctx)), lastUrl(ctx));
  }
  {
    const { ctx, dom } = boot();
    ctx.openDealForm();
    const today = new Date().toISOString().split('T')[0];
    check('버튼(인자 없음)으로 열면 기존처럼 오늘', dom.els.fStart.value === today && dom.els.fEnd.value === today);
  }

  console.log('\n[6] #gongu/new — 캘린더 위에 모달, 주소 유지, 닫으면 #calendar');
  {
    const { ctx, X, dom } = boot({ search: '?embed=1', runHeadScripts: true });
    ctx.location.hash = '#gongu/new';
    ctx._routeFromHash();
    check('모달이 열린 동안 주소는 /?embed=1#gongu/new', lastUrl(ctx) === '/?embed=1#gongu/new', lastUrl(ctx));
    check('밑에 깔린 페이지는 캘린더', X.currentPageHash === 'calendar', X.currentPageHash);
    ctx.closeDealForm();
    check('닫으면 /?embed=1#calendar', lastUrl(ctx) === '/?embed=1#calendar', lastUrl(ctx));
    check('닫으면 품목군 등 입력이 비워짐', dom.els.fLine.value === '');
  }

  console.log('\n[7] 미리 채운 값은 기본값일 뿐 — 바꿔서 저장, 다른 품목 코드 추가');
  {
    // 더 플렌더 MAX로 열고 그대로 저장 + 다른 품목(더 시프트)의 상품코드를 하나 더 넣는다
    const { ctx, X, dom } = boot();
    ctx._getGasUrl = () => ''; // 샘플 모드 — 서버 없이 DATA에만 저장
    X.ST.prod = '플렌더'; X.ST.model = 'MAX';
    ctx._openDealFormFromSales();
    dom.get('fInfluencer').value = '미리채움채널'; dom.get('fPlatform').value = '인스타그램'; dom.get('fIgId').value = 'prefill.ch';
    X.setFormState({ codes: ['FLENDER-MAX-1', 'SHIFT-9'] });
    const before = X.DATA.length;
    ctx.saveDeal();
    const saved = X.DATA[X.DATA.length - 1];
    check('저장됨(DATA에 1건 추가)', X.DATA.length === before + 1);
    check('제품명 = 더 플렌더 MAX(시트 표기)', saved.product === '더 플렌더 MAX', saved.product);
    check('다른 품목 상품코드도 함께 저장', JSON.stringify(saved.codes) === '["FLENDER-MAX-1","SHIFT-9"]', saved.codes);
  }
  {
    const { ctx, X, dom } = boot();
    ctx._getGasUrl = () => '';
    X.ST.prod = '플렌더'; X.ST.model = 'MAX';
    ctx._openDealFormFromSales();
    // 사용자가 모달에서 품목군·제품을 바꾼다
    dom.els.fLine.value = '더시프트'; ctx.onLineChange();
    dom.els.fModel.value = '더시프트PRO'; ctx.onModelChange();
    check('품목군을 바꾸면 제품 드롭다운이 그 품목 것으로 바뀜', dom.els.fModel.value === '더시프트PRO' && dom.els.fModel.innerHTML.indexOf('더플렌더MAX') < 0);
    dom.get('fInfluencer').value = '바꾼채널'; dom.get('fPlatform').value = '인스타그램'; dom.get('fIgId').value = 'changed.ch';
    X.setFormState({ codes: ['S1'] });
    ctx.saveDeal();
    const saved = X.DATA[X.DATA.length - 1];
    check('바꾼 값으로 저장(더 시프트 PRO)', saved.product === '더 시프트 PRO' && saved.ch === '바꾼채널', { p: saved.product, ch: saved.ch });
  }

  console.log('\n' + '─'.repeat(50));
  console.log('통과 ' + pass + ' / 실패 ' + fail);
  process.exit(fail ? 1 : 0);
})();
