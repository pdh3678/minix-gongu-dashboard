'use strict';
/* 인플루언서 등급 — 매출/팔로워 등급 산정, 기준표 문구, 시트 G·H열 되기록. */

/* ── 인플루언서 등급(한 곳에서 관리) ────────────────────────────────────────
   등급 목록·정렬 순서·배지 색을 이 배열 하나로 정의 — 위 PRODUCT_TAXONOMY와 같은 방식.
   배열 순서가 곧 모든 테이블/차트/범례/정렬의 기준 순서라, 순서를 바꾸면 화면 전체가 따라 바뀜. */
const TIER_TAXONOMY=[
  {key:'메가',     label:'메가',     color:{bg:'#EDE9FE',fg:'#6D28D9'}},
  {key:'매크로',   label:'매크로',   color:{bg:'#DBEAFE',fg:'#1D4ED8'}},
  {key:'마이크로', label:'마이크로', color:{bg:'#D1FAE5',fg:'#047857'}},
  {key:'나노',     label:'나노',     color:{bg:'#FEF3C7',fg:'#B45309'}},
];
const TIER_OPTIONS=TIER_TAXONOMY.map(t=>t.key);
const TIER_UNRATED='미산정'; // 완료 실적이 없어 자동 산정이 불가능한 채널(+수동 지정도 없는 경우)
const TIER_FOLLOWER_UNSET='미입력'; // 팔로워 수가 시트에 없어 팔로워등급을 판정할 수 없는 채널
const TIER_COLORS=Object.assign({},...TIER_TAXONOMY.map(t=>({[t.key]:t.color})),
  {[TIER_UNRATED]:{bg:'#F3F4F6',fg:'#6B7280'},[TIER_FOLLOWER_UNSET]:{bg:'#F3F4F6',fg:'#6B7280'}});
const TIER_MIN_SAMPLE=3; // 이 건수 미만이면 등급별 성과 표/차트에서 "표본 적음"으로 표시

/* ── 등급 자동 산정 (2026-09-10 전환) ───────────────────────────────────────
   등급은 더 이상 사람이 건별로 고르는 값이 아니라 "그 채널의 과거 실적"에서 계산함.
   시트의 등급 열은 이제 '수동 지정'(예외 처리) 전용이고, 비어 있는 게 정상.
   산정은 전부 프론트에서 함 — GAS는 수동 지정 값의 읽기/쓰기만 담당(집계를 서버에 두면 시트
   파싱이 무거워지고, 임계값을 바꿀 때마다 Apps Script 재배포가 필요해짐).

   기준: '완료' + 매출이 실제로 기록된 건만 놓고 평균/최대를 구한 뒤, 평균 기준 등급과 최대 기준
   등급을 각각 판정해 "더 높은 쪽"을 채택 — 한 번 크게 터뜨린 채널이 평균에 묻히지 않게 하려는 것.
   매출 미기입 완료 건을 0으로 세면 평균이 실제보다 낮게 나오므로 아예 대상에서 뺀다.
   임계값을 바꾸려면 TIER_RULES만 고치면 됨(모달 기준표 툴팁도 여기서 자동 생성됨). */
const TIER_RULES=[
  {tier:'메가',     avg:100000000, max:1000000000},
  {tier:'매크로',   avg: 50000000, max:  500000000},
  {tier:'마이크로', avg: 20000000, max:  200000000},
]; // 어느 기준에도 못 미치면 TIER_FALLBACK
const TIER_FALLBACK='나노';

/* ── 팔로워등급 (2026-09-11) ────────────────────────────────────────────────
   등급을 "매출 축"과 "팔로워 축" 두 개로 나눔. 위의 TIER_RULES로 나오는 등급은 이제 화면에서
   **매출등급**으로 부르고(수동 지정 우선 규칙은 그대로), 여기 FOLLOWER_RULES로 나오는 등급이
   **팔로워등급**이다.
   팔로워등급은 누적 평균이 아니라 "채널의 가장 최근 팔로워 수" 하나만 보고 판정한다 — 팔로워는
   과거값을 평균 내면 성장한 채널이 계속 낮게 잡히는, 시점이 곧 의미인 값이기 때문.
   두 등급의 차이(갭)가 "팔로워 규모 대비 얼마나 잘 파는 채널인가"를 나타낸다. */
