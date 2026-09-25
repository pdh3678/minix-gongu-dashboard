'use strict';
/* 공구건 상세(수정) 모달 — 열기, 헤더, 품목·플랫폼·날짜 입력. */

/* Scheme modal */
let _modalDealId=null,_modalChannel='',_modalReels=[],_modalHadReels=false,_activeReelIdx=null; // _modalDealId: dealId(UUID 문자열) — 물리 행 번호 아님
let _modalCodes=['']; // 상품코드 목록(최대 10개, 세로 리스트)

// 저장된 제품명(모델별로 구분 안 된 경우 포함)에서 품목군/제품 드롭다운 값을 역으로 유추
// (기존 데이터는 "더 플렌더 PRO"처럼 공백이 있고, 새 폼은 "더플렌더PRO"처럼 붙여 쓰므로 normP로 정규화해서 비교)
function _lineModelFromProduct(p){
  if(isFlender(p))return{line:'더플렌더',model:'더플렌더'+flenderModel(p)};
  // 더시프트 기본형/PRO 모두 여기서 처리 — shiftModel이 'PRO'면 PRO 드롭다운 옵션, 아니면 기본형
  // 옵션('더시프트', 공백 없는 내부 표기)으로 매핑. normP 기반이라 "더시프트"/"더 시프트" 등
  // 공백 차이와 무관하게 항상 올바른 드롭다운 값으로 역매핑됨.
  if(isShift(p))return{line:'더시프트',model:'더시프트'+(shiftModel(p)==='PRO'?'PRO':'')};
  const np=normP(p);
  if(np==='더슬림')return{line:'더슬림',model:''};
  if(np.includes('에어드라이')||np==='미니건조기')return{line:'더에어드라이',model:''};
  return{line:'',model:p||''};
}

function _refreshModalHeader(d){
  document.getElementById('mBrand').style.color='var(--minix)';
  document.getElementById('mBrand').textContent=`Minix · ${d.product}`;
  document.getElementById('mTitle').textContent=d.ch;
  const durTxt=durDays(d.start,d.end);
  document.getElementById('mSub').textContent=`${yearOf(d.start)}년 ${monthOf(d.start)}월 · ${fmtF(d.start)} ~ ${fmtF(d.end)}${durTxt?` (${durTxt}일)`:''} · ${_displayStatus(d)}`;
}

// dealId(UUID 문자열) 하나로만 공구건을 식별함 — 물리 행 번호/채널명 추측은 전부 폐기.
// 조회에 실패하면(=클릭한 칩/행의 dealId와 일치하는 건이 DATA에 없으면) 절대 다른 건으로
// 대체 열지 않음 — 엉뚱한 건이 열리는 것보다 그냥 안 열리는 게 낫다는 원칙.
function openM(dealId,srcEl){
  // 저장 중인 건은 열지 않는다 — 응답이 오기 전에 또 고치면 어느 값이 최종인지 알 수 없어지고,
  // 롤백 스냅샷도 어긋난다. 몇 백 ms짜리 잠금이라 실제로 걸리는 일은 드물다.
  if(isDealSaving(dealId)){showToast('저장 중인 공구건입니다. 잠시 후 다시 열어주세요.');return;}
  const d=DATA.find(x=>x.dealId===dealId);
  // [모달진단] 클릭한 칩/행이 기대한 채널·제품과, 실제로 그 dealId로 조회된 건의 채널·제품을 항상 비교 로그로 남김
  const expected=srcEl?`(기대: ${srcEl.dataset.ch||'?'}/${srcEl.dataset.product||'?'})`:'';
  console.log('[모달진단] 클릭 dealId='+dealId+' '+expected+' → 조회결과='+
    (d?(d.dealId+' / '+(d.ch||d.influencer||'')+' / '+(d.product||'')):'없음(매칭 실패, 모달 안 엶)'));
  if(d){
    _openRegisteredModal(d);
    return;
  }
  console.error('[모달오류] dealId="'+dealId+'"에 해당하는 공구건을 찾을 수 없습니다. '+expected+' 데이터가 새로고침되지 않았거나 해당 건이 삭제됐을 수 있습니다.');
  showToast('⚠ 해당 공구건 정보를 찾을 수 없습니다. 새로고침 후 다시 시도해주세요.');
}

