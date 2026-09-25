'use strict';
/* 새 공구건 등록 모달 — 열기/닫기, 복사 등록, 저장(saveDeal). */

let _formCodes=['']; // 새 공구건 등록 폼의 상품코드 목록(모달의 _modalCodes와 별개 인스턴스)
function renderFormCodeList(){
  const host=document.getElementById('fCodeList');
  host.innerHTML=_formCodes.map((c,i)=>`
    <div class="code-row">
      <input class="f-inp" type="text" placeholder="예: 13646128618" value="${_escAttr(c)}" oninput="updateFormCodeVal(${i},this.value)">
      ${_formCodes.length>1?`<button type="button" class="btn-cancel" onclick="removeFormCodeRow(${i})">삭제</button>`:''}
    </div>`).join('');
  const addBtn=document.getElementById('fCodeAddBtn');
  if(addBtn)addBtn.disabled=_formCodes.length>=10;
}
function updateFormCodeVal(i,val){_formCodes[i]=val;}
function addFormCodeRow(){
  if(_formCodes.length>=10)return;
  _formCodes.push('');
  renderFormCodeList();
}
function removeFormCodeRow(i){
  _formCodes.splice(i,1);
  if(!_formCodes.length)_formCodes=[''];
  renderFormCodeList();
}

// 새 공구건 등록 폼의 사은품 품목+수량 세로 리스트(최대 3개) — 모달의 _modalGifts와 별개 인스턴스
let _formGifts=[{item:'',qty:''}];
function renderFormGiftList(){
  const host=document.getElementById('fGiftList');
  host.innerHTML=_formGifts.map((g,i)=>`
    <div class="code-row">
      <select class="f-inp f-sel" style="flex:2" onchange="updateFormGiftItem(${i},this.value)">${_giftItemOptionsHtml()}</select>
      <select class="f-inp f-sel" style="flex:1" onchange="updateFormGiftQty(${i},this.value)">${_giftQtyOptionsHtml()}</select>
      ${_formGifts.length>1?`<button type="button" class="btn-cancel" onclick="removeFormGiftRow(${i})">삭제</button>`:''}
    </div>`).join('');
  const rows=host.querySelectorAll('.code-row');
  rows.forEach((row,i)=>{
    const sels=row.querySelectorAll('select');
    sels[0].value=_formGifts[i].item||'';
    sels[1].value=_formGifts[i].qty||'';
  });
  const addBtn=document.getElementById('fGiftAddBtn');
  if(addBtn)addBtn.disabled=_formGifts.length>=3;
}
function updateFormGiftItem(i,val){_formGifts[i].item=val;fRecalcComposition();}
function updateFormGiftQty(i,val){_formGifts[i].qty=val;fRecalcComposition();}
function addFormGiftRow(){
  if(_formGifts.length>=3)return;
  _formGifts.push({item:'',qty:''});
  renderFormGiftList();
}
function removeFormGiftRow(i){
  _formGifts.splice(i,1);
  if(!_formGifts.length)_formGifts=[{item:'',qty:''}];
  renderFormGiftList();
  fRecalcComposition();
}
function fRecalcComposition(){
  document.getElementById('fComposition').value=_buildCompositionString({
    gifts:_formGifts,
    firstComeItem:document.getElementById('fFirstComeItem').value,
    firstComeQty:document.getElementById('fFirstComeQty').value,
    points:document.getElementById('fPoints').value,
    note:document.getElementById('fNote').value
  });
}

