'use strict';
/* 제품·포맷·진행상태 배지 색과 품목별 실적 필터(filteredProd). */

// 실적 표 "포맷" 열(유튜브/릴스/게시물 등) 배지 색 — 값이 늘어나면 여기에만 추가하면 됨.
// 매핑에 없는 값(예상 못한 포맷)은 other로 폴백돼 깨지지 않고 중립색으로 표시됨.
const FORMAT_COLORS={
  '유튜브': {bg:'#FEE2E2',fg:'#B91C1C'}, // 빨강 계열
  '릴스':   {bg:'#DBEAFE',fg:'#1D4ED8'}, // 파랑(유튜브의 빨강과 확실히 구분)
  '게시물': {bg:'#E5E7EB',fg:'#374151'}, // 중립 블루그레이
  other:    {bg:'#EEF2FF',fg:'#4338CA'}
};
function formatColor(f){return FORMAT_COLORS[f]||FORMAT_COLORS.other;}
// 제품명 → 색상 팔레트 키(=PRODUCT_TAXONOMY의 세부 모델 key, 공백 제거 후 매칭)
// 2026-08-21: 시프트도 플렌더처럼 PRO를 구분하도록 수정(예전엔 시프트/시프트PRO가 구분 안 되고
// 전부 '시프트' 하나로 묶여서, 시프트 PRO가 출시돼도 별도 필터 옵션으로 못 나타났음).
function productColorKey(p){
  if(isFlender(p))return'플렌더'+flenderModel(p);
  if(isShift(p))return shiftModel(p)==='PRO'?'시프트PRO':'시프트';
  const np=normP(p);
  if(np==='더슬림')return'슬림';
  if(np.includes('에어드라이'))return'에어드라이';
  return'other';
}
function productColor(p){return PRODUCT_COLORS[productColorKey(p)]||PRODUCT_COLORS.other;}
// 제품명 → 제품 라인(대분류) — PRODUCT_LINE_OF(PRODUCT_TAXONOMY에서 파생)를 그대로 조회.
// 매핑에 없는 완전히 새로운 제품명(fine key가 'other')은 "기타"로 뭉개지 않고 제품명 자체를
// 라인으로 써서, 예상 못한 신제품이 들어와도 데이터가 조용히 숨지 않고 자기 이름으로 보임.
function productLineKey(p){
  const fine=productColorKey(p);
  if(fine==='other'){const raw=String(p||'').trim();return raw||'other';}
  return PRODUCT_LINE_OF[fine]||fine;
}

function filteredProd(src){
  return(src||DATA).filter(d=>{
    if(ST.prod==='all')return true;
    if(ST.prod==='플렌더'){
      if(!isFlender(d.product))return false;
      if(ST.model==='all')return true;
      return flenderModel(d.product)===ST.model;
    }
    if(ST.prod==='시프트'){
      if(!isShift(d.product))return false;
      if(ST.model==='all')return true;
      return shiftModel(d.product)===ST.model;
    }
    const np=normP(d.product);
    if(ST.prod==='슬림')    return np==='더슬림';
    if(ST.prod==='에어드라이')return np.includes('에어드라이');
    return true;
  });
}
function bdg(s){const m={완료:'bdg-d',진행중:'bdg-a',예정:'bdg-p'};return`<span class="bdg ${m[s]||'bdg-p'}">${s}</span>`;}
function brandPill(){return`<span class="bp bm">Minix</span>`;}