const FOLLOWER_RULES=[
  {tier:'메가',     min:1000000},
  {tier:'매크로',   min: 100000},
  {tier:'마이크로', min:  10000},
]; // 어느 기준에도 못 미치면 FOLLOWER_FALLBACK
const FOLLOWER_FALLBACK='나노';
// 팔로워 수 → 팔로워등급. null(미입력)은 '나노'로 떨어뜨리지 않고 별도 값으로 구분함 —
// "팔로워가 적은 채널"과 "아직 안 적은 채널"을 섞으면 갭 분석이 통째로 오염됨.
function followerTierOf(n){
  if(n==null)return TIER_FOLLOWER_UNSET;
  for(let i=0;i<FOLLOWER_RULES.length;i++)if(n>=FOLLOWER_RULES[i].min)return FOLLOWER_RULES[i].tier;
  return FOLLOWER_FALLBACK;
}
// 갭 계산용 점수 — 나노=0 … 메가=3. TIER_OPTIONS는 메가가 앞(0)이라 방향이 반대인 점에 주의.
// 미산정/미입력은 null → 갭도 null(어느 한쪽이라도 없으면 갭은 의미가 없음).
function tierScore(t){const i=TIER_OPTIONS.indexOf(t);return i===-1?null:TIER_OPTIONS.length-1-i;}
function tierGapOf(revTier,fTier){
  const a=tierScore(revTier),b=tierScore(fTier);
  return(a==null||b==null)?null:a-b; // 범위 −3 ~ +3
}
// 갭 해석 — 팔로워 규모보다 매출등급이 높으면 고효율, 낮으면 저효율
function gapKind(g){return g==null?null:g>=1?'high':g<=-1?'low':'even';}
function gapLabelOf(g){const k=gapKind(g);return k?{high:'고효율',even:'적정',low:'저효율'}[k]:'';}
const GAP_COLORS={high:{bg:'#DCFCE7',fg:'#15803D'},even:{bg:'#F3F4F6',fg:'#6B7280'},low:{bg:'#FFEDD5',fg:'#C2410C'}};
// "▲+1 고효율" / "● 적정" / "▼−2 저효율" — 부호는 수학 기호(−)로 통일해 하이픈과 헷갈리지 않게 함
function gapBadge(g){
  if(g==null)return'<span style="color:var(--text-3)">—</span>';
  const k=gapKind(g),c=GAP_COLORS[k];
  const sign=g>0?` +${g}`:g<0?` −${Math.abs(g)}`:'';
  return`<span class="bp bp-gap" style="background:${c.bg};color:${c.fg}">${k==='high'?'▲':k==='low'?'▼':'●'}${sign} ${gapLabelOf(g)}</span>`;
}
/* ── 만 단위 공용 포맷터 (2026-09-11) ──────────────────────────────────────
   팔로워 수는 저장은 명 단위 숫자 그대로지만 화면에는 어디서나 만 단위로만 보여준다.
   수동 입력값이라 "443,000"처럼 명 단위 정수를 그대로 노출하면 실제로 센 숫자처럼 읽혀
   오해를 부르기 때문 — 그래서 툴팁·상세를 포함해 표시 경로에는 명 단위를 쓰지 않는다.
   (조회수는 시트에 이미 만 단위로 저장돼 있어 재사용할 포맷터가 없었고, 이 함수가 그 역할을 겸함.)
     100만 이상    → 정수 만 (152만, 1,230만)
     1만~100만 미만 → 소수 1자리 (8.5만, 44.3만)
     1만 미만      → 천 단위 콤마 (8,500)
   opts.decimals로 소수 자릿수를 바꿀 수 있다(기본 1). 기준표 툴팁처럼 "딱 떨어지는 임계값"을
   보여주는 자리에서는 0을 줘서 "10.0만/1.0만"이 아니라 "10만/1만"으로 읽히게 한다 — 실측값과
   달리 임계값은 소수 자리가 정보가 아니라 잡음이다. */
