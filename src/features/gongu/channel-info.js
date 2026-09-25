'use strict';
/* 채널 단위 필드(플랫폼 ID·팔로워 수) 현황·전파·불일치 점검. */

/* ── 채널 단위 필드 (2026-09-15) ────────────────────────────────────────────
   플랫폼 ID·팔로워 수는 공구건이 아니라 채널에 속한 값이다. 시트는 공구건(행) 단위라 같은 채널이
   여러 행에 흩어져 있고, 한 건에서 고친 값이 나머지에 반영되지 않으면 행마다 값이 다른 상태가 쌓인다.

   채널 판정은 **앞뒤 공백만 제거한 완전 일치**. 대소문자·띄어쓰기 변형을 묶지 않는 건 의도된
   보수적 선택이다 — 다른 채널을 같은 채널로 오인해 덮어쓰면 되돌리기 어렵다. */
const CHANNEL_FIELDS=[
  {key:'igId',      label:'인스타 ID', input:'mIgId'},
  {key:'ytId',      label:'유튜브 ID', input:'mYtId'},
  {key:'followers', label:'팔로워 수', input:'mFollowers'}
];
const CHANNEL_FIELD_KEYS=CHANNEL_FIELDS.map(f=>f.key);
function _chKey(ch){return String(ch||'').trim();}
// 화면 표시용 — 팔로워는 만 단위로, ID는 그대로
function _chFieldText(key,v){
  if(v==null||v==='')return '';
  return key==='followers'?formatMan(Number(v)):String(v);
}
// 비교용 정규화(시트에 들어가는 값과 같은 기준이어야 "바뀌었는지" 판정이 어긋나지 않음)
function _chFieldNorm(key,v){
  if(v==null||v==='')return '';
  if(key==='followers'){const n=Number(String(v).replace(/[,\s]/g,''));return isFinite(n)&&n>=0?String(Math.round(n)):'';}
  if(key==='link')return String(v).trim(); // 주소에서 @를 떼면 값이 망가진다
  return String(v).trim().replace(/^@+/,'');
}

/* 채널별 현황 — DATA를 훑어 채널마다 필드별로
     latest   : 가장 최근 공구건(시작일 기준)의 값 = "통일 기준값"
     rows     : 값이 들어 있는 건들의 (기간, 값) 목록 — 확인 팝업·불일치 팝오버에서 보여줌
     empty    : 값이 비어 있는 건 수
     conflict : latest와 다른 값을 가진 건들
   tierStats와 같은 이유로 DATA가 바뀔 때만 다시 계산한다(render()에서 무효화). */
let _chInfoCache=null;
function invalidateChannelInfo(){_chInfoCache=null;}
function channelInfo(){
  if(!_chInfoCache)_chInfoCache=_computeChannelInfo(DATA);
  return _chInfoCache;
}
function _computeChannelInfo(deals){
  const byCh=new Map();
  (deals||[]).forEach(d=>{
    const ch=_chKey(d.ch||d.influencer);
    if(!ch)return;
    if(!byCh.has(ch))byCh.set(ch,[]);
    byCh.get(ch).push(d);
  });
  const map=new Map();
  byCh.forEach((items,ch)=>{
    // 최근 건이 뒤로 오도록 — 시작일이 같으면 시트에서 아래쪽(id 큰) 행이 최신
    const sorted=items.slice().sort((a,b)=>String(a.start||'').localeCompare(String(b.start||''))||((a.id||0)-(b.id||0)));
    const info={channel:ch,total:items.length,fields:{}};
    CHANNEL_FIELD_KEYS.forEach(key=>{
      const withVal=sorted.filter(d=>_chFieldNorm(key,d[key])!=='');
      const latestDeal=withVal.length?withVal[withVal.length-1]:null;
      const latest=latestDeal?_chFieldNorm(key,latestDeal[key]):'';
      const rows=sorted.map(d=>({
        dealId:d.dealId,product:d.product,start:d.start,end:d.end,
        value:_chFieldNorm(key,d[key]),
        rowCount:d._rowCount||d.rowCount||1
      }));
      info.fields[key]={
        latest,latestDealId:latestDeal?latestDeal.dealId:'',
        rows,
        filled:rows.filter(r=>r.value!=='').length,
        empty:rows.filter(r=>r.value==='').length,
        conflicts:rows.filter(r=>r.value!==''&&r.value!==latest)
      };
    });
    // 불일치 = 값이 하나라도 있는데, 서로 다르거나 일부가 비어 있음
    info.mismatch=CHANNEL_FIELD_KEYS.some(k=>{
      const f=info.fields[k];
      return f.filled>0&&(f.conflicts.length>0||f.empty>0);
    });
    map.set(ch,info);
  });
  return map;
}
function channelInfoOf(ch){return channelInfo().get(_chKey(ch))||null;}

