'use strict';
/* 공구 분석 — KPI, 페이지 렌더 진입점(renderDashboard), 개별 공구건 목록, 산점도·추이 차트. */

/* ── 카드 하단 "제품 목록" 문구 (공용) ──
   같은 제품이 여러 건이어도 한 번만 쓰고 뒤에 건수를 붙임. 예전엔 deals.map(d=>d.product)를
   그대로 join해서 "더 플렌더 MAX · 더 플렌더 MAX · 더 플렌더 mini · 더 플렌더 mini"처럼
   같은 이름이 반복돼 몇 종인지도, 어느 제품이 많은지도 안 보였음.
   제품명은 시트 원본 표기가 아니라 productColorKey→PRODUCT_GROUP_LABELS를 거친 정규화 라벨을 씀 —
   "더시프트"/"더 시프트"처럼 띄어쓰기만 다른 표기가 서로 다른 종으로 세어지는 걸 막고, 대시보드의
   다른 표·배지와 같은 이름으로 보이게 하려는 것. 매핑에 없는 신제품은 productLineKey와 같은 규칙으로
   제품명 자체를 라벨로 씀("기타"로 뭉개서 이름이 사라지지 않도록).
   정렬은 건수 내림차순 → 동수면 PRODUCT_TAXONOMY 순서(더 플렌더→더 시프트→더 슬림→더 에어드라이).
   건수는 1이어도 생략하지 않음 — 표시된 숫자를 더하면 카드의 건수와 맞아떨어져야 하기 때문.
   반환 {text,title}: text=카드에 넣을 문구(maxItems 초과분은 "외 N종"으로 접힘),
   title=접혔을 때만 채워지는 전체 목록(카드 hover 툴팁용 — 안 접혔으면 보이는 문구와 같아서 빈 값). */
const PRODUCT_SUMMARY_MAX=4; // 이 종수를 넘으면 상위 N개만 쓰고 나머지는 "외 N종"으로 접음
function formatProductSummary(deals,maxItems=PRODUCT_SUMMARY_MAX){
  const order=Object.keys(PRODUCT_GROUP_LABELS); // PRODUCT_TAXONOMY에서 파생된 고정 순서(+맨 뒤 other)
  const map=new Map();
  (deals||[]).forEach(d=>{
    const fine=productColorKey(d.product);
    const key=fine==='other'?(String(d.product||'').trim()||'other'):fine;
    if(!map.has(key))map.set(key,{key,label:PRODUCT_GROUP_LABELS[key]||key,n:0});
    map.get(key).n++;
  });
  if(!map.size)return{text:'없음',title:''};
  const rank=k=>{const i=order.indexOf(k);return i===-1?order.length:i;}; // 매핑에 없는 신제품은 맨 뒤
  const rows=[...map.values()].sort((a,b)=>
    (b.n-a.n)||(rank(a.key)-rank(b.key))||a.label.localeCompare(b.label));
  const part=r=>`${r.label} ${r.n}`;
  const full=rows.map(part).join(' · ');
  if(rows.length<=maxItems)return{text:full,title:''};
  return{text:rows.slice(0,maxItems).map(part).join(' · ')+` 외 ${rows.length-maxItems}종`,title:full};
}