function _openRegisteredModal(d){
  _modalDealId=d.dealId;_modalChannel=d.ch||'';_activeReelIdx=null;
  _modalHadReels=!!(d.reels&&d.reels.length);
  _modalReels=(d.reels&&d.reels.length?d.reels:[]).map(r=>({url:r.url||'',views:r.views!=null?r.views:null,thumb:r.thumb||''})).slice(0,10);

  _refreshModalHeader(d);

  // 기본 정보
  const {line,model}=_lineModelFromProduct(d.product);
  document.getElementById('mLine').value=line;
  document.getElementById('mModelRow').style.display=LINE_HAS_MODELS[line]?'':'none';
  if(LINE_HAS_MODELS[line])_rebuildModelOptions(document.getElementById('mModel'),line); // 옵션을 먼저 채워야 아래 .value 대입이 실제로 선택됨
  document.getElementById('mModel').value=model;
  document.getElementById('mProduct').value=d.product||'';

  // 채널 정보 — 채널ID는 시트에 별도 열로 저장되지 않지만, 채널명 셀의 하이퍼링크(또는 링크 열)에서
  // 역추출해서 채워줌. mOnPlatformChange 호출 시점엔 아직 비워둬야 mOnChannelIdChange가 빈 값으로
  // 보고 링크를 안 건드림 — 링크를 실제 값으로 설정한 다음에 마지막으로 ID만 대입(이벤트 안 태움).
  document.getElementById('mInfluencer').value=d.ch||d.influencer||'';
  _refreshChannelNameList();
  // 드롭다운에는 '이 행에 저장된 수동 지정' 값만 들어감(비어 있는 게 정상) — 아래 안내줄이 자동 산정을 보여줌
  document.getElementById('mTier').value=manualTierOf(d);
  /* ⚠ 순서 주의: 이 건의 값을 먼저 넣고(아래 3줄), placeholder를 맞춘 뒤에야
     _autofillChannelFields를 부른다. 반대로 하면 자동 채움이 넣은 값을 곧바로 d의 빈 값으로
     덮어써서, 옅은 배경(.chf-auto)만 남고 칸은 비는 상태가 된다.
     mOnPlatformChange도 자동 채움보다 먼저 — 그 안의 mOnChannelIdChange가 .chf-auto를 떼어낸다. */
  document.getElementById('mPlatform').value=d.platform||'';
  document.getElementById('mIgId').value=d.igId||'';
  document.getElementById('mYtId').value=d.ytId||'';
  mOnPlatformChange(); // 플랫폼에 맞춰 placeholder 갱신
  _setFollowerInput('mFollowers',d.followers!=null?d.followers:null);
  // 이 건에 값이 없으면 같은 채널의 최근 값으로 채워줌(비어 있는 칸에만 — 아래 함수가 판정)
  _autofillChannelFields(d.ch||d.influencer,d); // 팔로워·플랫폼 ID를 한 곳에서 처리
  _refreshTierAutoLine('mInfluencer','mTier','mTierAuto');
  document.getElementById('mVendor').value=d.vendor||'';
  document.getElementById('mLinkInput').value=d.link||'';
  document.getElementById('mMarketingLink').value=d.marketingLink||'';
  /* ID 열이 생기기 전(2026-09-15 이전)에 등록된 건은 ID 칸이 비어 있고 링크만 있다 —
     링크에서 뽑아 해당 플랫폼 칸을 채워준다(과거 데이터 이행용). 이미 값이 있으면 건드리지 않는다. */
  const _linkId=_extractChannelIdFromLink(d.platform,d.link);
  if(_linkId){
    const _idEl=document.getElementById(_platformKind(d.platform)==='yt'?'mYtId':'mIgId');
    if(_idEl&&!_idEl.value)_idEl.value=_linkId;
  }
  // ID는 있는데 링크가 비어 있으면 여기서 채워진다(뱃지 상태도 같이 잡힌다)
  _initLinkAuto('m');

  // 일정
  document.getElementById('mStart').value=d.start||'';
  document.getElementById('mEnd').value=d.end||'';
  mOnDateChange();

  // 상품 정보
  const s=d.s||{};
  _modalCodes=(d.codes&&d.codes.length?d.codes.slice(0,10):['']);
  renderCodeList();
  document.getElementById('mSaleInput').value=s.sale!=null?s.sale:'';
  document.getElementById('mCommInput').value=s.comm!=null?s.comm:'';
  document.getElementById('mFormat').value=d.format||'';
  document.getElementById('mTargetQty').value=d.targetQty!=null?d.targetQty:'';

  // 사은품(최대 3개) — 뒤쪽 빈 슬롯은 잘라내되 최소 1행은 남김
  let gifts=[
    {item:d.giftItem1||'',qty:d.giftQty1!=null?String(d.giftQty1):''},
    {item:d.giftItem2||'',qty:d.giftQty2!=null?String(d.giftQty2):''},
    {item:d.giftItem3||'',qty:d.giftQty3!=null?String(d.giftQty3):''}
  ];
  while(gifts.length>1&&!gifts[gifts.length-1].item)gifts.pop();
  _modalGifts=gifts;
  renderGiftList();

  // 운영 정보 — option2=오픈시간, firstCome=선착순 품목, note(적립금)로 재사용됨(2026-08-18 개편)
  document.getElementById('mOpenTime').value=_normOpenTimeValue(d.option2);
  document.getElementById('mFirstComeItem').value=d.firstCome||'';
  document.getElementById('mFirstComeQty').value=d.firstComeQty!=null?String(d.firstComeQty):'';
  document.getElementById('mPoints').value=d.note||'';
  document.getElementById('mExtraQty').value=d.extraQty!=null?d.extraQty:'';
  document.getElementById('mNoteInput').value=s.note||''; // 신규 비고(서버 note2)
  mRecalcComposition();

  // 실적
  document.getElementById('mQtyInput').value=d.qty!=null?d.qty:'';

  renderReelList();
  _applyMultiRowNotice(d);
  document.getElementById('schOv').classList.add('open');
}

