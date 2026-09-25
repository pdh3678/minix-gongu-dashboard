'use strict';
/* 수정 모달 저장·삭제와 상품코드·사은품 목록 편집. */

// 모달의 현재 입력값을 d(원본 딜)와 비교해 "실제로 바뀐 필드만" 담은 객체를 만듦.
// updateDeal 액션은 여기 담긴 키만 시트에 반영하고, 나머지 열은 건드리지 않음.
function _collectModalChanges(d){
  const line=document.getElementById('mLine').value;
  const model=document.getElementById('mModel').value;
  // 시트 규칙 표기(공백 포함)로 변환해야 원본(d.product, 시트에서 그대로 내려온 값)과 비교했을 때
  // 사용자가 제품을 바꾸지 않은 경우 changes.product가 생기지 않음 — 실적만 고쳐도 C열이 불필요하게
  // 다시 쓰이며 데이터 확인 규칙을 위반하던 버그의 원인이 바로 이 비교였음.
  const product=toSheetProductName(LINE_HAS_MODELS[line]?(model||''):line);
  const influencer=document.getElementById('mInfluencer').value.trim();
  const platform=document.getElementById('mPlatform').value;
  const vendor=document.getElementById('mVendor').value.trim();
  const tier=document.getElementById('mTier').value;
  const followers=_followerInputValue('mFollowers'); // 숫자 or null(미입력)
  const link=document.getElementById('mLinkInput').value.trim();
  const marketingLink=document.getElementById('mMarketingLink').value.trim();
  const start=document.getElementById('mStart').value;
  const end=document.getElementById('mEnd').value;
  const saleVal=document.getElementById('mSaleInput').value;
  const commVal=document.getElementById('mCommInput').value;
  const format=document.getElementById('mFormat').value;
  const composition=document.getElementById('mComposition').value.trim();
  const targetQtyVal=document.getElementById('mTargetQty').value;
  const qtyVal=document.getElementById('mQtyInput').value;
  // option2=오픈시간, firstCome=선착순 품목, note=적립금으로 재사용됨(2026-08-18 개편) — wire 필드명은
  // apps-script.js COL/PRIMARY_ONLY_COLS와 그대로 맞춰야 하므로 이름은 바꾸지 않고 의미만 바뀜.
  const option2=document.getElementById('mOpenTime').value;
  const firstCome=document.getElementById('mFirstComeItem').value;
  const firstComeQty=document.getElementById('mFirstComeQty').value;
  const note=document.getElementById('mPoints').value; // 적립금
  const noteText=document.getElementById('mNoteInput').value.trim(); // 신규 비고(서버 note2 / 클라 s.note)
  const gifts=_modalGifts.filter(g=>g.item);
  const giftItem1=gifts[0]?gifts[0].item:'',giftQty1=gifts[0]?gifts[0].qty:'';
  const giftItem2=gifts[1]?gifts[1].item:'',giftQty2=gifts[1]?gifts[1].qty:'';
  const giftItem3=gifts[2]?gifts[2].item:'',giftQty3=gifts[2]?gifts[2].qty:'';
  const extraQtyVal=document.getElementById('mExtraQty').value;

  const sale=saleVal!==''?Number(saleVal):null;
  const comm=commVal!==''?Number(commVal):null;
  const targetQty=targetQtyVal!==''?Number(targetQtyVal):null;
  const qty=qtyVal!==''?Number(qtyVal):null;
  const extraQty=extraQtyVal!==''?Number(extraQtyVal):null;

  const s=d.s||{};
  const cur={
    product:d.product||'',channel:d.ch||'',platform:d.platform||'',vendor:d.vendor||'',link:d.link||'',
    marketingLink:d.marketingLink||'',
    start:d.start||'',end:d.end||'',sale:s.sale!=null?s.sale:null,comm:s.comm!=null?s.comm:null,
    format:d.format||'',composition:d.composition||'',targetQty:d.targetQty!=null?d.targetQty:null,qty:d.qty!=null?d.qty:null,
    option2:d.option2||'',firstCome:d.firstCome||'',firstComeQty:d.firstComeQty!=null?String(d.firstComeQty):'',
    note:d.note||'',
    giftItem1:d.giftItem1||'',giftQty1:d.giftQty1!=null?String(d.giftQty1):'',
    giftItem2:d.giftItem2||'',giftQty2:d.giftQty2!=null?String(d.giftQty2):'',
    giftItem3:d.giftItem3||'',giftQty3:d.giftQty3!=null?String(d.giftQty3):'',
    extraQty:d.extraQty!=null?d.extraQty:null,note2:s.note!=null?s.note:'',tier:manualTierOf(d),
    followers:d.followers!=null?d.followers:null,
    igId:d.igId||'',ytId:d.ytId||''
  };
  const next={
    product,channel:influencer,platform,vendor,link,marketingLink,start,end,sale,comm,format,composition,targetQty,qty,
    option2,firstCome,firstComeQty,note,
    giftItem1,giftQty1,giftItem2,giftQty2,giftItem3,giftQty3,
    extraQty,note2:noteText,tier,followers,
    igId:_chFieldNorm('igId',document.getElementById('mIgId').value),
    ytId:_chFieldNorm('ytId',document.getElementById('mYtId').value)
  };

  const changes={};
  for(const k in next){if(next[k]!==cur[k])changes[k]=next[k];}

  const codes=_modalCodes.map(c=>c.trim()).filter(c=>c);
  const codesChanged=JSON.stringify(codes)!==JSON.stringify(d.codes||[]);

  // toSheetProductName이 매핑을 못 찾으면 null을 반환함 — 그 경우 이 값을 그대로 저장 요청에
  // 실으면 안 되므로, 호출부(saveSchemeModal)가 이 플래그를 보고 저장 자체를 막게 함.
  return {changes,next,codes:codes.length?codes:[''],codesChanged,productInvalid:product===null};
}

