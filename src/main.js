'use strict';
/* 초기 진입(부트스트랩) — 캐시 우선 렌더 + 세션 복원, file:// 로컬 우회. 반드시 마지막에 로드. */

// ── 초기 진입: 캐시 우선 렌더링(stale-while-revalidate) + 인증/데이터 요청 병렬화 ──
// 1) 마지막 성공 응답이 로컬에 있으면 인증을 기다리지 않고 즉시 그 데이터로 화면을 그림 —
//    체감 로딩 시간을 0에 가깝게 만드는 게 목적.
// 2) 세션 토큰이 localStorage에 있으면 그 값으로 바로 fetchLive를 시작함(GSI 스크립트 로드를
//    기다리지 않음 — 세션은 구글과 무관하므로 애초에 기다릴 이유가 없다).
// 3) 세션이 없으면 로그인 화면을 그대로 둔다.
(function _bootstrap(){
  /* 구 로그인 흔적만 남아 있으면(=이 배포 전에 로그인한 사용자) 한 번은 다시 로그인해야 한다.
     조용히 로그인 화면만 띄우면 "왜 튕겼지?"가 되므로 이유를 적어 준다. */
  if(_consumeLegacyLoginNotice()&&!_loadSession()){
    try{
      const el=document.getElementById('loginError');
      el.textContent='로그인 방식이 바뀌었습니다. 한 번만 다시 로그인해주세요.\n(이후에는 한 시간마다 풀리지 않습니다)';
      el.style.display='block';
    }catch(e){}
  }

  const savedUserRaw=sessionStorage.getItem('gp_user');
  const session=_loadSession();
  if(!session)return; // 세션이 없으면 정상 로그인 화면 유지

  let user=null;
  try{user=savedUserRaw?JSON.parse(savedUserRaw):null;}catch(e){user=null;}
  if(!user){
    // sessionStorage가 비어도(브라우저 완전 재시작) 세션 토큰의 페이로드로 복원한다
    const p=_decodeSessionPayload(session);
    if(p&&p.email){
      user={email:p.email,name:p.name||p.email};
      try{sessionStorage.setItem('gp_user',JSON.stringify(user));}catch(e){}
    }
  }
  if(!user)return; // 사용자 정보를 하나도 복원 못 하면 정상 로그인 흐름으로 진행

  const dataCache=_loadDataCache();
  if(dataCache){
    const adaptedDeals=adaptGAS(dataCache);
    const adaptedEvents=adaptGASEvents(dataCache);
    if(adaptedDeals&&adaptedDeals.length){
      DATA.splice(0,DATA.length,..._mergeDuplicateCodeRows(adaptedDeals));
      EVENTS.splice(0,EVENTS.length,...adaptedEvents);
      _usingCachedRender=true;
      _lastLiveAt=dataCache.cachedAt;
    }
  }

  if(_usingCachedRender)_showCacheBadge(dataCache.cachedAt);
  // 새로고침 시 세션 복원도 로그인 성공과 같은 창구를 지난다(경로를 둘로 만들지 않는다).
  // fetchLive()는 유효한 토큰이 있으면 바로 시작되고, render()는 캐시로 채워진 DATA를 즉시 그림.
  onLoginSuccess({sessionToken:session,user:user});
})();

// ── 로컬 테스트 우회 ──
// file:// 로 열었을 때는 구글 로그인(GIS)이 origin 제약으로 동작하지 않으므로
// 로그인 화면을 건너뛰고 샘플 데이터로 바로 진입시킴. 배포 환경(https://)에서는 적용되지 않음.
if(location.protocol==='file:'){
  _enterDashboard({email:'local-test@athomecorp.com',name:'로컬 테스트 (인증 우회)'});
}
