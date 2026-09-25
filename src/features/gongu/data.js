'use strict';
/* 공구 데이터 로드 — fetchLive, 응답 변환(adaptGAS), 다중 코드 행 병합, 로컬 캐시. */

/* Live fetch */

// ── 데이터 캐시(stale-while-revalidate): 마지막 성공 응답을 저장해뒀다가 다음 방문 때
// 인증을 기다리지 않고 즉시 화면을 그리는 데 씀. 스키마가 바뀌면(SCRIPT_VERSION 변경) 폐기.
const GAS_DATA_CACHE_LS_KEY='gp_data_cache';
function _saveDataCache(payload){
  try{
    localStorage.setItem(GAS_DATA_CACHE_LS_KEY,JSON.stringify({
      purchases:payload.purchases,calendarEvents:payload.calendarEvents,
      version:payload.version,cachedAt:Date.now()
    }));
  }catch(e){
    console.warn('[캐시] 데이터 캐시 저장 실패(용량 초과 등으로 추정, 무시함):',e);
  }
}
function _loadDataCache(){
  try{
    const raw=localStorage.getItem(GAS_DATA_CACHE_LS_KEY);
    if(!raw)return null;
    const c=JSON.parse(raw);
    if(!c||!Array.isArray(c.purchases)||!c.cachedAt)return null;
    if(c.version!==DASHBOARD_VERSION)return null; // 구조 변경 등으로 버전이 다르면 폐기
    return c;
  }catch(e){return null;}
}
function _clearDataCache(){try{localStorage.removeItem(GAS_DATA_CACHE_LS_KEY);}catch(e){}}

let _usingCachedRender=false; // 캐시로 이미 화면을 그려둔 채 백그라운드로 새로고침 중이면 true — 전체화면 로딩 오버레이/뱃지를 덮어쓰지 않음

// fetch()가 던진 에러를 콘솔에서 바로 원인 구분이 되게 분류 — 신규 로그인 직후 데이터가 안 뜨는
// 문제를 조사할 때 "샘플로 조용히 폴백"이 아니라 정확히 어느 유형의 실패인지 남기기 위함
function _classifyFetchError(e){
  const msg=(e&&e.message)||String(e);
  if(/^TIMEOUT/.test(msg))return'TIMEOUT';
  if(/^HTTP 5/.test(msg))return'SERVER_5XX';
  if(e&&e.name==='TypeError')return'NETWORK_ERROR'; // fetch 자체가 못 나감(오프라인/CORS/DNS 등)
  return'SERVER_ERROR';
}

// AUTH_REQUIRED 자동 재시도(1회) 예약 — _gasFetch가 이미 내부적으로 토큰 갱신+재시도를 한 번
// 시도했는데도 AUTH_REQUIRED가 남아있으면, 5초 뒤 토큰을 다시 확인해서 한 번 더 시도함. 여러 호출이

