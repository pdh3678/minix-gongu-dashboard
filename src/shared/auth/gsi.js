'use strict';
/* 구글 로그인(GSI) — 스크립트 로드 진단, 로그인 시도 감지, 라이브러리 초기화. */

/* ── 구글 로그인 / OAuth 인증 ── */
const GAS_CLIENT_ID='379680980952-vcvtnv1le4lmma2f0gv6snita17ve7bd.apps.googleusercontent.com';
const ALLOWED_DOMAIN='athomecorp.com';

/* ── 로그인 진단(GSI) ──
   "로그인 시도했는데 아무 반응도 없다"는 문의는 콘솔 에러조차 없는 경우가 많아(스크립트가 아예
   막혔거나, 팝업이 조용히 차단되거나, FedCM/One Tap이 아무 알림 없이 실패하는 경우 등) 원인 파악이
   특히 어려움. 그래서 콘솔 로그(_gsiLog)와 별개로, 화면에도 상태 배지(#loginDiag)로 항상 노출함. */
let _gsiScriptState='loading'; // 'loading' | 'loaded' | 'failed'
let _gsiAttemptTimer=null; // 로그인 시도(버튼 클릭 추정) 후 5초 워치독
function _gsiLog(msg){console.log('[GSI] '+msg);}

function _showLoginDiag(msg,opts){
  opts=opts||{};
  document.getElementById('loginDiagMsg').textContent=msg;
  document.getElementById('loginDiagRetry').style.display=opts.retry?'inline-block':'none';
  /* 임베드에서 로그인이 막히는 경우(팝업 차단, GIS 스크립트 차단 등)에는 항상 탈출구를 같이 준다 —
     iframe 안에서 해결할 방법이 없는 상황이 실제로 존재하기 때문. 일반 모드에서는 같은 주소를
     새 탭에 여는 게 아무 도움이 안 되므로 보여주지 않는다. */
  const showNewTab=(opts.newTab!==false)&&IS_EMBED;
  document.getElementById('loginDiagNewTab').style.display=showNewTab?'inline-block':'none';
  document.getElementById('loginDiag').style.display='flex';
}

/* 팝업이 막혀 iframe 안에서 로그인을 끝낼 수 없을 때의 탈출구 — 대시보드를 그 자체 주소로
   (embed 파라미터만 빼고) 새 탭에 연다. 보고 있던 페이지(해시)와 나머지 쿼리는 그대로 유지해서
   새 탭에서 곧바로 같은 화면이 뜨게 한다.
   ⚠ 브라우저가 서드파티 저장소를 상위 사이트별로 분리하기 때문에, 새 탭에서 로그인해도 그 세션이
   iframe 안으로 따라 들어오지는 않는다. 이 버튼은 "iframe을 고치는" 수단이 아니라 "사용자가 지금
   당장 일을 할 수 있게 하는" 탈출구다. */
function _openLoginInNewTab(){
  const p=new URLSearchParams(location.search);
  p.delete('embed');
  const qs=p.toString();
  window.open(location.origin+location.pathname+(qs?'?'+qs:'')+location.hash,'_blank','noopener');
}
function _hideLoginDiag(){
  document.getElementById('loginDiag').style.display='none';
}

function _gsiScriptLoaded(){
  _gsiScriptState='loaded';
  _gsiLog('스크립트 로드 성공(onload)');
}
function _gsiScriptFailed(){
  if(_gsiScriptState==='loaded')return; // 재시도 중 이전 태그의 이벤트가 늦게 들어온 경우 무시
  _gsiScriptState='failed';
  _gsiLog('스크립트 로드 실패(onerror) — 네트워크/보안 정책이 accounts.google.com 접속을 막고 있을 가능성');
  _showLoginDiag('로그인 스크립트 로드 실패 — 사내망/보안 프로그램이 accounts.google.com 접속을 막고 있을 수 있습니다.',{retry:true});
}
// onload/onerror가 아예 안 뜨는 경우(프록시가 200으로 빈 응답을 주거나 요청이 그냥 멎는 경우 등)를
// 잡기 위한 안전망 — 이벤트 발생 여부와 무관하게, 일정 시간 뒤에도 GSI 전역객체가 없으면 실패로 간주
function _armGsiBootWatchdog(){
  setTimeout(()=>{
    if(_gsiScriptState==='loading'&&!(window.google&&google.accounts&&google.accounts.id)){
      _gsiScriptState='failed';
      _gsiLog('스크립트 로드 타임아웃(8초 경과, onload/onerror 모두 발생 안 함)');
      _showLoginDiag('로그인 스크립트 로드 실패 — 사내망/보안 프로그램이 accounts.google.com 접속을 막고 있을 수 있습니다.',{retry:true});
    }
  },8000);
}
_armGsiBootWatchdog();

