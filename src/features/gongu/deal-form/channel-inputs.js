'use strict';
/* 채널 입력 보조 — 채널명 자동완성, 등급 안내줄, 팔로워 수(만 단위) 입력. */

/* ── 채널명 자동완성(datalist) + 등급 자동 산정 안내줄 ──
   후보는 하드코딩하지 않고 매번 현재 DATA에서 다시 뽑음(대시보드 인플루언서 필터와 동일한 방식).
   등급은 이제 자동 산정이라 드롭다운을 대신 채워주지 않음 — 대신 채널명을 입력/선택하는 즉시
   그 채널의 산정 결과(등급·완료 건수·평균·최대)를 읽기 전용 안내줄로 보여줌. 드롭다운은
   "자동 산정을 덮어쓸 때만" 쓰는 예외 장치이므로 기본값은 항상 '사용 안 함'. */
function _refreshChannelNameList(){
  const el=document.getElementById('chNameList');
  if(el)el.innerHTML=_dashInfluencerAvailable().map(ch=>`<option value="${_escAttr(ch)}"></option>`).join('');
}
function _refreshTierAutoLine(inputId,selectId,hostId){
  const host=document.getElementById(hostId);
  if(!host)return;
  const chEl=document.getElementById(inputId),selEl=document.getElementById(selectId);
  const ch=chEl?chEl.value:'';
  if(!String(ch).trim()){
    host.innerHTML='<span style="color:var(--text-3)">채널명을 입력하면 과거 실적 기준 자동 산정 결과가 표시됩니다</span>';
    return;
  }
  const stat=tierStatOf(ch);
  const own=selEl?selEl.value:'';
  const lines=[];
  // 이 채널의 '다른' 공구건 중 수동 값을 가진 건 수 — 수동 값이 채널 전체에 걸린다는 점을 알려줌
  const otherManual=Math.max(0,(stat?stat.manualCount||0:0)-(own?1:0));
  const warnEl=document.getElementById(hostId==='mTierAuto'?'mTierOtherWarn':'fTierOtherWarn');
  if(warnEl){
    const msg=`수동 값은 채널 전체에 적용되며, 이 채널의 다른 공구건 ${otherManual}개에도 수동 값이 있습니다`;
    warnEl.style.display=otherManual>0?'':'none';
    warnEl.textContent=otherManual>0?`⚠ 다른 건 ${otherManual}개`:'';
    warnEl.title=otherManual>0?msg:'';
    if(otherManual>0)lines.push(msg);
  }
  // 1줄: 매출등급 — 기존 자동 산정 내용 그대로(이름만 '매출등급'으로 명확히 함)
  if(!stat||!stat.count){
    lines.push(`매출등급: ${tierBadge('')} <span style="color:var(--text-3)">완료된 공구 실적이 없어 아직 산정할 수 없습니다(신규 채널)</span>`);
  }else{
    lines.push(`매출등급: ${tierBadge(stat.auto)}${stat.provisional?TIER_FLAG_PROV:''}`+
      ` <span style="color:var(--text-3)">(${tierPeriodNote(stat)} · 완료 ${stat.count}건 · 평균 ${wonShort(stat.avg)} · 최대 ${wonShort(stat.max)})</span>`);
  }
  // 2줄: 팔로워등급 + 갭 — 지금 입력 중인 팔로워 수를 우선 반영해서(저장 전에도) 바로 보이게 함
  const typed=_followerInputValue(hostId==='mTierAuto'?'mFollowers':'fFollowers');
  const fCount=typed!=null?typed:(stat?stat.followerCount:null);
  const fTier=followerTierOf(fCount);
  const fWhen=(typed==null&&stat&&stat.followerAt)?` · ${String(stat.followerAt).slice(0,7).replace('-','.')} 기준`:'';
  if(fCount==null){
    lines.push(`팔로워등급: ${tierBadge(TIER_FOLLOWER_UNSET)} <span style="color:var(--text-3)">팔로워 수를 입력하면 산정됩니다</span>`);
  }else{
    const revTier=stat?stat.effective:TIER_UNRATED;
    const gap=tierGapOf(revTier,fTier);
    lines.push(`팔로워등급: ${tierBadge(fTier)} <span style="color:var(--text-3)">(${formatMan(fCount)}${fWhen})</span>`+
      (gap!=null?` → 갭 ${gapBadge(gap)}`:''));
  }
  if(own){
    lines.push(`이 건의 수동 지정 <b>${own}</b>${TIER_FLAG_MANUAL} — 이 채널의 매출등급을 자동 산정 대신 이 값으로 씁니다`);
  }else if(stat&&stat.manual){
    // 수동 지정은 건별로 저장되므로, 다른 건이 물고 있으면 여기서 알려줘야 해제 지점을 찾을 수 있음
    lines.push(`이 채널은 <b>다른 공구건</b>에서 지정한 수동 등급 <b>${stat.manual}</b>${TIER_FLAG_MANUAL}이 적용 중입니다 — 해제하려면 그 건에서 '사용 안 함'으로 바꾸세요`);
  }
  host.innerHTML=lines.join('<br>');
}
/* ── 팔로워 수 입력 (등록 폼/수정 모달/표 인라인 편집 공용) ──────────────────
   입력은 만 단위, 저장은 명 단위 숫자. 칸 안의 "만" 접미사가 단위를 고정으로 알려주고,
   칸 아래 "= 443,000명" 환산값이 실제로 저장될 숫자를 확인시켜 준다(이 환산줄이 명 단위를
   보여주는 유일한 자리 — 표·툴팁 등 표시 경로에는 formatMan만 쓴다).
   소수 자릿수를 1자리로 자르지 않는 이유: 1만 미만을 0.85(=8,500)처럼 적어야 해서 2자리가
   필요하고, 어차피 명 단위로 반올림하므로 자릿수를 제한할 실익이 없음. */
