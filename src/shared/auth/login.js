'use strict';
/* 로그인 흐름 — 세션 교환, 로그인 성공 단일 창구, 대시보드 진입(_enterDashboard), 로그아웃. */

function _showReloginBanner(){document.getElementById('reloginBanner').classList.add('show');}
function _hideReloginBanner(){document.getElementById('reloginBanner').classList.remove('show');}

/* ── 인증 상태 단일 소스 (2026-09-18) ──────────────────────────────────────────
   로그인 오버레이(#loginScreen)의 표시 여부는 이 상태 하나로만 결정한다.
   style.display를 직접 건드리는 코드를 다시 만들지 말 것.

   ⚠ 이 함수가 생긴 이유(실제 버그): 예전엔 _enterDashboard가 display='none'을,
   _showReloginScreen이 display='flex'를 각각 직접 썼고, 그와 **별개로** "이미 진입했는가"를
   _dashboardEntered 플래그로 따로 들고 있었다. 세션 만료로 오버레이를 다시 띄울 때 그 플래그를
   되돌리지 않아서, 재로그인에 성공해도 "이미 진입함"으로 판정돼 데이터만 다시 받고 오버레이는
   영영 걷히지 않았다(로그상 _enterDashboard가 아예 안 불림). 화면 상태와 판정 플래그를 둘로
   나눠 가진 것이 원인이었으므로 하나로 합친다. */
let _isAuthed=false;
function _setAuthed(v){
  _isAuthed=!!v;
  document.getElementById('loginScreen').style.display=_isAuthed?'none':'flex';
}
function _showReloginScreen(){_hideReloginBanner();_setAuthed(false);}

function _reportLoginFlowError(msg){
  console.error('[GSI] 로그인 후처리 실패 — '+msg);
  document.getElementById('loginFlowErrMsg').textContent='로그인 후 처리 중 오류가 발생했습니다: '+msg+' (콘솔에 상세 내용이 남았습니다)';
  document.getElementById('loginFlowErrBanner').classList.add('show');
}

// GIS 콜백: 로그인 완료 or 자동 갱신 시 호출
function handleGoogleSignIn(response){
  // credential이 왔다는 것 자체가 "5초 내 응답 없음" 워치독이 대비하던 실패가 아니라는 뜻이므로,
  // 이후 도메인 검증에서 거절되더라도(별도 에러로 안내됨) 진단 배지는 먼저 지움.
  if(_gsiAttemptTimer){clearTimeout(_gsiAttemptTimer);_gsiAttemptTimer=null;}
  _hideLoginDiag();
  _gsiLog('credential 수신 완료');
  // GIS 라이브러리가 이 콜백을 팝업 postMessage 핸들러 등 내부 이벤트 루프에서 호출하는데, 그 경로에서
  // 발생한 예외는 라이브러리 쪽에서 조용히 삼켜져 콘솔에도 전혀 안 남는 경우가 있었음(실제 증상:
  // "credential은 왔는데 그 다음부터 원인 불명으로 멈춤"). 그래서 이 함수 전체를 반드시 우리 쪽에서
  // try-catch로 감싸서 무슨 일이 있어도 콘솔+화면에 직접 노출시킴.
  try{
    /* 예전엔 여기서 credential을 직접 디코드해 도메인을 먼저 검사했다. 그 판정 규칙이 서버에도
       똑같이 있어서 둘이 갈라질 수 있었고(2026-09-15에 실제로 갈라져 로그인이 통째로 깨졌다),
       무엇보다 **클라이언트 검사는 보안상 의미가 없다**(누구든 건너뛸 수 있다).
       이제 프론트는 credential을 그대로 넘기고, 판정은 서버 한 곳에서만 한다. */
    _exchangeForSession(response.credential);
  }catch(err){
    _reportLoginFlowError((err&&err.message)||String(err));
  }
}

/* 구글 ID 토큰 1개 → 대시보드 세션 토큰. 로그인 때 딱 한 번만 일어난다. */
async function _exchangeForSession(credential){
  const url=_getGasUrl();
  if(!url){_showLoginErr('서버 주소가 설정되지 않았습니다. 관리자에게 문의해주세요.');return;}
  setConn('refreshing');
  let j;
  try{
    j=await _gasFetch(url+(url.includes('?')?'&':'?')+'action=login&idToken='+encodeURIComponent(credential),{});
  }catch(e){
    _gsiLog('세션 교환 실패(네트워크): '+e.message);
    _showLoginErr('서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.');
    setConn('relogin');
    return;
  }
  if(!j||!j.sessionToken){
    const why={
      blocked:'이 계정은 접속이 차단되었습니다. 관리자에게 문의해주세요.',
      domain:'앳홈 계정(@'+ALLOWED_DOMAIN+')으로만 로그인할 수 있습니다.',
      unverified:'이메일이 인증되지 않은 계정입니다.',
      aud:'로그인 설정이 올바르지 않습니다. 관리자에게 문의해주세요.',
      iss:'로그인 정보를 확인하지 못했습니다. 다시 시도해주세요.',
      expired:'로그인 정보가 만료되었습니다. 다시 시도해주세요.',
      missing:'로그인 정보가 전달되지 않았습니다. 다시 시도해주세요.'
    }[j&&j.reason]||'로그인에 실패했습니다. 다시 시도해주세요.';
    /* reason이 없는데 error가 있으면 서버가 예외로 죽은 것이다(대표적으로 Script Properties에
       SESSION_SECRET_V1을 안 넣은 경우). 그 메시지에 원인이 그대로 적혀 있으므로 삼키지 않는다 —
       "로그인에 실패했습니다"로 뭉개면 설정 실수 하나를 찾는 데 한참 걸린다. */
    const serverErr=(j&&!j.reason&&j.error)?String(j.error):'';
    _gsiLog('세션 교환 거절 — reason='+((j&&j.reason)||'?')+(serverErr?(' / '+serverErr):''));
    // 거절된 계정 주소는 서버가 알려줄 때만 보여준다(프론트가 토큰을 뜯어보지 않으므로)
    _showLoginErr((serverErr||why)+(j&&j.email?('\n('+j.email+')'):''));
    setConn('relogin');
    return;
  }

  onLoginSuccess(j);
}

