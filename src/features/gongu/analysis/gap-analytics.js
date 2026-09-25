'use strict';
/* 공구 분석 — 등급 교차 분석(매트릭스·산점도·효율·TOP10). */

/* ══ 등급 교차 분석 (2026-09-11) ═══════════════════════════════════════════
   매출등급과 팔로워등급의 관계를 네 각도에서 봄. 네 패널이 전부 같은 대상 집합(_dashGapRows)을
   쓰는 게 핵심 — 패널마다 대상이 다르면 "매트릭스 합계와 TOP10 건수가 왜 다르지?"가 됨.
   대상: 지금 필터에 걸린 스코프에 등장하는 채널 중 "완료 건 1건 이상 + 팔로워 입력" 둘 다
   만족하는 채널. 둘 중 하나라도 없으면 갭이 정의되지 않으므로 제외하고 그 수를 부제에 밝힌다.
   등급 필터 2종은 스코프에서 뺌(등급 간 비교가 존재 이유인 섹션이라 한 등급만 남기면 의미 소멸 —
   등급별 성과 섹션과 같은 판단). */
let _dashGapMatrixMetric='count'; // 'count' | 'rev'
let _dashGapEffMetric='revPerFol'; // 'revPerFol' | 'conv'
let _dashGapTopDir='high';         // 'high' | 'low'
let _dashGapScatterInst=null,_dashGapEffInst=null;
function _onDashGapMatrixMetricChange(){_dashGapMatrixMetric=document.getElementById('dashGapMatrixMetric').value;renderDashGapAnalytics();}
function _onDashGapEffMetricChange(){_dashGapEffMetric=document.getElementById('dashGapEffMetric').value;renderDashGapAnalytics();}
function _setDashGapTopDir(dir){if(_dashGapTopDir===dir)return;_dashGapTopDir=dir;renderDashGapAnalytics();}

function _dashGapRows(){
  const scope=_dashTierScope();
  const byCh=new Map();
  scope.forEach(d=>{
    const ch=(d.ch||d.influencer||'').trim();
    if(!ch)return;
    if(!byCh.has(ch))byCh.set(ch,[]);
    byCh.get(ch).push(d);
  });
  const rows=[];
  let excluded=0;
  byCh.forEach((items,ch)=>{
    const stat=tierStatOf(ch);
    // 완료 실적(매출 기록 포함)과 팔로워 수가 둘 다 있어야 두 등급이 모두 서고 갭이 정의됨
    if(!stat||!stat.count||stat.followerCount==null){excluded++;return;}
    // 총매출은 avg×count로 복원 — tierStats가 평균/건수만 들고 있고 둘의 곱이 곧 완료 건 매출 합
    const revSum=stat.avg!=null?stat.avg*stat.count:0;
    rows.push({
      ch,stat,items,
      revTier:stat.effective,followerTier:stat.followerTier,gap:stat.gap,
      followerCount:stat.followerCount,avgRev:stat.avg,count:stat.count,revSum,
      // 팔로워 1만 명당 평균 매출 — 규모가 다른 채널을 같은 자로 재기 위한 정규화 지표
      revPerFol:stat.followerCount>0?_safeDiv(stat.avg,stat.followerCount/10000):null
    });
  });
  return{rows,excluded,total:byCh.size};
}

/* 스피어만 순위상관 — 값 자체가 아니라 순위로 상관을 재므로 팔로워/매출처럼 분포가 크게 치우친
   (한두 채널이 자릿수로 큰) 데이터에 적합함. 동점은 평균 순위를 주고, 순위에 피어슨을 적용. */
