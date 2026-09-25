'use strict';
/* 토스트 알림과 클립보드 복사. */

function cpTxt(t,el){const prev=el.textContent;const done=()=>{el.textContent='✓';showToast('상품코드가 복사되었습니다: '+t);setTimeout(()=>{el.textContent=prev;},1400);};navigator.clipboard?navigator.clipboard.writeText(t).then(done):fbCopy(t,done);}
function fbCopy(t,cb){const ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();try{document.execCommand('copy');cb();}catch(e){}document.body.removeChild(ta);}

let _toastT=null;
// opts.type: 'success'|'error'(색상 변형, 생략 시 기존 중립 톤) — opts.duration: 자동 숨김까지
// 걸리는 ms(생략 시 2000, error는 기본 더 길게). 기존 showToast(msg) 단독 호출은 그대로 동작.
function showToast(msg,opts){
  const el=document.getElementById('toast');
  const type=opts&&opts.type;
  el.textContent=msg;
  el.className='toast show'+(type?' '+type:'');
  clearTimeout(_toastT);
  const duration=(opts&&opts.duration)||(type==='error'?5000:2000);
  _toastT=setTimeout(()=>el.classList.remove('show'),duration);
}
