'use strict';
/* 공구 분석 — 채널(인플루언서)별 성과 표와 팔로워 수 인라인 편집. */

/* 1) 채널(인플루언서)별 성과 — 매출 상위순 표 + 차트, 회차별 추세는 "회차" 전용 필드가 없어
   같은 채널 내 시작일 순 정렬로 대체 계산(첫 공구 vs 최근 공구 매출 비교, 2건 이상일 때만).
   집계 단위는 "공구건"(DATA의 원소 하나 = 서버가 dealId로 이미 합친 공구건 하나) — 상품코드가
   여러 개라 시트에서 여러 행으로 나뉜 건도 adaptGAS+_mergeDuplicateCodeRows를 거치며 이미 1개
   원소로 합쳐져 있으므로 items.length가 그대로 공구 횟수가 됨(행 수로 부풀려지지 않음).
   채널 키에 .trim()을 추가한 이유(버그 수정) — 이전에는 trim 없이 원본 채널명 문자열을
   그대로 Map 키로 썼는데, 같은 채널이라도 앞뒤 공백이 섞인 변형("22기 옥순" vs "22기 옥순 ")이
   시트에 있으면 서로 다른 키로 쪼개져 한 채널의 공구가 여러 행으로 흩어져 보이는 문제가 있었음
   (제품코드 병합 로직 _mergeDuplicateCodeRows는 이미 채널 키에 trim을 적용하고 있었어서, 여기도
   동일하게 맞춤). */
// 2026-09-10: 섹션 전용 제품 필터는 상단 전역 '품목' 필터로 일원화하며 제거함
// (같은 성격의 필터가 두 곳에 있으면 어느 쪽이 적용된 결과인지 알 수 없었음).

// 채널별 성과 표 컬럼 정렬(2026-08-18) — sortSales(실적 상세 표)와 같은 헤더 클릭·화살표 패턴을
// 재사용. 기본값은 기존 동작 그대로 누적 매출 내림차순. 제품 필터를 바꿔도 이 값은 그대로 유지되고
// renderDashChannelAnalytics가 재호출될 때마다 이 기준으로 다시 정렬됨(별도 유지 로직 불필요).
let _dashChannelSort={key:'revSum',dir:-1};
let _dashChFollowerMissingOnly=false; // 헤더의 "팔로워 미입력 N개" 배지로 켜고 끄는 표 전용 보기
let _dashChIdMissingOnly=false;       // 같은 방식의 "ID 미입력 N채널" 보기 — 둘은 각각 독립으로 걸린다
/* 채널에 플랫폼 ID가 하나도 없는가.
   둘 다 비어 있을 때만 미입력으로 본다 — 인스타 전용/유튜브 전용 채널이 대부분이라
   "둘 다 채워라"로 잡으면 목록이 영원히 안 줄어들고, 배지 숫자가 의미를 잃는다. */
function _chIdMissing(ch){
  const info=channelInfoOf(ch);
  if(!info)return true;
  return !info.fields.igId.filled&&!info.fields.ytId.filled;
}
function _toggleDashChIdMissing(){
  _dashChIdMissingOnly=!_dashChIdMissingOnly;
  renderDashChannelAnalytics();
}
function _toggleDashChFollowerMissing(){
  _dashChFollowerMissingOnly=!_dashChFollowerMissingOnly;
  renderDashChannelAnalytics();
}
/* 팔로워등급 셀 툴팁 — 등급 툴팁(tierEvidence)과 같은 톤으로, 무엇을 근거로 어느 시점 값을
   썼는지 밝힘. 팔로워도 등급처럼 기간 필터와 무관한 채널 단위 값이라 그 점을 첫 줄에 적음. */