/* KPI (기간 필터 기준) */
function renderKPI(){
  const f=dashData(),done=f.filter(d=>_displayStatus(d)==='완료'),act=f.filter(d=>_displayStatus(d)==='진행중'),plan=f.filter(d=>_displayStatus(d)==='예정');
  // 매출은 완료+진행중 기준(예정 제외) — 매출 추이 차트(renderDashCharts)와 반드시 같은 기준을 씀.
  const revScope=f.filter(_isRevStatus);
  const tRev=revScope.reduce((s,d)=>s+(d.rev||0),0);
  const tRevQty=revScope.reduce((s,d)=>s+(d.qty||0),0); // 총 판매수량 KPI — 총 매출과 같은 스코프
  // d.views는 이미 "만" 단위(P열 원값) — 실제 조회수로 환산할 때만 ×10000. 아래 tViews/tQty는
  // 평균 조회수·전환율 계산용이라 완료 건만 확정 실적으로 보고 "완료 건 기준"을 유지함(진행중 건은
  // 아직 릴스 조회수가 최종 확정 전이라 분모에 섞으면 전환율이 왜곡됨). 반면 "총 판매수량" KPI는
  // 총 매출과 짝을 이루는 수치라 위 tRevQty(완료+진행중)를 씀 — 두 기준이 공존하는 건 의도된 것.
  const tViews=done.reduce((s,d)=>s+(d.views||0),0),tQty=done.reduce((s,d)=>s+(d.qty||0),0);
  const avgV=done.length?tViews/done.length:0;
  const conv=tViews>0&&tQty>0?((tQty/(tViews*10000))*100).toFixed(2)+'%':'—';
  const actProducts=formatProductSummary(act); // 접힌 경우에만 title이 채워져 카드 hover 툴팁이 붙음
  document.getElementById('kpiRow').innerHTML=`
    <div class="kpi"><div class="kpi-lbl">총 매출 (완료+진행중)</div><div class="kpi-val cm">${tRev?won(tRev):'—'}</div><div class="kpi-sub">완료 ${done.length}건 · 진행중 ${act.length}건</div></div>
    <div class="kpi"><div class="kpi-lbl">총 판매수량</div><div class="kpi-val cn">${tRevQty?num(tRevQty)+'<span class="kpi-unit">개</span>':'—'}</div><div class="kpi-sub">완료+진행중 기준</div></div>
    <div class="kpi"${actProducts.title?` title="${_escAttr(actProducts.title)}"`:''}><div class="kpi-lbl">진행 중</div><div class="kpi-val cw">${act.length}<span class="kpi-unit">건</span></div><div class="kpi-sub">${actProducts.text}</div></div>
    <div class="kpi"><div class="kpi-lbl">예정</div><div class="kpi-val cn">${plan.length}<span class="kpi-unit">건</span></div><div class="kpi-sub">다가오는 공구</div></div>
    <div class="kpi"><div class="kpi-lbl">평균 릴스 조회수</div><div class="kpi-val cm">${avgV?avgV.toFixed(1)+'<span class="kpi-unit">만</span>':'—'}</div><div class="kpi-sub">완료 건 기준</div></div>
    <div class="kpi"><div class="kpi-lbl">조회→구매 전환율</div><div class="kpi-val cok">${conv}</div><div class="kpi-sub">릴스 조회수 기준</div></div>`;
}

// renderDashList()(개별 공구건 목록)는 항상 맨 마지막에 호출 — 새 분석 섹션을 추가할 땐
// renderDashList() 호출 "이전"에 끼워 넣기만 하면 화면에서도 항상 그 위에 위치가 보장됨
// (HTML에서도 #dashSelBody 카드가 #page-dashboard의 마지막 자식으로 고정돼 있음).
function renderDashboard(){
  // 등급 산정 캐시는 여기서 비움 — DATA를 바꾼 뒤 render() 대신 renderDashboard()만 호출하는
  // 경로가 하나라도 생기면 낡은 등급이 그대로 그려지기 때문. 한 번의 O(건수) 패스라 비용은 무시 가능.
  invalidateTierStats();
  renderDashPeriodBar();
  renderKPI();
  renderDashCharts();
  renderDashAnalytics();
  renderDashAchievement();
  renderDashSeasonality();
  renderDashList();
}
/* ── 개별 공구건 목록 정렬 ──────────────────────────────────────────────────
   헤더 UI·토글 규칙은 실적 상세 표(SALES_COLS/SALES_SORT/sortSales)와 같은 방식 — 컬럼명 옆 ⇕,
   클릭하면 오름차순부터 시작, 같은 컬럼 재클릭 시 방향 반전, 활성 컬럼만 ▲/▼.
   기본값은 기간(시작일) 오름차순. 상태를 모듈 변수로만 들고 있어 필터를 바꿔도 유지되고
   새로고침하면 기본값으로 돌아감(정렬은 "지금 보는 방식"이지 저장해 둘 설정이 아니라고 봄). */
