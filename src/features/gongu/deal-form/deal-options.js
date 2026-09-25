'use strict';
/* 공구건 폼 공용 옵션 — 사은품·오픈시간·선착순·적립금, 구성 문구, 품목군/모델 드롭다운. */

/* ── 사은품/오픈시간/선착순/적립금 공용 상수 + 구성 자동생성 (공구건 모달 드롭다운 개편, 2026-08-18) ──
   apps-script.js의 GIFT_ITEMS/QTY_STANDARD_OPTIONS/OPEN_TIME_OPTIONS/POINTS_OPTIONS와 값이 같아야 함
   (그쪽은 마이그레이션 매칭용, 여긴 드롭다운 렌더용). */
const GIFT_ITEMS=['하드필터','하드락필터','하드락필터(mini)','저온촉매 탈취필터','락앤락 김치통 2.6L 2P','푸드컨테이너(단종)','실링 컨테이너 2L','실링 컨테이너 3L','탈취제','수동 빙수기',
  // 더 슬림용(2026-09-17 추가) — 사은품 1·2·3 드롭다운은 전부 _giftItemOptionsHtml 하나를 거치므로 여기만 고치면 됨
  '더 슬림 먼지봉투(3개입)','더 슬림 헤파필터','더 슬림 스테이션 헤파필터','더 슬림 배터리','더 슬림 브러쉬롤러'];
const QTY_STANDARD_OPTIONS=(()=>{const o=[];for(let q=50;q<=500;q+=50)o.push(q);for(let q=600;q<=3000;q+=100)o.push(q);return o;})();
const QTY_UNSPECIFIED_LABEL='전원증정';
const QTY_TIMEDEAL_LABEL='타임딜'; // 선착순 수량 전용 특수 옵션(2026-08-18) — 사은품 수량에는 추가하지 않음
const OPEN_TIME_OPTIONS=(()=>{const o=[];for(let h=0;h<=23;h++)o.push(String(h).padStart(2,'0')+':00');return o;})();
const POINTS_OPTIONS=['NPAY 1만원','NPAY 2만원','NPAY 3만원','NPAY 4만원','NPAY 5만원'];

function _giftItemOptionsHtml(){return'<option value="">없음</option>'+GIFT_ITEMS.map(it=>`<option value="${it}">${it}</option>`).join('');}
function _giftQtyOptionsHtml(){return'<option value="">없음</option><option value="'+QTY_UNSPECIFIED_LABEL+'">'+QTY_UNSPECIFIED_LABEL+'</option>'+QTY_STANDARD_OPTIONS.map(q=>`<option value="${q}">${q}</option>`).join('');}
// 선착순 수량 전용 — 사은품 수량과 같은 옵션에 "타임딜"만 추가(전원증정 바로 옆에 배치)
function _firstComeQtyOptionsHtml(){return'<option value="">없음</option><option value="'+QTY_UNSPECIFIED_LABEL+'">'+QTY_UNSPECIFIED_LABEL+'</option><option value="'+QTY_TIMEDEAL_LABEL+'">'+QTY_TIMEDEAL_LABEL+'</option>'+QTY_STANDARD_OPTIONS.map(q=>`<option value="${q}">${q}</option>`).join('');}
function _openTimeOptionsHtml(){return'<option value="">없음</option>'+OPEN_TIME_OPTIONS.map(t=>`<option value="${t}">${t}</option>`).join('');}
// 저장된 오픈시간 값을 드롭다운 option value에 맞춰 보정(2026-08-27) — 드롭다운을 00:00~23:00으로
// 정리하면서 24:00 옵션을 없앴는데, 예전에 "24:00"으로 저장된 건이 남아 있으면 select.value 대입이
// 조용히 실패해 "없음"으로 보임. 의미가 같은 00:00으로 바꿔 매칭시킴(백엔드도 같이 정규화함).
function _normOpenTimeValue(v){return String(v||'')==='24:00'?'00:00':(v||'');}
function _pointsOptionsHtml(){return'<option value="">없음</option>'+POINTS_OPTIONS.map(p=>`<option value="${p}">${p}</option>`).join('');}