async function saveSchemeModal(){
  const d=DATA.find(x=>x.dealId===_modalDealId);
  if(!d){_showSaveSummary('m','이 공구건을 찾을 수 없습니다. 새로고침 후 다시 시도해주세요.');return;}

  /* 검증 결과를 한 번에 모아서 보여준다 — 예전처럼 첫 실패에서 alert 하나 띄우고 끝내면
     문제가 여러 개일 때 저장을 누를 때마다 하나씩 튀어나오고, 알림을 닫는 순간 화면엔 단서가 없다. */
  const mLine=document.getElementById('mLine').value;
  const mStart=document.getElementById('mStart').value,mEnd=document.getElementById('mEnd').value;
  const errs=[];
  if(!mLine)errs.push({id:'mLine',msg:'품목군을 선택해주세요'});
  else if(LINE_HAS_MODELS[mLine]&&!document.getElementById('mModel').value)errs.push({id:'mModel',msg:'제품을 선택해주세요'});
  if(!document.getElementById('mInfluencer').value.trim())errs.push({id:'mInfluencer',msg:'채널명을 입력해주세요'});
  if(!document.getElementById('mPlatform').value)errs.push({id:'mPlatform',msg:'플랫폼을 선택해주세요'});
  if(!document.getElementById('mMonth').value)errs.push({id:'mMonth',msg:'월을 선택해주세요'});
  if(!mStart)errs.push({id:'mStart',msg:'시작일을 입력해주세요'});
  if(!mEnd)errs.push({id:'mEnd',msg:'마감일을 입력해주세요'});
  if(mStart&&mEnd&&new Date(mStart)>new Date(mEnd))errs.push({id:'mEnd',msg:'마감일이 시작일보다 빠릅니다'});
  if(errs.length){_showSaveErrors('m',errs);return;}
  _clearFieldErrors('m');

  const {changes,next,codes,codesChanged,productInvalid}=_collectModalChanges(d);
  if(productInvalid){
    _showSaveErrors('m',[{id:'mModel',msg:'제품명 표기가 시트 규칙과 맞지 않습니다 — 관리자에게 문의해주세요'}]);
    return;
  }

  let reels=_modalReels.filter(r=>r.url||r.views!=null||r.thumb).slice(0,10);
  /* ⚠ 2026-09-15: 예전엔 "릴스가 있기만 하면"(reels.length>0||_modalHadReels) 무조건 릴스를
     다시 저장했다. 실제로는 릴스를 전혀 건드리지 않은 저장이 대부분인데도 매번 슬롯 10칸을
     다시 쓰고 있었고, 그게 별도 HTTP 왕복(왕복당 1.7~2초)까지 만들었다.
     이제는 내용을 실제로 비교해서 달라졌을 때만 보낸다 — 값이 같으면 시트를 건드릴 이유가 없다. */
  const touchReels=_reelsChanged(d.reels,reels);
  const url=_getGasUrl();

  console.log('[변경된 필드]',changes,'[상품코드]',codes,codesChanged?'(변경됨)':'(변경없음)');

  if(url && reels.some(r=>r._pendingUpload)){
    setLoad(true);
    try{
      for(const r of reels){
        if(!r._pendingUpload)continue;
        const j=await _gasWrite(url,'uploadThumbnail',r._pendingUpload);
        if(j.error)throw new Error(j.error);
        r.thumb=j.url;
      }
    }catch(e){
      // 저장 실패는 전부 같은 자리(저장 버튼 옆)에 사유를 남긴다 — alert는 닫으면 단서가 사라진다
      console.error('[저장] 썸네일 업로드 실패:',e);
      _showSaveSummary('m','썸네일 업로드 실패: '+((e&&e.message)||String(e)));
      showToast('썸네일 업로드 실패: '+((e&&e.message)||String(e)),{type:'error'});
      setLoad(false);return;
    }
  }
  reels=reels.map(r=>({url:r.url,views:r.views,thumb:r.thumb})); // 내부 전용 필드(_pendingUpload) 제거
  const totalViews=reels.length?reels.reduce((s,r)=>s+(r.views||0),0):null;

  if(url){
    if(Object.keys(changes).length===0 && !touchReels && !codesChanged){closeSchModal();showToast('변경된 내용이 없습니다');return;}
    if(isDealSaving(d.dealId)){showToast('이 공구건은 아직 저장 중입니다. 잠시 후 다시 시도해주세요.');return;}

    /* 채널 단위 필드(플랫폼 ID·팔로워 수)는 같은 채널의 다른 공구건에도 반영한다.
       다른 값이 들어 있는 건이 있으면 저장 직전에 물어본다 — 남의 입력을 말없이 덮어쓰지 않기 위함.
       ⚠ 반드시 낙관적 반영(모달 닫기) **전에** 물어야 한다. 모달을 먼저 닫고 물으면
       사용자가 방금 뭘 저장하려던 건지 화면에서 사라진 뒤에 질문을 받게 된다. */
    const chInfo=channelInfoOf(next.channel);
    const {changed:chChanged,plan:chPlan}=_collectChannelFieldChanges(d,next.channel);
    let chMode=null;
    if(Object.keys(chChanged).length){
      chMode=_askChannelPropagateMode(next.channel,chPlan,chInfo?chInfo.total:1);
      if(chMode===null)return; // 취소 — 저장 자체를 하지 않음
    }
    // 'thisOnly'면 전파하지 않고 이 건에만 쓴다(changes에 이미 들어 있음)
    const channelFields=(chMode&&chMode!=='thisOnly')
      ? {channel:next.channel,mode:chMode,fields:chChanged} : null;

    // ── 낙관적 반영: 요청을 보내기 전에 화면부터 끝낸다 ──
    console.time('[저장] 낙관적 반영→모달 닫힘');
    const snapshot=_snapshotDeal(d);
    /* ⚠ tiers는 아래 try 블록 안에서 계산되지만 **요청 payload를 만들 때(try 바깥)** 쓴다.
       const/let은 블록 스코프라 try 안에 두면 바깥에서 "tiers is not defined"가 된다
       (실제로 그렇게 깨졌던 자리 — 나중에 try를 씌우면서 기존 선언이 블록에 갇혔다).
       블록을 넘어 살아야 하는 값은 반드시 블록 바깥에서 선언할 것. */
    let tiers=null;
    _savingDeals.set(d.dealId,{snap:snapshot,at:Date.now()});
    /* ⚠ 여기서부터 요청을 띄우기 전까지 예외가 나면 잠금이 그대로 남아, 그 공구건은 이후 영영
       "저장 중인 공구건입니다"만 뜨고 열리지도 저장되지도 않는다(실제로 겪은 증상). 렌더가
       던질 수 있으므로 반드시 감싸고, 실패하면 되돌린 뒤 이유를 화면에 남긴다. */
    try{
    Object.assign(d,_dealFieldsFromNext(next,codes,codesChanged,reels,touchReels,totalViews));
    d.s=d.s||{};d.s.sale=next.sale;d.s.comm=next.comm;d.s.note=next.note2;
    if(next.sale!=null&&next.qty!=null)d.rev=next.sale*next.qty;
    d._saving=true;
    // 등급은 방금 반영한 값 기준으로 다시 산정해야 시트에 맞는 값이 나감
    // 전파 대상 건들에도 새 값을 미리 반영 — 화면과 시트가 같은 상태에서 출발해야 한다
    if(channelFields)_applyChannelFieldsLocally(next.channel,chChanged,chMode,d.dealId);
    invalidateTierStats();invalidateChannelInfo();
    tiers=_tiersForSave(next.channel);
    /* 전파된 건들의 등급 행도 미리 맞춘다 — 서버가 같은 실행에서 G·H를 써주므로, 로컬만 옛 값으로
       남아 있으면 다음 렌더에서 불필요한 writeTiers가 한 번 더 나간다. */
    _presetTierRows(d,tiers);
    if(channelFields)_presetChannelTierRows(next.channel,tiers);
    closeSchModal();
    render();
    }catch(pre){
      _restoreDeal(d,snapshot);
      _savingDeals.delete(d.dealId);
      delete d._saving;
      invalidateTierStats();invalidateChannelInfo();
      console.error('[저장] 화면 반영 중 오류 — 저장을 중단하고 되돌렸습니다:',pre);
      _openRegisteredModal(d);
      _showSaveSummary('m','화면 반영 중 오류가 발생해 저장하지 못했습니다: '+((pre&&pre.message)||String(pre)));
      return;
    }
    console.timeEnd('[저장] 낙관적 반영→모달 닫힘');
    showToast('저장 중…');

    const _t0=performance.now();
    const _legs=[]; // 요청 단위 구간 — 왕복이 몇 번이고 각각 얼마였는지 구분해서 보기 위함
    (async()=>{
      // updateDeal과 saveReels는 둘 다 dealId로 같은 행을 직접 찾으므로 병렬로 보내도 안전하지만,
      // 실패 시 원인 구분이 쉽도록 순차 처리 유지.
      // 본문·등급·릴스를 한 요청에 담는다. Apps Script는 왕복당 고정비가 1.7~2초라
      // (302 리다이렉트 구조상 줄일 수 없음) 요청 수가 곧 저장 시간이다.
      const payload={dealId:d.dealId,changes,codes,tiers};
      if(touchReels)payload.reels=reels;
      if(channelFields)payload.channelFields=channelFields; // 같은 실행에서 전파 — 왕복 1회 유지
      const r1=await _gasLeg(_legs,'updateDeal',()=>_gasWrite(url,'updateDeal',payload));
      if(!r1||r1.success!==true||r1.error)throw new Error((r1&&r1.error)||'updateDeal 응답에 success:true가 없습니다');
      return r1;
    })().then(res=>{
      _logSaveTimings('수정 저장',res&&res.timings,performance.now()-_t0,_legs);
      // 프론트가 스스로 알 수 없는 건 행 번호뿐 — 그것만 서버 값으로 맞춘다(전체 재조회 불필요)
      if(res&&Array.isArray(res.tierRows)&&res.tierRows.length)d._tierRows=res.tierRows;
      if(res&&res.rowIndex!=null)d.id=res.rowIndex;
      if(res&&res.rowCount!=null)d._rowCount=res.rowCount;
      _savingDeals.delete(d.dealId);
      delete d._saving;
      render();
      showToast('저장되었습니다',{type:'success'});
    }).catch(e=>{
      console.error('[저장 실패]',e);
      // 저장 직전 상태로 완전히 되돌리고, 사용자가 입력했던 값 그대로 모달을 다시 연다
      const attempted=Object.assign({},d,_dealFieldsFromNext(next,codes,true,reels,true,totalViews),
        {codes,reels,s:{...(d.s||{}),sale:next.sale,comm:next.comm,note:next.note2}});
      _restoreDeal(d,snapshot);
      _savingDeals.delete(d.dealId);
      delete d._saving;
      invalidateTierStats();
      render();
      showToast('저장 실패: '+_friendlySaveError(e.message)+' — 입력값을 그대로 다시 열었습니다',{type:'error'});
      _openRegisteredModal(attempted);
      // 토스트는 몇 초 뒤 사라지므로, 모달 안에도 실제 사유를 남겨 사용자가 다시 읽을 수 있게 함
      _showSaveSummary('m','저장 실패: '+((e&&e.message)||String(e)));
    });
  } else {
    Object.assign(d,{product:next.product,ch:next.channel,influencer:next.channel,platform:next.platform,vendor:next.vendor,link:next.link,marketingLink:next.marketingLink,start:next.start,end:next.end,format:next.format,composition:next.composition,targetQty:next.targetQty,qty:next.qty,option2:next.option2,firstCome:next.firstCome,firstComeQty:next.firstComeQty,note:next.note,giftItem1:next.giftItem1,giftQty1:next.giftQty1,giftItem2:next.giftItem2,giftQty2:next.giftQty2,giftItem3:next.giftItem3,giftQty3:next.giftQty3,extraQty:next.extraQty,tier:next.tier,followers:next.followers,status:_calcStatus(next.start,next.end)});
    if(codesChanged)d.codes=codes;
    d.s=d.s||{};d.s.sale=next.sale;d.s.comm=next.comm;d.s.note=next.note2;
    if(next.sale!=null&&next.qty!=null)d.rev=next.sale*next.qty;
    if(touchReels){d.reels=reels;d.views=totalViews;}
    _refreshModalHeader(d);
    closeSchModal();render();
    alert('샘플 모드: 로컬에 저장되었습니다. (새로고침 시 초기화)');
  }
}

