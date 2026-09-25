'use strict';
/* 캘린더 프로모션/이벤트 일정 추가·수정·삭제. */

/* ── 캘린더 프로모션/이벤트 일정 (실적통합과 무관 — 캘린더 표시 전용) ── */
let _promoEditId=null,_promoEditName='';

function openPromoForm(){
  _promoEditId=null;_promoEditName='';
  document.getElementById('promoTitle').textContent='프로모션 일정 추가';
  document.getElementById('fpName').value='';
  document.getElementById('fpStart').value='';
  document.getElementById('fpEnd').value='';
  document.getElementById('fpNote').value='';
  document.getElementById('promoDelBtn').style.display='none';
  document.getElementById('promoOv').classList.add('open');
}
function openPromoEdit(id){
  const ev=EVENTS.find(x=>x.id===id);if(!ev)return;
  _promoEditId=id;_promoEditName=ev.name;
  document.getElementById('promoTitle').textContent='프로모션 일정 수정';
  document.getElementById('fpName').value=ev.name;
  document.getElementById('fpStart').value=ev.start;
  document.getElementById('fpEnd').value=ev.end;
  document.getElementById('fpNote').value=ev.note||'';
  document.getElementById('promoDelBtn').style.display='';
  document.getElementById('promoOv').classList.add('open');
}
function closePromoForm(){document.getElementById('promoOv').classList.remove('open');_promoEditId=null;_promoEditName='';}
document.getElementById('promoOv').addEventListener('click',e=>{if(e.target===document.getElementById('promoOv'))closePromoForm();});

function savePromo(){
  const name=document.getElementById('fpName').value.trim();
  const start=document.getElementById('fpStart').value;
  const end=document.getElementById('fpEnd').value;
  const note=document.getElementById('fpNote').value.trim();
  if(!name){alert('이벤트명을 입력하세요.');return;}
  if(!start||!end){alert('시작일과 마감일을 입력하세요.');return;}
  if(new Date(start)>new Date(end)){alert('마감일이 시작일보다 빠릅니다.');return;}

  const payload={name,start,end,note};
  const isEdit=_promoEditId!=null;
  if(isEdit){payload.row=_promoEditId;payload.origName=_promoEditName;}

  const url=_getGasUrl();
  if(url){
    setLoad(true);
    const action=isEdit?'updateCalendarEvent':'addCalendarEvent';
    _gasWrite(url,action,payload)
      .then(j=>{
        if(j.error)throw new Error(j.error);
        closePromoForm();fetchLive();
      }).catch(e=>{console.error('[저장 실패]',e);showToast('저장 실패: '+_friendlySaveError(e.message));setLoad(false);});
  } else {
    if(isEdit){
      const ev=EVENTS.find(x=>x.id===_promoEditId);
      if(ev)Object.assign(ev,{name,start,end,note});
    } else {
      EVENTS.push({id:EVENTS.reduce((mx,x)=>Math.max(mx,x.id),0)+1,name,start,end,note});
    }
    closePromoForm();
    render();
    alert('샘플 모드: 로컬에 저장되었습니다. (새로고침 시 초기화)');
  }
}

function deletePromo(){
  if(_promoEditId==null)return;
  if(!confirm('이 프로모션 일정을 삭제하시겠습니까?'))return;
  const row=_promoEditId,origName=_promoEditName;

  const url=_getGasUrl();
  if(url){
    setLoad(true);
    _gasWrite(url,'deleteCalendarEvent',{row,origName})
      .then(j=>{
        if(j.error)throw new Error(j.error);
        closePromoForm();fetchLive();
      }).catch(e=>{console.error('[삭제 실패]',e);showToast('삭제 실패: '+_friendlySaveError(e.message));setLoad(false);});
  } else {
    const idx=EVENTS.findIndex(x=>x.id===row);
    if(idx>=0)EVENTS.splice(idx,1);
    closePromoForm();
    render();
  }
}