function formatMan(n,opts){
  if(n==null)return'—';
  if(n>=1000000)return Math.round(n/10000).toLocaleString('ko-KR')+'만';
  if(n>=10000)return(n/10000).toFixed((opts&&opts.decimals!=null)?opts.decimals:1)+'만';
  return Math.round(n).toLocaleString('ko-KR');
}
// 팔로워등급 기준표 툴팁 — FOLLOWER_RULES에서 생성(매출등급의 tierCriteriaText와 같은 방식)
function followerCriteriaText(){
  return['팔로워등급 기준 (채널의 가장 최근 팔로워 수)']
    .concat(FOLLOWER_RULES.map(r=>`${r.tier}: ${formatMan(r.min,{decimals:0})} 이상`))
    .concat([`${FOLLOWER_FALLBACK}: 그 외`,`${TIER_FOLLOWER_UNSET}: 팔로워 수가 입력되지 않은 채널`,
      '입력·표시는 모두 만 단위(수동 입력값)'])
    .join('\n');
}

// 금액을 "6,200만" / "3.1억"처럼 짧게 — 모달 한 줄 요약과 근거 툴팁 전용(표에는 won()을 그대로 씀)
function wonShort(n){
  if(n==null)return'—';
  const a=Math.abs(n);
  if(a>=100000000)return(Math.round(n/100000000*10)/10).toLocaleString('ko-KR')+'억';
  if(a>=10000)return Math.round(n/10000).toLocaleString('ko-KR')+'만';
  return won(n);
}
/* 등급 임계값 전용 금액 표기 — 억/천만으로 끊어 읽는다.
   wonShort는 실측 금액용이라 5천만을 "5,000만"으로 내놓는데, 기준표에서는 자릿수를 세게 만들어
   비교가 느려진다. 임계값은 늘 억·천만 단위로 딱 떨어지므로 그 단위로 보여주는 게 읽기 쉽다. */
function tierAmountShort(n){
  if(n==null)return'—';
  const q=(v,d)=>(Math.round(v/d*10)/10).toLocaleString('ko-KR');
  if(n>=100000000)return q(n,100000000)+'억';
  if(n>=10000000)return q(n,10000000)+'천만';
  return wonShort(n);
}
/* 매출등급 기준표 툴팁 — TIER_RULES에서 생성해 상수와 화면 문구가 어긋날 수 없게 함.
   채널별 성과 표의 '매출등급' 헤더 ⓘ, 모달/등록 폼의 '등급 수동 지정'·'등급 상태' ⓘ가 전부
   이 한 함수를 쓴다(문구를 손댈 일이 생기면 여기만 고치면 된다).
   구성은 followerCriteriaText와 같은 순서로 맞춘다 — 헤더 → 등급별 임계값 → 나머지 → 보조 설명.
   두 툴팁을 나란히 띄웠을 때 같은 자리에서 같은 종류의 정보를 읽게 하기 위한 것. */
function tierCriteriaText(){
  return['매출등급 기준 (채널의 전체 기간 완료 건 매출, 필터와 무관)']
    .concat(TIER_RULES.map(r=>`${r.tier}: 평균 ${tierAmountShort(r.avg)} 이상 또는 최대 ${tierAmountShort(r.max)} 이상`))
    .concat([`${TIER_FALLBACK}: 그 외`,
      '판정: 평균 기준 등급과 최대 기준 등급 중 높은 쪽',
      /* 아래 세 줄을 "A / B / C" 한 줄로 붙이지 말 것. 브라우저 기본 title 툴팁은 폭을 CSS로
         정할 수 없고 가장 긴 줄이 박스 너비를 결정하는데, 한 줄로 붙이면 62자가 되어 팔로워등급
         툴팁(최장 26자)보다 두 배 넘게 넓은 상자가 떠 나란히 보면 따로 논다. */
      '잠정: 완료 건이 1건일 때',
      `${TIER_UNRATED}: 완료 건이 없을 때`,
      '수동: 수동 지정 값이 자동 산정을 덮어쓴 경우'])
    .join('\n');
}
// 매출·팔로워 두 기준을 한 번에 보여주는 자리(모달 '등급 상태' 박스)용 — 두 문구를 그대로 재사용한다
function tierAndFollowerCriteriaText(){
  return tierCriteriaText()+'\n\n'+followerCriteriaText();
}