const DASH_SEL_COLS=[
  {key:'product',lb:'제품'},{key:'ch',lb:'채널'},{key:'period',lb:'기간'},
  {key:'views',lb:'조회수'},{key:'rev',lb:'매출'},
];
let DASH_SEL_SORT={key:'period',dir:1};
function sortDashSel(key){
  if(DASH_SEL_SORT.key===key)DASH_SEL_SORT.dir*=-1;else DASH_SEL_SORT={key,dir:1};
  renderDashList();
}
// 제품 정렬 순위 — PRODUCT_TAXONOMY 배열 순서를 그대로 씀(더 플렌더→더 시프트→더 슬림→
// 더 에어드라이, 같은 라인 안에서는 세부 모델 순). 매핑에 없는 신제품은 맨 뒤.
const _PRODUCT_RANK=Object.assign({},...PRODUCT_TAXONOMY.map((t,i)=>({[t.key]:i})));
function _productRank(p){const r=_PRODUCT_RANK[productColorKey(p)];return r==null?PRODUCT_TAXONOMY.length:r;}
// 기본 정렬이자 모든 컬럼의 동점 처리 — 시작일 → 종료일 → 채널명 순
function _dashSelPeriodCmp(a,b){
  return String(a.start||'').localeCompare(String(b.start||''))
    ||String(a.end||'').localeCompare(String(b.end||''))
    ||String(a.ch||'').localeCompare(String(b.ch||''));
}
function _dashSelCompare(a,b){
  const key=DASH_SEL_SORT.key,dir=DASH_SEL_SORT.dir;
  if(key==='period')return _dashSelPeriodCmp(a,b)*dir;
  if(key==='product')return (_productRank(a.product)-_productRank(b.product)
    ||String(a.product||'').localeCompare(String(b.product||'')))*dir||_dashSelPeriodCmp(a,b);
  if(key==='ch')return String(a.ch||'').localeCompare(String(b.ch||''))*dir||_dashSelPeriodCmp(a,b);
  // 숫자 컬럼 — 미기입("—")은 정렬 방향과 무관하게 항상 맨 아래(채널별 성과 표와 같은 규칙)
  const va=a[key],vb=b[key];
  if(va==null&&vb==null)return _dashSelPeriodCmp(a,b);
  if(va==null)return 1;
  if(vb==null)return -1;
  return (va-vb)*dir||_dashSelPeriodCmp(a,b);
}
/* 목록: 상단 기간 필터로 걸러진 공구건 전체를 조회 전용으로 표시 (선택/체크박스 없음) */
function renderDashList(){
  const list=dashData().sort(_dashSelCompare);
  document.getElementById('dashSelHead').innerHTML=DASH_SEL_COLS.map(c=>
    sortableThHtml(c,{sorted:DASH_SEL_SORT.key===c.key,dir:DASH_SEL_SORT.dir,
      onclick:`sortDashSel('${c.key}')`})).join('');
  document.getElementById('dashSelBody').innerHTML=list.length?list.map(d=>`
    <tr>
      <td>${productBadge(d.product)}</td>
      <td>${chCell(d)}</td>
      <td>${fmtS(d.start)} ~ ${fmtS(d.end)}</td>
      <td>${d.views!=null?d.views.toFixed(1)+'만':'—'}</td>
      <td>${d.rev!=null?won(d.rev):'—'}</td>
    </tr>`).join(''):'<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-3)">해당 기간에 공구건이 없습니다</td></tr>';
  document.getElementById('dashSelCnt').textContent=`${list.length}건`;
}

