'use strict';
/* 등급 표시 UI — 등급 축, 배지, 수동 등급 되돌리기 팝오버. */

/* ── 등급 축 (2026-09-11) ───────────────────────────────────────────────────
   '등급별 성과' 섹션 전체가 이 축 하나로 매출/팔로워를 갈아끼운다. 새 축을 추가하려면 여기에
   한 줄 추가하고 토글 버튼만 늘리면 됨 — 각 차트가 축을 따로 알 필요가 없게 만든 게 핵심. */
const TIER_AXES={
  rev:{key:'rev',label:'매출등급',of:effectiveTierOf,unratedWord:'등급 미산정/미분류',
    // 매출등급은 매출로 산정되므로 매출 지표가 자기참조 — 팔로워 축에서는 이 경고가 필요 없음
    revSelfRef:true},
  follower:{key:'follower',label:'팔로워등급',of:followerTierOf_,unratedWord:'팔로워 미입력',
    revSelfRef:false},
};
let _dashTierAxis='rev';
function _tierAxis(){return TIER_AXES[_dashTierAxis]||TIER_AXES.rev;}
function _axisTierOf(d){return _tierAxis().of(d);}
// 채널명으로 바로 묻는 버전(재협업률처럼 건이 아니라 채널 단위로 도는 집계용)
function _axisTierOfChannel(ch){return _dashTierAxis==='follower'?followerTierOfChannel(ch):effectiveTierOfChannel(ch);}
// 등급별 집계 대상인지 — 미산정(매출축)/미입력(팔로워축)은 양쪽 다 TIER_OPTIONS 밖이라 같이 걸러짐
function isRatedTier(t){return TIER_OPTIONS.indexOf(t)!==-1;}

function tierLabel(t){return t||TIER_UNRATED;}
function tierColor(t){return TIER_COLORS[tierLabel(t)]||TIER_COLORS[TIER_UNRATED];}
function tierBadge(t){const c=tierColor(t);return`<span class="bp bp-tier" style="background:${c.bg};color:${c.fg}">${tierLabel(t)}</span>`;}
// 정렬용 순위 — TIER_OPTIONS 순서가 기준. 미산정은 null을 돌려 "빈 값은 항상 맨 아래" 규칙을 그대로 탐.
function tierRank(t){const i=TIER_OPTIONS.indexOf(t||'');return i===-1?null:i;}
// 수동 지정 드롭다운(등록 폼/수정 모달 공용) — 빈 값이 기본
function _tierManualOptionsHtml(){return'<option value="">사용 안 함</option>'+TIER_OPTIONS.map(t=>`<option value="${t}">${t}</option>`).join('');}

const TIER_FLAG_MANUAL='<span class="tier-flag tier-flag-manual" title="수동 지정 — 자동 산정보다 우선 적용">수동</span>';
// 채널별 성과 표에서는 같은 배지를 버튼으로 — 눌러서 자동 산정으로 되돌릴 수 있게 함
function _tierFlagManualBtn(ch){
  return`<button type="button" class="tier-flag tier-flag-manual tier-flag-btn" data-ch="${_escAttr(ch)}"`+
    ` title="수동 지정 — 클릭하면 자동 산정으로 되돌리기" onclick="openTierRevertPop(event,this.dataset.ch)">수동</button>`;
}
const TIER_FLAG_PROV='<span class="tier-flag tier-flag-prov" title="완료 1건만으로 산정된 잠정 등급">잠정</span>';
// 실효 등급 배지 + 수동/잠정 플래그(수동이면 자동 산정의 잠정 여부는 화면 등급과 무관하므로 생략)
// revertable=true면 '수동' 배지를 되돌리기 버튼으로 렌더(채널별 성과 표 전용)
function tierBadgeWithFlags(stat,revertable){
  if(!stat)return tierBadge('');
  let html=tierBadge(isRatedTier(stat.effective)?stat.effective:'');
  if(stat.manual)html+=revertable?_tierFlagManualBtn(stat.channel):TIER_FLAG_MANUAL;
  else if(stat.provisional&&stat.auto)html+=TIER_FLAG_PROV;
  return html;
}
/* 등급이 "필터 기간"이 아니라 "전체 기간 누적"으로 산정된다는 걸 밝히는 문구.
   구간은 고정 문구가 아니라 산정에 실제로 들어간 완료 건의 최초~최근 시작일에서 뽑음 — 데이터가
   늘어나도 화면 문구가 따로 놀지 않게 하려는 것. */