/* 모달 입력값에서 채널 필드를 읽어 "이번에 바뀐 것"만 추린다.
   반환: {changed:{key:value}, plan:{key:{empty,conflicts}}} — plan은 확인 팝업 문구에 쓰임 */
function _collectChannelFieldChanges(d,channel){
  const changed={},plan={};
  const info=channelInfoOf(channel);
  CHANNEL_FIELDS.forEach(f=>{
    const el=document.getElementById(f.input);
    if(!el)return;
    const raw=f.key==='followers'?_followerInputValue(f.input):el.value;
    const next=_chFieldNorm(f.key,raw);
    const cur=_chFieldNorm(f.key,d[f.key]);
    if(next===cur)return;          // 이 건 기준으로 안 바뀜
    if(next==='')return;           // 값을 지우는 건 전파하지 않음(이 건에서만 비움)
    changed[f.key]=next;
    const fi=info&&info.fields[f.key];
    plan[f.key]={
      empty:fi?fi.rows.filter(r=>r.value===''&&r.dealId!==d.dealId).length:0,
      conflicts:fi?fi.rows.filter(r=>r.value!==''&&r.value!==next&&r.dealId!==d.dealId):[]
    };
  });
  return {changed,plan};
}

/* 확인 팝업 — 다른 값이 있는 건이 하나라도 있으면 저장 직전에 띄운다.
   "몇 건에 반영되는지"와 "덮어쓰게 될 건이 무엇인지"를 같이 보여줘야 사용자가 판단할 수 있다.
   반환: 'fillEmpty' | 'overwrite' | 'thisOnly' | null(취소) */
function _askChannelPropagateMode(channel,plan,total){
  let emptyN=0;const conflictRows=new Map();
  Object.keys(plan).forEach(k=>{
    emptyN=Math.max(emptyN,plan[k].empty);
    plan[k].conflicts.forEach(r=>{
      const key=r.dealId||(r.product+r.start);
      if(!conflictRows.has(key))conflictRows.set(key,{row:r,fields:[]});
      conflictRows.get(key).fields.push({key:k,value:r.value});
    });
  });
  const conflicts=[...conflictRows.values()];
  if(!conflicts.length)return 'fillEmpty'; // 충돌 없음 — 물어볼 것 없이 빈 칸만 채움
  const lines=conflicts.map(c=>{
    const f=c.fields.map(x=>{
      const label=(CHANNEL_FIELDS.find(y=>y.key===x.key)||{}).label||x.key;
      return `${label} ${_chFieldText(x.key,x.value)}`;
    }).join(' · ');
    return `  · ${fmtS(c.row.start)}~${fmtS(c.row.end)}  ${c.row.product||''}  (${f})`;
  }).join('\n');
  const msg=`같은 채널 공구건 ${total}건 중 빈 칸 ${emptyN}건에 반영됩니다.\n`+
    `다른 값이 있는 ${conflicts.length}건도 덮어쓸까요?\n\n${lines}\n\n`+
    `[확인] 전체 덮어쓰기   [취소] 빈 칸만 채우기`;
  // 세 갈래는 confirm 두 번으로 — 기존 모달 스택 위에 또 오버레이를 쌓으면 포커스/스크롤이 꼬인다
  if(confirm(msg))return 'overwrite';
  return confirm('빈 칸만 채울까요?\n\n[확인] 빈 칸만 채우기   [취소] 이 공구건에만 저장')?'fillEmpty':'thisOnly';
}