// 삭제 확인 다이얼로그 — 채널명/제품명과 함께 연결된 릴스 개수를 안내
function confirmDeleteDeal(){
  const d=DATA.find(x=>x.dealId===_modalDealId);if(!d)return;
  const reelCount=(d.reels&&d.reels.length)||0;
  const msg=`이 공구건을 삭제할까요?\n\n${d.product} · ${d.ch}\n\n실적통합 시트에서 삭제되며 되돌릴 수 없습니다.`+
    (reelCount?`\n연결된 릴스 데이터 ${reelCount}개도 삭제됩니다.`:'');
  if(!confirm(msg))return;
  deleteDeal(d);
}

function deleteDeal(d){
  const url=_getGasUrl();
  if(!url){
    const idx=DATA.indexOf(d);if(idx>=0)DATA.splice(idx,1);
    closeSchModal();render();
    alert('샘플 모드: 로컬에서만 삭제되었습니다. (새로고침 시 초기화)');
    return;
  }
  setLoad(true);
  _gasWrite(url,'deleteDeal',{dealId:d.dealId})
    .then(j=>{
      if(!j||j.success!==true||j.error)throw new Error((j&&j.error)||'삭제 응답에 success:true가 없습니다');
      const idx=DATA.indexOf(d);if(idx>=0)DATA.splice(idx,1);
      closeSchModal();render();setLoad(false);
      showToast('삭제됨');
      fetchLive();
    }).catch(e=>{console.error('[삭제 실패]',e);showToast('삭제 실패: '+_friendlySaveError(e.message));setLoad(false);});
}

