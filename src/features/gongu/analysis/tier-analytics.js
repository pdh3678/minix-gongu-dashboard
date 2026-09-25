'use strict';
/* 공구 분석 — 등급별 성과(표·비중·히트맵·안정성·재협업·믹스). */

/* ── 등급별 성과: 스코프 헬퍼 ──────────────────────────────────────────────
   이 섹션(1차 표·비중 바 + 2차 4개 차트)만은 전역 "등급 필터"를 스코프에서 빼고 4등급을 항상
   전부 그린다. 등급 간 비교가 존재 이유인 섹션인데 한 등급만 남기면 비교 대상 자체가 사라지기
   때문 — 대신 선택된 등급을 진하게, 나머지를 흐리게 해서 필터가 걸린 사실은 그대로 드러냄.
   (KPI·채널별·제품군별 등 나머지 섹션은 예전처럼 등급 필터를 그대로 반영함) */
function _dashTierScope(){return DATA.filter(d=>d.start&&dashPeriodMatch(d,{ignoreTier:true})&&_isRevStatus(d));}
// 재협업률 전용 — 기간을 자르면 "이 채널과 여러 번 했는지"가 원리상 보이지 않으므로 연/월/주차를 무시.
function _dashTierScopeAllTime(){return DATA.filter(d=>d.start&&dashPeriodMatch(d,{ignoreTier:true,ignorePeriod:true})&&_isRevStatus(d));}
// 월별 믹스 전용 — 시즌성 분석과 같은 규칙(연도만 적용, 월/주차는 무시하고 선택 월을 강조).
function _dashTierScopeYear(){return DATA.filter(d=>d.start&&dashPeriodMatch(d,{ignoreTier:true,ignoreMonthWeek:true})&&_isRevStatus(d));}
// 히트맵 전용 — 품목 필터까지 무시. 열(제품군)을 지워버리면 "등급 × 제품군" 비교 자체가
// 성립하지 않으므로, 등급 필터와 같은 방식으로 선택 열만 진하게 하고 나머지는 흐리게 함.
function _dashTierScopeAllProducts(){return DATA.filter(d=>d.start&&dashPeriodMatch(d,{ignoreTier:true,ignoreProduct:true})&&_isRevStatus(d));}

