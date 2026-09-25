'use strict';
/* 준비 중 페이지 틀 — 아직 내용이 없는 신규 페이지(0단계)의 공용 화면: 제목 + "준비 중" + 예정 내용 한 줄. */

// #page-<pageId>를 통째로 채운다. 실제 기능이 들어오면 그 페이지 파일이 이 호출을 자기 렌더로 바꾸면 된다.
function renderPlaceholderPage(pageId,info){
  const host=document.getElementById('page-'+pageId);
  if(!host)return;
  host.innerHTML=`<div class="card"><div class="card-hd">${_escHtml(info.title)}</div>`+
    `<div class="page-placeholder"><div class="ph-ready">준비 중</div><div class="ph-plan">예정: ${_escHtml(info.plan)}</div></div></div>`;
}
