'use strict';
/* PageHeaderActions — 페이지 우측 액션 버튼 영역 공용 컴포넌트. */

/* 페이지마다 "제목·탭 줄 오른쪽 끝의 버튼 묶음"을 같은 모양으로 만든다(2026-09-25).
   0단계에선 '새 공구건 등록'(품목별 실적·공구 캘린더)이 쓰고, 이후 다른 페이지도 같은 함수로 붙인다.
   actions: [{label, onclick, kind, title}]
     onclick  인라인 핸들러 문자열 — 이 앱의 다른 버튼과 같은 방식(전역 함수 호출)
     kind     'primary'(기본) | 'secondary'
     title    마우스 오버 설명(선택)
   자리는 마크업의 빈 요소가 정한다(renderPageHeaderActions가 거기에 버튼과 .page-actions를 붙임).
   .page-actions는 margin-left:auto라, 부모가 flex 줄(.page-head-row)이면 항상 오른쪽 끝에 붙는다. */
function PageHeaderActions(actions){
  return (actions||[]).map(a=>
    `<button type="button" class="${a.kind==='secondary'?'btn-cancel':'btn-primary'} page-action-btn"`+
    ` onclick="${_escAttr(a.onclick)}"${a.title?` title="${_escAttr(a.title)}"`:''}>${_escHtml(a.label)}</button>`
  ).join('');
}
function renderPageHeaderActions(hostId,actions){
  const host=document.getElementById(hostId);
  if(!host)return;
  host.classList.add('page-actions');
  host.innerHTML=PageHeaderActions(actions);
}
