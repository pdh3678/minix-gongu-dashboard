'use strict';
/* 공구 분석 — 달성률 분석. */

/* 4) 달성률 분석 — 목표수량(targetQty)이 있는 건이 하나라도 있으면 실제 달성률(판매수량/목표수량)
   분석을, 하나도 없으면(대상 기간에 목표치 미기입) 매출 기준 "평균 대비 상대 성과"로 자동 대체.
   목표치가 일부만 있는 경우엔 있는 건만 집계하고 제외 건수를 안내(포맷 미기입 처리와 동일 패턴). */
// "달성률 상위 조건" 표 — 예전엔 제품군/채널/포맷 3개 차원을 한 표에 섞어 상위 8개만 보여줬으나,
// 채널과 제품군이 뒤섞여 비교가 어렵다는 피드백으로 드롭다운 하나로 기준을 골라 그 기준 전체를
// 보여주는 단일 표로 개편함(2026-08-18). 표를 나누지 않고 같은 표/헤더를 기준에 맞게 재집계.
const DASH_ACHV_CROSS_DIMS={
  '채널':d=>d.ch||d.influencer,
  '제품군':d=>PRODUCT_GROUP_LABELS[productColorKey(d.product)]||productColorKey(d.product),
  // 미분류 건은 빈 문자열을 돌려 아래 집계 루프에서 자동으로 빠짐(다른 차원의 빈 값 처리와 동일)
  // '등급'은 등급별 성과 섹션의 축 토글(_dashTierAxis)을 그대로 따라감 — 두 곳이 서로 다른 등급을
  // 보여주면 같은 화면에서 "등급"이라는 말이 두 가지를 뜻하게 되므로
  '등급':d=>{const t=_axisTierOf(d);return isRatedTier(t)?t:'';}
};
let _dashAchvCrossDim='채널'; // 기본값: 채널별
// 헤더 클릭 전까지는 "신뢰도 우선" 기본 정렬(건수 2건 이상을 먼저, 그 안에서 평균 내림차순)을 씀 —
// 표본 1건짜리가 우연히 평균이 높아 최상단을 차지해 오해를 부르는 것을 막기 위함. 사용자가 평균
// 달성률/건수 헤더를 직접 클릭하면 그 순간부터는 그 열 기준 단순 정렬로 전환됨(건수가 표에 그대로
// 보이므로 신뢰도 판단은 사용자 몫).
let _dashAchvCrossSort={key:null,dir:-1};
function _onDashAchvCrossDimChange(){
  _dashAchvCrossDim=document.getElementById('dashAchvCrossDim').value;
  renderDashAchievement();
}
function _sortDashAchvCross(key){
  if(_dashAchvCrossSort.key===key)_dashAchvCrossSort.dir*=-1;else{_dashAchvCrossSort.key=key;_dashAchvCrossSort.dir=-1;}
  renderDashAchievement();
}
let _dashAchvChartInst=null;
function _dashAchvRenderCommon(entries,buckets,crossValLabel,overLabel,underLabel){
  const distBody=document.getElementById('dashAchvDistBody');
  const crossBody=document.getElementById('dashAchvCrossBody');
  const chartEl=document.getElementById('dashAchvChart');
  const dimSel=document.getElementById('dashAchvCrossDim');
  const dimHd=document.getElementById('dashAchvCrossDimHd');
  const valHd=document.getElementById('dashAchvCrossValHd');
  const cntHd=document.getElementById('dashAchvCrossCountHd');

  const bucketCounts=buckets.map(b=>entries.filter(e=>b.test(e.val)).length);
  distBody.innerHTML=buckets.map((b,i)=>`
    <tr>
      <td>${b.label}</td>
      <td class="num-col">${bucketCounts[i]}</td>
      <td class="num-col">${_pct1(entries.length?bucketCounts[i]/entries.length*100:null)}</td>
    </tr>`).join('');

  dimSel.value=_dashAchvCrossDim;
  // '등급' 기준일 때는 지금 보고 있는 축 이름을 그대로 써서 어느 등급인지 헷갈리지 않게 함
  dimHd.textContent=_dashAchvCrossDim==='등급'?_tierAxis().label:_dashAchvCrossDim;
  const keyFn=DASH_ACHV_CROSS_DIMS[_dashAchvCrossDim];
  const map=new Map();
  entries.forEach(({d,val})=>{
    const key=keyFn(d); if(key==null||key==='')return;
    if(!map.has(key))map.set(key,{value:key,sum:0,count:0,over:0});
    const g=map.get(key); g.sum+=val; g.count++; if(val>=100)g.over++;
  });
  let cross=[...map.values()].map(g=>({value:g.value,avg:g.sum/g.count,count:g.count,over:g.over,under:g.count-g.over}));
  if(_dashAchvCrossSort.key){
    cross.sort((a,b)=>(a[_dashAchvCrossSort.key]-b[_dashAchvCrossSort.key])*_dashAchvCrossSort.dir);
  } else {
    cross.sort((a,b)=>{
      const relA=a.count>=2?0:1,relB=b.count>=2?0:1;
      if(relA!==relB)return relA-relB;
      return b.avg-a.avg;
    });
  }

  function arrow(key){return _dashAchvCrossSort.key===key?(_dashAchvCrossSort.dir>0?'▲':'▼'):'⇕';}
  valHd.innerHTML=`${crossValLabel}<span class="sort-ic">${arrow('avg')}</span>`;
  valHd.classList.toggle('sorted',_dashAchvCrossSort.key==='avg');
  cntHd.innerHTML=`건수<span class="sort-ic">${arrow('count')}</span>`;
  cntHd.classList.toggle('sorted',_dashAchvCrossSort.key==='count');

  crossBody.innerHTML=cross.length?cross.map(r=>`
    <tr>
      <td>${r.value}</td>
      <td class="num-col">${r.avg.toFixed(0)}%</td>
      <td class="num-col${r.count===1?' cw':''}"${r.count===1?' title="표본 1건 — 참고용"':''}>${r.count}</td>
    </tr>`).join(''):'<tr><td colspan="3" class="dash-analytics-empty">표시할 데이터가 없습니다</td></tr>';

  if(typeof Chart==='undefined')return;
  if(_dashAchvChartInst)_dashAchvChartInst.destroy();
  _dashAchvChartInst=new Chart(chartEl.getContext('2d'),{
    type:'bar',
    data:{labels:buckets.map(b=>b.label),datasets:[{label:'건수',data:bucketCounts,backgroundColor:['#DC2626','#F59E0B','#3B56E5','#0A7C5E']}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{stepSize:1,precision:0}}}}
  });

  _renderDashAchvTierChart(map,crossValLabel,overLabel||'달성',underLabel||'미달');
}