/* 모달을 열 때, 이 건이 비어 있고 같은 채널의 다른 건에 값이 있으면 끌어와 채운다.
   자동으로 채운 칸은 옅은 배경(.chf-auto)으로 표시 — 사용자가 직접 넣은 값과 구분되어야 한다. */
function _autofillChannelFields(channel,d){
  const info=channelInfoOf(channel);
  CHANNEL_FIELDS.forEach(f=>{
    const el=document.getElementById(f.input);
    if(!el)return;
    el.classList.remove('chf-auto');
    const own=_chFieldNorm(f.key,d&&d[f.key]);
    if(own!=='')return;                       // 이 건에 이미 값이 있음
    const latest=info&&info.fields[f.key]?info.fields[f.key].latest:'';
    if(!latest)return;
    if(f.key==='followers')_setFollowerInput(f.input,Number(latest));
    else el.value=latest;
    el.classList.add('chf-auto');
  });
}
function _clearChannelFieldAuto(){
  CHANNEL_FIELDS.forEach(f=>{
    const el=document.getElementById(f.input);
    if(el)el.classList.remove('chf-auto');
  });
}

/* 전파 결과를 로컬 DATA에도 그대로 반영 — 서버 응답을 기다리지 않고 화면이 먼저 맞아야
   낙관적 저장의 의미가 있다. 서버와 같은 규칙(fillEmpty는 빈 칸만)을 써야 나중에 어긋나지 않는다. */
function _applyChannelFieldsLocally(channel,fields,mode,selfDealId){
  const ch=_chKey(channel);
  DATA.forEach(d=>{
    if(_chKey(d.ch||d.influencer)!==ch)return;
    Object.keys(fields).forEach(k=>{
      const cur=_chFieldNorm(k,d[k]);
      if(mode==='fillEmpty'&&cur!==''&&d.dealId!==selfDealId)return;
      d[k]=k==='followers'?Number(fields[k]):fields[k];
    });
  });
}
/* 같은 채널의 모든 건에 대해 로컬 _tierRows를 지금 보낼 등급으로 맞춰둔다.
   서버가 전파 행의 G·H를 같은 실행에서 쓰기 때문에, 로컬만 옛 값이면 syncTiersToSheet가
   "시트와 다르다"고 판단해 방금 없앤 왕복을 되살린다. */
function _presetChannelTierRows(channel,tiers){
  const ch=_chKey(channel);
  DATA.forEach(d=>{
    if(_chKey(d.ch||d.influencer)!==ch)return;
    _presetTierRows(d,tiers);
  });
}

/* ── 채널 정보 불일치 점검 (2026-09-15) ───────────────────────────────────────
   같은 채널명인데 행마다 플랫폼 ID·팔로워 수가 다르거나 일부만 비어 있으면 배지를 띄운다.
   전파 기능이 생겨도 과거에 쌓인 불일치는 저절로 정리되지 않기 때문에, "지금 어긋나 있다"를
   눈에 보이게 하고 한 번에 맞출 수단을 같이 준다. */