// 사은품/선착순 한 줄을 "품목 수량개" 문구로 — 수량이 숫자면 "개"를 붙이고 "전원증정"이면 그대로
// 붙임(개를 붙이면 어색함). 품목이 없으면 null(구성 조합에서 통째로 제외).
function _giftPartLabel(item,qty){
  if(!item)return null;
  if(!qty)return item;
  return item+' '+qty+(/^\d+$/.test(String(qty))?'개':'');
}
// 사은품(최대 3개)+선착순+적립금+비고를 "본품 + ..." 형태로 조합 — 등록/수정 모달이 공유해서 씀.
// 없음/미선택 항목은 자동으로 조합에서 빠짐.
function _buildCompositionString({gifts,firstComeItem,firstComeQty,points,note}){
  const parts=['본품'];
  (gifts||[]).forEach(g=>{const label=_giftPartLabel(g.item,g.qty);if(label)parts.push(label);});
  const fcLabel=_giftPartLabel(firstComeItem,firstComeQty);
  if(fcLabel)parts.push('[선착순] '+fcLabel);
  if(points)parts.push(points);
  if(note&&note.trim())parts.push('('+note.trim()+')');
  return parts.join(' + ');
}

/* ── 새 공구건 폼 ── */
// 품목군별 제품 드롭다운 여부 — 신규 등록 모달(fLine/fModel)과 수정 모달(mLine/mModel) 둘 다
// 이 상수 하나만 참조함(예전엔 두 모달이 각각 다른 상수를 써서 한쪽만 고치면 어긋나기 쉬웠음 —
// 더시프트 PRO 드롭다운이 신규 등록에만 있고 수정 모달엔 없던 게 그 사례).
const LINE_HAS_MODELS={'더플렌더':true,'더시프트':true};
// 품목군별 제품 드롭다운 옵션(내부 표기, 공백 없음) — 값 표기는 대시보드 품목별 실적의 모델 매칭
// 규칙(flenderModel/shiftModel)과 정확히 일치해야 함. 시트에 실제로 저장되는 표기(공백 포함)는
// 이 값이 아니라 PRODUCT_SHEET_NAME 매핑을 거친 결과이니, 옵션을 추가할 땐 반드시 그 매핑에도
// 같이 추가할 것(안 하면 toSheetProductName이 콘솔 경고를 남김).
const LINE_MODEL_OPTIONS={
  '더플렌더':['더플렌더PRO','더플렌더MAX','더플렌더mini','더플렌더NEXT'],
  '더시프트':['더시프트','더시프트PRO']
};
// 품목군별 제품 드롭다운(fModel/mModel) 옵션을 LINE_MODEL_OPTIONS 기준으로 다시 그림 — 신규
// 등록/수정 두 모달이 이 함수 하나만 거치므로 옵션 목록이 절대 어긋나지 않음.
// 2026-08-21: 옵션의 value는 그대로 내부 표기(공백 없음, toSheetProductName/저장 로직이 그대로
// 참조)로 두고, 화면에 보이는 텍스트만 시트 정식 표기(PRODUCT_SHEET_NAME)로 바꿈 — fLine 셀렉트가
// 이미 쓰던 "값=내부표기, 표시=정식표기" 패턴을 모델 셀렉트에도 그대로 맞춘 것.
function _rebuildModelOptions(selectEl,line){
  const opts=LINE_MODEL_OPTIONS[line]||[];
  selectEl.innerHTML='<option value="">선택</option>'+opts.map(o=>`<option value="${o}">${PRODUCT_SHEET_NAME[o]||o}</option>`).join('');
}

