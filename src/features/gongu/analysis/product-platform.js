'use strict';
/* 공구 분석 — 제품군별 비교, 플랫폼(포맷)별 효율. */

/* 2) 제품군별 비교 — productColorKey/PRODUCT_COLORS(실적 표 배지와 동일 팔레트)를 그대로 재사용해
   차트·표·실적 표 배지 색이 전부 일관되게 보이도록 함. PRODUCT_GROUP_LABELS는 PRODUCT_TAXONOMY에서
   파생된 걸 그대로 씀(위쪽 productColorKey 근처에서 이미 선언됨). */
function renderDashProductAnalytics(){
  const scope=_dashRevScope();
  const body=document.getElementById('dashProductBody');
  const note=document.getElementById('dashProductNote');
  const chartEl=document.getElementById('dashProductChart');
  if(!scope.length){
    body.innerHTML='<tr><td colspan="6" class="dash-analytics-empty">해당 기간에 완료·진행중인 공구건이 없습니다</td></tr>';
    note.textContent='';
    if(_dashProductChartInst){_dashProductChartInst.destroy();_dashProductChartInst=null;}
    return;
  }
  const map=new Map();
  scope.forEach(d=>{
    const key=productColorKey(d.product);
    if(!map.has(key))map.set(key,{key,items:[]});
    map.get(key).items.push(d);
  });
  const grandTotal=scope.reduce((s,d)=>s+(d.rev||0),0);
  const rows=[...map.values()].map(g=>{
    const items=g.items;
    const revSum=items.reduce((s,d)=>s+(d.rev||0),0);
    const qtyVals=items.filter(d=>d.qty!=null).map(d=>d.qty);
    const viewVals=items.filter(d=>d.views!=null).map(d=>d.views);
    const qtySum=qtyVals.reduce((s,v)=>s+v,0),viewSum=viewVals.reduce((s,v)=>s+v,0);
    const avgQty=_safeDiv(qtySum,qtyVals.length);
    const avgViews=_safeDiv(viewSum,viewVals.length);
    const revPerView=_wonPerView(revSum,viewSum);
    const share=_safeDiv(revSum,grandTotal);
    return{key:g.key,label:PRODUCT_GROUP_LABELS[g.key]||g.key,color:PRODUCT_COLORS[g.key]||PRODUCT_COLORS.other,revSum,share,avgQty,avgViews,revPerView};
  }).sort((a,b)=>b.revSum-a.revSum);

  body.innerHTML=rows.map(r=>`
    <tr>
      <td><span class="bp" style="background:${r.color.bg};color:${r.color.fg}">${r.label}</span></td>
      <td class="num-col"><strong>${won(r.revSum)}</strong></td>
      <td class="num-col">${_pct1(r.share!=null?r.share*100:null)}</td>
      <td class="num-col">${r.avgQty!=null?num(Math.round(r.avgQty)):'—'}</td>
      <td class="num-col">${r.avgViews!=null?r.avgViews.toFixed(1)+'만':'—'}</td>
      <td class="num-col">${r.revPerView!=null?won(Math.round(r.revPerView)):'—'}</td>
    </tr>`).join('');
  note.textContent='';

  if(typeof Chart==='undefined')return;
  if(_dashProductChartInst)_dashProductChartInst.destroy();
  _dashProductChartInst=new Chart(chartEl.getContext('2d'),{
    type:'doughnut',
    data:{labels:rows.map(r=>r.label),datasets:[{data:rows.map(r=>r.revSum),backgroundColor:rows.map(r=>r.color.fg)}]},
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{position:'bottom',labels:{boxWidth:10,font:{size:11}}},tooltip:{callbacks:{label:ctx=>`${ctx.label}: ${won(ctx.raw)}`}}}
    }
  });
}

/* 3) 플랫폼(포맷)별 효율 — 조회당 매출(revenue per view) 높은 순으로 정렬해 "어느 포맷이
   효율적인가"가 표 맨 위에 바로 드러나게 함(최상위 행 강조 + 🏆). 색은 실적 표의
   FORMAT_COLORS(유튜브 빨강/릴스 파랑/게시물 중립)와 동일하게 맞춤. */