function _tierByRule(value,key){
  if(value==null)return null;
  for(let i=0;i<TIER_RULES.length;i++)if(value>=TIER_RULES[i][key])return TIER_RULES[i].tier;
  return TIER_FALLBACK;
}
// 두 등급 중 더 높은(=TIER_OPTIONS에서 앞선) 쪽
function _higherTier(a,b){
  if(!a)return b||null;
  if(!b)return a;
  return TIER_OPTIONS.indexOf(a)<=TIER_OPTIONS.indexOf(b)?a:b;
}
function _autoTierFrom(revs){
  if(!revs.length)return null;
  const avg=revs.reduce((s,v)=>s+v,0)/revs.length;
  const max=Math.max.apply(null,revs);
  return{tier:_higherTier(_tierByRule(avg,'avg'),_tierByRule(max,'max')),avg,max};
}

// 채널명 → 산정 결과 캐시. DATA가 바뀔 때만 다시 계산하면 되므로 render()에서 무효화하고,
// 필터만 바뀌는 재렌더(renderDashboard)에서는 그대로 재사용함.
let _tierStatsCache=null;
function invalidateTierStats(){_tierStatsCache=null;}
function tierStats(){
  if(!_tierStatsCache)_tierStatsCache=_computeTierStats(DATA);
  return _tierStatsCache;
}
// 등급 산정에 들어가는 건인지 — 툴팁의 "기간 내 완료 N건"도 같은 기준을 써야 누적 건수와 비교가 됨
function _isTierCountable(d){return _displayStatus(d)==='완료'&&d.rev!=null;}
function _computeTierStats(deals){
  const byCh=new Map();
  (deals||[]).forEach(d=>{
    const ch=(d.ch||d.influencer||'').trim();
    if(!ch)return;
    if(!byCh.has(ch))byCh.set(ch,[]);
    byCh.get(ch).push(d);
  });
  const map=new Map();
  byCh.forEach((items,ch)=>{
    const done=items.filter(_isTierCountable)
                    .sort((a,b)=>String(a.start||'').localeCompare(String(b.start||'')));
    const revs=done.map(d=>d.rev);
    const cur=_autoTierFrom(revs);
    // 직전 완료 건 시점의 자동 등급 — 마지막 한 건을 빼고 다시 계산해 승격/강등(▲▼)을 판정
    const prev=_autoTierFrom(revs.slice(0,-1));
    /* 수동 지정 우선순위 규칙 — 값은 건별로 저장되지만 등급의 의미는 채널 단위라, 한 채널의
       여러 건에 서로 다른 수동 값이 있을 수 있다. 이때는 **가장 최근 공구건(시작일 기준)의 값**을
       그 채널의 수동 등급으로 채택한다 — 등급이 바뀌었다면 최신 판단이 정답이기 때문.
       시작일이 같으면 시트에서 아래쪽(=나중에 추가된) 행이 이기도록 id로 한 번 더 정렬해
       결과가 매 렌더마다 흔들리지 않게 고정한다.
       해제는 채널별 성과 표의 '수동' 배지 → 되돌리기(clearChannelTier)로 그 채널의 모든 행을
       한 번에 비우는 것이 정규 경로다. 한 건만 비우면 남은 건의 값이 다시 승격돼 안 지워진 것처럼 보인다. */
    const manualItems=items.filter(d=>manualTierOf(d))
      .sort((a,b)=>String(b.start||'').localeCompare(String(a.start||''))||((b.id||0)-(a.id||0)));
    const manualSrc=manualItems[0];
    const manual=manualSrc?manualTierOf(manualSrc):'';
    const auto=cur?cur.tier:null;
    /* 팔로워 수는 "가장 최근에 입력된 값" 하나만 씀 — 건별 스냅샷이라 평균을 내면 의미가 사라지고,
       GAS updateChannelFollowers도 같은 규칙(가장 최근 공구건 행)에 쓰기 때문에 읽기/쓰기가 한 지점에서
       만난다. 시작일이 같으면 id가 큰(=시트에서 아래쪽) 행이 이기도록 해서 결과를 고정. */
    const withF=items.filter(d=>d.followers!=null)
      .sort((a,b)=>String(a.start||'').localeCompare(String(b.start||''))||((a.id||0)-(b.id||0)));
    const fSrc=withF[withF.length-1];
    const followerCount=fSrc?fSrc.followers:null;
    const followerTier=followerTierOf(followerCount);
    const effective=manual||auto||TIER_UNRATED;
    const gap=tierGapOf(effective,followerTier);
    map.set(ch,{
      channel:ch,auto,manual,
      effective,
      revTier:effective, // 축 이름이 생긴 뒤의 별칭 — 값은 effective와 항상 같음(기존 호출부 호환)
      followerCount,followerTier,gap,gapLabel:gapLabelOf(gap),
      followerAt:fSrc?fSrc.start:'', // 그 팔로워 수가 기록된 공구건의 시작일(툴팁 "2026.08 기준"용)
      followerDealId:fSrc?fSrc.dealId:'',
      avg:cur?cur.avg:null,max:cur?cur.max:null,count:done.length,
      provisional:done.length===1,
      prevAuto:prev?prev.tier:null,
      manualDealId:manualSrc?manualSrc.dealId:'',
      manualCount:manualItems.length, // 수동 값이 들어 있는 건 수(모달 안내·되돌리기 문구용)
      // 산정에 실제로 들어간 완료 건의 최초/최근 시작일 — 툴팁의 "전체 기간 누적 기준 (…~…)" 표기용
      firstDone:done.length?done[0].start:'',lastDone:done.length?done[done.length-1].start:''
    });
  });
  return map;
}

