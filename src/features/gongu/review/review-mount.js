'use strict';
/* 공동구매 회고 — React 에디터(review-assets) 마운트/언마운트와 번들 로드 상태. */

// ── 회고 에디터(React+BlockNote, review-assets/review.js) 마운트/언마운트 ──
// 같은 window에 마운트되므로 대시보드가 이미 가진 인증/네트워크 함수를 bridge로 그대로 넘김
// (별도 재구현 없음). 페이지를 오가며 인스턴스가 누적되지 않도록 진입 시 항상 언마운트 후 마운트.
function _reviewAppBridge(){
  return{
    getGasUrl:_getGasUrl,getToken:_getToken,gasUrl:_gasUrl,gasFetch:_gasFetch,
    // _gasWrite(url,action,data,opts) — 회고 쪽 API는 (action,data,opts)만 알면 되게 URL을 여기서 채움
    gasWrite:(action,data,opts)=>_gasWrite(_getGasUrl(),action,data,opts),
    showToast:showToast,resizeImageToDataURL:resizeImageToDataURL,
  };
}
/* ── 회고 번들 로드 상태 (2026-09-15) ────────────────────────────────────────
   review.js는 5MB가 넘는 **defer** 스크립트라 문서 파싱이 끝난 뒤에야 실행된다. 반면 이 인라인
   스크립트는 파싱 "중"에 실행되고, 그 안의 부트스트랩이 _enterDashboard → _routeFromHash →
   _mountReviewApp을 동기로 부른다. 즉 세션이 복원된 채 #review로 바로 들어오면 번들보다 먼저
   마운트를 시도하게 되고, 그 시점엔 window.ReviewApp이 아직 없다.

   예전엔 그 순간 "불러오지 못했습니다"로 끝냈지만, 실제로는 실패가 아니라 **아직 안 온 것**이다.
   ⚠ 이 경합은 임베드 모드가 만든 게 아니라 원래부터 있었고, 사이드바가 가려주고 있었다 —
   회고는 대개 사이드바 클릭으로 들어갔고 그때는 번들이 이미 준비돼 있었기 때문. 임베드 모드는
   사이드바가 없어 직접 URL이 유일한 진입로라, 같은 버그가 100% 재현되는 것으로 드러났다.

   그래서 "없으면 실패" 대신 "오면 마운트"로 바꾼다. 진짜 실패(스크립트 자체 로드 실패)와
   구분해서 메시지도 다르게 내고, 원인은 반드시 콘솔에 실제 에러로 남긴다. */
let _reviewBundleState='loading'; // 'loading' | 'ready' | 'failed'
let _reviewMountWanted=false;     // 번들을 기다리는 동안 사용자가 회고 페이지에 있는가
function _reviewBundleLoaded(){
  _reviewBundleState=(typeof window.ReviewApp!=='undefined')?'ready':'failed';
  if(_reviewBundleState==='failed'){
    console.error('[회고] review.js는 받았는데 window.ReviewApp이 없습니다 — 번들 빌드(vite lib name) 확인 필요');
  }
  if(_reviewMountWanted)_mountReviewApp(); // 기다리던 중이었으면 지금 마운트
}
function _reviewBundleFailed(e){
  _reviewBundleState='failed';
  console.error('[회고] review.js 로드 실패 — 배포에 review-assets/review.js가 포함됐는지 확인하세요.',e);
  if(_reviewMountWanted)_mountReviewApp();
}
// defer 스크립트는 정상이라면 반드시 load/error 중 하나가 뜨지만, 그마저 안 오는 경우(프록시가
// 응답을 끊는 등)에 영원히 "불러오는 중"으로 남지 않도록 상한을 둔다.
setTimeout(()=>{
  if(_reviewBundleState!=='loading')return;
  _reviewBundleState='failed';
  console.error('[회고] review.js가 20초 안에 로드되지 않았습니다 — 네트워크/배포 상태 확인 필요');
  if(_reviewMountWanted)_mountReviewApp();
},20000);

function _mountReviewApp(){
  const host=document.getElementById('reviewRoot');
  if(!host)return;
  _reviewMountWanted=true;
  if(typeof window.ReviewApp==='undefined'){
    if(_reviewBundleState==='failed'){
      host.innerHTML='<div class="page-placeholder">회고 에디터를 불러오지 못했습니다.<br>네트워크 연결을 확인하고 새로고침해주세요.<br><span style="font-size:11px;color:var(--text-3)">자세한 원인은 개발자도구 콘솔에 기록됩니다</span></div>';
    }else{
      // 아직 오는 중 — 도착하면 onload가 이 함수를 다시 부른다
      host.innerHTML='<div class="page-placeholder">회고 에디터를 불러오는 중…</div>';
    }
    return;
  }
  try{
    window.ReviewApp.mount(host,_reviewAppBridge());
    _reviewMountWanted=false;
  }catch(err){
    // 예전엔 마운트 예외가 그대로 새어나가 "실패 메시지도 없이 빈 화면"이 됐다 — 원인을 반드시 남긴다
    console.error('[회고] 에디터 마운트 실패:',err);
    host.innerHTML='<div class="page-placeholder">회고 에디터를 여는 중 오류가 발생했습니다.<br>'+
      _escHtml((err&&err.message)||String(err))+'<br><span style="font-size:11px;color:var(--text-3)">자세한 내용은 개발자도구 콘솔 참고</span></div>';
  }
}
function _unmountReviewApp(){
  _reviewMountWanted=false; // 기다리는 동안 다른 페이지로 떠났으면 나중에 마운트하면 안 됨
  if(typeof window.ReviewApp!=='undefined'){
    try{window.ReviewApp.unmount();}catch(err){console.error('[회고] 언마운트 실패:',err);}
  }
}