// 등급 필터가 특정 등급일 때, 그 등급이 아닌 것들을 흐리게 하기 위한 판정/색 계산
const TIER_DIM_ALPHA=0.22;
// 강조 대상은 "지금 보고 있는 축"의 필터값 — 축을 팔로워로 바꾸면 팔로워등급 필터를 따라감
function _dashAxisFilterValue(){return _dashTierAxis==='follower'?DASH.followerTier:DASH.revTier;}
function _tierDimmed(key){const v=_dashAxisFilterValue();return !!(v&&v!=='all'&&v!==key);}
function _hexAlpha(hex,a){
  const h=String(hex||'').replace('#','');
  const full=h.length===3?h.split('').map(c=>c+c).join(''):h;
  const n=parseInt(full,16);
  return`rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;
}
function _tierChartColor(key){
  const fg=tierColor(key).fg;
  return _tierDimmed(key)?_hexAlpha(fg,TIER_DIM_ALPHA):fg;
}
// 표본 부족 판정은 1차 표와 완전히 같은 기준(TIER_MIN_SAMPLE) 하나만 씀
function _tierLowSample(n){return n<TIER_MIN_SAMPLE;}

/* 0) 등급별 성과 — 인플루언서 등급(TIER_TAXONOMY) 단위 비교.
   다른 분석 섹션과 같은 매출 기준(완료+진행중)을 쓰되, 스코프만 위 _dashTierScope를 씀.
   등급 미분류 건은 집계에서 빼고 건수는 카드 우측 상단에 안내.
   표는 데이터 유무와 무관하게 항상 4등급을 TIER_OPTIONS 순서로 전부 보여줌 — 필터를 바꿔도 행 순서가
   흔들리지 않아야 등급 간 비교가 눈에 남기 때문(제품군별 비교처럼 매출순으로 재정렬하지 않는 이유).
   건수가 TIER_MIN_SAMPLE 미만이면 행 전체를 옅게 처리하고 비율 지표에 "참고용" 툴팁을 달아,
   1~2건짜리 평균·전환율이 다른 등급과 동등한 근거처럼 읽히지 않게 함. */
let _dashTierShareChartInst=null,_dashTierStabilityChartInst=null,_dashTierRepeatChartInst=null,_dashTierMixChartInst=null;
let _dashTierHeatMetric='avgRev'; // 'avgRev' | 'revSum' | 'conv'
let _dashTierMixMode='count';     // 'count' | 'rev' | 'pct'
function _onDashTierHeatMetricChange(){
  _dashTierHeatMetric=document.getElementById('dashTierHeatMetric').value;
  renderDashTierHeatmap();
}
function _onDashTierMixModeChange(){
  _dashTierMixMode=document.getElementById('dashTierMixMode').value;
  renderDashTierMix();
}

// 공구건 묶음 하나에서 등급 표/히트맵이 공통으로 쓰는 지표를 뽑음(집계 규칙을 한 곳에만 두기 위함)
function _tierMetrics(items){
  const revSum=items.reduce((s,d)=>s+(d.rev||0),0);
  const qtyVals=items.filter(d=>d.qty!=null).map(d=>d.qty);
  const viewVals=items.filter(d=>d.views!=null).map(d=>d.views);
  const qtySum=qtyVals.reduce((s,v)=>s+v,0),viewSum=viewVals.reduce((s,v)=>s+v,0);
  return{
    count:items.length,revSum,
    avgRev:_safeDiv(revSum,items.length),
    avgQty:_safeDiv(qtySum,qtyVals.length),
    avgViews:_safeDiv(viewSum,viewVals.length),
    conv:_safeDiv(qtySum,viewSum*10000),
    // views는 "만" 단위 저장값이라 그대로 나누면 곧바로 "조회수 1만당 매출"이 됨
    revPer10k:_safeDiv(revSum,viewSum)
  };
}

/* 축 토글 — 이 섹션(1차 표·비중 바 + 2차 4개 차트)과 달성률의 '등급' 기준이 한꺼번에 따라감.
   상태는 모듈 변수라 필터를 바꿔도 유지되고 새로고침하면 매출등급으로 돌아감(정렬 상태와 같은 규칙). */
function _setDashTierAxis(axis){
  if(!TIER_AXES[axis]||_dashTierAxis===axis)return;
  _dashTierAxis=axis;
  renderDashTierAnalytics();
  renderDashAchievement(); // 달성률의 '등급' 기준도 같은 축을 씀
}
function _renderDashTierAxisToggle(){
  const host=document.getElementById('dashTierAxisToggle');
  if(host)host.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.axis===_dashTierAxis));
  const hd=document.getElementById('dashTierHdAxis');
  if(hd)hd.textContent=_tierAxis().label;
  // 매출 지표 "참고용" ⓘ는 매출등급 축일 때만 — 팔로워등급은 매출로 산정되지 않아 자기참조가 아님
  const selfRef=_tierAxis().revSelfRef;
  document.querySelectorAll('.tier-selfref').forEach(el=>{el.style.display=selfRef?'':'none';});
}

function renderDashTierAnalytics(){
  const scope=_dashTierScope();
  const axis=_tierAxis();
  const body=document.getElementById('dashTierBody');
  const hdNote=document.getElementById('dashTierHdNote');
  const note=document.getElementById('dashTierNote');
  const chartEl=document.getElementById('dashTierShareChart');
  const grid=document.getElementById('dashTier2Grid');
  const empty=document.getElementById('dashTier2Empty');
  _renderDashTierAxisToggle();
  const classified=scope.filter(d=>isRatedTier(_axisTierOf(d)));
  const unclassified=scope.length-classified.length;

  // 미분류 안내는 카드 우측 상단으로(2차 차트까지 이 섹션 전체에 걸리는 조건이라 맨 위가 맞음)
  hdNote.textContent=`완료+진행중 기준 · ${axis.label} 기준`+(unclassified>0?` · ${axis.unratedWord} ${unclassified}건 제외`:'');
  // 아래 note는 "왜 필터를 걸었는데 다른 등급도 보이나"를 설명하는 자리로 씀
  const fv=_dashAxisFilterValue();
  note.textContent=(fv&&fv!=='all')
    ?`${axis.label} 필터: ${fv} 강조 — 비교를 위해 나머지 등급도 흐리게 함께 표시합니다`:'';

  if(!classified.length){
    body.innerHTML=`<tr><td colspan="8" class="dash-analytics-empty">${scope.length?(axis.key==='follower'?'해당 조건의 채널에 팔로워 수가 입력되지 않았습니다':'해당 조건의 채널은 아직 등급이 산정되지 않았습니다(완료 실적 필요)'):'해당 기간에 완료·진행중인 공구건이 없습니다'}</td></tr>`;
    if(_dashTierShareChartInst){_dashTierShareChartInst.destroy();_dashTierShareChartInst=null;}
    // 2차 영역은 통째로 빈 상태 카드로 대체
    grid.style.display='none';
    empty.style.display='';
    [_dashTierStabilityChartInst,_dashTierRepeatChartInst,_dashTierMixChartInst].forEach(c=>{if(c)c.destroy();});
    _dashTierStabilityChartInst=_dashTierRepeatChartInst=_dashTierMixChartInst=null;
    document.getElementById('dashTierHeatmap').innerHTML='';
    return;
  }
  grid.style.display='';
  empty.style.display='none';

  const totalCount=classified.length;
  const totalRev=classified.reduce((s,d)=>s+(d.rev||0),0);
  const rows=TIER_OPTIONS.map(key=>{
    const items=classified.filter(d=>_axisTierOf(d)===key);
    const m=_tierMetrics(items);
    return Object.assign({key},m,{
      countShare:_safeDiv(m.count,totalCount),
      revShare:_safeDiv(m.revSum,totalRev)
    });
  });

  body.innerHTML=rows.map(r=>{
    const low=_tierLowSample(r.count);
    // 건수 0은 "표본이 적다"기보다 "아예 없다"라서 배지를 달지 않음(행이 옅어지는 것으로 충분)
    const badge=(low&&r.count>0)?'<span class="tier-sample-badge">표본 적음</span>':'';
    const tip=low?` class="num-col tier-help" title="표본 ${r.count}건, 참고용"`:' class="num-col"';
    // 등급 필터가 걸려 있으면 선택 등급 외에는 표에서도 같이 흐리게(차트와 강조 기준을 일치시킴)
    const cls=(low||_tierDimmed(r.key))?'tier-low-sample':'';
    return`
    <tr${cls?` class="${cls}"`:''}>
      <td>${tierBadge(r.key)}</td>
      <td class="num-col">${r.count}${badge}</td>
      <td class="num-col"><strong>${won(r.revSum)}</strong></td>
      <td${tip}>${r.avgRev!=null?won(Math.round(r.avgRev)):'—'}</td>
      <td${tip}>${r.avgQty!=null?num(Math.round(r.avgQty)):'—'}</td>
      <td${tip}>${r.avgViews!=null?r.avgViews.toFixed(1)+'만':'—'}</td>
      <td${tip}>${_pct1(r.conv!=null?r.conv*100:null)}</td>
      <td${tip}>${r.revPer10k!=null?won(Math.round(r.revPer10k)):'—'}</td>
    </tr>`;
  }).join('');

  if(typeof Chart!=='undefined'){
    // 건수 비중 vs 매출 기여도 — 누적 바 2개를 나란히(가로 100% 스택). "건수는 적은데 매출 기여는 큰"
    // 등급이 두 막대의 길이 차이로 바로 보이게 하는 게 목적이라, 두 축을 같은 100% 스케일로 고정함.
    if(_dashTierShareChartInst)_dashTierShareChartInst.destroy();
    _dashTierShareChartInst=new Chart(chartEl.getContext('2d'),{
      type:'bar',
      data:{
        labels:['건수 비중','매출 기여도'],
        datasets:rows.map(r=>({
          label:r.key,
          data:[(r.countShare||0)*100,(r.revShare||0)*100],
          backgroundColor:_tierChartColor(r.key)
        }))
      },
      options:{
        indexAxis:'y',responsive:true,maintainAspectRatio:false,
        plugins:{
          legend:{position:'bottom',labels:{boxWidth:10,font:{size:11}}},
          tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${ctx.raw.toFixed(1)}%`}}
        },
        scales:{x:{stacked:true,min:0,max:100,ticks:{callback:v=>v+'%'}},y:{stacked:true}}
      }
    });
  }

  renderDashTierHeatmap();
  renderDashTierStability();
  renderDashTierRepeat();
  renderDashTierMix();
}