async function fetchLive(forceFresh){
  const url=_getGasUrl();
  const token=_getToken();
  // 토큰 앞부분도 찍지 않는다 — 콘솔 로그는 화면 공유·스크린샷으로 쉽게 새어나간다
  console.log('[fetchLive] 요청 준비 — GAS URL 설정됨='+(!!url)+', 세션 존재='+(!!token));
  if(!url){
    // 서버 URL 자체가 없는 건 관리자가 ⚙ 연결 설정에서 등록해야 하는 상태 — 재시도로 해결되지 않으므로
    // "서버 연결 실패"가 아니라 "샘플 데이터"(데모 모드)로 명확히 구분해서 표시
    console.error('[fetchLive 실패] 사유: GAS_URL_MISSING — ⚙ 연결 설정에서 Apps Script Web App URL을 등록해야 합니다.');
    setConn('sample');
    return;
  }
  if(!token){
    // 여기 도달했다는 건 이미 로그인 흐름이 fetchLive를 부른 뒤라 정상적으로는 토큰이 있어야 함 —
    // 조용히 샘플로 넘기지 않고 실패로 남겨서(재시도 가능) 원인이 눈에 띄게 함
    console.error('[fetchLive 실패] 사유: NO_TOKEN — 로그인 토큰이 없는 상태에서 fetchLive가 호출됨');
    _connFail('NO_TOKEN');
    return;
  }
  if(!_usingCachedRender){setConn('loading');setLoad(true);}
  try{
    // 수동 새로고침(forceFresh)은 서버의 90초 캐시를 건너뛰고 항상 최신 데이터를 받아옴
    const reqUrl=_gasUrl(url)+(forceFresh?'&nocache=1':'');
    console.log('[fetchLive] 요청 URL(세션 마스킹)=',reqUrl.replace(/session=[^&]+/,'session=***'));
    const j=await _gasFetch(reqUrl,{});
    /* ⚠ 인증 실패를 버전 로그보다 **먼저** 처리한다. 예전엔 순서가 반대라, 세션이 만료된 응답
       (`{error:'AUTH_REQUIRED',reason}`)에도 버전 로그가 먼저 찍혀 "버전 필드 없음 — 구버전
       배포본"이 남았다. 실제로는 배포본이 낡은 게 아니라 인증에 막힌 것이라, 만료 문제를
       배포 문제로 오해하게 만드는 로그였다. 서버도 이제 에러 응답에 version을 싣는다. */
    if(j.error==='AUTH_REQUIRED'){
      /* _gasFetch가 이미 세션을 버리고 로그인 화면을 띄웠다. 예전처럼 5초 뒤 재시도하지 않는다 —
         세션이 죽은 상태에서 같은 요청을 반복해 봐야 똑같이 거절당하고 로그만 시끄러워진다.
         재로그인에 성공하면 onLoginSuccess → _enterDashboard가 이 요청을 다시 보낸다. */
      console.error('[fetchLive 실패] 사유: AUTH_REQUIRED — 재로그인 필요(사유는 위 [인증 거절] 로그 참고)');
      return;
    }
    console.log('[fetchLive] 응답 버전(Apps Script):',j.version||'(버전 필드 없음 — 구버전 배포본)',j.cached?'(캐시됨, '+j.execMs+'ms)':'(새로 계산, '+j.execMs+'ms)');
    if(j.version&&j.version!==REQUIRED_SCRIPT_VERSION){
      console.warn(`[버전 불일치] 배포된 Apps Script=${j.version} / 프론트가 필요로 하는 버전=${REQUIRED_SCRIPT_VERSION} — Apps Script를 재배포해야 할 수 있습니다(프론트 전용 변경이면 이 경고는 무시해도 됨).`);
    }
    if(j.error){console.error('[fetchLive 실패] 사유: SERVER_ERROR —',j.error);throw new Error(j.error);}
    _hideReloginBanner();
    const _withReels=(j.purchases||[]).filter(p=>Array.isArray(p.reels)&&p.reels.length);
    console.log('[6.fetchLive 응답] 릴스 있는 공구건 수=',_withReels.length,
      _withReels.length?JSON.stringify(_withReels.map(p=>({id:p.id,product:p.product,channel:p.channel,reels:p.reels}))):'');
    // [진단] 시작일(start)이 실제로 채워져 오는지 직접 확인 — 캘린더/연도필터/품목별실적이 전부
    // "데이터 없음"으로 보일 때, purchases 자체는 있는데 start만 비어있는 건 아닌지 여기서 바로 확인
    const _purchases=j.purchases||[];
    console.log('[7.fetchLive 진단] 총 건수=',_purchases.length,
      '/ start 있는 건수=',_purchases.filter(p=>p.start).length,
      '/ 첫 건 원본(raw)=',JSON.stringify(_purchases[0]));
    const adapted=adaptGAS(j);
    console.log('[7.fetchLive 진단] adaptGAS 이후 첫 건 start=',adapted&&adapted[0]&&adapted[0].start,'/ start 있는 건수=',adapted?adapted.filter(d=>d.start).length:0);
    if(adapted){
      const statusCounts={};
      adapted.forEach(d=>{statusCounts[d.status]=(statusCounts[d.status]||0)+1;});
      console.log('[8.fetchLive 진단] 상태별 건수(서버 응답 기준)=',JSON.stringify(statusCounts),'/ 전체=',adapted.length);
    }
    if(adapted&&adapted.length){
      const merged=_mergeDuplicateCodeRows(adapted);
      /* 병합 건수는 0이 정상이다 — 시트의 dealId가 통일돼 있으면 서버가 이미 한 건으로 내려준다.
         0이 아니면 시트에 직접 입력돼 dealId가 제각각인 행이 있다는 뜻이라 눈에 띄게 경고한다. */
      const composites=merged.filter(d=>d._isComposite);
      console.log('[9.그룹핑 진단] adaptGAS 건수=',adapted.length,'/ 내용 기준 병합 후 건수=',merged.length,
        '/ 병합된(다중 dealId) 건수=',composites.length);
      if(composites.length){
        console.warn('[그룹핑] 시트 직접 입력으로 보이는 건 '+composites.length+'개 — dealId 통일이 필요합니다:',
          composites.map(d=>({채널:d.ch,제품:d.product,기간:d.start+'~'+d.end,dealIds:d._mergedDealIds})));
      }
      DATA.splice(0,DATA.length,...merged);
      EVENTS.splice(0,EVENTS.length,...adaptGASEvents(j));
      _tierSyncReady=true; // 실서버 데이터를 받은 뒤에만 시트 기록 허용(샘플/로컬캐시로 덮어쓰기 방지)
      _connOk();setConn('live');render();
      _saveDataCache(j);
    }else throw new Error('데이터가 비어있습니다');
  }catch(e){
    const reason=_classifyFetchError(e);
    console.error('[fetchLive 실패] 사유: '+reason+' —',e);
    _connFail(reason);
  }
  finally{setLoad(false);_usingCachedRender=false;}
}

