'use strict';
/* 실적 미기입 목록 — 실적 미기입 / 채널 정보 탭과 인라인 입력. */

/* ── 공구 관리 페이지: 실적 미기입 목록 ── */
// 판매수량과 총매출이 둘 다 비어있거나 0인 건(전체 공구건 대상, 상태 무관)
function pendingPerfDeals(){
  return DATA.filter(d=>(d.qty==null||d.qty===0)&&(d.rev==null||d.rev===0))
    .sort((a,b)=>new Date(a.end)-new Date(b.end)); // 종료일이 오래된(먼저 끝난) 순
}
/* 채널 정보 미입력 목록 — 플랫폼 ID가 하나도 없거나 팔로워 수가 비어 있는 채널.
   ID는 "둘 다 비었을 때"만 미입력으로 본다(_chIdMissing과 같은 이유 — 채널은 보통 한 플랫폼이다).
   공구 횟수 많은 순: 채워 넣었을 때 표·등급·링크가 가장 많이 살아나는 채널부터 손이 가야 한다. */
function pendingChannelInfo(){
  const rows=[];
  channelInfo().forEach(info=>{
    const ig=info.fields.igId.latest,yt=info.fields.ytId.latest,fol=info.fields.followers.latest;
    if((ig||yt)&&fol!=='')return;
    const platforms=[...new Set(DATA.filter(d=>_chKey(d.ch||d.influencer)===info.channel)
      .map(d=>String(d.platform||'').trim()).filter(Boolean))];
    rows.push({ch:info.channel,count:info.total,platforms,igId:ig,ytId:yt,
      followers:fol===''?null:Number(fol)});
  });
  rows.sort((a,b)=>b.count-a.count||a.ch.localeCompare(b.ch,'ko'));
  return rows;
}
// 값이 있으면 그냥 표시, 비어 있으면 눌러서 그 자리에서 채우는 칸
function _mgmtChCell(ch,key,val){
  const isFol=key==='followers';
  if(val!=null&&val!=='')return`<td${isFol?' class="num-col"':''}>${isFol?formatMan(val):'@'+_escHtml(val)}</td>`;
  const hint=isFol?'클릭해서 입력(만 단위)':'클릭해서 입력 — 주소를 붙여넣어도 ID만 뽑습니다';
  return `<td class="chid-cell${isFol?' num-col':''}" data-ch="${_escAttr(ch)}" data-key="${key}" `+
    `onclick="_startChIdEdit(this)" title="${hint}"><span class="chid-empty">— 입력</span></td>`;
}
let _mgmtTab='perf'; // 'perf' | 'chinfo'
function _setMgmtTab(t){if(_mgmtTab===t)return;_mgmtTab=t;renderMgmtPage();}
function renderMgmtPage(){
  const tabs=document.getElementById('mgmtTabs');
  if(tabs)[...tabs.children].forEach(b=>b.classList.toggle('on',b.dataset.tab===_mgmtTab));
  document.getElementById('mgmtPerfWrap').style.display=_mgmtTab==='perf'?'':'none';
  document.getElementById('mgmtChWrap').style.display=_mgmtTab==='chinfo'?'':'none';

  const f=pendingPerfDeals();
  document.getElementById('mgmtBody').innerHTML=f.length?f.map(d=>`
    <tr>
      <td>${productBadge(d.product)}</td>
      <td>${chCell(d)}</td>
      <td>${fmtS(d.start)} ~ ${fmtS(d.end)}</td>
      <td>${won(d.s&&d.s.sale)}</td>
      <td>${bdg(_displayStatus(d))+_savingChip(d)}</td>
    </tr>`).join(''):`<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text-3)">실적 미기입 건이 없습니다 🎉</td></tr>`;

  const chRows=pendingChannelInfo();
  document.getElementById('mgmtChBody').innerHTML=chRows.length?chRows.map(r=>`
    <tr>
      <td>${chNameHtml(r.ch,getChannelLinkByName(r.ch))}</td>
      <td>${r.platforms.length?_escHtml(r.platforms.join(' / ')):'<span class="chid-empty">—</span>'}</td>
      <td class="num-col">${r.count}</td>
      ${_mgmtChCell(r.ch,'igId',r.igId)}
      ${_mgmtChCell(r.ch,'ytId',r.ytId)}
      ${_mgmtChCell(r.ch,'followers',r.followers)}
    </tr>`).join(''):`<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text-3)">채널 정보가 모두 채워져 있습니다 🎉</td></tr>`;

  document.getElementById('mgmtCnt').textContent=
    _mgmtTab==='perf'?f.length+'건':chRows.length+'채널';
}