/* 달성률 기준을 '등급'으로 골랐을 때만 나타나는 등급별 평균 달성률 막대.
   표(달성률 상위 조건)는 정렬 상태에 따라 순서가 바뀌지만 이 차트는 항상 TIER_OPTIONS 순서로 고정 —
   등급 간 비교가 목적이라 순서가 흔들리면 눈으로 비교가 안 되기 때문.
   100% 기준선은 Chart.js 기본 기능으로 못 그려서 인라인 플러그인으로 직접 그림(annotation 플러그인 미로드). */
let _dashAchvTierChartInst=null;
function _renderDashAchvTierChart(map,valLabel,overLabel,underLabel){
  const wrap=document.getElementById('dashAchvTierWrap');
  const el=document.getElementById('dashAchvTierChart');
  if(!wrap||!el)return;
  if(_dashAchvCrossDim!=='등급'){
    wrap.style.display='none';
    if(_dashAchvTierChartInst){_dashAchvTierChartInst.destroy();_dashAchvTierChartInst=null;}
    return;
  }
  wrap.style.display='';
  // map의 값은 avg가 아니라 sum을 들고 있으므로 여기서 평균을 계산해 씀(그대로 병합하면 avg가 null로 남음)
  const rows=TIER_OPTIONS.map(k=>{
    const g=map.get(k);
    return g?{value:k,avg:g.sum/g.count,count:g.count,over:g.over,under:g.count-g.over}
            :{value:k,avg:null,count:0,over:0,under:0};
  });
  const baseline={
    id:'achvBaseline',
    afterDatasetsDraw(chart){
      const y=chart.scales.y;
      if(!y)return;
      const py=y.getPixelForValue(100);
      if(py<chart.chartArea.top||py>chart.chartArea.bottom)return; // 축 범위 밖이면 안 그림
      const{ctx,chartArea}=chart;
      ctx.save();
      ctx.strokeStyle='#DC2626';ctx.lineWidth=1.5;ctx.setLineDash([5,4]);
      ctx.beginPath();ctx.moveTo(chartArea.left,py);ctx.lineTo(chartArea.right,py);ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle='#DC2626';ctx.font='700 10px system-ui,sans-serif';
      ctx.textAlign='right';ctx.textBaseline='bottom';
      ctx.fillText('100%',chartArea.right-2,py-2);
      ctx.restore();
    }
  };
  if(_dashAchvTierChartInst)_dashAchvTierChartInst.destroy();
  _dashAchvTierChartInst=new Chart(el.getContext('2d'),{
    type:'bar',
    data:{labels:TIER_OPTIONS,datasets:[{
      label:valLabel,
      data:rows.map(r=>r.count?r.avg:null),
      backgroundColor:rows.map(r=>_tierLowSample(r.count)?_hexAlpha(tierColor(r.value).fg,0.35):tierColor(r.value).fg),
      borderRadius:4,maxBarThickness:56
    }]},
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{label:ctx=>{
          const r=rows[ctx.dataIndex];
          if(!r||!r.count)return '해당 등급의 대상 건이 없습니다';
          return[
            `${valLabel}: ${r.avg.toFixed(0)}%`,
            `대상: ${r.count}건${_tierLowSample(r.count)?' (표본 적음)':''}`,
            `${overLabel} ${r.over}건 · ${underLabel} ${r.under}건`
          ];
        }}}
      },
      scales:{y:{min:0,title:{display:true,text:valLabel+'(%)'},ticks:{callback:v=>v+'%'}}}
    },
    plugins:[baseline]
  });
}
// 달성률(실적/목표)은 판매가 끝나야 확정되는 지표 — 진행중 건은 아직 판매 중이라 실적(qty)이
// 목표에 못 미치는 게 당연한데, 이걸 매출 KPI와 같은 완료+진행중 기준(_dashRevScope)으로 섞으면
// 전부 "미달"로 잡혀 평균·분포가 왜곡됨(2026-08-25 확인 — 8월 진행중 건이 평균을 끌어내리던 문제).
// 그래서 이 섹션만 완료 건으로 한정 — 다른 분석 카드(채널/제품군/플랫폼)와 기준이 다름에 유의.
function renderDashAchievement(){
  const scope=dashData().filter(d=>_displayStatus(d)==='완료');
  const banner=document.getElementById('dashAchvBanner');
  const stats=document.getElementById('dashAchvStats');
  const distBody=document.getElementById('dashAchvDistBody');
  const crossBody=document.getElementById('dashAchvCrossBody');
  const distColHd=document.getElementById('dashAchvDistColHd');
  const crossTitle=document.getElementById('dashAchvCrossTitle');

  function empty(msg){
    banner.style.display='none';stats.textContent='';
    distBody.innerHTML=`<tr><td colspan="3" class="dash-analytics-empty">${msg}</td></tr>`;
    crossBody.innerHTML='';
    if(_dashAchvChartInst){_dashAchvChartInst.destroy();_dashAchvChartInst=null;}
    const tw=document.getElementById('dashAchvTierWrap');
    if(tw)tw.style.display='none';
    if(_dashAchvTierChartInst){_dashAchvTierChartInst.destroy();_dashAchvTierChartInst=null;}
  }

  if(!scope.length){empty('해당 기간에 완료된 공구건이 없습니다');return;}

  const withTarget=scope.filter(d=>d.targetQty!=null&&d.targetQty>0&&d.qty!=null);

  if(withTarget.length){
    banner.style.display='none';
    distColHd.textContent='달성률 구간';crossTitle.textContent='달성률 상위 조건';
    const entries=withTarget.map(d=>({d,val:d.qty/d.targetQty*100}));
    const avg=entries.reduce((s,e)=>s+e.val,0)/entries.length;
    const over=entries.filter(e=>e.val>=100).length,under=entries.length-over;
    // 제외 사유를 실제로 구분해서 라벨에 반영 — "목표 미기입"이라고 뭉뚱그리면, 목표는 있지만
    // 판매수량(실적)만 아직 비어 있는 건까지 잘못된 사유로 표시되는 문제가 있었음(2026-08-25).
    const noTarget=scope.filter(d=>d.targetQty==null||d.targetQty<=0).length;
    const noQty=scope.filter(d=>d.targetQty!=null&&d.targetQty>0&&d.qty==null).length;
    const excludeParts=[];
    if(noTarget)excludeParts.push(`목표 미기입 ${noTarget}건`);
    if(noQty)excludeParts.push(`판매수량 미기입 ${noQty}건`);
    stats.innerHTML=`평균 달성률 <b>${avg.toFixed(0)}%</b> · 초과달성 <b>${over}건</b> · 미달 <b>${under}건</b> · 대상 <b>${entries.length}건</b>${excludeParts.length?` · ${excludeParts.join(', ')} 제외`:''}`;
    const buckets=[{label:'~80%',test:v=>v<80},{label:'80~100%',test:v=>v>=80&&v<100},{label:'100~150%',test:v=>v>=100&&v<150},{label:'150%+',test:v=>v>=150}];
    _dashAchvRenderCommon(entries,buckets,'평균 달성률','달성','미달');
  } else {
    banner.style.display='block';
    banner.textContent='⚠ 이 기간의 완료 건에는 목표수량 데이터가 없어, 매출 기준 상대 성과(전체 평균 대비 %)로 대체해 보여줍니다.';
    distColHd.textContent='상대 성과 구간';crossTitle.textContent='상대 성과 상위 조건';
    const withRev=scope.filter(d=>d.rev!=null);
    if(!withRev.length){empty('매출 데이터가 없어 상대 성과도 계산할 수 없습니다');return;}
    const avgRev=withRev.reduce((s,d)=>s+d.rev,0)/withRev.length;
    const entries=withRev.map(d=>({d,val:avgRev>0?d.rev/avgRev*100:0}));
    const above=entries.filter(e=>e.val>=100).length,below=entries.length-above;
    stats.innerHTML=`평균 매출 대비 상회 <b>${above}건</b> · 하회 <b>${below}건</b> · 대상 <b>${entries.length}건</b>`;
    const buckets=[{label:'~50%',test:v=>v<50},{label:'50~100%',test:v=>v>=50&&v<100},{label:'100~200%',test:v=>v>=100&&v<200},{label:'200%+',test:v=>v>=200}];
    _dashAchvRenderCommon(entries,buckets,'평균 상대 성과','상회','하회');
  }
}
