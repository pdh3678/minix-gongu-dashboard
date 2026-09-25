'use strict';
/* 수정 모달 우측 릴스 관리 — 썸네일 로드·붙여넣기·이미지 축소. */

/* ── 릴스 관리 (모달 우측) ── */
// 저장된 썸네일은 doGet의 ?thumb=<fileId> 프록시가 내려주는 이미지라, <img src>에 URL을 직접
// 넣으면 인증 토큰을 실을 수 없다. 그렇다고 커스텀 헤더로 토큰을 실어 fetch하면 preflight(OPTIONS)가
// 발생하는데 Apps Script는 OPTIONS에 응답하지 못해 CORS로 막힌다. 또한 서버가 Blob을 doGet에서
// 직접 반환하면 구글이 googleusercontent.com으로 302 리다이렉트해서 서빙하는데 그 응답엔 CORS
// 헤더가 없어 역시 막힌다. 그래서 fetchLive와 완전히 동일한 패턴으로 통일함: GET + 커스텀 헤더
// 없음 + 토큰은 URL 파라미터 + 서버는 ContentService _json()으로 응답(base64 인코딩된 이미지) →
// 프론트가 data URL로 변환해 <img>에 주입. 세션 내 메모리 캐시(fileId 기준)로 중복 fetch를 막고,
// 시트에 예전 방식으로 저장된 두 형태(우리 프록시의 /a/<도메인>/ 변형, drive.google.com 직접
// 링크)도 파일ID만 뽑아서 항상 우리 프록시로 새로 인증 요청하도록 흡수함(시트 값은 그대로 둠).
const _thumbBlobCache=new Map(); // fileId -> Promise<string|null>(data URL, 실패 시 null)

function _extractDriveThumbFileId(thumb){
  if(!thumb)return'';
  try{
    const u=new URL(thumb,location.href);
    if(u.searchParams.get('thumb'))return u.searchParams.get('thumb');
    if(u.searchParams.get('id'))return u.searchParams.get('id');
    const m=u.pathname.match(/\/file\/d\/([^/]+)/);
    if(m)return m[1];
  }catch(e){}
  return'';
}