function tierPeriodNote(stat){
  const ym=v=>String(v||'').slice(0,7).replace('-','.');
  const a=ym(stat&&stat.firstDone),b=ym(stat&&stat.lastDone);
  if(!a||!b)return'전체 기간 누적 기준';
  return a===b?`전체 기간 누적 기준 (${a})`:`전체 기간 누적 기준 (${a} ~ ${b})`;
}
// 툴팁에서 "현재 필터 구간"을 가리킬 때 쓰는 라벨 — 상단 기간 요약(dashPSummary)과 같은 문구를 재사용
function _dashFilterScopeLabel(){
  const t=dashPSummary();
  return t==='전체 기간'?'현재 필터(전체 기간) 내':`현재 필터(${t}) 기간 내`;
}
/* 등급 근거 툴팁 — 완료 건수·평균·최대가 핵심.
   scopedCount를 주면 "필터 기간 내 완료 건수"를 마지막 줄에 덧붙임 — 표의 '공구 횟수 (기간 내)'와
   누적 완료 건수가 달라 보이는 이유(등급은 전체 기간 기준)를 툴팁 안에서 바로 설명하기 위한 것. */
function tierEvidence(stat,scopedCount){
  if(!stat)return'등급 산정 근거가 없습니다';
  const parts=[tierPeriodNote(stat)];
  if(!stat.count)parts.push('완료 실적 없음 — 자동 산정 불가');
  else parts.push(`완료 ${stat.count}건 · 평균 ${wonShort(stat.avg)} · 최대 ${wonShort(stat.max)}`,
    `자동 산정: ${stat.auto}${stat.provisional?' (잠정 — 완료 1건)':''}`);
  if(stat.manual)parts.push(`수동 지정: ${stat.manual} (자동보다 우선)`);
  if(!stat.manual&&stat.prevAuto&&stat.auto&&stat.prevAuto!==stat.auto)parts.push(`직전 완료 건 시점: ${stat.prevAuto}`);
  if(scopedCount!=null)parts.push(`${_dashFilterScopeLabel()}: 완료 ${scopedCount}건`);
  return parts.join('\n');
}
/* ── 수동 등급 → 자동 산정 되돌리기 ──────────────────────────────────────────
   채널별 성과 표의 '수동' 배지를 누르면 확인 팝오버가 뜨고, 확인하면 그 채널의 모든 공구건에서
   '등급(수동)' 값을 비운다(GAS clearChannelTier). 한 건만 비우면 남은 건의 값이 다시 채널
   등급으로 승격돼 되돌리기가 안 먹은 것처럼 보이므로 반드시 채널 단위로 처리한다. */