/* 사이드바 '품목별 실적' 메뉴 + 등록/수정 모달의 품목군 드롭다운 — 둘 다 PRODUCT_LINES에서 생성.
   예전엔 HTML에 품목을 직접 써넣어서 품목군 하나를 추가할 때마다 세 군데를 따로 고쳐야 했고,
   실제로 사이드바에는 없는데 모달 드롭다운에만 있는 품목(더 슬림)이 생겨 있었다.
   이제 순서·라벨·아이콘·해시 슬러그가 전부 그 배열 하나를 따라감.
   ⚠ 이 호출은 _bootstrap(파일 맨 아래)보다 먼저 실행돼야 한다 — _routeFromHash가 사이드바에서
     #product-* 에 해당하는 항목을 찾기 때문. 지금처럼 최상위에서 부르면 순서가 보장됨. */
function _renderProductNav(){
  const host=document.getElementById('sbProductItems');
  if(!host)return;
  host.innerHTML=PRODUCT_LINES.map(l=>
    `<div class="sb-item" data-prod="${_escAttr(l.st)}" onclick="navSales(this,'${_escAttr(l.st)}')">`+
    `<span class="sb-ic">${_escHtml(l.icon)}</span><span class="sb-label">${_escHtml(l.label)}</span></div>`
  ).join('');
}
function _renderLineOptions(){
  const html='<option value="">선택</option>'+
    PRODUCT_LINES.map(l=>`<option value="${_escAttr(l.key)}">${_escHtml(l.label)}</option>`).join('');
  ['mLine','fLine'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML=html;});
}
_renderProductNav();
_renderLineOptions();

// 오픈시간/선착순 품목·수량/적립금 드롭다운(모달당 1개씩 고정, 사은품처럼 재렌더되지 않음) —
// 페이지 로드 시 한 번만 옵션을 채움
['mOpenTime','fOpenTime'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML=_openTimeOptionsHtml();});
['mFirstComeItem','fFirstComeItem'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML=_giftItemOptionsHtml();});
['mFirstComeQty','fFirstComeQty'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML=_firstComeQtyOptionsHtml();});
['mPoints','fPoints'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML=_pointsOptionsHtml();});
// 등급 '수동 지정' 드롭다운 + 기준표 툴팁 — 기준 문구는 TIER_RULES에서 생성해 상수와 어긋나지 않게 함
['mTier','fTier'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML=_tierManualOptionsHtml();});
/* 모달·등록 폼의 등급 관련 ⓘ 툴팁을 한 번에 건다. 채널별 성과 표 헤더의 ⓘ와 **같은 함수**에서
   문구를 받아오므로 표와 모달의 설명이 갈라질 수 없다.
   함수로 묶어둔 이유: 붙이는 자리가 세 종류(매출/팔로워/둘 다)로 늘어나 한 줄씩 흩어두면
   새 ⓘ를 추가할 때 빠뜨리기 쉽고, 이 상태 그대로는 테스트에서 호출해 볼 수도 없었다. */
function _applyTierHelpTitles(){
  const set=(ids,text)=>ids.forEach(id=>{const el=document.getElementById(id);if(el)el.title=text;});
  set(['mTierHelp','fTierHelp','mTier','fTier'],tierCriteriaText());
  set(['mFollowerHelp','fFollowerHelp','mFollowers','fFollowers'],followerCriteriaText());
  // '등급 상태' 박스는 매출등급과 팔로워등급을 함께 보여주므로 두 기준표를 이어 붙여 띄운다
  set(['mTierStateHelp','fTierStateHelp'],tierAndFollowerCriteriaText());
}
_applyTierHelpTitles();
// 등급 전역 필터 옵션(전체 + 4등급) — 미분류는 선택지로 두지 않음(등급별 집계 대상이 아니므로)
// 신규 인플루언서만 골라 보기 위해 '미산정'도 선택지에 둠
// 등급 필터 2종의 옵션 — 매출축은 '미산정', 팔로워축은 '미입력'이 마지막 항목으로 붙음
(()=>{
  const fill=(id,last)=>{const el=document.getElementById(id);
    if(el)el.innerHTML='<option value="all">전체</option>'+TIER_OPTIONS.concat([last]).map(t=>`<option value="${t}">${t}</option>`).join('');};
  fill('dashTierFilter',TIER_UNRATED);
  fill('dashFollowerTierFilter',TIER_FOLLOWER_UNSET);
})();
