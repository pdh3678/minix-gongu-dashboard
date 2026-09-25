'use strict';
/* 제품명 → 품목/모델 판별 규칙(더 플렌더·더 시프트 모델 매칭). */

// 제품명 정규화: 공백 제거·소문자 (필터 매칭용)
const normP=s=>String(s||'').replace(/\s/g,'').toLowerCase();

// 더플렌더 모델 정규화 목록
const FLENDER_NORM={
  PRO: ['더플렌더pro','더플렌더 pro'],
  MAX: ['더플렌더max','더플렌더 max'],
  NEXT:['더플렌더next','더플렌더 next'],
  mini:['더플렌더mini','더플렌더 mini','더플렌더']
};
function isFlender(p){
  const np=normP(p);
  return np.startsWith('더플렌더')||np.startsWith('더 플렌더');
}
function flenderModel(p){
  const np=normP(p);
  if(FLENDER_NORM.PRO.some(k=>np===k||np.endsWith('pro'))) return 'PRO';
  if(FLENDER_NORM.MAX.some(k=>np===k||np.endsWith('max'))) return 'MAX';
  if(FLENDER_NORM.NEXT.some(k=>np===k||np.endsWith('next'))) return 'NEXT';
  return 'mini';
}

// 더시프트: 접미사 없으면 기본형, 'PRO'로 끝나면 PRO 모델(더플렌더와 동일한 정규화 매칭 방식)
function isShift(p){
  return normP(p).startsWith('더시프트');
}
function shiftModel(p){
  return normP(p).endsWith('pro')?'PRO':'기본';
}