let _tierRevertCh='';
function openTierRevertPop(ev,ch){
  if(ev){ev.stopPropagation();ev.preventDefault();}
  const stat=tierStatOf(ch);
  const pop=document.getElementById('tierRevertPop');
  if(!stat||!stat.manual||!pop)return;
  _tierRevertCh=stat.channel;
  const autoLabel=stat.auto?stat.auto:TIER_UNRATED;
  const evidence=stat.count
    ?`완료 ${stat.count}건 · 평균 ${wonShort(stat.avg)} · 최대 ${wonShort(stat.max)}`
    :'완료 실적이 없어 자동 산정 불가 — 되돌리면 미산정이 됩니다';
  const extra=stat.manualCount>1?`<div class="tier-revert-ev">이 채널의 공구건 ${stat.manualCount}개에 수동 값이 있으며 모두 비워집니다</div>`:'';
  pop.innerHTML=`
    <div class="tier-revert-hd">${_escAttr(stat.channel)}</div>
    <div>수동 <b>${stat.manual}</b> → 자동 <b>${autoLabel}</b></div>
    <div class="tier-revert-ev">${evidence}</div>
    ${extra}
    <div class="tier-revert-btns">
      <button type="button" class="tier-revert-cancel" onclick="closeTierRevertPop()">취소</button>
      <button type="button" class="tier-revert-go" id="tierRevertGo" onclick="confirmTierRevert()">자동 산정으로 되돌리기</button>
    </div>`;
  pop.classList.add('open');
  // 배지 바로 아래에 띄우되 화면 밖으로 나가면 위로 뒤집고 좌우로 물림(기간 필터 팝오버와 같은 방식)
  const r=(ev&&ev.currentTarget?ev.currentTarget:document.body).getBoundingClientRect();
  const vw=window.innerWidth,vh=window.innerHeight,m=6;
  const pw=pop.offsetWidth,ph=pop.offsetHeight;
  let top=r.bottom+m;
  if(top+ph>vh-8&&r.top-m-ph>=8)top=r.top-m-ph;
  pop.style.top=Math.max(8,Math.min(top,vh-8-ph))+'px';
  pop.style.left=Math.max(8,Math.min(r.left,vw-8-pw))+'px';
}
function closeTierRevertPop(){
  const pop=document.getElementById('tierRevertPop');
  if(pop){pop.classList.remove('open');pop.innerHTML='';}
  _tierRevertCh='';
}
document.addEventListener('click',ev=>{
  if(ev.target.closest('#tierRevertPop')||ev.target.closest('.tier-flag-btn'))return;
  closeTierRevertPop();
});
document.addEventListener('keydown',ev=>{if(ev.key==='Escape')closeTierRevertPop();});

async function confirmTierRevert(){
  const ch=_tierRevertCh;
  if(!ch)return;
  const stat=tierStatOf(ch);
  const btn=document.getElementById('tierRevertGo');
  if(btn){btn.disabled=true;btn.textContent='되돌리는 중...';}
  const url=_getGasUrl();
  try{
    if(url){
      const j=await _gasWrite(url,'clearChannelTier',{channel:ch});
      if(!j||j.success!==true||j.error)throw new Error((j&&j.error)||'clearChannelTier 응답에 success:true가 없습니다');
    }
    // fetchLive가 끝나기 전에도 화면이 바로 바뀌도록 로컬 DATA에서도 같은 채널 값을 비움
    const key=_dashInfluencerNorm(ch);
    DATA.forEach(d=>{if(_dashInfluencerNorm(d.ch||d.influencer||'')===key)d.tier='';});
    closeTierRevertPop();
    render(); // 등급 캐시가 무효화되며 표·차트가 자동 등급으로 재집계됨
    const after=tierStatOf(ch);
    const label=after&&after.auto?after.auto:TIER_UNRATED;
    showToast(after&&after.auto
      ?`${ch} 등급이 자동 산정(${label})으로 전환됐습니다`
      :`${ch} 수동 등급을 해제했습니다 — 완료 실적이 없어 미산정입니다`,{type:'success'});
    if(url)fetchLive();
  }catch(e){
    console.error('[등급 되돌리기 실패]',e);
    if(btn){btn.disabled=false;btn.textContent='자동 산정으로 되돌리기';}
    showToast('되돌리기 실패: '+_friendlySaveError(e.message),{type:'error'});
  }
}

// 직전 완료 건 시점의 자동 등급 대비 승격(▲)/강등(▼). 수동 지정 채널은 화면 등급이 자동 등급을
// 따라가지 않으므로 표시하지 않음(오해 방지).
function tierDeltaHtml(stat){
  if(!stat||stat.manual||!stat.auto||!stat.prevAuto||stat.auto===stat.prevAuto)return'';
  const up=TIER_OPTIONS.indexOf(stat.auto)<TIER_OPTIONS.indexOf(stat.prevAuto);
  return`<span class="tier-delta ${up?'trend-up':'trend-down'}" title="직전 완료 건 시점 ${stat.prevAuto} → 현재 ${stat.auto}">${up?'▲':'▼'}</span>`;
}
