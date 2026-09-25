'use strict';
/* Apps Script API 클라이언트 — _gasFetch(재시도·세션 연장), _gasWrite(GET 청크), 저장 오류 문구. */

// 시트 저장 실패 원문(Apps Script 예외 메시지)을 사용자에게 그대로 보여주지 않고, 흔한 원인(데이터
// 확인 규칙 위반, 네트워크/CORS로 요청 자체가 서버에 도달 못함)은 이해 가능한 문구로 바꿔서 보여줌 —
// 원문은 항상 console.error로 남겨 디버깅 가능하게 함.
// "Failed to fetch"(TypeError)는 서버가 실제로 거절한 게 아니라 요청이 아예 도달하지 못한 경우
// (네트워크 끊김, Apps Script 배포 URL이 더 이상 유효하지 않음, CORS 프리플라이트 차단 등)에 뜸 —
// 서버 쪽 에러(j.error)와는 다른 계열이라 구분해서 안내함.
function _friendlySaveError(rawMsg){
  const s=String(rawMsg||'');
  if(/데이터 확인 규칙/.test(s))return'제품명 표기가 시트 규칙과 달라 저장하지 못했습니다. 관리자에게 문의해주세요.';
  if(/failed to fetch/i.test(s))return'서버에 요청이 도달하지 못했습니다(네트워크/CORS). 잠시 후 재시도해 주세요.';
  return s;
}

// 네트워크 오류/일시 실패(5xx)는 지수 백오프(1s→2s→4s)로 최대 3회 재시도. 응답이 20초 넘게 안 오면(Apps
// Script 콜드스타트/네트워크 정체 등) 타임아웃으로 끊어서, "그냥 무한정 조용히 멈춤"이 아니라
// 명확한 실패로 처리되게 함(끊긴 뒤에도 위 재시도 루프를 그대로 탐). AUTH_REQUIRED는 이 백오프 루프와
// 무관한 별도 분기(아래 j.error==='AUTH_REQUIRED')로 처리됨 — 네트워크/타임아웃 실패만 여기서 재시도하고,
// 인증 실패(AUTH_REQUIRED)는 이 백오프와 무관하게 즉시 로그인 화면으로 간다 — 세션이 죽은 뒤에는
// 같은 요청을 반복해도 결과가 같으므로 재시도가 의미 없다.
// 응답에 새 세션 토큰(sessionToken)이 실려 있으면 조용히 갈아끼우고, AUTH_REQUIRED면 세션을 버리고
// 로그인 화면을 띄운다.
const GAS_FETCH_TIMEOUT_MS=20000;
// ⚠ 2026-07-29 확진: POST 본문을 URLSearchParams(application/x-www-form-urlencoded)로 감싸고
// redirect:'follow'/mode:'cors'/credentials:'omit'을 명시했던 시도(2026-07-28)가 오히려 문제였음 —
// Apps Script의 302 리다이렉트 처리와 그 조합에서 본문이 유실되어 doPost가 "요청 본문이
// 비어있습니다"로 실패했음(하트비트처럼 작은 요청도 함께 실패하기 시작한 게 결정적 단서).
// 그래서 실제로 저장이 되던 시점(2026-07-27, d03d0ca 커밋)의 순수한 형태로 되돌림: body는 JSON
// 문자열 그대로, fetch 옵션도 opts를 그대로 씀(redirect/mode/credentials 전부 지정 안 함 = 브라우저
// 기본값). signal(타임아웃)만 유지 — 이건 본문 구성과 무관해서 이번 문제의 원인이 아니었음.
// 앞으로 이 부분을 다시 건드릴 일이 있으면, 반드시 실제 저장 테스트로 실행 기록의 "완료됨"을
// 확인한 뒤에 커밋할 것 — 문서만 보고 "이론상 안전하다"고 판단하지 말 것(이번이 그 실패 사례).
async function _gasFetch(url,opts,_authRetried){
  const MAX_RETRY=3;
  // opts._timeoutMs: 이미지 업로드처럼 오래 걸리는 요청이 기본 20초에 잘리지 않게 하는 선택적
  // 오버라이드(fetch init에 섞여 들어가도 브라우저가 무시하는 키라 안전)
  const timeoutMs=(opts&&opts._timeoutMs)||GAS_FETCH_TIMEOUT_MS;
  let res,lastErr;
  for(let attempt=0;attempt<=MAX_RETRY;attempt++){
    const ac=new AbortController();
    const timeoutTimer=setTimeout(()=>ac.abort(),timeoutMs);
    try{
      // headers를 절대 직접 지정하지 말 것 — opts.body가 문자열이면 브라우저가 자동으로
      // Content-Type: text/plain;charset=UTF-8을 붙이며(CORS-safelisted, 프리플라이트 없음),
      // Apps Script는 e.postData.contents로 그 문자열을 그대로 받음. redirect/mode/credentials는
      // 절대 명시하지 말 것(위 주석 참고 — 명시했다가 본문이 유실됐던 이력 있음).
      res=await fetch(url,Object.assign({},opts,{signal:ac.signal}));
      if(res.status>=500)throw new Error('HTTP '+res.status);
      lastErr=null;break;
    }catch(e){
      lastErr=e.name==='AbortError'?new Error('TIMEOUT('+(timeoutMs/1000)+'s)'):e;
      if(attempt===MAX_RETRY)break;
      await new Promise(r=>setTimeout(r,1000*Math.pow(2,attempt))); // 1s, 2s, 4s
    }finally{
      clearTimeout(timeoutTimer);
    }
  }
  if(lastErr)throw lastErr;
  const j=await res.json();
  /* 슬라이딩 연장 — 서버가 남은 수명이 얼마 없다고 판단하면 어떤 응답에든 새 토큰을 실어 보낸다.
     조용히 받아서 갈아끼우는 게 전부다. 사용자도, 브라우저 UI도 개입하지 않는다. */
  if(j&&j.sessionToken&&j.sessionToken!==_getToken()){
    _setSession(j.sessionToken);
    console.log('[인증] 세션 자동 연장됨');
  }
  if(j&&j.error==='AUTH_REQUIRED'){
    /* 세션이 죽었다는 뜻이고, 여기서 프론트가 조용히 되살릴 방법은 없다(그게 예전 구조의 문제였다).
       재시도하지 않고 바로 로그인 화면으로 보낸다 — 401의 의미 그대로. */
    const reasonLabel={
      missing:'세션 없음',malformed:'세션 토큰 형식 오류',badsig:'세션 서명 불일치',
      expired:'세션 만료(절대 12시간)',idle:'미사용 만료(2시간)',revoked:'로그아웃되었거나 종료된 세션',
      keymissing:'서버에 해당 버전의 세션 키가 없음'
    }[j.reason]||('사유 불명('+j.reason+')');
    console.warn('[인증 거절] AUTH_REQUIRED — 사유: '+reasonLabel+' (reason="'+j.reason+'")');
    _clearSession();
    setConn('relogin');
    _showReloginScreen();
  }
  return j;
}

