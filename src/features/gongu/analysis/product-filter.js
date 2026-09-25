'use strict';
/* 공구 분석 — 전역 품목·등급 필터와 드롭다운 위치 계산. */

/* ── 전역 품목 필터 ──────────────────────────────────────────────────────────
   값 형식: 'all' | 'line:<라인키>'(제품 라인 전체) | 'fine:<모델키>'(세부 모델).
   옵션은 PRODUCT_TAXONOMY/PRODUCT_LINE_LABELS 순서를 따르되 실제 데이터에 있는 것만 노출하고,
   기간 필터로 좁혀도 선택지가 사라지지 않도록 후보는 항상 전체 DATA에서 뽑음
   (인플루언서 자동완성 후보와 같은 방식). */
function _dashProductMatch(d){
  const v=DASH.product;
  if(!v||v==='all')return true;
  if(v.indexOf('fine:')===0)return productColorKey(d.product)===v.slice(5);
  if(v.indexOf('line:')===0)return productLineKey(d.product)===v.slice(5);
  return true;
}
// 선택된 품목이 속한 제품 라인(히트맵 열 강조용). 미선택이면 null.
function _dashSelectedProductLine(){
  const v=DASH.product;
  if(!v||v==='all')return null;
  if(v.indexOf('line:')===0)return v.slice(5);
  const fine=v.slice(5);
  return PRODUCT_LINE_OF[fine]||fine;
}
// 데이터에 존재하는 라인 → 그 라인의 세부 모델 집합
function _dashProductTree(){
  const tree=new Map();
  DATA.filter(d=>d.start).forEach(d=>{
    const line=productLineKey(d.product),fine=productColorKey(d.product);
    if(!tree.has(line))tree.set(line,new Set());
    if(fine!=='other')tree.get(line).add(fine);
  });
  return tree;
}
function _dashProductLabel(value){
  const v=value===undefined?DASH.product:value;
  if(!v||v==='all')return'';
  if(v.indexOf('fine:')===0){const k=v.slice(5);return PRODUCT_GROUP_LABELS[k]||k;}
  const k=v.slice(5),label=PRODUCT_LINE_LABELS[k]||k;
  const fines=_dashProductTree().get(k);
  return(fines&&fines.size>1)?`${label}(전체)`:label; // 모델이 여러 개면 "(전체)"를 붙여 구분
}
function _renderDashProductOptions(){
  const el=document.getElementById('dashProductFilter');
  if(!el)return;
  const tree=_dashProductTree();
  const known=Object.keys(PRODUCT_LINE_LABELS).filter(k=>k!=='other'&&tree.has(k));
  const unknown=[...tree.keys()].filter(k=>!(k in PRODUCT_LINE_LABELS)).sort();
  let html='<option value="all">전체</option>';
  known.concat(unknown).forEach(line=>{
    const label=PRODUCT_LINE_LABELS[line]||line;
    // 세부 모델은 PRODUCT_GROUP_LABELS(=PRODUCT_TAXONOMY) 순서로 고정
    const fines=Object.keys(PRODUCT_GROUP_LABELS).filter(k=>tree.get(line).has(k));
    if(fines.length>1){
      html+=`<optgroup label="${_escAttr(label)}">`+
        `<option value="line:${_escAttr(line)}">${label}(전체)</option>`+
        fines.map(f=>`<option value="fine:${_escAttr(f)}">${PRODUCT_GROUP_LABELS[f]}</option>`).join('')+
        '</optgroup>';
    }else{
      html+=`<option value="line:${_escAttr(line)}">${label}</option>`;
    }
  });
  el.innerHTML=html;
  // 데이터가 바뀌어 선택지가 사라졌으면 전체로 되돌림(빈 화면으로 굳는 것 방지)
  if(DASH.product!=='all'&&!el.querySelector(`option[value="${DASH.product.replace(/"/g,'')}"]`))DASH.product='all';
  el.value=DASH.product;
}
function _onDashProductFilterChange(){
  DASH.product=document.getElementById('dashProductFilter').value;
  dashPSave();
  renderDashboard();
}