/* 2-1) 등급 × 제품군 히트맵 — Chart.js에 히트맵 타입이 없어 CSS grid로 직접 그림.
   행은 TIER_OPTIONS 4등급 고정, 열은 PRODUCT_LINE_LABELS(제품 라인) 순서 중 실제 데이터가 있는 것만.
   색 진하기는 "열 안에서의 상대값" — 제품군마다 매출 규모가 달라서 전체 공통 스케일로 칠하면
   큰 제품군만 진해지고 등급 간 차이가 안 보이기 때문. 색상(hue)은 행의 등급 색을 그대로 써서
   어느 등급 행인지도 색으로 읽히게 함. */
function renderDashTierHeatmap(){
  const host=document.getElementById('dashTierHeatmap');
  if(!host)return;
  const sel=document.getElementById('dashTierHeatMetric');
  if(sel)sel.value=_dashTierHeatMetric;
  const subEl=document.getElementById('dashTierHeatSub');
  if(subEl){
    const pl=_dashProductLabel();
    subEl.textContent='색 진하기는 같은 제품군(열) 안에서의 상대값 · 셀에 마우스를 올리면 상세'+
      (pl?` · 품목 필터: ${pl} 열 강조(비교를 위해 다른 제품군도 함께 표시)`:'');
  }
  const classified=_dashTierScopeAllProducts().filter(d=>isRatedTier(_axisTierOf(d)));
  if(!classified.length){host.innerHTML='';return;}

  const present=new Set(classified.map(d=>productLineKey(d.product)));
  const known=Object.keys(PRODUCT_LINE_LABELS).filter(k=>k!=='other'&&present.has(k));
  const unknown=[...present].filter(k=>!(k in PRODUCT_LINE_LABELS)).sort();
  const lines=known.concat(unknown);
  if(!lines.length){host.innerHTML='<div class="dash-analytics-empty">제품군 정보를 읽을 수 있는 건이 없습니다</div>';return;}

  const cell=(tier,line)=>_tierMetrics(classified.filter(d=>_axisTierOf(d)===tier&&productLineKey(d.product)===line));
  const matrix=TIER_OPTIONS.map(t=>lines.map(l=>cell(t,l)));

  const pick=m=>m.count?(_dashTierHeatMetric==='revSum'?m.revSum:_dashTierHeatMetric==='conv'?m.conv:m.avgRev):null;
  const fmt=v=>v==null?'—':(_dashTierHeatMetric==='conv'?_pct1(v*100):won(Math.round(v)));

  // 열별 min/max — 같은 제품군 안에서만 상대 비교
  const colRange=lines.map((_,ci)=>{
    const vals=matrix.map(row=>pick(row[ci])).filter(v=>v!=null);
    return vals.length?{min:Math.min(...vals),max:Math.max(...vals)}:null;
  });

  host.style.gridTemplateColumns=`74px repeat(${lines.length},minmax(0,1fr))`;
  const selLine=_dashSelectedProductLine();
  const colDim=l=>!!(selLine&&selLine!==l);
  const head=['<div></div>'].concat(lines.map(l=>`<div class="heat-h"${colDim(l)?' style="opacity:.35"':''} title="${_escAttr(PRODUCT_LINE_LABELS[l]||l)}">${PRODUCT_LINE_LABELS[l]||l}</div>`));
  const bodyCells=TIER_OPTIONS.map((t,ri)=>{
    const rowDim=_tierDimmed(t);
    const lbl=`<div class="heat-rowlbl"${rowDim?' style="opacity:.35"':''}>${tierBadge(t)}</div>`;
    const cells=lines.map((l,ci)=>{
      const m=matrix[ri][ci];
      const v=pick(m);
      if(!m.count)return`<div class="heat-cell heat-empty${colDim(l)?' heat-coldim':''}"><span class="heat-val">—</span></div>`;
      const r=colRange[ci];
      const rel=(r&&r.max>r.min&&v!=null)?(v-r.min)/(r.max-r.min):1;
      // 0.10~0.55 범위로만 칠함 — 더 진해지면 흰 글씨가 필요해져 표 전체 대비가 흐트러짐
      const alpha=(0.10+0.45*rel)*(rowDim?0.3:1)*(colDim(l)?0.3:1);
      const low=_tierLowSample(m.count);
      const tip=[
        `${t} × ${PRODUCT_LINE_LABELS[l]||l}`,
        `건수: ${m.count}건${low?' (표본 적음)':''}`,
        `총매출: ${won(m.revSum)}`,
        `건당 평균매출: ${m.avgRev!=null?won(Math.round(m.avgRev)):'—'}`,
        `평균 조회수: ${m.avgViews!=null?m.avgViews.toFixed(1)+'만':'—'}`,
        `전환율: ${_pct1(m.conv!=null?m.conv*100:null)}`
      ].join('\n');
      return`<div class="heat-cell${low?' heat-low':''}${colDim(l)?' heat-coldim':''}" style="background:${_hexAlpha(tierColor(t).fg,alpha)}" title="${_escAttr(tip)}">
        <span class="heat-val">${fmt(v)}</span>
        <span class="heat-n">${m.count}건${low?' · 표본 적음':''}</span>
      </div>`;
    });
    return [lbl].concat(cells).join('');
  });
  host.innerHTML=head.join('')+bodyCells.join('');
}