function openDealForm(){
  // 오늘 날짜를 기본값으로
  const today=new Date().toISOString().split('T')[0];
  document.getElementById('fStart').value=today;
  document.getElementById('fEnd').value=today;
  onDateChange();
  _formCodes=[''];
  renderFormCodeList();
  _formGifts=[{item:'',qty:''}];
  renderFormGiftList();
  document.getElementById('fOpenTime').value='';
  document.getElementById('fFirstComeItem').value='';
  document.getElementById('fFirstComeQty').value='';
  document.getElementById('fPoints').value='';
  document.getElementById('fTier').value=''; // 수동 지정은 항상 '사용 안 함'에서 시작
  _setFollowerInput('fFollowers',null); // 채널명을 입력하면 그 채널의 최근 값으로 자동 채워짐
  _refreshChannelNameList();
  _refreshTierAutoLine('fInfluencer','fTier','fTierAuto');
  fRecalcComposition();
  document.getElementById('fCopyNotice').style.display='none';
  _initLinkAuto('f'); // 새 폼이므로 자동/수동 상태도 초기화
  document.getElementById('dealOv').classList.add('open');
  _setHash('new-deal');
}
/* 신규 등록이 실패했을 때, 사용자가 방금 친 값을 그대로 담아 등록 폼을 다시 연다 (2026-09-15).
   closeDealForm()이 입력칸을 전부 비우므로 낙관적 반영 후에는 폼이 빈 상태다. 여기서 되돌려
   채워주지 않으면 "저장도 안 됐는데 입력한 것도 날아감"이 되어 최악이다.
   openDealForm()의 초기화를 그대로 탄 뒤 값을 덮어쓰는 순서를 지킬 것 — 품목군(fLine)을 먼저
   넣고 onLineChange()를 불러야 제품(fModel) 드롭다운이 채워진다(플랫폼/채널ID도 같은 관계). */
function _reopenDealFormWith(d){
  openDealForm();
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v==null?'':v;};
  const {line,model}=_lineModelFromProduct(d.product||'');
  set('fLine',line); if(typeof onLineChange==='function')onLineChange();
  set('fModel',model); if(typeof onModelChange==='function')onModelChange();
  set('fInfluencer',d.ch||d.influencer||'');
  set('fPlatform',d.platform||''); if(typeof onPlatformChange==='function')onPlatformChange();
  set('fIgId',d.igId||''); set('fYtId',d.ytId||'');
  set('fStart',d.start||''); set('fEnd',d.end||''); if(typeof onDateChange==='function')onDateChange();
  set('fVendor',d.vendor||''); set('fLink',d.link||''); set('fMarketingLink',d.marketingLink||'');
  _initLinkAuto('f');
  set('fFormat',d.format||''); set('fComposition',d.composition||'');
  set('fTargetQty',d.targetQty!=null?d.targetQty:'');
  set('fExtraQty',d.extraQty!=null?d.extraQty:'');
  set('fOpenTime',d.option2||''); set('fFirstComeItem',d.firstCome||''); set('fFirstComeQty',d.firstComeQty||'');
  set('fPoints',d.note||'');
  set('fNote',(d.s&&d.s.note)||'');
  set('fSalePrice',(d.s&&d.s.sale)!=null?d.s.sale:'');
  set('fCommission',(d.s&&d.s.comm)!=null?d.s.comm:'');
  set('fTier',d.tier||'');
  if(typeof _setFollowerInput==='function')_setFollowerInput('fFollowers',d.followers!=null?d.followers:null);
  _formCodes=(Array.isArray(d.codes)&&d.codes.length?d.codes.slice():['']);
  renderFormCodeList();
  _formGifts=[];
  for(let i=1;i<=3;i++){
    const it=d['giftItem'+i],q=d['giftQty'+i];
    if(it)_formGifts.push({item:it,qty:q||''});
  }
  if(!_formGifts.length)_formGifts=[{item:'',qty:''}];
  renderFormGiftList();
  if(typeof fRecalcComposition==='function')fRecalcComposition();
  set('fComposition',d.composition||''); // 자동 재계산이 덮어썼을 수 있어 마지막에 한 번 더
}