function _spearman(xs,ys){
  const n=xs.length;
  if(n<3)return null;
  const rank=arr=>{
    const idx=arr.map((v,i)=>[v,i]).sort((a,b)=>a[0]-b[0]);
    const r=new Array(arr.length);
    let i=0;
    while(i<idx.length){
      let j=i;
      while(j+1<idx.length&&idx[j+1][0]===idx[i][0])j++;
      const avg=(i+j)/2+1; // 동점 구간의 평균 순위(1-based)
      for(let k=i;k<=j;k++)r[idx[k][1]]=avg;
      i=j+1;
    }
    return r;
  };
  const rx=rank(xs),ry=rank(ys);
  const mx=rx.reduce((s,v)=>s+v,0)/n,my=ry.reduce((s,v)=>s+v,0)/n;
  let num=0,dx=0,dy=0;
  for(let i=0;i<n;i++){const a=rx[i]-mx,b=ry[i]-my;num+=a*b;dx+=a*a;dy+=b*b;}
  return(dx&&dy)?num/Math.sqrt(dx*dy):null;
}
function _rhoWord(r){const a=Math.abs(r);return a>=0.7?'강함':a>=0.4?'보통':'약함';}
// log 축 눈금 라벨용 — Chart.js가 10의 거듭제곱 사이에 중간 눈금까지 만들어 라벨이 겹치므로
// 거듭제곱 자리에만 글자를 남김(눈금선 자체는 그대로 둬서 격자는 촘촘하게 유지)
function _isPow10(v){const l=Math.log10(v);return Math.abs(l-Math.round(l))<1e-9;}
/* 산점도 X축(팔로워, log) 눈금 — 기본은 1천·1만·10만·100만·1,000만 고정.
   데이터가 이 범위를 벗어나면 그 방향으로만 10의 거듭제곱을 덧붙여 점이 잘리지 않게 한다. */
const FOL_AXIS_MIN=1000,FOL_AXIS_MAX=10000000;
const FOL_AXIS_LABELS={1000:'1천',10000:'1만',100000:'10만',1000000:'100만',10000000:'1,000만'};
function _folAxisLabel(v){return FOL_AXIS_LABELS[v]||(_isPow10(v)?formatMan(v):'');}
function _folAxisRange(xs){
  const lo=Math.min(FOL_AXIS_MIN,...xs.map(v=>Math.pow(10,Math.floor(Math.log10(v)))));
  const hi=Math.max(FOL_AXIS_MAX,...xs.map(v=>Math.pow(10,Math.ceil(Math.log10(v)))));
  const ticks=[];
  for(let p=Math.round(Math.log10(lo));p<=Math.round(Math.log10(hi));p++)ticks.push(Math.pow(10,p));
  return{min:lo,max:hi,ticks};
}

function renderDashGapAnalytics(){
  const{rows,excluded,total}=_dashGapRows();
  const hdNote=document.getElementById('dashGapHdNote');
  const empty=document.getElementById('dashGapEmpty');
  const grid=document.getElementById('dashGapGrid');
  if(!hdNote)return;
  document.getElementById('dashGapMatrixMetric').value=_dashGapMatrixMetric;
  document.getElementById('dashGapEffMetric').value=_dashGapEffMetric;
  document.getElementById('dashGapTopTabs').querySelectorAll('button')
    .forEach(b=>b.classList.toggle('on',b.dataset.dir===_dashGapTopDir));

  hdNote.textContent=`채널 단위 · 대상 ${rows.length}개 채널`+(excluded>0?` · 제외 ${excluded}개(완료 실적 또는 팔로워 수 없음)`:'');
  if(!rows.length){
    grid.style.display='none';
    empty.style.display='';
    empty.textContent=total
      ?'대상 채널이 없습니다 — 완료 실적과 팔로워 수가 모두 있는 채널이 필요합니다(팔로워 수는 채널별 성과 표에서 바로 입력할 수 있습니다)'
      :'해당 기간에 완료·진행중인 공구건이 없습니다';
    [_dashGapScatterInst,_dashGapEffInst].forEach(c=>{if(c)c.destroy();});
    _dashGapScatterInst=_dashGapEffInst=null;
    closeGapCellPop();
    return;
  }
  grid.style.display='';
  empty.style.display='none';
  _renderGapMatrix(rows);
  _renderGapScatter(rows);
  _renderGapEff(rows);
  _renderGapTop(rows);
}

/* a) 팔로워 × 매출 등급 매트릭스 — 행은 팔로워등급(위=메가), 열은 매출등급(오른쪽=메가)이라
   같은 등급끼리 만나는 칸이 좌하→우상 대각선에 놓인다(=갭 0 '적정'). 대각선 위쪽이 고효율. */