/* 2-2) 등급별 매출 안정성 — 건당 매출의 최소~최대를 가로 범위 바로, 평균을 ● 마커로.
   우측 라벨은 변동계수(CV=표준편차÷평균). 표준편차는 모표준편차(÷n) — 표본표준편차(÷n-1)는
   1건짜리 등급에서 정의되지 않아 화면이 빈칸이 되는데, 여기선 "1건이면 흩어짐 0"이 더 자연스러움.
   표본이 TIER_MIN_SAMPLE 미만인 등급은 범위 바를 그리지 않고 평균 점만 찍음(범위를 그리면
   2건짜리 두 점 사이가 마치 분포처럼 보여서 과대 해석됨). */
function _tierStabilityRows(){
  const classified=_dashTierScope().filter(d=>isRatedTier(_axisTierOf(d))&&d.rev!=null);
  return TIER_OPTIONS.map(key=>{
    const items=classified.filter(d=>_axisTierOf(d)===key);
    if(!items.length)return{key,count:0};
    const vals=items.map(d=>d.rev);
    const n=vals.length;
    const mean=vals.reduce((s,v)=>s+v,0)/n;
    const std=Math.sqrt(vals.reduce((s,v)=>s+(v-mean)*(v-mean),0)/n);
    const minD=items.reduce((a,b)=>b.rev<a.rev?b:a);
    const maxD=items.reduce((a,b)=>b.rev>a.rev?b:a);
    return{key,count:n,mean,std,cv:mean>0?std/mean*100:null,
      min:minD.rev,max:maxD.rev,minCh:(minD.ch||minD.influencer||'—'),maxCh:(maxD.ch||maxD.influencer||'—')};
  });
}
function renderDashTierStability(){
  const el=document.getElementById('dashTierStabilityChart');
  if(!el||typeof Chart==='undefined')return;
  const rows=_tierStabilityRows();
  if(_dashTierStabilityChartInst)_dashTierStabilityChartInst.destroy();

  // CV 라벨은 막대 끝이 아니라 플롯 오른쪽의 고정 폭 컬럼에 세로로 정렬해서 그림 —
  // 막대 끝에 붙이면 막대가 길수록 라벨이 캔버스 밖으로 밀려 잘렸음(2026-09-10 수정).
  // layout.padding.right로 그 컬럼만큼 플롯을 좁혀두고, 그 여백 안에 항상 같은 x에 그린다.
  const CV_FONT='700 10px system-ui,sans-serif';
  const cvText=r=>(r.cv!=null?`CV ${r.cv.toFixed(0)}%`:'CV —')+(_tierLowSample(r.count)?' · 표본 적음':'');
  const CV_COL_W=(()=>{
    const c=el.getContext('2d');
    c.save();c.font=CV_FONT;
    const w=rows.filter(r=>r.count).reduce((m,r)=>Math.max(m,c.measureText(cvText(r)).width),0);
    c.restore();
    return Math.min(130,Math.max(70,Math.ceil(w)+16));
  })();
  const cvLabels={
    id:'tierCvLabels',
    afterDatasetsDraw(chart){
      const{ctx,scales:{y},chartArea}=chart;
      ctx.save();
      ctx.font=CV_FONT;
      ctx.textBaseline='middle';
      ctx.textAlign='left';
      const px=chartArea.right+8;
      rows.forEach((r,i)=>{
        if(!r.count)return;
        ctx.fillStyle=_tierDimmed(r.key)?'#B9BEC9':'#5B6375';
        ctx.fillText(cvText(r),px,y.getPixelForValue(i));
      });
      ctx.restore();
    }
  };
  // 축 최대값은 데이터 최대의 1.1배로 고정 — 막대 끝이 축 끝에 딱 붙어 답답해 보이지 않게
  const stabMax=rows.reduce((m,r)=>r.count?Math.max(m,r.max||0,r.mean||0):m,0);
  const stabScale=_niceAxisScale(stabMax*1.1,4); // 눈금 5개(0 포함)가 되도록
  const stabFmt=_axisMoneyFmt(stabScale?stabScale.max:stabMax);

  _dashTierStabilityChartInst=new Chart(el.getContext('2d'),{
    data:{
      labels:TIER_OPTIONS,
      datasets:[
        {
          type:'bar',label:'매출 범위',
          // 표본 적음/0건 등급은 범위 바를 생략 — 평균 점(아래 scatter)만 남음
          data:rows.map(r=>(r.count&&!_tierLowSample(r.count))?[r.min,r.max]:null),
          backgroundColor:rows.map(r=>_hexAlpha(tierColor(r.key).fg,_tierDimmed(r.key)?0.15:0.35)),
          borderColor:rows.map(r=>_tierChartColor(r.key)),
          borderWidth:1,borderSkipped:false,borderRadius:3,barPercentage:.55
        },
        {
          type:'scatter',label:'평균',
          // 값 없는 등급도 null이 아니라 {x:null}로 넣어야 함 — scatter는 객체 데이터를 파싱할 때
          // 원소의 .x를 바로 읽어서, 원소 자체가 null이면 TypeError로 차트가 통째로 죽음(2026-09-09 확인).
          data:rows.map((r,i)=>({x:r.count?r.mean:null,y:i})),
          backgroundColor:rows.map(r=>_tierChartColor(r.key)),
          pointRadius:5,pointHoverRadius:7
        }
      ]
    },
    options:{
      indexAxis:'y',responsive:true,maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{
          title:items=>TIER_OPTIONS[items[0].dataIndex],
          label:ctx=>{
            const r=rows[ctx.dataIndex];
            if(!r||!r.count)return '데이터 없음';
            return[
              `건수: ${r.count}건${_tierLowSample(r.count)?' (표본 적음)':''}`,
              `평균: ${won(Math.round(r.mean))}`,
              `표준편차: ${won(Math.round(r.std))}${r.cv!=null?` (CV ${r.cv.toFixed(0)}%)`:''}`,
              `최소: ${won(r.min)} · ${r.minCh}`,
              `최대: ${won(r.max)} · ${r.maxCh}`
            ];
          }
        }}
      },
      layout:{padding:{right:CV_COL_W}}, // CV 라벨 전용 고정 컬럼
      scales:{
        x:{min:0,max:stabScale?stabScale.max:undefined,
           title:{display:true,text:'건당 매출(원)'},
           ticks:Object.assign({maxTicksLimit:6,maxRotation:0,autoSkip:true,callback:stabFmt},stabScale?{stepSize:stabScale.step}:{})},
        y:{type:'category',labels:TIER_OPTIONS,offset:true}
      }
    },
    plugins:[cvLabels]
  });
}