function followerEvidence(stat){
  if(!stat||stat.followerCount==null)
    return'팔로워 수 미입력 — 표의 팔로워 수 칸을 클릭해 입력할 수 있습니다';
  const when=stat.followerAt?`${String(stat.followerAt).slice(0,7).replace('-','.')} 공구건 기준`:'기록 시점 미상';
  const parts=[`채널 단위 · 가장 최근 입력값 (${when})`,
    `팔로워 ${formatMan(stat.followerCount)}`,
    `팔로워등급: ${stat.followerTier}`];
  if(stat.gap!=null)parts.push(`갭: ${stat.gap>0?'+':stat.gap<0?'−':''}${Math.abs(stat.gap)} ${stat.gapLabel} (매출등급 ${stat.effective} − 팔로워등급 ${stat.followerTier})`);
  else parts.push('매출등급이 미산정이라 갭은 계산되지 않습니다');
  return parts.join('\n');
}
function _sortDashChannelTable(key){
  // sortSales(실적 상세 표)와 동일하게 새 컬럼을 처음 클릭하면 오름차순(dir:1)부터 시작
  if(_dashChannelSort.key===key)_dashChannelSort.dir*=-1;else{_dashChannelSort={key,dir:1};}
  renderDashChannelAnalytics();
}
// 값이 없는 행(평균 조회수 미기입 등)과 추세가 없는 행(1회성 등)은 정렬 방향과 무관하게 항상
// 맨 아래로 — 그래야 "값이 큰 게 위로 온다"는 정렬의 기본 기대를 안 깨면서 빈 값이 섞여도 헷갈리지 않음.
// 추세는 "▲30%"와 "▼30%"가 같은 크기(30)로 저장돼 있어(dir로만 방향 구분), 증가는 +, 감소는 -로
// 바꿔 하나의 숫자로 취급 — 그래야 "성장 중인 채널이 위/아래로 몰린다"는 정렬이 자연스럽게 동작함.
function _dashChannelSortVal(r,key){
  if(key==='trend')return r.trend?(r.trend.dir==='down'?-r.trend.pct:r.trend.pct):null;
  // 등급은 TIER_OPTIONS 순서(메가=0 … 나노=3)로 정렬. 미분류는 null이라 방향과 무관하게 항상 맨 아래.
  if(key==='tier')return tierRank(r.tier);
  if(key==='followerTier')return tierRank(r.followerTier); // 미입력도 null → 맨 아래
  return r[key];
}
function _dashChannelCompare(a,b,key,dir){
  if(key==='ch')return a.ch.localeCompare(b.ch)*dir;
  const av=_dashChannelSortVal(a,key),bv=_dashChannelSortVal(b,key);
  if(av==null&&bv==null)return 0;
  if(av==null)return 1;
  if(bv==null)return -1;
  return (av-bv)*dir;
}
/* 채널별 성과 표의 컬럼 정의 — 라벨·툴팁·정렬키·정렬(숫자/문자)이 전부 여기 모여 있다.
   '공구 횟수'는 라벨이 길어 열을 넓게 잡아먹던 컬럼이라 subLabel로 둘째 줄을 분리했다.
   팔로워등급 툴팁은 기준값이 상수에서 만들어지므로 함수로 둬서 렌더 시점에 계산한다
   (예전엔 헤더에 id를 박아두고 렌더 때마다 title을 따로 덮어썼다). */