// ⚠ 2026-07-29: POST(어떤 형태로 시도해도 — JSON body, 폼 인코딩 body 전부)가 Apps Script의 302
// 리다이렉트 처리에서 본문을 유실시키는 문제가 계속 재현되어, 결국 한 번도 실패한 적 없는
// fetchLive의 GET 파이프라인을 저장/수정/삭제 등 쓰기 액션에도 그대로 재사용하기로 함. action/session은
// 쿼리 파라미터로, 실제 데이터는 JSON 문자열을 URL 인코딩해서 payload= 파라미터에 담아 보냄 — GET은
// "본문"이 없고 전부 URL에 실리므로, 리다이렉트를 따라가도 유실될 게 없음(URL은 리다이렉트 응답 자체가
// 아니라 요청 쪽에 속하는 정보라 안전).
// 페이로드가 길면(릴스 다수/회고 본문/이미지 base64 등) 단일 URL 길이 한도를 피하려고 여러 GET
// 요청으로 순차 분할 전송하고, 서버(CacheService)가 마지막 청크에서 전부 조립해 실제 처리를 실행함.
// 일반 공구건 저장/실적 수정처럼 페이로드가 짧은 경우는 항상 단일 요청 하나로 끝남(청크 분기 자체를
// 안 탐).
const GAS_GET_SINGLE_MAX=3000; // 인코딩된 payload가 이 길이 이하면 단일 GET, 넘으면 청크 분할
const GAS_GET_CHUNK_RAW_SIZE=1200; // 청크 1개당 원본(인코딩 전) 문자 수 — 인코딩 후에도 URL 전체가 안전 범위 안에 들어오게 보수적으로 잡음