// 상품코드가 여러 개라 시트에서 여러 행으로 나뉜 건(그룹)이어도, 판매수량·릴스/조회수 등
// 실적 필드는 규칙상 대표 행(codeSeq 1번, _findGroupRows/parseMainSheet와 동일 기준)에만
// 기입되므로 모달에서 그대로 편집 가능 — updateDeal/saveReels(apps-script.js)가 이미
// groupRows[0](대표 행)에만 반영하도록 구현돼 있어 별도 잠금이 필요 없음.
/* ⚠ 2026-09-15: 예전엔 내용 기준으로만 합쳐진 건(_isComposite)의 저장·삭제를 통째로 막았다.
   시트의 dealId를 통일(applyUnifyDealIds)해서 그런 건이 정상적으로는 더 이상 생기지 않으므로
   잠금을 푼다. 내용 기준 병합은 "시트에 직접 입력해서 dealId가 제각각인 행"을 대비해 남겨두되,
   그런 건이 발견되면 막는 대신 안내만 한다 — 저장은 각 dealId의 대표 행으로 정상 반영된다. */
function _applyMultiRowNotice(d){
  const saveBtn=document.getElementById('mSaveBtn'),delBtn=document.getElementById('mDeleteBtn');
  saveBtn.disabled=false; saveBtn.title='';
  delBtn.disabled=false;  delBtn.title='';

  const hint=document.getElementById('mPerfHint');
  if(!hint)return;
  const msgs=[];
  if(d._isComposite){
    msgs.push('시트 직접 입력 건으로 보입니다. dealId 통일이 필요합니다');
    console.warn('[그룹핑] 시트 직접 입력으로 보이는 건 — dealId가 제각각입니다:',d._mergedDealIds,d);
  }
  /* 상품코드별로 실적이 행마다 들어 있는 건은 판매수량 칸 하나로 고칠 수 없다.
     합계를 그대로 쓰면 대표 행에만 반영돼 나머지 행 값과 이중으로 더해진다(총매출이 부풀어 오름).
     그래서 이 경우에만 실적 칸을 잠그고 시트에서 고치도록 안내한다. 나머지 필드는 정상 저장된다. */
  const perfSplit=(d.perfRows||0)>1;
  const qtyEl=document.getElementById('mQtyInput');
  if(qtyEl){
    qtyEl.readOnly=perfSplit;
    qtyEl.title=perfSplit?'상품코드별로 실적이 나뉘어 있어 여기서는 고칠 수 없습니다. 시트에서 해당 행의 판매수량을 수정해주세요.':'';
  }
  if(perfSplit)msgs.push('상품코드 '+d.perfRows+'개 행에 실적이 나뉘어 있어 판매수량은 시트에서 수정해주세요(표시값은 합계)');
  hint.textContent=msgs.join(' · ');
  hint.style.color=msgs.length?'var(--warn, #92400E)':'';
}