const DASH_CHANNEL_COLS=[
  {key:'ch',           lb:'채널'},
  {key:'tier',         lb:'매출등급',      info:()=>tierCriteriaText()},
  {key:'followerTier', lb:'팔로워등급',    info:()=>followerCriteriaText()},
  {key:'gap',          lb:'갭',            info:'매출등급 순위 − 팔로워등급 순위 (나노=0 … 메가=3). +면 팔로워 규모 대비 잘 파는 채널(고효율), −면 그 반대(저효율).'},
  {key:'followerCount',lb:'팔로워 수',     num:true, info:'셀을 클릭하면 바로 수정할 수 있습니다 — 저장하면 그 채널의 가장 최근 공구건 행에 기록됩니다'},
  {key:'count',        lb:'공구 횟수',     num:true, subLabel:'(기간 내)'},
  {key:'revSum',       lb:'누적 매출',     num:true},
  {key:'avgQty',       lb:'평균 판매수량', num:true},
  {key:'avgViews',     lb:'평균 조회수',   num:true},
  {key:'conv',         lb:'전환율',        num:true},
  {key:'trend',        lb:'추세'},
];
function _renderDashChannelHead(){
  document.getElementById('dashChannelHead').innerHTML=DASH_CHANNEL_COLS.map(c=>
    sortableThHtml(c,{sorted:_dashChannelSort.key===c.key,dir:_dashChannelSort.dir,
      onclick:`_sortDashChannelTable('${c.key}')`})).join('');
}
function renderDashChannelAnalytics(){
  const scope=_dashRevScope(); // 품목 조건은 상단 전역 필터가 이미 반영해 줌

  const body=document.getElementById('dashChannelBody');
  const note=document.getElementById('dashChannelNote');
  const chartEl=document.getElementById('dashChannelChart');
  // 데이터가 없어 아래에서 바로 빠져나가도 헤더는 남아 있어야 하므로 맨 앞에서 그린다
  _renderDashChannelHead();
  if(!scope.length){
    body.innerHTML=`<tr><td colspan="${DASH_CHANNEL_COLS.length}" class="dash-analytics-empty">${_dashProductLabel()?'해당 기간·품목 조건에 완료·진행중인 공구건이 없습니다':'해당 기간에 완료·진행중인 공구건이 없습니다'}</td></tr>`;
    note.textContent='';
    document.getElementById('dashChFolMissing').style.display='none';
    document.getElementById('dashChIdMissing').style.display='none';
    if(_dashChannelChartInst){_dashChannelChartInst.destroy();_dashChannelChartInst=null;}
    return;
  }
  const map=new Map();
  scope.forEach(d=>{
    const key=(d.ch||d.influencer||'').trim()||'(미상)';
    if(!map.has(key))map.set(key,{ch:key,items:[]});
    map.get(key).items.push(d);
  });
  const rows=[...map.values()].map(g=>{
    const items=g.items;
    const revSum=items.reduce((s,d)=>s+(d.rev||0),0);
    const qtyVals=items.filter(d=>d.qty!=null).map(d=>d.qty);
    const viewVals=items.filter(d=>d.views!=null).map(d=>d.views);
    const qtySum=qtyVals.reduce((s,v)=>s+v,0),viewSum=viewVals.reduce((s,v)=>s+v,0);
    const avgQty=_safeDiv(qtySum,qtyVals.length);
    const avgViews=_safeDiv(viewSum,viewVals.length);
    const conv=_safeDiv(qtySum,viewSum*10000);
    const sorted=[...items].sort((a,b)=>new Date(a.start)-new Date(b.start));
    let trend=null;
    if(sorted.length>=2){
      const first=sorted[0].rev,last=sorted[sorted.length-1].rev;
      if(first!=null&&last!=null&&first>0){
        if(last>first)trend={dir:'up',pct:(last-first)/first*100};
        else if(last<first)trend={dir:'down',pct:(first-last)/first*100};
        else trend={dir:'flat',pct:0};
      }
    }
    // 등급은 채널 단위 실효 등급(수동 지정 > 자동 산정 > 미산정) — 산정 근거/플래그도 같이 들고 감
    const tierStat=tierStatOf(g.ch);
    const tier=tierStat&&isRatedTier(tierStat.effective)?tierStat.effective:'';
    // 등급 툴팁용 — 필터가 걸린 이 스코프 안에서 등급 산정 대상이 되는 완료 건이 몇 건인지
    const scopedDone=items.filter(_isTierCountable).length;
    // 팔로워 축 — 등급과 마찬가지로 채널 단위 값(기간 필터와 무관한 "가장 최근 팔로워 수" 기준)
    const followerTier=tierStat?tierStat.followerTier:TIER_FOLLOWER_UNSET;
    const followerCount=tierStat?tierStat.followerCount:null;
    const gap=tierStat?tierStat.gap:null;
    return{ch:g.ch,tier,tierStat,scopedDone,followerTier,followerCount,gap,
      count:items.length,revSum,avgQty,avgViews,conv,trend};
  });

  // 팔로워 미입력 채널 수 — 헤더 옆 배지로 보여주고, 누르면 그 채널만 남겨 채워넣기 쉽게 함
  const missing=rows.filter(r=>r.followerCount==null).length;
  const misBtn=document.getElementById('dashChFolMissing');
  misBtn.style.display=(missing||_dashChFollowerMissingOnly)?'':'none';
  misBtn.textContent=_dashChFollowerMissingOnly?`팔로워 미입력 ${missing}개만 보는 중 ✕`:`팔로워 미입력 ${missing}개`;
  misBtn.classList.toggle('on',_dashChFollowerMissingOnly);
  misBtn.title=_dashChFollowerMissingOnly?'클릭하면 전체 채널을 다시 표시합니다':'클릭하면 팔로워 수가 없는 채널만 표시합니다';
  if(_dashChFollowerMissingOnly&&!missing)_dashChFollowerMissingOnly=false; // 다 채우면 자동 해제

  // ID 미입력 채널 수 — 팔로워 배지와 같은 조작. 두 배지는 독립이라 동시에 걸면 교집합이 남는다
  const idMissing=rows.filter(r=>_chIdMissing(r.ch)).length;
  const idBtn=document.getElementById('dashChIdMissing');
  idBtn.style.display=(idMissing||_dashChIdMissingOnly)?'':'none';
  idBtn.textContent=_dashChIdMissingOnly?`ID 미입력 ${idMissing}채널만 보는 중 ✕`:`ID 미입력 ${idMissing}채널`;
  idBtn.classList.toggle('on',_dashChIdMissingOnly);
  idBtn.title=_dashChIdMissingOnly?'클릭하면 전체 채널을 다시 표시합니다':'클릭하면 인스타/유튜브 ID가 하나도 없는 채널만 표시합니다';
  if(_dashChIdMissingOnly&&!idMissing)_dashChIdMissingOnly=false;

  // 차트는 표 정렬 기준과 무관하게 항상 "매출 상위 10개"를 보여줌(차트 자체가 "누적 매출" 기준으로
  // 라벨돼 있어, 표를 다른 기준으로 정렬해도 차트까지 같이 흔들리면 오히려 더 헷갈림) — rows를
  // 정렬하기 전에 매출 기준 정렬본을 따로 떼어둠. 미입력 보기는 표에만 걸고 차트는 그대로 둠.
  const top=[...rows].sort((a,b)=>b.revSum-a.revSum).slice(0,10);
  note.textContent=rows.length>10?`매출 상위 10개 채널만 차트에 표시(전체 ${rows.length}개 채널)`:'';

  let shown=rows;
  if(_dashChFollowerMissingOnly)shown=shown.filter(r=>r.followerCount==null);
  if(_dashChIdMissingOnly)shown=shown.filter(r=>_chIdMissing(r.ch));
  if(shown===rows)shown=rows.slice(); // 아래 sort가 rows 원본을 흔들지 않게(차트는 rows로 따로 뽑는다)
  shown.sort((a,b)=>_dashChannelCompare(a,b,_dashChannelSort.key,_dashChannelSort.dir));

  const trendIcon={up:'▲',down:'▼',flat:'–'};
  body.innerHTML=shown.map(r=>`
    <tr>
      <td>${chNameHtml(r.ch,getChannelLinkByName(r.ch),_chMismatchBadge(r.ch))}</td>
      <td class="tier-help" title="${_escAttr(tierEvidence(r.tierStat,r.scopedDone))}">${tierBadgeWithFlags(r.tierStat,true)}${tierDeltaHtml(r.tierStat)}</td>
      <td class="tier-help" title="${_escAttr(followerEvidence(r.tierStat))}">${tierBadge(r.followerTier)}</td>
      <td>${gapBadge(r.gap)}</td>
      <td class="num-col fol-cell" data-ch="${_escAttr(r.ch)}" onclick="_startFollowerEdit(this)" title="클릭하면 수정(만 단위)">${r.followerCount!=null?formatMan(r.followerCount):'<span style="color:var(--text-3)">—</span>'}</td>
      <td class="num-col">${r.count}</td>
      <td class="num-col"><strong>${won(r.revSum)}</strong></td>
      <td class="num-col">${r.avgQty!=null?num(Math.round(r.avgQty)):'—'}</td>
      <td class="num-col">${r.avgViews!=null?r.avgViews.toFixed(1)+'만':'—'}</td>
      <td class="num-col">${_pct1(r.conv!=null?r.conv*100:null)}</td>
      <td>${r.trend?`<span class="trend-${r.trend.dir}">${trendIcon[r.trend.dir]} ${r.trend.pct.toFixed(0)}%</span>`:'<span style="color:var(--text-3)">—</span>'}</td>
    </tr>`).join('');

  if(typeof Chart==='undefined')return;
  if(_dashChannelChartInst)_dashChannelChartInst.destroy();
  _dashChannelChartInst=new Chart(chartEl.getContext('2d'),{
    type:'bar',
    data:{labels:top.map(r=>r.ch),datasets:[{label:'누적 매출',data:top.map(r=>r.revSum),backgroundColor:'#3B56E5'}]},
    options:{
      indexAxis:'y',responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>won(ctx.raw)}}},
      scales:{x:{ticks:{callback:v=>won(v)}}}
    }
  });
}