let _gapCellChannels=null; // 팝오버가 쓰는 마지막 렌더의 셀→채널 목록
function _renderGapMatrix(rows){
  const host=document.getElementById('dashGapMatrix');
  const sum=document.getElementById('dashGapMatrixSum');
  const rowTiers=TIER_OPTIONS;                 // 위에서부터 메가 → 나노
  const colTiers=TIER_OPTIONS.slice().reverse(); // 왼쪽부터 나노 → 메가
  const bucket=new Map();
  rows.forEach(r=>{
    const k=r.followerTier+'|'+r.revTier;
    if(!bucket.has(k))bucket.set(k,[]);
    bucket.get(k).push(r);
  });
  _gapCellChannels=bucket;

  host.style.gridTemplateColumns=`58px repeat(${colTiers.length},minmax(0,1fr))`;
  const head=['<div class="gm-h" title="세로=팔로워등급 / 가로=매출등급">팔로워↓</div>']
    .concat(colTiers.map(c=>`<div class="gm-h">${c}</div>`));
  const cells=rowTiers.map(rt=>{
    const lbl=`<div class="gm-rowlbl">${tierBadge(rt)}</div>`;
    const tds=colTiers.map(ct=>{
      const list=bucket.get(rt+'|'+ct)||[];
      const gap=tierGapOf(ct,rt);
      if(!list.length)return`<div class="gm-cell gm-zero"><span class="gm-v">0</span></div>`;
      const k=gapKind(gap);
      // 진하기는 갭의 크기(1~3)에 비례 — 0(적정)은 회색 고정
      const alpha=k==='even'?0.12:0.14+0.20*Math.abs(gap);
      const base=k==='even'?'#6B7280':GAP_COLORS[k].fg;
      const revSum=list.reduce((s,x)=>s+x.revSum,0);
      const main=_dashGapMatrixMetric==='rev'?wonShort(revSum):`${list.length}개`;
      const sub=_dashGapMatrixMetric==='rev'?`${list.length}개 채널`:wonShort(revSum);
      const tip=[`팔로워 ${rt} × 매출 ${ct} — 갭 ${gap>0?'+':gap<0?'−':''}${Math.abs(gap)} ${gapLabelOf(gap)}`,
        `채널 ${list.length}개 · 총매출 ${wonShort(revSum)}`,'클릭하면 채널 목록'].join('\n');
      return`<div class="gm-cell" style="background:${_hexAlpha(base,alpha)}" title="${_escAttr(tip)}"
        onclick="openGapCellPop(event,'${_escAttr(rt)}','${_escAttr(ct)}')">
        <span class="gm-v">${main}</span><span class="gm-sub">${sub}</span></div>`;
    });
    return[lbl].concat(tds).join('');
  });
  host.innerHTML=head.join('')+cells.join('');

  const n=rows.length;
  const cnt=k=>rows.filter(r=>gapKind(r.gap)===k).length;
  const p=v=>Math.round(v/n*100);
  sum.innerHTML=`적정 <b>${p(cnt('even'))}%</b> · 고효율 <b>${p(cnt('high'))}%</b> · 저효율 <b>${p(cnt('low'))}%</b>`+
    ` <span style="color:var(--text-3)">(${cnt('even')}·${cnt('high')}·${cnt('low')} / ${n}개 채널)</span>`;
}
function closeGapCellPop(){const p=document.getElementById('dashGapCellPop');if(p)p.classList.remove('open');}
function openGapCellPop(ev,followerTier,revTier){
  if(ev){ev.stopPropagation();ev.preventDefault();}
  const pop=document.getElementById('dashGapCellPop');
  const list=_gapCellChannels?(_gapCellChannels.get(followerTier+'|'+revTier)||[]):[];
  if(!pop||!list.length)return;
  const gap=tierGapOf(revTier,followerTier);
  const sorted=list.slice().sort((a,b)=>(b.avgRev||0)-(a.avgRev||0));
  pop.innerHTML=`<div class="gcp-hd">팔로워 ${followerTier} × 매출 ${revTier} · ${list.length}개 채널 ${gapBadge(gap)}</div>
    <table><tbody>${sorted.map(r=>`<tr>
      <td><span class="gap-ch-link" onclick="_gapPickChannel('${_escAttr(r.ch)}')">${r.ch}</span></td>
      <td class="num-col">${formatMan(r.followerCount)}</td>
      <td class="num-col">${wonShort(r.avgRev)}</td>
      <td class="num-col">${r.gap>0?'+':r.gap<0?'−':''}${Math.abs(r.gap)}</td>
    </tr>`).join('')}</tbody></table>`;
  pop.classList.add('open');
  // 되돌리기 팝오버와 같은 배치 규칙 — 아래 공간이 부족하면 위로 뒤집고 화면 안으로 물림
  const r=(ev&&ev.currentTarget?ev.currentTarget:document.body).getBoundingClientRect();
  const vw=window.innerWidth,vh=window.innerHeight,m=6;
  const pw=pop.offsetWidth,ph=pop.offsetHeight;
  let top=r.bottom+m;
  if(top+ph>vh-8&&r.top-m-ph>=8)top=r.top-m-ph;
  pop.style.top=Math.max(8,Math.min(top,vh-8-ph))+'px';
  pop.style.left=Math.max(8,Math.min(r.left,vw-8-pw))+'px';
}
function _gapPickChannel(ch){closeGapCellPop();_selectInfSearch('dash',ch);}
document.addEventListener('click',e=>{
  const pop=document.getElementById('dashGapCellPop');
  if(pop&&pop.classList.contains('open')&&!pop.contains(e.target))closeGapCellPop();
});