function closeDealForm(){
  document.getElementById('dealOv').classList.remove('open');
  document.getElementById('dealOv').querySelectorAll('input,select,textarea').forEach(el=>{if(!el.readOnly)el.value='';});
  document.getElementById('fYear').value='';
  document.getElementById('fMonth').value='';
  document.getElementById('fDuration').value='';
  document.getElementById('fModel').value='';
  document.getElementById('fProduct').value='';
  document.getElementById('modelRow').style.display='none';
  document.getElementById('fIgId').value='';
  document.getElementById('fYtId').value='';
  _syncPlatformIdMarks('f','');
  document.getElementById('fCopyNotice').style.display='none';
  _formCodes=[''];
  renderFormCodeList();
  _formGifts=[{item:'',qty:''}];
  renderFormGiftList();
  fRecalcComposition();
  _setHash(_currentPageHash); // 모달 밑에 깔려있던 실제 탭 해시로 복귀
}

// 수정 모달에서 "복사하여 새 공구건 만들기" — 현재 보던 건의 값을 신규 등록 폼에 미리 채워 넣음.
// 원본 건(DATA/시트)은 전혀 건드리지 않음(신규 등록 폼은 별도 DOM/상태이고, 저장 전까지 아무
// 네트워크 요청도 없음). 시작일/마감일은 사용자가 새로 지정해야 하므로 의도적으로 비워두고,
// 판매수량 등 실적·릴스/썸네일은 애초에 신규 등록 폼에 입력칸이 없어 별도 처리가 필요 없음.
function copyDealToNew(){
  const d=DATA.find(x=>x.dealId===_modalDealId);
  if(!d){showToast('원본 공구건 정보를 찾을 수 없습니다.');return;}
  closeSchModal();
  openDealForm();

  const {line,model}=_lineModelFromProduct(d.product);
  document.getElementById('fLine').value=line;
  onLineChange();
  if(LINE_HAS_MODELS[line]){
    document.getElementById('fModel').value=model;
    onModelChange();
  }

  document.getElementById('fInfluencer').value=d.ch||d.influencer||'';
  document.getElementById('fPlatform').value=d.platform||'';
  onPlatformChange(); // 필수 표시 갱신
  document.getElementById('fIgId').value=d.igId||'';
  document.getElementById('fYtId').value=d.ytId||'';
  // ID 열이 생기기 전에 등록된 건은 ID가 비어 있고 링크만 있다 — 링크에서 뽑아 해당 칸을 채움
  const _cpId=_extractChannelIdFromLink(d.platform,d.link);
  if(_cpId){
    const _cpEl=document.getElementById(_platformKind(d.platform)==='yt'?'fYtId':'fIgId');
    if(_cpEl&&!_cpEl.value)_cpEl.value=_cpId;
  }
  document.getElementById('fVendor').value=d.vendor||'';
  document.getElementById('fTier').value=manualTierOf(d); // 복사한 건의 수동 지정을 그대로 이어받음(같은 채널이므로)
  _setFollowerInput('fFollowers',d.followers!=null?d.followers:null); // 같은 채널이라 직전 값이 출발점으로 적절
  document.getElementById('fLink').value=d.link||'';
  _initLinkAuto('f');
  document.getElementById('fMarketingLink').value=d.marketingLink||'';

  // openDealForm()이 오늘 날짜로 채워둔 시작일/마감일을 다시 비움 — 새 건이므로 새로 지정해야 함
  document.getElementById('fStart').value='';
  document.getElementById('fEnd').value='';
  document.getElementById('fYear').value='';
  document.getElementById('fDuration').value='';

  _formCodes=(d.codes&&d.codes.length?d.codes.slice(0,10):['']); // 그룹(코드 여러 개) 건이면 병합된 전체 코드 목록이 그대로 복사됨
  renderFormCodeList();

  const s=d.s||{};
  document.getElementById('fSalePrice').value=s.sale!=null?s.sale:'';
  document.getElementById('fCommission').value=s.comm!=null?s.comm:'';
  document.getElementById('fFormat').value=d.format||'';
  document.getElementById('fTargetQty').value=d.targetQty!=null?d.targetQty:'';

  let gifts=[
    {item:d.giftItem1||'',qty:d.giftQty1!=null?String(d.giftQty1):''},
    {item:d.giftItem2||'',qty:d.giftQty2!=null?String(d.giftQty2):''},
    {item:d.giftItem3||'',qty:d.giftQty3!=null?String(d.giftQty3):''}
  ];
  while(gifts.length>1&&!gifts[gifts.length-1].item)gifts.pop();
  _formGifts=gifts;
  renderFormGiftList();

  document.getElementById('fOpenTime').value=_normOpenTimeValue(d.option2);
  document.getElementById('fFirstComeItem').value=d.firstCome||'';
  document.getElementById('fFirstComeQty').value=d.firstComeQty!=null?String(d.firstComeQty):'';
  document.getElementById('fPoints').value=d.note||'';
  document.getElementById('fExtraQty').value=d.extraQty!=null?d.extraQty:'';
  document.getElementById('fNote').value=s.note||'';
  fRecalcComposition();

  _refreshTierAutoLine('fInfluencer','fTier','fTierAuto');
  const notice=document.getElementById('fCopyNotice');
  notice.textContent=`📋 "${d.ch||d.influencer||'?'}" 건에서 복사됨 — 시작일/마감일을 새로 지정해주세요.`;
  notice.style.display='block';
}
document.getElementById('dealOv').addEventListener('click',e=>{if(e.target===document.getElementById('dealOv'))closeDealForm();});