/* 2-3) 등급별 재협업률 — (2회 이상 진행한 채널 ÷ 그 등급 채널 수) × 100.
   채널의 등급은 실효 등급(수동 지정 > 자동 산정)을 그대로 사용.
   기간 필터를 일부러 무시함 — 한 달만 잘라 보면 재협업이 원리상 0으로 보이기 때문. */
function _tierRepeatRows(){
  const scope=_dashTierScopeAllTime();
  const byCh=new Map();
  scope.forEach(d=>{
    const ch=(d.ch||d.influencer||'').trim();
    if(!ch)return;
    if(!byCh.has(ch))byCh.set(ch,[]);
    byCh.get(ch).push(d);
  });
  const chans=[];
  byCh.forEach((items,ch)=>{
    // 채널의 실효 등급을 그대로 씀(예전의 "최근 건 기준" 규칙은 폐기) — 축 토글에 따라 매출/팔로워
    const tier=_axisTierOfChannel(ch);
    if(!isRatedTier(tier))return; // 미산정/미입력 채널은 등급별 집계 대상 아님
    chans.push({ch,tier,n:items.length});
  });
  return TIER_OPTIONS.map(key=>{
    const mine=chans.filter(c=>c.tier===key);
    const repeat=mine.filter(c=>c.n>=2).length;
    const top=mine.slice().sort((a,b)=>b.n-a.n)[0];
    return{
      key,total:mine.length,repeat,
      rate:mine.length?repeat/mine.length*100:null,
      avgRounds:mine.length?mine.reduce((s,c)=>s+c.n,0)/mine.length:null,
      topCh:top?top.ch:'',topN:top?top.n:0
    };
  });
}
function renderDashTierRepeat(){
  const el=document.getElementById('dashTierRepeatChart');
  if(!el||typeof Chart==='undefined')return;
  const rows=_tierRepeatRows();
  if(_dashTierRepeatChartInst)_dashTierRepeatChartInst.destroy();

  // 막대 위 "N/M 채널" 라벨 — 기본 기능으로 못 그려서 인라인 플러그인으로 직접 그림
  const barLabels={
    id:'tierRepeatLabels',
    afterDatasetsDraw(chart){
      const{ctx}=chart;
      const meta=chart.getDatasetMeta(0);
      ctx.save();
      ctx.font='700 10px system-ui,sans-serif';
      ctx.textAlign='center';ctx.textBaseline='bottom';
      rows.forEach((r,i)=>{
        const bar=meta.data[i];
        if(!bar||!r.total)return;
        ctx.fillStyle=_tierDimmed(r.key)?'#B9BEC9':'#5B6375';
        const low=_tierLowSample(r.total);
        ctx.fillText(`${r.repeat}/${r.total} 채널`,bar.x,bar.y-(low?16:4));
        if(low)ctx.fillText('표본 적음',bar.x,bar.y-4);
      });
      ctx.restore();
    }
  };

  _dashTierRepeatChartInst=new Chart(el.getContext('2d'),{
    type:'bar',
    data:{
      labels:TIER_OPTIONS,
      datasets:[{
        label:'재협업률',
        data:rows.map(r=>r.rate),
        backgroundColor:rows.map(r=>{
          const base=_tierChartColor(r.key);
          // 채널 수가 TIER_MIN_SAMPLE 미만인 등급은 막대도 옅게(1차 표의 "표본 적음"과 같은 규칙)
          return _tierLowSample(r.total)?_hexAlpha(tierColor(r.key).fg,_tierDimmed(r.key)?0.12:0.35):base;
        }),
        borderRadius:4,maxBarThickness:56
      }]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      layout:{padding:{top:rows.some(r=>r.total&&_tierLowSample(r.total))?32:18}}, // 막대 위 라벨(최대 2줄)이 잘리지 않게
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{label:ctx=>{
          const r=rows[ctx.dataIndex];
          if(!r||!r.total)return '해당 등급 채널 없음';
          return[
            `재협업률: ${r.rate!=null?r.rate.toFixed(0)+'%':'—'} (${r.repeat}/${r.total} 채널)`,
            `평균 회차: ${r.avgRounds!=null?r.avgRounds.toFixed(1)+'회':'—'}`,
            `최다 회차: ${r.topCh||'—'} ${r.topN}회`,
            ...(_tierLowSample(r.total)?[`채널 ${r.total}곳뿐 — 참고용`]:[])
          ];
        }}}
      },
      scales:{y:{min:0,max:100,title:{display:true,text:'재협업률(%)'},ticks:{callback:v=>v+'%'}}}
    },
    plugins:[barLabels]
  });
}