function renderDashPlatformAnalytics(){
  const scope=_dashRevScope();
  const body=document.getElementById('dashPlatformBody');
  const note=document.getElementById('dashPlatformNote');
  const chartEl=document.getElementById('dashPlatformChart');
  if(!scope.length){
    body.innerHTML='<tr><td colspan="6" class="dash-analytics-empty">해당 기간에 완료·진행중인 공구건이 없습니다</td></tr>';
    note.textContent='';
    if(_dashPlatformChartInst){_dashPlatformChartInst.destroy();_dashPlatformChartInst=null;}
    return;
  }
  const map=new Map();
  scope.forEach(d=>{
    const key=d.format||'';
    if(!key)return; // 포맷 미기입 건은 집계 왜곡 방지를 위해 제외(비고에 건수 표시)
    if(!map.has(key))map.set(key,{key,items:[]});
    map.get(key).items.push(d);
  });
  const assignedCount=[...map.values()].reduce((s,g)=>s+g.items.length,0);
  const unassigned=scope.length-assignedCount;
  if(!map.size){
    body.innerHTML='<tr><td colspan="6" class="dash-analytics-empty">해당 기간 완료·진행중 건에 포맷(플랫폼) 정보가 없습니다</td></tr>';
    note.textContent='';
    if(_dashPlatformChartInst){_dashPlatformChartInst.destroy();_dashPlatformChartInst=null;}
    return;
  }
  const rows=[...map.values()].map(g=>{
    const items=g.items;
    const revSum=items.reduce((s,d)=>s+(d.rev||0),0);
    const qtyVals=items.filter(d=>d.qty!=null).map(d=>d.qty);
    const viewVals=items.filter(d=>d.views!=null).map(d=>d.views);
    const qtySum=qtyVals.reduce((s,v)=>s+v,0),viewSum=viewVals.reduce((s,v)=>s+v,0);
    const avgViews=_safeDiv(viewSum,viewVals.length);
    const avgRev=_safeDiv(revSum,items.length);
    const revPerView=_wonPerView(revSum,viewSum);
    const conv=_safeDiv(qtySum,viewSum*10000);
    return{key:g.key,color:formatColor(g.key),count:items.length,avgViews,avgRev,revPerView,conv};
  }).sort((a,b)=>(b.revPerView??-1)-(a.revPerView??-1));

  const bestKey=rows[0].revPerView!=null?rows[0].key:null;
  body.innerHTML=rows.map(r=>`
    <tr${r.key===bestKey?' class="dash-top-row"':''}>
      <td><span class="bp bp-fmt" style="background:${r.color.bg};color:${r.color.fg}">${r.key}</span>${r.key===bestKey?' 🏆':''}</td>
      <td class="num-col">${r.count}</td>
      <td class="num-col">${r.avgViews!=null?r.avgViews.toFixed(1)+'만':'—'}</td>
      <td class="num-col">${r.avgRev!=null?won(Math.round(r.avgRev)):'—'}</td>
      <td class="num-col">${r.revPerView!=null?won(Math.round(r.revPerView)):'—'}</td>
      <td class="num-col">${_pct1(r.conv!=null?r.conv*100:null)}</td>
    </tr>`).join('');
  note.textContent=unassigned>0?`포맷 미기입 ${unassigned}건 제외`:'';

  if(typeof Chart==='undefined')return;
  if(_dashPlatformChartInst)_dashPlatformChartInst.destroy();
  _dashPlatformChartInst=new Chart(chartEl.getContext('2d'),{
    type:'bar',
    data:{labels:rows.map(r=>r.key),datasets:[{label:'조회당 매출',data:rows.map(r=>r.revPerView||0),backgroundColor:rows.map(r=>r.color.fg)}]},
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>won(Math.round(ctx.raw))+'/회'}}},
      scales:{y:{ticks:{callback:v=>won(v)}}}
    }
  });
}
