'use strict';
/* 사이드바 — 접기, 모바일 열기, 활성 항목 해제. */

/* Sidebar */
function toggleSidebar(){document.getElementById('appShell').classList.toggle('sb-collapsed');}
function openMobileSidebar(){document.getElementById('appShell').classList.add('sb-mobile-open');}
function closeMobileSidebar(){document.getElementById('appShell').classList.remove('sb-mobile-open');}
function toggleSec(btn){btn.parentElement.classList.toggle('closed');}

function _sbClearActive(){
  document.querySelectorAll('.sb-item-solo,.sb-item[data-prod],.sb-item[data-page]').forEach(x=>x.classList.remove('active'));
}
