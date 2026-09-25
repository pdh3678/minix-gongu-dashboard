'use strict';
/* 인플루언서 링크 자동 생성 — 수정 모달('m')·등록 폼('f') 공용. */

/* ── 인플루언서 링크 자동 생성 (모달 'm' / 등록 폼 'f' 공용) ─────────────────────
   ID를 입력하면 링크를 만들어 준다.
     · 링크의 근거는 "지금 선택된 플랫폼에 해당하는 ID 칸" 하나뿐이다 — 인스타 건에서 유튜브
       ID를 적었다고 링크가 유튜브로 바뀌면 안 된다
     · 사람이 직접 고친 링크는 덮어쓰지 않는다. 판정은 _lastAutoLink(우리가 마지막으로 써 넣은
       값)와 비교해서 한다. "현재 자동값과 같은가"만으로 보면 ID를 한 글자 고치는 순간 값이
       달라져 방금 만든 링크까지 '수동'으로 오인한다
     · ID 칸에 주소를 통째로 붙여넣으면 ID만 뽑아 칸에 넣고, 링크는 붙여넣은 주소를 그대로 쓴다 */
const LINK_IDS={m:{platform:'mPlatform',ig:'mIgId',yt:'mYtId',link:'mLinkInput',badge:'mLinkAuto'},
                f:{platform:'fPlatform',ig:'fIgId',yt:'fYtId',link:'fLink',badge:'fLinkAuto'}};
let _lastAutoLink={m:'',f:''};
const _sameUrl=(a,b)=>String(a||'').trim().replace(/\/+$/,'').toLowerCase()===String(b||'').trim().replace(/\/+$/,'').toLowerCase();
function _linkEls(scope){
  const m=LINK_IDS[scope]||LINK_IDS.m;
  return{platform:document.getElementById(m.platform),ig:document.getElementById(m.ig),
    yt:document.getElementById(m.yt),link:document.getElementById(m.link),badge:document.getElementById(m.badge)};
}
// 지금 플랫폼 기준으로 만들어질 링크. 플랫폼이나 ID가 없으면 빈 문자열
function _autoLinkFor(scope){
  const e=_linkEls(scope);
  if(!e.platform)return'';
  const p=e.platform.value;
  const el=_platformKind(p)==='yt'?e.yt:e.ig;
  return buildChannelLink(p,el&&el.value||'');
}
// 지금 링크 칸을 우리가 채워도 되는가 — 비어 있거나, 우리가 쓴 값이거나, 자동값과 같으면 OK
function _linkIsOurs(scope){
  const cur=String((_linkEls(scope).link||{}).value||'').trim();
  if(!cur)return true;
  if(_lastAutoLink[scope]&&_sameUrl(cur,_lastAutoLink[scope]))return true;
  const auto=_autoLinkFor(scope);
  return !!auto&&_sameUrl(cur,auto);
}
function _refreshLinkAutoBadge(scope){
  const e=_linkEls(scope);
  if(!e.badge)return;
  const auto=_autoLinkFor(scope);
  const manual=!_linkIsOurs(scope);
  e.badge.textContent=manual?'수동':'자동';
  e.badge.title=manual
    ?(auto?'직접 수정한 링크입니다. 누르면 ID 기준으로 다시 만듭니다.':'직접 입력한 링크입니다(플랫폼 ID가 없어 자동 생성할 수 없습니다).')
    :'플랫폼 ID로 자동 생성되는 링크입니다';
  e.badge.disabled=manual&&!auto;
}
// 뱃지 클릭 — 직접 고친 링크를 다시 자동값으로 되돌린다
function relinkChannel(scope){
  const auto=_autoLinkFor(scope);
  if(!auto){showToast('플랫폼과 ID를 먼저 입력해주세요');return;}
  const e=_linkEls(scope);
  if(e.link)e.link.value=auto;
  _lastAutoLink[scope]=auto;
  _refreshLinkAutoBadge(scope);
}
/* 모달·폼을 열 때 호출 — 지금 링크가 자동값인지 기억해 두고, ID는 있는데 링크가 비었으면 채운다. */
function _initLinkAuto(scope){
  const e=_linkEls(scope);
  const auto=_autoLinkFor(scope);
  const cur=String((e.link||{}).value||'').trim();
  if(auto&&!cur&&e.link)e.link.value=auto;           // ID만 있고 링크가 비어 있던 기존 건
  _lastAutoLink[scope]=(auto&&(!cur||_sameUrl(cur,auto)))?auto:'';
  _refreshLinkAutoBadge(scope);
}
/* ID 칸 입력 */
function _onChannelIdInput(scope,which){
  const e=_linkEls(scope);
  const p0=e.platform?e.platform.value:'';
  // which가 없으면(플랫폼을 바꾼 경우 등) 지금 플랫폼에 해당하는 칸을 본다
  const side=which||_platformKind(p0)||'ig';
  const el=side==='yt'?e.yt:e.ig;
  if(el)el.classList.remove('chf-auto'); // 사용자가 직접 손댄 순간 '자동 채움' 표시는 떼어낸다
  const p=p0;
  const kind=_platformKind(p);
  // 주소를 통째로 붙여넣은 경우 — ID만 남기고 그 주소를 링크로 쓴다
  if(el){
    const parsed=_parseChannelIdInput(p,el.value);
    if(parsed.url){
      if(parsed.id)el.value=parsed.id;
      if(e.link)e.link.value=parsed.url;
      _lastAutoLink[scope]=parsed.url;
      _refreshLinkAutoBadge(scope);
      return;
    }
  }
  // 지금 플랫폼과 다른 쪽 ID를 건드린 경우엔 링크를 바꾸지 않는다
  if(which&&kind&&which!==kind){_refreshLinkAutoBadge(scope);return;}
  const auto=_autoLinkFor(scope);
  if(auto&&_linkIsOurs(scope)){
    if(e.link)e.link.value=auto;
    _lastAutoLink[scope]=auto;
  }
  _refreshLinkAutoBadge(scope);
}
function mOnChannelIdChange(which){_onChannelIdInput('m',which);}
function onChannelIdChange(which){_onChannelIdInput('f',which);}
// 링크를 직접 붙여넣거나 수정했을 때, 인식 가능한 형식이면 인스타그램/유튜브 ID도 같이 맞춰줌
// (반대 방향은 mOnChannelIdChange가 이미 처리) — 인식 못 하는 링크는 ID를 건드리지 않음
function _onLinkInputChange(scope){
  const e=_linkEls(scope);
  const p=e.platform?e.platform.value:'';
  const link=String((e.link||{}).value||'').trim();
  if(!link){_refreshLinkAutoBadge(scope);return;}
  const id=_extractChannelIdFromLink(p,link);
  if(id){
    const target=_platformKind(p)==='yt'?e.yt:e.ig;
    if(target){target.value=id;target.classList.remove('chf-auto');}
  }
  _refreshLinkAutoBadge(scope);
}
function mOnLinkInputChange(){_onLinkInputChange('m');}
function fOnLinkInputChange(){_onLinkInputChange('f');}