/* ── 팔로워 수 인라인 편집 (채널별 성과 표) ─────────────────────────────────
   셀을 누르면 그 자리에서 입력칸이 되고, Enter/포커스 아웃으로 저장한다. 저장은 GAS
   updateChannelFollowers — 그 채널의 "가장 최근 공구건 행"에만 쓰는 채널 단위 갱신이라,
   과거 건의 당시 팔로워 수(스냅샷)는 건드리지 않는다.
   로컬 DATA도 같은 규칙(가장 최근 건)으로 즉시 반영해 fetchLive를 기다리지 않고 등급·갭·
   매트릭스가 바로 다시 그려지게 함(수동 등급 되돌리기와 같은 패턴). */
let _folEditing=null; // 편집 중인 채널명 — 중복 저장/재진입 방지
function _startFollowerEdit(td){
  if(_folEditing)return;
  const ch=td.dataset.ch;
  const stat=tierStatOf(ch);
  const cur=stat?stat.followerCount:null;
  _folEditing=ch;
  // 입력 단위는 모달/등록 폼과 똑같이 만 단위 — "만" 접미사와 명 단위 환산줄까지 같은 구성
  td.innerHTML=`<span class="fol-edit"><input class="fol-inp" type="text" inputmode="decimal"`+
    ` value="${_escAttr(countToMan(cur))}" placeholder="예: 44.3"><span class="fol-unit">만</span></span>`+
    `<div class="fol-conv">${_folConvText(cur)}</div>`;
  const inp=td.querySelector('input');
  const conv=td.querySelector('.fol-conv');
  inp.oninput=()=>{
    const clean=_sanitizeManInput(inp.value);
    if(clean!==inp.value){
      const pos=Math.max(0,(inp.selectionStart||0)-(inp.value.length-clean.length));
      inp.value=clean;
      try{inp.setSelectionRange(pos,pos);}catch(e){}
    }
    conv.textContent=_folConvText(manToCount(inp.value));
  };
  inp.onkeydown=e=>{
    if(e.key==='Enter'){e.preventDefault();inp.blur();}
    else if(e.key==='Escape'){e.preventDefault();_folEditing=null;renderDashChannelAnalytics();}
  };
  inp.onblur=()=>{
    if(_folEditing!==ch)return; // Escape로 이미 빠져나온 경우
    const next=manToCount(inp.value);
    _folEditing=null;
    if(next===cur){renderDashChannelAnalytics();return;} // 안 바뀌었으면 저장하지 않음
    _saveChannelFollowers(ch,next);
  };
  inp.focus();
  inp.select();
}
async function _saveChannelFollowers(ch,followers){
  const url=_getGasUrl();
  try{
    if(url){
      /* ⚠ 2026-09-15: 예전엔 updateChannelFollowers로 "그 채널의 가장 최근 공구건 행" 하나에만 썼다.
         그래서 표에서 고친 값이 나머지 행에는 반영되지 않아, 같은 채널인데 행마다 팔로워 수가
         다른 상태가 계속 쌓였다. 이 표의 편집은 애초에 채널 단위 행위이므로 전체 덮어쓰기가 맞고,
         모달과 달리 "이 건만" 같은 선택지가 없으므로 확인 팝업도 두지 않는다. */
      const j=await _gasWrite(url,'updateChannelFields',
        {channel:ch,mode:'overwrite',fields:{followers:followers==null?'':followers}});
      if(!j||j.success!==true||j.error)throw new Error((j&&j.error)||'updateChannelFields 응답에 success:true가 없습니다');
    }
    // 로컬 반영도 같은 규칙(채널명 완전 일치의 모든 건)으로
    _applyChannelFieldsLocally(ch,{followers:followers==null?'':followers},'overwrite',null);
    render(); // 등급 캐시가 무효화되며 팔로워등급·갭·교차 분석이 한 번에 재집계됨
    const stat=tierStatOf(ch);
    showToast(followers==null
      ?`${ch} 팔로워 수를 비웠습니다`
      :`${ch} 팔로워 ${formatMan(followers)} → 팔로워등급 ${stat?stat.followerTier:followerTierOf(followers)}`,{type:'success'});
    if(url)fetchLive();
  }catch(e){
    console.error('[팔로워 수 저장 실패]',e);
    renderDashChannelAnalytics();
    showToast('팔로워 수 저장 실패: '+_friendlySaveError(e.message),{type:'error'});
  }
}