/* Chart.js: 산점도 + 기간별 추이 라인차트 */
let _scChartInst=null,_trendChartInst=null;
function renderDashCharts(){
  if(typeof Chart==='undefined')return; // CDN 로드 실패 시 조용히 건너뜀
  const periodAll=dashData();
  // 산점도: 조회수 있는 건만 표시(매출은 미기입 시 0으로 표시) + 매출 집계 기준(완료+진행중, 예정
  // 제외)과 통일 — KPI 총매출·매출 추이와 같은 공구건 집합을 그려야 서로 어긋나 보이지 않음.
  const scPts=periodAll.filter(d=>d.views!=null&&_isRevStatus(d));
  const scViewsMissing=periodAll.filter(d=>d.views==null).length;
  const scPlanExcluded=periodAll.filter(d=>d.views!=null&&!_isRevStatus(d)).length;

  // 점 색을 등급별로 구분(미분류는 회색) — 등급마다 별도 데이터셋으로 나눠야 Chart.js 범례가
  // 자동으로 등급 범례가 됨. 데이터셋 순서는 TIER_OPTIONS 순서(+맨 뒤 미분류)로 고정해서
  // 범례 순서가 표/차트와 항상 같게 맞춤. 해당 등급의 점이 하나도 없으면 범례에서도 뺌.
  const scDatasets=[...TIER_OPTIONS,TIER_UNRATED].map(t=>({
    label:tierLabel(t),
    data:scPts.filter(d=>effectiveTierOf(d)===t).map(d=>({x:d.views,y:d.rev||0,ch:d.ch,product:d.product,tier:tierLabel(t)})),
    backgroundColor:tierColor(t).fg
  })).filter(ds=>ds.data.length);
  const scEl=document.getElementById('scChart');
  if(_scChartInst)_scChartInst.destroy();
  _scChartInst=new Chart(scEl.getContext('2d'),{
    type:'scatter',
    data:{datasets:scDatasets},
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:true,position:'bottom',labels:{boxWidth:10,font:{size:11},usePointStyle:true}},tooltip:{callbacks:{label:ctx=>{
        const d=ctx.raw;
        return[`${d.ch} (${d.product})`,`등급: ${d.tier}`,`조회수: ${d.x.toFixed(1)}만`,`매출: ${won(d.y)}`];
      }}}},
      scales:{x:{title:{display:true,text:'릴스 조회수(만)'}},y:{title:{display:true,text:'매출(원)'}}}
    }
  });
  const scNoteEl=document.getElementById('scChartNote');
  if(scNoteEl){
    const scNoteParts=[];
    if(scViewsMissing>0)scNoteParts.push(`조회수 미기입 ${scViewsMissing}건`);
    if(scPlanExcluded>0)scNoteParts.push(`예정 건 ${scPlanExcluded}건`);
    scNoteEl.textContent=scNoteParts.length?`${scNoteParts.join(', ')} 제외`:'';
  }

  // 매출·조회수 추이: 조회수 유무와 무관하게 기간 내 모든 공구건을 날짜축에 포함하되, 매출은
  // KPI 총매출과 같은 기준(완료+진행중, 예정 제외)만 더함 — 조회수는 예정 건도 거의 항상
  // 비어있어(아직 콘텐츠 게시 전) 별도 제외 없이 그대로 둠.
  const byDate={};
  periodAll.forEach(d=>{
    const key=d.end||d.start;
    if(!byDate[key])byDate[key]={rev:0,views:0};
    if(_isRevStatus(d))byDate[key].rev+=d.rev||0;
    byDate[key].views+=d.views||0;
  });
  const dates=Object.keys(byDate).sort();
  const trendEl=document.getElementById('trendChart');
  if(_trendChartInst)_trendChartInst.destroy();
  _trendChartInst=new Chart(trendEl.getContext('2d'),{
    type:'line',
    data:{
      labels:dates.map(fmtS),
      datasets:[
        {label:'매출',data:dates.map(k=>byDate[k].rev),yAxisID:'y',borderColor:'#3B56E5',backgroundColor:'#3B56E5',tension:.25},
        {label:'조회수(만)',data:dates.map(k=>byDate[k].views),yAxisID:'y2',borderColor:'#F59E0B',backgroundColor:'#F59E0B',tension:.25}
      ]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      scales:{
        y:{type:'linear',position:'left',title:{display:true,text:'매출(원)'}},
        y2:{type:'linear',position:'right',title:{display:true,text:'조회수(만)'},grid:{drawOnChartArea:false}}
      }
    }
  });

  // 검증: 매출 추이 그래프 합계가 KPI 총매출(완료+진행중 기준)과 일치하는지 확인
  const trendRevSum=Object.keys(byDate).reduce((s,k)=>s+byDate[k].rev,0);
  const kpiRevSum=periodAll.filter(_isRevStatus).reduce((s,d)=>s+(d.rev||0),0);
  if(Math.round(trendRevSum)!==Math.round(kpiRevSum)){
    console.warn('[검증] 매출 추이 합계가 KPI 총매출과 다릅니다',{trendRevSum,kpiRevSum});
  }else{
    console.log('[검증] 매출 추이 합계 == KPI 총매출',trendRevSum);
  }
}

