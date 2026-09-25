/* 품목별 실적 페이지의 인플루언서(채널명) 검색 필터 — 배포되는 index.html을 그대로 실행해서
   검증한다.

   이 스위트가 지키려는 것은 크게 둘이다.

   1) 대시보드 상단 필터와 품목별 실적 페이지가 "같은 컴포넌트 하나"를 쓰는 것.
      예전엔 채널 검색이 대시보드 전용 함수(_selectDashInfluencer 등)로만 있었다. 품목 페이지에
      같은 기능을 붙이면서 복붙했다면 한쪽만 고치는 사고가 나기 딱 좋으므로, scope만 다른
      공용 함수(_onInfSearchInput/_selectInfSearch/_clearInfSearch)로 합쳤다. 여기서는 그
      공용 함수가 실제로 두 scope 모두를 구동하는지, 그리고 예전 전용 함수가 남아 있지 않은지를
      본다(남아 있으면 복붙이 되살아난 것).

   2) 필터가 KPI와 실적 상세 표에 "동시에" 먹는 것.
      둘 다 filteredProd(DATA).filter(salesYMMatch) 한 경로만 타야 한다. 한쪽만 채널을 걸러내면
      "표는 1건인데 총 매출은 전체 합계"처럼 조용히 틀린 화면이 나온다.

   실행: node tests/influencer-filter.test.js  (또는 node tests/run-all.js) */
const fs = require('fs');
const path = require('path');
const { loadFrontend, readFrontSource } = require(path.join(__dirname, 'lib', 'front-sandbox.js'));

const PROJ = process.argv[2] || path.join(__dirname, '..');
const SHIM = `
  get INF_SEARCH(){return INF_SEARCH;},
  get SALES_YM(){return SALES_YM;},
  get DASH(){return DASH;},
  get ST(){return ST;},
  setSalesChannel(v){SALES_YM.channel=v;},
  setSalesYM(years,months){SALES_YM.years=new Set(years);SALES_YM.months=new Set(months);SALES_YM._initialized=true;}`;

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

/* renderSalesKpi/renderYMFilterBar는 document에 직접 그린다. 샌드박스 기본 스텁은 innerHTML을
   삼켜버리므로, 잠시 "받아 적는" 엘리먼트로 갈아끼워 실제 생성 결과를 본다
   (product-line.test.js의 captureRender와 같은 수법). */
function captureRender(ctx, fn) {
  const box = {};
  const orig = ctx.document.getElementById;
  ctx.document.getElementById = id => (box[id] = box[id] || { innerHTML: '', value: '', style: {}, offsetHeight: 120, offsetWidth: 160,
    classList: { add() {}, remove() {}, contains: () => false },
    querySelectorAll: () => ({ length: 0, forEach() {} }), querySelector: () => null,
    getBoundingClientRect: () => ({ top: 0, bottom: 20, left: 0, right: 100, width: 100 }) });
  try { fn(); } finally { ctx.document.getElementById = orig; }
  return box;
}

// 채널·제품·기간이 서로 엇갈리게 섞인 표본 — "채널만" 혹은 "기간만" 맞는 건이 반드시 섞여 있어야
// AND 조합이 실제로 검증된다.
const SAMPLE = [
  { dealId: 'D1', ch: '러브지나', product: '더 플렌더 PRO', start: '2026-05-05', end: '2026-05-07', rev: 1000, qty: 10, views: 10 },
  { dealId: 'D2', ch: '러브지나', product: '더 플렌더 MAX', start: '2026-06-05', end: '2026-06-07', rev: 2000, qty: 20, views: 20 },
  { dealId: 'D3', ch: '키친퀸',   product: '더 플렌더 PRO', start: '2026-05-10', end: '2026-05-12', rev: 4000, qty: 40, views: 40 },
  { dealId: 'D4', ch: '러브지나', product: '더 시프트',     start: '2026-05-15', end: '2026-05-17', rev: 8000, qty: 80, views: 80 },
  { dealId: 'D5', ch: '러브지나', product: '더 슬림',       start: '2026-05-20', end: '2026-05-22', rev: 1600, qty: 16, views: 16 },
];