document.getElementById('schOv').addEventListener('click',e=>{if(e.target===document.getElementById('schOv'))closeSchModal();});

function openModalLink(){
  const url=normalizeUrl(document.getElementById('mLinkInput').value);
  if(!url){showToast('입력된 링크가 없습니다');return;}
  window.open(url,'_blank','noopener');
}

// 모달 상품코드 세로 리스트 (최대 10개) — _modalReels/renderReelList 패턴을 그대로 본뜸
function renderCodeList(){
  const host=document.getElementById('mCodeList');
  host.innerHTML=_modalCodes.map((c,i)=>`
    <div class="code-row">
      <input class="f-inp" type="text" placeholder="상품코드" value="${_escAttr(c)}" oninput="updateCodeVal(${i},this.value)">
      <button type="button" class="btn-cancel" onclick="cpTxt(this.previousElementSibling.value,this)">복사</button>
      ${_modalCodes.length>1?`<button type="button" class="btn-cancel" onclick="removeCodeRow(${i})">삭제</button>`:''}
    </div>`).join('');
  const addBtn=document.getElementById('mCodeAddBtn');
  if(addBtn)addBtn.disabled=_modalCodes.length>=10;
}
function updateCodeVal(i,val){_modalCodes[i]=val;}
function addCodeRow(){
  if(_modalCodes.length>=10)return;
  _modalCodes.push('');
  renderCodeList();
}
function removeCodeRow(i){
  _modalCodes.splice(i,1);
  if(!_modalCodes.length)_modalCodes=[''];
  renderCodeList();
}