/* ── 대시보드: 채널별·제품군별·플랫폼별 분석 ──
   전부 dashData()(상단 기간 필터 결과)를 그대로 재사용해 자동으로 기간 필터에 연동됨.
   "완료+진행중" 상태 건만 집계 대상으로 삼음(2026-08-24) — KPI 카드 총매출·매출 추이 차트와
   동일한 매출 기준(_isRevStatus)이라 숫자가 서로 다른 화면끼리 어긋나 보이지 않음. 예정 건은
   아직 시작 전이라 실적 값이 없는 게 정상이므로 제외.
   ※ 달성률 분석(renderDashAchievement)은 이 매출 기준을 따르지 않음(아래 별도 주석 참고) —
   달성률은 판매가 끝나야 확정되는 지표라 진행중 건을 섞으면 "아직 목표에 못 미친 게 당연한"
   건이 미달로 잡혀 평균·분포가 왜곡됨(2026-08-25 확인). */
function _dashRevScope(){return dashData().filter(_isRevStatus);}
function _safeDiv(n,d){return(d&&d>0)?n/d:null;} // 분모가 0/없음이면 null → 호출부에서 '—'로 표시
function _pct1(n){return n==null?'—':n.toFixed(1)+'%';}
function _wonPerView(rev,viewsManwon){return _safeDiv(rev,viewsManwon*10000);} // views는 "만" 단위 저장값
// 축 눈금용 금액 축약 — 축 최대값을 보고 단위를 한 번만 정해 모든 눈금에 같은 단위를 씀.
// 눈금마다 단위가 갈리면("8,000만 · 1.2억") 읽기 어렵고, 원 단위 그대로면 ₩1,800,000,000처럼
// 길어져 눈금끼리 겹치거나 축이 차트 폭을 잡아먹음(툴팁은 계속 원 단위 전체 표기를 씀).
function _niceAxisScale(raw,targetSteps){
  if(!(raw>0))return null;
  const n=targetSteps||4;
  const rough=raw/n;
  const mag=Math.pow(10,Math.floor(Math.log10(rough)));
  const norm=rough/mag;
  const step=(norm<=1?1:norm<=2?2:norm<=2.5?2.5:norm<=5?5:10)*mag;
  return{max:Math.ceil(raw/step)*step,step};
}
function _axisMoneyFmt(maxVal){
  const m=Math.abs(maxVal||0);
  if(m>=100000000)return v=>v?(Math.round(v/100000000*10)/10).toLocaleString('ko-KR')+'억':'₩0';
  if(m>=10000)return v=>v?Math.round(v/10000).toLocaleString('ko-KR')+'만':'₩0';
  return v=>won(v);
}

let _dashChannelChartInst=null,_dashProductChartInst=null,_dashPlatformChartInst=null;
function renderDashAnalytics(){
  renderDashTierAnalytics();
  renderDashGapAnalytics(); // 등급 교차 분석 — 등급별 성과 바로 아래 카드
  renderDashChannelAnalytics();
  renderDashProductAnalytics();
  renderDashPlatformAnalytics();
}
