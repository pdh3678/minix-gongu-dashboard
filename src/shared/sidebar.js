'use strict';
/* 사이드바 — 접기, 모바일 열기, 그룹 접기 상태 저장, 활성 항목 해제·노출, 메뉴 배지. */

/* Sidebar */
function toggleSidebar(){document.getElementById('appShell').classList.toggle('sb-collapsed');}
function openMobileSidebar(){document.getElementById('appShell').classList.add('sb-mobile-open');}
function closeMobileSidebar(){document.getElementById('appShell').classList.remove('sb-mobile-open');}

/* ── 그룹 접기/펼치기 상태 (2026-09-25) ──────────────────────────────────────
   접어 둔 그룹의 data-sec 키 목록을 localStorage에 둔다(없으면 전부 펼침 — 새로 생기는 그룹도
   기본으로 펼쳐져 보이게 "펼친 목록"이 아니라 "접은 목록"을 저장). 사용자가 직접 누른 것만 저장한다. */
const SB_CLOSED_LS_KEY='gp_sb_closed';
function _sbLoadClosed(){
  try{const v=JSON.parse(localStorage.getItem(SB_CLOSED_LS_KEY)||'[]');return new Set(Array.isArray(v)?v:[]);}
  catch(e){return new Set();}
}
function toggleSec(btn){
  const sec=btn.parentElement;
  sec.classList.toggle('closed');
  const key=sec.dataset&&sec.dataset.sec;
  if(!key)return;
  const closed=_sbLoadClosed();
  if(sec.classList.contains('closed'))closed.add(key);else closed.delete(key);
  try{localStorage.setItem(SB_CLOSED_LS_KEY,JSON.stringify([...closed]));}catch(e){}
}
function _applySbClosedState(){
  const closed=_sbLoadClosed();
  document.querySelectorAll('.sb-sec[data-sec]').forEach(sec=>sec.classList.toggle('closed',closed.has(sec.dataset.sec)));
}
_applySbClosedState();

function _sbClearActive(){
  document.querySelectorAll('.sb-item-solo,.sb-item[data-prod],.sb-item[data-page]').forEach(x=>x.classList.remove('active'));
}
/* 접힌 그룹 안의 페이지로 들어오면(해시 직접 접속·새로고침 등) 강조가 가려지므로, 그 항목을 감싼
   그룹만 화면에서 펼친다. 저장된 접기 상태는 건드리지 않는다 — 사용자가 누른 게 아니므로.
   조상을 따라 올라가는 횟수에 상한을 두는 건 테스트 DOM 스텁(부모가 끝없이 이어짐) 때문. */
function _sbRevealActive(el){
  let sec=el&&el.closest?el.closest('.sb-sec'):null;
  for(let i=0;sec&&i<4;i++){
    sec.classList.remove('closed');
    const up=sec.parentElement;
    sec=up&&up.closest?up.closest('.sb-sec'):null;
  }
}

/* 메뉴 옆 건수 배지 — 0건(또는 null)이면 숨긴다 */
function _setSbBadge(id,count){
  const el=document.getElementById(id);
  if(!el)return;
  el.textContent=count?String(count):'';
  el.style.display=count?'':'none';
}