function adaptGAS(j){
  if(!j.purchases||!Array.isArray(j.purchases))return null;
  return j.purchases.map((p,i)=>({
    id:p.id!=null?p.id:i+1,dealId:p.dealId||'',brand:p.brand||'',product:p.product||'',ch:p.channel||p.influencer||'',
    influencer:p.influencer||'',vendor:p.vendor||'',platform:p.platform||'',format:p.format||'',
    chId:p.chId||'',link:p.link||(p.chId?buildChannelLink(p.platform,p.chId):''),
    marketingLink:p.marketingLink||'',
    profileLink:p.profileLink||'',
    start:normDate(p.start),end:normDate(p.end),
    composition:p.composition||'',
    targetQty:p.targetQty!=null?Number(p.targetQty):null,
    // option2=오픈시간, firstCome=선착순 품목, note=적립금으로 재사용됨(공구건 모달 드롭다운 개편,
    // 2026-08-18) — 필드명은 apps-script.js와 그대로 맞춘 것. 구 추가옵션1(option1)은 더 이상 안 씀.
    option2:p.option2||'',firstCome:p.firstCome||'',firstComeQty:p.firstComeQty!=null?String(p.firstComeQty):'',
    note:p.note||'',
    giftItem1:p.giftItem1||'',giftQty1:p.giftQty1!=null?String(p.giftQty1):'',
    giftItem2:p.giftItem2||'',giftQty2:p.giftQty2!=null?String(p.giftQty2):'',
    giftItem3:p.giftItem3||'',giftQty3:p.giftQty3!=null?String(p.giftQty3):'',
    extraQty:p.extraQty!=null?Number(p.extraQty):null,
    // 채널 단위 속성(플랫폼 ID) — 시트에 열이 없으면 서버가 빈 문자열로 내려줌
    igId:p.igId||'',ytId:p.ytId||'',
    tier:p.tier||'', // 인플루언서 등급(빈 문자열=미분류) — 기존 건은 계속 빈 값으로 들어옴
    // 팔로워 수(공구 당시) — 미입력은 null. 0은 실제 값이므로 null로 뭉개지 않게 !=null로 판정
    followers:p.followers!=null?Number(p.followers):null,
    status:p.status||'예정',
    views:p.views!=null?Number(p.views):null,qty:p.qty!=null?Number(p.qty):null,rev:p.revenue!=null?Number(p.revenue):null,
    codes:Array.isArray(p.codes)?p.codes:[],reels:Array.isArray(p.reels)?p.reels:[],
    rowCount:p.rowCount!=null?Number(p.rowCount):1,
    // 실적이 들어 있는 시트 행 수 — 2 이상이면 상품코드별로 실적이 나뉜 건(모달에서 판매수량 잠금)
    perfRows:p.perfRows!=null?Number(p.perfRows):(p.qty!=null||p.revenue!=null?1:0),
    // 이 공구건이 차지하는 시트 행들의 [행번호, 현재 매출등급 셀값, 현재 팔로워등급 셀값].
    // 등급 되기록(syncTiersToSheet)에서 "이미 같은 값이면 안 보내기" 비교용으로만 씀 —
    // 시트에 사람이 직접 적어 넣은 값이라도 등급 판정에는 절대 반영하지 않는다(결과 칸이므로).
    _tierRows:Array.isArray(p.tierRows)?p.tierRows:[],
    s:{retail:p.retail!=null?Number(p.retail):null,sale:p.sale!=null?Number(p.sale):null,comm:p.commission!=null?Number(p.commission):null,note:p.note2||''}
  }));
}

