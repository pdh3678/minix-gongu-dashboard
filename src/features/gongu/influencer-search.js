'use strict';
/* 인플루언서 검색(자동완성) — 공구 분석·품목별 실적 공용. */

// ── 인플루언서(채널명) 전역 필터 — 자동완성 드롭다운 ──
// 후보 목록은 절대 하드코딩하지 않고 항상 "현재 로드된 DATA"에서 매번 다시 뽑음(중복 제거+가나다순).
// 그래서 새 인플루언서의 공구가 등록/조회되어 DATA에 채널명이 추가되기만 하면 코드 수정 없이
// 자동완성 후보에 바로 나타남. 기간 필터와는 별개로 "현재 로드된 전체 데이터" 기준으로 후보를
// 보여줌(기간을 좁혀도 다른 기간의 채널을 미리 선택해둘 수 있게).
function _dashInfluencerAvailable(){
  return[...new Set(DATA.filter(d=>d.start).map(d=>(d.ch||d.influencer||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
}
function _dashInfluencerNorm(s){return String(s||'').toLowerCase().replace(/\s+/g,'');} // 대소문자·공백 무시 매칭용
/* 화면 두 곳(대시보드 상단 필터 / 품목별 실적 기간 필터)이 이 컴포넌트 하나를 공유한다.
   scope마다 다른 건 입력창·팝오버의 id와 "고른 채널을 어디에 담고 무엇을 다시 그릴지"뿐이라
   그 둘만 아래 레지스트리에 두고, 나머지(후보 추출·부분일치 매칭·팝오버 렌더·위치 계산·
   Enter/Esc 처리)는 전부 공용 함수가 담당한다. 새 화면에 검색을 붙일 땐 여기 한 항목만 추가.
   후보 목록은 두 scope 모두 _dashInfluencerAvailable() — 즉 "현재 로드된 전체 DATA" 기준이다
   (품목/기간으로 좁혀도 선택지가 사라지지 않게 하려는 기존 설계를 그대로 따름). */
const INF_SEARCH={
  dash:{
    input:'dashInfluencerInput',pop:'dashInfluencerPop',
    set(ch){DASH.channel=ch;_renderDashInfluencerChip();renderDashboard();}
  },
  sales:{
    input:'salesInfluencerInput',pop:'salesInfluencerPop',
    // 칩은 renderYMFilterBar가 기간 칩과 같은 줄에 그리고, KPI(renderSalesKpi)와 실적 상세
    // 표는 salesYMMatch를 다시 태우며 갱신됨 — 셋 다 renderTbl 안에 있어 이 한 번이면 충분
    set(ch){SALES_YM.channel=ch;renderTbl();}
  }
};
function _onInfSearchInput(scope,val){
  const q=_dashInfluencerNorm(val);
  const all=_dashInfluencerAvailable();
  const matches=q?all.filter(ch=>_dashInfluencerNorm(ch).includes(q)):all;
  _renderInfSearchPop(scope,matches.slice(0,30));
}
function _onInfSearchFocus(scope){
  _onInfSearchInput(scope,document.getElementById(INF_SEARCH[scope].input).value);
}
function _onInfSearchKeydown(scope,ev){
  const popId=INF_SEARCH[scope].pop;
  if(ev.key==='Escape'){document.getElementById(popId).classList.remove('open');return;}
  if(ev.key!=='Enter')return;
  ev.preventDefault();
  const first=document.querySelector('#'+popId+' .dash-inf-opt[data-ch]');
  if(first)_selectInfSearch(scope,first.dataset.ch);
}
function _renderInfSearchPop(scope,list){
  const pop=document.getElementById(INF_SEARCH[scope].pop);
  pop.innerHTML=list.length
    ?list.map(ch=>`<div class="dash-inf-opt" data-ch="${_escAttr(ch)}" onclick="_selectInfSearch('${scope}',this.dataset.ch)">${ch}</div>`).join('')
    :'<div class="dash-inf-opt-empty">일치하는 채널이 없습니다</div>';
  pop.classList.add('open');
  _positionInfSearchPop(scope);
}
function _positionInfSearchPop(scope){
  const input=document.getElementById(INF_SEARCH[scope].input);
  const pop=document.getElementById(INF_SEARCH[scope].pop);
  const r=input.getBoundingClientRect();
  const margin=4,vw=window.innerWidth,vh=window.innerHeight;
  pop.style.minWidth=r.width+'px';
  const popH=pop.offsetHeight,popW=pop.offsetWidth;
  let top=r.bottom+margin;
  if(top+popH>vh-8&&r.top-margin-popH>=8)top=r.top-margin-popH;
  top=Math.max(8,Math.min(top,vh-8-popH));
  let left=Math.max(8,Math.min(r.left,vw-8-popW));
  pop.style.top=top+'px';
  pop.style.left=left+'px';
}
function _selectInfSearch(scope,ch){
  document.getElementById(INF_SEARCH[scope].input).value='';
  document.getElementById(INF_SEARCH[scope].pop).classList.remove('open');
  INF_SEARCH[scope].set(ch);
}
function _clearInfSearch(scope){INF_SEARCH[scope].set(null);}