/* b) 팔로워 수 × 건당 평균 매출 산점도 — 둘 다 자릿수 차이가 커서 선형 축이면 점이 좌하단에
   뭉치므로 log 축. 등급 임계값에 점선을 그어 4×4 격자가 보이게 하면 "어느 칸에 있는 채널인가"가
   곧 두 등급의 조합이 된다(매트릭스와 같은 정보를 연속값으로 본 것). */
function _renderGapScatter(rows){
  const el=document.getElementById('dashGapScatter');
  const rhoEl=document.getElementById('dashGapRho');
  // log 축은 0 이하를 그릴 수 없음 — 팔로워 0/매출 0 채널은 점에서 제외(상관계수는 전체로 계산)
  const pts=rows.filter(r=>r.followerCount>0&&r.avgRev>0);
  const rho=_spearman(rows.map(r=>r.followerCount),rows.map(r=>r.avgRev||0));
  rhoEl.textContent=rho==null
    ?'ρ — (채널 3개 이상 필요)'
    :`ρ = ${rho.toFixed(2)} (팔로워와 매출의 상관: ${_rhoWord(rho)})`;
  rhoEl.title=rho==null?'스피어만 순위상관계수는 채널이 3개 이상일 때만 계산합니다'
    :'스피어만 순위상관계수 — 0.7 이상 강함 / 0.4~0.7 보통 / 0.4 미만 약함';
  if(!el||typeof Chart==='undefined')return;
  if(_dashGapScatterInst)_dashGapScatterInst.destroy();
  if(!pts.length){_dashGapScatterInst=null;return;}
  const xRange=_folAxisRange(pts.map(p=>p.followerCount)); // pts는 아직 {x,y}가 아니라 채널 행 객체

  // 등급 임계값 점선 — x는 FOLLOWER_RULES, y는 TIER_RULES의 평균 기준(매출등급 판정의 주 기준)
  const guides={
    id:'gapGuides',
    beforeDatasetsDraw(chart){
      const{ctx,chartArea,scales:{x,y}}=chart;
      if(!x||!y)return;
      ctx.save();
      ctx.strokeStyle='#C9CEDA';ctx.lineWidth=1;ctx.setLineDash([4,4]);
      ctx.fillStyle='#9AA1B2';ctx.font='9px system-ui,sans-serif';
      FOLLOWER_RULES.forEach(r=>{
        const px=x.getPixelForValue(r.min);
        if(px<chartArea.left||px>chartArea.right)return;
        ctx.beginPath();ctx.moveTo(px,chartArea.top);ctx.lineTo(px,chartArea.bottom);ctx.stroke();
        ctx.textAlign='left';ctx.textBaseline='top';
        ctx.fillText(r.tier,px+2,chartArea.top+2);
      });
      TIER_RULES.forEach(r=>{
        const py=y.getPixelForValue(r.avg);
        if(py<chartArea.top||py>chartArea.bottom)return;
        ctx.beginPath();ctx.moveTo(chartArea.left,py);ctx.lineTo(chartArea.right,py);ctx.stroke();
        ctx.textAlign='right';ctx.textBaseline='bottom';
        ctx.fillText(r.tier,chartArea.right-2,py-2);
      });
      ctx.restore();
    }
  };
  const byKind=k=>pts.filter(r=>gapKind(r.gap)===k).map(r=>({x:r.followerCount,y:r.avgRev,_r:r}));
  _dashGapScatterInst=new Chart(el.getContext('2d'),{
    type:'scatter',
    data:{datasets:[
      {label:'고효율',data:byKind('high'),backgroundColor:GAP_COLORS.high.fg},
      {label:'적정',  data:byKind('even'),backgroundColor:GAP_COLORS.even.fg},
      {label:'저효율',data:byKind('low'), backgroundColor:GAP_COLORS.low.fg},
    ].filter(ds=>ds.data.length)},
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{
        legend:{position:'bottom',labels:{boxWidth:10,font:{size:11},usePointStyle:true}},
        tooltip:{callbacks:{label:ctx=>{
          const r=ctx.raw._r;
          return[r.ch,
            `팔로워: ${formatMan(r.followerCount)}`,
            `완료 ${r.count}건 · 평균 매출 ${wonShort(r.avgRev)}`,
            `팔로워등급 ${r.followerTier} → 매출등급 ${r.revTier}`,
            `갭 ${r.gap>0?'+':r.gap<0?'−':''}${Math.abs(r.gap)} ${r.stat.gapLabel}`];
        }}}
      },
      scales:{
        // X축 눈금은 1천·1만·10만·100만·1,000만 고정 — 자동 눈금이면 데이터 범위에 따라 라벨이
        // 매번 달라져서 "이 채널이 어느 구간인지"를 눈으로 익힐 수가 없음. 데이터가 이 범위를
        // 벗어나면 그 방향으로만 10의 거듭제곱을 더 붙인다(점이 축 밖으로 잘리지 않게).
        x:{type:'logarithmic',title:{display:true,text:'팔로워 수(log)'},
          min:xRange.min,max:xRange.max,
          afterBuildTicks:a=>{a.ticks=xRange.ticks.map(v=>({value:v}));},
          ticks:{maxRotation:0,autoSkip:false,includeBounds:true,callback:v=>_folAxisLabel(v)}},
        y:{type:'logarithmic',title:{display:true,text:'건당 평균 매출(log)'},
          ticks:{maxRotation:0,autoSkip:false,callback:v=>_isPow10(v)?wonShort(v):''}}
      }
    },
    plugins:[guides]
  });
}