// 수정 모달의 사은품 품목+수량 세로 리스트(최대 3개) — renderCodeList 패턴을 그대로 본뜸
let _modalGifts=[{item:'',qty:''}];
function renderGiftList(){
  const host=document.getElementById('mGiftList');
  host.innerHTML=_modalGifts.map((g,i)=>`
    <div class="code-row">
      <select class="f-inp f-sel" style="flex:2" onchange="updateGiftItem(${i},this.value)">${_giftItemOptionsHtml()}</select>
      <select class="f-inp f-sel" style="flex:1" onchange="updateGiftQty(${i},this.value)">${_giftQtyOptionsHtml()}</select>
      ${_modalGifts.length>1?`<button type="button" class="btn-cancel" onclick="removeGiftRow(${i})">삭제</button>`:''}
    </div>`).join('');
  const rows=host.querySelectorAll('.code-row');
  rows.forEach((row,i)=>{
    const sels=row.querySelectorAll('select');
    sels[0].value=_modalGifts[i].item||'';
    sels[1].value=_modalGifts[i].qty||'';
  });
  const addBtn=document.getElementById('mGiftAddBtn');
  if(addBtn)addBtn.disabled=_modalGifts.length>=3;
}
function updateGiftItem(i,val){_modalGifts[i].item=val;mRecalcComposition();}
function updateGiftQty(i,val){_modalGifts[i].qty=val;mRecalcComposition();}
function addGiftRow(){
  if(_modalGifts.length>=3)return;
  _modalGifts.push({item:'',qty:''});
  renderGiftList();
}
function removeGiftRow(i){
  _modalGifts.splice(i,1);
  if(!_modalGifts.length)_modalGifts=[{item:'',qty:''}];
  renderGiftList();
  mRecalcComposition();
}
// 사은품/오픈시간/선착순/적립금/비고 선택값 기반으로 "구성"을 자동 조합해 읽기전용 칸에 채움 —
// 관련 필드가 바뀔 때마다(각 select의 onchange, 비고의 oninput) 호출됨
function mRecalcComposition(){
  document.getElementById('mComposition').value=_buildCompositionString({
    gifts:_modalGifts,
    firstComeItem:document.getElementById('mFirstComeItem').value,
    firstComeQty:document.getElementById('mFirstComeQty').value,
    points:document.getElementById('mPoints').value,
    note:document.getElementById('mNoteInput').value
  });
}