(async () => {
  const { ctx, X, src } = loadFrontend(PROJ, SHIM);
  const html = readFrontSource(PROJ);
  const DATA = X.DATA;
  DATA.splice(0, DATA.length, ...SAMPLE.map(d => ({ ...d })));
  X.setSalesYM([2026], [1,2,3,4,5,6,7,8,9,10,11,12]);

  console.log('\n[1] 공용 컴포넌트 — 대시보드와 품목 페이지가 같은 구현을 공유');
  const inf = X.INF_SEARCH;
  check('INF_SEARCH에 dash/sales 두 scope가 등록됨',
    inf && inf.dash && inf.sales, inf && Object.keys(inf));
  check('dash scope가 기존 대시보드 입력창/팝오버를 가리킴',
    inf.dash.input === 'dashInfluencerInput' && inf.dash.pop === 'dashInfluencerPop');
  check('sales scope가 품목 페이지 입력창/팝오버를 가리킴',
    inf.sales.input === 'salesInfluencerInput' && inf.sales.pop === 'salesInfluencerPop');
  ['_onInfSearchInput','_onInfSearchFocus','_onInfSearchKeydown','_renderInfSearchPop',
   '_positionInfSearchPop','_selectInfSearch','_clearInfSearch'].forEach(fn => {
    check('공용 함수 ' + fn + ' 존재', typeof ctx[fn] === 'function', typeof ctx[fn]);
  });
  // 복붙 재발 방지 — scope별 전용 사본이 되살아나면 여기서 걸린다
  ['_selectDashInfluencer','_clearDashInfluencerFilter','_onDashInfluencerInput',
   '_onDashInfluencerFocus','_onDashInfluencerKeydown','_renderDashInfluencerPop',
   '_positionDashInfluencerPop'].forEach(fn => {
    check('대시보드 전용 사본 ' + fn + ' 이 남아 있지 않음', ctx[fn] === undefined);
  });
  check('sales 전용 검색 함수 사본이 따로 생기지 않음',
    !/function _onSalesInfluencer|function _selectSalesInfluencer/.test(src));

  console.log('\n[2] 마크업 — 기간 필터 카드 안에 대시보드와 같은 검색 입력이 있음');
  check('salesInfluencerInput이 존재', html.includes('id="salesInfluencerInput"'));
  check('플레이스홀더가 대시보드와 동일("채널명 검색(예: 러브지나)")',
    (html.match(/placeholder="채널명 검색\(예: 러브지나\)"/g) || []).length === 2,
    (html.match(/placeholder="채널명 검색\(예: 러브지나\)"/g) || []).length);
  check('자동완성 팝오버 salesInfluencerPop이 존재', html.includes('id="salesInfluencerPop"'));
  check('입력 핸들러가 공용 함수에 sales scope를 넘김',
    /oninput="_onInfSearchInput\('sales',this\.value\)"/.test(html));
  check('대시보드 입력도 같은 공용 함수를 씀',
    /oninput="_onInfSearchInput\('dash',this\.value\)"/.test(html));
  // 기간 필터 카드(연/월 체크박스) 안에 들어 있어야 함 — ymChips 앞, monthChkList 뒤
  const iMonth = html.indexOf('id="monthChkList"');
  const iInput = html.indexOf('id="salesInfluencerInput"');
  const iChips = html.indexOf('id="ymChips"');
  check('월 체크박스 줄과 기간 칩 사이(= 기간 필터 카드 안)에 배치됨',
    iMonth > 0 && iInput > iMonth && iChips > iInput, { iMonth, iInput, iChips });

  console.log('\n[3] 자동완성 — 후보는 DATA에서 매번 뽑고, 부분일치로 좁혀짐');
  const popBox = captureRender(ctx, () => ctx._onInfSearchInput('sales', '지나'));
  const popHtml = popBox['salesInfluencerPop'].innerHTML;
  check('부분일치로 러브지나가 후보에 나옴', popHtml.includes('러브지나'), popHtml);
  check('일치하지 않는 채널(키친퀸)은 후보에서 빠짐', !popHtml.includes('키친퀸'), popHtml);
  check('후보 클릭이 sales scope로 연결됨', popHtml.includes("_selectInfSearch('sales'"), popHtml);
  const emptyBox = captureRender(ctx, () => ctx._onInfSearchInput('sales', '없는채널명'));
  check('일치 없으면 안내 문구', emptyBox['salesInfluencerPop'].innerHTML.includes('일치하는 채널이 없습니다'));
  const allBox = captureRender(ctx, () => ctx._onInfSearchInput('sales', ''));
  check('빈 입력이면 전체 채널이 후보',
    allBox['salesInfluencerPop'].innerHTML.includes('러브지나') &&
    allBox['salesInfluencerPop'].innerHTML.includes('키친퀸'));

  console.log('\n[4] salesYMMatch — 기간과 AND, 대소문자·공백 무시');
  X.setSalesChannel('러브지나');
  const matched = DATA.filter(ctx.salesYMMatch).map(d => d.dealId);
  check('선택 채널의 건만 통과', JSON.stringify(matched) === JSON.stringify(['D1','D2','D4','D5']), matched);
  X.setSalesYM([2026], [5]); // 5월만
  const may = DATA.filter(ctx.salesYMMatch).map(d => d.dealId);
  check('기간(5월)과 AND로 조합됨 — 6월 건 D2가 빠짐',
    JSON.stringify(may) === JSON.stringify(['D1','D4','D5']), may);
  X.setSalesYM([2026], [1,2,3,4,5,6,7,8,9,10,11,12]);
  X.setSalesChannel(' 러브 지나 ');
  check('공백이 달라도 같은 채널로 매칭',
    DATA.filter(ctx.salesYMMatch).length === 4, DATA.filter(ctx.salesYMMatch).length);
  X.setSalesChannel(null);
  check('채널 해제 시 전체 건이 통과', DATA.filter(ctx.salesYMMatch).length === 5);

  console.log('\n[5] KPI·실적 상세 표 — 한 경로(filteredProd→salesYMMatch)만 타서 항상 일치');
  X.ST.prod = '플렌더'; X.ST.model = 'all';
  X.setSalesChannel(null);
  const kpiAll = captureRender(ctx, () => ctx.renderSalesKpi())['salesKpiRow'].innerHTML;
  check('필터 없을 때 더 플렌더 3건 · 7,000원', /3건/.test(kpiAll) && /7,000/.test(kpiAll), kpiAll);
  X.setSalesChannel('러브지나');
  const kpiCh = captureRender(ctx, () => ctx.renderSalesKpi())['salesKpiRow'].innerHTML;
  check('채널 선택 시 KPI가 해당 채널만 집계(2건 · 3,000원)',
    /2건/.test(kpiCh) && /3,000/.test(kpiCh), kpiCh);
  check('총 판매수량도 함께 좁혀짐(30개)', /30<span class="kpi-unit">개/.test(kpiCh), kpiCh);
  const tbl = captureRender(ctx, () => ctx.renderTbl())['tBody'].innerHTML;
  check('표에 해당 채널 건만 남음', tbl.includes('D1') && tbl.includes('D2') && !tbl.includes('D3'), tbl.slice(0, 300));
  check('KPI 건수와 표 행 수가 일치', (tbl.match(/<tr /g) || []).length === 2, (tbl.match(/<tr /g) || []).length);

  console.log('\n[6] 모델 탭(ST.model)과도 AND 조합');
  X.ST.model = 'PRO';
  const kpiPro = captureRender(ctx, () => ctx.renderSalesKpi())['salesKpiRow'].innerHTML;
  check('러브지나 + PRO 탭 = 1건 · 1,000원', /1건/.test(kpiPro) && /1,000/.test(kpiPro), kpiPro);
  X.ST.model = 'MAX';
  const kpiMax = captureRender(ctx, () => ctx.renderSalesKpi())['salesKpiRow'].innerHTML;
  check('러브지나 + MAX 탭 = 1건 · 2,000원', /1건/.test(kpiMax) && /2,000/.test(kpiMax), kpiMax);
  X.ST.model = 'all';

  console.log('\n[7] 다른 품목 페이지에서도 같은 필터가 동작');
  [['시프트', 'D4'], ['슬림', 'D5']].forEach(([prod, dealId]) => {
    X.ST.prod = prod;
    const t = captureRender(ctx, () => ctx.renderTbl())['tBody'].innerHTML;
    check(prod + ' 페이지에서도 채널 필터가 적용됨(' + dealId + ' 1건)',
      t.includes(dealId) && (t.match(/<tr /g) || []).length === 1, (t.match(/<tr /g) || []).length);
  });
  X.ST.prod = '에어드라이';
  const airTbl = captureRender(ctx, () => ctx.renderTbl())['tBody'].innerHTML;
  check('해당 채널 실적이 없는 품목은 "데이터 없음"', airTbl.includes('데이터 없음'), airTbl.slice(0, 200));
  X.ST.prod = '플렌더';

  console.log('\n[8] 칩 — 기간 칩과 같은 줄에 뜨고 ✕로 해제됨');
  const chipBox = captureRender(ctx, () => ctx.renderYMFilterBar())['ymChips'].innerHTML;
  check('인플루언서 칩이 뜸', chipBox.includes('인플루언서: 러브지나'), chipBox);
  check('기간 칩과 같은 줄(#ymChips)에 함께 있음',
    chipBox.includes('연도: 전체') && chipBox.includes('월: 전체'), chipBox);
  check('칩 해제 버튼이 공용 해제 함수를 호출', chipBox.includes("_clearInfSearch('sales')"), chipBox);
  ctx._clearInfSearch('sales');
  check('_clearInfSearch로 채널 상태가 비워짐', X.SALES_YM.channel === null, X.SALES_YM.channel);
  const chipOff = captureRender(ctx, () => ctx.renderYMFilterBar())['ymChips'].innerHTML;
  check('해제 후 인플루언서 칩이 사라짐', !chipOff.includes('인플루언서:'), chipOff);
  check('해제 후 KPI가 전체로 복귀(3건)',
    /3건/.test(captureRender(ctx, () => ctx.renderSalesKpi())['salesKpiRow'].innerHTML));

  console.log('\n[9] 선택 동작 — 입력창은 비우고 팝오버는 닫고 상태만 남김');
  ctx._selectInfSearch('sales', '키친퀸');
  check('_selectInfSearch가 SALES_YM.channel에 채널을 담음', X.SALES_YM.channel === '키친퀸', X.SALES_YM.channel);
  check('dash scope는 DASH.channel에 담김(서로 독립)', X.DASH.channel !== '키친퀸', X.DASH.channel);
  ctx._selectInfSearch('dash', '러브지나');
  check('dash scope 선택이 DASH.channel을 바꿈', X.DASH.channel === '러브지나', X.DASH.channel);
  check('dash 선택이 품목 페이지 상태를 건드리지 않음', X.SALES_YM.channel === '키친퀸', X.SALES_YM.channel);

  console.log('\n[10] 페이지 전환 시 초기화 / 같은 페이지 안에서는 유지');
  X.setSalesChannel('러브지나');
  ctx.navSales(null, '시프트');
  check('navSales(품목 전환)가 채널 검색을 초기화', X.SALES_YM.channel === null, X.SALES_YM.channel);
  X.setSalesChannel('러브지나');
  ctx.toggleYM('months', 5, false); // 월 체크박스 변경
  check('월 필터를 바꿔도 채널 검색은 유지', X.SALES_YM.channel === '러브지나', X.SALES_YM.channel);
  ctx.toggleYM('months', 5, true);
  ctx.ymSelectAll('years');
  check('연도 전체 선택을 눌러도 채널 검색은 유지', X.SALES_YM.channel === '러브지나', X.SALES_YM.channel);
  /* 모델 탭 핸들러는 ST.model을 바꾸고 render()만 부른다(navSales를 타지 않음).
     그 경로를 그대로 흉내 내서, 탭을 오가도 채널 검색이 살아 있는지 실제로 확인한다. */
  X.ST.prod = '플렌더';
  ['PRO', 'MAX', 'all'].forEach(m => { X.ST.model = m; ctx.render(); });
  check('모델 탭을 오가도(render() 경로) 채널 검색이 유지됨',
    X.SALES_YM.channel === '러브지나', X.SALES_YM.channel);
  check('유지된 채널이 탭 전환 후 집계에도 계속 반영됨(러브지나 2건)',
    /2건/.test(captureRender(ctx, () => ctx.renderSalesKpi())['salesKpiRow'].innerHTML));

  console.log('\n[11] 팝오버가 카드 밖(body 직속)으로 옮겨져 잘리지 않음');
  check('두 팝오버 모두 body 이동 대상에 등록됨',
    /\['dashInfluencerPop','salesInfluencerPop'\]\.forEach/.test(src));
  check('스크롤/리사이즈 시 열려 있는 팝오버를 scope별로 재배치',
    /Object\.keys\(INF_SEARCH\)\.forEach\(scope=>\{[\s\S]{0,200}_positionInfSearchPop\(scope\)/.test(src));
  check('바깥 클릭 닫기에서 두 입력창 모두 예외 처리',
    /Object\.keys\(INF_SEARCH\)\.some\(sc=>ev\.target\.id===INF_SEARCH\[sc\]\.input\)/.test(src));

  console.log('\n통과 ' + pass + ' / 실패 ' + fail);
  process.exit(fail ? 1 : 0);
})();