// 시트에 상품코드별로 여러 행에 나뉘어 입력된 건(제품·채널명·시작일·종료일이 모두 같은 행들)을
// 하나의 공구건으로 합침. 정상적으로는 dealId 하나를 공유해야 하지만(등록 폼으로 만든 건은 항상
// 그렇게 저장됨), 과거에 시트에 수동으로 입력된 행들은 dealId가 서로 다르거나 비어 있을 수 있어
// 그런 경우까지 내용 기준으로 찾아서 합쳐줌. adaptGAS로 이미 dealId 그룹 단위(서버 쪽)로 한 번
// 합쳐진 배열을 입력으로 받아, 그 원소들 중 내용이 완전히 같은 것들을 한 번 더 합친다.
function _mergeDuplicateCodeRows(deals){
  const groups=new Map(); // key -> deal[]
  const order=[];
  deals.forEach(d=>{
    const key=[normP(d.product),(d.ch||'').trim(),d.start||'',d.end||''].join('|');
    if(!groups.has(key)){groups.set(key,[]);order.push(key);}
    groups.get(key).push(d);
  });

  return order.map(key=>{
    const members=groups.get(key);
    if(members.length===1){
      const only=members[0];
      return{...only,_rowCount:only.rowCount||1,_isComposite:false};
    }

    const first=members[0];

    // 상품코드: 전부 모아서 중복 제거(순서 유지)
    const codes=[...new Set(members.flatMap(m=>m.codes||[]))];

    // 판매수량/총매출: 합산(규칙상 첫 행에만 값이 있어야 하므로 결과는 사실상 첫 행 값과 같음.
    // 2개 이상의 행에 값이 있으면 운영 규칙 위반이니 경고만 남기고 합산은 그대로 진행)
    const qtyRows=members.filter(m=>m.qty!=null);
    const revRows=members.filter(m=>m.rev!=null);
    if(qtyRows.length>1)console.warn('[그룹핑] "'+key+'" — 판매수량이 2개 이상 행에 기입돼 있습니다(운영 규칙 위반 의심):',qtyRows);
    if(revRows.length>1)console.warn('[그룹핑] "'+key+'" — 총매출이 2개 이상 행에 기입돼 있습니다(운영 규칙 위반 의심):',revRows);
    const qty=qtyRows.length?qtyRows.reduce((s,m)=>s+m.qty,0):null;
    const rev=revRows.length?revRows.reduce((s,m)=>s+m.rev,0):null;

    // 조회수: 값 있는 행 기준으로 합산(마찬가지로 보통 첫 행에만 있음)
    const viewRows=members.filter(m=>m.views!=null);
    if(viewRows.length>1)console.warn('[그룹핑] "'+key+'" — 조회수가 2개 이상 행에 기입돼 있습니다(운영 규칙 위반 의심):',viewRows);
    const views=viewRows.length?viewRows.reduce((s,m)=>s+m.views,0):null;

    // 릴스: 값 있는 행 기준으로 전부 합치고 URL 기준 중복 제거
    const reelMap=new Map();
    members.forEach(m=>(m.reels||[]).forEach(r=>{
      const rk=r.url||('__noturl_'+reelMap.size);
      if(!reelMap.has(rk))reelMap.set(rk,r);
    }));
    const reels=[...reelMap.values()];

    // 그 외 필드: 첫 행 기준, 행마다 값이 다르면 경고만 남김(첫 행 값 사용).
    // 'noteText'는 실제 필드가 아니라 s.note(신규 자유입력 비고)를 비교하기 위한 가상 키.
    const scalarFields=['vendor','platform','format','composition','marketingLink','note','noteText','option2','firstCome','firstComeQty','targetQty','extraQty','link','status','giftItem1','giftQty1','giftItem2','giftQty2','giftItem3','giftQty3','tier'];
    scalarFields.forEach(f=>{
      members.slice(1).forEach(m=>{
        const a=f==='noteText'?(first.s&&first.s.note):first[f];
        const b=f==='noteText'?(m.s&&m.s.note):m[f];
        if(a!=null&&b!=null&&String(a)!==String(b)){
          console.warn('[그룹핑] "'+key+'" — "'+f+'" 값이 행마다 다릅니다(첫 행 값 사용): 첫 행='+a+' / 다른 행='+b);
        }
      });
    });
    const saleVals=[...new Set(members.map(m=>m.s&&m.s.sale).filter(v=>v!=null))];
    const commVals=[...new Set(members.map(m=>m.s&&m.s.comm).filter(v=>v!=null))];
    if(saleVals.length>1)console.warn('[그룹핑] "'+key+'" — 공구가가 행마다 다릅니다:',saleVals);
    if(commVals.length>1)console.warn('[그룹핑] "'+key+'" — 수수료율이 행마다 다릅니다:',commVals);

    const rowCount=members.reduce((s,m)=>s+(m.rowCount||1),0);
    // 병합된 건의 실적 행 수도 합산 — 합쳐진 쪽이 바로 '행마다 실적이 있는' 전형적인 경우다
    const perfRows=members.reduce((s,m)=>s+(m.perfRows||0),0);
    const isComposite=new Set(members.map(m=>m.dealId).filter(Boolean)).size>1||members.some(m=>!m.dealId);

    return{
      ...first,
      codes,qty,rev,views,reels,
      // 내용 기준으로 합쳐진 건이라 시트 행도 여러 dealId에 흩어져 있음 — 전부 이어붙여야
      // 그 채널의 모든 행에 등급이 기록됨(첫 건 것만 남기면 나머지 행이 영영 빈칸으로 남음)
      _tierRows:members.flatMap(m=>m._tierRows||[]),
      _rowCount:rowCount,
      perfRows,
      _isComposite:isComposite,
      _mergedDealIds:members.map(m=>m.dealId)
    };
  });
}

// 캘린더 "프로모션/이벤트 일정" — 공구 데이터(DATA)와 완전히 분리된 EVENTS 배열로 적재
function adaptGASEvents(j){
  if(!j.calendarEvents||!Array.isArray(j.calendarEvents))return[];
  return j.calendarEvents.map((e,i)=>({
    id:e.id!=null?e.id:i+1,
    name:e.name||'',
    start:normDate(e.start),
    end:normDate(e.end||e.start),
    note:e.note||''
  }));
}
function normDate(v){if(!v)return'';if(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v))return v;const d=new Date(v);if(!isNaN(d))return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;return String(v);}

async function refreshData(){
  const btn=document.getElementById('refreshBtn');btn.classList.add('spinning');btn.disabled=true;
  await fetchLive(true); // 수동 새로고침(새로고침 버튼·연결뱃지 클릭)은 서버 캐시를 건너뜀
  setTimeout(()=>{btn.classList.remove('spinning');btn.disabled=false;},500);
}
