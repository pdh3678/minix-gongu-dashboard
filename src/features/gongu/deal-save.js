'use strict';
/* 공구건 저장 낙관적 반영 — 저장 잠금, 스냅샷/롤백, 저장 시간 로그. */

/* ── 저장 낙관적 반영 (2026-09-15) ────────────────────────────────────────────
   예전 저장은 "요청 → 응답 → 전체 재조회(fetchLive) → 등급 기록"을 직렬로 기다린 뒤에야 모달이
   닫혔다. HTTP 왕복 3~4회 + 시트 6.7만 셀 읽기라 수 초가 걸렸고, 그동안 화면은 로딩 오버레이로
   덮여 있었다.

   이제는 순서를 뒤집는다: 사용자가 입력한 값을 **먼저** 로컬 DATA에 반영하고 모달을 즉시 닫은 뒤,
   저장 요청은 뒤에서 보낸다. 서버가 돌려주는 것 중 프론트가 스스로 알 수 없는 값은 행 번호와
   dealId뿐이라(나머지는 방금 사용자가 입력한 값 그대로다) 재조회할 이유가 없다.

   실패하면 저장 직전 상태로 완전히 되돌리고(스냅샷) 모달을 사용자가 입력했던 값 그대로 다시 연다 —
   "저장된 줄 알았는데 아니었다"가 가장 나쁜 결과라, 실패는 반드시 눈에 띄게 만든다. */

// 저장 진행 중인 건들 — 같은 건을 두 번 저장하거나, 저장 중인 건을 다시 편집하는 것을 막는다.
const _savingDeals = new Map(); // dealId -> {snap, at}
/* 저장 잠금 상한. 정상 저장은 수 초면 끝나므로 이보다 오래 남아 있다면 이전 시도가 예외로
   끊긴 것이다 — 그대로 두면 그 공구건은 영영 못 열고 못 고친다. 스스로 풀리게 한다. */
const SAVE_LOCK_MAX_MS = 60000;
function isDealSaving(dealId){
  const e=_savingDeals.get(dealId);
  if(!e)return false;
  if(Date.now()-(e.at||0)>SAVE_LOCK_MAX_MS){
    _savingDeals.delete(dealId);
    console.warn('[저장] 오래 남아 있던 저장 잠금을 해제했습니다 — 이전 저장이 비정상 종료된 것으로 보입니다:',dealId);
    return false;
  }
  return true;
}
function _savingChip(d){
  return d && d._saving ? ' <span class="bdg bdg-p" style="opacity:.7">저장 중</span>' : '';
}
/* 릴스가 실제로 달라졌는지 — 순서·URL·조회수·썸네일까지 그대로 비교한다.
   모달을 열기만 해도 _modalReels가 만들어지므로 "존재 여부"로 판단하면 매번 바뀐 걸로 오인한다. */
function _reelsSignature(list){
  return JSON.stringify((list||[]).map(r=>[r.url||'', r.views!=null?r.views:null, r.thumb||'']));
}
function _reelsChanged(before,after){ return _reelsSignature(before)!==_reelsSignature(after); }

function _snapshotDeal(d){ return JSON.parse(JSON.stringify(d)); }
function _restoreDeal(d, snap){
  Object.keys(d).forEach(k => { delete d[k]; });
  Object.assign(d, snap);
}

/* 모달 입력값(next) → 공구건 객체 필드. 낙관적 반영과 실패 시 모달 재오픈이 "완전히 같은 값"을
   쓰도록 한 곳에서 만든다(두 군데에 같은 Object.assign을 늘어놓으면 반드시 어긋난다). */
function _dealFieldsFromNext(next, codes, codesChanged, reels, touchReels, totalViews){
  const f = {
    product:next.product, ch:next.channel, influencer:next.channel, platform:next.platform,
    vendor:next.vendor, link:next.link, marketingLink:next.marketingLink,
    start:next.start, end:next.end, format:next.format, composition:next.composition,
    targetQty:next.targetQty, qty:next.qty, option2:next.option2, firstCome:next.firstCome,
    firstComeQty:next.firstComeQty, note:next.note,
    giftItem1:next.giftItem1, giftQty1:next.giftQty1,
    giftItem2:next.giftItem2, giftQty2:next.giftQty2,
    giftItem3:next.giftItem3, giftQty3:next.giftQty3,
    extraQty:next.extraQty, tier:next.tier, followers:next.followers,
    igId:next.igId, ytId:next.ytId,
    status:_calcStatus(next.start, next.end)
  };
  if(codesChanged) f.codes = codes;
  if(touchReels){ f.reels = reels; f.views = totalViews; }
  return f;
}

/* 이 저장과 함께 시트 G·H열에 기록할 등급.
   낙관적 반영이 **끝난 뒤** 호출해야 한다 — 이 저장으로 매출이 바뀌면 채널 등급도 같이 바뀌고,
   시트에 써야 하는 건 바뀐 쪽이기 때문. 호출 전에 invalidateTierStats()로 캐시를 비울 것. */
function _tiersForSave(channel){
  const [salesTier, followerTier] = _tierCellsFor(channel);
  return { salesTier, followerTier };
}

/* 저장 요청에 등급을 실어 보냈으면, 로컬 _tierRows도 미리 같은 값으로 맞춰둔다.
   안 그러면 낙관적 render() 직후 syncTiersToSheet()가 "시트와 다르다"고 판단해 writeTiers를
   한 번 더 쏜다 — 방금 없앤 왕복이 그대로 되살아난다. */
function _presetTierRows(d, tiers){
  if(!d || !Array.isArray(d._tierRows)) return;
  d._tierRows.forEach(r => { r[1] = tiers.salesTier; r[2] = tiers.followerTier; });
}

/* 저장 한 번이 실제로 HTTP를 몇 번 탔고 각각 어디서 시간을 썼는지 남긴다.
   ⚠ 예전엔 전체 경과시간 하나와 마지막 응답의 timings만 찍었는데, 그러면 요청이 2회일 때
   "경과는 두 요청 합계인데 timings는 한 요청 것"이라 둘이 안 맞아 원인을 가릴 수 없었다.
   요청마다 구간을 따로 잡아야 '서버가 느린 것'과 '왕복이 많은 것'이 구분된다. */
function _gasLeg(legs, name, fn){
  const t0=performance.now();
  return Promise.resolve(fn()).then(res=>{
    legs.push({name, ms:Math.round(performance.now()-t0), server:(res&&res.timings&&res.timings.total)||null,
               exec:(res&&res.execMs)!=null?res.execMs:null});
    return res;
  });
}
function _logSaveTimings(label, t, clientMs, legs){
  const total=Math.round(clientMs);
  if(Array.isArray(legs)&&legs.length){
    const over=legs.reduce((s,l)=>s+(l.ms-(l.exec!=null?l.exec:(l.server||0))),0);
    console.log(`[저장 계측] ${label} — 총 ${total}ms / HTTP 왕복 ${legs.length}회 / 그중 플랫폼·네트워크 ≈${Math.round(over)}ms`);
    legs.forEach(l=>console.log(`    · ${l.name}: 왕복 ${l.ms}ms / 스크립트 execMs ${l.exec!=null?l.exec+'ms':'—'} / 핸들러 ${l.server!=null?l.server+'ms':'—'}`));
  }
  if(!t){ console.log(`    (서버 timings 없음 — 구버전 배포본일 수 있음)`); return; }
  console.log('    마지막 응답 서버 구간:', {payload파싱:t.parse, 핸들러:t.handler, flush:t.flush, 캐시:t.cache});
}
