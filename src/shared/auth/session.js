'use strict';
/* 대시보드 자체 세션 토큰 저장·복원과 관리자 UI. */

// 관리자 전용 컨트롤(상태 필터/새로고침/디버그/설정)을 볼 수 있는 계정 — 나중에 추가할 수 있게 배열로 관리
const ADMIN_EMAILS=['p_dh_3678@athomecorp.com'];
function _applyAdminUI(email){
  document.getElementById('hdrAdminControls').style.display=ADMIN_EMAILS.includes(email)?'flex':'none';
}
/* ── 대시보드 자체 세션 (2026-09-16) ────────────────────────────────────────────
   예전에는 구글 ID 토큰(수명 1시간)을 그대로 세션처럼 썼고, 만료 5분 전에 One Tap 조용한
   재인증으로 연장했다. 그 갱신이 자주 실패해서(One Tap 쿨다운·FedCM 차단·**iframe에서는 아예
   표시되지 않음**) 한 시간마다 로그아웃됐다.

   이제 구글 로그인은 신원 확인 1회에만 쓴다. 로그인 시 ID 토큰을 GAS에 한 번 넘기면 GAS가
   서명까지 검증한 뒤 자체 세션 토큰을 내주고, 그 뒤 모든 요청은 그 토큰으로 인증한다.
   갱신은 응답에 실려 오는 새 토큰을 받아 쓰는 방식이라 **브라우저 UI가 전혀 개입하지 않는다**
   — iframe이든 잠자기 복귀든 실패할 구석이 없다. */
let _sessionToken=null;
const SESSION_LS_KEY='gp_session';
/* 구 idToken 캐시 키 — 이 배포로 무효가 된다. 남아 있으면 "한 번 더 로그인해야 한다"는 안내를
   띄우는 신호로만 쓰고 지운다(아래 _consumeLegacyLoginNotice). */
const LEGACY_TOKEN_LS_KEY='gp_id_token';

// 세션 읽기/쓰기 단일 창구 — 로그인·복원·슬라이딩 연장 세 경로가 전부 여기만 거친다
function _getToken(){return _sessionToken;}
function _setSession(token){
  _sessionToken=token||null;
  try{
    if(token)localStorage.setItem(SESSION_LS_KEY,token);
    else localStorage.removeItem(SESSION_LS_KEY);
  }catch(e){}
}
function _loadSession(){
  try{return localStorage.getItem(SESSION_LS_KEY)||null;}catch(e){return null;}
}
function _clearSession(){_sessionToken=null;try{localStorage.removeItem(SESSION_LS_KEY);}catch(e){}}

// 세션 토큰의 페이로드(서명 검증은 서버만 한다 — 여기서는 이름/이메일 표시용으로만 읽는다)
function _decodeSessionPayload(token){
  try{
    const b64=String(token||'').split('.')[0].replace(/-/g,'+').replace(/_/g,'/');
    const padded=b64+'='.repeat((4-b64.length%4)%4);
    return JSON.parse(decodeURIComponent(
      atob(padded).split('').map(c=>'%'+c.charCodeAt(0).toString(16).padStart(2,'0')).join('')
    ));
  }catch(e){return null;}
}
// 구 로그인 흔적이 있으면 1회 안내를 위해 true를 돌려주고 흔적을 지운다
function _consumeLegacyLoginNotice(){
  try{
    if(!localStorage.getItem(LEGACY_TOKEN_LS_KEY))return false;
    localStorage.removeItem(LEGACY_TOKEN_LS_KEY);
    return true;
  }catch(e){return false;}
}

// GAS URL에 session 쿼리 파라미터 추가(있으면 교체, 없으면 붙임)
function _gasUrl(base){
  const stripped=base.replace(/([?&])session=[^&]*&?/,'$1').replace(/[?&]$/,'');
  if(!_getToken())return stripped;
  return stripped+(stripped.includes('?')?'&':'?')+'session='+encodeURIComponent(_getToken());
}