/* c) 팔로워등급별 효율 — "팔로워가 커질수록 효율이 떨어지는가"를 한눈에 보려는 차트라 막대 순서를
   TIER_OPTIONS(메가→나노)로 고정한다. 값이 큰 순으로 정렬하면 그 질문 자체가 안 보임.
   표본(채널 수)이 TIER_MIN_SAMPLE 미만인 등급은 다른 표·차트와 같은 규칙으로 옅게 처리. */
function _renderGapEff(rows){
  const el=document.getElementById('dashGapEffChart');
  const sub=document.getElementById('dashGapEffSub');
  const isConv=_dashGapEffMetric==='conv';
  const scope=_dashTierScope();
  const chanSet=new Map(rows.map(r=>[r.ch,r]));
  const series=TIER_OPTIONS.map(t=>{
    const mine=rows.filter(r=>r.followerTier===t);
    let val=null;
    if(isConv){
      // 전환율은 건 단위 합계로 계산(채널 평균을 다시 평균 내면 작은 채널이 과대 반영됨)
      const items=scope.filter(d=>{const r=chanSet.get((d.ch||d.influencer||'').trim());return r&&r.followerTier===t;});
      val=_tierMetrics(items).conv;
      val=val!=null?val*100:null;
    }else{
      const vals=mine.map(r=>r.revPerFol).filter(v=>v!=null);
      val=vals.length?vals.reduce((s,v)=>s+v,0)/vals.length:null;
    }
    return{key:t,val,n:mine.length,low:_tierLowSample(mine.length)};
  });
  if(sub)sub.textContent=(isConv
    ?'해당 팔로워등급 채널들의 판매수량 ÷ 조회수(건 단위 합계)'
    :'채널별 (건당 평균 매출 ÷ 팔로워 1만 명)의 평균 — 규모가 다른 채널을 같은 자로 비교하기 위한 정규화 지표')
    +` · 채널 ${TIER_MIN_SAMPLE}개 미만 등급은 옅게`;
  if(!el||typeof Chart==='undefined')return;
  if(_dashGapEffInst)_dashGapEffInst.destroy();

  const nLabels={
    id:'gapEffLabels',
    afterDatasetsDraw(chart){
      const{ctx}=chart;
      const meta=chart.getDatasetMeta(0);
      ctx.save();
      ctx.font='700 10px system-ui,sans-serif';ctx.textAlign='center';ctx.textBaseline='bottom';
      series.forEach((s,i)=>{
        const bar=meta.data[i];
        if(!bar||s.val==null)return;
        ctx.fillStyle='#5B6375';
        ctx.fillText(`${s.n}개 채널${s.low?' · 표본 적음':''}`,bar.x,bar.y-4);
      });
      ctx.restore();
    }
  };
  _dashGapEffInst=new Chart(el.getContext('2d'),{
    type:'bar',
    data:{labels:TIER_OPTIONS,datasets:[{
      label:isConv?'전환율':'팔로워 1만 명당 평균 매출',
      data:series.map(s=>s.val),
      backgroundColor:series.map(s=>s.low?_hexAlpha(tierColor(s.key).fg,0.35):tierColor(s.key).fg),
      borderRadius:4,maxBarThickness:56
    }]},
    options:{
      responsive:true,maintainAspectRatio:false,
      layout:{padding:{top:18}},
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{label:ctx=>{
          const s=series[ctx.dataIndex];
          if(s.val==null)return'해당 등급 채널 없음';
          return[`${isConv?'전환율':'팔로워 1만 명당 평균 매출'}: ${isConv?_pct1(s.val):won(Math.round(s.val))}`,
            `채널 ${s.n}개${s.low?' — 참고용':''}`];
        }}}
      },
      scales:{y:{min:0,ticks:{callback:v=>isConv?v.toFixed(1)+'%':won(Math.round(v))}}}
    },
    plugins:[nLabels]
  });
}