async function _loadThumbBlobUrl(thumb){
  if(!thumb)return null;
  if(thumb.startsWith('data:'))return thumb; // 업로드 직후 로컬 미리보기는 그대로 사용
  const fileId=_extractDriveThumbFileId(thumb);
  if(!fileId){
    console.warn('[썸네일] 파일ID를 추출하지 못했습니다(알 수 없는 URL 형식):',thumb);
    return null;
  }
  if(_thumbBlobCache.has(fileId))return _thumbBlobCache.get(fileId);

  const gasUrl=_getGasUrl();
  const p=(async()=>{
    if(!gasUrl){console.warn('[썸네일 로드 실패] GAS URL이 설정되지 않았습니다. fileId=',fileId);return null;}
    try{
      // fetchLive와 완전히 동일한 방식(GET, 커스텀 헤더 없음, 토큰은 URL 파라미터) — 이래야
      // preflight 없는 단순 요청이 되고, 서버도 같은 _json() 응답 파이프라인을 타서 CORS를 통과함.
      // 커스텀 헤더(Authorization 등)를 붙이면 OPTIONS preflight가 발생하는데 Apps Script는
      // OPTIONS에 응답하지 못해 여기서 막히므로 절대 추가하지 말 것.
      const res=await fetch(_gasUrl(gasUrl+'?thumb='+encodeURIComponent(fileId)));
      if(!res.ok){
        console.error('[썸네일 로드 실패] 사유: HTTP '+res.status,'/ fileId=',fileId);
        return null;
      }
      const j=await res.json();
      if(j.error){
        const reason=j.error==='AUTH_REQUIRED'?'인증 실패(사유: '+(j.reason||'?')+')':j.error;
        console.error('[썸네일 로드 실패] 사유:',reason,'/ fileId=',fileId);
        return null;
      }
      if(!j.base64){
        console.error('[썸네일 로드 실패] 사유: 응답에 이미지 데이터 없음 / fileId=',fileId);
        return null;
      }
      return'data:'+(j.mimeType||'image/jpeg')+';base64,'+j.base64;
    }catch(e){
      console.error('[썸네일 로드 실패] 네트워크 오류:',e,'/ fileId=',fileId);
      return null;
    }
  })();
  _thumbBlobCache.set(fileId,p);
  return p;
}
function reelThumbHtml(r,i){
  if(r.thumb)return`<span class="reel-thumb-skeleton" id="reelThumbImg${i}"></span>`;
  return reelThumbFallback();
}
function reelThumbFallback(){
  return`<div class="reel-thumb-fallback"><span class="reel-thumb-ic">📷</span><span class="reel-thumb-ch">${_modalChannel}</span></div>`;
}
// 썸네일 이미지 로드 실패 시 값을 지우고 기본 카드로 되돌림
function reelThumbError(i){
  if(!_modalReels[i])return;
  console.error('[릴스 썸네일 로드 실패] slot=',i,'url=',_modalReels[i].thumb);
  _modalReels[i].thumb='';
  delete _modalReels[i]._pendingUpload;
  refreshReelThumb(i);
}
// 스켈레톤으로 먼저 그려둔 뒤, 각 슬롯의 실제 이미지를 비동기 인증 fetch로 채워넣음(목록/그리드 둘 다)
function _hydrateReelThumbs(){
  _modalReels.forEach((r,i)=>{
    if(!r.thumb)return;
    _loadThumbBlobUrl(r.thumb).then(src=>{
      const listEl=document.getElementById('reelThumbImg'+i);
      if(listEl)listEl.outerHTML=src?`<img id="reelThumbImg${i}" src="${src}" alt="" onerror="reelThumbError(${i})">`:reelThumbFallback();
      const galEl=document.getElementById('reelGalleryImg'+i);
      if(galEl)galEl.outerHTML=src?`<img id="reelGalleryImg${i}" src="${src}" alt="">`:'';
    });
  });
}
function renderReelList(){
  const host=document.getElementById('reelList');
  host.innerHTML=_modalReels.length?_modalReels.map((r,i)=>`
    <div class="reel-row">
      <a class="reel-thumb" id="reelThumb${i}" href="${r.url||'#'}" target="_blank" rel="noopener" onclick="${r.url?'':'event.preventDefault()'}">${reelThumbHtml(r,i)}</a>
      <div class="reel-fields">
        <input class="f-inp" type="url" placeholder="릴스 URL" value="${r.url||''}" oninput="updateReel(${i},'url',this.value)" onblur="maybeAutoThumb(${i},this.value)" onfocus="_activeReelIdx=${i}">
        <input class="f-inp" type="number" step="0.1" placeholder="조회수 (만 단위)" value="${r.views!=null?r.views:''}" oninput="updateReel(${i},'views',this.value)" onfocus="_activeReelIdx=${i}">
        <div class="reel-thumb-upload">
          <label class="reel-thumb-upload-btn">${r.thumb?'썸네일 변경':'📷 썸네일 사진 업로드'}<input type="file" accept="image/*" onchange="handleThumbFile(${i},this)" onfocus="_activeReelIdx=${i}"></label>
          ${r.thumb?`<button type="button" class="reel-thumb-clear" onclick="clearReelThumb(${i})">제거</button>`:''}
        </div>
      </div>
      <button class="reel-del" onclick="removeReel(${i})" title="삭제">✕</button>
    </div>`).join(''):'<div class="page-placeholder" style="padding:20px">등록된 릴스가 없습니다</div>';
  document.getElementById('addReelBtn').disabled=_modalReels.length>=10;
  updateReelTotal();
  renderReelGallery();
  _hydrateReelThumbs();
}
// 최대 10칸 — 채워진 썸네일은 클릭 시 릴스로 이동, 빈 칸은 점선 플레이스홀더
function renderReelGallery(){
  const host=document.getElementById('reelGallery');
  let html='';
  for(let i=0;i<10;i++){
    const r=_modalReels[i];
    if(r&&r.thumb){
      html+=`<a class="reel-gallery-slot" href="${r.url||'#'}" target="_blank" rel="noopener" onclick="${r.url?'':'event.preventDefault()'}" title="릴스 ${i+1}"><span class="reel-thumb-skeleton" id="reelGalleryImg${i}"></span></a>`;
    } else {
      html+='<div class="reel-gallery-slot empty"></div>';
    }
  }
  host.innerHTML=html;
}
function updateReel(i,field,val){
  if(!_modalReels[i])return;
  _modalReels[i][field]=field==='views'?(val===''?null:Number(val)):val;
  if(field==='views')updateReelTotal();
}
function refreshReelThumb(i){
  const el=document.getElementById('reelThumb'+i);
  if(!el||!_modalReels[i])return;
  const r=_modalReels[i];
  el.href=r.url||'#';
  el.innerHTML=reelThumbHtml(r,i);
  renderReelGallery();
  _hydrateReelThumbs();
}
function updateReelTotal(){
  const total=_modalReels.reduce((s,r)=>s+(r.views||0),0);
  document.getElementById('reelTotalViews').textContent=total?`합계 ${total.toFixed(1)}만`:'';
}
function addReelRow(){
  if(_modalReels.length>=10){alert('릴스는 최대 10개까지 추가할 수 있습니다.');return;}
  _modalReels.push({url:'',views:null,thumb:''});
  renderReelList();
}
function removeReel(i){
  _modalReels.splice(i,1);
  renderReelList();
}
function clearReelThumb(i){
  if(!_modalReels[i])return;
  _modalReels[i].thumb='';
  delete _modalReels[i]._pendingUpload;
  renderReelList();
}
// 유튜브는 oEmbed가 CORS 허용이라 자동 썸네일 수집 가능. 인스타그램은 인증/CORS 제약으로 시도하지 않음 (사진 업로드로 대체)
async function maybeAutoThumb(i,url){
  if(!_modalReels[i]||_modalReels[i].thumb||!url)return;
  if(!/youtu\.?be/i.test(url))return;
  try{
    const r=await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    if(!r.ok)return;
    const j=await r.json();
    if(j.thumbnail_url&&_modalReels[i]&&!_modalReels[i].thumb){
      _modalReels[i].thumb=j.thumbnail_url;
      refreshReelThumb(i);
    }
  }catch(e){/* CORS/네트워크 실패 시 조용히 무시 */}
}

