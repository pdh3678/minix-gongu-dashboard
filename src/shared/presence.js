'use strict';
/* 접속자 표시(하트비트). */

/* ── 접속자 표시(Presence): 45초 간격 하트비트, 탭 숨김 시 중단·복귀 시 3초 뒤 1회+재개 ── */
const PRESENCE_HEARTBEAT_MS=45000;
let _presenceTimer=null;
let _presenceUsers=[];
let _presencePanelOpen=true;
async function _sendPresenceHeartbeat(){
  if(!_getToken())return; // 로그아웃 상태
  const url=_getGasUrl();
  if(!url)return;
  try{
    // 이메일/이름은 보내지 않는다 — 서버가 세션에서 꺼내 쓴다(클라이언트가 신원을 주장하지 못하게)
    const j=await _gasFetch(_gasUrl(url),{method:'POST',body:JSON.stringify({action:'presence',session:_getToken()})});
    if(j&&j.success&&Array.isArray(j.users)){
      _presenceUsers=j.users;
      renderPresencePanel();
    }else if(j&&j.error){
      // AUTH_REQUIRED 사유는 _gasFetch가 이미 콘솔에 남김 — 여기서는 하트비트가 실제로 반영 안 됐음만 표시
      console.warn('[하트비트] presence 응답 실패로 접속자 목록에 반영되지 않음:',j.error);
    }
  }catch(e){
    // 네트워크 일시 오류는 조용히 무시 — 다음 하트비트에서 자연 복구
  }
}
// 첫 하트비트를 3초 늦춰서, 로그인/탭 복귀 시점에 fetchLive()와 동시에 GAS로 나가지 않게 분산시킴
// (둘 다 같은 스크립트의 콜드스타트를 동시에 두드리면 서로의 응답이 함께 느려짐) — 그 이후는 정상 간격.
function _startPresenceHeartbeat(){
  if(_presenceTimer)clearInterval(_presenceTimer);
  setTimeout(_sendPresenceHeartbeat,3000);
  _presenceTimer=setInterval(_sendPresenceHeartbeat,PRESENCE_HEARTBEAT_MS);
}
function _stopPresenceHeartbeat(){
  if(_presenceTimer){clearInterval(_presenceTimer);_presenceTimer=null;}
}
document.addEventListener('visibilitychange',()=>{
  if(!_getToken())return;
  if(document.visibilityState==='hidden')_stopPresenceHeartbeat();
  else if(document.visibilityState==='visible')_startPresenceHeartbeat(); // 3초 후 1회 전송 후 45초 간격 재개
});
function togglePresencePanel(){_presencePanelOpen=!_presencePanelOpen;renderPresencePanel();}
function renderPresencePanel(){
  const body=document.getElementById('presenceBody');
  if(!body)return;
  document.getElementById('presenceCount').textContent=`${_presenceUsers.length}명 접속 중`;
  document.getElementById('presenceChev').textContent=_presencePanelOpen?'▾':'▸';
  body.style.display=_presencePanelOpen?'flex':'none';
  body.innerHTML=_presenceUsers.length?_presenceUsers.map(u=>`
    <div class="presence-row">
      <span class="presence-dot"></span>
      <span class="presence-name">${u.name||u.email}</span>
      ${u.isMe?'<span class="presence-me">나</span>':''}
    </div>`).join(''):'<div class="presence-empty">접속자 없음</div>';
}
