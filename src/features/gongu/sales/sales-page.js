'use strict';
/* 품목별 실적 페이지 — 모델 탭과 페이지 진입(navSales). */

// 모델 탭 줄 오른쪽 끝 액션 — 네 품목 페이지가 같은 #page-sales를 쓰므로 한 번만 붙이고, 무엇을 미리
// 채울지는 누르는 순간의 ST(품목·모델 탭)로 정한다.
renderPageHeaderActions('salesPageActions',[{label:'＋ 새 공구건 등록',onclick:'_openDealFormFromSales()'}]);
/* 품목별 실적에서 연 등록 모달 — 보고 있던 품목군을, 모델 탭이 골라져 있으면 그 모델까지 미리 고른다.
   모두 기본값일 뿐이라 모달에서 품목군·제품을 바꾸거나 다른 품목의 상품코드를 추가해도 된다. */
function _openDealFormFromSales(){
  const line=PRODUCT_LINES.find(l=>l.st===ST.prod);
  const lineKey=line?line.key:'';
  openDealForm({line:lineKey,model:_dealFormModelForTab(lineKey,ST.model)});
}
// 모델 탭 값(PRO/MAX/기본…) → 등록 폼 제품 드롭다운 value(더플렌더PRO…). 탭이 '전체'거나 없으면 ''.
// 둘 다 PRODUCT_CATALOG의 같은 모델 항목(tab/option)에서 오므로 따로 대응표를 두지 않는다.
function _dealFormModelForTab(lineKey,tab){
  if(!lineKey||!tab||tab==='all')return'';
  const line=PRODUCT_CATALOG.find(l=>l.key===lineKey);
  const m=line&&line.models.find(x=>x.gongu&&x.tab===tab&&x.option);
  return m?m.option:'';
}

// 모델 탭 구성(PRODUCT_MODEL_TABS)은 PRODUCT_CATALOG에서 파생 — 탭이 없는 제품(슬림/에어드라이)은 subTabs가 숨겨짐
function renderSubTabs(prod){
  const subTabs=document.getElementById('subTabs');
  const cfg=PRODUCT_MODEL_TABS[prod];
  if(!cfg){subTabs.classList.remove('open');subTabs.innerHTML='';return;}
  subTabs.classList.add('open');
  subTabs.innerHTML=`<span style="font-size:11px;color:var(--text-3);margin-right:6px;font-weight:600">${cfg.label}</span>`+
    cfg.tabs.map(t=>`<button class="stab${t.m==='all'?' sam':''}" data-m="${t.m}">${t.lb}</button>`).join('');
  subTabs.querySelectorAll('.stab').forEach(stab=>{
    stab.addEventListener('click',()=>{
      subTabs.querySelectorAll('.stab').forEach(s=>s.classList.remove('sam'));
      stab.classList.add('sam');
      ST.model=stab.dataset.m;
      render();
    });
  });
}

// 브랜드별 실적 페이지로 이동 + 제품 필터 적용
function navSales(el,prod){
  navPage('sales',el);
  ST.prod=prod;
  ST.model='all';
  // 인플루언서 검색은 페이지를 옮길 때마다 초기화 — 모델 탭·연월 체크박스 변경은 render()/
  // renderTbl()만 거쳐 이 함수를 타지 않으므로 같은 페이지 안에서는 그대로 유지된다.
  SALES_YM.channel=null;
  const infInput=document.getElementById('salesInfluencerInput');
  if(infInput)infInput.value='';
  renderSubTabs(prod);
  render();
  /* ⚠ 반드시 'product-' 접두어를 붙일 것. 예전엔 슬러그만 써서 주소창에 #더플렌더가 찍혔는데,
     _routeFromHash는 'product-'로 시작하는 해시만 품목 페이지로 보내기 때문에 그 주소를
     새로고침하거나 공유하면 조용히 대시보드로 떨어졌다(쓰는 쪽과 읽는 쪽이 어긋나 있었음).
     모달을 닫을 때 되돌아가는 _currentPageHash도 같은 값이어야 해서 함께 맞춘다. */
  const hashKey=ST_PRODUCT_TO_HASH[prod];
  if(hashKey){const h='product-'+hashKey;_currentPageHash=h;_setHash(h);}
}
