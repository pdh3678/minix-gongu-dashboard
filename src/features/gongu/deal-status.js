'use strict';
/* 공구건 진행상태 판정(KST 기준 예정/진행중/완료). */

// 오늘 날짜를 KST(Asia/Seoul) 자정 기준으로 구함 — 브라우저가 다른 시간대에 있어도(예: 해외 출장 중
// 노트북) 항상 한국 기준 "오늘"로 진행상태가 판정되게 함. new Date()를 그대로 쓰면 브라우저 로컬
// 시간대를 따라가 버리므로, KST 날짜 문자열(YYYY-MM-DD)을 먼저 뽑아 그걸로 자정 Date를 다시 만듦.
function _kstTodayDate(){
  const ymd=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  return new Date(ymd+'T00:00:00');
}
function _calcStatus(start,end){
  const today=_kstTodayDate();
  const sd=new Date(start+'T00:00:00'),ed=new Date((end||start)+'T00:00:00');
  if(ed<today)return'완료';
  if(sd<=today)return'진행중';
  return'예정';
}

// 화면에 표시할 진행상태 — 시트의 진행상태 열(d.status) 대신 항상 시작일/종료일 기준 자동판정을
// 우선함(리빙천재 7.27~7.29 건이 오늘인데 시트가 "예정"으로 남아있어 실제와 어긋났던 문제). 시트 값은
// 무시하지 않고 보조로 씀: 값이 다르면 콘솔에 요약 경고 1줄(시트 정리용 참고). 단, 시트 값이 알려진
// 3종(예정/진행중/완료)이 아닌 값이면(향후 "중단"/"취소"처럼 날짜로 판정 불가한 특수 상태가 생길
// 경우 대비) 자동판정을 덮어쓰지 않고 시트 표기를 그대로 우선 표시함.
// ※ 2026-07-28 조사 기준으로는 시트/서버(apps-script.js) 어디에도 이런 특수값이 실제 쓰인 적이
// 없음(서버가 못 알아보는 값이 오면 이미 날짜 기준으로 강제 재분류해버려 프론트까지 전달 안 됨) —
// 그래도 나중에 그런 값을 쓰기 시작하면 이 분기가 그대로 대응하도록 남겨둠.
const _KNOWN_STATUS=['예정','진행중','완료'];
function _displayStatus(d){
  const dateStatus=_calcStatus(d.start,d.end);
  const sheetStatus=d.status||'';
  if(!sheetStatus||sheetStatus===dateStatus)return dateStatus;
  if(!_KNOWN_STATUS.includes(sheetStatus)){
    console.warn(`[진행상태] ${d.product||'?'}·${d.ch||'?'}(${d.start}~${d.end}) — 시트 값 "${sheetStatus}"은(는) 알려진 상태(예정/진행중/완료)가 아니라 특수 상태로 보고 그대로 표시함(참고: 날짜기준=${dateStatus})`);
    return sheetStatus;
  }
  console.warn(`[진행상태 불일치] ${d.product||'?'}·${d.ch||'?'}(${d.start}~${d.end}) — 시트="${sheetStatus}" / 날짜기준="${dateStatus}" → 화면엔 날짜기준으로 표시(시트 값은 정리 참고용)`);
  return dateStatus;
}
// 매출 집계 포함 기준(2026-08-24 통일) — 완료+진행중만 포함, 예정은 제외. 대시보드의 총매출 KPI·
// 매출 추이 차트·채널/제품군/플랫폼 분석·시즌성·산점도가 전부 이 기준 하나를 공유함.
function _isRevStatus(d){const s=_displayStatus(d);return s==='완료'||s==='진행중';}