// 등급 전역 필터 2종(매출/팔로워) — 기간/인플루언서 필터, 그리고 서로와도 AND로 조합됨
// (판정은 dashPeriodMatch 한 곳에서)
function _onDashTierFilterChange(){
  DASH.revTier=document.getElementById('dashTierFilter').value;
  renderDashboard();
}
function _onDashFollowerTierFilterChange(){
  DASH.followerTier=document.getElementById('dashFollowerTierFilter').value;
  renderDashboard();
}
function _renderDashInfluencerChip(){
  const chip=document.getElementById('dashInfluencerChip');
  if(DASH.channel){
    chip.style.display='inline-flex';
    chip.innerHTML=`인플루언서: ${DASH.channel} <button type="button" onclick="_clearInfSearch('dash')" title="필터 해제">×</button>`;
  } else {
    chip.style.display='none';
    chip.innerHTML='';
  }
}

// 버튼 좌표(getBoundingClientRect) 기준으로 패널 좌표를 계산. 하단 공간이 부족하면 위로 뒤집힘.
function _positionYmDdPop(ddEl){
  const btn=ddEl.querySelector('.ym-dd-btn');
  const pop=document.getElementById(YM_DD_POP_MAP[ddEl.id]);
  if(!btn||!pop)return;
  const btnRect=btn.getBoundingClientRect();
  const margin=6,vw=window.innerWidth,vh=window.innerHeight;
  const popH=pop.offsetHeight,popW=pop.offsetWidth;
  let top=btnRect.bottom+margin;
  if(top+popH>vh-8&&btnRect.top-margin-popH>=8)top=btnRect.top-margin-popH; // 아래 공간이 부족하면 위로 뒤집음
  top=Math.max(8,Math.min(top,vh-8-popH));
  let left=btnRect.right-popW;
  left=Math.max(8,Math.min(left,vw-8-popW));
  pop.style.top=top+'px';
  pop.style.left=left+'px';
  if(window.console&&console.debug)console.debug('[ym-dd] 위치 계산',{ddId:ddEl.id,itemCount:pop.querySelectorAll('.ym-chk').length,popH,popW,top,left});
}
function _closeAllYmDd(){
  document.querySelectorAll('.ym-dd.open').forEach(x=>x.classList.remove('open'));
  document.querySelectorAll('.ym-dd-pop.open').forEach(x=>x.classList.remove('open'));
}
function toggleYmDd(ddId,ev){
  ev.stopPropagation();
  const el=document.getElementById(ddId);
  const pop=document.getElementById(YM_DD_POP_MAP[ddId]);
  const willOpen=!el.classList.contains('open');
  _closeAllYmDd();
  if(willOpen){
    el.classList.add('open');
    if(pop)pop.classList.add('open');
    _positionYmDdPop(el);
  }
}
function _repositionOpenYmDd(){
  const openDd=document.querySelector('.ym-dd.open');
  if(openDd)_positionYmDdPop(openDd);
  Object.keys(INF_SEARCH).forEach(scope=>{
    const infPop=document.getElementById(INF_SEARCH[scope].pop);
    if(infPop&&infPop.classList.contains('open'))_positionInfSearchPop(scope);
  });
}
window.addEventListener('resize',_repositionOpenYmDd);
window.addEventListener('scroll',_repositionOpenYmDd,true);
document.addEventListener('click',ev=>{
  if(ev.target.closest('.ym-dd-pop'))return; // 패널 내부(체크박스/전체 선택·해제 버튼) 클릭은 닫지 않음
  // 입력창 클릭 자체는 focus로 이미 열었으니 바로 닫지 않음(두 scope 모두)
  if(Object.keys(INF_SEARCH).some(sc=>ev.target.id===INF_SEARCH[sc].input))return;
  _closeAllYmDd();
});
