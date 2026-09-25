'use strict';
/* 공구 분석 — 시즌성 분석(월별·분기별). */

/* 5) 시즌성 분석(월별) — 요청대로 "월/주차" 필터와 무관하게 연도만 적용해서 12개월을 항상 보여줌
   (월 필터로 특정 월만 남기면 성수기/비수기 비교 자체가 불가능해지므로). 현재 월 필터가 걸려있으면
   해당 월만 표/차트에서 강조 표시. */
let _dashSeasonChartInst=null;
let _dashSeasonLineFilter='all'; // 'all' 또는 productLineKey() 값 — 시즌성 분석 전용 제품군 필터
// 실제 데이터에 존재하는 제품 라인만 옵션으로 노출 — 출시 전 모델만 있는 라인(아직 데이터 0건)은
// PRODUCT_TAXONOMY에 등록돼 있어도 자동으로 옵션에서 빠지고, 데이터가 들어오는 순간 자동 등장함.
function _dashSeasonLineOptions(scope){
  const present=new Set(scope.map(d=>productLineKey(d.product)));
  const known=Object.keys(PRODUCT_LINE_LABELS).filter(k=>present.has(k));
  const unknown=[...present].filter(k=>!(k in PRODUCT_LINE_LABELS)).sort();
  return known.concat(unknown);
}
function _onDashSeasonLineFilterChange(){
  _dashSeasonLineFilter=document.getElementById('dashSeasonLineFilter').value;
  renderDashSeasonality();
}
function renderDashSeasonality(){
  const chartEl=document.getElementById('dashSeasonChart');
  const monthBody=document.getElementById('dashSeasonMonthBody');
  const quarterBody=document.getElementById('dashSeasonQuarterBody');
  const note=document.getElementById('dashSeasonNote');
  const lineSelectEl=document.getElementById('dashSeasonLineFilter');

  // 이 섹션은 월/주차 필터는 의도적으로 무시하지만(위 주석 참고) 연도·인플루언서 필터는 그대로 반영.
  // 매출 집계 기준은 다른 섹션과 동일하게 완료+진행중(예정 제외, _isRevStatus).
  const fullScope=DATA.filter(d=>d.start&&_isRevStatus(d)&&(!_dashActive(DASH.years)||DASH.years.has(yearOf(d.start)))&&(!DASH.channel||(d.ch||d.influencer||'').trim()===DASH.channel));
  const lineOptions=_dashSeasonLineOptions(fullScope);
  if(_dashSeasonLineFilter!=='all'&&!lineOptions.includes(_dashSeasonLineFilter))_dashSeasonLineFilter='all';
  lineSelectEl.innerHTML='<option value="all">전체</option>'+lineOptions.map(k=>`<option value="${k}">${PRODUCT_LINE_LABELS[k]||k}</option>`).join('');
  lineSelectEl.value=_dashSeasonLineFilter;

  const scope=_dashSeasonLineFilter==='all'?fullScope:fullScope.filter(d=>productLineKey(d.product)===_dashSeasonLineFilter);

  if(!scope.length){
    monthBody.innerHTML=`<tr><td colspan="5" class="dash-analytics-empty">${_dashSeasonLineFilter==='all'?'해당 연도에 완료·진행중인 공구건이 없습니다':'해당 연도·제품군 조건에 완료·진행중인 공구건이 없습니다'}</td></tr>`;
    quarterBody.innerHTML='';
    note.textContent='';
    if(_dashSeasonChartInst){_dashSeasonChartInst.destroy();_dashSeasonChartInst=null;}
    return;
  }

  const byMonth=Array.from({length:12},()=>({count:0,revSum:0,viewSum:0,viewN:0,qtySum:0,qtyN:0}));
  scope.forEach(d=>{
    const m=monthOf(d.start); if(!m)return;
    const g=byMonth[m-1];
    g.count++; g.revSum+=(d.rev||0);
    if(d.views!=null){g.viewSum+=d.views;g.viewN++;}
    if(d.qty!=null){g.qtySum+=d.qty;g.qtyN++;}
  });

  const highlightMonths=_dashActive(DASH.months)?DASH.months:null;
  monthBody.innerHTML=byMonth.map((g,i)=>{
    const m=i+1;
    const avgRev=_safeDiv(g.revSum,g.count);
    const avgViews=_safeDiv(g.viewSum,g.viewN);
    const avgQty=_safeDiv(g.qtySum,g.qtyN);
    const hl=highlightMonths&&highlightMonths.has(m);
    return`<tr${hl?' class="dash-top-row"':''}>
      <td>${m}월</td>
      <td class="num-col">${g.count}</td>
      <td class="num-col">${avgRev!=null?won(Math.round(avgRev)):'—'}</td>
      <td class="num-col">${avgViews!=null?avgViews.toFixed(1)+'만':'—'}</td>
      <td class="num-col">${avgQty!=null?num(Math.round(avgQty)):'—'}</td>
    </tr>`;
  }).join('');

  const quarters=[[0,1,2],[3,4,5],[6,7,8],[9,10,11]];
  quarterBody.innerHTML=quarters.map((idxs,qi)=>{
    const g={count:0,revSum:0};
    idxs.forEach(i=>{g.count+=byMonth[i].count;g.revSum+=byMonth[i].revSum;});
    const avgRev=_safeDiv(g.revSum,g.count);
    return`<tr><td>${qi+1}분기</td><td class="num-col">${g.count}</td><td class="num-col">${avgRev!=null?won(Math.round(avgRev)):'—'}</td></tr>`;
  }).join('');

  note.textContent=highlightMonths?`현재 선택된 월(${[...highlightMonths].sort((a,b)=>a-b).join('·')}월)을 표에서 강조 표시`:'';

  if(typeof Chart==='undefined')return;
  if(_dashSeasonChartInst)_dashSeasonChartInst.destroy();
  _dashSeasonChartInst=new Chart(chartEl.getContext('2d'),{
    type:'bar',
    data:{
      labels:byMonth.map((_,i)=>`${i+1}월`),
      datasets:[{label:'평균 매출',data:byMonth.map(g=>_safeDiv(g.revSum,g.count)||0),
        backgroundColor:byMonth.map((_,i)=>highlightMonths&&highlightMonths.has(i+1)?'#3B56E5':'#B7C0F2')}]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>won(Math.round(ctx.raw))}}},
      scales:{y:{ticks:{callback:v=>won(v)}}}
    }
  });
}