function _retryGsiScript(){
  _hideLoginDiag();
  _gsiScriptState='loading';
  _gsiLog('스크립트 재시도 시작');
  const old=document.getElementById('gsiScriptTag');
  if(old)old.remove();
  const s=document.createElement('script');
  s.id='gsiScriptTag';
  s.src='https://accounts.google.com/gsi/client?_retry='+Date.now(); // 캐시된 실패 응답을 다시 안 쓰게 캐시버스팅
  s.async=true;s.defer=true;
  s.onload=_gsiScriptLoaded;
  s.onerror=_gsiScriptFailed;
  document.body.appendChild(s);
  _armGsiBootWatchdog();
}

// 로그인 시도(버튼 클릭) 감지 — 구글 로그인 버튼은 크로스오리진 iframe이라 그 안에서 일어난 클릭은
// 부모 문서로 이벤트가 전파되지 않음(표준 스펙상 원천적으로 불가능). 유일하게 관측 가능한 신호는
// 포커스가 그 iframe으로 넘어가면서 window에 blur가 뜨는 것 — iframe 클릭 감지에 흔히 쓰는 방법.
// 완벽하진 않지만(클릭 자체를 100% 보장 못함), "5초 내 credential 없으면 배지 표시" 워치독을 시작할
// 트리거로는 충분함.
let _loginAttemptWatchArmed=false;
function _armLoginAttemptWatch(){
  if(_loginAttemptWatchArmed)return; // 스크립트 재시도로 onGoogleLibraryLoad가 다시 불려도 리스너 중복 등록 방지
  _loginAttemptWatchArmed=true;
  window.addEventListener('blur',function(){
    const gisBtn=document.getElementById('gisBtn');
    const loginVisible=!_isAuthed;
    if(!loginVisible||!gisBtn||!gisBtn.contains(document.activeElement))return;
    _gsiLog('로그인 버튼 클릭 감지(포커스가 버튼 iframe으로 이동) — 5초 내 credential 대기');
    _startLoginAttemptWatchdog();
  });
}
function _startLoginAttemptWatchdog(){
  if(_gsiAttemptTimer)clearTimeout(_gsiAttemptTimer);
  const credBefore=_getToken();
  _gsiAttemptTimer=setTimeout(()=>{
    _gsiAttemptTimer=null;
    if(_getToken()&&_getToken()!==credBefore)return; // 그 사이 로그인 성공 — 배지 필요 없음
    _gsiLog('로그인 시도 후 5초 경과 — credential 콜백 없음');
    // iframe 안에서는 팝업이 막히는 일이 훨씬 흔하고, 부모 페이지의 팝업 설정까지 걸려 있어
    // 사용자가 "이 사이트"를 어디로 봐야 할지도 헷갈린다 — 그래서 안내 문구를 따로 준다.
    _showLoginDiag(IS_EMBED
      ? '팝업이 차단되었습니다. 이 페이지를 감싸고 있는 사이트의 팝업을 허용하거나, 새 탭에서 로그인해주세요.'
      : '로그인이 완료되지 않았습니다. 팝업이 차단된 것 같습니다 — 주소창의 팝업 차단 아이콘을 확인해 이 사이트의 팝업을 허용해주세요.');
  },5000);
}

// GIS 라이브러리 로드 완료 시 자동 호출 (script onload와는 별개 콜백 — 스크립트 자체는 받았지만
// 이 함수가 안 불리는 경우도 이론상 있어 로그를 따로 남김)
window.onGoogleLibraryLoad=function(){
  _gsiLog('onGoogleLibraryLoad 실행됨 — GSI 전역객체 준비 완료');
  if(_gsiScriptState!=='loaded'){_gsiScriptState='loaded';_gsiLog('스크립트 로드 성공(onGoogleLibraryLoad로 확인, onload 이벤트는 못 받았을 수 있음)');}
  google.accounts.id.initialize({
    client_id:GAS_CLIENT_ID,
    callback:handleGoogleSignIn,
    auto_select:true, // 기존 Google 세션이 있으면 자동 credential 발급
    ux_mode:'popup', // 명시적으로 팝업 방식 고정 — 로그인 버튼 클릭 시 리다이렉트가 아니라 팝업 창으로 진행됨
    use_fedcm_for_prompt:true // FedCM 적용(콘솔 deprecated 경고 해결) — One Tap(prompt())에만 영향, 아래 renderButton은 FedCM과 무관하게 항상 팝업 기반이라 FedCM 차단 브라우저에서도 로그인 버튼 자체는 동작함
  });
  _gsiLog('google.accounts.id.initialize 완료(ux_mode=popup)');
  // 로그인 버튼 렌더링
  google.accounts.id.renderButton(
    document.getElementById('gisBtn'),
    {theme:'outline',size:'large',locale:'ko',width:'308',text:'signin_with'}
  );
  _gsiLog('로그인 버튼 렌더 완료');
  _armLoginAttemptWatch();
  /* 예전에는 여기서 세션 흔적만 있고 토큰이 없으면 _refreshIdToken()으로 조용한 재인증을 시도했다.
     이제 세션이 없으면 그냥 로그인 화면이 정답이다 — 사용자가 버튼을 누르면 그때 교환한다. */
};
