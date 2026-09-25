'use strict';
/* 저장 검증 실패 표시(필드 빨간 테두리 + 저장 버튼 옆 요약). */

/* ── 저장 검증 실패를 화면에 남기기 (2026-09-15) ────────────────────────────
   예전에는 alert() 하나 띄우고 조용히 return 했다. 알림을 닫으면 어느 필드가 문제인지 화면에
   아무 단서도 없어서, 사용자는 "저장을 눌렀는데 아무 일도 안 일어난다"로 받아들이게 된다.
   이제는 해당 필드에 빨간 테두리 + 아래 이유를 남기고, 저장 버튼 옆에도 요약을 띄운다. */
function _saveErrHost(scope){return document.getElementById(scope==='m'?'mSaveErr':'fSaveErr');}
function _clearFieldErrors(scope){
  const root=document.getElementById(scope==='m'?'schOv':'dealOv');
  // 오버레이가 아직 없거나 조회를 지원하지 않는 경우에도 요약 정리는 계속돼야 한다
  if(root&&typeof root.querySelectorAll==='function'){
    Array.prototype.forEach.call(root.querySelectorAll('.f-inp.f-err')||[],el=>{if(el.classList)el.classList.remove('f-err');});
    Array.prototype.forEach.call(root.querySelectorAll('.f-err-msg')||[],el=>{if(el.remove)el.remove();});
  }
  const sum=_saveErrHost(scope);
  if(sum){sum.textContent='';sum.style.display='none';}
}
function _setFieldError(inputId,msg){
  const el=document.getElementById(inputId);
  if(!el)return;
  if(el.classList)el.classList.add('f-err');
  const grp=(el.closest&&el.closest('.f-grp'))||el.parentElement;
  if(grp&&grp.querySelector&&!grp.querySelector('.f-err-msg')&&document.createElement){
    const box=document.createElement('div');
    box.className='f-err-msg';box.textContent=msg;
    if(grp.appendChild)grp.appendChild(box);
  }
}
// errors: [{id, msg}] — 첫 항목으로 포커스를 옮겨 바로 고칠 수 있게 함
function _showSaveErrors(scope,errors){
  _clearFieldErrors(scope);
  errors.forEach(e=>{ if(e.id)_setFieldError(e.id,e.msg); });
  const sum=_saveErrHost(scope);
  if(sum){
    sum.textContent=errors.length===1?errors[0].msg:('입력을 확인해주세요 — '+errors.map(e=>e.msg).join(' / '));
    sum.style.display='';
  }
  const first=errors[0]&&errors[0].id?document.getElementById(errors[0].id):null;
  if(first&&first.focus){try{first.focus();}catch(e){}}
}
// 필드와 무관한 실패(서버 오류, 화면 반영 오류 등)를 저장 버튼 옆에 남긴다
function _showSaveSummary(scope,msg){
  const sum=_saveErrHost(scope);
  if(sum){sum.textContent=msg;sum.style.display='';}
}