function _sanitizeManInput(v){
  let s=String(v==null?'':v).replace(/[^\d.]/g,'');
  const i=s.indexOf('.');
  if(i!==-1)s=s.slice(0,i+1)+s.slice(i+1).replace(/\./g,''); // 소수점은 하나만
  return s;
}
// "44.3"(만) → 443000(명). 빈값/점만 있으면 null
function manToCount(v){
  const s=_sanitizeManInput(v);
  if(s===''||s==='.')return null;
  const n=parseFloat(s);
  return isFinite(n)?Math.round(n*10000):null;
}
// 443000(명) → "44.3"(만). 명 단위 정수를 되돌린 값이라 소수 4자리면 부동소수 잡음이 사라짐
function countToMan(n){return n==null?'':String(parseFloat((Math.round(n)/10000).toFixed(4)));}
// 입력칸 아래 환산줄 문구 — 저장될 명 단위 숫자를 그대로 보여줌
function _folConvText(count){return count==null?'':`= ${count.toLocaleString('ko-KR')}명`;}
function _onFollowerInput(el){
  el.classList.remove('chf-auto'); // 직접 입력한 순간 '자동 채움' 표시 제거
  const clean=_sanitizeManInput(el.value);
  if(clean!==el.value){
    // 허용 문자만 남기고 커서는 지운 글자 수만큼만 뒤로 — 항상 끝으로 튀지 않게
    const pos=Math.max(0,(el.selectionStart||0)-(el.value.length-clean.length));
    el.value=clean;
    try{el.setSelectionRange(pos,pos);}catch(e){}
  }
  const conv=document.getElementById(el.id+'Conv');
  if(conv)conv.textContent=_folConvText(manToCount(el.value));
  // 채널 정보 안내줄의 팔로워등급/갭을 입력 즉시 갱신
  _refreshTierAutoLine(el.id==='mFollowers'?'mInfluencer':'fInfluencer',
    el.id==='mFollowers'?'mTier':'fTier',el.id==='mFollowers'?'mTierAuto':'fTierAuto');
}
// 입력 필드의 현재 값 → 명 단위 숫자(빈값이면 null). 저장·안내줄이 같은 함수를 씀
function _followerInputValue(id){
  const el=document.getElementById(id);
  return el?manToCount(el.value):null;
}
function _setFollowerInput(id,n){
  const el=document.getElementById(id);
  if(!el)return;
  el.value=countToMan(n);
  const conv=document.getElementById(id+'Conv');
  if(conv)conv.textContent=_folConvText(n);
}
function _onFormTierChange(){_refreshTierAutoLine('fInfluencer','fTier','fTierAuto');}
function _onModalTierChange(){_refreshTierAutoLine('mInfluencer','mTier','mTierAuto');}
// 채널명을 바꾸면 그 채널의 "가장 최근 팔로워 수"를 자동으로 채워줌 — 사람이 매번 다시 찾아
// 입력하지 않게 하려는 것. 이미 이 건에 값이 들어 있으면 덮어쓰지 않는다(건별 스냅샷이 원칙).
function _autofillFollowers(inputId,followerId){
  const el=document.getElementById(followerId);
  if(!el||String(el.value||'').trim()!=='')return;
  const chEl=document.getElementById(inputId);
  const stat=chEl?tierStatOf(chEl.value):null;
  if(stat&&stat.followerCount!=null)_setFollowerInput(followerId,stat.followerCount);
}
function _onFormInfluencerInput(){_autofillFollowers('fInfluencer','fFollowers');_refreshTierAutoLine('fInfluencer','fTier','fTierAuto');}
function _onModalInfluencerInput(){_autofillFollowers('mInfluencer','mFollowers');_refreshTierAutoLine('mInfluencer','mTier','mTierAuto');}