// 사진 파일 선택 → 리사이즈/압축 후 미리보기, 실제 업로드는 저장 시 진행
function handleThumbFile(i,inputEl){
  const file=inputEl.files&&inputEl.files[0];
  if(!file)return;
  applyThumbFile(i,file);
  inputEl.value='';
}
// 리사이즈/압축 후 지정한 릴스 슬롯(i)에 썸네일로 적용 (파일 업로드·붙여넣기 공용)
function applyThumbFile(i,file){
  if(!file.type||!file.type.startsWith('image/')){alert('이미지 파일만 사용할 수 있습니다.');return;}
  resizeImageToDataURL(file,320,320,0.75).then(res=>{
    if(!_modalReels[i])return;
    _modalReels[i].thumb=res.dataUrl;
    _modalReels[i]._pendingUpload={base64:res.base64,mimeType:res.mimeType};
    console.log('[1.썸네일 선택] slot=',i,'_pendingUpload 세팅됨 (base64 length=',res.base64.length,')');
    refreshReelThumb(i);
  }).catch(()=>alert('이미지 처리 중 오류가 발생했습니다.'));
}
// 모달이 열려있을 때 Ctrl+V로 이미지 붙여넣기 — 포커스된(또는 마지막으로 사용한) 릴스 슬롯에 적용, 없으면 새 슬롯 생성
document.addEventListener('paste',e=>{
  if(!document.getElementById('schOv').classList.contains('open'))return;
  const items=(e.clipboardData||window.clipboardData)?.items;
  if(!items)return;
  for(let k=0;k<items.length;k++){
    if(!items[k].type||!items[k].type.startsWith('image/'))continue;
    const file=items[k].getAsFile();
    if(!file)continue;
    e.preventDefault();
    let idx=_activeReelIdx;
    if(idx==null||!_modalReels[idx]){
      if(_modalReels.length>=10){alert('릴스는 최대 10개까지 추가할 수 있습니다.');return;}
      _modalReels.push({url:'',views:null,thumb:''});
      idx=_modalReels.length-1;
      _activeReelIdx=idx;
      renderReelList();
    }
    applyThumbFile(idx,file);
    break;
  }
});
function resizeImageToDataURL(file,maxW,maxH,quality){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>{
      const img=new Image();
      img.onload=()=>{
        const ratio=Math.min(maxW/img.width,maxH/img.height,1);
        const w=Math.round(img.width*ratio),h=Math.round(img.height*ratio);
        const canvas=document.createElement('canvas');
        canvas.width=w;canvas.height=h;
        canvas.getContext('2d').drawImage(img,0,0,w,h);
        const dataUrl=canvas.toDataURL('image/jpeg',quality);
        resolve({dataUrl,base64:dataUrl.split(',')[1],mimeType:'image/jpeg'});
      };
      img.onerror=()=>reject(new Error('image load failed'));
      img.src=reader.result;
    };
    reader.onerror=()=>reject(new Error('file read failed'));
    reader.readAsDataURL(file);
  });
}