// 채널명으로 산정 결과 조회 — 앞뒤 공백/대소문자만 다른 표기도 같은 채널로 찾아줌(모달 입력 대응)
function tierStatOf(ch){
  const key=String(ch||'').trim();
  if(!key)return null;
  const m=tierStats();
  if(m.has(key))return m.get(key);
  const norm=_dashInfluencerNorm(key);
  for(const[k,v]of m)if(_dashInfluencerNorm(k)===norm)return v;
  return null;
}
// 이 공구건 행에 저장된 "수동 지정" 값(허용값 밖/빈값이면 빈 문자열)
function manualTierOf(d){const t=String((d&&d.tier)||'').trim();return TIER_OPTIONS.includes(t)?t:'';}
// 화면·집계에서 쓰는 실효 매출등급 = 채널 단위(수동 지정 > 자동 산정 > 미산정). 건별 값이 아님에 유의.
function effectiveTierOfChannel(ch){const s=tierStatOf(ch);return s?s.effective:TIER_UNRATED;}
function effectiveTierOf(d){return effectiveTierOfChannel(d&&(d.ch||d.influencer));}
// 팔로워 축의 같은 쌍 — 매출등급과 완전히 대칭이라 집계 코드가 축만 바꿔 끼우면 되게 함
function followerTierOfChannel(ch){const s=tierStatOf(ch);return s?s.followerTier:TIER_FOLLOWER_UNSET;}
function followerTierOf_(d){return followerTierOfChannel(d&&(d.ch||d.influencer));}
function followerCountOfChannel(ch){const s=tierStatOf(ch);return s?s.followerCount:null;}