async function _gasWrite(url,action,data,fetchOpts){
  const payloadStr=JSON.stringify(data||{});
  const base=_gasUrl(url); // 세션 토큰을 여기서 붙여줌 — 아래 청크 요청들도 전부 이 base를 재사용
  const encoded=encodeURIComponent(payloadStr);
  const sep=base.includes('?')?'&':'?';
  if(encoded.length<=GAS_GET_SINGLE_MAX){
    const reqUrl=base+sep+'action='+encodeURIComponent(action)+'&payload='+encoded;
    return _gasFetch(reqUrl,fetchOpts||{});
  }
  // 청크 분할 — 원본 문자열을 GAS_GET_CHUNK_RAW_SIZE 단위로 잘라 순차 전송(동시 전송 아님 — 서버가
  // 청크 순서와 무관하게 모으긴 하지만, 순차로 보내야 실패 시 몇 번째 청크였는지 바로 알 수 있음).
  // 마지막 청크의 응답이 곧 실제 처리 결과(그 전 청크들은 서버가 "받았다"는 가벼운 확인만 돌려줌).
  console.log('[gasWrite] action='+action+' payload 길이(인코딩 후)='+encoded.length+' — 청크 분할 전송');
  const chunkId=(window.crypto&&crypto.randomUUID)?crypto.randomUUID():(Date.now()+'-'+Math.random().toString(36).slice(2));
  const chunks=[];
  for(let i=0;i<payloadStr.length;i+=GAS_GET_CHUNK_RAW_SIZE)chunks.push(payloadStr.slice(i,i+GAS_GET_CHUNK_RAW_SIZE));
  let last=null;
  for(let i=0;i<chunks.length;i++){
    const reqUrl=base+sep+'action='+encodeURIComponent(action)+
      '&chunkId='+encodeURIComponent(chunkId)+'&chunkIndex='+i+'&chunkTotal='+chunks.length+
      '&payload='+encodeURIComponent(chunks[i]);
    last=await _gasFetch(reqUrl,fetchOpts||{});
    if(last&&last.error){console.error('[gasWrite] 청크 '+(i+1)+'/'+chunks.length+' 실패:',last.error);return last;}
  }
  return last;
}

// ⚠ 2026-07-29 이분 탐색 진단 전용 — 개발자도구 콘솔에서 직접 호출: _diagWriteStage(0),
// _diagWriteStage(1), _diagWriteStage(2), _diagWriteStage(3). 실제 저장 액션(addSalesRow)과
// 완전히 동일한 요청 경로(현재 로그인 세션의 진짜 토큰, 진짜 배포 URL, 진짜 브라우저 CORS/리다이렉트
// 컨텍스트)를 그대로 타되, 서버(_handleWriteAction)가 debugStage에서 조기 반환하므로 시트는 전혀
// 바뀌지 않음. 각 단계가 어디까지 성공/실패하는지 보고 "요청 파싱/라우팅 문제"인지 "실제 처리 로직
// 문제"인지 좁히는 용도 — 진단이 끝나면 이 함수와 서버의 debugStage 분기는 나중에 정리해도 됨.
async function _diagWriteStage(stage){
  const url=_getGasUrl();
  const base=_gasUrl(url);
  const sep=base.includes('?')?'&':'?';
  let reqUrl=base+sep+'action=addSalesRow&debugStage='+stage;
  if(stage!==0){
    // stage 0은 payload 파라미터 자체가 없는 요청을 테스트하는 용도라 일부러 안 붙임
    const minimalPayload=JSON.stringify({product:'진단',ch:'진단',start:'2026-07-29',end:'2026-07-29'});
    reqUrl+='&payload='+encodeURIComponent(minimalPayload);
  }
  console.log('[진단 stage '+stage+'] 요청 URL(세션 마스킹)=',reqUrl.replace(/session=[^&]+/,'session=***'));
  try{
    const j=await _gasFetch(reqUrl,{});
    console.log('[진단 stage '+stage+'] 결과:',j);
    return j;
  }catch(e){
    console.error('[진단 stage '+stage+'] 예외:',e);
    return {error:e.message};
  }
}

/* ⚠ 여기 있던 _refreshIdToken / _scheduleTokenRefresh / visibilitychange 자동 갱신은 전부 삭제됐다
   (2026-09-16 세션 도입). 구글 ID 토큰을 One Tap으로 조용히 재발급받던 구조였는데, One Tap은
   iframe에서 아예 표시되지 않고(임베드 모드에서는 100% 실패) 쿨다운·FedCM 차단에도 막혀서
   "한 시간마다 로그아웃"의 직접 원인이었다. 지금은 세션 연장이 응답(_gasFetch)에 실려 오므로
   브라우저 UI가 개입할 일이 없다 — 되살리지 말 것.
   죽은 코드를 주석으로 남기지 않는다: 지운 구현은 git 이력에 있다. */