/* ── 로그인 성공 단일 창구 (2026-09-18) ────────────────────────────────────────
   세션 저장 → 사용자 정보 확정 → 대시보드 진입(오버레이 제거 포함)을 한 함수로 묶는다.
   첫 로그인 / 세션 만료 후 재로그인(AUTH_REQUIRED 이후) / 새로고침 시 세션 복원이 전부 이
   경로를 지난다 — 경로별로 분기를 두지 않는 것이 이 함수의 존재 이유다.

   ⚠ 여기에 "이미 로그인돼 있으니 데이터만 새로 받자" 같은 최적화를 다시 넣지 말 것.
   그 분기(if(!_dashboardEntered)...else fetchLive())가 바로 재로그인 후 로그인 화면이
   안 사라지던 버그였다. _enterDashboard는 여러 번 불려도 안전하게 만들어져 있고, 중복 진입
   비용보다 오버레이가 남아 화면이 갇히는 사고가 훨씬 비싸다. */
function onLoginSuccess(j){
  _setSession(j.sessionToken);
  const user=j.user||_decodeSessionPayload(j.sessionToken)||{email:'',name:''};
  try{sessionStorage.setItem('gp_user',JSON.stringify(user));}catch(e){}
  _gsiLog('세션 발급 완료 — '+user.email);
  _hideReloginBanner();
  _enterDashboard(user);
}

function _showLoginErr(msg){
  const el=document.getElementById('loginError');
  el.textContent=msg;el.style.display='block';
}

/* 대시보드 진입 — 오버레이 제거부터 데이터 로드·라우팅·하트비트까지.
   **여러 번 호출해도 안전해야 한다** (세션 만료 후 재로그인이 곧 두 번째 호출이다):
     · _setAuthed(true)  멱등
     · fetchLive()       실패했던 원래 요청(세션 만료로 거절당한 그 요청)을 다시 보내는 자리 —
                         읽기라서 재시도가 안전하다. 쓰기(_gasWrite)는 일부러 재시도하지 않는다:
                         서버가 거절해 시트는 안 바뀌었지만 프론트는 이미 낙관적 반영을 롤백하고
                         사용자에게 실패를 알린 뒤라, 조용히 재전송하면 "실패했다고 알고 있는
                         저장"이 되살아나 화면과 시트가 어긋난다.
     · _routeFromHash()  지금 주소의 해시를 다시 읽으므로 보던 페이지로 그대로 복귀한다
                         (워크스페이스 메뉴별 iframe이 각자 자기 해시로 돌아오는 근거)
     · _startPresenceHeartbeat()  기존 타이머를 지우고 다시 건다(중복 누적 없음) */
function _enterDashboard(user){
  _gsiLog('_enterDashboard: 시작 — 로그인화면 숨김+이름표시');
  /* 오버레이 제거가 가장 먼저다. 아래 어느 단계가 예외로 죽더라도 화면이 로그인 상태로
     갇히지는 않게 한다 — 갇힌 화면은 사용자가 스스로 빠져나올 방법이 없다. */
  _setAuthed(true);
  document.getElementById('sbUserName').textContent=user.name||user.email||'—';
  document.getElementById('sbUserEmail').textContent=user.email||'';
  _applyAdminUI(user.email||'');
  _gsiLog('_enterDashboard: fetchLive/render 호출');
  fetchLive();render();
  _routeFromHash(); // 주소의 해시(#calendar, #product-TheSlim 등)에 맞는 탭을 열어줌(없으면 기본 탭)
  _startPresenceHeartbeat();
  _gsiLog('_enterDashboard: 완료(routeFromHash/presence 포함)');
}

function signOut(){
  /* 서버의 _sessions 행도 지운다 — 프론트에서 토큰만 버리면 그 토큰은 만료 전까지 계속 유효하다.
     응답을 기다리지 않는 이유는 로그아웃 체감 속도 때문이고, 실패해도 절대·미사용 만료로 결국 죽는다. */
  const _url=_getGasUrl();
  if(_url&&_getToken()){
    try{fetch(_gasUrl(_url)+'&action=logout').catch(()=>{});}catch(e){}
  }
  _clearSession();
  _stopPresenceHeartbeat();
  _presenceUsers=[];renderPresencePanel();
  sessionStorage.removeItem('gp_user');
  _clearDataCache(); // 다른 계정으로 다시 로그인했을 때 이전 사용자의 캐시 데이터가 보이면 안 됨
  if(window.google&&google.accounts)google.accounts.id.disableAutoSelect();
  _setAuthed(false);
  document.getElementById('sbUserName').textContent='—';
  document.getElementById('sbUserEmail').textContent='';
  _applyAdminUI('');
}