/* ── 등급 결과를 시트 G·H열에 되기록 (2026-09-14) ───────────────────────────
   등급은 전부 프론트가 산정하는 값이라, 시트만 보는 사람에게는 보이지 않는다는 문제가 있었다.
   그래서 재계산이 끝날 때마다 "지금 화면이 보고 있는 등급"을 시트의 '매출등급'/'팔로워 등급'
   열에 그대로 되비춰 준다(사람이 채우는 칸이 아니라 결과 칸 — 헤더 메모로도 못 박아 둠).

   설계에서 중요한 세 가지:
   · **채널 단위 값을 행 단위로 편다** — 등급은 채널 속성이므로 그 채널이 등장하는 모든 물리 행에
     같은 값을 쓴다. 공구건 하나가 상품코드 수만큼 여러 행을 차지하고 그 행들이 시트에서 붙어 있지도
     않아서, 서버가 건별로 내려주는 _tierRows(행 번호 + 현재 셀값)를 그대로 펼쳐 쓴다.
   · **차이가 없으면 요청 자체를 안 보낸다** — 그래서 render()마다 불려도 안전하다. 정상 상태에서는
     보낼 행이 0개라 네트워크 호출이 아예 일어나지 않고, 값이 실제로 달라진 순간에만 한 번 나간다.
     (초기 로드/공구건 저장/수동 지정 변경/팔로워 수 편집/완료 전환이 전부 render()를 거치므로,
      기록 시점을 경로마다 따로 챙길 필요가 없음 — 한 곳에 걸어두면 전부 커버된다.)
   · **실패해도 화면에는 아무 영향이 없어야 한다** — 조용히 1회 재시도하고, 그래도 안 되면 콘솔
     경고까지만. 대시보드 표시는 전적으로 로컬 산정 결과를 쓰므로 시트 기록 성공 여부와 무관하다. */
let _tierSyncReady=false; // fetchLive가 한 번이라도 성공해야 시작 — 샘플/로컬캐시 렌더로 시트를 덮어쓰지 않게
let _tierSyncBusy=false;  // 전송 중 중복 실행 방지
let _tierSyncAgain=false; // 전송 중에 또 바뀌었으면 끝난 뒤 한 번 더

// 이 채널에 기록할 [매출등급, 팔로워등급]. 미산정(매출축)/미입력(팔로워축)은 빈 문자열 = 시트도 빈칸.
function _tierCellsFor(ch){
  const st=tierStatOf(ch);
  return[
    st&&isRatedTier(st.effective)?st.effective:'',
    st&&isRatedTier(st.followerTier)?st.followerTier:''
  ];
}

// 시트 현재값과 달라서 실제로 써야 하는 행만 모음. _tierRows 원소는 [행번호, 현재 매출등급, 현재 팔로워등급].
function _collectTierWrites(){
  const out=[];
  DATA.forEach(d=>{
    const rows=d._tierRows;
    if(!Array.isArray(rows)||!rows.length)return;
    const[sales,follower]=_tierCellsFor(d.ch||d.influencer);
    rows.forEach(r=>{
      if(String(r[1]||'')===sales&&String(r[2]||'')===follower)return;
      out.push({rowIndex:r[0],salesTier:sales,followerTier:follower,_cell:r});
    });
  });
  return out;
}

async function syncTiersToSheet(){
  if(!_tierSyncReady)return;
  if(_tierSyncBusy){_tierSyncAgain=true;return;}
  const url=_getGasUrl();
  if(!url)return;
  const pending=_collectTierWrites();
  if(!pending.length)return; // 정상 상태 — 여기서 조용히 끝나는 게 대부분의 호출
  _tierSyncBusy=true;
  const payload={rows:pending.map(p=>({rowIndex:p.rowIndex,salesTier:p.salesTier,followerTier:p.followerTier}))};
  try{
    let j=await _gasWrite(url,'writeTiers',payload);
    if(!j||j.success!==true||j.error){
      console.warn('[등급 시트 기록] 1차 실패 — 조용히 1회 재시도:',(j&&j.error)||j);
      j=await _gasWrite(url,'writeTiers',payload);
    }
    if(!j||j.success!==true||j.error)throw new Error((j&&j.error)||'writeTiers 응답에 success:true가 없습니다');
    // 서버가 받아들인 값으로 로컬 사본을 맞춰둬야 다음 render()에서 같은 행을 또 보내지 않음
    // (서버 캐시는 _handleWriteAction이 쓰기 직후 알아서 무효화하므로 여기서 따로 할 일 없음)
    pending.forEach(p=>{p._cell[1]=p.salesTier;p._cell[2]=p.followerTier;});
    console.log('[등급 시트 기록] 전송 '+pending.length+'행 / 시트 갱신 '+(j.written!=null?j.written:'?')+'행');
  }catch(e){
    console.warn('[등급 시트 기록] 실패 — 대시보드 표시에는 영향 없음:',e);
  }finally{
    _tierSyncBusy=false;
    if(_tierSyncAgain){_tierSyncAgain=false;syncTiersToSheet();}
  }
}