/* d) 고효율/저효율 TOP 10 — 갭이 1차 기준, 같으면 팔로워 1만 명당 매출로 2차. 2차 기준이 없으면
   같은 갭 안에서 순서가 무작위로 보여 "왜 이 채널이 위인가"에 답할 수 없음. */
function _renderGapTop(rows){
  const body=document.getElementById('dashGapTopBody');
  const high=_dashGapTopDir==='high';
  const eff=r=>r.revPerFol==null?-Infinity:r.revPerFol;
  const sorted=rows.slice().sort((a,b)=>high
    ?(b.gap-a.gap)||(eff(b)-eff(a))||a.ch.localeCompare(b.ch)
    :(a.gap-b.gap)||(eff(a)-eff(b))||a.ch.localeCompare(b.ch)).slice(0,10);
  body.innerHTML=sorted.length?sorted.map(r=>`
    <tr>
      <td><span class="gap-ch-link" onclick="_gapPickChannel('${_escAttr(r.ch)}')">${r.ch}</span></td>
      <td>${tierBadge(r.followerTier)} <span style="color:var(--text-3)">→</span> ${tierBadge(r.revTier)}</td>
      <td>${gapBadge(r.gap)}</td>
      <td class="num-col">${formatMan(r.followerCount)}</td>
      <td class="num-col">${wonShort(r.avgRev)}</td>
      <td class="num-col">${r.count}</td>
    </tr>`).join(''):'<tr><td colspan="6" class="dash-analytics-empty">표시할 채널이 없습니다</td></tr>';
}