/* 두 ID 칸(인스타/유튜브)이 항상 같이 보이므로, 선택한 플랫폼 쪽에만 필수(*) 표시를 옮기고
   나머지는 '선택'으로 둔다. 라벨 자체는 고정이라 줄바꿈이 생기지 않는다. */
function _syncPlatformIdMarks(prefix,p){
  const on=(id,show)=>{const el=document.getElementById(id);if(el)el.style.display=show?'':'none';};
  on(prefix+'IgReq',p==='인스타그램'); on(prefix+'IgOpt',p!=='인스타그램');
  on(prefix+'YtReq',p==='유튜브');     on(prefix+'YtOpt',p!=='유튜브');
}
function onPlatformChange(){
  const p=document.getElementById('fPlatform').value;
  _syncPlatformIdMarks('f',p);
  onChannelIdChange();
}

// 등록 폼에서 지금 선택된 플랫폼에 해당하는 ID 값(링크 생성·검증용)
function _formPlatformId(){
  const p=document.getElementById('fPlatform').value;
  const el=document.getElementById(p==='유튜브'?'fYtId':'fIgId');
  return el?el.value.trim().replace(/^@+/,''):'';
}

function onLineChange(){
  const line=document.getElementById('fLine').value;
  const modelRow=document.getElementById('modelRow');
  const fModel=document.getElementById('fModel');
  const fProd=document.getElementById('fProduct');
  if(LINE_HAS_MODELS[line]){
    modelRow.style.display='';
    _rebuildModelOptions(fModel,line);
    fModel.value='';
    fProd.value='';
  } else {
    modelRow.style.display='none';
    fProd.value=PRODUCT_SHEET_NAME[line]||line; // "제품명 참고" 필드도 시트 정식 표기로 표시
  }
}

function onModelChange(){
  const model=document.getElementById('fModel').value;
  document.getElementById('fProduct').value=model?(PRODUCT_SHEET_NAME[model]||model):'';
}

function onDateChange(){
  const s=document.getElementById('fStart').value;
  const e=document.getElementById('fEnd').value;
  if(s){
    const sd=new Date(s+'T00:00:00');
    document.getElementById('fYear').value=sd.getFullYear();
    document.getElementById('fMonth').value=String(sd.getMonth()+1); // 모달과 같은 이유로 월도 파생
  }
  if(s&&e){
    const sd=new Date(s+'T00:00:00'),ed=new Date(e+'T00:00:00');
    const diff=Math.round((ed-sd)/(1000*60*60*24))+1;
    document.getElementById('fDuration').value=diff>0?`${diff}일`:'—';
  }
}