/* ── 채널 정보 인라인 편집 (미입력 목록) ─────────────────────────────────────
   채널별 성과 표의 팔로워 편집과 같은 조작·같은 저장 경로(updateChannelFields)를 쓴다.
   이 목록에 뜬 칸은 그 채널의 모든 행이 비어 있다는 뜻이라 overwrite와 fillEmpty가 같은 결과다. */
let _chIdEditing=null; // 편집 중인 칸 — 중복 저장/재진입 방지
function _startChIdEdit(td){
  if(_chIdEditing)return;
  const ch=td.dataset.ch,key=td.dataset.key,isFol=key==='followers';
  _chIdEditing=ch+'|'+key;
  td.innerHTML=isFol
    ?'<span class="fol-edit"><input class="fol-inp" type="text" inputmode="decimal" placeholder="예: 44.3">'+
     '<span class="fol-unit">만</span></span><div class="fol-conv"></div>'
    :`<input class="chid-inp" type="text" placeholder="${key==='igId'?'인스타 ID 또는 주소':'유튜브 ID 또는 주소'}">`;
  const inp=td.querySelector('input');
  if(isFol){
    const conv=td.querySelector('.fol-conv');
    inp.oninput=()=>{
      const clean=_sanitizeManInput(inp.value);
      if(clean!==inp.value){
        const pos=Math.max(0,(inp.selectionStart||0)-(inp.value.length-clean.length));
        inp.value=clean;
        try{inp.setSelectionRange(pos,pos);}catch(e){}
      }
      conv.textContent=_folConvText(manToCount(inp.value));
    };
  }
  inp.onkeydown=e=>{
    if(e.key==='Enter'){e.preventDefault();inp.blur();}
    else if(e.key==='Escape'){e.preventDefault();_chIdEditing=null;renderMgmtPage();}
  };
  inp.onblur=()=>{
    if(_chIdEditing!==ch+'|'+key)return; // Escape로 이미 빠져나온 경우
    _chIdEditing=null;
    // 주소를 통째로 붙여넣어도 ID만 뽑는다 — 모달 입력칸과 같은 규칙
    const next=isFol?manToCount(inp.value)
      :_parseChannelIdInput(key==='ytId'?'유튜브':'인스타그램',inp.value).id;
    if(next==null||next==='')return void renderMgmtPage(); // 빈 채로 나가면 원래대로
    _saveChannelInfoCell(ch,key,next);
  };
  inp.focus();
}
async function _saveChannelInfoCell(ch,key,value){
  const label=key==='igId'?'인스타 ID':key==='ytId'?'유튜브 ID':'팔로워 수';
  const url=_getGasUrl();
  try{
    if(url){
      const j=await _gasWrite(url,'updateChannelFields',{channel:ch,mode:'overwrite',fields:{[key]:value}});
      if(!j||j.success!==true||j.error)throw new Error((j&&j.error)||'updateChannelFields 응답에 success:true가 없습니다');
      // 열이 없으면 서버는 조용히 건너뛴다 — "저장됐다"고 속이면 안 되므로 여기서 실패로 올린다
      if((j.skippedFields||[]).indexOf(key)>=0)throw new Error(`시트에 '${label}' 열이 없습니다 — 2행에 헤더를 추가해주세요`);
    }
    _applyChannelFieldsLocally(ch,{[key]:value},'overwrite',null);
    render(); // 목록에서 사라지고, 실적 표의 @표시·프로필 링크가 같이 살아난다
    showToast(`${ch} ${label} 저장`,{type:'success'});
    if(url)fetchLive();
  }catch(e){
    console.error('[채널 정보 저장 실패]',e);
    renderMgmtPage();
    showToast(label+' 저장 실패: '+_friendlySaveError(e.message),{type:'error'});
  }
}
