'use strict';
/* 연결 설정(⚙)·디버그(🐞) 모달, 헤더 연결 상태 뱃지, 로딩 오버레이. */

/* Debug modal — 로그인 세션으로 ?debug=1 호출 (관리자만 통과, 시트 값 비인증 노출 없음) */
async function openDebug(){
  const url=_getGasUrl();
  const body=document.getElementById('debugBody');
  document.getElementById('debugOv').classList.add('open');
  if(!url){body.textContent='먼저 ⚙ 연결 설정에서 Apps Script Web App URL을 등록하세요.';return;}
  if(!_getToken()){body.textContent='로그인이 필요합니다. 새로고침 후 다시 시도하세요.';return;}
  body.textContent='불러오는 중...';
  try{
    const r=await fetch(_gasUrl(url)+'&debug=1');
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const j=await r.json();
    if(j.error)throw new Error(j.error);
    body.textContent=JSON.stringify(j,null,2);
  }catch(e){
    body.textContent='오류: '+e.message+'\n\n(Apps Script를 debug 코드 추가 후 다시 배포했는지 확인하세요)';
  }
}
function closeDebug(){document.getElementById('debugOv').classList.remove('open');}
document.getElementById('debugOv').addEventListener('click',e=>{if(e.target===document.getElementById('debugOv'))closeDebug();});

/* Config modal */
function openCfg(){document.getElementById('gasUrl').value=localStorage.getItem('gp_gas_url')||'';showCfgMsg('','');document.getElementById('cfgOv').classList.add('open');}
function closeCfg(){document.getElementById('cfgOv').classList.remove('open');}
document.getElementById('cfgOv').addEventListener('click',e=>{if(e.target===document.getElementById('cfgOv'))closeCfg();});
function showCfgMsg(msg,type){const el=document.getElementById('cfgMsg');if(!msg){el.className='cfg-msg hidden';return;}el.textContent=msg;el.className=`cfg-msg ${type}`;}

async function testConn(){
  const url=document.getElementById('gasUrl').value.trim();
  if(!url){showCfgMsg('URL을 입력해주세요.','err');return;}
  if(!_getToken()){showCfgMsg('로그인 후 테스트해주세요.','err');return;}
  showCfgMsg('연결 테스트 중...','');
  try{
    const r=await fetch(_gasUrl(url));const j=await r.json();
    if(j.error)throw new Error(j.error);
    showCfgMsg(`✓ 연결 성공: ${(j.purchases||[]).length}건 데이터 확인`,'ok');
  }catch(e){showCfgMsg(`✗ 연결 실패: ${e.message}`,'err');}
}
async function saveCfg(){
  const url=document.getElementById('gasUrl').value.trim();
  localStorage.setItem('gp_gas_url',url);
  closeCfg();
  await fetchLive();
}

// 연결 상태: 마지막 성공 시각(_lastLiveAt)과 연속 실패 횟수(_connFailStreak)를 추적해서
// 뱃지가 실제 상태를 반영하게 함. 실패 1회는 일시적 blip일 가능성이 커서 뱃지를 아예 건드리지 않고,
// 2회 연속부터 "재연결 중", 3회 연속부터 "연결 오류"로 전환(2026-08-04: 1회 실패에도 뱃지가 바로
// 바뀌어 "재연결 중" 표시가 너무 자주 뜬다는 피드백을 반영해 임계값을 한 단계씩 늦춤).
let _lastLiveAt=null, _connFailStreak=0;
function setConn(s){
  const el=document.getElementById('connPill');
  const m={sample:['● 샘플 데이터','cp-sample'],live:['● 실시간 연결','cp-live'],error:['● 연결 오류','cp-error'],loading:['◌ 로딩 중...','cp-loading'],retrying:['◌ 재연결 중...','cp-loading'],
    refreshing:['◌ 인증 갱신 중...','cp-loading'],relogin:['● 재로그인 필요','cp-error'],cached:['◌ 캐시 데이터 · 갱신 중...','cp-loading'],
    // fetchLive가 반복 실패했을 때 "샘플 데이터"로 조용히 보이지 않게 하는 확정 실패 상태 —
    // connPill은 이미 항상 onclick=refreshData()가 걸려있어 클릭하면 그대로 재요청됨
    failed:['⚠ 서버 연결 실패 — 클릭해 재시도','cp-failed']};
  const[t,c]=m[s]||m.sample;el.textContent=t;el.className='conn-pill '+c;
  el.title=(_lastLiveAt?('마지막 동기화: '+new Date(_lastLiveAt).toLocaleTimeString('ko-KR')+' · '):'')+'클릭 시 재연결';
}
// 캐시로 즉시 렌더링한 직후 표시 — "N분 전 데이터 · 갱신 중..." 처럼 캐시 나이를 보여줌.
// fetchLive가 성공하면 setConn('live')로 자연히 대체됨.
function _showCacheBadge(cachedAt){
  setConn('cached');
  const mins=Math.max(0,Math.round((Date.now()-cachedAt)/60000));
  const label=mins<1?'방금 전':mins+'분 전';
  document.getElementById('connPill').textContent='◌ '+label+' 데이터 · 갱신 중...';
}
function _connOk(){_connFailStreak=0;_lastLiveAt=Date.now();}
// 1회 실패는 뱃지를 그대로 두고 콘솔 로그만 남김(대부분 일시적 blip이라 굳이 사용자에게 안 보여줌).
// 2회 연속부터 "재연결 중"(아직 희망적), 3회 연속부터 클릭 유도형 'failed' 상태로 — 샘플 데이터로
// 오인되지 않게, 그리고 클릭하면 그대로 재시도(connPill onclick=refreshData)되게 함.
function _connFail(reason){
  _connFailStreak++;
  console.warn('[fetchLive] 연속 실패 '+_connFailStreak+'회'+(reason?' (사유: '+reason+')':''));
  if(_connFailStreak<2)return;
  setConn(_connFailStreak>=3?'failed':'retrying');
}
function setLoad(on){document.getElementById('loadOv').classList[on?'add':'remove']('open');}