function _chMismatchBadge(ch){
  const info=channelInfoOf(ch);
  if(!info||!info.mismatch)return '';
  return `<button type="button" class="chf-badge" onclick="event.stopPropagation();openChMismatch(event,'${_escAttr(ch)}')" title="같은 채널인데 공구건마다 채널 정보가 다릅니다. 클릭해서 확인·통일">채널 정보 불일치</button>`;
}
function _chMismatchRowsHtml(info){
  return CHANNEL_FIELDS.map(f=>{
    const fi=info.fields[f.key];
    if(!fi||(fi.filled===0))return ''; // 아무 데도 값이 없으면 불일치가 아니라 그냥 미입력
    if(fi.conflicts.length===0&&fi.empty===0)return '';
    const rows=fi.rows.map(r=>{
      const v=r.value===''?'<span class="chf-empty">비어 있음</span>':_escHtml(_chFieldText(f.key,r.value));
      const odd=r.value!==''&&r.value!==fi.latest;
      return `<div class="chf-row${odd?' odd':''}">
        <span class="chf-period">${fmtS(r.start)}~${fmtS(r.end)}</span>
        <span class="chf-prod">${_escHtml(r.product||'')}</span>
        <span class="chf-val">${v}</span></div>`;
    }).join('');
    return `<div class="chf-block">
      <div class="chf-field">${f.label} <span class="chf-latest">최근 값: ${_escHtml(_chFieldText(f.key,fi.latest))||'—'}</span></div>
      ${rows}</div>`;
  }).join('');
}
let _chMismatchCh=null;
function openChMismatch(ev,ch){
  const info=channelInfoOf(ch);
  if(!info)return;
  _chMismatchCh=ch;
  const pop=document.getElementById('chMismatchPop');
  document.getElementById('chMismatchTitle').textContent=`${ch} · 공구건 ${info.total}건`;
  document.getElementById('chMismatchBody').innerHTML=_chMismatchRowsHtml(info);
  pop.style.display='block';
  // 화면 밖으로 나가지 않게 클릭 위치 기준으로 배치
  const r=ev.currentTarget.getBoundingClientRect();
  const w=pop.offsetWidth||340;
  pop.style.left=Math.max(8,Math.min(window.innerWidth-w-8,r.left))+'px';
  pop.style.top=(r.bottom+6)+'px';
}
function closeChMismatch(){document.getElementById('chMismatchPop').style.display='none';_chMismatchCh=null;}
/* "최근 건 값으로 통일" — 각 필드의 최근 값으로 채널 전체를 덮어쓴다.
   기준을 "최근 건"으로 잡은 이유는 팔로워 수와 같다: 채널 정보는 시점이 곧 의미라 최신이 정답이다. */
async function unifyChannelFields(){
  const ch=_chMismatchCh;
  if(!ch)return;
  const info=channelInfoOf(ch);
  if(!info)return;
  const fields={};
  CHANNEL_FIELDS.forEach(f=>{
    const fi=info.fields[f.key];
    if(fi&&fi.latest!=='')fields[f.key]=fi.latest;
  });
  if(!Object.keys(fields).length){showToast('통일할 값이 없습니다');return;}
  closeChMismatch();
  const url=_getGasUrl();
  try{
    if(url){
      const j=await _gasWrite(url,'updateChannelFields',{channel:ch,mode:'overwrite',fields});
      if(!j||j.success!==true||j.error)throw new Error((j&&j.error)||'updateChannelFields 응답에 success:true가 없습니다');
      if((j.skippedFields||[]).length){
        console.warn('[채널 정보 통일] 시트에 열이 없어 건너뛴 필드:',j.skippedFields,
          "— 2행에 '인스타 ID'/'유튜브 ID' 헤더를 추가하면 활성화됩니다");
      }
    }
    _applyChannelFieldsLocally(ch,fields,'overwrite',null);
    render();
    showToast(`${ch} 채널 정보를 최근 건 값으로 통일했습니다`,{type:'success'});
    if(url)fetchLive();
  }catch(e){
    console.error('[채널 정보 통일 실패]',e);
    showToast('통일 실패: '+_friendlySaveError(e.message),{type:'error'});
  }
}
document.addEventListener('click',e=>{
  const pop=document.getElementById('chMismatchPop');
  if(pop&&pop.style.display==='block'&&!pop.contains(e.target))closeChMismatch();
});