function closeSchModal(){
  document.getElementById('schOv').classList.remove('open');
}

function mOnLineChange(){
  const line=document.getElementById('mLine').value;
  const modelRow=document.getElementById('mModelRow');
  const mModel=document.getElementById('mModel');
  const mProd=document.getElementById('mProduct');
  if(LINE_HAS_MODELS[line]){
    modelRow.style.display='';
    _rebuildModelOptions(mModel,line);
    mModel.value='';mProd.value='';
  } else {
    modelRow.style.display='none';
    mProd.value=PRODUCT_SHEET_NAME[line]||line; // "제품명 참고" 필드도 시트 정식 표기로 표시
  }
}
function mOnModelChange(){
  const model=document.getElementById('mModel').value;
  document.getElementById('mProduct').value=model?(PRODUCT_SHEET_NAME[model]||model):'';
}
/* ⚠ 2026-09-15: 채널 ID 입력칸이 단일 mChannelId에서 mIgId/mYtId 둘로 갈렸다. 두 칸이 항상 같이
   보이므로 라벨을 바꿀 필요는 없고, 이 행의 플랫폼에 해당하는 칸만 예시를 구체적으로 보여준다. */
function mOnPlatformChange(){
  const p=document.getElementById('mPlatform').value;
  _syncPlatformIdMarks('m',p); // 선택한 플랫폼 쪽에만 필수(*) 표시
  mOnChannelIdChange(); // 플랫폼이 바뀌면 그쪽 ID 기준으로 링크를 다시 만든다
}

function mOnDateChange(){
  const s=document.getElementById('mStart').value;
  const e=document.getElementById('mEnd').value;
  /* ⚠ 월은 그동안 어디서도 채워지지 않아 모든 건에서 "선택"으로 비어 있었다(헤더엔 "4월"이
     보이는데 필드는 비는 상태). 연과 마찬가지로 시작일에서 파생되는 값이므로 같이 계산한다.
     연은 readonly지만 월은 예외적으로 다른 달로 잡는 경우가 있어 수정 가능하게 둔다 —
     대신 날짜를 다시 건드리면 시작일 기준으로 되돌아간다(파생값이라는 성격을 유지). */
  if(s){
    const sd=new Date(s+'T00:00:00');
    document.getElementById('mYear').value=sd.getFullYear();
    document.getElementById('mMonth').value=String(sd.getMonth()+1);
  }
  if(s&&e){
    const d=durDays(s,e);
    document.getElementById('mDuration').value=d&&d>0?`${d}일`:'—';
  }
}