/* 2-4) 월별 등급 믹스 — 선택 연도의 1~12월 × 등급 누적 막대.
   시즌성 분석과 같은 이유로 월/주차 필터를 무시하고 12개월을 항상 그린 뒤, 선택된 월만 진하게 함
   (월을 잘라내면 "믹스가 달마다 어떻게 변하는지"라는 이 차트의 목적 자체가 사라짐). */
function renderDashTierMix(){
  const el=document.getElementById('dashTierMixChart');
  const sub=document.getElementById('dashTierMixSub');
  const sel=document.getElementById('dashTierMixMode');
  if(sel)sel.value=_dashTierMixMode;
  if(!el||typeof Chart==='undefined')return;

  const classified=_dashTierScopeYear().filter(d=>isRatedTier(_axisTierOf(d)));
  const hlMonths=_dashActive(DASH.months)?DASH.months:null;
  const isPct=_dashTierMixMode==='pct';
  const useRev=_dashTierMixMode==='rev';

  // [등급][월] 원값
  const raw=TIER_OPTIONS.map(t=>Array.from({length:12},()=>0));
  const cnt=TIER_OPTIONS.map(t=>Array.from({length:12},()=>0));
  classified.forEach(d=>{
    const m=monthOf(d.start); if(!m)return;
    const ti=TIER_OPTIONS.indexOf(_axisTierOf(d)); if(ti<0)return;
    cnt[ti][m-1]+=1;
    raw[ti][m-1]+=useRev?(d.rev||0):1;
  });
  const monthTotals=Array.from({length:12},(_,mi)=>TIER_OPTIONS.reduce((s,_t,ti)=>s+raw[ti][mi],0));
  // 매출 모드의 Y축은 누적 합계 최대값 기준으로 억/만 단위 축약 — 원 단위(₩2,000,000,000)면
  // 좌측 축 라벨이 넓어져 12월 막대가 밀려 잘림
  const mixFmt=_axisMoneyFmt(Math.max.apply(null,monthTotals.concat([0])));

  if(sub){
    const parts=[isPct?'월별 구성비(100%)':useRev?'매출 기준':'건수 기준','연도 전체 표시'];
    if(hlMonths)parts.push(`선택 월(${[...hlMonths].sort((a,b)=>a-b).join('·')}월) 강조`);
    sub.textContent=parts.join(' · ');
  }

  if(_dashTierMixChartInst)_dashTierMixChartInst.destroy();
  _dashTierMixChartInst=new Chart(el.getContext('2d'),{
    type:'bar',
    data:{
      labels:Array.from({length:12},(_,i)=>`${i+1}월`),
      datasets:TIER_OPTIONS.map((t,ti)=>({
        label:t,
        data:raw[ti].map((v,mi)=>isPct?(monthTotals[mi]>0?v/monthTotals[mi]*100:0):v),
        // 등급 필터 강조와 "선택 월" 강조가 같이 걸릴 수 있어 두 배율을 곱해서 한 번에 반영
        backgroundColor:raw[ti].map((_v,mi)=>{
          const a=(_tierDimmed(t)?TIER_DIM_ALPHA:1)*((hlMonths&&!hlMonths.has(mi+1))?0.35:1);
          return a>=1?tierColor(t).fg:_hexAlpha(tierColor(t).fg,a);
        }),
        _counts:cnt[ti]
      }))
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{
        legend:{position:'bottom',labels:{boxWidth:10,font:{size:11},padding:12,boxHeight:8}}, // 범례 클릭으로 등급 on/off(Chart.js 기본)
        tooltip:{callbacks:{label:ctx=>{
          const n=ctx.dataset._counts?ctx.dataset._counts[ctx.dataIndex]:null;
          if(isPct)return`${ctx.dataset.label}: ${ctx.raw.toFixed(1)}%${n!=null?` (${n}건)`:''}`;
          if(useRev)return`${ctx.dataset.label}: ${won(Math.round(ctx.raw))}${n!=null?` (${n}건)`:''}`;
          return`${ctx.dataset.label}: ${ctx.raw}건`;
        }}}
      },
      scales:{
        x:{stacked:true},
        y:{stacked:true,min:0,...(isPct?{max:100,ticks:{callback:v=>v+'%'}}:useRev?{ticks:{maxTicksLimit:6,callback:mixFmt}}:{ticks:{stepSize:1,precision:0}})}
      }
    }
  });
}