function saveDeal(){
  const brand='Minix';
  const line=document.getElementById('fLine').value;
  const model=document.getElementById('fModel')?document.getElementById('fModel').value:'';
  // product = model if selected (더플렌더 PRO/MAX/mini/NEXT, 더시프트/더시프트PRO), else line name
  // 시트 C열 데이터 확인 규칙 표기(공백 포함)로 변환해서 저장 — toSheetProductName 참고
  const product=toSheetProductName(LINE_HAS_MODELS[line]?(model||line):line);
  const influencer=document.getElementById('fInfluencer').value.trim();
  const platform=document.getElementById('fPlatform').value;
  const channelId=_formPlatformId();
  const igId=document.getElementById('fIgId').value.trim().replace(/^@+/,'');
  const ytId=document.getElementById('fYtId').value.trim().replace(/^@+/,'');
  const start=document.getElementById('fStart').value;
  const end=document.getElementById('fEnd').value;
  const fErrs=[];
  if(!line)fErrs.push({id:'fLine',msg:'품목군을 선택해주세요'});
  else if(LINE_HAS_MODELS[line]&&!model)fErrs.push({id:'fModel',msg:'제품을 선택해주세요'});
  else if(!product)fErrs.push({id:'fModel',msg:'제품명 표기가 시트 규칙과 맞지 않습니다 — 관리자에게 문의해주세요'});
  if(!influencer)fErrs.push({id:'fInfluencer',msg:'채널명을 입력해주세요'});
  if(!platform)fErrs.push({id:'fPlatform',msg:'플랫폼을 선택해주세요'});
  if(platform==='인스타그램'&&!channelId)fErrs.push({id:'fIgId',msg:'인스타그램 ID를 입력해주세요'});
  if(platform==='유튜브'&&!channelId)fErrs.push({id:'fYtId',msg:'유튜브 ID를 입력해주세요'});
  if(!document.getElementById('fMonth').value)fErrs.push({id:'fMonth',msg:'월을 선택해주세요'});
  if(!start)fErrs.push({id:'fStart',msg:'시작일을 입력해주세요'});
  if(!end)fErrs.push({id:'fEnd',msg:'마감일을 입력해주세요'});
  if(start&&end&&new Date(start)>new Date(end))fErrs.push({id:'fEnd',msg:'마감일이 시작일보다 빠릅니다'});
  if(fErrs.length){_showSaveErrors('f',fErrs);return;}
  _clearFieldErrors('f');

  const formGifts=_formGifts.filter(g=>g.item);
  const noteText=document.getElementById('fNote').value.trim(); // 신규 비고(서버 note2 / 클라 s.note)
  const newDeal={
    brand,product,ch:influencer,
    influencer,platform,chId:channelId,
    vendor:document.getElementById('fVendor').value.trim(),
    link:document.getElementById('fLink').value.trim()||buildChannelLink(platform,channelId),
    marketingLink:document.getElementById('fMarketingLink').value.trim(),
    start,end,
    format:document.getElementById('fFormat').value,
    composition:document.getElementById('fComposition').value.trim(),
    targetQty:document.getElementById('fTargetQty').value?Number(document.getElementById('fTargetQty').value):null,
    // option2=오픈시간, firstCome=선착순 품목, note=적립금(재사용된 wire 필드명 — apps-script.js 참고)
    option2:document.getElementById('fOpenTime').value,
    firstCome:document.getElementById('fFirstComeItem').value,
    firstComeQty:document.getElementById('fFirstComeQty').value,
    note:document.getElementById('fPoints').value,
    giftItem1:formGifts[0]?formGifts[0].item:'',giftQty1:formGifts[0]?formGifts[0].qty:'',
    giftItem2:formGifts[1]?formGifts[1].item:'',giftQty2:formGifts[1]?formGifts[1].qty:'',
    giftItem3:formGifts[2]?formGifts[2].item:'',giftQty3:formGifts[2]?formGifts[2].qty:'',
    extraQty:document.getElementById('fExtraQty').value?Number(document.getElementById('fExtraQty').value):null,
    note2:noteText,
    tier:document.getElementById('fTier').value,
    followers:_followerInputValue('fFollowers'),
    // 채널 단위 속성 — 신규 등록에서도 시트 ID 열에 바로 기록되게 payload에 싣는다
    igId,ytId,
    status:_calcStatus(start,end),views:null,qty:null,rev:null,
    codes:_formCodes.map(c=>c.trim()).filter(c=>c),
    s:{retail:null,sale:Number(document.getElementById('fSalePrice').value)||null,comm:Number(document.getElementById('fCommission').value)||null,note:noteText}
  };
  if(!newDeal.codes.length)newDeal.codes=[''];

  const url=_getGasUrl();
  if(url){
    /* 신규 등록도 낙관적으로 — 임시 dealId로 목록에 먼저 띄우고 폼을 즉시 닫는다.
       임시 건은 _tierRows가 없어서 syncTiersToSheet가 건너뛰므로, 응답 오기 전에 엉뚱한 행에
       등급이 기록될 일은 없다. 등급 자체는 저장 payload(tiers)에 실어 같은 실행에서 기록된다. */
    console.time('[등록] 낙관적 반영→폼 닫힘');
    const tempId='__tmp_'+((window.crypto&&crypto.randomUUID)?crypto.randomUUID():Date.now());
    newDeal.dealId=tempId;
    newDeal.id=-Date.now();      // 목록 렌더 key용 임시값(응답에서 실제 행 번호로 교체)
    newDeal._saving=true;
    newDeal._tierRows=[];
    DATA.push(newDeal);
    _savingDeals.set(tempId,null); // 신규는 되돌릴 스냅샷이 없고 "목록에서 제거"가 롤백
    invalidateTierStats();
    const tiers=_tiersForSave(newDeal.ch);
    closeDealForm();
    render();
    console.timeEnd('[등록] 낙관적 반영→폼 닫힘');
    showToast('등록 중…');

    const _t0=performance.now();
    _gasWrite(url,'addSalesRow',Object.assign({},newDeal,{tiers}))
      .then(j=>{
        if(!j||j.error)throw new Error((j&&j.error)||'등록 응답에 결과가 없습니다');
        _logSaveTimings('신규 등록',j.timings,performance.now()-_t0,[{name:'addSalesRow',ms:Math.round(performance.now()-_t0),server:(j.timings&&j.timings.total)||null,exec:j.execMs!=null?j.execMs:null}]);
        // 임시값을 서버가 확정한 실제 값으로 교체
        newDeal.dealId=j.dealId||tempId;
        if(j.rowIndex!=null)newDeal.id=j.rowIndex;
        if(j.rowCount!=null)newDeal.rowCount=j.rowCount;
        newDeal._tierRows=Array.isArray(j.tierRows)?j.tierRows:[];
        _savingDeals.delete(tempId);
        delete newDeal._saving;
        render();
        showToast(`등록 완료 — 실적통합 ${j.mainRow}행에 연결되었습니다`,{type:'success'});
      }).catch(e=>{
        console.error('[등록 실패]',e);
        const idx=DATA.indexOf(newDeal);if(idx>=0)DATA.splice(idx,1); // 롤백 = 임시 건 제거
        _savingDeals.delete(tempId);
        invalidateTierStats();
        render();
        showToast('저장 실패: '+_friendlySaveError(e.message)+' — 입력값을 그대로 다시 열었습니다',{type:'error'});
        _reopenDealFormWith(newDeal);
      });
  } else {
    newDeal.dealId=crypto.randomUUID(); // 샘플 모드는 서버가 없어 dealId를 로컬에서 즉석 발급(새로고침 시 초기화됨)
    DATA.push(newDeal);
    closeDealForm();
    render();
    alert('샘플 모드: 로컬에 저장되었습니다. (새로고침 시 초기화)');
  }
}
